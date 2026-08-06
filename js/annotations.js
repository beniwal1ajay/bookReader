// ===== Annotations Module =====
// Text highlighting and sticky notes with persistence

export class Annotations {
  constructor() {
    this.annotations = {}; // keyed by docId
    this.activeColor = 'yellow';
    this.highlightMode = false;
    this.load();
  }

  load() {
    try {
      this.annotations = JSON.parse(localStorage.getItem('br_annotations')) || {};
    } catch(e) { this.annotations = {}; }
  }

  save() {
    localStorage.setItem('br_annotations', JSON.stringify(this.annotations));
  }

  getDocAnnotations(docId) {
    return this.annotations[docId] || [];
  }

  getPageAnnotations(docId, pageNum) {
    return (this.annotations[docId] || []).filter(a => a.page === pageNum);
  }

  addHighlight(docId, pageNum, text, rects, color) {
    if (!this.annotations[docId]) this.annotations[docId] = [];
    this.annotations[docId].push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: 'highlight',
      page: pageNum,
      text,
      rects,
      color: color || this.activeColor,
      timestamp: Date.now()
    });
    this.save();
  }

  addNote(docId, pageNum, x, y, text = '') {
    if (!this.annotations[docId]) this.annotations[docId] = [];
    const note = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: 'note',
      page: pageNum,
      x, y,
      text,
      timestamp: Date.now()
    };
    this.annotations[docId].push(note);
    this.save();
    return note;
  }

  updateNote(docId, noteId, text) {
    const anns = this.annotations[docId] || [];
    const note = anns.find(a => a.id === noteId);
    if (note) { note.text = text; this.save(); }
  }

  removeAnnotation(docId, annId) {
    if (!this.annotations[docId]) return;
    this.annotations[docId] = this.annotations[docId].filter(a => a.id !== annId);
    this.save();
  }

  setColor(color) {
    this.activeColor = color;
    document.querySelectorAll('.color-dot').forEach(d => {
      d.classList.toggle('active', d.dataset.color === color);
    });
  }

  toggleHighlightMode() {
    this.highlightMode = !this.highlightMode;
    const toolbar = document.getElementById('annotation-toolbar');
    toolbar.classList.toggle('active', this.highlightMode);
    const container = document.getElementById('canvas-container');
    container.style.cursor = this.highlightMode ? 'crosshair' : '';
    return this.highlightMode;
  }

  renderOnPage(docId, pageNum, annotationLayer, pageWidth, pageHeight, viewport) {
    annotationLayer.innerHTML = '';
    const pageAnns = this.getPageAnnotations(docId, pageNum);

    pageAnns.forEach(ann => {
      if (ann.type === 'highlight' && ann.rects) {
        ann.rects.forEach(r => {
          const el = document.createElement('div');
          el.className = 'text-highlight';
          el.style.left = (r.x / pageWidth * 100) + '%';
          el.style.top = (r.y / pageHeight * 100) + '%';
          el.style.width = (r.w / pageWidth * 100) + '%';
          el.style.height = (r.h / pageHeight * 100) + '%';
          const colors = {
            yellow: 'rgba(250,204,21,.35)', green: 'rgba(74,222,128,.35)',
            blue: 'rgba(96,165,250,.35)', pink: 'rgba(244,114,182,.35)', orange: 'rgba(251,146,60,.35)'
          };
          el.style.background = colors[ann.color] || colors.yellow;
          el.title = ann.text || '';
          el.addEventListener('dblclick', () => {
            if (confirm('Remove this highlight?')) {
              this.removeAnnotation(docId, ann.id);
              this.renderOnPage(docId, pageNum, annotationLayer, pageWidth, pageHeight, viewport);
            }
          });
          annotationLayer.appendChild(el);
        });
      } else if (ann.type === 'note') {
        const el = document.createElement('div');
        el.className = 'sticky-note';
        el.style.left = ann.x + '%';
        el.style.top = ann.y + '%';
        el.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="#fbbf24" stroke="#92400e" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
        el.title = ann.text || 'Click to edit';
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showNotePopup(docId, ann, el, annotationLayer, pageWidth, pageHeight, viewport);
        });
        annotationLayer.appendChild(el);
      }
    });
  }

  showNotePopup(docId, note, anchorEl, annotationLayer, pageWidth, pageHeight, viewport) {
    // Remove existing popups
    document.querySelectorAll('.note-popup').forEach(p => p.remove());

    const popup = document.createElement('div');
    popup.className = 'note-popup';
    popup.style.left = anchorEl.style.left;
    popup.style.top = `calc(${anchorEl.style.top} + 28px)`;
    popup.innerHTML = `
      <textarea placeholder="Type your note...">${note.text || ''}</textarea>
      <div class="note-popup-actions">
        <button class="btn" style="font-size:.75rem;padding:4px 8px;color:var(--danger)" data-action="delete">Delete</button>
        <button class="btn btn-primary" style="font-size:.75rem;padding:4px 10px" data-action="save">Save</button>
      </div>
    `;
    popup.querySelector('[data-action="save"]').addEventListener('click', () => {
      const text = popup.querySelector('textarea').value;
      this.updateNote(docId, note.id, text);
      popup.remove();
      anchorEl.title = text;
    });
    popup.querySelector('[data-action="delete"]').addEventListener('click', () => {
      this.removeAnnotation(docId, note.id);
      popup.remove();
      this.renderOnPage(docId, note.page, annotationLayer, pageWidth, pageHeight, viewport);
    });
    popup.addEventListener('click', e => e.stopPropagation());
    annotationLayer.appendChild(popup);
  }

  renderSidebar(docId, container, onNavigate) {
    container.innerHTML = '';
    const anns = this.getDocAnnotations(docId);
    if (anns.length === 0) {
      container.innerHTML = '<div class="empty-library" style="padding:20px">No annotations yet.<br>Press <b>H</b> to start highlighting.</div>';
      return;
    }
    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn btn-primary';
    exportBtn.style.cssText = 'width:100%;margin-bottom:12px;justify-content:center;font-size:.82rem';
    exportBtn.textContent = '📥 Export Annotations';
    exportBtn.addEventListener('click', () => this.exportAnnotations(docId));
    container.appendChild(exportBtn);

    anns.forEach(ann => {
      const item = document.createElement('div');
      item.className = 'annotation-item';
      item.style.borderLeftColor = ann.color === 'yellow' ? '#facc15' : ann.color === 'green' ? '#4ade80' : ann.color === 'blue' ? '#60a5fa' : ann.color === 'pink' ? '#f472b6' : ann.color === 'orange' ? '#fb923c' : '#fbbf24';
      item.innerHTML = `
        <div class="annotation-page">Page ${ann.page} · ${ann.type === 'highlight' ? '🖍️' : '📝'}</div>
        <div class="annotation-text">${ann.text || (ann.type === 'note' ? 'Empty note' : 'Highlight')}</div>
      `;
      item.addEventListener('click', () => onNavigate(ann.page));
      container.appendChild(item);
    });
  }

  exportAnnotations(docId) {
    const data = this.getDocAnnotations(docId);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annotations_${docId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
