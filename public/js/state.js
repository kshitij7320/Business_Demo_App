/**
 * Lightweight reactive Pub/Sub State Manager for the StockPulse SPA.
 */
class StateManager {
  constructor() {
    this._state = {
      skus: [],
      invoices: [],
      suppliers: [],
      purchaseOrders: [],
      kpis: null,
      turnover: null,
      currentRoute: '#/',
      isLoading: false,
      systemHealth: 'ONLINE'
    };
    this._listeners = new Set();
  }

  /**
   * Returns a copy of the current state snapshot.
   * @returns {object}
   */
  getState() {
    return { ...this._state };
  }

  /**
   * Merges partial updates into state and triggers registered listeners.
   * @param {object} partialState
   */
  setState(partialState) {
    this._state = { ...this._state, ...partialState };
    this._notify();
  }

  /**
   * Subscribes a listener callback to state changes.
   * @param {(state: object) => void} listener
   * @returns {() => void} Unsubscribe function
   */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _notify() {
    for (const listener of this._listeners) {
      try {
        listener(this.getState());
      } catch (err) {
        console.error('[STATE NOTIFY ERROR]', err);
      }
    }
  }
}

export const appState = new StateManager();
