import { Router } from 'express';
import { validateBody } from '../middleware/validator.js';

/**
 * Creates inventory routes attached to the controller.
 * @param {import('../controllers/inventoryController.js').InventoryController} controller
 * @returns {Router}
 */
export function createInventoryRoutes(controller) {
  const router = Router();

  router.get('/skus', controller.listSkus);
  router.get('/skus/:id', controller.getSku);

  router.post(
    '/skus',
    validateBody({
      skuCode: { type: 'string', required: true },
      name: { type: 'string', required: true }
    }),
    controller.createSku
  );

  router.put('/skus/:id', controller.updateSku);

  router.post(
    '/skus/:id/receive',
    validateBody({
      quantity: { type: 'number', required: true, validate: v => v > 0 || 'Quantity must be > 0' },
      unitCostPrice: { type: 'number', required: true, validate: v => v >= 0 || 'Unit cost must be >= 0' }
    }),
    controller.receiveStock
  );

  router.post(
    '/skus/:id/deplete',
    validateBody({
      quantity: { type: 'number', required: true, validate: v => v > 0 || 'Quantity must be > 0' }
    }),
    controller.depleteStock
  );

  router.get('/alerts/reorder', controller.getReorderAlerts);
  router.get('/diagnostics/dead-stock', controller.getDeadStock);

  return router;
}
