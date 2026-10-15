import { ValidationError } from '../core/errors.js';
import { GST_SLABS, PO_STATUS, UNITS_OF_MEASUREMENT } from '../config/constants.js';

/**
 * Validates entity payloads before persistence.
 */
export class SchemaValidator {
  /**
   * Validates document against collection schema rules.
   * @param {string} collection
   * @param {Record<string, any>} doc
   * @throws {ValidationError}
   */
  static validate(collection, doc) {
    if (!doc || typeof doc !== 'object') {
      throw new ValidationError(`Document for ${collection} must be a non-null object`);
    }

    const errors = [];

    switch (collection) {
      case 'skus':
        this._validateSku(doc, errors);
        break;
      case 'batches':
        this._validateBatch(doc, errors);
        break;
      case 'suppliers':
        this._validateSupplier(doc, errors);
        break;
      case 'purchase_orders':
        this._validatePurchaseOrder(doc, errors);
        break;
      case 'invoices':
        this._validateInvoice(doc, errors);
        break;
      case 'credit_notes':
        this._validateCreditNote(doc, errors);
        break;
      default:
        // Generic entities like counters or transactions must have string id
        if (!doc.id || typeof doc.id !== 'string') {
          errors.push('Entity must contain a valid string identifier "id"');
        }
        break;
    }

    if (errors.length > 0) {
      throw new ValidationError(`Validation failed for collection "${collection}": ${errors.join('; ')}`, {
        collection,
        errors
      });
    }
  }

  static _validateSku(doc, errors) {
    if (!doc.skuCode || typeof doc.skuCode !== 'string' || !doc.skuCode.trim()) {
      errors.push('skuCode is required and must be a non-empty string');
    }
    if (!doc.name || typeof doc.name !== 'string' || !doc.name.trim()) {
      errors.push('name is required and must be a non-empty string');
    }
    if (doc.unit && !UNITS_OF_MEASUREMENT.includes(doc.unit)) {
      errors.push(`unit must be one of: ${UNITS_OF_MEASUREMENT.join(', ')}`);
    }
    if (typeof doc.sellingPrice !== 'number' || doc.sellingPrice < 0) {
      errors.push('sellingPrice must be a number >= 0');
    }
    if (doc.taxRate !== undefined && !GST_SLABS.includes(doc.taxRate)) {
      errors.push(`taxRate must be a valid GST slab: ${GST_SLABS.join(', ')}%`);
    }
    if (doc.reorderPoint !== undefined && (typeof doc.reorderPoint !== 'number' || doc.reorderPoint < 0)) {
      errors.push('reorderPoint must be a number >= 0');
    }
    if (doc.safetyStock !== undefined && (typeof doc.safetyStock !== 'number' || doc.safetyStock < 0)) {
      errors.push('safetyStock must be a number >= 0');
    }
  }

  static _validateBatch(doc, errors) {
    if (!doc.batchNumber || typeof doc.batchNumber !== 'string') {
      errors.push('batchNumber is required and must be a string');
    }
    if (!doc.skuId || typeof doc.skuId !== 'string') {
      errors.push('skuId is required');
    }
    if (typeof doc.initialQuantity !== 'number' || doc.initialQuantity <= 0) {
      errors.push('initialQuantity must be a positive number');
    }
    if (typeof doc.availableQuantity !== 'number' || doc.availableQuantity < 0) {
      errors.push('availableQuantity must be a non-negative number');
    }
    if (doc.availableQuantity > doc.initialQuantity) {
      errors.push('availableQuantity cannot exceed initialQuantity');
    }
    if (typeof doc.unitCostPrice !== 'number' || doc.unitCostPrice < 0) {
      errors.push('unitCostPrice must be a number >= 0');
    }
    if (!doc.receivedDate || Number.isNaN(Date.parse(doc.receivedDate))) {
      errors.push('receivedDate must be a valid ISO date string');
    }
  }

  static _validateSupplier(doc, errors) {
    if (!doc.name || typeof doc.name !== 'string' || !doc.name.trim()) {
      errors.push('Supplier name is required');
    }
    if (doc.stateCode && !/^\d{2}$/.test(String(doc.stateCode))) {
      errors.push('stateCode must be a 2-digit Indian GST state code (e.g., "27")');
    }
    if (doc.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(doc.gstin)) {
      errors.push('gstin must match standard Indian GSTIN 15-character format');
    }
    if (doc.leadTimeDays !== undefined && (typeof doc.leadTimeDays !== 'number' || doc.leadTimeDays < 0)) {
      errors.push('leadTimeDays must be a number >= 0');
    }
  }

  static _validatePurchaseOrder(doc, errors) {
    if (!doc.poNumber || typeof doc.poNumber !== 'string') {
      errors.push('poNumber is required');
    }
    if (!doc.supplierId || typeof doc.supplierId !== 'string') {
      errors.push('supplierId is required');
    }
    if (!Object.values(PO_STATUS).includes(doc.status)) {
      errors.push(`status must be one of: ${Object.values(PO_STATUS).join(', ')}`);
    }
    if (!Array.isArray(doc.items) || doc.items.length === 0) {
      errors.push('Purchase order must contain at least one item');
    } else {
      for (let i = 0; i < doc.items.length; i++) {
        const item = doc.items[i];
        if (!item.skuId) errors.push(`Item[${i}].skuId is required`);
        if (typeof item.orderedQuantity !== 'number' || item.orderedQuantity <= 0) {
          errors.push(`Item[${i}].orderedQuantity must be > 0`);
        }
        if (typeof item.unitCostPrice !== 'number' || item.unitCostPrice < 0) {
          errors.push(`Item[${i}].unitCostPrice must be >= 0`);
        }
      }
    }
  }

  static _validateInvoice(doc, errors) {
    if (!doc.invoiceNumber || typeof doc.invoiceNumber !== 'string') {
      errors.push('invoiceNumber is required');
    }
    if (!doc.customerName || typeof doc.customerName !== 'string') {
      errors.push('customerName is required');
    }
    if (!doc.customerStateCode || !/^\d{2}$/.test(String(doc.customerStateCode))) {
      errors.push('customerStateCode must be a 2-digit GST state code');
    }
    if (!Array.isArray(doc.items) || doc.items.length === 0) {
      errors.push('Invoice must contain at least one line item');
    } else {
      for (let i = 0; i < doc.items.length; i++) {
        const item = doc.items[i];
        if (!item.skuId) errors.push(`Invoice item[${i}].skuId is required`);
        if (typeof item.quantity !== 'number' || item.quantity <= 0) {
          errors.push(`Invoice item[${i}].quantity must be > 0`);
        }
        if (typeof item.unitPrice !== 'number' || item.unitPrice < 0) {
          errors.push(`Invoice item[${i}].unitPrice must be >= 0`);
        }
      }
    }
  }

  static _validateCreditNote(doc, errors) {
    if (!doc.creditNoteNumber || typeof doc.creditNoteNumber !== 'string') {
      errors.push('creditNoteNumber is required');
    }
    if (!doc.invoiceId || typeof doc.invoiceId !== 'string') {
      errors.push('invoiceId is required');
    }
    if (!Array.isArray(doc.items) || doc.items.length === 0) {
      errors.push('Credit note must include at least one returned item');
    }
  }
}
