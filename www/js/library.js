// ===== Library Module =====
// Library view, recent files, drag-and-drop handling, IndexedDB PDF caching

export class Library {
  constructor(onFileOpen) {
    this.onFileOpen = onFileOpen;
    this.onCachedOpen = null; // callback for opening cached PDF data: (arrayBuffer, name, size) => {}
    this.recentBooks = [];
    this.db = null;
    this._initDB();
    this.load();
    this.setupDropZone();
    this.setupFileInput();
    this.render();
  }

  // ===== IndexedDB =====
  _initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('BookReaderDB', 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('pdfs')) {
          db.createObjectStore('pdfs');
        }
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      request.onerror = (e) => {
        console.error('IndexedDB error:', e);
        resolve(null);
      };
    });
  }

  async _getDB() {
    if (this.db) return this.db;
    return this._initDB();
  }

  async storePDF(docId, arrayBuffer) {
    try {
      const db = await this._getDB();
      if (!db) return;
      const tx = db.transaction('pdfs', 'readwrite');
      const store = tx.objectStore('pdfs');
      store.put(arrayBuffer, docId);
    } catch (e) {
      console.error('Failed to store PDF:', e);
    }
  }

  async getPDF(docId) {
    try {
      const db = await this._getDB();
      if (!db) return null;
      return new Promise((resolve) => {
        const tx = db.transaction('pdfs', 'readonly');
        const store = tx.objectStore('pdfs');
        const request = store.get(docId);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      });
    } catch (e) {
      console.error('Failed to get PDF:', e);
      return null;
    }
  }

  async removePDF(docId) {
    try {
      const db = await this._getDB();
      if (!db) return;
      const tx = db.transaction('pdfs', 'readwrite');
      const store = tx.objectStore('pdfs');
      store.delete(docId);
    } catch (e) {
      console.error('Failed to remove PDF:', e);
    }
  }

  // ===== Local Storage =====
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
    const book = this.recentBooks.find(b => b.name === name);
    if (book) {
      this.removePDF(book.docId);
    }
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
        <div class="book-card" data-name="${book.name}" data-size="${book.fileSize}" data-docid="${book.docId}">
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

    // Card click handlers — try to load from IndexedDB cache first
    grid.querySelectorAll('.book-card').forEach(card => {
      card.addEventListener('click', async (e) => {
        if (e.target.classList.contains('remove-btn')) return;

        const docId = card.dataset.docid;
        const name = card.dataset.name;
        const size = parseInt(card.dataset.size) || 0;

        // Try loading from IndexedDB cache
        const cachedData = await this.getPDF(docId);
        if (cachedData && this.onCachedOpen) {
          this.onCachedOpen(cachedData, name, size);
        } else {
          // Fallback: prompt user to re-select the file
          this._showToast('Please re-select the file to open it');
          const fileInput = document.getElementById('file-input');
          fileInput.click();
        }
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

  _showToast(msg) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast info';
    toast.innerHTML = `<span>ℹ</span> ${msg}`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      toast.style.transition = 'all .3s';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }
}
