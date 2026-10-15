import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DataStore } from '../../src/storage/dataStore.js';
import { InventoryEngine } from '../../src/core/inventoryEngine.js';
import { BillingEngine } from '../../src/core/billingEngine.js';
import { AnalyticsService } from '../../src/core/analyticsService.js';

describe('AnalyticsService Unit Tests', () => {
  let tempDir;
  let store;
  let inventory;
  let billing;
  let analytics;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockpulse-analytics-test-'));
    store = new DataStore(tempDir);
    await store.init();
    inventory = new InventoryEngine(store);
    billing = new BillingEngine(store, inventory);
    analytics = new AnalyticsService(store, inventory);
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('calculates dashboard KPIs including inventory value, revenue, and gross profit', async () => {
    const sku = await inventory.createSku({
      skuCode: 'ANALYTICS-SKU-1',
      name: 'High Margin Item',
      sellingPrice: 1000,
      taxRate: 18
    });

    await inventory.receiveStock({
      skuId: sku.id,
      quantity: 50,
      unitCostPrice: 600,
      receivedDate: '2026-01-01T00:00:00.000Z'
    });

    // Create an invoice selling 10 units:
    // Taxable revenue: 10,000, COGS: 6,000, Profit: 4,000 (40% margin)
    await billing.createInvoice({
      customerName: 'Enterprise Client',
      customerStateCode: '27',
      items: [{ skuId: sku.id, quantity: 10, unitPrice: 1000 }]
    });

    const kpis = analytics.getDashboardKpis();

    assert.strictEqual(kpis.activeSkuCount, 1);
    assert.strictEqual(kpis.totalInventoryValue, 24000); // 40 remaining * 600
    assert.strictEqual(kpis.totalRevenue, 10000);
    assert.strictEqual(kpis.totalCogs, 6000);
    assert.strictEqual(kpis.grossProfit, 4000);
    assert.strictEqual(kpis.grossMarginPercentage, 40);
  });

  it('computes inventory turnover ratio and days sales of inventory', async () => {
    const sku = await inventory.createSku({
      skuCode: 'TURNOVER-SKU',
      name: 'Turnover Test SKU',
      sellingPrice: 200
    });

    await inventory.receiveStock({
      skuId: sku.id,
      quantity: 100,
      unitCostPrice: 100,
      receivedDate: '2026-01-01T00:00:00.000Z'
    });

    await billing.createInvoice({
      customerName: 'Retail Buyer',
      customerStateCode: '27',
      items: [{ skuId: sku.id, quantity: 20, unitPrice: 200 }]
    });

    const turnover = analytics.calculateInventoryTurnover();
    // COGS = 2,000. Ending inventory = 80 * 100 = 8,000. Turnover = 2000 / 8000 = 0.25
    assert.strictEqual(turnover.cogs, 2000);
    assert.strictEqual(turnover.currentInventoryValue, 8000);
    assert.strictEqual(turnover.turnoverRatio, 0.25);
    assert.ok(turnover.daysSalesOfInventory > 0);
  });

  it('formats tabular data into RFC 4180 compliant CSV strings', () => {
    const raw = [
      { id: 1, name: 'Normal Item', price: 100 },
      { id: 2, name: 'Item with, comma', price: 200 },
      { id: 3, name: 'Item with "quotes"', price: 300 }
    ];

    const csv = analytics.formatAsCsv(raw);
    const lines = csv.split('\n');

    assert.strictEqual(lines[0], 'id,name,price');
    assert.strictEqual(lines[1], '1,Normal Item,100');
    assert.strictEqual(lines[2], '2,"Item with, comma",200');
    assert.strictEqual(lines[3], '3,"Item with ""quotes""",300');
  });

  it('exports inventory CSV with active stock levels and tax rates', async () => {
    await inventory.createSku({
      skuCode: 'EXPORT-CSV-1',
      name: 'Exportable Widget',
      category: 'General',
      unit: 'PCS',
      sellingPrice: 50,
      taxRate: 12
    });

    const csv = analytics.exportInventoryCsv();
    assert.ok(csv.includes('skuCode,name,category,unit,hsnCode,sellingPrice,taxRate,availableQuantity,reorderPoint,leadTimeDays'));
    assert.ok(csv.includes('EXPORT-CSV-1'));
    assert.ok(csv.includes('Exportable Widget'));
  });
});
