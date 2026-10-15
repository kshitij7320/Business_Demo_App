import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DataStore } from '../../src/storage/dataStore.js';
import { InventoryEngine } from '../../src/core/inventoryEngine.js';
import { VALUATION_METHODS, COLLECTIONS } from '../../src/config/constants.js';
import { InsufficientStockError, ValidationError } from '../../src/core/errors.js';

describe('InventoryEngine Unit Tests', () => {
  let tempDir;
  let store;
  let engine;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockpulse-inv-test-'));
    store = new DataStore(tempDir);
    await store.init();
    engine = new InventoryEngine(store);
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates an SKU and calculates zero stock initially', async () => {
    const sku = await engine.createSku({
      skuCode: 'CHAIR-BLK',
      name: 'Ergonomic Office Chair Black',
      category: 'Furniture',
      unit: 'PCS',
      sellingPrice: 4500,
      taxRate: 18,
      reorderPoint: 15,
      safetyStock: 5,
      leadTimeDays: 7,
      averageDailyDemand: 2
    });

    assert.strictEqual(sku.skuCode, 'CHAIR-BLK');
    const stock = engine.getStockLevel(sku.id);
    assert.strictEqual(stock.totalAvailable, 0);
    assert.strictEqual(stock.batchCount, 0);
  });

  it('receives multiple stock batches with distinct cost prices', async () => {
    const sku = await engine.createSku({
      skuCode: 'STEEL-ROD',
      name: 'Reinforced Steel Rod 10mm',
      unit: 'PCS',
      sellingPrice: 300,
      taxRate: 18
    });

    const batch1 = await engine.receiveStock({
      skuId: sku.id,
      quantity: 50,
      unitCostPrice: 200,
      receivedDate: '2026-01-01T10:00:00.000Z'
    });

    const batch2 = await engine.receiveStock({
      skuId: sku.id,
      quantity: 30,
      unitCostPrice: 220,
      receivedDate: '2026-01-10T10:00:00.000Z'
    });

    const stock = engine.getStockLevel(sku.id);
    assert.strictEqual(stock.totalAvailable, 80);
    assert.strictEqual(stock.batchCount, 2);
    assert.ok(batch1.batchNumber);
    assert.ok(batch2.batchNumber);
  });

  it('depletes stock using FIFO: depletes oldest lot first and computes exact COGS', async () => {
    const sku = await engine.createSku({
      skuCode: 'CABLE-CAT6',
      name: 'Cat6 Ethernet Cable 100m',
      unit: 'BOX',
      sellingPrice: 1200,
      taxRate: 18
    });

    // Lot 1: 20 units @ 800 (Received Jan 1)
    await engine.receiveStock({
      skuId: sku.id,
      quantity: 20,
      unitCostPrice: 800,
      receivedDate: '2026-01-01T00:00:00.000Z'
    });

    // Lot 2: 30 units @ 850 (Received Jan 15)
    await engine.receiveStock({
      skuId: sku.id,
      quantity: 30,
      unitCostPrice: 850,
      receivedDate: '2026-01-15T00:00:00.000Z'
    });

    // Request 25 units using FIFO:
    // Should deplete all 20 units from Lot 1 @ 800 = 16,000
    // And 5 units from Lot 2 @ 850 = 4,250
    // Total COGS = 20,250. Remaining in Lot 2 = 25 units.
    const result = await engine.depleteStock(sku.id, 25, VALUATION_METHODS.FIFO);

    assert.strictEqual(result.totalDepleted, 25);
    assert.strictEqual(result.cogs, 20250);
    assert.strictEqual(result.averageUnitCost, 810);
    assert.strictEqual(result.allocations.length, 2);
    assert.strictEqual(result.allocations[0].quantity, 20);
    assert.strictEqual(result.allocations[0].unitCost, 800);
    assert.strictEqual(result.allocations[1].quantity, 5);
    assert.strictEqual(result.allocations[1].unitCost, 850);

    const remainingStock = engine.getStockLevel(sku.id);
    assert.strictEqual(remainingStock.totalAvailable, 25);
  });

  it('depletes stock using LIFO: depletes newest lot first and computes exact COGS', async () => {
    const sku = await engine.createSku({
      skuCode: 'SSD-1TB',
      name: 'NVMe SSD 1TB',
      unit: 'PCS',
      sellingPrice: 6000,
      taxRate: 18
    });

    // Lot 1: 10 units @ 4000 (Received Jan 1)
    await engine.receiveStock({
      skuId: sku.id,
      quantity: 10,
      unitCostPrice: 4000,
      receivedDate: '2026-01-01T00:00:00.000Z'
    });

    // Lot 2: 20 units @ 4200 (Received Jan 20)
    await engine.receiveStock({
      skuId: sku.id,
      quantity: 20,
      unitCostPrice: 4200,
      receivedDate: '2026-01-20T00:00:00.000Z'
    });

    // Request 25 units using LIFO:
    // Should deplete all 20 units from newest Lot 2 @ 4200 = 84,000
    // And 5 units from Lot 1 @ 4000 = 20,000
    // Total COGS = 104,000
    const result = await engine.depleteStock(sku.id, 25, VALUATION_METHODS.LIFO);

    assert.strictEqual(result.totalDepleted, 25);
    assert.strictEqual(result.cogs, 104000);
    assert.strictEqual(result.averageUnitCost, 4160);
    assert.strictEqual(result.allocations[0].quantity, 20);
    assert.strictEqual(result.allocations[0].unitCost, 4200);
    assert.strictEqual(result.allocations[1].quantity, 5);
    assert.strictEqual(result.allocations[1].unitCost, 4000);

    const remainingStock = engine.getStockLevel(sku.id);
    assert.strictEqual(remainingStock.totalAvailable, 5);
  });

  it('prevents negative stock and throws InsufficientStockError without modifying batches', async () => {
    const sku = await engine.createSku({
      skuCode: 'RAM-16GB',
      name: 'DDR4 RAM 16GB',
      unit: 'PCS',
      sellingPrice: 3200,
      taxRate: 18
    });

    await engine.receiveStock({
      skuId: sku.id,
      quantity: 5,
      unitCostPrice: 2500,
      receivedDate: '2026-01-01T00:00:00.000Z'
    });

    await assert.rejects(
      async () => {
        await engine.depleteStock(sku.id, 10, VALUATION_METHODS.FIFO);
      },
      (err) => {
        assert.ok(err instanceof InsufficientStockError);
        assert.strictEqual(err.details.requested, 10);
        assert.strictEqual(err.details.available, 5);
        assert.strictEqual(err.details.deficit, 5);
        return true;
      }
    );

    // Verify stock was NOT deducted
    const stockAfter = engine.getStockLevel(sku.id);
    assert.strictEqual(stockAfter.totalAvailable, 5);
  });

  it('restores stock when items are returned', async () => {
    const sku = await engine.createSku({
      skuCode: 'MOUSE-W',
      name: 'Wireless Ergonomic Mouse',
      unit: 'PCS',
      sellingPrice: 800,
      taxRate: 18
    });

    const batch = await engine.receiveStock({
      skuId: sku.id,
      quantity: 10,
      unitCostPrice: 500,
      receivedDate: '2026-01-01T00:00:00.000Z'
    });

    await engine.depleteStock(sku.id, 4, VALUATION_METHODS.FIFO);
    assert.strictEqual(engine.getStockLevel(sku.id).totalAvailable, 6);

    await engine.restoreStock(sku.id, 2, batch.id);
    assert.strictEqual(engine.getStockLevel(sku.id).totalAvailable, 8);
  });

  it('calculates reorder thresholds and low-stock alerts correctly', async () => {
    // Demand = 5/day, LeadTime = 4 days, SafetyStock = 10 -> ROP = (5 * 4) + 10 = 30
    const sku = await engine.createSku({
      skuCode: 'KEYBOARD-M',
      name: 'Mechanical Gaming Keyboard',
      unit: 'PCS',
      sellingPrice: 2500,
      taxRate: 18,
      averageDailyDemand: 5,
      leadTimeDays: 4,
      safetyStock: 10
    });

    // Receive only 20 units (which is <= ROP 30)
    await engine.receiveStock({
      skuId: sku.id,
      quantity: 20,
      unitCostPrice: 1500,
      receivedDate: '2026-01-01T00:00:00.000Z'
    });

    const alerts = engine.computeReorderThresholds();
    const itemAlert = alerts.find(a => a.sku.id === sku.id);

    assert.ok(itemAlert);
    assert.strictEqual(itemAlert.reorderPoint, 30);
    assert.strictEqual(itemAlert.currentStock, 20);
    assert.strictEqual(itemAlert.isLowStock, true);
    assert.ok(itemAlert.suggestedOrderQuantity > 0);
  });

  it('identifies dead stock batches and calculates tied-up capital', async () => {
    const sku = await engine.createSku({
      skuCode: 'STAGNANT-PART',
      name: 'Old Industrial Sensor',
      unit: 'PCS',
      sellingPrice: 1000,
      taxRate: 18
    });

    // 120 days ago (stagnant)
    const oldDate = new Date(Date.now() - (120 * 24 * 60 * 60 * 1000)).toISOString();
    await engine.receiveStock({
      skuId: sku.id,
      quantity: 15,
      unitCostPrice: 400,
      receivedDate: oldDate
    });

    const analysis = engine.analyzeDeadStock(90, 30);
    assert.ok(analysis.deadStockBatches.length >= 1);
    assert.strictEqual(analysis.totalDeadStockValue, 6000); // 15 * 400
  });
});
