import { COLLECTIONS, VALUATION_METHODS } from '../config/constants.js';
import { NotFoundError } from '../core/errors.js';

export class InventoryController {
  /**
   * @param {import('../storage/dataStore.js').DataStore} dataStore
   * @param {import('../core/inventoryEngine.js').InventoryEngine} inventoryEngine
   */
  constructor(dataStore, inventoryEngine) {
    this.store = dataStore;
    this.engine = inventoryEngine;
  }

  listSkus = async (req, res, next) => {
    try {
      const skus = this.store.find(COLLECTIONS.SKUS);
      const enriched = skus.map(sku => {
        const stock = this.engine.getStockLevel(sku.id);
        return {
          ...sku,
          totalStock: stock.totalAvailable,
          batchCount: stock.batchCount
        };
      });
      res.json({ data: enriched });
    } catch (err) {
      next(err);
    }
  };

  getSku = async (req, res, next) => {
    try {
      const sku = this.store.findById(COLLECTIONS.SKUS, req.params.id);
      if (!sku) {
        throw new NotFoundError('SKU', req.params.id);
      }
      const stock = this.engine.getStockLevel(sku.id);
      res.json({ data: { ...sku, stock } });
    } catch (err) {
      next(err);
    }
  };

  createSku = async (req, res, next) => {
    try {
      const sku = await this.engine.createSku(req.body);
      res.status(201).json({ data: sku });
    } catch (err) {
      next(err);
    }
  };

  updateSku = async (req, res, next) => {
    try {
      const updated = await this.engine.updateSku(req.params.id, req.body);
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  };

  receiveStock = async (req, res, next) => {
    try {
      const batch = await this.engine.receiveStock({
        skuId: req.params.id,
        quantity: req.body.quantity,
        unitCostPrice: req.body.unitCostPrice,
        batchNumber: req.body.batchNumber,
        expiryDate: req.body.expiryDate,
        supplierId: req.body.supplierId,
        poId: req.body.poId
      });
      res.status(201).json({ data: batch });
    } catch (err) {
      next(err);
    }
  };

  depleteStock = async (req, res, next) => {
    try {
      const method = req.body.valuationMethod || VALUATION_METHODS.FIFO;
      const result = await this.engine.depleteStock(
        req.params.id,
        Number(req.body.quantity),
        method,
        { referenceType: 'MANUAL_DISPATCH' }
      );
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  };

  getReorderAlerts = async (req, res, next) => {
    try {
      const alerts = this.engine.computeReorderThresholds();
      res.json({ data: alerts });
    } catch (err) {
      next(err);
    }
  };

  getDeadStock = async (req, res, next) => {
    try {
      const inactivityDays = Number(req.query.inactivityDays) || 90;
      const expiryDays = Number(req.query.expiryDays) || 30;
      const analysis = this.engine.analyzeDeadStock(inactivityDays, expiryDays);
      res.json({ data: analysis });
    } catch (err) {
      next(err);
    }
  };
}
