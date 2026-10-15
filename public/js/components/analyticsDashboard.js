import { api } from '../apiClient.js';
import { formatINR } from '../utils/formatters.js';

export async function renderAnalyticsDashboard(container) {
  container.innerHTML = `
    <div class="loader-container"><div class="spinner"></div><p>Calculating Analytics & Turnover Ratios...</p></div>
  `;

  try {
    const [{ kpis, turnover }, timeline, deadStock] = await Promise.all([
      api.analytics.getDashboard(),
      api.analytics.getTimeline('daily'),
      api.inventory.getDeadStock()
    ]);

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Executive Analytics & Performance</h1>
          <p class="page-subtitle">Inventory turnover, gross profit margins, statutory GST yield, and working capital</p>
        </div>
        <div class="header-actions">
          <a href="${api.analytics.exportInventoryCsvUrl}" download class="btn btn-secondary">
            📥 Export Inventory CSV
          </a>
        </div>
      </div>

      <!-- Core KPI Grid -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Current Stock Asset Value</div>
          <div class="kpi-value" style="color: #818cf8;">${formatINR(kpis.totalInventoryValue)}</div>
          <div class="kpi-meta">${kpis.activeSkuCount} registered SKUs</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Total Revenue (Taxable)</div>
          <div class="kpi-value" style="color: #38bdf8;">${formatINR(kpis.totalRevenue)}</div>
          <div class="kpi-meta">Net of trade discounts</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Cost of Goods Sold (COGS)</div>
          <div class="kpi-value" style="color: var(--text-muted);">${formatINR(kpis.totalCogs)}</div>
          <div class="kpi-meta">Depleted batch lots cost</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Gross Profit & Margin</div>
          <div class="kpi-value" style="color: var(--success);">
            ${formatINR(kpis.grossProfit)}
          </div>
          <div class="kpi-meta">
            <span class="badge badge-success">${kpis.grossMarginPercentage}% Margin</span>
          </div>
        </div>
      </div>

      <!-- Inventory Turnover & Efficiency Metrics -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Inventory Turnover Ratio</div>
          <div class="kpi-value" style="color: #fbbf24;">${turnover.turnoverRatio}x</div>
          <div class="kpi-meta">COGS / Avg Inventory Value</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Days Sales of Inventory (DSI)</div>
          <div class="kpi-value" style="color: #fbbf24;">${turnover.daysSalesOfInventory} days</div>
          <div class="kpi-meta">Average days to turn inventory</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Total Statutory GST Collected</div>
          <div class="kpi-value" style="color: #a78bfa;">${formatINR(kpis.totalTaxCollected)}</div>
          <div class="kpi-meta">CGST: ${formatINR(kpis.taxSummary.cgst)} | SGST: ${formatINR(kpis.taxSummary.sgst)} | IGST: ${formatINR(kpis.taxSummary.igst)}</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Dead Stock Capital Tied Up</div>
          <div class="kpi-value" style="color: ${deadStock.totalDeadStockValue > 0 ? 'var(--danger)' : 'var(--text-muted)'};">
            ${formatINR(deadStock.totalDeadStockValue)}
          </div>
          <div class="kpi-meta">${deadStock.deadStockBatches.length} stagnant lots (>90 days)</div>
        </div>
      </div>

      <!-- Revenue & Profit Trend Timeline -->
      <div class="panel">
        <div class="panel-header">
          <h2 class="panel-title">Sales & Profit Timeline</h2>
        </div>

        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Date / Period</th>
                <th>Invoices Settled</th>
                <th>Net Revenue</th>
                <th>COGS</th>
                <th>Gross Margin (₹)</th>
              </tr>
            </thead>
            <tbody>
              ${timeline.length === 0 ? `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">No sales transactions recorded yet.</td></tr>` : ''}
              ${timeline.map(row => `
                <tr>
                  <td><strong>${row.period}</strong></td>
                  <td>${row.orderCount}</td>
                  <td>${formatINR(row.revenue)}</td>
                  <td style="color: var(--text-muted);">${formatINR(row.cogs)}</td>
                  <td><strong style="color: var(--success);">+${formatINR(row.grossProfit)}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="panel" style="border-left: 4px solid var(--danger);"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}
