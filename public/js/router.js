import { appState } from './state.js';

/**
 * Client-side hash router for the SPA.
 */
export class Router {
  constructor(routes) {
    this.routes = routes;
    window.addEventListener('hashchange', () => this.handleRouting());
  }

  init() {
    this.handleRouting();
  }

  handleRouting() {
    const rawHash = window.location.hash || '#/';
    const cleanHash = rawHash.split('?')[0];

    appState.setState({ currentRoute: cleanHash });

    const viewHandler = this.routes[cleanHash] || this.routes['#/'];
    const rootEl = document.getElementById('app-root');
    if (!rootEl) return;

    // Smooth transition
    rootEl.style.opacity = '0.5';
    setTimeout(() => {
      viewHandler(rootEl);
      rootEl.style.opacity = '1';
    }, 50);

    // Update active state on header navigation items
    document.querySelectorAll('.nav-item a').forEach(link => {
      if (link.getAttribute('href') === cleanHash) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }

  navigate(hash) {
    window.location.hash = hash;
  }
}
