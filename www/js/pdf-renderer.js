// ===== PDF Renderer Module =====
// High-performance PDF.js renderer with viewport virtualization for continuous scroll mode

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
    this.container = document.getElementById('canvas-container');
    this.scrollObserver = null;
    this.pageAspectRatios = new Map(); // pageNum -> aspect ratio (width / height)
    this.renderedPages = new Set(); // page numbers currently rendered with canvas
    this.renderingPages = new Set(); // page numbers currently in rendering pipeline
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
      // Clean up previous observer & rendered pages
      if (this.scrollObserver) {
        this.scrollObserver.disconnect();
        this.scrollObserver = null;
      }
      this.renderedPages.clear();
      this.renderingPages.clear();
      this.pageAspectRatios.clear();

      const loadingTask = this.pdfjsLib.getDocument({ data: fileData });
      this.pdfDoc = await loadingTask.promise;
      this.totalPages = this.pdfDoc.numPages;
      this.rotation = 0;

      // Pre-calculate page aspect ratios from first page or all pages efficiently
      const firstPage = await this.pdfDoc.getPage(1);
      const firstViewport = firstPage.getViewport({ scale: 1 });
      const defaultAspect = firstViewport.width / firstViewport.height;

      for (let i = 1; i <= this.totalPages; i++) {
        this.pageAspectRatios.set(i, defaultAspect);
      }

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
    this.currentPage = pageNum;

    if (this.scrollMode === 'single') {
      await this.renderSinglePage(pageNum, forceRerender);
    } else {
      // In continuous mode, scroll to the target page wrapper
      const wrapper = this.container.querySelector(`.page-wrapper[data-page="${pageNum}"]`);
      if (wrapper) {
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    document.getElementById('page-input').value = pageNum;
    if (this.onPageChange) this.onPageChange(pageNum, this.totalPages);
  }

  async renderSinglePage(pageNum, forceRerender = false) {
    if (this.rendering && !forceRerender) return;
    this.rendering = true;

    try {
      const page = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: this.scale, rotation: this.rotation });

      // Explicitly release memory of old canvases in container before re-creating
      this.container.querySelectorAll('canvas').forEach(c => {
        c.width = 0; c.height = 0;
      });
      this.container.innerHTML = '';

      const wrapper = document.createElement('div');
      wrapper.className = 'page-wrapper';
      wrapper.dataset.page = pageNum;
      wrapper.style.width = Math.floor(viewport.width) + 'px';
      wrapper.style.height = Math.floor(viewport.height) + 'px';

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const dpr = Math.min(window.devicePixelRatio || 1, 2); // Cap DPR to 2 to prevent GPU OOM on mobile
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = Math.floor(viewport.width) + 'px';
      canvas.style.height = Math.floor(viewport.height) + 'px';
      ctx.scale(dpr, dpr);
      wrapper.appendChild(canvas);

      const textLayer = document.createElement('div');
      textLayer.className = 'text-layer';
      textLayer.style.width = Math.floor(viewport.width) + 'px';
      textLayer.style.height = Math.floor(viewport.height) + 'px';
      wrapper.appendChild(textLayer);

      const annotationLayer = document.createElement('div');
      annotationLayer.className = 'annotation-layer';
      annotationLayer.dataset.page = pageNum;
      wrapper.appendChild(annotationLayer);

      this.container.appendChild(wrapper);

      await page.render({ canvasContext: ctx, viewport }).promise;
      const textContent = await page.getTextContent();
      this.renderTextLayer(textContent, textLayer, viewport);

      this.container.scrollTop = 0;
    } catch (err) {
      console.error('Render single page error:', err);
    } finally {
      this.rendering = false;
    }
  }

  // ===== Virtualized Continuous Scroll Mode =====
  // Builds lightweight placeholder wrappers for all pages; renders canvases ONLY when in viewport
  setupContinuousMode(scrollToPage = null) {
    if (!this.pdfDoc) return;

    if (this.scrollObserver) {
      this.scrollObserver.disconnect();
      this.scrollObserver = null;
    }

    // Release old canvas memory
    this.container.querySelectorAll('canvas').forEach(c => {
      c.width = 0; c.height = 0;
    });
    this.container.innerHTML = '';
    this.renderedPages.clear();
    this.renderingPages.clear();

    const targetPage = scrollToPage || this.currentPage;

    // Create lightweight placeholder DOM elements for all pages
    const fragment = document.createDocumentFragment();

    for (let i = 1; i <= this.totalPages; i++) {
      const aspect = this.pageAspectRatios.get(i) || 0.75;
      const containerWidth = Math.max(280, this.container.clientWidth - 20);
      const width = Math.floor(containerWidth * (this.scale || 1.0));
      const height = Math.floor(width / aspect);

      const wrapper = document.createElement('div');
      wrapper.className = 'page-wrapper placeholder';
      wrapper.dataset.page = i;
      wrapper.style.width = width + 'px';
      wrapper.style.height = height + 'px';
      wrapper.style.minHeight = height + 'px';

      fragment.appendChild(wrapper);
    }

    this.container.appendChild(fragment);

    // Instant scroll to current page
    const targetWrapper = this.container.querySelector(`.page-wrapper[data-page="${targetPage}"]`);
    if (targetWrapper) {
      targetWrapper.scrollIntoView({ behavior: 'instant', block: 'start' });
    }

    // Initialize IntersectionObserver for lazy canvas rendering & unrendering
    this.setupVirtualizationObserver();
  }

  setupVirtualizationObserver() {
    if (this.scrollObserver) {
      this.scrollObserver.disconnect();
    }

    // Margin around viewport to pre-render adjacent pages (300px above & below)
    const options = {
      root: this.container,
      rootMargin: '300px 0px 300px 0px',
      threshold: 0.01
    };

    let debounceTimer = null;

    this.scrollObserver = new IntersectionObserver((entries) => {
      let mostVisiblePage = this.currentPage;
      let maxRatio = 0;

      entries.forEach(entry => {
        const pageNum = parseInt(entry.target.dataset.page);
        if (!pageNum) return;

        if (entry.isIntersecting) {
          // Render page canvas if not already rendered or rendering
          if (!this.renderedPages.has(pageNum) && !this.renderingPages.has(pageNum)) {
            this.renderPageCanvas(pageNum, entry.target);
          }

          if (entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio;
            mostVisiblePage = pageNum;
          }
        } else {
          // Unload off-screen page canvas to free GPU memory!
          if (this.renderedPages.has(pageNum)) {
            this.unloadPageCanvas(entry.target, pageNum);
          }
        }
      });

      // Update current page with debounce to avoid firing heavy handlers on every scroll tick
      if (mostVisiblePage && mostVisiblePage !== this.currentPage) {
        this.currentPage = mostVisiblePage;
        document.getElementById('page-input').value = mostVisiblePage;

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (this.onPageChange) this.onPageChange(this.currentPage, this.totalPages);
        }, 80);
      }
    }, options);

    this.container.querySelectorAll('.page-wrapper').forEach(w => this.scrollObserver.observe(w));
  }

  async renderPageCanvas(pageNum, wrapper) {
    if (this.renderedPages.has(pageNum) || this.renderingPages.has(pageNum)) return;
    this.renderingPages.add(pageNum);

    try {
      const page = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: this.scale, rotation: this.rotation });

      // Update aspect ratio & exact dimensions
      const aspect = viewport.width / viewport.height;
      this.pageAspectRatios.set(pageNum, aspect);

      wrapper.style.width = Math.floor(viewport.width) + 'px';
      wrapper.style.height = Math.floor(viewport.height) + 'px';
      wrapper.classList.remove('placeholder');

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const dpr = Math.min(window.devicePixelRatio || 1, 2); // Cap DPR to 2 for mobile GPU protection
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = Math.floor(viewport.width) + 'px';
      canvas.style.height = Math.floor(viewport.height) + 'px';
      ctx.scale(dpr, dpr);
      wrapper.appendChild(canvas);

      const textLayer = document.createElement('div');
      textLayer.className = 'text-layer';
      textLayer.style.width = Math.floor(viewport.width) + 'px';
      textLayer.style.height = Math.floor(viewport.height) + 'px';
      wrapper.appendChild(textLayer);

      const annotationLayer = document.createElement('div');
      annotationLayer.className = 'annotation-layer';
      annotationLayer.dataset.page = pageNum;
      wrapper.appendChild(annotationLayer);

      await page.render({ canvasContext: ctx, viewport }).promise;

      const textContent = await page.getTextContent();
      this.renderTextLayer(textContent, textLayer, viewport);

      this.renderedPages.add(pageNum);

      // Trigger annotation rendering for newly visible page if callback registered
      if (this.onPageChange) {
        this.onPageChange(this.currentPage, this.totalPages);
      }
    } catch (err) {
      console.error(`Error rendering page ${pageNum}:`, err);
    } finally {
      this.renderingPages.delete(pageNum);
    }
  }

  unloadPageCanvas(wrapper, pageNum) {
    // Clear canvas context size to force GPU VRAM garbage collection immediately
    const canvas = wrapper.querySelector('canvas');
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    wrapper.innerHTML = '';
    wrapper.classList.add('placeholder');
    this.renderedPages.delete(pageNum);
  }

  renderTextLayer(textContent, textLayerDiv, viewport) {
    textLayerDiv.innerHTML = '';
    const textItems = textContent.items;

    const fragment = document.createDocumentFragment();
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
      fragment.appendChild(span);
    });
    textLayerDiv.appendChild(fragment);
  }

  // ===== Navigation =====
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
    this.renderPage(p);
  }

  // ===== Zoom & Layout =====
  zoomIn() { this.setZoom(Math.min(this.scale + 0.25, 4.0)); }
  zoomOut() { this.setZoom(Math.max(this.scale - 0.25, 0.4)); }

  setZoom(newScale) {
    const savedPage = this.currentPage;
    this.scale = Math.round(newScale * 100) / 100;
    document.getElementById('zoom-display').textContent = Math.round(this.scale * 100) + '%';

    if (this.scrollMode === 'continuous') {
      this.setupContinuousMode(savedPage);
    } else {
      this.renderSinglePage(savedPage, true);
    }
  }

  async fitWidth() {
    if (!this.pdfDoc) return;
    const page = await this.pdfDoc.getPage(this.currentPage);
    const viewport = page.getViewport({ scale: 1, rotation: this.rotation });
    const containerWidth = Math.max(280, this.container.clientWidth - 20);
    if (containerWidth <= 0) return;
    const newScale = Math.max(0.2, containerWidth / viewport.width);
    this.setZoom(newScale);
  }

  async fitPage() {
    if (!this.pdfDoc) return;
    const page = await this.pdfDoc.getPage(this.currentPage);
    const viewport = page.getViewport({ scale: 1, rotation: this.rotation });
    const containerWidth = Math.max(280, this.container.clientWidth - 20);
    const containerHeight = Math.max(300, this.container.clientHeight - 20);
    const scaleW = containerWidth / viewport.width;
    const scaleH = containerHeight / viewport.height;
    const newScale = Math.max(0.2, Math.min(scaleW, scaleH));
    this.setZoom(newScale);
  }

  rotate() {
    this.rotation = (this.rotation + 90) % 360;
    if (this.scrollMode === 'continuous') {
      this.setupContinuousMode(this.currentPage);
    } else {
      this.renderSinglePage(this.currentPage, true);
    }
  }

  setScrollMode(mode) {
    const savedPage = this.currentPage;
    this.scrollMode = mode;

    if (mode === 'continuous') {
      this.setupContinuousMode(savedPage);
    } else {
      if (this.scrollObserver) {
        this.scrollObserver.disconnect();
        this.scrollObserver = null;
      }
      this.renderSinglePage(savedPage, true);
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
    canvas.width = Math.floor(scaledViewport.width);
    canvas.height = Math.floor(scaledViewport.height);

    await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
    return canvas;
  }
}
