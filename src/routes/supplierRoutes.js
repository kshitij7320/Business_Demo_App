import { Router } from 'express';
import { validateBody } from '../middleware/validator.js';

/**
 * Creates supplier and purchase order routes.
 * @param {import('../controllers/supplierController.js').SupplierController} controller
 * @returns {Router}
 */
export function createSupplierRoutes(controller) {
  const router = Router();

  router.get('/', controller.listSuppliers);
  router.post(
    '/',
    validateBody({
      name: { type: 'string', required: true }
    }),
    controller.createSupplier
  );

  router.get('/purchase-orders', controller.listPurchaseOrders);
  router.get('/purchase-orders/:id', controller.getPurchaseOrder);

  router.post(
    '/purchase-orders',
    validateBody({
      supplierId: { type: 'string', required: true },
      items: {
        required: true,
        validate: v => (Array.isArray(v) && v.length > 0) || 'Items must be a non-empty array'
      }
    }),
    controller.createPurchaseOrder
  );

  router.patch(
    '/purchase-orders/:id/status',
    validateBody({
      status: { type: 'string', required: true }
    }),
    controller.updateStatus
  );

  router.post(
    '/purchase-orders/:id/receive',
    validateBody({
      receipts: {
        required: true,
        validate: v => (Array.isArray(v) && v.length > 0) || 'Receipts must be a non-empty array'
      }
    }),
    controller.receiveShipment
  );

  router.get('/reports/payable-aging', controller.getPayableAging);
  router.get('/:id', controller.getSupplier);

  return router;
}
