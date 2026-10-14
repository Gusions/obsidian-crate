'use strict';
const { Plugin, ItemView, Modal, Setting, PluginSettingTab, Notice, TFile, Platform, setIcon, parseYaml, stringifyYaml, requestUrl, debounce } = require('obsidian');
const { parseCSV, FIELDS, guessMapping, mappedRecord, importKeys, validFolder, safeName, matchFacet, facetCounts, spentTotals, pickArtwork, makeT, pickLang } = require('./core');

const VIEW = 'crate-collection';
const SIDEBAR = 'crate-sidebar';
const DEFAULTS = { folder: 'Vinili', accentMode: 'theme', accent: '#d79255', cardSize: 190, layout: 'grid', sort: 'artist', customFields: '', autoCover: true, sidebarSeen: false, language: 'auto' };
const REQUIRED = ['title', 'artist'];
const FACETS = ['artist', 'genre', 'label', 'decade', 'location', 'tags'];

/* ---------- language ---------- */
let T = makeT('en'), LOCALE = 'en';
const tr = (key, vars) => T(key, vars);
tr.n = (key, n) => T.n(key, n);
// 'auto' follows the Obsidian interface language; anything unsupported falls back to English.
function setLanguage(setting) {
  let code = setting;
  if (!code || code === 'auto') { try { code = window.localStorage.getItem('language') || navigator.language || 'en'; } catch { code = 'en'; } }
  T = makeT(pickLang(code)); LOCALE = T.lang;
}

/* ---------- helpers ---------- */
function fail(e) { new Notice(e && e.message ? e.message : String(e)); }
function button(parent, text, action, cls = '') {
  const b = parent.createEl('button', { text, cls });
  b.addEventListener('click', () => Promise.resolve().then(action).catch(fail));
  return b;
}
// Accessible non-<button> control: avoids Obsidian's native button styling.
function activatable(el, action, role = 'button') {
  el.setAttribute('role', role); el.setAttribute('tabindex', '0');
  const run = e => Promise.resolve().then(() => action(e)).catch(fail);
  el.addEventListener('click', run);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(e); } });
}
function hash(text) { let h = 0; for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
function onAccent(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return '#1a1a1a';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#1a1a1a' : '#ffffff';
}
// By default the accent follows the active Obsidian theme (--interactive-accent, set in styles.css).
// Inline variables are only written when the user picked a custom colour.
function theme(el, s) {
  if (s.accentMode === 'custom') { el.style.setProperty('--crate-accent', s.accent); el.style.setProperty('--crate-on-accent', onAccent(s.accent)); }
  else { el.style.removeProperty('--crate-accent'); el.style.removeProperty('--crate-on-accent'); }
  el.style.setProperty('--crate-card', `${s.cardSize}px`);
}
function setOwn(obj, key, value) { Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true }); }
function asText(v) { return Array.isArray(v) ? v.join(' ') : String(v ?? ''); }
function customNames(settings) { return settings.customFields.split(',').map(x => x.trim()).filter(Boolean); }
function statusOf(r) { return r.status === 'wishlist' ? 'wishlist' : 'collection'; }
function money({ currency, total }) {
  try { return new Intl.NumberFormat(LOCALE, { style: 'currency', currency, maximumFractionDigits: 0 }).format(total); }
  catch { return `${Math.round(total)} ${currency}`; }
}

// Cover tile: real image when available, otherwise a CSS-drawn record tinted with the theme accent.
function buildArt(plugin, parent, r) {
  const art = parent.createDiv('crate-art');
  art.style.setProperty('--crate-tint', String(6 + (hash(`${r.artist}|${r.title}`) % 18)));
  const disc = art.createDiv('crate-disc'); disc.createDiv('crate-disc-label');
  const src = plugin.coverSrc(r.cover);
  if (src) {
    const img = art.createEl('img', { attr: { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' } });
    img.addEventListener('error', () => img.remove());
  }
  return art;
}

function readRecord(file, content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) return null;
  const data = parseYaml(m[1]);
  if (data?.crate !== true || !data.crate_id) return null;
  return { ...Object.fromEntries(Object.keys(FIELDS).map(k => [k, ''])), ...data, file, title: String(data.title || file.basename), artist: String(data.artist || ''), custom: data.custom || {} };
}

/* ---------- plugin ---------- */
class CratePlugin extends Plugin {
  async onload() {
    const saved = await this.loadData();
    this.settings = { ...DEFAULTS, ...saved };
    setLanguage(this.settings.language);
    // Fresh installs get a folder name in the user's language; existing installs keep theirs.
    if (!saved || !saved.folder) this.settings.folder = LOCALE === 'it' ? 'Vinili' : 'Vinyl';
    this.records = []; this.invalid = 0; this.discogsToken = ''; this.coverQueue = Promise.resolve(); this.scanVersion = 0;
    // Navigation state shared by the collection view and the side panel.
    this.ui = { status: 'all', query: '', sort: this.settings.sort, facet: null };
    this.registerView(VIEW, leaf => new CrateView(leaf, this));
    this.registerView(SIDEBAR, leaf => new CrateSidebar(leaf, this));
    this.addRibbonIcon('disc-3', tr('app.open'), async () => { await this.ensureSidebar(true); await this.activate(); });
    this.addCommand({ id: 'open-collection', name: tr('cmd.open'), callback: () => this.activate() });
    this.addCommand({ id: 'show-sidebar', name: tr('cmd.sidebar'), callback: () => this.ensureSidebar(true) });
    this.addCommand({ id: 'add-record', name: tr('cmd.add'), callback: () => new RecordModal(this).open() });
    this.addCommand({ id: 'fetch-covers', name: tr('cmd.covers'), callback: () => this.fillCovers() });
    this.addCommand({ id: 'import-csv', name: tr('cmd.import'), callback: () => this.pickCSV() });
    this.addSettingTab(new CrateSettings(this.app, this));
    // The side panel decides whether the collection view shows its own status tabs, so re-render when panels open/close.
    this.registerEvent(this.app.workspace.on('layout-change', debounce(() => this.refresh(), 250, true)));
    const rescan = debounce(() => this.scan().catch(fail), 400, true);
    // Only react to files inside the Crate folder, not to every change in the vault.
    for (const event of ['create', 'modify', 'delete']) this.registerEvent(this.app.vault.on(event, f => { if (this.inFolder(f.path)) rescan(); }));
    this.registerEvent(this.app.vault.on('rename', (f, old) => { if (this.inFolder(f.path) || this.inFolder(old)) rescan(); }));
    this.app.workspace.onLayoutReady(async () => {
      try {
        await this.scan();
        // First run only: put the Crate panel in the left sidebar so everything is reachable from there.
        if (!this.settings.sidebarSeen) { this.settings.sidebarSeen = true; await this.saveData(this.settings); await this.ensureSidebar(true); }
      } catch (e) { fail(e); }
    });
  }
  inFolder(path) {
    try { const f = validFolder(this.settings.folder); return path === f || String(path).startsWith(f + '/'); } catch { return false; }
  }
  folderPath() { try { return validFolder(this.settings.folder); } catch { return this.settings.folder; } }
  async activate() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: VIEW, active: true }); await this.scan(); }
    await this.app.workspace.revealLeaf(leaf);
    return leaf;
  }
  async ensureSidebar(reveal = false) {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(SIDEBAR)[0];
    if (!leaf) { leaf = ws.getLeftLeaf(false); if (!leaf) return; await leaf.setViewState({ type: SIDEBAR, active: reveal }); }
    if (reveal) await ws.revealLeaf(leaf);
  }
  // True when the Crate side panel is actually on screen (not mobile, not collapsed, not hidden behind another tab).
  sidebarVisible() {
    if (Platform.isMobile) return false;
    return this.app.workspace.getLeavesOfType(SIDEBAR).some(l => l.view?.containerEl?.offsetParent !== null);
  }
  async openCollection(patch = {}) {
    Object.assign(this.ui, patch);
    await this.activate(); this.refresh();
  }
  filteredRecords() {
    const ui = this.ui, q = ui.query.trim().toLocaleLowerCase();
    return this.records.filter(r => (ui.status === 'all' || statusOf(r) === ui.status) && matchFacet(r, ui.facet)
      && (!q || [r.title, r.artist, r.genre, r.tags, r.label, r.location, r.catalog].map(asText).join(' ').toLocaleLowerCase().includes(q)));
  }
  async revealFolder() {
    const path = this.folderPath();
    if (!this.app.vault.getAbstractFileByPath(path)) await this.ensureFolder();
    const folder = this.app.vault.getAbstractFileByPath(path);
    const explorer = this.app.workspace.getLeavesOfType('file-explorer')[0];
    if (explorer?.view?.revealInFolder && folder) { await this.app.workspace.revealLeaf(explorer); explorer.view.revealInFolder(folder); }
    else new Notice(tr('folder.where', { path }));
  }
  async scan() {
    const version = ++this.scanVersion;
    const records = []; let invalid = 0, prefix = null;
    try { prefix = validFolder(this.settings.folder) + '/'; } catch { /* invalid folder setting: show an empty collection */ }
    if (prefix) {
      const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(prefix));
      const parsed = await Promise.all(files.map(async file => {
        try { return readRecord(file, await this.app.vault.cachedRead(file)); } catch { invalid++; return null; }
      }));
      for (const r of parsed) if (r) records.push(r);
    }
    if (version !== this.scanVersion) return;
    this.records = records; this.invalid = invalid; this.refresh();
  }
  // full=true rebuilds the collection view (settings changed); otherwise data is refreshed in place.
  refresh(full = false) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) {
      const view = leaf.view;
      if (view instanceof CrateView) full ? view.build() : view.update();
    }
    this.updateSidebars();
  }
  updateSidebars() {
    for (const leaf of this.app.workspace.getLeavesOfType(SIDEBAR)) { const v = leaf.view; if (v instanceof CrateSidebar) v.update(); }
  }
  async ensureFolder() {
    const folder = validFolder(this.settings.folder); let current = '';
    for (const part of folder.split('/')) { current += (current ? '/' : '') + part; if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current); }
    return folder;
  }
  async saveRecord(record, opts = {}) {
    const { file, ...data } = record;
    data.crate = true; data.crate_id ||= crypto.randomUUID();
    data.title = String(data.title || '').trim(); data.artist = String(data.artist || '').trim();
    if (!data.title || !data.artist) throw new Error(tr('err.required'));
    if (file) {
      await this.app.fileManager.processFrontMatter(file, fm => {
        // Only plugin-owned properties are updated. Preserve body and unrelated frontmatter.
        for (const [key, value] of Object.entries(data)) if (value !== undefined) fm[key] = value;
      });
    } else {
      const folder = await this.ensureFolder();
      const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== '' && v !== undefined && !(v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)));
      const path = `${folder}/${safeName(data.artist + ' - ' + data.title, tr('default.name'))} - ${data.crate_id}.md`;
      record.file = await this.app.vault.create(path, `---\n${stringifyYaml(clean)}---\n\n## ${tr('notes.heading')}\n\n`);
    }
    record.crate_id = data.crate_id; record.title = data.title; record.artist = data.artist;
    if (opts.scan !== false) await this.scan();
    return record;
  }
  pickCSV() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.csv,text/csv';
    input.onchange = async () => {
      try { if (input.files[0]) new ImportModal(this, parseCSV(await input.files[0].text(), T)).open(); }
      catch (e) { fail(e); }
    };
    input.click();
  }
  // Cover lookup: Discogs when release ID + token are available, otherwise iTunes Search (no key, public artwork).
  async cover(record, opts = {}) {
    if (!record.file) throw new Error(tr('cover.saveFirst'));
    const id = String(record.releaseId ?? '').trim();
    const useDiscogs = /^\d+$/.test(id) && !!this.discogsToken;
    const task = this.coverQueue.catch(() => {}).then(async () => {
      const gap = useDiscogs ? 1200 : 3200, elapsed = Date.now() - (this.lastCoverRequest || 0);
      if (elapsed < gap) await new Promise(resolve => setTimeout(resolve, gap - elapsed));
      this.lastCoverRequest = Date.now();
      let url = '';
      if (useDiscogs) {
        const response = await requestUrl({ url: `https://api.discogs.com/releases/${id}`, headers: { Authorization: `Discogs token=${this.discogsToken}` }, throw: false });
        if (response.status === 429) throw new Error(tr('cover.limitDiscogs'));
        if (response.status !== 200) throw new Error(tr('cover.discogs', { s: response.status }));
        const images = response.json.images || [];
        url = (images.find(i => i.type === 'primary') || images[0])?.uri || response.json.thumb;
      } else {
        // Three progressively broader searches: "artist title", the title alone, then the artist's albums.
        const attempts = [[`${record.artist} ${record.title}`, 10], [record.title, 25], [record.artist, 50]];
        for (let i = 0; i < attempts.length && !url; i++) {
          if (i) await new Promise(resolve => setTimeout(resolve, 1500));
          const [text, limit] = attempts[i];
          const response = await requestUrl({ url: `https://itunes.apple.com/search?term=${encodeURIComponent(text)}&entity=album&limit=${limit}`, throw: false });
          if (response.status === 403 || response.status === 429) { const e = new Error(tr('cover.limit')); e.limit = true; throw e; }
          if (response.status !== 200) throw new Error(tr('cover.status', { s: response.status }));
          url = pickArtwork(response.json.results, record.artist, record.title);
        }
      }
      if (!url || !/^https:\/\//i.test(url)) throw new Error(tr('cover.none'));
      await this.app.fileManager.processFrontMatter(record.file, fm => { fm.cover = url; });
      record.cover = url;
      if (opts.scan !== false) await this.scan();
      return url;
    });
    this.coverQueue = task; return task;
  }
  // Fills every record that has no cover yet, one at a time, reporting progress in a single notice.
  async fillCovers() {
    if (this.fillingCovers) { new Notice(tr('cover.busy')); return; }
    await this.scan();
    const todo = this.records.filter(r => !r.cover && r.file);
    if (!todo.length) { new Notice(tr('cover.all')); return; }
    this.fillingCovers = true;
    const notice = new Notice(tr('cover.progress', { i: 0, n: todo.length, ok: 0 }), 0); let ok = 0, miss = 0;
    try {
      for (let i = 0; i < todo.length; i++) {
        try { await this.cover(todo[i], { scan: false }); ok++; } catch (e) { miss++; if (e.limit) break; }
        notice.setMessage(tr('cover.progress', { i: i + 1, n: todo.length, ok }));
        if (i % 5 === 4) await this.scan();
      }
    } finally { this.fillingCovers = false; await this.scan(); notice.hide(); new Notice(tr('cover.done', { ok, miss })); }
  }
  coverSrc(value) {
    if (!value) return '';
    value = String(value);
    if (/^https:\/\//i.test(value)) return value;
    if (/^[a-z]+:/i.test(value) || value.startsWith('//')) return '';
    const file = this.app.vault.getAbstractFileByPath(value);
    return file instanceof TFile ? this.app.vault.getResourcePath(file) : '';
  }
}

/* ---------- collection view ---------- */
class CrateView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.built = false; }
  getViewType() { return VIEW; }
  getDisplayText() { return 'Crate'; }
  getIcon() { return 'disc-3'; }
  async onOpen() { this.build(); }
  // Builds the static shell once; update() then refreshes data without losing focus or scroll.
  build() {
    const p = this.plugin, ui = p.ui, root = this.contentEl; root.empty(); root.addClass('crate'); theme(root, p.settings);
    const wrap = root.createDiv('crate-wrap');
    const header = wrap.createDiv('crate-header');
    const title = header.createDiv('crate-title'); title.createEl('h1', { text: 'Crate' }); this.subEl = title.createDiv('crate-sub');
    const actions = header.createDiv('crate-actions');
    button(actions, tr('btn.import'), () => p.pickCSV());
    button(actions, tr('btn.add'), () => new RecordModal(p).open(), 'mod-cta');
    this.statsEl = wrap.createDiv('crate-stats');
    this.tabsEl = wrap.createDiv('crate-tabs');

    const toolbar = wrap.createDiv('crate-toolbar');
    const searchWrap = toolbar.createDiv('crate-search');
    setIcon(searchWrap.createSpan('crate-search-icon'), 'search');
    const search = searchWrap.createEl('input', { type: 'search', placeholder: tr('search.ph'), attr: { 'aria-label': tr('search.aria') } });
    search.value = ui.query;
    const sort = toolbar.createEl('select', { attr: { 'aria-label': tr('sort.aria') } });
    for (const value of ['artist', 'title', 'year']) sort.createEl('option', { text: tr('sort.' + value), value });
    sort.value = ui.sort;
    const seg = toolbar.createDiv({ cls: 'crate-seg', attr: { role: 'group', 'aria-label': tr('layout.aria') } });
    this.segButtons = {};
    for (const [layout, icon] of [['grid', 'layout-grid'], ['list', 'list']]) {
      const label = tr('layout.' + layout);
      const b = seg.createDiv({ cls: 'crate-seg-btn', attr: { 'aria-label': label, title: label } });
      setIcon(b, icon); this.segButtons[layout] = b;
      activatable(b, async () => {
        if (p.settings.layout === layout) return;
        p.settings.layout = layout; await p.saveData(p.settings); this.syncSeg(); this.renderRecords();
      });
    }
    this.syncSeg();
    this.noticeEl = wrap.createDiv();
    this.resultsEl = wrap.createDiv('crate-results');
    this.footEl = wrap.createDiv('crate-foot');
    search.addEventListener('input', () => { ui.query = search.value; this.renderRecords(); });
    sort.addEventListener('change', async () => { ui.sort = sort.value; p.settings.sort = sort.value; await p.saveData(p.settings); this.renderRecords(); });
    this.built = true; this.update();
  }
  syncSeg() {
    for (const [layout, b] of Object.entries(this.segButtons)) {
      const on = this.plugin.settings.layout === layout;
      b.toggleClass('is-active', on); b.setAttribute('aria-pressed', String(on));
    }
  }
  update() {
    if (!this.built) return;
    const p = this.plugin;
    this.renderStats(); this.renderTabs(); this.renderFoot();
    this.noticeEl.empty();
    if (p.invalid) this.noticeEl.createEl('p', { text: tr.n('invalid', p.invalid), cls: 'crate-muted' });
    this.renderRecords();
  }
  // Called after a filter change made inside this view.
  afterFilter() { this.renderTabs(); this.renderRecords(); this.plugin.updateSidebars(); }
  renderStats() {
    const p = this.plugin, el = this.statsEl, all = p.records; el.empty();
    this.subEl.setText(all.length ? tr('sub.have') : tr('sub.none'));
    el.toggleClass('is-hidden', !all.length);
    if (!all.length) return;
    const wishlist = all.filter(r => statusOf(r) === 'wishlist').length;
    const items = [[tr('stat.records'), all.length - wishlist], [tr('stat.artists'), new Set(all.map(r => r.artist).filter(Boolean)).size], [tr('stat.wishlist'), wishlist]];
    const spent = spentTotals(all); if (spent.length) items.push([tr('stat.spent'), money(spent[0])]);
    for (const [label, value] of items) { const s = el.createDiv('crate-stat'); s.createDiv({ cls: 'crate-stat-value', text: String(value) }); s.createDiv({ cls: 'crate-stat-label', text: label }); }
  }
  // The side panel already offers All / Collection / Wishlist and the facets. When it is visible the view only shows
  // the active filters as removable chips; when it is hidden (mobile, collapsed sidebar) the view shows its own tabs.
  renderTabs() {
    const p = this.plugin, ui = p.ui, el = this.tabsEl, all = p.records; el.empty();
    const showTabs = !p.sidebarVisible();
    el.toggleClass('is-hidden', !all.length || (!showTabs && ui.status === 'all' && !ui.facet));
    if (!all.length) return;
    if (showTabs) {
      const counts = { all: all.length, collection: all.filter(r => statusOf(r) === 'collection').length, wishlist: all.filter(r => statusOf(r) === 'wishlist').length };
      const list = el.createDiv({ cls: 'crate-tablist', attr: { role: 'tablist' } });
      for (const key of ['all', 'collection', 'wishlist']) {
        const on = ui.status === key;
        const tab = list.createDiv({ cls: 'crate-tab' + (on ? ' is-active' : ''), attr: { 'aria-selected': String(on) } });
        tab.createSpan({ text: tr('tab.' + key) }); tab.createSpan({ cls: 'crate-tab-count', text: String(counts[key]) });
        activatable(tab, () => { ui.status = key; this.afterFilter(); }, 'tab');
      }
    } else if (ui.status !== 'all') this.chip(el, tr('scope.' + ui.status), () => { ui.status = 'all'; this.afterFilter(); });
    if (ui.facet) this.chip(el, `${tr('facet.' + ui.facet.key)}: ${ui.facet.value}`, () => { ui.facet = null; this.afterFilter(); });
  }
  chip(el, text, remove) {
    const chip = el.createDiv('crate-chip');
    chip.createSpan({ text });
    const x = chip.createSpan({ cls: 'crate-chip-x', attr: { 'aria-label': tr('chip.remove'), title: tr('chip.remove') } }); setIcon(x, 'x');
    activatable(x, remove);
  }
  renderFoot() {
    const p = this.plugin, el = this.footEl; el.empty();
    el.toggleClass('is-hidden', p.sidebarVisible());
    setIcon(el.createSpan('crate-foot-icon'), 'folder');
    el.createSpan({ text: tr('foot.text') + ' ' }); el.createEl('code', { text: p.folderPath() + '/' });
    const link = el.createEl('a', { text: tr('foot.show'), href: '#' });
    link.addEventListener('click', e => { e.preventDefault(); p.revealFolder().catch(fail); });
  }
  renderRecords() {
    const p = this.plugin, ui = p.ui, el = this.resultsEl; if (!el) return; el.empty();
    const records = p.filteredRecords();
    const cmp = (a, b) => String(a || '').localeCompare(String(b || ''), LOCALE, { sensitivity: 'base', numeric: true });
    records.sort((a, b) => ui.sort === 'year' ? (Number(b.year) || 0) - (Number(a.year) || 0) || cmp(a.artist, b.artist)
      : cmp(a[ui.sort], b[ui.sort]) || cmp(a.title, b.title));
    if (!records.length) {
      const empty = el.createDiv('crate-empty');
      buildArt(p, empty, { artist: 'Crate', title: tr('empty.art') });
      const filtered = p.records.length > 0;
      empty.createEl('h2', { text: filtered ? tr('empty.noneTitle') : tr('empty.startTitle') });
      empty.createEl('p', { text: filtered ? tr('empty.noneText') : tr('empty.startText', { path: p.folderPath() }) });
      const row = empty.createDiv('crate-actions');
      if (filtered) button(row, tr('empty.clear'), () => { Object.assign(ui, { status: 'all', query: '', facet: null }); this.build(); p.updateSidebars(); });
      else { button(row, tr('btn.add'), () => new RecordModal(p).open(), 'mod-cta'); button(row, tr('btn.import'), () => p.pickCSV()); }
      return;
    }
    el.createDiv({ text: tr.n('record', records.length), cls: 'crate-result-count' });
    const grid = el.createDiv(p.settings.layout === 'grid' ? 'crate-grid' : 'crate-list');
    const list = p.settings.layout === 'list';
    for (const r of records) {
      const wished = statusOf(r) === 'wishlist';
      const card = grid.createDiv({ cls: 'crate-card', attr: { 'aria-label': tr('card.aria', { artist: r.artist, title: r.title }) } });
      activatable(card, () => new RecordModal(p, r).open());
      const art = buildArt(p, card, r);
      if (wished && !list) art.createSpan({ text: tr('badge.wishlist'), cls: 'crate-badge' });
      const info = card.createDiv('crate-info'); info.createDiv({ text: r.title, cls: 'crate-name' }); info.createDiv({ text: r.artist, cls: 'crate-artist' });
      const meta = [wished && list ? tr('badge.wishlist') : '', r.year, r.format, r.location].filter(Boolean).join(' · ');
      if (meta) card.createDiv({ text: meta, cls: 'crate-meta' });
    }
  }
}

/* ---------- side panel ---------- */
function sideItem(parent, { icon, label, count, active, onClick }) {
  const row = parent.createDiv({ cls: 'crate-side-item' + (active ? ' is-active' : '') });
  if (icon) setIcon(row.createSpan('crate-side-icon'), icon);
  row.createSpan({ cls: 'crate-side-label', text: label });
  if (count != null) row.createSpan({ cls: 'crate-side-count', text: String(count) });
  activatable(row, onClick); return row;
}
class CrateSidebar extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.expanded = new Set(['artist']); this.more = new Set(); }
  getViewType() { return SIDEBAR; }
  getDisplayText() { return 'Crate'; }
  getIcon() { return 'disc-3'; }
  async onOpen() { this.update(); }
  update() {
    const p = this.plugin, ui = p.ui, root = this.contentEl, top = root.scrollTop; root.empty(); root.addClass('crate-side'); theme(root, p.settings);
    const all = p.records, wishlist = all.filter(r => statusOf(r) === 'wishlist').length;

    const head = root.createDiv('crate-side-head');
    head.createEl('h2', { text: 'Crate' });

    const nav = root.createDiv('crate-side-section');
    const here = key => ui.status === key && !ui.facet;
    sideItem(nav, { icon: 'library', label: tr('scope.all'), count: all.length, active: here('all'), onClick: () => p.openCollection({ status: 'all', facet: null }) });
    sideItem(nav, { icon: 'disc-3', label: tr('scope.collection'), count: all.length - wishlist, active: here('collection'), onClick: () => p.openCollection({ status: 'collection', facet: null }) });
    sideItem(nav, { icon: 'heart', label: tr('scope.wishlist'), count: wishlist, active: here('wishlist'), onClick: () => p.openCollection({ status: 'wishlist', facet: null }) });

    if (all.length) {
      const browse = root.createDiv('crate-side-section');
      browse.createDiv({ cls: 'crate-side-h', text: tr('side.browse') });
      for (const key of FACETS) {
        const label = tr('facets.' + key);
        const counts = facetCounts(all, key); if (!counts.length) continue;
        const group = browse.createEl('details', { cls: 'crate-side-group' });
        group.open = this.expanded.has(key);
        group.addEventListener('toggle', () => { if (group.open) this.expanded.add(key); else this.expanded.delete(key); });
        const summary = group.createEl('summary'); summary.createSpan({ text: label }); summary.createSpan({ cls: 'crate-side-count', text: String(counts.length) });
        const limit = this.more.has(key) ? counts.length : 8;
        for (const { value, count } of counts.slice(0, limit)) {
          sideItem(group, { label: value, count, active: ui.facet?.key === key && String(ui.facet.value).toLowerCase() === value.toLowerCase(), onClick: () => p.openCollection({ status: 'all', facet: { key, value } }) });
        }
        if (counts.length > limit) {
          const more = group.createDiv({ cls: 'crate-side-more', text: tr('side.more', { n: counts.length }) });
          activatable(more, () => { this.more.add(key); this.expanded.add(key); this.update(); });
        }
      }
    }

    const store = root.createDiv('crate-side-section');
    store.createDiv({ cls: 'crate-side-h', text: tr('side.storage') });
    const path = p.folderPath(), exists = !!p.app.vault.getAbstractFileByPath(path);
    const box = store.createDiv('crate-side-store');
    const line = box.createDiv('crate-side-path'); setIcon(line.createSpan('crate-side-icon'), 'folder'); line.createEl('code', { text: path + '/' });
    box.createDiv({ cls: 'crate-muted', text: exists ? tr('side.storageText', { notes: tr.n('note', all.length) }) : tr('side.willCreate') });
    const row = box.createDiv('crate-side-actions');
    button(row, exists ? tr('side.show') : tr('side.create'), () => p.revealFolder());
    button(row, tr('side.settings'), () => { const s = p.app.setting; if (s) { s.open(); s.openTabById?.(p.manifest?.id || 'crate'); } });
    root.scrollTop = top;
  }
}

/* ---------- record editor ---------- */
const SECTIONS = [
  { heading: 'sec.record', fields: ['title', 'artist', 'year', 'label', 'catalog', 'format', 'genre', 'tags'], wide: ['title', 'artist'] },
  { heading: 'sec.condition', fields: ['mediaCondition', 'sleeveCondition'], wide: [] },
  { heading: 'sec.purchase', fields: ['price', 'currency', 'purchased', 'location'], wide: ['location'] },
  { heading: 'sec.discogs', fields: ['releaseId', 'cover'], wide: ['cover'] }
];
class RecordModal extends Modal {
  constructor(plugin, record) {
    super(plugin.app); this.plugin = plugin; this.original = record; this.inputs = {};
    this.draft = { status: 'collection', format: 'LP', currency: 'EUR', ...record, custom: { ...record?.custom } };
    this.renderPreview = debounce(() => this.paintPreview(), 400, true);
  }
  paintPreview() { if (!this.previewEl) return; this.previewEl.empty(); buildArt(this.plugin, this.previewEl, this.draft); }
  onOpen() {
    const p = this.plugin, el = this.contentEl;
    this.modalEl.addClass('crate-modal'); el.addClass('crate-editor'); theme(el, p.settings);
    const head = el.createDiv('crate-editor-head');
    this.previewEl = head.createDiv('crate-preview-art'); this.paintPreview();
    const hd = head.createDiv('crate-editor-title');
    hd.createEl('h2', { text: this.original ? tr('ed.yours') : tr('ed.new') });
    hd.createDiv({ cls: 'crate-muted', text: this.original ? `${this.original.artist} — ${this.original.title}` : tr('ed.hint') });
    const statusLabel = hd.createEl('label', { cls: 'crate-inline' }); statusLabel.createSpan({ text: tr('ed.status') });
    const statusSel = statusLabel.createEl('select');
    for (const value of ['collection', 'wishlist']) statusSel.createEl('option', { text: tr('tab.' + value), value });
    statusSel.value = this.draft.status || 'collection';
    statusSel.addEventListener('change', () => { this.draft.status = statusSel.value; });

    for (const section of SECTIONS) {
      const box = el.createDiv('crate-section'); box.createEl('h3', { text: tr(section.heading) });
      const grid = box.createDiv('crate-fields');
      for (const key of section.fields) {
        const f = grid.createEl('label', { cls: section.wide.includes(key) ? 'is-wide' : '' });
        f.createSpan({ text: tr('f.' + key) + (REQUIRED.includes(key) ? ' *' : '') });
        const input = f.createEl('input', { type: 'text' }); this.inputs[key] = input;
        input.value = asText(this.draft[key]);
        input.addEventListener('input', () => { this.draft[key] = input.value; if (key === 'cover') this.renderPreview(); });
      }
    }
    const names = [...new Set([...Object.keys(this.draft.custom), ...customNames(p.settings)])];
    if (names.length) {
      const box = el.createDiv('crate-section'); box.createEl('h3', { text: tr('sec.custom') });
      const grid = box.createDiv('crate-fields');
      for (const name of names) {
        const f = grid.createEl('label'); f.createSpan({ text: name });
        const input = f.createEl('input', { type: 'text' }); input.value = asText(this.draft.custom[name]);
        input.addEventListener('input', () => setOwn(this.draft.custom, name, input.value));
      }
    }

    const error = el.createEl('p', { cls: 'crate-error', attr: { role: 'alert' } });
    const bar = el.createDiv('crate-actions-bar');
    if (this.original) {
      button(bar, tr('btn.remove'), () => new ConfirmModal(this.app, tr('ed.confirmTrash', { title: this.original.title }), async () => {
        await this.app.fileManager.trashFile(this.original.file); this.close(); await this.plugin.scan();
      }).open(), 'crate-danger');
      button(bar, tr('btn.openNote'), () => { this.app.workspace.getLeaf(false).openFile(this.original.file); this.close(); });
      const cover = button(bar, tr('btn.cover'), async () => {
        error.textContent = ''; cover.disabled = true;
        try {
          await this.plugin.saveRecord(this.draft); const url = await this.plugin.cover(this.draft);
          this.inputs.cover.value = url; this.draft.cover = url; this.paintPreview(); new Notice(tr('cover.updated'));
        } catch (e) { error.textContent = e.message; }
        finally { cover.disabled = false; }
      });
    }
    button(bar, tr('btn.cancel'), () => this.close());
    const save = button(bar, tr('btn.save'), async () => {
      save.disabled = true; error.textContent = '';
      try {
        const saved = await this.plugin.saveRecord(this.draft); this.close(); new Notice(tr('ed.saved'));
        if (this.plugin.settings.autoCover && !saved.cover) this.plugin.cover(saved).catch(() => {});
      } catch (e) { error.textContent = e.message; save.disabled = false; }
    }, 'mod-cta');
  }
  onClose() { this.contentEl.empty(); }
}
class ConfirmModal extends Modal {
  constructor(app, text, action) { super(app); this.text = text; this.action = action; }
  onOpen() {
    this.modalEl.addClass('crate-modal', 'crate-confirm');
    this.contentEl.createEl('p', { text: this.text });
    const bar = this.contentEl.createDiv('crate-actions-bar');
    button(bar, tr('btn.cancel'), () => this.close());
    button(bar, tr('btn.trash'), async () => { await this.action(); this.close(); }, 'mod-warning');
  }
}

/* ---------- CSV import ---------- */
class ImportModal extends Modal {
  constructor(plugin, csv) { super(plugin.app); this.plugin = plugin; this.csv = csv; this.mapping = guessMapping(csv.headers); }
  onOpen() {
    const p = this.plugin, el = this.contentEl;
    this.modalEl.addClass('crate-modal'); el.addClass('crate-import'); theme(el, p.settings);
    el.createEl('h2', { text: tr('imp.title') });
    el.createEl('p', { cls: 'crate-muted', text: tr('imp.intro', { rows: tr.n('row', this.csv.rows.length) }) });
    const mapBox = el.createDiv('crate-section'); mapBox.createEl('h3', { text: tr('imp.mapping') });
    const grid = mapBox.createDiv('crate-fields');
    for (const key of Object.keys(FIELDS)) {
      const f = grid.createEl('label'); f.createSpan({ text: tr('f.' + key).replace(/ \(.*\)$/, '') + (REQUIRED.includes(key) ? ' *' : '') });
      const sel = f.createEl('select');
      sel.createEl('option', { text: tr('imp.skip'), value: '' });
      for (const h of this.csv.headers) sel.createEl('option', { text: h, value: h });
      sel.value = this.mapping[key] || '';
      sel.addEventListener('change', () => { this.mapping[key] = sel.value; this.renderPreview(); });
    }
    this.previewBox = el.createDiv('crate-section'); this.renderPreview();
    const progress = el.createDiv('crate-progress'); const bar = progress.createDiv();
    const status = el.createEl('p', { cls: 'crate-muted', attr: { role: 'status', 'aria-live': 'polite' } });
    const actions = el.createDiv('crate-actions-bar');
    button(actions, tr('btn.close'), () => this.close());
    const go = button(actions, tr('btn.importGo'), async () => {
      if (!this.mapping.title || !this.mapping.artist) throw new Error(tr('imp.needMap'));
      go.disabled = true;
      let added = 0, skipped = 0, failed = 0;
      try {
        await p.scan();
        const seen = new Set(p.records.map(r => r.import_key).filter(Boolean));
        const records = this.csv.rows.map(row => mappedRecord(row, this.mapping)); const keys = importKeys(records);
        for (let i = 0; i < records.length; i++) {
          const record = records[i]; record.import_key = keys[i];
          if (!record.title || !record.artist || seen.has(record.import_key)) { skipped++; }
          else {
            try {
              // Scan once at the end: re-reading the whole collection per record made imports quadratic.
              await p.saveRecord(record, { scan: false }); seen.add(record.import_key); added++;
            } catch { failed++; }
          }
          bar.style.width = `${Math.round(((i + 1) / records.length) * 100)}%`;
          status.textContent = tr('imp.progress', { i: i + 1, n: records.length });
        }
        await p.scan();
        status.textContent = tr('imp.result', { added, skipped, failed });
        new Notice(tr('imp.finished'));
        if (p.settings.autoCover && added) p.fillCovers();
      } catch (e) { status.textContent = e.message; }
      finally { go.disabled = false; }
    }, 'mod-cta');
  }
  renderPreview() {
    const el = this.previewBox; el.empty(); el.createEl('h3', { text: tr('imp.preview') });
    const list = el.createDiv('crate-preview');
    for (const row of this.csv.rows.slice(0, 5)) {
      const r = mappedRecord(row, this.mapping);
      const line = list.createDiv('crate-preview-row');
      line.createSpan({ text: r.artist || tr('imp.noArtist'), cls: r.artist ? '' : 'is-missing' });
      line.createSpan({ text: r.title || tr('imp.noTitle'), cls: r.title ? 'crate-preview-title' : 'is-missing' });
      if (r.year) line.createSpan({ text: r.year, cls: 'crate-muted' });
    }
  }
}

/* ---------- settings ---------- */
class CrateSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const el = this.containerEl, p = this.plugin; el.empty();
    const save = async () => { await p.saveData(p.settings); };
    new Setting(el).setName(tr('set.collection')).setHeading();
    new Setting(el).setName(tr('set.folder')).setDesc(tr('set.folderDesc'))
      .addText(t => t.setValue(p.settings.folder).onChange(async v => { try { p.settings.folder = validFolder(v, T); await save(); await p.scan(); } catch { /* ignore invalid path while typing */ } }));
    new Setting(el).setName(tr('set.custom')).setDesc(tr('set.customDesc'))
      .addText(t => t.setValue(p.settings.customFields).onChange(async v => { p.settings.customFields = v; await save(); }));
    new Setting(el).setName(tr('set.appearance')).setHeading();
    new Setting(el).setName(tr('set.language')).setDesc(tr('set.languageDesc'))
      .addDropdown(d => d.addOption('auto', tr('set.auto')).addOption('en', 'English').addOption('it', 'Italiano').setValue(p.settings.language)
        .onChange(async v => { p.settings.language = v; await save(); setLanguage(v); p.refresh(true); this.display(); }));
    new Setting(el).setName(tr('set.useTheme')).setDesc(tr('set.useThemeDesc'))
      .addToggle(t => t.setValue(p.settings.accentMode !== 'custom').onChange(async v => { p.settings.accentMode = v ? 'theme' : 'custom'; await save(); p.refresh(true); this.display(); }));
    if (p.settings.accentMode === 'custom') {
      new Setting(el).setName(tr('set.accent'))
        .addColorPicker(c => c.setValue(p.settings.accent).onChange(async v => { p.settings.accent = v; await save(); p.refresh(true); }));
    }
    new Setting(el).setName(tr('set.size'))
      .addSlider(s => s.setLimits(140, 300, 10).setValue(p.settings.cardSize).setDynamicTooltip().onChange(async v => { p.settings.cardSize = v; await save(); p.refresh(true); }));
    new Setting(el).setName(tr('set.covers')).setHeading();
    new Setting(el).setName(tr('set.autoCover')).setDesc(tr('set.autoCoverDesc'))
      .addToggle(t => t.setValue(p.settings.autoCover).onChange(async v => { p.settings.autoCover = v; await save(); }));
    new Setting(el).setName(tr('set.token')).setDesc(tr('set.tokenDesc'))
      .addText(t => { t.inputEl.type = 'password'; t.setPlaceholder(tr('set.tokenPh')).setValue(p.discogsToken).onChange(v => { p.discogsToken = v.trim(); }); });
    el.createEl('p', { cls: 'setting-item-description', text: tr('set.note') });
    el.createEl('a', { text: tr('set.discogsLink'), href: 'https://www.discogs.com/settings/developers' });
  }
}
module.exports = CratePlugin;
