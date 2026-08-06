// ===== Settings Module =====
// Theme management, reading preferences, and persistence

export class Settings {
  constructor() {
    this.themes = ['light', 'dark', 'sepia'];
    this.themeIndex = 1; // default dark
    this.scrollMode = 'single'; // 'single' or 'continuous'
    this.load();
    this.apply();
  }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem('br_settings'));
      if (saved) {
        this.themeIndex = saved.themeIndex ?? 1;
        this.scrollMode = saved.scrollMode ?? 'single';
      }
    } catch(e) {}
  }

  save() {
    localStorage.setItem('br_settings', JSON.stringify({
      themeIndex: this.themeIndex,
      scrollMode: this.scrollMode,
    }));
  }

  apply() {
    document.documentElement.setAttribute('data-theme', this.currentTheme);
    const badge = document.getElementById('reading-mode-badge');
    if (badge) badge.textContent = this.currentTheme.charAt(0).toUpperCase() + this.currentTheme.slice(1);
  }

  get currentTheme() {
    return this.themes[this.themeIndex];
  }

  cycleTheme() {
    this.themeIndex = (this.themeIndex + 1) % this.themes.length;
    this.apply();
    this.save();
    return this.currentTheme;
  }

  setScrollMode(mode) {
    this.scrollMode = mode;
    this.save();
  }

  toggleScrollMode() {
    this.scrollMode = this.scrollMode === 'single' ? 'continuous' : 'single';
    this.save();
    return this.scrollMode;
  }
}
