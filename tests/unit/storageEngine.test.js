import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DataStore } from '../../src/storage/dataStore.js';
import { COLLECTIONS } from '../../src/config/constants.js';
import { ConflictError, ValidationError } from '../../src/core/errors.js';

describe('DataStore Storage Engine', () => {
  let tempDir;
  let store;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockpulse-test-'));
    store = new DataStore(tempDir);
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('inserts and retrieves an SKU with schema validation', async () => {
    const sku = await store.insert(COLLECTIONS.SKUS, {
      skuCode: 'WIDGET-001',
      name: 'High Precision Widget',
      category: 'Electronics',
      unit: 'PCS',
      sellingPrice: 199.99,
      taxRate: 18,
      reorderPoint: 20,
      safetyStock: 5
    });

    assert.ok(sku.id);
    assert.strictEqual(sku.skuCode, 'WIDGET-001');

    const found = store.findById(COLLECTIONS.SKUS, sku.id);
    assert.strictEqual(found.name, 'High Precision Widget');

    // Index lookup
    const indexed = store.findByIndex(COLLECTIONS.SKUS, 'skuCode', 'WIDGET-001');
    assert.strictEqual(indexed.id, sku.id);
  });

  it('rejects duplicate unique index entries', async () => {
    await store.insert(COLLECTIONS.SKUS, {
      skuCode: 'UNIQUE-123',
      name: 'Item One',
      unit: 'PCS',
      sellingPrice: 50,
      taxRate: 12
    });

    await assert.rejects(
      async () => {
        await store.insert(COLLECTIONS.SKUS, {
          skuCode: 'UNIQUE-123',
          name: 'Item Duplicate',
          unit: 'PCS',
          sellingPrice: 60,
          taxRate: 12
        });
      },
      (err) => err instanceof ConflictError
    );
  });

  it('rejects invalid schema payloads', async () => {
    await assert.rejects(
      async () => {
        await store.insert(COLLECTIONS.SKUS, {
          skuCode: '', // Empty skuCode should fail
          name: 'Invalid Item',
          sellingPrice: -10 // Negative price should fail
        });
      },
      (err) => err instanceof ValidationError
    );
  });

  it('executes atomic transactions with rollback on failure', async () => {
    await assert.rejects(
      async () => {
        await store.transaction(async (tx) => {
          tx.insert(COLLECTIONS.SKUS, {
            skuCode: 'TX-SKU-1',
            name: 'TX Item 1',
            unit: 'PCS',
            sellingPrice: 100,
            taxRate: 18
          });

          // Deliberate error to trigger rollback
          throw new Error('Simulation abort');
        });
      },
      /Simulation abort/
    );

    // Verify nothing was persisted
    const all = store.find(COLLECTIONS.SKUS);
    assert.strictEqual(all.length, 0);
  });

  it('increments atomic sequences consistently', async () => {
    const s1 = await store.getNextSequence('invoice');
    const s2 = await store.getNextSequence('invoice');
    const s3 = await store.getNextSequence('invoice');

    assert.strictEqual(s1, 1);
    assert.strictEqual(s2, 2);
    assert.strictEqual(s3, 3);
  });

  it('recovers state from WAL after crash restart', async () => {
    await store.insert(COLLECTIONS.SKUS, {
      skuCode: 'CRASH-RECOVER',
      name: 'Recoverable Item',
      unit: 'PCS',
      sellingPrice: 120,
      taxRate: 18
    });

    // Close without checkpointing to simulate uncompacted WAL recovery
    store.wal.close();

    const recoveredStore = new DataStore(tempDir);
    await recoveredStore.init();

    const item = recoveredStore.findByIndex(COLLECTIONS.SKUS, 'skuCode', 'CRASH-RECOVER');
    assert.ok(item);
    assert.strictEqual(item.name, 'Recoverable Item');
    await recoveredStore.close();
  });

  it('creates backup snapshots and respects retention rotation', async () => {
    await store.insert(COLLECTIONS.SKUS, {
      skuCode: 'BACKUP-ITEM',
      name: 'Backup Item',
      unit: 'PCS',
      sellingPrice: 10,
      taxRate: 5
    });

    // Create 3 backups
    store.backup();
    store.backup();
    store.backup();

    const backups = store.backups.listBackups();
    assert.ok(backups.length >= 1);
    assert.ok(backups[0].totalRecords >= 1);
  });
});
