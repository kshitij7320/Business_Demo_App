import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { WriteAheadLog } from './wal.js';
import { SchemaValidator } from './schemaValidator.js';
import { IndexManager } from './indexManager.js';
import { BackupManager } from './backupManager.js';
import { COLLECTIONS } from '../config/constants.js';
import { NotFoundError } from '../core/errors.js';

/**
 * File-backed transactional data store with write-ahead logging,
 * secondary indexing, and atomic multi-document transactions.
 */
export class DataStore {
  /**
   * @param {string} baseDirectory
   * @param {object} [options]
   * @param {number} [options.backupRetentionCount]
   */
  constructor(baseDirectory, options = {}) {
    this.baseDir = baseDirectory;
    this.runtimeDir = path.join(baseDirectory, 'runtime');
    this.walDir = path.join(baseDirectory, 'wal');
    this.backupDir = path.join(baseDirectory, 'backups');

    this.wal = new WriteAheadLog(this.walDir);
    this.indexes = new IndexManager();
    this.backups = new BackupManager(this.backupDir, options.backupRetentionCount || 5);

    /**
     * In-memory document storage: collection -> Map<id, doc>
     * @type {Map<string, Map<string, any>>}
     */
    this._collections = new Map();

    /**
     * Concurrency serialization queue for write operations.
     * @type {Promise<any>}
     */
    this._writeLock = Promise.resolve();
    this._asyncLocalStorage = new AsyncLocalStorage();

    this._initializeStandardIndexes();
  }

  _initializeStandardIndexes() {
    this.indexes.createIndex(COLLECTIONS.SKUS, 'skuCode', { unique: true });
    this.indexes.createIndex(COLLECTIONS.BATCHES, 'skuId', { unique: false });
    this.indexes.createIndex(COLLECTIONS.BATCHES, 'batchNumber', { unique: false });
    this.indexes.createIndex(COLLECTIONS.INVOICES, 'invoiceNumber', { unique: true });
    this.indexes.createIndex(COLLECTIONS.CREDIT_NOTES, 'creditNoteNumber', { unique: true });
    this.indexes.createIndex(COLLECTIONS.CREDIT_NOTES, 'invoiceId', { unique: false });
    this.indexes.createIndex(COLLECTIONS.SUPPLIERS, 'gstin', { unique: false });
    this.indexes.createIndex(COLLECTIONS.PURCHASE_ORDERS, 'poNumber', { unique: true });
    this.indexes.createIndex(COLLECTIONS.PURCHASE_ORDERS, 'supplierId', { unique: false });
    this.indexes.createIndex(COLLECTIONS.PURCHASE_ORDERS, 'status', { unique: false });
  }

  _ensureDirectories() {
    for (const dir of [this.baseDir, this.runtimeDir, this.walDir, this.backupDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Gets or initializes an in-memory collection map.
   * @param {string} name
   * @returns {Map<string, any>}
   */
  _getCollection(name) {
    if (!this._collections.has(name)) {
      this._collections.set(name, new Map());
    }
    return this._collections.get(name);
  }

  /**
   * Initializes the database, loading runtime snapshots and replaying WAL.
   */
  async init() {
    this._ensureDirectories();

    // 1. Load existing JSON snapshots from runtime directory
    for (const colName of Object.values(COLLECTIONS)) {
      const colMap = this._getCollection(colName);
      const snapshotFile = path.join(this.runtimeDir, `${colName}.json`);

      if (fs.existsSync(snapshotFile)) {
        try {
          const raw = fs.readFileSync(snapshotFile, 'utf8');
          const docs = JSON.parse(raw);
          if (Array.isArray(docs)) {
            for (const doc of docs) {
              colMap.set(doc.id, doc);
              this.indexes.indexDocument(colName, doc);
            }
          }
        } catch {
          // If snapshot is unreadable, rely on WAL replay
        }
      }
    }

    // 2. Replay uncompacted committed operations from WAL
    const uncommittedOps = this.wal.recover();
    for (const op of uncommittedOps) {
      const colMap = this._getCollection(op.collection);
      if (op.op === 'INSERT') {
        colMap.set(op.key, op.data);
        this.indexes.indexDocument(op.collection, op.data);
      } else if (op.op === 'UPDATE') {
        const oldDoc = colMap.get(op.key);
        if (oldDoc) {
          this.indexes.removeDocument(op.collection, oldDoc);
        }
        colMap.set(op.key, op.data);
        this.indexes.indexDocument(op.collection, op.data);
      } else if (op.op === 'DELETE') {
        const oldDoc = colMap.get(op.key);
        if (oldDoc) {
          this.indexes.removeDocument(op.collection, oldDoc);
          colMap.delete(op.key);
        }
      }
    }
  }

  /**
   * Serializes write operations to prevent race conditions during file updates.
   * @template T
   * @param {() => Promise<T>|T} operation
   * @returns {Promise<T>}
   */
  _enqueueWrite(operation) {
    if (this._asyncLocalStorage.getStore()) {
      return Promise.resolve().then(() => operation());
    }

    const next = this._writeLock.then(() => {
      return this._asyncLocalStorage.run(true, () => operation());
    });
    this._writeLock = next.catch(() => {});
    return next;
  }

  /**
   * Generates a new unique random UUID.
   * @returns {string}
   */
  generateId() {
    return crypto.randomUUID();
  }

  /**
   * Atomic sequence generator for numbering schemes (e.g. INV-001).
   * @param {string} counterKey
   * @returns {Promise<number>}
   */
  async getNextSequence(counterKey) {
    return this._enqueueWrite(() => {
      const col = this._getCollection(COLLECTIONS.COUNTERS);
      const current = col.get(counterKey) || { id: counterKey, value: 0 };
      const nextValue = current.value + 1;
      const updated = { ...current, value: nextValue, updatedAt: new Date().toISOString() };

      this.wal.append({
        op: 'UPDATE',
        collection: COLLECTIONS.COUNTERS,
        key: counterKey,
        data: updated
      });

      col.set(counterKey, updated);
      return nextValue;
    });
  }

  /**
   * Inserts a document into a collection.
   * @param {string} collection
   * @param {object} doc
   * @returns {Promise<object>} The stored document
   */
  async insert(collection, doc) {
    return this._enqueueWrite(() => {
      const record = {
        id: doc.id || this.generateId(),
        createdAt: doc.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...doc
      };

      SchemaValidator.validate(collection, record);
      this.indexes.indexDocument(collection, record);

      this.wal.append({
        op: 'INSERT',
        collection,
        key: record.id,
        data: record
      });

      this._getCollection(collection).set(record.id, record);
      return structuredClone(record);
    });
  }

  /**
   * Updates an existing document.
   * @param {string} collection
   * @param {string} id
   * @param {object} updates
   * @returns {Promise<object>} Updated document
   */
  async update(collection, id, updates) {
    return this._enqueueWrite(() => {
      const col = this._getCollection(collection);
      const existing = col.get(id);
      if (!existing) {
        throw new NotFoundError(collection, id);
      }

      const updated = {
        ...existing,
        ...updates,
        id, // Preserve immutable ID
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString()
      };

      SchemaValidator.validate(collection, updated);
      this.indexes.updateDocument(collection, existing, updated);

      this.wal.append({
        op: 'UPDATE',
        collection,
        key: id,
        data: updated
      });

      col.set(id, updated);
      return structuredClone(updated);
    });
  }

  /**
   * Deletes a document by ID.
   * @param {string} collection
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async delete(collection, id) {
    return this._enqueueWrite(() => {
      const col = this._getCollection(collection);
      const existing = col.get(id);
      if (!existing) {
        return false;
      }

      this.indexes.removeDocument(collection, existing);
      this.wal.append({
        op: 'DELETE',
        collection,
        key: id
      });

      col.delete(id);
      return true;
    });
  }

  /**
   * Retrieves a document by its ID.
   * @param {string} collection
   * @param {string} id
   * @returns {object|null}
   */
  findById(collection, id) {
    const doc = this._getCollection(collection).get(id);
    return doc ? structuredClone(doc) : null;
  }

  /**
   * Finds the first document matching a predicate.
   * @param {string} collection
   * @param {(doc: any) => boolean} predicate
   * @returns {object|null}
   */
  findOne(collection, predicate) {
    for (const doc of this._getCollection(collection).values()) {
      if (predicate(doc)) {
        return structuredClone(doc);
      }
    }
    return null;
  }

  /**
   * Finds all documents in a collection matching a predicate.
   * @param {string} collection
   * @param {(doc: any) => boolean} [predicate]
   * @returns {Array<object>}
   */
  find(collection, predicate) {
    const results = [];
    for (const doc of this._getCollection(collection).values()) {
      if (!predicate || predicate(doc)) {
        results.push(structuredClone(doc));
      }
    }
    return results;
  }

  /**
   * Finds documents using registered secondary indices.
   * @param {string} collection
   * @param {string} field
   * @param {any} value
   * @returns {Array<object>|object|null}
   */
  findByIndex(collection, field, value) {
    const lookupResult = this.indexes.lookup(collection, field, value);
    if (!lookupResult) return null;

    if (Array.isArray(lookupResult)) {
      return lookupResult
        .map(id => this.findById(collection, id))
        .filter(Boolean);
    }
    return this.findById(collection, lookupResult);
  }

  /**
   * Executes a multi-operation transaction with atomic commit or rollback semantics.
   * @template T
   * @param {(ctx: {
   *   insert: (col: string, doc: object) => object,
   *   update: (col: string, id: string, updates: object) => object,
   *   delete: (col: string, id: string) => boolean,
   *   findById: (col: string, id: string) => object|null,
   *   find: (col: string, pred?: (d: any) => boolean) => object[]
   * }) => Promise<T>|T} callback
   * @returns {Promise<T>}
   */
  async transaction(callback) {
    return this._enqueueWrite(async () => {
      const txId = crypto.randomUUID();
      this.wal.append({ txId, op: 'TX_BEGIN' });

      // Staged operational changes
      const stagedOps = [];
      const tempCollections = new Map();

      // Deep copy relevant collections for isolated staging
      for (const [colName, colMap] of this._collections.entries()) {
        tempCollections.set(colName, new Map(colMap));
      }

      const getTempCol = (name) => {
        if (!tempCollections.has(name)) {
          tempCollections.set(name, new Map());
        }
        return tempCollections.get(name);
      };

      const txContext = {
        insert: (col, doc) => {
          const record = {
            id: doc.id || this.generateId(),
            createdAt: doc.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            ...doc
          };
          SchemaValidator.validate(col, record);
          getTempCol(col).set(record.id, record);
          stagedOps.push({ op: 'INSERT', collection: col, key: record.id, data: record });
          return structuredClone(record);
        },
        update: (col, id, updates) => {
          const colMap = getTempCol(col);
          const existing = colMap.get(id);
          if (!existing) throw new NotFoundError(col, id);
          const updated = {
            ...existing,
            ...updates,
            id,
            createdAt: existing.createdAt,
            updatedAt: new Date().toISOString()
          };
          SchemaValidator.validate(col, updated);
          colMap.set(id, updated);
          stagedOps.push({ op: 'UPDATE', collection: col, key: id, data: updated, oldDoc: existing });
          return structuredClone(updated);
        },
        delete: (col, id) => {
          const colMap = getTempCol(col);
          const existing = colMap.get(id);
          if (!existing) return false;
          colMap.delete(id);
          stagedOps.push({ op: 'DELETE', collection: col, key: id, oldDoc: existing });
          return true;
        },
        findById: (col, id) => {
          const doc = getTempCol(col).get(id);
          return doc ? structuredClone(doc) : null;
        },
        find: (col, pred) => {
          const docs = [];
          for (const doc of getTempCol(col).values()) {
            if (!pred || pred(doc)) docs.push(structuredClone(doc));
          }
          return docs;
        }
      };

      try {
        const result = await callback(txContext);

        // Apply staged changes to real collections and indexes
        for (const op of stagedOps) {
          const realCol = this._getCollection(op.collection);
          if (op.op === 'INSERT') {
            this.indexes.indexDocument(op.collection, op.data);
            realCol.set(op.key, op.data);
          } else if (op.op === 'UPDATE') {
            this.indexes.updateDocument(op.collection, op.oldDoc, op.data);
            realCol.set(op.key, op.data);
          } else if (op.op === 'DELETE') {
            this.indexes.removeDocument(op.collection, op.oldDoc);
            realCol.delete(op.key);
          }

          this.wal.append({
            txId,
            op: op.op,
            collection: op.collection,
            key: op.key,
            data: op.data
          });
        }

        this.wal.append({ txId, op: 'TX_COMMIT' });
        return result;
      } catch (err) {
        this.wal.append({ txId, op: 'TX_ROLLBACK' });
        throw err;
      }
    });
  }

  /**
   * Persists snapshot JSON files and truncates WAL log.
   */
  async checkpoint() {
    return this._enqueueWrite(() => {
      this._ensureDirectories();
      for (const [colName, colMap] of this._collections.entries()) {
        const filePath = path.join(this.runtimeDir, `${colName}.json`);
        const tempPath = `${filePath}.tmp`;
        const data = Array.from(colMap.values());
        fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tempPath, filePath);
      }
      this.wal.truncate();
    });
  }

  /**
   * Creates an archived database backup snapshot.
   * @returns {string} Backup directory name
   */
  backup() {
    return this.backups.createBackup(this._collections);
  }

  /**
   * Flushes state and closes open file descriptors.
   */
  async close() {
    await this.checkpoint();
    this.wal.close();
  }
}
