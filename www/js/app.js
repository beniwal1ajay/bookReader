// ===== App Controller =====
// Main entry point — initializes modules, wires events, manages views

import { PDFRenderer } from './pdf-renderer.js';
import { Library } from './library.js';
import { Annotations } from './annotations.js';
import { Bookmarks } from './bookmarks.js';
import { Search } from './search.js';
import { Settings } from './settings.js';

class App {
  constructor() {
    this.currentDocId = null;
    this.currentFileName = '';
    this.initPdfJs();
  }

  async initPdfJs() {
    // Load PDF.js from CDN
    const pdfjsLib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';

    this.settings = new Settings();
    this.bookmarks = new Bookmarks();
    this.annotations = new Annotations();
    this.search = new Search();
    this.renderer = new PDFRenderer(pdfjsLib);
    this.library = new Library((file) => this.openFile(file));
    this.library.onCachedOpen = (data, name, size) => this.openCachedFile(data, name, size);

    this.renderer.onPageChange = (page, total) => this.onPageChange(page, total);
    this.renderer.onDocLoaded = (doc, name, size) => this.onDocLoaded(doc, name, size);

    this.bindEvents();
    this.showView('library');
  }

  // ===== Views =====
  showView(view) {
    const lib = document.getElementById('library-view');
    const reader = document.getElementById('reader-view');
    if (view === 'library') {
      lib.classList.add('active');
      lib.style.display = 'flex';
      reader.classList.remove('active');
      reader.style.display = 'none';
    } else {
      lib.classList.remove('active');
      lib.style.display = 'none';
      reader.classList.add('active');
      reader.style.display = 'flex';
    }
  }

  // ===== File Handling =====
  async openFile(file) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);
      this.currentFileName = file.name;
      this.currentDocId = this.library.generateDocId(file.name, file.size);

      // Cache the PDF data in IndexedDB for re-opening later
      this.library.storePDF(this.currentDocId, arrayBuffer);

      this.showView('reader');
      await this.renderer.loadDocument(data, file.name, file.size);
    } catch(err) {
      this.toast('Failed to open PDF: ' + err.message, 'error');
      this.showView('library');
    }
  }

  async openCachedFile(arrayBuffer, name, size) {
    try {
      const data = new Uint8Array(arrayBuffer);
      this.currentFileName = name;
      this.currentDocId = this.library.generateDocId(name, size);

      this.showView('reader');
      await this.renderer.loadDocument(data, name, size);
    } catch(err) {
      this.toast('Failed to open cached PDF: ' + err.message, 'error');
      this.showView('library');
    }
  }

  async onDocLoaded(pdfDoc, fileName, fileSize) {
    this.library.addRecent(fileName, pdfDoc.numPages, fileSize);

    // Resume last position
    const lastPage = this.bookmarks.getLastPage(this.currentDocId);
    await this.renderer.fitWidth();

    // After fitWidth completes, go to last page
    if (lastPage > 1) {
      this.renderer.goToPage(lastPage);
      this.toast(`Resumed from page ${lastPage}`, 'info');
    }

    // Update status bar
    document.getElementById('status-filename').textContent = fileName.replace('.pdf', '');

    // Load TOC
    await this.loadTOC();

    // Load thumbnails lazily after document render
    setTimeout(() => this.loadThumbnails(), 300);

    // Render bookmarks & annotations sidebars
    this.refreshSidebars();
  }

  onPageChange(page, total) {
    // Update status bar
    document.getElementById('status-page').textContent = `Page ${page} of ${total}`;
    const percent = Math.round((page / total) * 100);
    document.getElementById('progress-fill').style.width = percent + '%';
    document.getElementById('status-progress').textContent = percent + '%';

    // Save progress
    this.bookmarks.saveProgress(this.currentDocId, page, total);

    // Update bookmark button style
    this.updateBookmarkBtn();

    // Render annotations on current page
    this.renderCurrentAnnotations();

    // Highlight search results on page
    if (this.search.query) {
      setTimeout(() => {
        const textLayer = document.querySelector('.text-layer');
        this.search.highlightOnPage(page, textLayer);
      }, 100);
    }
  }

  updateBookmarkBtn() {
    const btn = document.getElementById('btn-bookmark');
    const isMarked = this.bookmarks.isBookmarked(this.currentDocId, this.renderer.currentPage);
    btn.style.color = isMarked ? 'var(--accent)' : '';
    const svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', isMarked ? 'currentColor' : 'none');
  }

  renderCurrentAnnotations() {
    const pageNum = this.renderer.currentPage;
    const annotLayer = document.querySelector(`.annotation-layer[data-page="${pageNum}"]`);
    if (!annotLayer) return;
    const wrapper = annotLayer.parentElement;
    if (!wrapper || !wrapper.clientWidth) return;
    this.annotations.renderOnPage(
      this.currentDocId, pageNum, annotLayer,
      wrapper.clientWidth, wrapper.clientHeight
    );
  }

  refreshSidebars() {
    this.bookmarks.renderSidebar(
      this.currentDocId,
      document.getElementById('bookmarks-panel'),
      (p) => this.renderer.goToPage(p)
    );
    this.annotations.renderSidebar(
      this.currentDocId,
      document.getElementById('annotations-panel'),
      (p) => this.renderer.goToPage(p)
    );
  }

  // ===== TOC =====
  async loadTOC() {
    const panel = document.getElementById('toc-panel');
    panel.innerHTML = '';
    const outline = await this.renderer.getOutline();

    if (!outline || outline.length === 0) {
      panel.innerHTML = '<div class="empty-library" style="padding:20px">No table of contents available for this document.</div>';
      return;
    }

    const renderItems = async (items, level = 1) => {
      for (const item of items) {
        const div = document.createElement('div');
        div.className = 'toc-item';
        div.dataset.level = level;
        div.textContent = item.title;

        div.addEventListener('click', async () => {
          const pageNum = await this.renderer.getPageFromDest(item.dest);
          this.renderer.goToPage(pageNum);
          panel.querySelectorAll('.toc-item').forEach(t => t.classList.remove('active'));
          div.classList.add('active');
        });

        panel.appendChild(div);
        if (item.items && item.items.length > 0) {
          await renderItems(item.items, Math.min(level + 1, 3));
        }
      }
    };
    await renderItems(outline);
  }

  // ===== Thumbnails =====
  async loadThumbnails() {
    const panel = document.getElementById('thumbnails-panel');
    panel.innerHTML = '';

    const total = this.renderer.totalPages;
    // Render first 20 immediately, rest on scroll
    const batchSize = Math.min(total, 20);

    for (let i = 1; i <= batchSize; i++) {
      await this.addThumbnail(panel, i);
    }

    // Lazy load rest
    if (total > batchSize) {
      const loadMore = document.createElement('button');
      loadMore.className = 'btn btn-primary';
      loadMore.style.cssText = 'width:100%;margin-top:8px;justify-content:center';
      loadMore.textContent = `Load remaining ${total - batchSize} pages`;
      loadMore.addEventListener('click', async () => {
        loadMore.remove();
        for (let i = batchSize + 1; i <= total; i++) {
          await this.addThumbnail(panel, i);
        }
      });
      panel.appendChild(loadMore);
    }
  }

  async addThumbnail(panel, pageNum) {
    const item = document.createElement('div');
    item.className = 'thumbnail-item';
    if (pageNum === this.renderer.currentPage) item.classList.add('active');

    try {
      const canvas = await this.renderer.renderThumbnail(pageNum, 200);
      item.appendChild(canvas);
    } catch(e) {
      item.textContent = `Page ${pageNum}`;
    }

    const label = document.createElement('div');
    label.className = 'thumbnail-label';
    label.textContent = `Page ${pageNum}`;
    item.appendChild(label);

    item.addEventListener('click', () => {
      this.renderer.goToPage(pageNum);
      panel.querySelectorAll('.thumbnail-item').forEach(t => t.classList.remove('active'));
      item.classList.add('active');
    });

    // Insert before "load more" button if it exists
    const loadMoreBtn = panel.querySelector('button');
    if (loadMoreBtn) {
      panel.insertBefore(item, loadMoreBtn);
    } else {
      panel.appendChild(item);
    }
  }

  // ===== Event Binding =====
  bindEvents() {
    // Back to library
    document.getElementById('btn-back').addEventListener('click', () => this.showView('library'));

    // Page navigation
    document.getElementById('btn-prev').addEventListener('click', () => this.renderer.prevPage());
    document.getElementById('btn-next').addEventListener('click', () => this.renderer.nextPage());
    document.getElementById('page-input').addEventListener('change', (e) => {
      this.renderer.goToPage(parseInt(e.target.value));
    });

    // Zoom
    document.getElementById('btn-zoom-in').addEventListener('click', () => this.renderer.zoomIn());
    document.getElementById('btn-zoom-out').addEventListener('click', () => this.renderer.zoomOut());
    document.getElementById('btn-fit-width').addEventListener('click', () => this.renderer.fitWidth());
    document.getElementById('btn-fit-page').addEventListener('click', () => this.renderer.fitPage());

    // Rotate
    document.getElementById('btn-rotate').addEventListener('click', () => this.renderer.rotate());

    // Scroll mode toggle
    document.getElementById('btn-scroll-mode').addEventListener('click', () => {
      const mode = this.renderer.toggleScrollMode();
      this.settings.setScrollMode(mode);
      this.toast(`${mode === 'continuous' ? 'Continuous' : 'Single page'} mode`, 'info');
      // Re-render annotations after mode change
      setTimeout(() => this.renderCurrentAnnotations(), 500);
    });

    // Sidebar toggle
    document.getElementById('btn-sidebar').addEventListener('click', () => this.toggleSidebar());

    // Sidebar tabs
    document.querySelectorAll('.sidebar-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.panel).classList.add('active');
      });
    });

    // Bookmark
    document.getElementById('btn-bookmark').addEventListener('click', () => this.toggleBookmark());

    // Highlight toggle
    document.getElementById('btn-highlight').addEventListener('click', () => {
      const mode = this.annotations.toggleHighlightMode();
      this.toast(mode ? 'Highlight mode ON — select text' : 'Highlight mode OFF', 'info');
    });
    document.getElementById('btn-close-annotation').addEventListener('click', () => {
      this.annotations.toggleHighlightMode();
    });

    // Highlight colors
    document.querySelectorAll('.color-dot').forEach(dot => {
      dot.addEventListener('click', () => this.annotations.setColor(dot.dataset.color));
    });

    // Add note button
    document.getElementById('btn-add-note').addEventListener('click', () => {
      this.addNoteAtCenter();
    });

    // Text selection for highlighting
    document.getElementById('canvas-container').addEventListener('mouseup', () => {
      if (!this.annotations.highlightMode) return;
      this.captureHighlight();
    });

    // Theme
    document.getElementById('btn-theme').addEventListener('click', () => {
      const theme = this.settings.cycleTheme();
      this.toast(`${theme.charAt(0).toUpperCase() + theme.slice(1)} mode`, 'info');
    });
    document.getElementById('theme-toggle-lib').addEventListener('click', () => {
      this.settings.cycleTheme();
    });

    // Fullscreen
    document.getElementById('btn-fullscreen').addEventListener('click', () => this.toggleFullscreen());

    // Search
    document.getElementById('btn-search').addEventListener('click', () => this.search.open());
    document.getElementById('search-close').addEventListener('click', () => this.search.close());
    document.getElementById('search-input').addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const results = await this.search.search(e.target.value, this.renderer.pdfDoc);
        if (results && results.length > 0) {
          const r = this.search.nextResult();
          if (r) this.renderer.goToPage(r.page);
        }
      } else if (e.key === 'Escape') {
        this.search.close();
      }
    });
    document.getElementById('search-next').addEventListener('click', () => {
      const r = this.search.nextResult();
      if (r) this.renderer.goToPage(r.page);
    });
    document.getElementById('search-prev').addEventListener('click', () => {
      const r = this.search.prevResult();
      if (r) this.renderer.goToPage(r.page);
    });

    // Shortcuts modal
    document.getElementById('btn-shortcuts').addEventListener('click', () => {
      document.getElementById('shortcuts-modal').classList.add('active');
    });
    document.getElementById('shortcuts-close').addEventListener('click', () => {
      document.getElementById('shortcuts-modal').classList.remove('active');
    });

    // Go-to-page modal
    document.getElementById('goto-cancel').addEventListener('click', () => {
      document.getElementById('goto-modal').classList.remove('active');
    });
    document.getElementById('goto-go').addEventListener('click', () => {
      const val = parseInt(document.getElementById('goto-input').value);
      if (val) this.renderer.goToPage(val);
      document.getElementById('goto-modal').classList.remove('active');
    });
    document.getElementById('goto-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = parseInt(e.target.value);
        if (val) this.renderer.goToPage(val);
        document.getElementById('goto-modal').classList.remove('active');
      }
    });

    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('active');
      });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyboard(e));
  }

  // ===== Keyboard Shortcuts =====
  handleKeyboard(e) {
    // Skip if typing in input
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }

    const readerActive = document.getElementById('reader-view').style.display !== 'none';
    if (!readerActive) return;

    switch(e.key) {
      case 'ArrowLeft':
        e.preventDefault(); this.renderer.prevPage(); break;
      case 'ArrowRight':
        e.preventDefault(); this.renderer.nextPage(); break;
      case '+': case '=':
        e.preventDefault(); this.renderer.zoomIn(); break;
      case '-':
        e.preventDefault(); this.renderer.zoomOut(); break;
      case 'f':
        if (!e.ctrlKey) { e.preventDefault(); this.toggleFullscreen(); } break;
      case 's':
        if (!e.ctrlKey) { e.preventDefault(); this.toggleSidebar(); } break;
      case 'b':
        e.preventDefault(); this.toggleBookmark(); break;
      case 'h':
        e.preventDefault();
        const mode = this.annotations.toggleHighlightMode();
        this.toast(mode ? 'Highlight mode ON' : 'Highlight mode OFF', 'info');
        break;
      case 'd':
        e.preventDefault();
        const theme = this.settings.cycleTheme();
        this.toast(`${theme.charAt(0).toUpperCase() + theme.slice(1)} mode`, 'info');
        break;
      case 'r':
        e.preventDefault(); this.renderer.rotate(); break;
      case '?':
        e.preventDefault();
        document.getElementById('shortcuts-modal').classList.add('active'); break;
      case 'Escape':
        this.closeAllOverlays(); break;
    }

    // Ctrl shortcuts
    if (e.ctrlKey) {
      if (e.key === 'f') {
        e.preventDefault(); this.search.open();
      } else if (e.key === 'g') {
        e.preventDefault();
        document.getElementById('goto-modal').classList.add('active');
        setTimeout(() => document.getElementById('goto-input').focus(), 100);
      }
    }
  }

  // ===== Actions =====
  toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
  }

  toggleBookmark() {
    if (!this.currentDocId) return;
    const page = this.renderer.currentPage;
    if (this.bookmarks.isBookmarked(this.currentDocId, page)) {
      this.bookmarks.removeBookmark(this.currentDocId, page);
      this.toast('Bookmark removed', 'info');
    } else {
      this.bookmarks.addBookmark(this.currentDocId, page);
      this.toast(`Page ${page} bookmarked`, 'success');
    }
    this.updateBookmarkBtn();
    this.refreshSidebars();
  }

  toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }

  captureHighlight() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const text = selection.toString().trim();
    if (!text) return;

    const range = selection.getRangeAt(0);
    const wrapper = document.querySelector('.page-wrapper');
    if (!wrapper) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const rects = [];

    const clientRects = range.getClientRects();
    for (let i = 0; i < clientRects.length; i++) {
      const r = clientRects[i];
      rects.push({
        x: r.left - wrapperRect.left,
        y: r.top - wrapperRect.top,
        w: r.width,
        h: r.height
      });
    }

    if (rects.length > 0) {
      this.annotations.addHighlight(
        this.currentDocId,
        this.renderer.currentPage,
        text, rects,
        this.annotations.activeColor
      );
      selection.removeAllRanges();
      this.renderCurrentAnnotations();
      this.refreshSidebars();
      this.toast('Text highlighted', 'success');
    }
  }

  addNoteAtCenter() {
    if (!this.currentDocId) return;
    this.annotations.addNote(
      this.currentDocId,
      this.renderer.currentPage,
      50, 50, ''
    );
    this.renderCurrentAnnotations();
    this.refreshSidebars();
    this.toast('Note added — click to edit', 'info');
  }

  closeAllOverlays() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
    this.search.close();
    document.querySelectorAll('.note-popup').forEach(p => p.remove());
  }

  // ===== Toast Notifications =====
  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${message}`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      toast.style.transition = 'all .3s';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }
}

// Initialize
const app = new App();
