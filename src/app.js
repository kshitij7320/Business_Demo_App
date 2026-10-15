import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestLogger } from './middleware/requestLogger.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { errorHandler } from './middleware/errorHandler.js';
import { InventoryEngine } from './core/inventoryEngine.js';
import { BillingEngine } from './core/billingEngine.js';
import { SupplierManager } from './core/supplierManager.js';
import { AnalyticsService } from './core/analyticsService.js';
import { InventoryController } from './controllers/inventoryController.js';
import { BillingController } from './controllers/billingController.js';
import { SupplierController } from './controllers/supplierController.js';
import { AnalyticsController } from './controllers/analyticsController.js';
import { createApiRouter } from './routes/apiRouter.js';
import { NotFoundError } from './core/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');

/**
 * Creates and configures the Express application instance.
 * @param {import('./storage/dataStore.js').DataStore} dataStore
 * @returns {express.Application}
 */
export function createApp(dataStore) {
  const app = express();

  // Instantiate domain service layer
  const inventoryEngine = new InventoryEngine(dataStore);
  const billingEngine = new BillingEngine(dataStore, inventoryEngine);
  const supplierManager = new SupplierManager(dataStore, inventoryEngine);
  const analyticsService = new AnalyticsService(dataStore, inventoryEngine);

  // Instantiate controllers
  const inventoryController = new InventoryController(dataStore, inventoryEngine);
  const billingController = new BillingController(dataStore, billingEngine);
  const supplierController = new SupplierController(dataStore, supplierManager);
  const analyticsController = new AnalyticsController(dataStore, analyticsService);

  // Standard middleware
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestLogger());
  app.use(rateLimiter());

  // Static web assets for Vanilla SPA
  app.use(express.static(publicDir));

  // Mount API routers
  const apiRouter = createApiRouter({
    inventory: inventoryController,
    billing: billingController,
    supplier: supplierController,
    analytics: analyticsController
  });

  app.use('/api/v1', apiRouter);
  app.use('/api', apiRouter); // convenient alias

  // SPA fallback for HTML client-side routing
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next(new NotFoundError('Endpoint', req.path));
    }
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // Centralized error handler
  app.use(errorHandler);

  return app;
}
