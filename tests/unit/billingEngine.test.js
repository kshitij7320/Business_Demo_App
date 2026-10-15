import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DataStore } from '../../src/storage/dataStore.js';
import { InventoryEngine } from '../../src/core/inventoryEngine.js';
import { BillingEngine } from '../../src/core/billingEngine.js';
import { env } from '../../src/config/env.js';
import { VALUATION_METHODS } from '../../src/config/constants.js';
import { ValidationError } from '../../src/core/errors.js';

describe('BillingEngine & GST Unit Tests', () => {
  let tempDir;
  let store;
  let inventory;
  let billing;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockpulse-bill-test-'));
    store = new DataStore(tempDir);
    await store.init();
    inventory = new InventoryEngine(store);
    billing = new BillingEngine(store, inventory);
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('calculates intra-state GST with equal CGST and SGST split', () => {
    // Intra-state: destinationStateCode equals COMPANY_STATE_CODE
    const items = [
      {
        skuId: 'sku-1',
        skuCode: 'ITEM-A',
        name: 'Item A',
        quantity: 2,
        unitPrice: 1000,
        taxRate: 18,
        discountPercent: 10 // 10% off: 2000 - 200 = 1800 taxable
      }
    ];

    const result = billing.calculateTaxes(items, env.COMPANY_STATE_CODE);

    assert.strictEqual(result.isIntraState, true);
    assert.strictEqual(result.subtotal, 2000);
    assert.strictEqual(result.discountTotal, 200);
    assert.strictEqual(result.taxableTotal, 1800);
    // 18% GST -> 9% CGST (162) + 9% SGST (162)
    assert.strictEqual(result.cgstTotal, 162);
    assert.strictEqual(result.sgstTotal, 162);
    assert.strictEqual(result.igstTotal, 0);
    assert.strictEqual(result.finalAmount, 2124);
  });

  it('calculates inter-state GST with IGST only', () => {
    // Inter-state: destinationStateCode differs from COMPANY_STATE_CODE
    const otherState = env.COMPANY_STATE_CODE === '27' ? '07' : '27';
    const items = [
      {
        skuId: 'sku-2',
        skuCode: 'ITEM-B',
        name: 'Item B',
        quantity: 1,
        unitPrice: 500,
        taxRate: 12,
        discountPercent: 0
      }
    ];

    const result = billing.calculateTaxes(items, otherState);

    assert.strictEqual(result.isIntraState, false);
    assert.strictEqual(result.taxableTotal, 500);
    assert.strictEqual(result.cgstTotal, 0);
    assert.strictEqual(result.sgstTotal, 0);
    // 12% IGST on 500 = 60
    assert.strictEqual(result.igstTotal, 60);
    assert.strictEqual(result.finalAmount, 560);
  });

  it('aggregates multiple tax slabs accurately in a single multi-item bill', () => {
    const items = [
      { skuId: 's1', skuCode: 'A', name: '5% Item', quantity: 1, unitPrice: 100, taxRate: 5 },
      { skuId: 's2', skuCode: 'B', name: '12% Item', quantity: 1, unitPrice: 200, taxRate: 12 },
      { skuId: 's3', skuCode: 'C', name: '18% Item', quantity: 1, unitPrice: 300, taxRate: 18 },
      { skuId: 's4', skuCode: 'D', name: '28% Item', quantity: 1, unitPrice: 400, taxRate: 28 }
    ];

    const result = billing.calculateTaxes(items, env.COMPANY_STATE_CODE);

    // Intra-state breakdown:
    // 5% slab: 100 taxable -> 2.50 CGST + 2.50 SGST
    // 12% slab: 200 taxable -> 12.00 CGST + 12.00 SGST
    // 18% slab: 300 taxable -> 27.00 CGST + 27.00 SGST
    // 28% slab: 400 taxable -> 56.00 CGST + 56.00 SGST
    assert.strictEqual(result.taxBreakdown[5].taxable, 100);
    assert.strictEqual(result.taxBreakdown[5].cgst, 2.5);
    assert.strictEqual(result.taxBreakdown[12].taxable, 200);
    assert.strictEqual(result.taxBreakdown[12].cgst, 12);
    assert.strictEqual(result.taxBreakdown[18].taxable, 300);
    assert.strictEqual(result.taxBreakdown[18].cgst, 27);
    assert.strictEqual(result.taxBreakdown[28].taxable, 400);
    assert.strictEqual(result.taxBreakdown[28].cgst, 56);

    const expectedCgst = 2.5 + 12 + 27 + 56; // 97.5
    assert.strictEqual(result.cgstTotal, 97.5);
    assert.strictEqual(result.sgstTotal, 97.5);
    assert.strictEqual(result.finalAmount, 1000 + 195); // 1195
  });

  it('computes round-off adjustments for fractional currency totals', () => {
    // 3 items @ 33.33 each with 18% tax -> 99.99 * 1.18 = 117.9882 -> rounds to 118 with +0.01 round-off
    const items = [
      { skuId: 's1', skuCode: 'X', name: 'Fractional', quantity: 3, unitPrice: 33.33, taxRate: 18 }
    ];
    const result = billing.calculateTaxes(items, env.COMPANY_STATE_CODE);

    assert.strictEqual(typeof result.roundOff, 'number');
    assert.strictEqual(result.finalAmount, Math.round(result.taxableTotal + result.cgstTotal + result.sgstTotal));
  });

  it('creates an invoice, depletes inventory atomically, and tracks COGS', async () => {
    const sku = await inventory.createSku({
      skuCode: 'HARDWARE-BOLT',
      name: 'Titanium Bolt M8',
      unit: 'PCS',
      sellingPrice: 100,
      taxRate: 18
    });

    await inventory.receiveStock({
      skuId: sku.id,
      quantity: 50,
      unitCostPrice: 60,
      receivedDate: '2026-01-01T00:00:00.000Z'
    });

    const invoice = await billing.createInvoice({
      customerName: 'Acme Constructions',
      customerGstin: '27AABCA1234A1Z1',
      customerStateCode: env.COMPANY_STATE_CODE,
      items: [
        {
          skuId: sku.id,
          quantity: 10,
          unitPrice: 100,
          taxRate: 18
        }
      ],
      valuationMethod: VALUATION_METHODS.FIFO
    });

    assert.ok(invoice.invoiceNumber.startsWith('INV-'));
    assert.strictEqual(invoice.totalAmount, 1180); // 1000 + 18% GST (90 + 90)
    assert.strictEqual(invoice.totalCogs, 600); // 10 * 60
    assert.strictEqual(invoice.grossProfit, 400); // 1000 - 600

    // Verify stock was reduced from 50 to 40
    const stockAfter = inventory.getStockLevel(sku.id);
    assert.strictEqual(stockAfter.totalAvailable, 40);
  });

  it('issues a credit note, reverses GST, and restores stock', async () => {
    const sku = await inventory.createSku({
      skuCode: 'VALVE-2INCH',
      name: 'Ball Valve 2-Inch',
      unit: 'PCS',
      sellingPrice: 200,
      taxRate: 18
    });

    await inventory.receiveStock({
      skuId: sku.id,
      quantity: 20,
      unitCostPrice: 120,
      receivedDate: '2026-01-01T00:00:00.000Z'
    });

    const invoice = await billing.createInvoice({
      customerName: 'Industrial Utilities Ltd',
      customerStateCode: env.COMPANY_STATE_CODE,
      items: [{ skuId: sku.id, quantity: 5, unitPrice: 200, taxRate: 18 }]
    });

    assert.strictEqual(inventory.getStockLevel(sku.id).totalAvailable, 15);

    // Customer returns 2 units
    const creditNote = await billing.createCreditNote({
      invoiceId: invoice.id,
      reason: 'Excess quantity ordered by client',
      items: [{ skuId: sku.id, quantity: 2 }]
    });

    assert.ok(creditNote.creditNoteNumber.startsWith('CN-'));
    assert.strictEqual(creditNote.taxableAmount, 400);
    assert.strictEqual(creditNote.cgstAmount, 36);
    assert.strictEqual(creditNote.sgstAmount, 36);
    assert.strictEqual(creditNote.totalAmount, 472);

    // Stock should be restored to 17 (15 + 2)
    assert.strictEqual(inventory.getStockLevel(sku.id).totalAvailable, 17);
  });
});
