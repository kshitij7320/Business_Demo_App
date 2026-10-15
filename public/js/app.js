import { renderNavbar } from './components/navbar.js';
import { Router } from './router.js';
import { renderAnalyticsDashboard } from './components/analyticsDashboard.js';
import { renderInventoryView } from './components/inventoryView.js';
import { renderInvoiceBuilder } from './components/invoiceBuilder.js';
import { renderSupplierView } from './components/supplierView.js';

function initApp() {
  const headerEl = document.getElementById('app-header');
  if (headerEl) {
    renderNavbar(headerEl);
  }

  const routes = {
    '#/': renderAnalyticsDashboard,
    '#/inventory': renderInventoryView,
    '#/billing': renderInvoiceBuilder,
    '#/suppliers': renderSupplierView
  };

  const router = new Router(routes);
  router.init();
}

document.addEventListener('DOMContentLoaded', initApp);
