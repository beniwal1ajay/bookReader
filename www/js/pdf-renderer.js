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
    this.renderQueue = null; // queued page number to render after current finishes
    this.pageCache = new Map();
    this.container = document.getElementById('canvas-container');
    this.scrollObserver = null; // track observer so we can disconnect
    this.fileName = '';
    this.fileSize = 0;
    this.onPageChange = null;
    this.onDocLoaded = null;
  }

  async loadDocument(fileData, fileName, fileSize) {
    this.fileName = fileName;
    this.fileSize = fileSize;
    this.currentPage = 1;
    this.showLoading('Loading document...');

    try {
      const loadingTask = this.pdfjsLib.getDocument({ data: fileData });
      this.pdfDoc = await loadingTask.promise;
      this.totalPages = this.pdfDoc.numPages;
      this.rotation = 0;
      this.rendering = false;
      this.renderQueue = null;
      this.pageCache.clear();

      document.getElementById('page-total').textContent = this.totalPages;
      document.getElementById('page-input').max = this.totalPages;
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

    // If already rendering, queue the request instead of dropping it
    if (this.rendering && !forceRerender) {
      this.renderQueue = pageNum;
      return;
    }

    this.rendering = true;
    this.currentPage = pageNum;

    try {
      if (this.scrollMode === 'single') {
        await this.renderSinglePage(pageNum);
      } else {
        // In continuous mode, just scroll to the page
        const wrapper = this.container.querySelector(`.page-wrapper[data-page="${pageNum}"]`);
        if (wrapper) {
          wrapper.scrollIntoView({ behavior: 'smooth' });
        }
      }
      // Update page input
      document.getElementById('page-input').value = pageNum;
      if (this.onPageChange) this.onPageChange(pageNum, this.totalPages);
    } catch (err) {
      console.error('Render error:', err);
    }

    this.rendering = false;

    // Process queued render request
    if (this.renderQueue !== null) {
      const queuedPage = this.renderQueue;
      this.renderQueue = null;
      await this.renderPage(queuedPage);
    }
  }

  async renderSinglePage(pageNum) {
    const page = await this.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: this.scale, rotation: this.rotation });

    // Clear container and create wrapper
    this.container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'page-wrapper';
    wrapper.dataset.page = pageNum;
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

  async renderContinuous(scrollToPage = null) {
    // Disconnect old observer
    if (this.scrollObserver) {
      this.scrollObserver.disconnect();
      this.scrollObserver = null;
    }

    const targetPage = scrollToPage || this.currentPage;
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

    // Scroll to the target page after rendering
    const targetWrapper = this.container.querySelector(`.page-wrapper[data-page="${targetPage}"]`);
    if (targetWrapper) {
      // Use instant scroll so user sees the right page immediately
      targetWrapper.scrollIntoView({ behavior: 'instant', block: 'start' });
    }

    // Setup scroll observer for continuous mode
    this.setupScrollObserver();
  }

  setupScrollObserver() {
    // Disconnect old observer if any
    if (this.scrollObserver) {
      this.scrollObserver.disconnect();
    }

    this.scrollObserver = new IntersectionObserver((entries) => {
      // Find the most visible page
      let bestEntry = null;
      let bestRatio = 0;
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.intersectionRatio > bestRatio) {
          bestRatio = entry.intersectionRatio;
          bestEntry = entry;
        }
      });

      if (bestEntry) {
        const pageNum = parseInt(bestEntry.target.dataset.page);
        if (pageNum && pageNum !== this.currentPage) {
          this.currentPage = pageNum;
          document.getElementById('page-input').value = pageNum;
          if (this.onPageChange) this.onPageChange(pageNum, this.totalPages);
        }
      }
    }, { root: this.container, threshold: [0.1, 0.25, 0.5, 0.75] });

    this.container.querySelectorAll('.page-wrapper').forEach(w => this.scrollObserver.observe(w));
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
      this.goToPage(this.currentPage + 1);
    }
  }

  prevPage() {
    if (this.currentPage > 1) {
      this.goToPage(this.currentPage - 1);
    }
  }

  goToPage(num) {
    const p = Math.max(1, Math.min(num, this.totalPages));
    if (this.scrollMode === 'continuous') {
      const wrapper = this.container.querySelector(`.page-wrapper[data-page="${p}"]`);
      if (wrapper) {
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
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
    const savedPage = this.currentPage;
    this.scale = Math.round(newScale * 100) / 100;
    document.getElementById('zoom-display').textContent = Math.round(this.scale * 100) + '%';
    if (this.scrollMode === 'continuous') {
      this.renderContinuous(savedPage);
    } else {
      this.renderPage(savedPage, true);
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
    const newScale = Math.max(0.1, containerWidth / viewport.width);
    // Only re-render if scale actually changed
    if (Math.abs(newScale - this.scale) > 0.01) {
      this.setZoom(newScale);
    }
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
    const newScale = Math.max(0.1, Math.min(scaleW, scaleH));
    if (Math.abs(newScale - this.scale) > 0.01) {
      this.setZoom(newScale);
    }
  }

  rotate() {
    this.rotation = (this.rotation + 90) % 360;
    if (this.scrollMode === 'continuous') {
      this.renderContinuous(this.currentPage);
    } else {
      this.renderPage(this.currentPage, true);
    }
  }

  setScrollMode(mode) {
    const savedPage = this.currentPage;
    this.scrollMode = mode;

    // Disconnect observer when leaving continuous mode
    if (mode === 'single' && this.scrollObserver) {
      this.scrollObserver.disconnect();
      this.scrollObserver = null;
    }

    if (mode === 'continuous') {
      this.renderContinuous(savedPage);
    } else {
      this.rendering = false; // reset lock when switching modes
      this.renderQueue = null;
      this.renderPage(savedPage, true);
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
