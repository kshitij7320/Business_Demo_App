import { COLLECTIONS, GST_SLABS, INVOICE_STATUS, VALUATION_METHODS } from '../config/constants.js';
import { env } from '../config/env.js';
import { NotFoundError, ValidationError } from './errors.js';

/**
 * GST Billing, Tax Calculation, and Invoicing Engine.
 * Implements Indian GST statutory logic (intra-state CGST+SGST vs inter-state IGST),
 * multi-slab tax breakdowns, automated invoice sequencing, and credit note reversals.
 */
export class BillingEngine {
  /**
   * @param {import('../storage/dataStore.js').DataStore} dataStore
   * @param {import('./inventoryEngine.js').InventoryEngine} inventoryEngine
   */
  constructor(dataStore, inventoryEngine) {
    this.store = dataStore;
    this.inventory = inventoryEngine;
  }

  /**
   * Helper to round monetary amounts to exactly 2 decimal places.
   * Resolves floating-point precision issues in tax arithmetic.
   * @param {number} num
   * @returns {number}
   */
  static round2(num) {
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  /**
   * Computes statutory GST line-item math and tax slab aggregations.
   * @param {Array<{
   *   skuId: string,
   *   skuCode: string,
   *   name: string,
   *   hsnCode: string,
   *   quantity: number,
   *   unitPrice: number,
   *   taxRate: number,
   *   discountPercent?: number
   * }>} rawItems
   * @param {string} destinationStateCode 2-digit GST state code
   * @returns {{
   *   items: Array<object>,
   *   subtotal: number,
   *   discountTotal: number,
   *   taxableTotal: number,
   *   cgstTotal: number,
   *   sgstTotal: number,
   *   igstTotal: number,
   *   taxBreakdown: Record<number, { taxable: number, cgst: number, sgst: number, igst: number }>,
   *   roundOff: number,
   *   finalAmount: number,
   *   isIntraState: boolean
   * }}
   */
  calculateTaxes(rawItems, destinationStateCode) {
    const originState = String(env.COMPANY_STATE_CODE).padStart(2, '0');
    const destState = String(destinationStateCode).padStart(2, '0');
    // Intra-state when origin and destination match; otherwise inter-state
    const isIntraState = originState === destState;

    let subtotal = 0;
    let discountTotal = 0;
    let taxableTotal = 0;
    let cgstTotal = 0;
    let sgstTotal = 0;
    let igstTotal = 0;

    const taxBreakdown = {};
    for (const slab of GST_SLABS) {
      taxBreakdown[slab] = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    }

    const computedItems = rawItems.map(item => {
      const qty = Number(item.quantity);
      const unitPrice = Number(item.unitPrice);
      const discountPct = Math.min(100, Math.max(0, Number(item.discountPercent) || 0));
      const taxRate = GST_SLABS.includes(Number(item.taxRate)) ? Number(item.taxRate) : 18;

      const grossAmount = BillingEngine.round2(qty * unitPrice);
      const discountAmount = BillingEngine.round2(grossAmount * (discountPct / 100));
      const taxableAmount = BillingEngine.round2(grossAmount - discountAmount);

      let cgstRate = 0;
      let sgstRate = 0;
      let igstRate = 0;
      let cgstAmount = 0;
      let sgstAmount = 0;
      let igstAmount = 0;

      if (isIntraState) {
        // CGST + SGST split equally
        cgstRate = taxRate / 2;
        sgstRate = taxRate / 2;
        cgstAmount = BillingEngine.round2(taxableAmount * (cgstRate / 100));
        sgstAmount = BillingEngine.round2(taxableAmount * (sgstRate / 100));
      } else {
        // IGST applied on entire taxable value
        igstRate = taxRate;
        igstAmount = BillingEngine.round2(taxableAmount * (igstRate / 100));
      }

      const lineTotal = BillingEngine.round2(taxableAmount + cgstAmount + sgstAmount + igstAmount);

      subtotal += grossAmount;
      discountTotal += discountAmount;
      taxableTotal += taxableAmount;
      cgstTotal += cgstAmount;
      sgstTotal += sgstAmount;
      igstTotal += igstAmount;

      if (!taxBreakdown[taxRate]) {
        taxBreakdown[taxRate] = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      }
      taxBreakdown[taxRate].taxable = BillingEngine.round2(taxBreakdown[taxRate].taxable + taxableAmount);
      taxBreakdown[taxRate].cgst = BillingEngine.round2(taxBreakdown[taxRate].cgst + cgstAmount);
      taxBreakdown[taxRate].sgst = BillingEngine.round2(taxBreakdown[taxRate].sgst + sgstAmount);
      taxBreakdown[taxRate].igst = BillingEngine.round2(taxBreakdown[taxRate].igst + igstAmount);

      return {
        skuId: item.skuId,
        skuCode: item.skuCode,
        name: item.name,
        hsnCode: item.hsnCode || '9999',
        quantity: qty,
        unitPrice,
        discountPercent: discountPct,
        discountAmount,
        grossAmount,
        taxableAmount,
        taxRate,
        cgstRate,
        sgstRate,
        igstRate,
        cgstAmount,
        sgstAmount,
        igstAmount,
        totalAmount: lineTotal
      };
    });

    subtotal = BillingEngine.round2(subtotal);
    discountTotal = BillingEngine.round2(discountTotal);
    taxableTotal = BillingEngine.round2(taxableTotal);
    cgstTotal = BillingEngine.round2(cgstTotal);
    sgstTotal = BillingEngine.round2(sgstTotal);
    igstTotal = BillingEngine.round2(igstTotal);

    const unroundedTotal = taxableTotal + cgstTotal + sgstTotal + igstTotal;
    const finalAmount = Math.round(unroundedTotal);
    const roundOff = BillingEngine.round2(finalAmount - unroundedTotal);

    return {
      items: computedItems,
      subtotal,
      discountTotal,
      taxableTotal,
      cgstTotal,
      sgstTotal,
      igstTotal,
      taxBreakdown,
      roundOff,
      finalAmount,
      isIntraState
    };
  }

  /**
   * Creates and commits a new tax invoice with inventory stock depletion.
   * @param {object} invoiceInput
   * @returns {Promise<object>}
   */
  async createInvoice(invoiceInput) {
    if (!invoiceInput.customerName?.trim()) {
      throw new ValidationError('Customer name is required');
    }

    const customerState = String(invoiceInput.customerStateCode || env.COMPANY_STATE_CODE).padStart(2, '0');
    if (!/^\d{2}$/.test(customerState)) {
      throw new ValidationError('customerStateCode must be a 2-digit GST state code');
    }

    if (!Array.isArray(invoiceInput.items) || invoiceInput.items.length === 0) {
      throw new ValidationError('Invoice must contain at least one line item');
    }

    const valuationMethod = invoiceInput.valuationMethod || VALUATION_METHODS.FIFO;

    // Validate SKUs and build enriched line items
    const rawItems = [];
    for (const item of invoiceInput.items) {
      const sku = this.store.findById(COLLECTIONS.SKUS, item.skuId);
      if (!sku) {
        throw new NotFoundError('SKU', item.skuId);
      }

      const qty = Number(item.quantity);
      if (qty <= 0 || Number.isNaN(qty)) {
        throw new ValidationError(`Quantity for SKU ${sku.skuCode} must be greater than zero`);
      }

      const unitPrice = item.unitPrice !== undefined ? Number(item.unitPrice) : sku.sellingPrice;
      if (unitPrice < 0 || Number.isNaN(unitPrice)) {
        throw new ValidationError(`Unit price for SKU ${sku.skuCode} cannot be negative`);
      }

      rawItems.push({
        skuId: sku.id,
        skuCode: sku.skuCode,
        name: sku.name,
        hsnCode: sku.hsnCode,
        quantity: qty,
        unitPrice,
        taxRate: item.taxRate !== undefined ? Number(item.taxRate) : sku.taxRate,
        discountPercent: Number(item.discountPercent) || 0
      });
    }

    const taxCalc = this.calculateTaxes(rawItems, customerState);

    const year = new Date().getFullYear();
    const seq = await this.store.getNextSequence(`inv_${year}`);
    const invoiceNumber = `INV-${year}-${String(seq).padStart(5, '0')}`;

    // Execute atomic depletion and invoice creation
    return this.store.transaction(async (tx) => {
      let totalCogs = 0;
      const enrichedItems = [];

      for (const item of taxCalc.items) {
        // Deplete stock from inventory
        const depletionResult = await this.inventory.depleteStock(
          item.skuId,
          item.quantity,
          valuationMethod,
          { referenceType: 'INVOICE', referenceId: invoiceNumber }
        );

        totalCogs += depletionResult.cogs;
        enrichedItems.push({
          ...item,
          cogs: depletionResult.cogs,
          averageUnitCost: depletionResult.averageUnitCost,
          batchAllocations: depletionResult.allocations
        });
      }

      const invoiceRecord = {
        invoiceNumber,
        invoiceDate: invoiceInput.invoiceDate || new Date().toISOString(),
        customerName: invoiceInput.customerName.trim(),
        customerGstin: invoiceInput.customerGstin?.trim() || null,
        customerStateCode: customerState,
        placeOfSupply: invoiceInput.placeOfSupply || customerState,
        isIntraState: taxCalc.isIntraState,
        items: enrichedItems,
        subtotal: taxCalc.subtotal,
        discountAmount: taxCalc.discountTotal,
        taxableAmount: taxCalc.taxableTotal,
        cgstAmount: taxCalc.cgstTotal,
        sgstAmount: taxCalc.sgstTotal,
        igstAmount: taxCalc.igstTotal,
        taxBreakdown: taxCalc.taxBreakdown,
        roundOffAmount: taxCalc.roundOff,
        totalAmount: taxCalc.finalAmount,
        totalCogs: BillingEngine.round2(totalCogs),
        grossProfit: BillingEngine.round2(taxCalc.taxableTotal - totalCogs),
        status: invoiceInput.status || INVOICE_STATUS.PAID,
        valuationMethod,
        notes: invoiceInput.notes || ''
      };

      return tx.insert(COLLECTIONS.INVOICES, invoiceRecord);
    });
  }

  /**
   * Generates a Credit Note reversing specific items from an invoice and restoring inventory.
   * @param {object} creditNoteInput
   * @returns {Promise<object>}
   */
  async createCreditNote(creditNoteInput) {
    const invoice = this.store.findById(COLLECTIONS.INVOICES, creditNoteInput.invoiceId);
    if (!invoice) {
      throw new NotFoundError('Invoice', creditNoteInput.invoiceId);
    }

    if (!Array.isArray(creditNoteInput.items) || creditNoteInput.items.length === 0) {
      throw new ValidationError('Credit note must specify at least one return item');
    }

    const returnMap = new Map();
    for (const ret of creditNoteInput.items) {
      const qty = Number(ret.quantity);
      if (qty <= 0 || Number.isNaN(qty)) {
        throw new ValidationError(`Return quantity must be positive for SKU ${ret.skuId}`);
      }
      returnMap.set(ret.skuId, ret);
    }

    const year = new Date().getFullYear();
    const seq = await this.store.getNextSequence(`cn_${year}`);
    const creditNoteNumber = `CN-${year}-${String(seq).padStart(5, '0')}`;

    return this.store.transaction(async (tx) => {
      const itemsToReverse = [];

      for (const origItem of invoice.items) {
        const retSpec = returnMap.get(origItem.skuId);
        if (retSpec) {
          const retQty = Number(retSpec.quantity);
          if (retQty > origItem.quantity) {
            throw new ValidationError(
              `Return quantity (${retQty}) cannot exceed invoiced quantity (${origItem.quantity}) for ${origItem.skuCode}`
            );
          }

          itemsToReverse.push({
            skuId: origItem.skuId,
            skuCode: origItem.skuCode,
            name: origItem.name,
            hsnCode: origItem.hsnCode,
            quantity: retQty,
            unitPrice: origItem.unitPrice,
            taxRate: origItem.taxRate,
            discountPercent: origItem.discountPercent,
            preferredBatchId: retSpec.preferredBatchId || origItem.batchAllocations?.[0]?.batchId
          });
        }
      }

      if (itemsToReverse.length === 0) {
        throw new ValidationError('No matching items found for return in specified invoice');
      }

      const reverseTax = this.calculateTaxes(itemsToReverse, invoice.customerStateCode);

      // Restore stock back into inventory engine
      for (const retItem of itemsToReverse) {
        await this.inventory.restoreStock(
          retItem.skuId,
          retItem.quantity,
          retItem.preferredBatchId,
          { referenceType: 'CREDIT_NOTE', referenceId: creditNoteNumber }
        );
      }

      const creditNoteRecord = {
        creditNoteNumber,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        issueDate: creditNoteInput.issueDate || new Date().toISOString(),
        customerName: invoice.customerName,
        customerStateCode: invoice.customerStateCode,
        reason: creditNoteInput.reason || 'Goods returned by customer',
        items: reverseTax.items,
        subtotal: reverseTax.subtotal,
        discountAmount: reverseTax.discountTotal,
        taxableAmount: reverseTax.taxableTotal,
        cgstAmount: reverseTax.cgstTotal,
        sgstAmount: reverseTax.sgstTotal,
        igstAmount: reverseTax.igstTotal,
        roundOffAmount: reverseTax.roundOff,
        totalAmount: reverseTax.finalAmount
      };

      return tx.insert(COLLECTIONS.CREDIT_NOTES, creditNoteRecord);
    });
  }
}
