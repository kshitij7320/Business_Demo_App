/**
 * Supported GST tax rate slabs in India (percentage values).
 */
export const GST_SLABS = Object.freeze([0, 5, 12, 18, 28]);

/**
 * Standard inventory valuation methods.
 */
export const VALUATION_METHODS = Object.freeze({
  FIFO: 'FIFO',
  LIFO: 'LIFO'
});

/**
 * Purchase Order lifecycle states.
 */
export const PO_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  ISSUED: 'ISSUED',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
  FULFILLED: 'FULFILLED',
  CANCELLED: 'CANCELLED'
});

/**
 * Valid state transitions for Purchase Orders.
 */
export const PO_TRANSITIONS = Object.freeze({
  [PO_STATUS.DRAFT]: [PO_STATUS.ISSUED, PO_STATUS.CANCELLED],
  [PO_STATUS.ISSUED]: [PO_STATUS.PARTIALLY_RECEIVED, PO_STATUS.FULFILLED, PO_STATUS.CANCELLED],
  [PO_STATUS.PARTIALLY_RECEIVED]: [PO_STATUS.FULFILLED, PO_STATUS.CANCELLED],
  [PO_STATUS.FULFILLED]: [],
  [PO_STATUS.CANCELLED]: []
});

/**
 * Invoice lifecycle statuses.
 */
export const INVOICE_STATUS = Object.freeze({
  PAID: 'PAID',
  UNPAID: 'UNPAID',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED'
});

/**
 * Standard storage collection identifiers.
 */
export const COLLECTIONS = Object.freeze({
  SKUS: 'skus',
  BATCHES: 'batches',
  TRANSACTIONS: 'stock_transactions',
  INVOICES: 'invoices',
  CREDIT_NOTES: 'credit_notes',
  SUPPLIERS: 'suppliers',
  PURCHASE_ORDERS: 'purchase_orders',
  COUNTERS: 'counters'
});

/**
 * Standard unit of measurement codes.
 */
export const UNITS_OF_MEASUREMENT = Object.freeze([
  'PCS', 'KG', 'LITER', 'BOX', 'METER', 'PACK', 'UNIT'
]);
