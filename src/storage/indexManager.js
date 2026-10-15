import { ConflictError } from '../core/errors.js';

/**
 * Secondary index manager providing fast in-memory lookups
 * and unique constraint validation.
 */
export class IndexManager {
  constructor() {
    /**
     * Map: collection -> fieldName -> { unique: boolean, map: Map<value, id | Set<id>> }
     * @type {Map<string, Map<string, { unique: boolean, map: Map<any, any> }>>}
     */
    this._indexes = new Map();
  }

  /**
   * Registers an index on a specific collection field.
   * @param {string} collection
   * @param {string} field
   * @param {{ unique?: boolean }} options
   */
  createIndex(collection, field, options = { unique: false }) {
    if (!this._indexes.has(collection)) {
      this._indexes.set(collection, new Map());
    }
    const collectionIndexes = this._indexes.get(collection);
    collectionIndexes.set(field, {
      unique: Boolean(options.unique),
      map: new Map()
    });
  }

  /**
   * Indexes a document within registered indices.
   * @param {string} collection
   * @param {object} doc
   */
  indexDocument(collection, doc) {
    const colIndexes = this._indexes.get(collection);
    if (!colIndexes) return;

    for (const [field, indexDef] of colIndexes.entries()) {
      const val = doc[field];
      if (val === undefined || val === null) continue;

      if (indexDef.unique) {
        const existingId = indexDef.map.get(val);
        if (existingId && existingId !== doc.id) {
          throw new ConflictError(
            `Unique index constraint violated on ${collection}.${field} with value "${val}"`,
            { collection, field, value: val, conflictingId: existingId }
          );
        }
        indexDef.map.set(val, doc.id);
      } else {
        if (!indexDef.map.has(val)) {
          indexDef.map.set(val, new Set());
        }
        indexDef.map.get(val).add(doc.id);
      }
    }
  }

  /**
   * Removes document keys from all registered collection indices.
   * @param {string} collection
   * @param {object} doc
   */
  removeDocument(collection, doc) {
    const colIndexes = this._indexes.get(collection);
    if (!colIndexes) return;

    for (const [field, indexDef] of colIndexes.entries()) {
      const val = doc[field];
      if (val === undefined || val === null) continue;

      if (indexDef.unique) {
        if (indexDef.map.get(val) === doc.id) {
          indexDef.map.delete(val);
        }
      } else {
        const set = indexDef.map.get(val);
        if (set) {
          set.delete(doc.id);
          if (set.size === 0) {
            indexDef.map.delete(val);
          }
        }
      }
    }
  }

  /**
   * Updates indices when a document is modified.
   * @param {string} collection
   * @param {object} oldDoc
   * @param {object} newDoc
   */
  updateDocument(collection, oldDoc, newDoc) {
    this.removeDocument(collection, oldDoc);
    try {
      this.indexDocument(collection, newDoc);
    } catch (err) {
      // Re-index old doc to maintain index consistency if update fails
      this.indexDocument(collection, oldDoc);
      throw err;
    }
  }

  /**
   * Finds document ID(s) matching an indexed field value.
   * @param {string} collection
   * @param {string} field
   * @param {any} value
   * @returns {string|string[]|null} Single ID for unique index, array of IDs for non-unique, or null
   */
  lookup(collection, field, value) {
    const colIndexes = this._indexes.get(collection);
    if (!colIndexes) return null;
    const indexDef = colIndexes.get(field);
    if (!indexDef) return null;

    if (indexDef.unique) {
      return indexDef.map.get(value) || null;
    }
    const set = indexDef.map.get(value);
    return set ? Array.from(set) : [];
  }

  /**
   * Clears all indexes for a collection.
   * @param {string} collection
   */
  clear(collection) {
    if (this._indexes.has(collection)) {
      for (const indexDef of this._indexes.get(collection).values()) {
        indexDef.map.clear();
      }
    }
  }
}
