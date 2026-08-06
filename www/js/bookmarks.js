// ===== Bookmarks Module =====
// Bookmark pages, reading progress, and last position persistence

export class Bookmarks {
  constructor() {
    this.bookmarks = {}; // keyed by docId
    this.progress = {};  // keyed by docId: { lastPage, totalPages }
    this.load();
  }

  load() {
    try {
      this.bookmarks = JSON.parse(localStorage.getItem('br_bookmarks')) || {};
      this.progress = JSON.parse(localStorage.getItem('br_progress')) || {};
    } catch(e) {
      this.bookmarks = {};
      this.progress = {};
    }
  }

  save() {
    localStorage.setItem('br_bookmarks', JSON.stringify(this.bookmarks));
    localStorage.setItem('br_progress', JSON.stringify(this.progress));
  }

  getDocBookmarks(docId) {
    return this.bookmarks[docId] || [];
  }

  addBookmark(docId, pageNum, label = '') {
    if (!this.bookmarks[docId]) this.bookmarks[docId] = [];
    const exists = this.bookmarks[docId].find(b => b.page === pageNum);
    if (exists) return false;
    this.bookmarks[docId].push({
      page: pageNum,
      label: label || `Page ${pageNum}`,
      timestamp: Date.now()
    });
    this.bookmarks[docId].sort((a, b) => a.page - b.page);
    this.save();
    return true;
  }

  removeBookmark(docId, pageNum) {
    if (!this.bookmarks[docId]) return;
    this.bookmarks[docId] = this.bookmarks[docId].filter(b => b.page !== pageNum);
    this.save();
  }

  isBookmarked(docId, pageNum) {
    return !!(this.bookmarks[docId] || []).find(b => b.page === pageNum);
  }

  saveProgress(docId, pageNum, totalPages) {
    this.progress[docId] = { lastPage: pageNum, totalPages, timestamp: Date.now() };
    this.save();
  }

  getProgress(docId) {
    return this.progress[docId] || null;
  }

  getLastPage(docId) {
    const p = this.progress[docId];
    return p ? p.lastPage : 1;
  }

  getProgressPercent(docId) {
    const p = this.progress[docId];
    if (!p || !p.totalPages) return 0;
    return Math.round((p.lastPage / p.totalPages) * 100);
  }

  renderSidebar(docId, container, onNavigate) {
    container.innerHTML = '';
    const bmarks = this.getDocBookmarks(docId);
    if (bmarks.length === 0) {
      container.innerHTML = '<div class="empty-library" style="padding:20px">No bookmarks yet.<br>Press <b>B</b> to bookmark the current page.</div>';
      return;
    }
    bmarks.forEach(b => {
      const item = document.createElement('div');
      item.className = 'bookmark-item';
      item.innerHTML = `
        <span class="bookmark-page">p.${b.page}</span>
        <span class="bookmark-label">${b.label}</span>
        <button class="bookmark-delete" title="Remove">✕</button>
      `;
      item.querySelector('.bookmark-label').addEventListener('click', () => onNavigate(b.page));
      item.querySelector('.bookmark-page').addEventListener('click', () => onNavigate(b.page));
      item.querySelector('.bookmark-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeBookmark(docId, b.page);
        this.renderSidebar(docId, container, onNavigate);
      });
      container.appendChild(item);
    });
  }
}
