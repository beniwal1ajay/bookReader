// ===== Library Module =====
// Library view, recent files, drag-and-drop handling

export class Library {
  constructor(onFileOpen) {
    this.onFileOpen = onFileOpen;
    this.recentBooks = [];
    this.load();
    this.setupDropZone();
    this.setupFileInput();
    this.render();
  }

  load() {
    try {
      this.recentBooks = JSON.parse(localStorage.getItem('br_recent')) || [];
    } catch(e) { this.recentBooks = []; }
  }

  save() {
    localStorage.setItem('br_recent', JSON.stringify(this.recentBooks));
  }

  addRecent(name, pageCount, fileSize) {
    // Remove existing entry with same name
    this.recentBooks = this.recentBooks.filter(b => b.name !== name);
    this.recentBooks.unshift({
      name,
      pageCount,
      fileSize,
      lastOpened: Date.now(),
      docId: this.generateDocId(name, fileSize)
    });
    // Keep max 20
    if (this.recentBooks.length > 20) this.recentBooks = this.recentBooks.slice(0, 20);
    this.save();
    this.render();
  }

  removeRecent(name) {
    this.recentBooks = this.recentBooks.filter(b => b.name !== name);
    this.save();
    this.render();
  }

  generateDocId(name, size) {
    return btoa(name + '_' + (size || 0)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
  }

  setupDropZone() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.type === 'application/pdf') {
        this.onFileOpen(file);
      }
    });

    // Global drag-and-drop
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type === 'application/pdf') {
        this.onFileOpen(file);
      }
    });
  }

  setupFileInput() {
    const fileInput = document.getElementById('file-input');
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.onFileOpen(file);
      fileInput.value = '';
    });
  }

  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  formatDate(timestamp) {
    const d = new Date(timestamp);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return d.toLocaleDateString();
  }

  render() {
    const grid = document.getElementById('books-grid');
    const empty = document.getElementById('empty-library');
    const count = document.getElementById('recent-count');

    if (this.recentBooks.length === 0) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
      count.textContent = '';
      return;
    }

    empty.classList.add('hidden');
    count.textContent = `(${this.recentBooks.length})`;

    grid.innerHTML = this.recentBooks.map(book => {
      const progressData = JSON.parse(localStorage.getItem('br_progress') || '{}');
      const progress = progressData[book.docId];
      const percent = progress ? Math.round((progress.lastPage / progress.totalPages) * 100) : 0;

      return `
        <div class="book-card" data-name="${book.name}" data-size="${book.fileSize}">
          <button class="remove-btn" data-remove="${book.name}" title="Remove">✕</button>
          <div class="book-card-icon">
            <svg viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="1.5"/><polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="1.5"/></svg>
          </div>
          <div class="book-card-title" title="${book.name}">${book.name.replace('.pdf', '')}</div>
          <div class="book-card-meta">
            <span>${book.pageCount} pages · ${this.formatSize(book.fileSize)}</span>
            <span>${this.formatDate(book.lastOpened)}</span>
          </div>
          <div class="book-card-progress">
            <div class="book-card-progress-fill" style="width:${percent}%"></div>
          </div>
        </div>
      `;
    }).join('');

    // Card click handlers
    grid.querySelectorAll('.book-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-btn')) return;
        // Since we can't re-open file from localStorage, prompt user
        const fileInput = document.getElementById('file-input');
        fileInput.click();
      });
    });

    // Remove handlers
    grid.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeRecent(btn.dataset.remove);
      });
    });
  }
}
