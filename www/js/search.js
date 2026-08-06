// ===== Search Module =====
// Full-text search across PDF pages with match navigation

export class Search {
  constructor() {
    this.results = [];
    this.currentIndex = -1;
    this.query = '';
    this.isOpen = false;
  }

  open() {
    const overlay = document.getElementById('search-overlay');
    overlay.classList.add('active');
    document.getElementById('search-input').focus();
    this.isOpen = true;
  }

  close() {
    const overlay = document.getElementById('search-overlay');
    overlay.classList.remove('active');
    this.clearHighlights();
    this.results = [];
    this.currentIndex = -1;
    this.query = '';
    this.updateCount();
    this.isOpen = false;
  }

  async search(query, pdfDoc) {
    if (!query || !pdfDoc) return;
    this.query = query.toLowerCase();
    this.results = [];
    this.currentIndex = -1;

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const text = textContent.items.map(item => item.str).join(' ').toLowerCase();
      let startIndex = 0;
      while (true) {
        const idx = text.indexOf(this.query, startIndex);
        if (idx === -1) break;
        this.results.push({ page: i, index: idx });
        startIndex = idx + 1;
      }
    }
    this.updateCount();
    if (this.results.length > 0) {
      this.currentIndex = 0;
    }
    return this.results;
  }

  nextResult() {
    if (this.results.length === 0) return null;
    this.currentIndex = (this.currentIndex + 1) % this.results.length;
    this.updateCount();
    return this.results[this.currentIndex];
  }

  prevResult() {
    if (this.results.length === 0) return null;
    this.currentIndex = (this.currentIndex - 1 + this.results.length) % this.results.length;
    this.updateCount();
    return this.results[this.currentIndex];
  }

  updateCount() {
    const el = document.getElementById('search-results-count');
    if (!el) return;
    if (this.results.length === 0 && this.query) {
      el.textContent = 'No results found';
    } else if (this.results.length > 0) {
      el.textContent = `${this.currentIndex + 1} of ${this.results.length} matches`;
    } else {
      el.textContent = '';
    }
  }

  highlightOnPage(pageNum, textLayerEl) {
    if (!this.query || !textLayerEl) return;
    const spans = textLayerEl.querySelectorAll('span');
    spans.forEach(span => {
      const text = span.textContent.toLowerCase();
      if (text.includes(this.query)) {
        const regex = new RegExp(`(${this.escapeRegex(this.query)})`, 'gi');
        span.innerHTML = span.textContent.replace(regex, '<mark class="highlight">$1</mark>');
      }
    });
  }

  clearHighlights() {
    document.querySelectorAll('.text-layer mark.highlight').forEach(mark => {
      const parent = mark.parentNode;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    });
  }

  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
