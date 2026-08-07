// ===== PDF Renderer Module =====
// Handles PDF.js document loading, page rendering, zoom, rotation, text layer

export class PDFRenderer {
  constructor(pdfjsLib) {
    this.pdfjsLib = pdfjsLib;
    this.pdfDoc = null;
    this.currentPage = 1;
    this.totalPages = 0;
    this.scale = 1.0;
    this.rotation = 0;
    this.scrollMode = 'single'; // 'single' or 'continuous'
    this.rendering = false;
    this.pageCache = new Map();
    this.container = document.getElementById('canvas-container');
    this.fileName = '';
    this.fileSize = 0;
    this.onPageChange = null;
    this.onDocLoaded = null;
  }

  async loadDocument(fileData, fileName, fileSize) {
    this.fileName = fileName;
    this.fileSize = fileSize;
    this.showLoading('Loading document...');

    try {
      const loadingTask = this.pdfjsLib.getDocument({ data: fileData });
      this.pdfDoc = await loadingTask.promise;
      this.totalPages = this.pdfDoc.numPages;
      this.rotation = 0;
      this.pageCache.clear();

      document.getElementById('page-total').textContent = this.totalPages;
      this.hideLoading();

      if (this.onDocLoaded) {
        this.onDocLoaded(this.pdfDoc, fileName, fileSize);
      }
      return this.pdfDoc;
    } catch (err) {
      this.hideLoading();
      console.error('Error loading PDF:', err);
      throw err;
    }
  }

  async renderPage(pageNum, forceRerender = false) {
    if (!this.pdfDoc || pageNum < 1 || pageNum > this.totalPages) return;
    if (this.rendering && !forceRerender) return;
    this.rendering = true;
    this.currentPage = pageNum;

    try {
      if (this.scrollMode === 'single') {
        await this.renderSinglePage(pageNum);
      }
      // Update page input
      document.getElementById('page-input').value = pageNum;
      if (this.onPageChange) this.onPageChange(pageNum, this.totalPages);
    } catch (err) {
      console.error('Render error:', err);
    }
    this.rendering = false;
  }

  async renderSinglePage(pageNum) {
    const page = await this.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: this.scale, rotation: this.rotation });

    // Clear container and create wrapper
    this.container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'page-wrapper';
    wrapper.style.width = viewport.width + 'px';
    wrapper.style.height = viewport.height + 'px';

    // Canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';
    ctx.scale(dpr, dpr);

    wrapper.appendChild(canvas);

    // Text layer
    const textLayer = document.createElement('div');
    textLayer.className = 'text-layer';
    textLayer.style.width = viewport.width + 'px';
    textLayer.style.height = viewport.height + 'px';
    wrapper.appendChild(textLayer);

    // Annotation layer
    const annotationLayer = document.createElement('div');
    annotationLayer.className = 'annotation-layer';
    annotationLayer.dataset.page = pageNum;
    wrapper.appendChild(annotationLayer);

    this.container.appendChild(wrapper);

    // Render canvas
    await page.render({ canvasContext: ctx, viewport }).promise;

    // Render text layer
    const textContent = await page.getTextContent();
    this.renderTextLayer(textContent, textLayer, viewport);

    // Scroll to top
    this.container.scrollTop = 0;

    return { wrapper, textLayer, annotationLayer, viewport, page };
  }

  async renderContinuous() {
    this.container.innerHTML = '';

    for (let i = 1; i <= this.totalPages; i++) {
      const page = await this.pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: this.scale, rotation: this.rotation });

      const wrapper = document.createElement('div');
      wrapper.className = 'page-wrapper';
      wrapper.dataset.page = i;
      wrapper.style.width = viewport.width + 'px';
      wrapper.style.height = viewport.height + 'px';

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';
      ctx.scale(dpr, dpr);
      wrapper.appendChild(canvas);

      const textLayer = document.createElement('div');
      textLayer.className = 'text-layer';
      textLayer.style.width = viewport.width + 'px';
      textLayer.style.height = viewport.height + 'px';
      wrapper.appendChild(textLayer);

      const annotationLayer = document.createElement('div');
      annotationLayer.className = 'annotation-layer';
      annotationLayer.dataset.page = i;
      wrapper.appendChild(annotationLayer);

      this.container.appendChild(wrapper);

      await page.render({ canvasContext: ctx, viewport }).promise;
      const textContent = await page.getTextContent();
      this.renderTextLayer(textContent, textLayer, viewport);
    }

    // Scroll observer for continuous mode
    this.setupScrollObserver();
  }

  setupScrollObserver() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const pageNum = parseInt(entry.target.dataset.page);
          if (pageNum && pageNum !== this.currentPage) {
            this.currentPage = pageNum;
            document.getElementById('page-input').value = pageNum;
            if (this.onPageChange) this.onPageChange(pageNum, this.totalPages);
          }
        }
      });
    }, { root: this.container, threshold: 0.5 });

    this.container.querySelectorAll('.page-wrapper').forEach(w => observer.observe(w));
  }

  renderTextLayer(textContent, textLayerDiv, viewport) {
    textLayerDiv.innerHTML = '';
    const textItems = textContent.items;

    textItems.forEach(item => {
      const span = document.createElement('span');
      const tx = this.pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontSize = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);

      span.textContent = item.str;
      span.style.left = tx[4] + 'px';
      span.style.top = tx[5] - fontSize + 'px';
      span.style.fontSize = fontSize + 'px';
      span.style.fontFamily = item.fontName || 'sans-serif';

      if (item.width > 0) {
        const expectedWidth = item.width * viewport.scale;
        span.style.transform = `scaleX(${expectedWidth / (item.str.length * fontSize * 0.5 || 1)})`;
      }
      textLayerDiv.appendChild(span);
    });
  }

  // Navigation
  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.renderPage(this.currentPage + 1);
    }
  }

  prevPage() {
    if (this.currentPage > 1) {
      this.renderPage(this.currentPage - 1);
    }
  }

  goToPage(num) {
    const p = Math.max(1, Math.min(num, this.totalPages));
    if (this.scrollMode === 'continuous') {
      const wrapper = this.container.querySelector(`.page-wrapper[data-page="${p}"]`);
      if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth' });
      this.currentPage = p;
      document.getElementById('page-input').value = p;
      if (this.onPageChange) this.onPageChange(p, this.totalPages);
    } else {
      this.renderPage(p);
    }
  }

  // Zoom
  zoomIn() { this.setZoom(Math.min(this.scale + 0.2, 5.0)); }
  zoomOut() { this.setZoom(Math.max(this.scale - 0.2, 0.3)); }

  setZoom(newScale) {
    this.scale = Math.round(newScale * 100) / 100;
    document.getElementById('zoom-display').textContent = Math.round(this.scale * 100) + '%';
    if (this.scrollMode === 'continuous') {
      this.renderContinuous();
    } else {
      this.renderPage(this.currentPage, true);
    }
  }

  // Wait for the container to have non-zero dimensions (needed after view transitions)
  _waitForContainer(maxRetries = 30) {
    return new Promise((resolve) => {
      let retries = 0;
      const check = () => {
        if (this.container.clientWidth > 0 && this.container.clientHeight > 0) {
          resolve();
        } else if (retries++ < maxRetries) {
          requestAnimationFrame(check);
        } else {
          resolve(); // give up, use whatever dimensions we have
        }
      };
      check();
    });
  }

  async fitWidth() {
    if (!this.pdfDoc) return;
    await this._waitForContainer();
    const page = await this.pdfDoc.getPage(this.currentPage);
    const viewport = page.getViewport({ scale: 1, rotation: this.rotation });
    const containerWidth = this.container.clientWidth - 20;
    if (containerWidth <= 0) return;
    this.setZoom(Math.max(0.1, containerWidth / viewport.width));
  }

  async fitPage() {
    if (!this.pdfDoc) return;
    await this._waitForContainer();
    const page = await this.pdfDoc.getPage(this.currentPage);
    const viewport = page.getViewport({ scale: 1, rotation: this.rotation });
    const containerWidth = this.container.clientWidth - 20;
    const containerHeight = this.container.clientHeight - 20;
    if (containerWidth <= 0 || containerHeight <= 0) return;
    const scaleW = containerWidth / viewport.width;
    const scaleH = containerHeight / viewport.height;
    this.setZoom(Math.max(0.1, Math.min(scaleW, scaleH)));
  }

  rotate() {
    this.rotation = (this.rotation + 90) % 360;
    if (this.scrollMode === 'continuous') {
      this.renderContinuous();
    } else {
      this.renderPage(this.currentPage, true);
    }
  }

  setScrollMode(mode) {
    this.scrollMode = mode;
    if (mode === 'continuous') {
      this.renderContinuous();
    } else {
      this.renderPage(this.currentPage, true);
    }
  }

  toggleScrollMode() {
    const newMode = this.scrollMode === 'single' ? 'continuous' : 'single';
    this.setScrollMode(newMode);
    return newMode;
  }

  async getOutline() {
    if (!this.pdfDoc) return [];
    try {
      const outline = await this.pdfDoc.getOutline();
      return outline || [];
    } catch(e) { return []; }
  }

  async getPageFromDest(dest) {
    try {
      if (typeof dest === 'string') {
        dest = await this.pdfDoc.getDestination(dest);
      }
      if (Array.isArray(dest)) {
        const ref = dest[0];
        const pageIndex = await this.pdfDoc.getPageIndex(ref);
        return pageIndex + 1;
      }
    } catch(e) {}
    return 1;
  }

  showLoading(text) {
    const spinner = document.getElementById('loading-spinner');
    const loadingText = document.getElementById('loading-text');
    if (spinner) spinner.style.display = 'block';
    if (loadingText) loadingText.textContent = text || '';
  }

  hideLoading() {
    const spinner = document.getElementById('loading-spinner');
    const loadingText = document.getElementById('loading-text');
    if (spinner) spinner.style.display = 'none';
    if (loadingText) loadingText.textContent = '';
  }

  // Thumbnail generation
  async renderThumbnail(pageNum, maxWidth = 150) {
    const page = await this.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const scale = maxWidth / viewport.width;
    const scaledViewport = page.getViewport({ scale, rotation: this.rotation });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;

    await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
    return canvas;
  }
}
