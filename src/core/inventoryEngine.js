import { COLLECTIONS, VALUATION_METHODS } from '../config/constants.js';
import { InsufficientStockError, NotFoundError, ValidationError } from './errors.js';

/**
 * Core Inventory Valuation and Stock Management Engine.
 * Supports multi-lot batch tracking, FIFO/LIFO stock depletion,
 * reorder threshold calculations, and dead stock identification.
 */
export class InventoryEngine {
  /**
   * @param {import('../storage/dataStore.js').DataStore} dataStore
   */
  constructor(dataStore) {
    this.store = dataStore;
  }

  /**
   * Registers a new Stock Keeping Unit (SKU).
   * @param {object} skuData
   * @returns {Promise<object>}
   */
  async createSku(skuData) {
    const payload = {
      skuCode: skuData.skuCode?.trim().toUpperCase(),
      name: skuData.name?.trim(),
      category: skuData.category?.trim() || 'General',
      unit: skuData.unit || 'PCS',
      hsnCode: skuData.hsnCode?.trim() || '9999',
      sellingPrice: Number(skuData.sellingPrice) || 0,
      taxRate: skuData.taxRate !== undefined ? Number(skuData.taxRate) : 18,
      reorderPoint: Number(skuData.reorderPoint) || 0,
      safetyStock: Number(skuData.safetyStock) || 0,
      leadTimeDays: Number(skuData.leadTimeDays) || 7,
      averageDailyDemand: Number(skuData.averageDailyDemand) || 1
    };

    return this.store.insert(COLLECTIONS.SKUS, payload);
  }

  /**
   * Updates an existing SKU's attributes.
   * @param {string} skuId
   * @param {object} updates
   * @returns {Promise<object>}
   */
  async updateSku(skuId, updates) {
    const existing = this.store.findById(COLLECTIONS.SKUS, skuId);
    if (!existing) {
      throw new NotFoundError('SKU', skuId);
    }
    return this.store.update(COLLECTIONS.SKUS, skuId, updates);
  }

  /**
   * Receives incoming stock into a new inventory batch lot.
   * @param {object} batchData
   * @returns {Promise<object>}
   */
  async receiveStock(batchData) {
    const sku = this.store.findById(COLLECTIONS.SKUS, batchData.skuId);
    if (!sku) {
      throw new NotFoundError('SKU', batchData.skuId);
    }

    const initialQuantity = Number(batchData.quantity);
    if (Number.isNaN(initialQuantity) || initialQuantity <= 0) {
      throw new ValidationError('Received quantity must be a positive number');
    }

    const unitCostPrice = Number(batchData.unitCostPrice);
    if (Number.isNaN(unitCostPrice) || unitCostPrice < 0) {
      throw new ValidationError('Unit cost price must be a non-negative number');
    }

    const seq = await this.store.getNextSequence(`batch_${sku.skuCode}`);
    const batchNumber = batchData.batchNumber || `LOT-${sku.skuCode}-${String(seq).padStart(4, '0')}`;

    const batch = await this.store.insert(COLLECTIONS.BATCHES, {
      skuId: sku.id,
      batchNumber,
      receivedDate: batchData.receivedDate || new Date().toISOString(),
      expiryDate: batchData.expiryDate || null,
      initialQuantity,
      availableQuantity: initialQuantity,
      unitCostPrice,
      supplierId: batchData.supplierId || null,
      poId: batchData.poId || null
    });

    await this.store.insert(COLLECTIONS.TRANSACTIONS, {
      skuId: sku.id,
      batchId: batch.id,
      type: 'IN',
      quantity: initialQuantity,
      unitCostPrice,
      referenceType: batchData.poId ? 'PURCHASE_ORDER' : 'MANUAL_RECEIPT',
      referenceId: batchData.poId || null,
      timestamp: new Date().toISOString()
    });

    return batch;
  }

  /**
   * Calculates total available stock for a given SKU across all active batches.
   * @param {string} skuId
   * @returns {{ totalAvailable: number, batchCount: number, batches: object[] }}
   */
  getStockLevel(skuId) {
    const batches = this.store.find(
      COLLECTIONS.BATCHES,
      b => b.skuId === skuId && b.availableQuantity > 0
    );

    const totalAvailable = batches.reduce((sum, b) => sum + b.availableQuantity, 0);
    return {
      totalAvailable,
      batchCount: batches.length,
      batches
    };
  }

  /**
   * Depletes inventory stock using FIFO (First-In, First-Out) or LIFO (Last-In, First-Out) valuation.
   * Atomic across all affected batch lots.
   * @param {string} skuId
   * @param {number} requestedQuantity
   * @param {'FIFO'|'LIFO'} [method='FIFO']
   * @param {object} [context]
   * @returns {Promise<{
   *   skuId: string,
   *   totalDepleted: number,
   *   cogs: number,
   *   averageUnitCost: number,
   *   method: string,
   *   allocations: Array<{ batchId: string, batchNumber: string, quantity: number, unitCost: number, lotCogs: number }>
   * }>}
   */
  async depleteStock(skuId, requestedQuantity, method = VALUATION_METHODS.FIFO, context = {}) {
    const sku = this.store.findById(COLLECTIONS.SKUS, skuId);
    if (!sku) {
      throw new NotFoundError('SKU', skuId);
    }

    if (typeof requestedQuantity !== 'number' || requestedQuantity <= 0) {
      throw new ValidationError('Requested depletion quantity must be a positive number');
    }

    return this.store.transaction(async (tx) => {
      // Find all available batches for this SKU
      const availableBatches = tx.find(
        COLLECTIONS.BATCHES,
        b => b.skuId === skuId && b.availableQuantity > 0
      );

      const totalAvailable = availableBatches.reduce((acc, b) => acc + b.availableQuantity, 0);
      if (totalAvailable < requestedQuantity) {
        throw new InsufficientStockError(sku.skuCode, requestedQuantity, totalAvailable);
      }

      // Sort batches according to valuation strategy:
      // FIFO: Oldest received batches first
      // LIFO: Newest received batches first
      const sortedBatches = [...availableBatches].sort((a, b) => {
        const timeA = new Date(a.receivedDate).getTime();
        const timeB = new Date(b.receivedDate).getTime();
        return method === VALUATION_METHODS.FIFO ? timeA - timeB : timeB - timeA;
      });

      let remainingToDeplete = requestedQuantity;
      let totalCogs = 0;
      const allocations = [];

      for (const batch of sortedBatches) {
        if (remainingToDeplete <= 0) break;

        const takeQuantity = Math.min(batch.availableQuantity, remainingToDeplete);
        const lotCogs = Math.round(takeQuantity * batch.unitCostPrice * 100) / 100;

        allocations.push({
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          quantity: takeQuantity,
          unitCost: batch.unitCostPrice,
          lotCogs
        });

        totalCogs += lotCogs;
        remainingToDeplete -= takeQuantity;

        tx.update(COLLECTIONS.BATCHES, batch.id, {
          availableQuantity: batch.availableQuantity - takeQuantity
        });
      }

      const roundedCogs = Math.round(totalCogs * 100) / 100;
      const averageUnitCost = requestedQuantity > 0 ? Math.round((roundedCogs / requestedQuantity) * 100) / 100 : 0;

      tx.insert(COLLECTIONS.TRANSACTIONS, {
        skuId,
        type: 'OUT',
        quantity: requestedQuantity,
        cogs: roundedCogs,
        valuationMethod: method,
        referenceType: context.referenceType || 'DISPATCH',
        referenceId: context.referenceId || null,
        allocations,
        timestamp: new Date().toISOString()
      });

      return {
        skuId,
        skuCode: sku.skuCode,
        totalDepleted: requestedQuantity,
        cogs: roundedCogs,
        averageUnitCost,
        method,
        allocations
      };
    });
  }

  /**
   * Reverses stock depletion (e.g., when an invoice item is returned via credit note).
   * Restores quantity to the specified batch or the latest active batch.
   * @param {string} skuId
   * @param {number} quantity
   * @param {string} [preferredBatchId]
   * @param {object} [context]
   */
  async restoreStock(skuId, quantity, preferredBatchId = null, context = {}) {
    const sku = this.store.findById(COLLECTIONS.SKUS, skuId);
    if (!sku) throw new NotFoundError('SKU', skuId);

    if (typeof quantity !== 'number' || quantity <= 0) {
      throw new ValidationError('Restoration quantity must be a positive number');
    }

    return this.store.transaction(async (tx) => {
      let targetBatch = null;
      if (preferredBatchId) {
        targetBatch = tx.findById(COLLECTIONS.BATCHES, preferredBatchId);
      }

      if (!targetBatch) {
        // Fall back to most recent batch for this SKU
        const batches = tx.find(COLLECTIONS.BATCHES, b => b.skuId === skuId);
        batches.sort((a, b) => new Date(b.receivedDate).getTime() - new Date(a.receivedDate).getTime());
        targetBatch = batches[0];
      }

      if (targetBatch) {
        tx.update(COLLECTIONS.BATCHES, targetBatch.id, {
          availableQuantity: targetBatch.availableQuantity + quantity
        });
      } else {
        // Create an adjustment batch if no batches exist
        targetBatch = tx.insert(COLLECTIONS.BATCHES, {
          skuId,
          batchNumber: `RESTORE-${sku.skuCode}-${Date.now()}`,
          receivedDate: new Date().toISOString(),
          initialQuantity: quantity,
          availableQuantity: quantity,
          unitCostPrice: sku.sellingPrice * 0.6 // conservative fallback cost
        });
      }

      tx.insert(COLLECTIONS.TRANSACTIONS, {
        skuId,
        batchId: targetBatch.id,
        type: 'IN',
        quantity,
        referenceType: context.referenceType || 'CREDIT_NOTE_RETURN',
        referenceId: context.referenceId || null,
        timestamp: new Date().toISOString()
      });

      return {
        skuId,
        restoredQuantity: quantity,
        batchId: targetBatch.id
      };
    });
  }

  /**
   * Computes dynamic Reorder Points (ROP) and flags SKUs below the threshold.
   * Formula: ROP = (Average Daily Demand * Lead Time Days) + Safety Stock
   * @returns {Array<{
   *   sku: object,
   *   currentStock: number,
   *   reorderPoint: number,
   *   isLowStock: boolean,
   *   suggestedOrderQuantity: number
   * }>}
   */
  computeReorderThresholds() {
    const allSkus = this.store.find(COLLECTIONS.SKUS);
    return allSkus.map(sku => {
      const stock = this.getStockLevel(sku.id);
      const leadTime = sku.leadTimeDays || 7;
      const dailyDemand = sku.averageDailyDemand || 1;
      const safetyStock = sku.safetyStock || 0;

      // When reorderPoint is not manually overridden, calculate dynamically
      const computedRop = (dailyDemand * leadTime) + safetyStock;
      const activeRop = sku.reorderPoint > 0 ? sku.reorderPoint : computedRop;

      const isLowStock = stock.totalAvailable <= activeRop;
      // Suggested order brings stock to double the ROP plus safety margin
      const suggestedOrderQuantity = isLowStock
        ? Math.max((activeRop * 2) - stock.totalAvailable, dailyDemand * 14)
        : 0;

      return {
        sku,
        currentStock: stock.totalAvailable,
        reorderPoint: activeRop,
        isLowStock,
        suggestedOrderQuantity: Math.ceil(suggestedOrderQuantity)
      };
    });
  }

  /**
   * Analyzes dead stock and near-expiry inventory.
   * @param {number} [inactivityDays=90]
   * @param {number} [nearExpiryDays=30]
   * @returns {{
   *   deadStockBatches: Array<object>,
   *   nearExpiryBatches: Array<object>,
   *   totalDeadStockValue: number,
   *   totalAtRiskValue: number
   * }}
   */
  analyzeDeadStock(inactivityDays = 90, nearExpiryDays = 30) {
    const now = Date.now();
    const inactivityThreshold = now - (inactivityDays * 24 * 60 * 60 * 1000);
    const expiryThreshold = now + (nearExpiryDays * 24 * 60 * 60 * 1000);

    const activeBatches = this.store.find(
      COLLECTIONS.BATCHES,
      b => b.availableQuantity > 0
    );

    const deadStockBatches = [];
    const nearExpiryBatches = [];
    let totalDeadStockValue = 0;
    let totalAtRiskValue = 0;

    for (const batch of activeBatches) {
      const receivedTime = new Date(batch.receivedDate).getTime();
      const tiedUpValue = Math.round(batch.availableQuantity * batch.unitCostPrice * 100) / 100;

      // Check if batch has been stagnant without depletion since receipt
      const isUnused = batch.availableQuantity === batch.initialQuantity;
      if (isUnused && receivedTime < inactivityThreshold) {
        deadStockBatches.push({
          ...batch,
          tiedUpValue,
          daysStagnant: Math.floor((now - receivedTime) / (24 * 60 * 60 * 1000))
        });
        totalDeadStockValue += tiedUpValue;
      }

      // Check expiry
      if (batch.expiryDate) {
        const expiryTime = new Date(batch.expiryDate).getTime();
        if (expiryTime <= expiryThreshold) {
          nearExpiryBatches.push({
            ...batch,
            tiedUpValue,
            daysUntilExpiry: Math.floor((expiryTime - now) / (24 * 60 * 60 * 1000))
          });
          totalAtRiskValue += tiedUpValue;
        }
      }
    }

    return {
      deadStockBatches,
      nearExpiryBatches,
      totalDeadStockValue: Math.round(totalDeadStockValue * 100) / 100,
      totalAtRiskValue: Math.round(totalAtRiskValue * 100) / 100
    };
  }
}
