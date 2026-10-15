/**
 * Renders the top navigation header.
 * @param {HTMLElement} headerEl
 */
export function renderNavbar(headerEl) {
  headerEl.innerHTML = `
    <a href="#/" class="brand-wrapper">
      <div class="brand-logo">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
        </svg>
      </div>
      <div>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span class="brand-title">StockPulse</span>
          <span class="brand-tag">v1.0 Offline-First</span>
        </div>
      </div>
    </a>

    <nav>
      <ul class="nav-links">
        <li class="nav-item"><a href="#/">Dashboard</a></li>
        <li class="nav-item"><a href="#/inventory">Inventory & SKUs</a></li>
        <li class="nav-item"><a href="#/billing">GST Billing</a></li>
        <li class="nav-item"><a href="#/suppliers">Suppliers & PO</a></li>
      </ul>
    </nav>

    <div class="nav-actions">
      <div class="status-indicator">
        <span class="status-dot"></span>
        <span>Storage: WAL Active</span>
      </div>
    </div>
  `;
}
