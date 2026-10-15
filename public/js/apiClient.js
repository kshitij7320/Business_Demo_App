import { Toast } from './components/toast.js';

const BASE_URL = '/api/v1';

/**
 * Universal JSON Fetch wrapper with error handling and toast alerts.
 * @param {string} endpoint
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  try {
    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = data.error?.message || `Request failed with status ${res.status}`;
      Toast.error(msg);
      throw new Error(msg);
    }

    return data.data;
  } catch (err) {
    if (err.message.includes('Failed to fetch') || !navigator.onLine) {
      Toast.error('Network error: Unable to reach StockPulse server.');
    }
    throw err;
  }
}

export const api = {
  health: () => request('/health'),

  inventory: {
    listSkus: () => request('/inventory/skus'),
    getSku: (id) => request(`/inventory/skus/${id}`),
    createSku: (data) => request('/inventory/skus', { method: 'POST', body: JSON.stringify(data) }),
    updateSku: (id, data) => request(`/inventory/skus/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    receiveStock: (skuId, data) => request(`/inventory/skus/${skuId}/receive`, { method: 'POST', body: JSON.stringify(data) }),
    depleteStock: (skuId, data) => request(`/inventory/skus/${skuId}/deplete`, { method: 'POST', body: JSON.stringify(data) }),
    getReorderAlerts: () => request('/inventory/alerts/reorder'),
    getDeadStock: () => request('/inventory/diagnostics/dead-stock')
  },

  billing: {
    listInvoices: () => request('/billing/invoices'),
    getInvoice: (id) => request(`/billing/invoices/${id}`),
    createInvoice: (data) => request('/billing/invoices', { method: 'POST', body: JSON.stringify(data) }),
    calculateQuote: (data) => request('/billing/quote', { method: 'POST', body: JSON.stringify(data) }),
    listCreditNotes: () => request('/billing/credit-notes'),
    createCreditNote: (data) => request('/billing/credit-notes', { method: 'POST', body: JSON.stringify(data) })
  },

  suppliers: {
    listSuppliers: () => request('/suppliers'),
    getSupplier: (id) => request(`/suppliers/${id}`),
    createSupplier: (data) => request('/suppliers', { method: 'POST', body: JSON.stringify(data) }),
    listPurchaseOrders: (params = '') => request(`/suppliers/purchase-orders${params}`),
    getPurchaseOrder: (id) => request(`/suppliers/purchase-orders/${id}`),
    createPurchaseOrder: (data) => request('/suppliers/purchase-orders', { method: 'POST', body: JSON.stringify(data) }),
    updatePoStatus: (id, status) => request(`/suppliers/purchase-orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    receiveShipment: (id, receipts) => request(`/suppliers/purchase-orders/${id}/receive`, { method: 'POST', body: JSON.stringify({ receipts }) }),
    getPayableAging: () => request('/suppliers/reports/payable-aging')
  },

  analytics: {
    getDashboard: () => request('/analytics/dashboard'),
    getTimeline: (interval = 'daily') => request(`/analytics/timeline?interval=${interval}`),
    exportInventoryCsvUrl: `${BASE_URL}/analytics/export/inventory.csv`
  }
};
