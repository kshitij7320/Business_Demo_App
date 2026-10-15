/**
 * Lightweight DOM utility functions.
 */

/**
 * Opens the application modal with given HTML content.
 * @param {string} title
 * @param {string} bodyHtml
 * @param {(modalEl: HTMLElement) => void} [onMount]
 */
export function openModal(title, bodyHtml, onMount = null) {
  const dialog = document.getElementById('app-modal');
  const card = document.getElementById('modal-content');
  if (!dialog || !card) return;

  card.innerHTML = `
    <div class="modal-header">
      <h3 class="modal-title">${title}</h3>
      <button class="modal-close" id="modal-close-btn" aria-label="Close dialog">&times;</button>
    </div>
    <div class="modal-body">${bodyHtml}</div>
  `;

  document.getElementById('modal-close-btn')?.addEventListener('click', closeModal);

  // Close on backdrop click
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      closeModal();
    }
  });

  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', 'true');
  }

  if (onMount) {
    onMount(card);
  }
}

/**
 * Closes the active modal dialog.
 */
export function closeModal() {
  const dialog = document.getElementById('app-modal');
  if (!dialog) return;

  if (typeof dialog.close === 'function') {
    dialog.close();
  } else {
    dialog.removeAttribute('open');
  }
}
