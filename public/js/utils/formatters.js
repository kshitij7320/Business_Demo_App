/**
 * Formats a numeric value into Indian Rupee currency format (₹).
 * @param {number} amount
 * @returns {string}
 */
export function formatINR(amount) {
  if (amount === undefined || amount === null || Number.isNaN(amount)) {
    return '₹0.00';
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

/**
 * Formats an ISO date string into a user-friendly date and time.
 * @param {string} isoString
 * @returns {string}
 */
export function formatDate(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

/**
 * Renders an HTML status badge for Purchase Orders or Invoices.
 * @param {string} status
 * @returns {string}
 */
export function renderStatusBadge(status) {
  switch (status) {
    case 'PAID':
    case 'FULFILLED':
      return `<span class="badge badge-success">${status}</span>`;
    case 'ISSUED':
    case 'PARTIALLY_RECEIVED':
      return `<span class="badge badge-warning">${status.replace('_', ' ')}</span>`;
    case 'DRAFT':
    case 'UNPAID':
      return `<span class="badge badge-info">${status}</span>`;
    case 'CANCELLED':
      return `<span class="badge badge-danger">${status}</span>`;
    default:
      return `<span class="badge badge-info">${status}</span>`;
  }
}
