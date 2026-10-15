import { api } from '../apiClient.js';
import { formatINR, formatDate, renderStatusBadge } from '../utils/formatters.js';
import { openModal, closeModal } from '../utils/dom.js';
import { Toast } from './toast.js';

export async function renderInvoiceBuilder(container) {
  container.innerHTML = `
    <div class="loader-container"><div class="spinner"></div><p>Loading Billing & Tax Engine...</p></div>
  `;

  try {
    const [skus, invoices] = await Promise.all([
      api.inventory.listSkus(),
      api.billing.listInvoices()
    ]);

    let activeItems = [];

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">GST Billing & Invoicing</h1>
          <p class="page-subtitle">Statutory Indian GST calculation, atomic FIFO/LIFO depletion, and credit notes</p>
        </div>
        <div class="header-actions">
          <button class="btn btn-primary" id="tab-btn-create">Create Tax Invoice</button>
          <button class="btn btn-secondary" id="tab-btn-history">Invoice Archive (${invoices.length})</button>
        </div>
      </div>

      <div id="billing-content-panel"></div>
    `;

    const contentPanel = document.getElementById('billing-content-panel');

    const showCreateForm = () => {
      activeItems = [];
      contentPanel.innerHTML = `
        <div class="panel">
          <h2 class="panel-title" style="margin-bottom: 1.5rem;">New Tax Invoice Generator</h2>

          <form id="invoice-form">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Customer / Client Name *</label>
                <input type="text" id="cust-name" class="form-control" placeholder="e.g. Acme Tech Ltd" required>
              </div>
              <div class="form-group">
                <label class="form-label">Customer GSTIN (Optional)</label>
                <input type="text" id="cust-gstin" class="form-control" placeholder="15-character GSTIN (e.g. 27AAAAA0000A1Z5)">
              </div>
              <div class="form-group">
                <label class="form-label">Place of Supply (State Code) *</label>
                <select id="cust-state" class="form-control">
                  <option value="27" selected>27 - Maharashtra (Intra-State: CGST + SGST)</option>
                  <option value="07">07 - Delhi (Inter-State: IGST)</option>
                  <option value="29">29 - Karnataka (Inter-State: IGST)</option>
                  <option value="33">33 - Tamil Nadu (Inter-State: IGST)</option>
                  <option value="06">06 - Haryana (Inter-State: IGST)</option>
                  <option value="24">24 - Gujarat (Inter-State: IGST)</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Stock Valuation Method</label>
                <select id="inv-valuation" class="form-control">
                  <option value="FIFO" selected>FIFO (First-In, First-Out)</option>
                  <option value="LIFO">LIFO (Last-In, First-Out)</option>
                </select>
              </div>
            </div>

            <!-- Line Items Area -->
            <div style="margin: 2rem 0;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                <h3 style="font-size: 1rem; font-weight: 700;">Invoice Line Items</h3>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-add-line-item">+ Add Line Item</button>
              </div>

              <div class="table-wrapper">
                <table class="data-table" id="items-table">
                  <thead>
                    <tr>
                      <th>SKU Item</th>
                      <th>Available</th>
                      <th>Quantity</th>
                      <th>Unit Price (₹)</th>
                      <th>Discount (%)</th>
                      <th>Tax Rate</th>
                      <th>Taxable Val</th>
                      <th>Line Total</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody id="items-table-body">
                    <tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No items added yet. Click "+ Add Line Item" above.</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Real-time Tax Summary Breakdown Card -->
            <div style="display: flex; justify-content: flex-end;">
              <div style="min-width: 320px; background: var(--bg-surface-elevated); padding: 1.25rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 0.88rem;">
                  <span style="color: var(--text-secondary);">Subtotal (Gross):</span>
                  <span id="sum-subtotal">₹0.00</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 0.88rem;">
                  <span style="color: var(--text-secondary);">Discount:</span>
                  <span id="sum-discount" style="color: var(--warning);">-₹0.00</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 0.88rem;">
                  <span style="color: var(--text-secondary);">Taxable Amount:</span>
                  <span id="sum-taxable" style="font-weight: 600;">₹0.00</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 0.88rem;">
                  <span style="color: var(--text-secondary);">CGST:</span>
                  <span id="sum-cgst">₹0.00</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 0.88rem;">
                  <span style="color: var(--text-secondary);">SGST:</span>
                  <span id="sum-sgst">₹0.00</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 0.88rem;">
                  <span style="color: var(--text-secondary);">IGST:</span>
                  <span id="sum-igst">₹0.00</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 0.88rem;">
                  <span style="color: var(--text-secondary);">Round-Off:</span>
                  <span id="sum-roundoff">₹0.00</span>
                </div>
                <hr style="border: 0; border-top: 1px solid var(--border-subtle); margin: 0.75rem 0;">
                <div style="display: flex; justify-content: space-between; font-size: 1.15rem; font-weight: 800;">
                  <span>Grand Total:</span>
                  <span id="sum-grand" style="color: #818cf8;">₹0.00</span>
                </div>
              </div>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 2rem;">
              <button type="submit" class="btn btn-primary" id="btn-submit-invoice" style="padding: 0.75rem 2rem;">
                Generate & Commit Invoice
              </button>
            </div>
          </form>
        </div>
      `;

      // Line item modal
      document.getElementById('btn-add-line-item')?.addEventListener('click', () => {
        openAddLineItemModal(skus, (newItem) => {
          activeItems.push(newItem);
          refreshItemsTable();
        });
      });

      // Form submission
      document.getElementById('invoice-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (activeItems.length === 0) {
          Toast.error('Please add at least one line item before submitting.');
          return;
        }

        const customerName = document.getElementById('cust-name').value;
        const customerGstin = document.getElementById('cust-gstin').value;
        const customerStateCode = document.getElementById('cust-state').value;
        const valuationMethod = document.getElementById('inv-valuation').value;

        try {
          const inv = await api.billing.createInvoice({
            customerName,
            customerGstin: customerGstin || undefined,
            customerStateCode,
            valuationMethod,
            items: activeItems.map(item => ({
              skuId: item.skuId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              taxRate: item.taxRate,
              discountPercent: item.discountPercent
            }))
          });

          Toast.success(`Invoice ${inv.invoiceNumber} created and stock depleted!`);
          showHistory();
        } catch (err) {
          Toast.error(err.message);
        }
      });
    };

    const refreshItemsTable = async () => {
      const tbody = document.getElementById('items-table-body');
      if (!tbody) return;

      if (activeItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No items added yet. Click "+ Add Line Item" above.</td></tr>`;
      } else {
        tbody.innerHTML = activeItems.map((item, idx) => {
          const gross = item.quantity * item.unitPrice;
          const discount = gross * (item.discountPercent / 100);
          const taxable = gross - discount;
          return `
            <tr>
              <td><strong>${item.skuCode}</strong> - ${item.name}</td>
              <td>${item.availableStock}</td>
              <td>${item.quantity}</td>
              <td>${formatINR(item.unitPrice)}</td>
              <td>${item.discountPercent}%</td>
              <td>${item.taxRate}%</td>
              <td>${formatINR(taxable)}</td>
              <td><strong>${formatINR(taxable * (1 + item.taxRate / 100))}</strong></td>
              <td>
                <button type="button" class="btn btn-danger btn-sm" onclick="window._removeInvItem(${idx})">✕</button>
              </td>
            </tr>
          `;
        }).join('');
      }

      // Compute quote
      const stateCode = document.getElementById('cust-state')?.value || '27';
      try {
        const quote = await api.billing.calculateQuote({
          customerStateCode: stateCode,
          items: activeItems.map(i => ({
            skuId: i.skuId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            taxRate: i.taxRate,
            discountPercent: i.discountPercent
          }))
        });

        document.getElementById('sum-subtotal').textContent = formatINR(quote.subtotal);
        document.getElementById('sum-discount').textContent = `-${formatINR(quote.discountTotal)}`;
        document.getElementById('sum-taxable').textContent = formatINR(quote.taxableTotal);
        document.getElementById('sum-cgst').textContent = formatINR(quote.cgstTotal);
        document.getElementById('sum-sgst').textContent = formatINR(quote.sgstTotal);
        document.getElementById('sum-igst').textContent = formatINR(quote.igstTotal);
        document.getElementById('sum-roundoff').textContent = formatINR(quote.roundOff);
        document.getElementById('sum-grand').textContent = formatINR(quote.finalAmount);
      } catch {
        // Fallback calculation
      }
    };

    window._removeInvItem = (idx) => {
      activeItems.splice(idx, 1);
      refreshItemsTable();
    };

    const showHistory = async () => {
      const refreshedInvoices = await api.billing.listInvoices();
      contentPanel.innerHTML = `
        <div class="panel">
          <div class="panel-header">
            <h2 class="panel-title">Invoices & Credit Notes Archive (${refreshedInvoices.length})</h2>
          </div>

          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Taxable Val</th>
                  <th>GST Amount</th>
                  <th>Total Amount</th>
                  <th>COGS</th>
                  <th>Profit</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${refreshedInvoices.length === 0 ? `<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 2rem;">No invoices generated yet.</td></tr>` : ''}
                ${refreshedInvoices.map(inv => {
                  const gstSum = (inv.cgstAmount || 0) + (inv.sgstAmount || 0) + (inv.igstAmount || 0);
                  return `
                    <tr>
                      <td><span class="mono-code" style="color: #818cf8; font-weight: 700;">${inv.invoiceNumber}</span></td>
                      <td>${formatDate(inv.invoiceDate)}</td>
                      <td><strong>${inv.customerName}</strong></td>
                      <td>${formatINR(inv.taxableAmount)}</td>
                      <td>${formatINR(gstSum)}</td>
                      <td><strong>${formatINR(inv.totalAmount)}</strong></td>
                      <td style="color: var(--text-muted);">${formatINR(inv.totalCogs)}</td>
                      <td style="color: var(--success); font-weight: 700;">+${formatINR(inv.grossProfit)}</td>
                      <td>${renderStatusBadge(inv.status)}</td>
                      <td>
                        <button class="btn btn-secondary btn-sm btn-credit-note" data-id="${inv.id}">Credit Note</button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      document.querySelectorAll('.btn-credit-note').forEach(btn => {
        btn.addEventListener('click', () => {
          const invId = btn.getAttribute('data-id');
          const inv = refreshedInvoices.find(i => i.id === invId);
          if (inv) openCreditNoteModal(inv, () => showHistory());
        });
      });
    };

    document.getElementById('tab-btn-create')?.addEventListener('click', showCreateForm);
    document.getElementById('tab-btn-history')?.addEventListener('click', showHistory);

    // Initial view
    showCreateForm();

  } catch (err) {
    container.innerHTML = `<div class="panel" style="border-left: 4px solid var(--danger);"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function openAddLineItemModal(skus, onAdd) {
  const optionsHtml = skus
    .filter(s => s.totalStock > 0)
    .map(s => `<option value="${s.id}" data-price="${s.sellingPrice}" data-tax="${s.taxRate}" data-stock="${s.totalStock}" data-code="${s.skuCode}">${s.skuCode} - ${s.name} (${s.totalStock} in stock)</option>`)
    .join('');

  if (!optionsHtml) {
    Toast.error('No SKUs currently have available stock to sell! Intake stock first.');
    return;
  }

  const html = `
    <form id="form-item-modal">
      <div class="form-group">
        <label class="form-label">Select SKU Item *</label>
        <select id="modal-sku-select" class="form-control" required>
          ${optionsHtml}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Quantity to Bill *</label>
          <input type="number" id="modal-qty" class="form-control" min="1" value="1" required>
        </div>
        <div class="form-group">
          <label class="form-label">Unit Price (₹) *</label>
          <input type="number" id="modal-price" class="form-control" step="0.01" min="0" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Discount (%)</label>
          <input type="number" id="modal-discount" class="form-control" min="0" max="100" value="0">
        </div>
        <div class="form-group">
          <label class="form-label">GST Slab (%)</label>
          <input type="number" id="modal-tax" class="form-control" readonly>
        </div>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1.5rem;">
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('app-modal').close()">Cancel</button>
        <button type="submit" class="btn btn-primary">Add Item</button>
      </div>
    </form>
  `;

  openModal('Add Line Item to Invoice', html, (el) => {
    const sel = el.querySelector('#modal-sku-select');
    const priceInput = el.querySelector('#modal-price');
    const taxInput = el.querySelector('#modal-tax');

    const updateDefaults = () => {
      const opt = sel.options[sel.selectedIndex];
      priceInput.value = opt.getAttribute('data-price');
      taxInput.value = opt.getAttribute('data-tax');
    };

    sel.addEventListener('change', updateDefaults);
    updateDefaults();

    el.querySelector('#form-item-modal')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const opt = sel.options[sel.selectedIndex];
      const maxStock = Number(opt.getAttribute('data-stock'));
      const qty = Number(el.querySelector('#modal-qty').value);

      if (qty > maxStock) {
        Toast.error(`Requested quantity (${qty}) exceeds available stock (${maxStock})!`);
        return;
      }

      onAdd({
        skuId: sel.value,
        skuCode: opt.getAttribute('data-code'),
        name: opt.text.split(' - ')[1]?.split(' (')[0],
        availableStock: maxStock,
        quantity: qty,
        unitPrice: Number(priceInput.value),
        taxRate: Number(taxInput.value),
        discountPercent: Number(el.querySelector('#modal-discount').value) || 0
      });

      closeModal();
    });
  });
}

function openCreditNoteModal(invoice, onSuccess) {
  const itemsHtml = invoice.items.map(item => `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; padding: 0.75rem; background: var(--bg-surface-elevated); border-radius: var(--radius-sm);">
      <div>
        <strong>${item.skuCode}</strong> - ${item.name}
        <div style="font-size: 0.78rem; color: var(--text-secondary);">Invoiced Qty: ${item.quantity} | Unit Price: ${formatINR(item.unitPrice)}</div>
      </div>
      <div style="width: 120px;">
        <label style="font-size: 0.72rem; color: var(--text-muted);">Return Qty</label>
        <input type="number" class="form-control cn-return-qty" data-sku="${item.skuId}" min="0" max="${item.quantity}" value="0">
      </div>
    </div>
  `).join('');

  const html = `
    <form id="form-credit-note">
      <p style="margin-bottom: 1rem; color: var(--text-secondary);">
        Issue statutory GST credit note and return goods to stock for <strong>${invoice.invoiceNumber}</strong> (${invoice.customerName}).
      </p>

      <div class="form-group">
        <label class="form-label">Return Reason</label>
        <input type="text" id="cn-reason" class="form-control" placeholder="e.g. Defective item, excess shipment" required>
      </div>

      <div style="margin: 1.5rem 0;">
        <h4 style="font-size: 0.9rem; margin-bottom: 0.75rem;">Select Quantities to Reverse</h4>
        ${itemsHtml}
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1.5rem;">
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('app-modal').close()">Cancel</button>
        <button type="submit" class="btn btn-primary">Authorize Credit Note</button>
      </div>
    </form>
  `;

  openModal(`Issue Credit Note: ${invoice.invoiceNumber}`, html, (el) => {
    el.querySelector('#form-credit-note')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const returns = [];
      el.querySelectorAll('.cn-return-qty').forEach(input => {
        const qty = Number(input.value);
        if (qty > 0) {
          returns.push({
            skuId: input.getAttribute('data-sku'),
            quantity: qty
          });
        }
      });

      if (returns.length === 0) {
        Toast.error('Please specify at least 1 unit to return.');
        return;
      }

      try {
        const cn = await api.billing.createCreditNote({
          invoiceId: invoice.id,
          reason: el.querySelector('#cn-reason').value,
          items: returns
        });
        Toast.success(`Credit Note ${cn.creditNoteNumber} issued and stock restored!`);
        closeModal();
        if (onSuccess) onSuccess();
      } catch (err) {
        Toast.error(err.message);
      }
    });
  });
}
