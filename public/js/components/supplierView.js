import { api } from '../apiClient.js';
import { formatINR, formatDate, renderStatusBadge } from '../utils/formatters.js';
import { openModal, closeModal } from '../utils/dom.js';
import { Toast } from './toast.js';

export async function renderSupplierView(container) {
  container.innerHTML = `
    <div class="loader-container"><div class="spinner"></div><p>Loading Procurement Engine...</p></div>
  `;

  try {
    const [suppliers, purchaseOrders, agingReport] = await Promise.all([
      api.suppliers.listSuppliers(),
      api.suppliers.listPurchaseOrders(),
      api.suppliers.getPayableAging()
    ]);

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Suppliers & Procurement</h1>
          <p class="page-subtitle">Vendor lead-time tracking, PO state machine, and accounts payable aging</p>
        </div>
        <div class="header-actions">
          <button class="btn btn-secondary" id="btn-add-supplier">+ New Vendor</button>
          <button class="btn btn-primary" id="btn-new-po">+ Issue Purchase Order</button>
        </div>
      </div>

      <!-- Accounts Payable Aging Quick Summary -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Total Outstanding Payables</div>
          <div class="kpi-value" style="color: #818cf8;">${formatINR(agingReport.summary.totalPayable)}</div>
          <div class="kpi-meta">Across all fulfilled purchase orders</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Current (0 - 30 Days)</div>
          <div class="kpi-value" style="color: var(--success);">${formatINR(agingReport.summary.current)}</div>
          <div class="kpi-meta">Within standard credit terms</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">31 - 60 Days Due</div>
          <div class="kpi-value" style="color: var(--warning);">${formatINR(agingReport.summary.days31to60)}</div>
          <div class="kpi-meta">Approaching due date</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Over 60 Days Overdue</div>
          <div class="kpi-value" style="color: var(--danger);">${formatINR(agingReport.summary.days61to90 + agingReport.summary.over90)}</div>
          <div class="kpi-meta">Attention required</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h2 class="panel-title">Purchase Orders Lifecycle (${purchaseOrders.length})</h2>
        </div>

        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>PO Number</th>
                <th>Order Date</th>
                <th>Supplier</th>
                <th>Items Ordered</th>
                <th>Subtotal</th>
                <th>Total (w/ GST)</th>
                <th>Status</th>
                <th>Lifecycle Action</th>
              </tr>
            </thead>
            <tbody>
              ${purchaseOrders.length === 0 ? `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">No purchase orders generated. Click "+ Issue Purchase Order" above.</td></tr>` : ''}
              ${purchaseOrders.map(po => {
                const totalOrdered = po.items.reduce((s, i) => s + i.orderedQuantity, 0);
                const totalReceived = po.items.reduce((s, i) => s + i.receivedQuantity, 0);
                let actionBtn = '';

                if (po.status === 'DRAFT') {
                  actionBtn = `<button class="btn btn-primary btn-sm btn-issue-po" data-id="${po.id}">Issue PO</button>`;
                } else if (['ISSUED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
                  actionBtn = `<button class="btn btn-secondary btn-sm btn-receive-shipment" data-id="${po.id}">+ Receive Shipment</button>`;
                } else {
                  actionBtn = `<span style="color: var(--text-muted); font-size: 0.8rem;">Completed</span>`;
                }

                return `
                  <tr>
                    <td><span class="mono-code" style="color: #818cf8; font-weight: 700;">${po.poNumber}</span></td>
                    <td>${formatDate(po.orderDate)}</td>
                    <td><strong>${po.supplierName}</strong></td>
                    <td>${totalReceived} / ${totalOrdered} received</td>
                    <td>${formatINR(po.subtotal)}</td>
                    <td><strong>${formatINR(po.totalAmount)}</strong></td>
                    <td>${renderStatusBadge(po.status)}</td>
                    <td>${actionBtn}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h2 class="panel-title">Approved Supplier Directory (${suppliers.length})</h2>
        </div>
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Supplier Name</th>
                <th>GSTIN</th>
                <th>State</th>
                <th>Lead Time (Days)</th>
                <th>Payment Terms</th>
                <th>Rating</th>
              </tr>
            </thead>
            <tbody>
              ${suppliers.length === 0 ? `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No suppliers registered. Click "+ New Vendor" above.</td></tr>` : ''}
              ${suppliers.map(s => `
                <tr>
                  <td><strong>${s.name}</strong></td>
                  <td><span class="mono-code">${s.gstin || 'Unregistered'}</span></td>
                  <td>${s.stateCode}</td>
                  <td><strong>${s.leadTimeDays} days</strong> avg</td>
                  <td>Net ${s.paymentTermsDays || 30} days</td>
                  <td>⭐ ${s.rating || 5}/5</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Bind action buttons
    document.getElementById('btn-add-supplier')?.addEventListener('click', () => {
      openAddSupplierModal(() => renderSupplierView(container));
    });

    document.getElementById('btn-new-po')?.addEventListener('click', async () => {
      const skus = await api.inventory.listSkus();
      openNewPoModal(suppliers, skus, () => renderSupplierView(container));
    });

    document.querySelectorAll('.btn-issue-po').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        try {
          await api.suppliers.updatePoStatus(id, 'ISSUED');
          Toast.success('Purchase Order issued to vendor!');
          renderSupplierView(container);
        } catch (err) {
          Toast.error(err.message);
        }
      });
    });

    document.querySelectorAll('.btn-receive-shipment').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const po = purchaseOrders.find(p => p.id === id);
        if (po) {
          openReceiveShipmentModal(po, () => renderSupplierView(container));
        }
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="panel" style="border-left: 4px solid var(--danger);"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function openAddSupplierModal(onSuccess) {
  const html = `
    <form id="form-supplier">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Vendor Name *</label>
          <input type="text" id="supp-name" class="form-control" placeholder="e.g. Apex Industrial Supplies" required>
        </div>
        <div class="form-group">
          <label class="form-label">GSTIN (15 Digits)</label>
          <input type="text" id="supp-gstin" class="form-control" placeholder="27AAAAA0000A1Z5">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">State Code (2 Digits)</label>
          <input type="text" id="supp-state" class="form-control" value="27" maxlength="2">
        </div>
        <div class="form-group">
          <label class="form-label">Promised Lead Time (Days)</label>
          <input type="number" id="supp-lead" class="form-control" value="7" min="1">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Payment Terms (Days)</label>
          <input type="number" id="supp-terms" class="form-control" value="30" min="0">
        </div>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1.5rem;">
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('app-modal').close()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Vendor</button>
      </div>
    </form>
  `;

  openModal('Register Approved Vendor', html, (el) => {
    el.querySelector('#form-supplier')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.suppliers.createSupplier({
          name: el.querySelector('#supp-name').value,
          gstin: el.querySelector('#supp-gstin').value || undefined,
          stateCode: el.querySelector('#supp-state').value,
          leadTimeDays: Number(el.querySelector('#supp-lead').value),
          paymentTermsDays: Number(el.querySelector('#supp-terms').value)
        });
        Toast.success('Vendor registered successfully!');
        closeModal();
        if (onSuccess) onSuccess();
      } catch (err) {
        Toast.error(err.message);
      }
    });
  });
}

function openNewPoModal(suppliers, skus, onSuccess) {
  if (suppliers.length === 0) {
    Toast.error('Please register at least one vendor before issuing purchase orders.');
    return;
  }
  if (skus.length === 0) {
    Toast.error('Please register SKU items first.');
    return;
  }

  const supplierOptions = suppliers.map(s => `<option value="${s.id}">${s.name} (Lead Time: ${s.leadTimeDays}d)</option>`).join('');
  const skuOptions = skus.map(s => `<option value="${s.id}">${s.skuCode} - ${s.name}</option>`).join('');

  const html = `
    <form id="form-new-po">
      <div class="form-group">
        <label class="form-label">Target Supplier / Vendor *</label>
        <select id="po-supplier-select" class="form-control" required>
          ${supplierOptions}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Select SKU to Procure *</label>
          <select id="po-sku-select" class="form-control" required>
            ${skuOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Quantity *</label>
          <input type="number" id="po-qty" class="form-control" min="1" value="50" required>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Agreed Unit Cost Price (₹) *</label>
        <input type="number" id="po-unit-cost" class="form-control" step="0.01" min="0" required placeholder="Cost per unit">
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1.5rem;">
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('app-modal').close()">Cancel</button>
        <button type="submit" class="btn btn-primary">Create Draft PO</button>
      </div>
    </form>
  `;

  openModal('Issue New Purchase Order', html, (el) => {
    el.querySelector('#form-new-po')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.suppliers.createPurchaseOrder({
          supplierId: el.querySelector('#po-supplier-select').value,
          items: [
            {
              skuId: el.querySelector('#po-sku-select').value,
              orderedQuantity: Number(el.querySelector('#po-qty').value),
              unitCostPrice: Number(el.querySelector('#po-unit-cost').value)
            }
          ]
        });
        Toast.success('Purchase Order created in DRAFT state!');
        closeModal();
        if (onSuccess) onSuccess();
      } catch (err) {
        Toast.error(err.message);
      }
    });
  });
}

function openReceiveShipmentModal(po, onSuccess) {
  const itemsHtml = po.items.map(item => {
    const remaining = item.orderedQuantity - item.receivedQuantity;
    return `
      <div style="margin-bottom: 1rem; padding: 0.85rem; background: var(--bg-surface-elevated); border-radius: var(--radius-sm);">
        <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
          <strong>${item.skuCode} - ${item.skuName}</strong>
          <span style="color: var(--text-secondary); font-size: 0.82rem;">Pending: ${remaining} of ${item.orderedQuantity}</span>
        </div>
        <div class="form-row">
          <div class="form-group" style="margin-bottom: 0;">
            <label style="font-size: 0.75rem; color: var(--text-muted);">Quantity Arrived</label>
            <input type="number" class="form-control rx-po-qty" data-sku="${item.skuId}" min="0" max="${remaining}" value="${remaining}">
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label style="font-size: 0.75rem; color: var(--text-muted);">Batch Lot # (Optional)</label>
            <input type="text" class="form-control rx-po-batch" data-sku="${item.skuId}" placeholder="Auto">
          </div>
        </div>
      </div>
    `;
  }).join('');

  const html = `
    <form id="form-rx-shipment">
      <p style="margin-bottom: 1rem; color: var(--text-secondary);">
        Record incoming shipment intake for <strong>${po.poNumber}</strong> (${po.supplierName}).
      </p>

      ${itemsHtml}

      <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1.5rem;">
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('app-modal').close()">Cancel</button>
        <button type="submit" class="btn btn-primary">Deposit Shipment Into Inventory</button>
      </div>
    </form>
  `;

  openModal(`Receive Shipment: ${po.poNumber}`, html, (el) => {
    el.querySelector('#form-rx-shipment')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const receipts = [];

      el.querySelectorAll('.rx-po-qty').forEach(input => {
        const qty = Number(input.value);
        const skuId = input.getAttribute('data-sku');
        const batchEl = el.querySelector(`.rx-po-batch[data-sku="${skuId}"]`);
        const batchNumber = batchEl?.value?.trim();

        if (qty > 0) {
          receipts.push({
            skuId,
            quantityReceived: qty,
            batchNumber: batchNumber || undefined
          });
        }
      });

      if (receipts.length === 0) {
        Toast.error('Please specify at least 1 received quantity.');
        return;
      }

      try {
        await api.suppliers.receiveShipment(po.id, receipts);
        Toast.success('Shipment received and added to inventory lots!');
        closeModal();
        if (onSuccess) onSuccess();
      } catch (err) {
        Toast.error(err.message);
      }
    });
  });
}
