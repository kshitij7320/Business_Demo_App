import { COLLECTIONS } from '../config/constants.js';
import { NotFoundError } from '../core/errors.js';

export class SupplierController {
  /**
   * @param {import('../storage/dataStore.js').DataStore} dataStore
   * @param {import('../core/supplierManager.js').SupplierManager} supplierManager
   */
  constructor(dataStore, supplierManager) {
    this.store = dataStore;
    this.manager = supplierManager;
  }

  listSuppliers = async (req, res, next) => {
    try {
      const suppliers = this.store.find(COLLECTIONS.SUPPLIERS);
      res.json({ data: suppliers });
    } catch (err) {
      next(err);
    }
  };

  getSupplier = async (req, res, next) => {
    try {
      const supplier = this.store.findById(COLLECTIONS.SUPPLIERS, req.params.id);
      if (!supplier) {
        throw new NotFoundError('Supplier', req.params.id);
      }
      res.json({ data: supplier });
    } catch (err) {
      next(err);
    }
  };

  createSupplier = async (req, res, next) => {
    try {
      const supplier = await this.manager.createSupplier(req.body);
      res.status(201).json({ data: supplier });
    } catch (err) {
      next(err);
    }
  };

  listPurchaseOrders = async (req, res, next) => {
    try {
      const { status, supplierId } = req.query;
      const pos = this.store.find(COLLECTIONS.PURCHASE_ORDERS, po => {
        if (status && po.status !== status) return false;
        if (supplierId && po.supplierId !== supplierId) return false;
        return true;
      });
      pos.sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
      res.json({ data: pos });
    } catch (err) {
      next(err);
    }
  };

  getPurchaseOrder = async (req, res, next) => {
    try {
      const po = this.store.findById(COLLECTIONS.PURCHASE_ORDERS, req.params.id);
      if (!po) {
        throw new NotFoundError('PurchaseOrder', req.params.id);
      }
      res.json({ data: po });
    } catch (err) {
      next(err);
    }
  };

  createPurchaseOrder = async (req, res, next) => {
    try {
      const po = await this.manager.createPurchaseOrder(req.body);
      res.status(201).json({ data: po });
    } catch (err) {
      next(err);
    }
  };

  updateStatus = async (req, res, next) => {
    try {
      const updated = await this.manager.updatePurchaseOrderStatus(req.params.id, req.body.status);
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  };

  receiveShipment = async (req, res, next) => {
    try {
      const updated = await this.manager.receivePoShipment(req.params.id, req.body.receipts);
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  };

  getPayableAging = async (req, res, next) => {
    try {
      const report = this.manager.getPayableAgingReport();
      res.json({ data: report });
    } catch (err) {
      next(err);
    }
  };
}
