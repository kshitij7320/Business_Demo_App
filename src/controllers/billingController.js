import { COLLECTIONS } from '../config/constants.js';
import { NotFoundError } from '../core/errors.js';

export class BillingController {
  /**
   * @param {import('../storage/dataStore.js').DataStore} dataStore
   * @param {import('../core/billingEngine.js').BillingEngine} billingEngine
   */
  constructor(dataStore, billingEngine) {
    this.store = dataStore;
    this.engine = billingEngine;
  }

  listInvoices = async (req, res, next) => {
    try {
      const invoices = this.store.find(COLLECTIONS.INVOICES);
      // Sort newest first
      invoices.sort((a, b) => new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime());
      res.json({ data: invoices });
    } catch (err) {
      next(err);
    }
  };

  getInvoice = async (req, res, next) => {
    try {
      const invoice = this.store.findById(COLLECTIONS.INVOICES, req.params.id);
      if (!invoice) {
        throw new NotFoundError('Invoice', req.params.id);
      }
      res.json({ data: invoice });
    } catch (err) {
      next(err);
    }
  };

  createInvoice = async (req, res, next) => {
    try {
      const invoice = await this.engine.createInvoice(req.body);
      res.status(201).json({ data: invoice });
    } catch (err) {
      next(err);
    }
  };

  calculateQuote = async (req, res, next) => {
    try {
      const { items, customerStateCode } = req.body;
      const quote = this.engine.calculateTaxes(items || [], customerStateCode || '27');
      res.json({ data: quote });
    } catch (err) {
      next(err);
    }
  };

  listCreditNotes = async (req, res, next) => {
    try {
      const notes = this.store.find(COLLECTIONS.CREDIT_NOTES);
      notes.sort((a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime());
      res.json({ data: notes });
    } catch (err) {
      next(err);
    }
  };

  createCreditNote = async (req, res, next) => {
    try {
      const creditNote = await this.engine.createCreditNote(req.body);
      res.status(201).json({ data: creditNote });
    } catch (err) {
      next(err);
    }
  };
}
