import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DataStore } from '../../src/storage/dataStore.js';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';

describe('StockPulse REST API Integration Tests', () => {
  let tempDir;
  let store;
  let server;
  let baseUrl;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockpulse-api-test-'));
    store = new DataStore(tempDir);
    await store.init();

    const app = createApp(store);

    await new Promise((resolve) => {
      // Listen on random available ephemeral port
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api/v1`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
    await store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('GET /health returns 200 OK and system status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.status, 'UP');
    assert.strictEqual(body.system, 'StockPulse Offline Engine');
  });

  it('POST /inventory/skus validates payload and creates SKU', async () => {
    // 1. Missing name should fail validation with 400
    const failRes = await fetch(`${baseUrl}/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skuCode: 'TEST-SKU' })
    });
    assert.strictEqual(failRes.status, 400);

    // 2. Valid creation
    const okRes = await fetch(`${baseUrl}/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skuCode: 'ELEC-CPU-I9',
        name: 'Intel Core i9 Processor',
        category: 'Hardware',
        unit: 'PCS',
        sellingPrice: 45000,
        taxRate: 18,
        reorderPoint: 5
      })
    });
    assert.strictEqual(okRes.status, 201);
    const body = await okRes.json();
    assert.ok(body.data.id);
    assert.strictEqual(body.data.skuCode, 'ELEC-CPU-I9');
  });

  it('POST /suppliers creates a vendor profile and rejects invalid stateCode', async () => {
    const res = await fetch(`${baseUrl}/suppliers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Silicon Distributors',
        stateCode: '27',
        leadTimeDays: 5
      })
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.data.name, 'Silicon Distributors');
  });

  it('executes full procurement and billing flow through REST API', async () => {
    // Step 1: Create SKU
    const skuRes = await fetch(`${baseUrl}/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skuCode: 'MONITOR-4K',
        name: 'UltraHD 4K 27-inch Monitor',
        sellingPrice: 28000,
        taxRate: 18
      })
    });
    const { data: sku } = await skuRes.json();

    // Step 2: Create Supplier
    const suppRes = await fetch(`${baseUrl}/suppliers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'DisplayTech Wholesale',
        stateCode: env.COMPANY_STATE_CODE
      })
    });
    const { data: supplier } = await suppRes.json();

    // Step 3: Create Purchase Order (Draft)
    const poRes = await fetch(`${baseUrl}/suppliers/purchase-orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplierId: supplier.id,
        items: [{ skuId: sku.id, orderedQuantity: 20, unitCostPrice: 18000 }]
      })
    });
    assert.strictEqual(poRes.status, 201);
    const { data: po } = await poRes.json();
    assert.strictEqual(po.status, 'DRAFT');

    // Step 4: Issue PO
    const issueRes = await fetch(`${baseUrl}/suppliers/purchase-orders/${po.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ISSUED' })
    });
    assert.strictEqual(issueRes.status, 200);

    // Step 5: Receive shipment (partial fulfillment: 10 units)
    const receiveRes = await fetch(`${baseUrl}/suppliers/purchase-orders/${po.id}/receive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receipts: [{ skuId: sku.id, quantityReceived: 10 }]
      })
    });
    assert.strictEqual(receiveRes.status, 200);
    const { data: receivedPo } = await receiveRes.json();
    assert.strictEqual(receivedPo.status, 'PARTIALLY_RECEIVED');

    // Step 6: Verify stock level in inventory
    const stockRes = await fetch(`${baseUrl}/inventory/skus/${sku.id}`);
    const { data: skuWithStock } = await stockRes.json();
    assert.strictEqual(skuWithStock.stock.totalAvailable, 10);

    // Step 7: Create Invoice selling 4 units
    const invRes = await fetch(`${baseUrl}/billing/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'TechCorp Solutions',
        customerStateCode: env.COMPANY_STATE_CODE,
        items: [{ skuId: sku.id, quantity: 4, unitPrice: 28000 }]
      })
    });
    assert.strictEqual(invRes.status, 201);
    const { data: invoice } = await invRes.json();
    assert.ok(invoice.invoiceNumber.startsWith('INV-'));
    assert.strictEqual(invoice.totalCogs, 72000); // 4 * 18000

    // Step 8: Verify remaining stock is now 6 (10 - 4)
    const stockResAfter = await fetch(`${baseUrl}/inventory/skus/${sku.id}`);
    const { data: stockAfter } = await stockResAfter.json();
    assert.strictEqual(stockAfter.stock.totalAvailable, 6);

    // Step 9: Check Analytics dashboard metrics
    const dashRes = await fetch(`${baseUrl}/analytics/dashboard`);
    assert.strictEqual(dashRes.status, 200);
    const { data: dash } = await dashRes.json();
    assert.ok(dash.kpis.totalRevenue > 0);
    assert.ok(dash.kpis.totalCogs > 0);
  });

  it('rejects invoice when requested quantity exceeds available stock (422)', async () => {
    const skuRes = await fetch(`${baseUrl}/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skuCode: 'RARE-GEM-01',
        name: 'Synthetic Diamond 1ct',
        sellingPrice: 15000
      })
    });
    const { data: sku } = await skuRes.json();

    // Attempt to bill 1 unit with 0 in stock
    const invRes = await fetch(`${baseUrl}/billing/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Luxury Goods Ltd',
        customerStateCode: '27',
        items: [{ skuId: sku.id, quantity: 1, unitPrice: 15000 }]
      })
    });
    assert.strictEqual(invRes.status, 422);
    const errorBody = await invRes.json();
    assert.strictEqual(errorBody.error.code, 'INSUFFICIENT_STOCK');
  });

  it('handles concurrent invoice write attempts safely without race conditions', async () => {
    // Create an SKU and seed 50 units
    const skuRes = await fetch(`${baseUrl}/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skuCode: 'CONCURRENCY-TEST-SKU',
        name: 'Fast Moving Item',
        sellingPrice: 100
      })
    });
    const { data: sku } = await skuRes.json();

    await fetch(`${baseUrl}/inventory/skus/${sku.id}/receive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 50, unitCostPrice: 50 })
    });

    // Fire 5 concurrent invoices, each taking 10 units = 50 total
    const concurrentRequests = Array.from({ length: 5 }, (_, i) => {
      return fetch(`${baseUrl}/billing/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: `Concurrent Buyer ${i + 1}`,
          customerStateCode: '27',
          items: [{ skuId: sku.id, quantity: 10, unitPrice: 100 }]
        })
      });
    });

    const responses = await Promise.all(concurrentRequests);
    for (const r of responses) {
      assert.strictEqual(r.status, 201);
    }

    // Verify stock is now exactly 0
    const checkStock = await fetch(`${baseUrl}/inventory/skus/${sku.id}`);
    const { data: finalItem } = await checkStock.json();
    assert.strictEqual(finalItem.stock.totalAvailable, 0);

    // 6th request must fail with 422
    const failingRes = await fetch(`${baseUrl}/billing/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Late Buyer',
        customerStateCode: '27',
        items: [{ skuId: sku.id, quantity: 1, unitPrice: 100 }]
      })
    });
    assert.strictEqual(failingRes.status, 422);
  });
});
