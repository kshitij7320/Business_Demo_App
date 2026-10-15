import { api } from '../apiClient.js';
import { formatINR } from '../utils/formatters.js';
import { openModal, closeModal } from '../utils/dom.js';
import { Toast } from './toast.js';

export async function renderInventoryView(container) {
  container.innerHTML = `
    <div class="loader-container"><div class="spinner"></div><p>Fetching inventory...</p></div>
  `;

  try {
    const [skus, alerts, deadStock] = await Promise.all([
      api.inventory.listSkus(),
      api.inventory.getReorderAlerts(),
      api.inventory.getDeadStock()
    ]);

    const lowStockCount = alerts.filter(a => a.isLowStock).length;

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Inventory & Stock Tracking</h1>
          <p class="page-subtitle">Batch tracking, dynamic reorder thresholds, and FIFO/LIFO valuation</p>
        </div>
        <div class="header-actions">
          <button class="btn btn-primary" id="btn-add-sku">
            <span>+</span> Register New SKU
          </button>
        </div>
      </div>

      ${lowStockCount > 0 ? `
        <div class="panel" style="border-left: 4px solid var(--warning); background: rgba(245, 158, 11, 0.06);">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <span style="font-size: 1.5rem;">⚠️</span>
              <div>
                <strong>${lowStockCount} SKU(s) reached Reorder Point (ROP)</strong>
                <p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.1rem;">
                  Items need replenishment based on average daily demand and vendor lead times.
                </p>
              </div>
            </div>
            <button class="btn btn-secondary btn-sm" id="btn-view-reorder-alerts">Inspect ROP Alerts</button>
          </div>
        </div>
      ` : ''}

      <div class="panel">
        <div class="panel-header">
          <h2 class="panel-title">Active SKU Master Catalog (${skus.length})</h2>
          <input type="text" id="sku-search" class="form-control" placeholder="Search by SKU code, name, category..." style="max-width: 320px;">
        </div>

        <div class="table-wrapper">
          <table class="data-table" id="sku-table">
            <thead>
              <tr>
                <th>SKU Code</th>
                <th>Item Name</th>
                <th>Category</th>
                <th>HSN</th>
                <th>Tax Rate</th>
                <th>Selling Price</th>
                <th>Available Stock</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="sku-table-body">
              ${renderSkuRows(skus, alerts)}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Bind Search Filtering
    const searchInput = document.getElementById('sku-search');
    searchInput?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = skus.filter(s =>
        s.skuCode.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.category && s.category.toLowerCase().includes(q))
      );
      const tbody = document.getElementById('sku-table-body');
      if (tbody) tbody.innerHTML = renderSkuRows(filtered, alerts);
      bindRowActions(filtered);
    });

    // Bind Add SKU Modal
    document.getElementById('btn-add-sku')?.addEventListener('click', () => openAddSkuModal(() => renderInventoryView(container)));

    // Bind Reorder Alerts Inspector
    document.getElementById('btn-view-reorder-alerts')?.addEventListener('click', () => {
      openReorderModal(alerts.filter(a => a.isLowStock));
    });

    bindRowActions(skus);

  } catch (err) {
    container.innerHTML = `
      <div class="panel" style="border-left: 4px solid var(--danger);">
        <h3>Failed to load inventory</h3>
        <p style="color: var(--text-secondary);">${err.message}</p>
        <button class="btn btn-secondary" style="margin-top: 1rem;" onclick="location.reload()">Retry</button>
      </div>
    `;
  }
}

function renderSkuRows(skus, alerts) {
  if (skus.length === 0) {
    return `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 2rem;">No items found. Click "Register New SKU" above.</td></tr>`;
  }

  const alertMap = new Map(alerts.map(a => [a.sku.id, a]));

  return skus.map(sku => {
    const alertInfo = alertMap.get(sku.id);
    const isLow = alertInfo?.isLowStock;
    const statusPill = isLow
      ? `<span class="badge badge-warning">Low Stock</span>`
      : sku.totalStock > 0
        ? `<span class="badge badge-success">In Stock</span>`
        : `<span class="badge badge-danger">Out of Stock</span>`;

    return `
      <tr data-sku-id="${sku.id}">
        <td><span class="mono-code" style="color: #818cf8; font-weight: 700;">${sku.skuCode}</span></td>
        <td><strong>${sku.name}</strong></td>
        <td><span class="badge badge-info">${sku.category || 'General'}</span></td>
        <td><span class="mono-code">${sku.hsnCode || '9999'}</span></td>
        <td>${sku.taxRate}%</td>
        <td><strong>${formatINR(sku.sellingPrice)}</strong></td>
        <td>
          <span style="font-weight: 700; ${isLow ? 'color: var(--warning);' : ''}">
            ${sku.totalStock || 0} ${sku.unit || 'PCS'}
          </span>
        </td>
        <td>${statusPill}</td>
        <td>
          <div style="display: flex; gap: 0.4rem;">
            <button class="btn btn-secondary btn-sm btn-receive" data-id="${sku.id}" title="Receive Stock Lot">+ Intake</button>
            <button class="btn btn-secondary btn-sm btn-batches" data-id="${sku.id}" title="View Lot Batches">Lots (${sku.batchCount || 0})</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function bindRowActions(skus) {
  document.querySelectorAll('.btn-receive').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const sku = skus.find(s => s.id === id);
      if (sku) openReceiveModal(sku);
    });
  });

  document.querySelectorAll('.btn-batches').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      try {
        const fullSku = await api.inventory.getSku(id);
        openBatchesModal(fullSku);
      } catch (err) {
        Toast.error(err.message);
      }
    });
  });
}

function openAddSkuModal(onSuccess) {
  const html = `
    <form id="form-add-sku">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">SKU Code *</label>
          <input type="text" id="skuCode" class="form-control" placeholder="e.g. ELEC-001" required>
        </div>
        <div class="form-group">
          <label class="form-label">Item Name *</label>
          <input type="text" id="name" class="form-control" placeholder="Full descriptive name" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Category</label>
          <input type="text" id="category" class="form-control" placeholder="e.g. Hardware, Cable">
        </div>
        <div class="form-group">
          <label class="form-label">Unit of Measurement</label>
          <select id="unit" class="form-control">
            <option value="PCS">PCS</option>
            <option value="KG">KG</option>
            <option value="BOX">BOX</option>
            <option value="LITER">LITER</option>
            <option value="METER">METER</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Selling Price (₹) *</label>
          <input type="number" id="sellingPrice" class="form-control" step="0.01" min="0" required>
        </div>
        <div class="form-group">
          <label class="form-label">GST Tax Rate Slab</label>
          <select id="taxRate" class="form-control">
            <option value="0">0% (Nil)</option>
            <option value="5">5%</option>
            <option value="12">12%</option>
            <option value="18" selected>18% (Standard)</option>
            <option value="28">28% (Luxury)</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Reorder Point (ROP)</label>
          <input type="number" id="reorderPoint" class="form-control" value="10" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">Safety Stock</label>
          <input type="number" id="safetyStock" class="form-control" value="5" min="0">
        </div>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1.5rem;">
        <button type="button" class="btn btn-secondary" id="modal-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">Save SKU</button>
      </div>
    </form>
  `;

  openModal('Register New SKU Master', html, (el) => {
    el.querySelector('#modal-cancel')?.addEventListener('click', closeModal);
    el.querySelector('#form-add-sku')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.inventory.createSku({
          skuCode: el.querySelector('#skuCode').value,
          name: el.querySelector('#name').value,
          category: el.querySelector('#category').value,
          unit: el.querySelector('#unit').value,
          sellingPrice: Number(el.querySelector('#sellingPrice').value),
          taxRate: Number(el.querySelector('#taxRate').value),
          reorderPoint: Number(el.querySelector('#reorderPoint').value),
          safetyStock: Number(el.querySelector('#safetyStock').value)
        });
        Toast.success('SKU registered successfully!');
        closeModal();
        if (onSuccess) onSuccess();
      } catch (err) {
        Toast.error(err.message);
      }
    });
  });
}

function openReceiveModal(sku) {
  const html = `
    <form id="form-receive-stock">
      <p style="margin-bottom: 1rem; color: var(--text-secondary);">
        Intake stock lot for <strong style="color: var(--text-primary);">${sku.skuCode} - ${sku.name}</strong>
      </p>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Quantity Received (${sku.unit}) *</label>
          <input type="number" id="rx-qty" class="form-control" min="1" required>
        </div>
        <div class="form-group">
          <label class="form-label">Unit Cost Price (₹) *</label>
          <input type="number" id="rx-cost" class="form-control" step="0.01" min="0" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Custom Lot / Batch # (Optional)</label>
          <input type="text" id="rx-batch" class="form-control" placeholder="Auto-generated if blank">
        </div>
        <div class="form-group">
          <label class="form-label">Expiry Date (Optional)</label>
          <input type="date" id="rx-expiry" class="form-control">
        </div>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1.5rem;">
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('app-modal').close()">Cancel</button>
        <button type="submit" class="btn btn-primary">Deposit to Inventory</button>
      </div>
    </form>
  `;

  openModal(`Intake Stock Lot: ${sku.skuCode}`, html, (el) => {
    el.querySelector('#form-receive-stock')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const qty = Number(el.querySelector('#rx-qty').value);
        const cost = Number(el.querySelector('#rx-cost').value);
        const batchNum = el.querySelector('#rx-batch').value.trim();
        const expiry = el.querySelector('#rx-expiry').value;

        await api.inventory.receiveStock(sku.id, {
          quantity: qty,
          unitCostPrice: cost,
          batchNumber: batchNum || undefined,
          expiryDate: expiry || undefined
        });

        Toast.success(`Deposited ${qty} ${sku.unit} into active inventory!`);
        closeModal();
        // Refresh table row or page
        location.reload();
      } catch (err) {
        Toast.error(err.message);
      }
    });
  });
}

function openBatchesModal(sku) {
  const batches = sku.stock?.batches || [];
  const body = `
    <div style="margin-bottom: 1rem;">
      <p style="color: var(--text-secondary);">
        Active FIFO/LIFO batch lots for <strong>${sku.skuCode} (${sku.name})</strong>
      </p>
    </div>
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>Batch Lot #</th>
            <th>Received Date</th>
            <th>Unit Cost</th>
            <th>Initial Qty</th>
            <th>Remaining Qty</th>
          </tr>
        </thead>
        <tbody>
          ${batches.length === 0 ? `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No active lots found.</td></tr>` : ''}
          ${batches.map(b => `
            <tr>
              <td><span class="mono-code" style="color: #a78bfa;">${b.batchNumber}</span></td>
              <td>${new Date(b.receivedDate).toLocaleDateString()}</td>
              <td><strong>${formatINR(b.unitCostPrice)}</strong></td>
              <td>${b.initialQuantity}</td>
              <td><strong style="color: var(--success);">${b.availableQuantity}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  openModal(`Lot Inspector: ${sku.skuCode}`, body);
}

function openReorderModal(alerts) {
  const html = `
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Current Stock</th>
            <th>Reorder Point (ROP)</th>
            <th>Suggested Order Qty</th>
          </tr>
        </thead>
        <tbody>
          ${alerts.map(a => `
            <tr>
              <td><strong>${a.sku.skuCode}</strong> - ${a.sku.name}</td>
              <td><strong style="color: var(--warning);">${a.currentStock}</strong></td>
              <td>${a.reorderPoint}</td>
              <td><strong style="color: #818cf8;">+${a.suggestedOrderQuantity}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  openModal('Low-Stock Reorder Thresholds', html);
}
