import { Router } from 'express';
import { createInventoryRoutes } from './inventoryRoutes.js';
import { createBillingRoutes } from './billingRoutes.js';
import { createSupplierRoutes } from './supplierRoutes.js';
import { createAnalyticsRoutes } from './analyticsRoutes.js';

/**
 * Mounts domain route groups into the unified API router.
 * @param {object} controllers
 * @param {import('../controllers/inventoryController.js').InventoryController} controllers.inventory
 * @param {import('../controllers/billingController.js').BillingController} controllers.billing
 * @param {import('../controllers/supplierController.js').SupplierController} controllers.supplier
 * @param {import('../controllers/analyticsController.js').AnalyticsController} controllers.analytics
 * @returns {Router}
 */
export function createApiRouter({ inventory, billing, supplier, analytics }) {
  const router = Router();

  router.get('/health', (req, res) => {
    res.json({
      status: 'UP',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      system: 'StockPulse Offline Engine'
    });
  });

  router.use('/inventory', createInventoryRoutes(inventory));
  router.use('/billing', createBillingRoutes(billing));
  router.use('/suppliers', createSupplierRoutes(supplier));
  router.use('/analytics', createAnalyticsRoutes(analytics));

  return router;
}
