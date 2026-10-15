import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DataStore } from '../../src/storage/dataStore.js';
import { InventoryEngine } from '../../src/core/inventoryEngine.js';
import { SupplierManager } from '../../src/core/supplierManager.js';
import { PO_STATUS } from '../../src/config/constants.js';
import { InvalidStateTransitionError, ValidationError } from '../../src/core/errors.js';

describe('SupplierManager & Purchase Order Unit Tests', () => {
  let tempDir;
  let store;
  let inventory;
  let supplierMgr;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockpulse-supp-test-'));
    store = new DataStore(tempDir);
    await store.init();
    inventory = new InventoryEngine(store);
    supplierMgr = new SupplierManager(store, inventory);
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a supplier profile with valid GST details', async () => {
    const supplier = await supplierMgr.createSupplier({
      name: 'Apex Raw Materials Ltd',
      gstin: '27AAAAA0000A1Z5',
      stateCode: '27',
      leadTimeDays: 10,
      paymentTermsDays: 30
    });

    assert.ok(supplier.id);
    assert.strictEqual(supplier.name, 'Apex Raw Materials Ltd');
    assert.strictEqual(supplier.stateCode, '27');
    assert.strictEqual(supplier.leadTimeDays, 10);
  });

  it('creates a Purchase Order in DRAFT state with line items and numbering', async () => {
    const supplier = await supplierMgr.createSupplier({
      name: 'Global Metals Corp',
      stateCode: '27'
    });

    const sku = await inventory.createSku({
      skuCode: 'COPPER-WIRE',
      name: 'Pure Copper Wire 2mm',
      unit: 'KG',
      sellingPrice: 700,
      taxRate: 18
    });

    const po = await supplierMgr.createPurchaseOrder({
      supplierId: supplier.id,
      items: [
        {
          skuId: sku.id,
          orderedQuantity: 100,
          unitCostPrice: 450
        }
      ]
    });

    assert.ok(po.poNumber.startsWith('PO-'));
    assert.strictEqual(po.status, PO_STATUS.DRAFT);
    assert.strictEqual(po.subtotal, 45000);
    assert.strictEqual(po.items[0].receivedQuantity, 0);
  });

  it('enforces PO state machine transitions and rejects invalid jumps', async () => {
    const supplier = await supplierMgr.createSupplier({ name: 'Alpha Traders' });
    const sku = await inventory.createSku({ skuCode: 'TOOL-X', name: 'Precision Tool', sellingPrice: 50 });

    const po = await supplierMgr.createPurchaseOrder({
      supplierId: supplier.id,
      items: [{ skuId: sku.id, orderedQuantity: 10, unitCostPrice: 30 }]
    });

    // Attempt invalid jump: DRAFT -> FULFILLED directly (must go through ISSUED)
    await assert.rejects(
      async () => {
        await supplierMgr.updatePurchaseOrderStatus(po.id, PO_STATUS.FULFILLED);
      },
      (err) => err instanceof InvalidStateTransitionError
    );

    // Valid transition: DRAFT -> ISSUED
    const issued = await supplierMgr.updatePurchaseOrderStatus(po.id, PO_STATUS.ISSUED);
    assert.strictEqual(issued.status, PO_STATUS.ISSUED);
  });

  it('handles partial PO fulfillment math and creates active inventory lots', async () => {
    const supplier = await supplierMgr.createSupplier({ name: 'Beta Logistics' });
    const sku = await inventory.createSku({ skuCode: 'PIPE-PVC', name: 'PVC Pipe 3m', sellingPrice: 150 });

    const po = await supplierMgr.createPurchaseOrder({
      supplierId: supplier.id,
      items: [{ skuId: sku.id, orderedQuantity: 50, unitCostPrice: 90 }]
    });

    await supplierMgr.updatePurchaseOrderStatus(po.id, PO_STATUS.ISSUED);

    // Partial receipt of 30 units
    const updatedPo = await supplierMgr.receivePoShipment(po.id, [
      { skuId: sku.id, quantityReceived: 30 }
    ]);

    assert.strictEqual(updatedPo.status, PO_STATUS.PARTIALLY_RECEIVED);
    assert.strictEqual(updatedPo.items[0].receivedQuantity, 30);

    // Verify 30 units were added to inventory
    const stock = inventory.getStockLevel(sku.id);
    assert.strictEqual(stock.totalAvailable, 30);

    // Second shipment of remaining 20 units -> Should complete PO to FULFILLED
    const completedPo = await supplierMgr.receivePoShipment(po.id, [
      { skuId: sku.id, quantityReceived: 20 }
    ]);

    assert.strictEqual(completedPo.status, PO_STATUS.FULFILLED);
    assert.strictEqual(completedPo.items[0].receivedQuantity, 50);

    // Verify total stock is now 50
    const finalStock = inventory.getStockLevel(sku.id);
    assert.strictEqual(finalStock.totalAvailable, 50);
  });

  it('rejects shipment receipt exceeding ordered quantity', async () => {
    const supplier = await supplierMgr.createSupplier({ name: 'Gamma Supplies' });
    const sku = await inventory.createSku({ skuCode: 'FILTER-AIR', name: 'Air Filter', sellingPrice: 300 });

    const po = await supplierMgr.createPurchaseOrder({
      supplierId: supplier.id,
      items: [{ skuId: sku.id, orderedQuantity: 10, unitCostPrice: 180 }]
    });

    await supplierMgr.updatePurchaseOrderStatus(po.id, PO_STATUS.ISSUED);

    await assert.rejects(
      async () => {
        await supplierMgr.receivePoShipment(po.id, [{ skuId: sku.id, quantityReceived: 15 }]);
      },
      (err) => err instanceof ValidationError
    );
  });

  it('generates accounts payable aging report categorized into time brackets', async () => {
    const supplier = await supplierMgr.createSupplier({ name: 'Delta Manufacturing' });
    const sku = await inventory.createSku({ skuCode: 'BEARING-1', name: 'Ball Bearing', sellingPrice: 200 });

    // Create and fulfill order 45 days ago (should fall into 31-60 days bucket)
    const orderDate45DaysAgo = new Date(Date.now() - (45 * 24 * 60 * 60 * 1000)).toISOString();
    const po = await supplierMgr.createPurchaseOrder({
      supplierId: supplier.id,
      orderDate: orderDate45DaysAgo,
      items: [{ skuId: sku.id, orderedQuantity: 10, unitCostPrice: 100 }]
    });

    await supplierMgr.updatePurchaseOrderStatus(po.id, PO_STATUS.ISSUED);
    await supplierMgr.receivePoShipment(po.id, [{ skuId: sku.id, quantityReceived: 10 }]);

    const aging = supplierMgr.getPayableAgingReport();

    assert.ok(aging.summary.totalPayable > 0);
    assert.ok(aging.summary.days31to60 > 0);
    assert.strictEqual(aging.supplierBreakdown.length, 1);
    assert.strictEqual(aging.supplierBreakdown[0].supplierId, supplier.id);
  });
});
