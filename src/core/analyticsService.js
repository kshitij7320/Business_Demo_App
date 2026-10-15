import { COLLECTIONS, PO_STATUS } from '../config/constants.js';

/**
 * Analytics and Reporting Service.
 * Computes financial metrics, inventory turnover ratios, profit margins,
 * tax collection summaries, and formats data into CSV or JSON reports.
 */
export class AnalyticsService {
  /**
   * @param {import('../storage/dataStore.js').DataStore} dataStore
   * @param {import('./inventoryEngine.js').InventoryEngine} inventoryEngine
   */
  constructor(dataStore, inventoryEngine) {
    this.store = dataStore;
    this.inventory = inventoryEngine;
  }

  /**
   * Computes high-level Key Performance Indicators (KPIs).
   * @returns {{
   *   totalInventoryValue: number,
   *   activeSkuCount: number,
   *   totalRevenue: number,
   *   totalCogs: number,
   *   grossProfit: number,
   *   grossMarginPercentage: number,
   *   lowStockAlertsCount: number,
   *   openPurchaseOrdersCount: number,
   *   totalTaxCollected: number
   * }}
   */
  getDashboardKpis() {
    const skus = this.store.find(COLLECTIONS.SKUS);
    const batches = this.store.find(COLLECTIONS.BATCHES, b => b.availableQuantity > 0);
    const invoices = this.store.find(COLLECTIONS.INVOICES);
    const openPos = this.store.find(
      COLLECTIONS.PURCHASE_ORDERS,
      p => [PO_STATUS.DRAFT, PO_STATUS.ISSUED, PO_STATUS.PARTIALLY_RECEIVED].includes(p.status)
    );

    const totalInventoryValue = batches.reduce((sum, b) => {
      return sum + (b.availableQuantity * b.unitCostPrice);
    }, 0);

    let totalRevenue = 0;
    let totalCogs = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;

    for (const inv of invoices) {
      totalRevenue += (inv.taxableAmount || 0);
      totalCogs += (inv.totalCogs || 0);
      totalCgst += (inv.cgstAmount || 0);
      totalSgst += (inv.sgstAmount || 0);
      totalIgst += (inv.igstAmount || 0);
    }

    const grossProfit = totalRevenue - totalCogs;
    const grossMarginPercentage = totalRevenue > 0
      ? Math.round((grossProfit / totalRevenue) * 10000) / 100
      : 0;

    const lowStockAlerts = this.inventory.computeReorderThresholds().filter(item => item.isLowStock);

    return {
      totalInventoryValue: Math.round(totalInventoryValue * 100) / 100,
      activeSkuCount: skus.length,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalCogs: Math.round(totalCogs * 100) / 100,
      grossProfit: Math.round(grossProfit * 100) / 100,
      grossMarginPercentage,
      lowStockAlertsCount: lowStockAlerts.length,
      openPurchaseOrdersCount: openPos.length,
      totalTaxCollected: Math.round((totalCgst + totalSgst + totalIgst) * 100) / 100,
      taxSummary: {
        cgst: Math.round(totalCgst * 100) / 100,
        sgst: Math.round(totalSgst * 100) / 100,
        igst: Math.round(totalIgst * 100) / 100
      }
    };
  }

  /**
   * Computes Inventory Turnover Ratio and Days Sales of Inventory (DSI).
   * Formula: Turnover = COGS / Average Inventory Value
   * DSI = 365 / Turnover
   * @param {number} [daysPeriod=365]
   * @returns {{
   *   cogs: number,
   *   currentInventoryValue: number,
   *   turnoverRatio: number,
   *   daysSalesOfInventory: number
   * }}
   */
  calculateInventoryTurnover(daysPeriod = 365) {
    const cutoffTime = Date.now() - (daysPeriod * 24 * 60 * 60 * 1000);
    const invoices = this.store.find(
      COLLECTIONS.INVOICES,
      inv => new Date(inv.invoiceDate).getTime() >= cutoffTime
    );

    const periodCogs = invoices.reduce((sum, inv) => sum + (inv.totalCogs || 0), 0);

    const activeBatches = this.store.find(COLLECTIONS.BATCHES, b => b.availableQuantity > 0);
    const currentInventoryValue = activeBatches.reduce(
      (sum, b) => sum + (b.availableQuantity * b.unitCostPrice),
      0
    );

    const averageInventory = currentInventoryValue > 0 ? currentInventoryValue : 1;
    const turnoverRatio = Math.round((periodCogs / averageInventory) * 100) / 100;
    const daysSalesOfInventory = turnoverRatio > 0 ? Math.round(daysPeriod / turnoverRatio) : 0;

    return {
      cogs: Math.round(periodCogs * 100) / 100,
      currentInventoryValue: Math.round(currentInventoryValue * 100) / 100,
      turnoverRatio,
      daysSalesOfInventory
    };
  }

  /**
   * Aggregates revenue, costs, and profit by daily or monthly time intervals.
   * @param {'daily'|'monthly'} [interval='daily']
   * @param {number} [limit=30]
   * @returns {Array<{ period: string, revenue: number, cogs: number, grossProfit: number, orderCount: number }>}
   */
  getRevenueTimeline(interval = 'daily', limit = 30) {
    const invoices = this.store.find(COLLECTIONS.INVOICES);
    // Sort chronological
    invoices.sort((a, b) => new Date(a.invoiceDate).getTime() - new Date(b.invoiceDate).getTime());

    const aggregated = new Map();

    for (const inv of invoices) {
      const date = new Date(inv.invoiceDate);
      let key;
      if (interval === 'monthly') {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      } else {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      }

      if (!aggregated.has(key)) {
        aggregated.set(key, { period: key, revenue: 0, cogs: 0, grossProfit: 0, orderCount: 0 });
      }

      const row = aggregated.get(key);
      const rev = inv.taxableAmount || 0;
      const cogs = inv.totalCogs || 0;
      row.revenue += rev;
      row.cogs += cogs;
      row.grossProfit += (rev - cogs);
      row.orderCount += 1;
    }

    const result = Array.from(aggregated.values()).map(r => ({
      period: r.period,
      revenue: Math.round(r.revenue * 100) / 100,
      cogs: Math.round(r.cogs * 100) / 100,
      grossProfit: Math.round(r.grossProfit * 100) / 100,
      orderCount: r.orderCount
    }));

    return result.slice(-limit);
  }

  /**
   * Formats arbitrary structured datasets into clean CSV strings.
   * Handles escaping, embedded commas, and quotes.
   * @param {Array<Record<string, any>>} data
   * @param {string[]} [columns]
   * @returns {string}
   */
  formatAsCsv(data, columns = null) {
    if (!Array.isArray(data) || data.length === 0) {
      return '';
    }

    const headers = columns || Object.keys(data[0]);
    const escapeCell = (val) => {
      if (val === null || val === undefined) return '';
      const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headerLine = headers.join(',');
    const rows = data.map(row => {
      return headers.map(header => escapeCell(row[header])).join(',');
    });

    return [headerLine, ...rows].join('\n');
  }

  /**
   * Generates a comprehensive CSV export of inventory stock levels.
   * @returns {string}
   */
  exportInventoryCsv() {
    const skus = this.store.find(COLLECTIONS.SKUS);
    const rows = skus.map(sku => {
      const stock = this.inventory.getStockLevel(sku.id);
      return {
        skuCode: sku.skuCode,
        name: sku.name,
        category: sku.category,
        unit: sku.unit,
        hsnCode: sku.hsnCode,
        sellingPrice: sku.sellingPrice,
        taxRate: sku.taxRate,
        availableQuantity: stock.totalAvailable,
        reorderPoint: sku.reorderPoint,
        leadTimeDays: sku.leadTimeDays
      };
    });

    return this.formatAsCsv(rows);
  }
}
