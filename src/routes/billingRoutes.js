import { Router } from 'express';
import { validateBody } from '../middleware/validator.js';

/**
 * Creates billing and invoice routes.
 * @param {import('../controllers/billingController.js').BillingController} controller
 * @returns {Router}
 */
export function createBillingRoutes(controller) {
  const router = Router();

  router.get('/invoices', controller.listInvoices);
  router.get('/invoices/:id', controller.getInvoice);

  router.post(
    '/invoices',
    validateBody({
      customerName: { type: 'string', required: true },
      items: {
        required: true,
        validate: v => (Array.isArray(v) && v.length > 0) || 'Items must be a non-empty array'
      }
    }),
    controller.createInvoice
  );

  router.post('/quote', controller.calculateQuote);

  router.get('/credit-notes', controller.listCreditNotes);
  router.post(
    '/credit-notes',
    validateBody({
      invoiceId: { type: 'string', required: true },
      items: {
        required: true,
        validate: v => (Array.isArray(v) && v.length > 0) || 'Items must be a non-empty array'
      }
    }),
    controller.createCreditNote
  );

  return router;
}
