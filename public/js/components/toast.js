/**
 * Toast notification component.
 */
export class Toast {
  /**
   * Displays an animated toast message.
   * @param {string} message
   * @param {'success'|'error'|'info'} [type='info']
   * @param {number} [duration=4000]
   */
  static show(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  static success(msg) {
    Toast.show(msg, 'success');
  }

  static error(msg) {
    Toast.show(msg, 'error', 5000);
  }

  static info(msg) {
    Toast.show(msg, 'info');
  }
}
