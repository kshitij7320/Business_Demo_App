import { COLLECTIONS, PO_STATUS, PO_TRANSITIONS } from '../config/constants.js';
import { env } from '../config/env.js';
import { InvalidStateTransitionError, NotFoundError, ValidationError } from './errors.js';

/**
 * Supplier and Purchase Order Lifecycle Manager.
 * Governs vendor profiles, PO state transitions, partial fulfillments,
 * lead-time analytics, and accounts payable aging.
 */
export class SupplierManager {
  /**
   * @param {import('../storage/dataStore.js').DataStore} dataStore
   * @param {import('./inventoryEngine.js').InventoryEngine} inventoryEngine
   */
  constructor(dataStore, inventoryEngine) {
    this.store = dataStore;
    this.inventory = inventoryEngine;
  }

  /**
   * Registers a new vendor supplier.
   * @param {object} supplierData
   * @returns {Promise<object>}
   */
  async createSupplier(supplierData) {
    const payload = {
      name: supplierData.name?.trim(),
      gstin: supplierData.gstin?.trim() || null,
      stateCode: supplierData.stateCode ? String(supplierData.stateCode).padStart(2, '0') : env.COMPANY_STATE_CODE,
      email: supplierData.email?.trim() || null,
      phone: supplierData.phone?.trim() || null,
      address: supplierData.address?.trim() || '',
      leadTimeDays: Number(supplierData.leadTimeDays) || 7,
      paymentTermsDays: Number(supplierData.paymentTermsDays) || 30,
      rating: Number(supplierData.rating) || 5,
      actualLeadTimes: []
    };

    return this.store.insert(COLLECTIONS.SUPPLIERS, payload);
  }

  /**
   * Creates a draft Purchase Order for a supplier.
   * @param {object} poData
   * @returns {Promise<object>}
   */
  async createPurchaseOrder(poData) {
    const supplier = this.store.findById(COLLECTIONS.SUPPLIERS, poData.supplierId);
    if (!supplier) {
      throw new NotFoundError('Supplier', poData.supplierId);
    }

    if (!Array.isArray(poData.items) || poData.items.length === 0) {
      throw new ValidationError('Purchase order must contain at least one line item');
    }

    const year = new Date().getFullYear();
    const seq = await this.store.getNextSequence(`po_${year}`);
    const poNumber = `PO-${year}-${String(seq).padStart(5, '0')}`;

    let subtotal = 0;
    const validatedItems = [];

    for (const item of poData.items) {
      const sku = this.store.findById(COLLECTIONS.SKUS, item.skuId);
      if (!sku) {
        throw new NotFoundError('SKU', item.skuId);
      }

      const qty = Number(item.orderedQuantity);
      const unitCost = Number(item.unitCostPrice);

      if (qty <= 0 || Number.isNaN(qty)) {
        throw new ValidationError(`Invalid ordered quantity for SKU ${sku.skuCode}`);
      }
      if (unitCost < 0 || Number.isNaN(unitCost)) {
        throw new ValidationError(`Invalid unit cost for SKU ${sku.skuCode}`);
      }

      const lineTotal = Math.round(qty * unitCost * 100) / 100;
      subtotal += lineTotal;

      validatedItems.push({
        skuId: sku.id,
        skuCode: sku.skuCode,
        skuName: sku.name,
        orderedQuantity: qty,
        receivedQuantity: 0,
        unitCostPrice: unitCost,
        lineTotal
      });
    }

    // Determine GST based on supplier state vs company state
    const isInterState = String(supplier.stateCode) !== String(env.COMPANY_STATE_CODE);
    const taxRate = 18; // Standard estimated PO tax rate
    const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
    const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100;

    const leadDays = supplier.leadTimeDays || 7;
    const expectedDelivery = poData.expectedDeliveryDate || new Date(Date.now() + (leadDays * 24 * 60 * 60 * 1000)).toISOString();

    const po = {
      poNumber,
      supplierId: supplier.id,
      supplierName: supplier.name,
      supplierStateCode: supplier.stateCode,
      orderDate: poData.orderDate || new Date().toISOString(),
      expectedDeliveryDate: expectedDelivery,
      status: PO_STATUS.DRAFT,
      items: validatedItems,
      subtotal,
      taxRate,
      isInterState,
      taxAmount,
      totalAmount,
      notes: poData.notes || '',
      fulfillments: []
    };

    return this.store.insert(COLLECTIONS.PURCHASE_ORDERS, po);
  }

  /**
   * Advances a Purchase Order through its validated state machine.
   * @param {string} poId
   * @param {string} targetStatus
   * @returns {Promise<object>}
   */
  async updatePurchaseOrderStatus(poId, targetStatus) {
    const po = this.store.findById(COLLECTIONS.PURCHASE_ORDERS, poId);
    if (!po) {
      throw new NotFoundError('PurchaseOrder', poId);
    }

    const allowedTransitions = PO_TRANSITIONS[po.status] || [];
    if (!allowedTransitions.includes(targetStatus)) {
      throw new InvalidStateTransitionError('PurchaseOrder', po.status, targetStatus);
    }

    return this.store.update(COLLECTIONS.PURCHASE_ORDERS, poId, {
      status: targetStatus
    });
  }

  /**
   * Receives goods against an active Purchase Order.
   * Updates line items, creates inventory batch lots, updates supplier lead time,
   * and transitions PO to PARTIALLY_RECEIVED or FULFILLED.
   * @param {string} poId
   * @param {Array<{ skuId: string, quantityReceived: number, batchNumber?: string, expiryDate?: string }>} receipts
   * @returns {Promise<object>}
   */
  async receivePoShipment(poId, receipts) {
    const po = this.store.findById(COLLECTIONS.PURCHASE_ORDERS, poId);
    if (!po) {
      throw new NotFoundError('PurchaseOrder', poId);
    }

    if (![PO_STATUS.ISSUED, PO_STATUS.PARTIALLY_RECEIVED].includes(po.status)) {
      throw new ValidationError(`Cannot receive stock against PO in status "${po.status}". PO must be ISSUED or PARTIALLY_RECEIVED.`);
    }

    const receiptMap = new Map();
    for (const r of receipts) {
      const q = Number(r.quantityReceived);
      if (q <= 0 || Number.isNaN(q)) {
        throw new ValidationError(`Quantity received for SKU ${r.skuId} must be positive`);
      }
      receiptMap.set(r.skuId, r);
    }

    return this.store.transaction(async (tx) => {
      const updatedItems = [];
      const createdBatches = [];
      let allFulfilled = true;
      let anyReceived = false;

      for (const item of po.items) {
        const receipt = receiptMap.get(item.skuId);
        let newReceivedQty = item.receivedQuantity;

        if (receipt) {
          const qty = Number(receipt.quantityReceived);
          const remaining = item.orderedQuantity - item.receivedQuantity;

          if (qty > remaining) {
            throw new ValidationError(
              `Received quantity (${qty}) exceeds remaining ordered quantity (${remaining}) for SKU ${item.skuCode}`
            );
          }

          newReceivedQty += qty;
          anyReceived = true;

          // Receive batch lot into inventory engine
          const batchSeq = await this.store.getNextSequence(`batch_${item.skuCode}`);
          const batchNumber = receipt.batchNumber || `PO-${po.poNumber}-${item.skuCode}-${String(batchSeq).padStart(3, '0')}`;

          const batch = tx.insert(COLLECTIONS.BATCHES, {
            skuId: item.skuId,
            batchNumber,
            receivedDate: new Date().toISOString(),
            expiryDate: receipt.expiryDate || null,
            initialQuantity: qty,
            availableQuantity: qty,
            unitCostPrice: item.unitCostPrice,
            supplierId: po.supplierId,
            poId: po.id
          });

          tx.insert(COLLECTIONS.TRANSACTIONS, {
            skuId: item.skuId,
            batchId: batch.id,
            type: 'IN',
            quantity: qty,
            unitCostPrice: item.unitCostPrice,
            referenceType: 'PURCHASE_ORDER',
            referenceId: po.poNumber,
            timestamp: new Date().toISOString()
          });

          createdBatches.push(batch);
        }

        if (newReceivedQty < item.orderedQuantity) {
          allFulfilled = false;
        }

        updatedItems.push({
          ...item,
          receivedQuantity: newReceivedQty
        });
      }

      if (!anyReceived) {
        throw new ValidationError('No matching items found in shipment receipt');
      }

      const nextStatus = allFulfilled ? PO_STATUS.FULFILLED : PO_STATUS.PARTIALLY_RECEIVED;
      const now = new Date();

      const fulfillmentEntry = {
        fulfillmentId: this.store.generateId(),
        receivedAt: now.toISOString(),
        batches: createdBatches.map(b => ({ batchId: b.id, batchNumber: b.batchNumber, qty: b.initialQuantity }))
      };

      const updatedFulfillments = [...(po.fulfillments || []), fulfillmentEntry];

      // If fully fulfilled, calculate actual lead time and update supplier performance
      if (allFulfilled) {
        const orderTime = new Date(po.orderDate).getTime();
        const actualLeadTimeDays = Math.max(1, Math.round((now.getTime() - orderTime) / (24 * 60 * 60 * 1000)));

        const supplier = tx.findById(COLLECTIONS.SUPPLIERS, po.supplierId);
        if (supplier) {
          const leadTimes = [...(supplier.actualLeadTimes || []), actualLeadTimeDays];
          // Moving average of last 5 shipments
          const recent = leadTimes.slice(-5);
          const avgLead = Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);

          tx.update(COLLECTIONS.SUPPLIERS, supplier.id, {
            actualLeadTimes: leadTimes,
            leadTimeDays: avgLead
          });
        }
      }

      return tx.update(COLLECTIONS.PURCHASE_ORDERS, po.id, {
        items: updatedItems,
        status: nextStatus,
        fulfillments: updatedFulfillments
      });
    });
  }

  /**
   * Computes accounts payable aging report across all suppliers.
   * Aging brackets: 0-30 days, 31-60 days, 61-90 days, 90+ days.
   * @returns {{
   *   summary: { totalPayable: number, current: number, days31to60: number, days61to90: number, over90: number },
   *   supplierBreakdown: Array<object>
   * }}
   */
  getPayableAgingReport() {
    const fulfilledOrders = this.store.find(
      COLLECTIONS.PURCHASE_ORDERS,
      p => [PO_STATUS.FULFILLED, PO_STATUS.PARTIALLY_RECEIVED].includes(p.status)
    );

    const now = Date.now();
    const summary = {
      totalPayable: 0,
      current: 0,     // 0-30 days
      days31to60: 0,  // 31-60 days
      days61to90: 0,  // 61-90 days
      over90: 0       // 90+ days
    };

    const supplierMap = new Map();

    for (const po of fulfilledOrders) {
      // Outstanding balance is based on fulfilled items
      const fulfilledAmount = po.items.reduce((sum, item) => {
        return sum + (item.receivedQuantity * item.unitCostPrice);
      }, 0);

      const taxFactor = 1 + (po.taxRate / 100);
      const payableAmount = Math.round(fulfilledAmount * taxFactor * 100) / 100;

      const orderTime = new Date(po.orderDate).getTime();
      const ageDays = Math.floor((now - orderTime) / (24 * 60 * 60 * 1000));

      summary.totalPayable += payableAmount;

      let bucket = 'current';
      if (ageDays > 90) {
        summary.over90 += payableAmount;
        bucket = 'over90';
      } else if (ageDays > 60) {
        summary.days61to90 += payableAmount;
        bucket = 'days61to90';
      } else if (ageDays > 30) {
        summary.days31to60 += payableAmount;
        bucket = 'days31to60';
      } else {
        summary.current += payableAmount;
      }

      if (!supplierMap.has(po.supplierId)) {
        supplierMap.set(po.supplierId, {
          supplierId: po.supplierId,
          supplierName: po.supplierName,
          totalPayable: 0,
          current: 0,
          days31to60: 0,
          days61to90: 0,
          over90: 0,
          orders: []
        });
      }

      const entry = supplierMap.get(po.supplierId);
      entry.totalPayable += payableAmount;
      entry[bucket] += payableAmount;
      entry.orders.push({
        poNumber: po.poNumber,
        orderDate: po.orderDate,
        ageDays,
        payableAmount
      });
    }

    // Round all monetary values to 2 decimal places
    summary.totalPayable = Math.round(summary.totalPayable * 100) / 100;
    summary.current = Math.round(summary.current * 100) / 100;
    summary.days31to60 = Math.round(summary.days31to60 * 100) / 100;
    summary.days61to90 = Math.round(summary.days61to90 * 100) / 100;
    summary.over90 = Math.round(summary.over90 * 100) / 100;

    return {
      summary,
      supplierBreakdown: Array.from(supplierMap.values())
    };
  }
}
