import { Router } from 'express';

/**
 * Creates analytics and export routes.
 * @param {import('../controllers/analyticsController.js').AnalyticsController} controller
 * @returns {Router}
 */
export function createAnalyticsRoutes(controller) {
  const router = Router();

  router.get('/dashboard', controller.getDashboard);
  router.get('/timeline', controller.getTimeline);
  router.get('/export/inventory.csv', controller.exportInventoryCsv);

  return router;
}
