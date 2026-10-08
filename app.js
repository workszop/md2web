/**
 * md2web — Quantica Lab Markdown viewer
 * Plain script (no ES modules) so it works when opened directly via file://
 * Depends on globals: window.marked, window.DOMPurify, window.hljs
 */

(function () {
  'use strict';

  // ── Sanity check: libraries loaded? ────────────────────────────────────────
  if (!window.marked || !window.DOMPurify || !window.hljs) {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.innerHTML =
        '<div style="padding:40px;font-family:system-ui;color:var(--status-error)">' +
        '<h1>Failed to load libraries</h1>' +
        '<p>marked / DOMPurify / highlight.js could not be loaded from the CDN. ' +
        'Check your internet connection and reload the page.</p></div>';
    });
    return;
  }

  const marked    = window.marked;
  const DOMPurify = window.DOMPurify;
  const hljs      = window.hljs;

  // ── Constants ──────────────────────────────────────────────────────────────
  const FORMAT_STORAGE_KEY = 'md2web-format';
  const FORMAT_KEYS        = ['accent', 'font', 'scale', 'leading', 'measure', 'theme'];
  const DEFAULT_FORMAT     = {
    accent: 'pink', font: 'satoshi', scale: 'md',
    leading: 'normal', measure: 'default', theme: 'light',
    accentCustom: '#C41E54',
  };
  const MD_FILE_RE = /\.(md|markdown|txt)$/i;

  // ── State ──────────────────────────────────────────────────────────────────
  let docs        = [];    // [{ id, name, raw, scroll }]
  let activeDocId = null;
  let docSeq      = 0;
  let format      = Object.assign({}, DEFAULT_FORMAT);
  let tocObserver = null;
  let usedSlugs   = new Set();  // deduped per render so anchors/TOC links stay unique

  // ── DOM refs (resolved on DOMContentLoaded) ───────────────────────────────
  let layout, mainArea, article;
  let articleHeader, articleBody, tocNav, tocList, topbarMeta, siteFooter;
  let sidebar, filesNav, fileList, srLive;
  let btnPdf, btnFormat, formatPopover, mixerInput;

  // ── Heading slugs ──────────────────────────────────────────────────────────
  function slugify(raw) {
    let base = String(raw).toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
    if (!base) base = 'section';
    let slug = base, n = 1;
    while (usedSlugs.has(slug)) { slug = base + '-' + (++n); }
    usedSlugs.add(slug);
    return slug;
  }

  // ── marked: object-argument renderer (marked v14+, tested on v18) ─────────
  // Each renderer method receives a single token object and uses
  // `this.parser.parseInline()` / `.parse()` to render child tokens to HTML.
  marked.use({
    gfm: true,
    renderer: {
      heading({ text, depth, tokens }) {
        const slug = slugify(text);
        const inner = this.parser.parseInline(tokens);
        return '<h' + depth + ' id="' + slug + '" class="md-h' + depth + '">' + inner + '</h' + depth + '>\n';
      },

      blockquote({ tokens }) {
        return '<blockquote class="md-blockquote">' + this.parser.parse(tokens) + '</blockquote>\n';
      },

      hr() {
        return '<div class="md-hr" role="separator"><span></span></div>\n';
      },

      image({ href, title, text }) {
        const titleAttr = title ? ' title="' + escapeHtml(title) + '"' : '';
        const cap = title ? '<figcaption>' + escapeHtml(title) + '</figcaption>' : '';
        return '<figure class="md-figure"><img src="' + escapeHtml(href || '') + '" alt="' + escapeHtml(text || '') + '"' + titleAttr + ' loading="lazy" />' + cap + '</figure>\n';
      },

      table({ header, rows }) {
        const align = cell => cell.align ? ' style="text-align:' + cell.align + '"' : '';
        const head = '<tr>' + header.map(cell =>
          '<th' + align(cell) + '>' + this.parser.parseInline(cell.tokens) + '</th>').join('') + '</tr>';
        const body = rows.map(row =>
          '<tr>' + row.map(cell =>
            '<td' + align(cell) + '>' + this.parser.parseInline(cell.tokens) + '</td>').join('') + '</tr>').join('');
        return '<div class="md-table-wrap"><table class="md-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>\n';
      },

      code({ text, lang: infostring }) {
        const lang = (infostring || '').match(/\S*/)[0];
        const validLang = lang && hljs.getLanguage(lang) ? lang : null;
        let hl;
        try {
          if (validLang) {
            hl = hljs.highlight(text, { language: validLang }).value;
          } else if (text.length <= 50000) {
            // Auto-detection is expensive; skip it for very large unlabeled blocks
            hl = hljs.highlightAuto(text).value;
          } else {
            hl = escapeHtml(text);
          }
        } catch (e) {
          hl = escapeHtml(text);
        }
        const label = lang ? '<span class="code-lang">' + escapeHtml(lang) + '</span>' : '';
        return '<div class="md-code-block">' + label + '<pre><code class="hljs' + (lang ? ' language-' + escapeHtml(lang) : '') + '">' + hl + '</code></pre></div>\n';
      },
    },
  });

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function announce(message) {
    if (srLive) srLive.textContent = message;
  }

  // ── Front-matter parser ────────────────────────────────────────────────────
  function parseFrontMatter(raw) {
    const fm = {};
    let body = raw;
    if (/^---[ \t]*(?:\n|$)/.test(raw)) {
      // Closing fence must be a line containing only `---`
      const end = raw.slice(3).search(/\n---[ \t]*(\n|$)/);
      if (end !== -1) {
        raw.slice(3, end + 3).trim().split('\n').forEach(line => {
          const colon = line.indexOf(':');
          if (colon === -1) return;
          fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
        });
        body = raw.slice(end + 3).replace(/^\n---[ \t]*\n?/, '').trimStart();
      }
    }
    return { fm, body };
  }

  // ── Render pipeline ────────────────────────────────────────────────────────
  function activeDoc() {
    return docs.find(d => d.id === activeDocId) || null;
  }

  function render(doc) {
    usedSlugs = new Set();  // reset per render so heading IDs stay unique
    const raw = doc.raw.replace(/^\uFEFF/, '');  // strip UTF-8 BOM
    const { fm, body } = parseFrontMatter(raw);

    articleHeader.innerHTML = '';
    if (fm.title || fm.category || fm.date || fm.author) {
      // Front-matter values are plain text — escape before injecting as HTML.
      const eyebrow = [fm.category, fm.date, fm.author].filter(Boolean).map(escapeHtml).join(' · ');
      articleHeader.innerHTML =
        '<div class="article-fm">' +
        (eyebrow      ? '<p class="type-eyebrow article-fm__eyebrow">' + eyebrow + '</p>' : '') +
        (fm.title     ? '<h1 class="article-fm__title">' + escapeHtml(fm.title) + '</h1>' : '') +
        (fm.subtitle  ? '<p class="article-fm__subtitle type-body-lg">' + escapeHtml(fm.subtitle) + '</p>' : '') +
        '<div class="article-fm__rule"></div>' +
        '</div>';
    }

    let html;
    try {
      html = marked.parse(body);
    } catch (err) {
      console.error('Markdown parse error:', err);
      articleBody.innerHTML = '<p style="color:var(--status-error)">Failed to parse Markdown: ' + escapeHtml(err.message) + '</p>';
      return;
    }

    articleBody.innerHTML = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['id', 'loading', 'role'],
    });

    // Replace GFM task-list checkboxes with brand SVG icons
    articleBody.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      const li = cb.closest('li');
      if (!li) return;
      li.classList.add('task-item');
      li.classList.toggle('task-item--checked', cb.checked);
      const icon = document.createElement('span');
      icon.className = 'task-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = cb.checked
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>';
      cb.replaceWith(icon);
    });

    buildToC();
    updateSidebar();

    const dateStr = fm.date || new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const label   = fm.title || doc.name || 'Untitled';
    topbarMeta.innerHTML =
      '<span class="topbar__filename type-mono">' + escapeHtml(label) + '</span>' +
      '<span class="topbar__date type-mono">' + escapeHtml(dateStr) + '</span>';

    mainArea.hidden   = true;
    article.hidden    = false;
    siteFooter.hidden = false;
    btnPdf.disabled   = false;
  }

  function showEmpty() {
    articleHeader.innerHTML = '';
    articleBody.innerHTML   = '';
    article.hidden    = true;
    siteFooter.hidden = true;
    mainArea.hidden   = false;
    btnPdf.disabled   = true;
    tocNav.hidden     = true;
    topbarMeta.innerHTML = '<span class="topbar__hint">Open a .md file to preview it</span>';
    updateSidebar();
  }

  // ── Multi-file session ─────────────────────────────────────────────────────
  function addFiles(fileListLike) {
    const files = Array.from(fileListLike).filter(f =>
      MD_FILE_RE.test(f.name) || f.type === 'text/markdown' || f.type === 'text/plain');
    if (!files.length) {
      showToast('No Markdown files found — expected .md, .markdown, or .txt');
      return;
    }

    // Create entries synchronously so list order matches selection order,
    // then fill raw content as each FileReader completes.
    const entries = files.map(f => ({ id: ++docSeq, name: f.name, raw: null, scroll: 0 }));
    docs = docs.concat(entries);
    let pending = files.length;

    files.forEach((file, i) => {
      const reader = new FileReader();
      reader.onload = e => {
        entries[i].raw = e.target.result;
        if (--pending === 0) finishAdd(entries);
      };
      reader.onerror = e => {
        showToast('Failed to read ' + file.name + ': ' + (e.target.error || 'unknown error'));
        docs = docs.filter(d => d.id !== entries[i].id);
        if (--pending === 0) finishAdd(entries);
      };
      reader.readAsText(file);
    });
  }

  function finishAdd(entries) {
    const loaded = entries.filter(e => docs.includes(e));
    if (loaded.length) {
      activateDoc(loaded[0].id);
      announce('Loaded ' + loaded.length + (loaded.length === 1 ? ' file: ' + loaded[0].name : ' files'));
    } else {
      updateSidebar();
    }
  }

  function activateDoc(id) {
    const current = activeDoc();
    if (current) current.scroll = window.scrollY;

    const doc = docs.find(d => d.id === id);
    if (!doc) return;
    activeDocId = id;
    render(doc);
    renderFileList();
    window.scrollTo({ top: doc.scroll || 0 });
  }

  function closeDoc(id) {
    const idx = docs.findIndex(d => d.id === id);
    if (idx === -1) return;
    const wasActive = docs[idx].id === activeDocId;
    docs.splice(idx, 1);

    if (wasActive) {
      activeDocId = null;
      if (docs.length) {
        activateDoc((docs[idx] || docs[idx - 1]).id);
        return;
      } else {
        showEmpty();
      }
    }
    renderFileList();
    if (!wasActive) updateSidebar();
  }

  function renderFileList() {
    fileList.innerHTML = '';
    docs.forEach(doc => {
      const li = document.createElement('li');
      li.className = 'files__item' + (doc.id === activeDocId ? ' files__item--active' : '');

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'files__open';
      open.textContent = doc.name;
      open.title = doc.name;
      open.addEventListener('click', () => activateDoc(doc.id));

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'files__close';
      close.setAttribute('aria-label', 'Close ' + doc.name);
      close.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      close.addEventListener('click', () => closeDoc(doc.id));

      li.appendChild(open);
      li.appendChild(close);
      fileList.appendChild(li);
    });
  }

  function updateSidebar() {
    filesNav.hidden = docs.length < 2;
    sidebar.hidden  = filesNav.hidden && tocNav.hidden;
    layout.classList.toggle('layout--side', !sidebar.hidden);
  }

  // ── Table of Contents ──────────────────────────────────────────────────────
  function buildToC() {
    const headings = Array.from(articleBody.querySelectorAll('h2, h3'));
    tocList.innerHTML = '';
    if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }

    if (headings.length < 3) {
      tocNav.hidden = true;
      return;
    }

    headings.forEach((h, i) => {
      // Built with createElement/textContent — heading text must never be
      // re-parsed as HTML here (it can contain decoded entities).
      const li = document.createElement('li');
      li.className = 'toc__item toc__item--h' + h.tagName[1];
      const a = document.createElement('a');
      a.href = '#' + h.id;
      a.className = 'toc__link';
      const num = document.createElement('span');
      num.className = 'toc__num type-mono';
      num.textContent = String(i + 1).padStart(2, '0');
      const text = document.createElement('span');
      text.className = 'toc__text';
      text.textContent = h.textContent;
      a.appendChild(num);
      a.appendChild(text);
      li.appendChild(a);
      tocList.appendChild(li);
    });

    tocNav.hidden = false;

    tocObserver = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        tocList.querySelectorAll('.toc__link').forEach(a => a.classList.remove('toc__link--active'));
        const active = tocList.querySelector('a[href="#' + e.target.id + '"]');
        if (active) active.classList.add('toc__link--active');
      });
    }, { rootMargin: '-10% 0px -80% 0px' });

    headings.forEach(h => tocObserver.observe(h));
  }

  // ── Formatting panel ───────────────────────────────────────────────────────
  function loadFormat() {
    try {
      const saved = JSON.parse(localStorage.getItem(FORMAT_STORAGE_KEY) || '{}');
      format = Object.assign({}, DEFAULT_FORMAT, saved);
    } catch (e) {
      format = Object.assign({}, DEFAULT_FORMAT);
    }
  }

  function saveFormat() {
    try { localStorage.setItem(FORMAT_STORAGE_KEY, JSON.stringify(format)); } catch (e) { /* private mode */ }
  }

  function applyFormat() {
    const root = document.documentElement;
    FORMAT_KEYS.forEach(key => root.setAttribute('data-md-' + key, format[key]));

    if (format.accent === 'custom') {
      root.style.setProperty('--accent', format.accentCustom);
    } else {
      root.style.removeProperty('--accent');
    }

    // Sync control selected states
    formatPopover.querySelectorAll('[data-format]').forEach(btn => {
      const on = format[btn.dataset.format] === btn.dataset.value;
      btn.classList.toggle('is-selected', on);
      btn.setAttribute('aria-pressed', on);
    });
    const mixerBtn = document.getElementById('btn-mixer');
    mixerBtn.classList.toggle('is-selected', format.accent === 'custom');
    mixerBtn.setAttribute('aria-pressed', format.accent === 'custom');
    mixerInput.value = format.accentCustom;

    saveFormat();
  }

  function setFormat(key, value) {
    format[key] = value;
    applyFormat();
  }

  function initFormatPanel() {
    formatPopover.addEventListener('click', e => {
      const btn = e.target.closest('[data-format]');
      if (btn) setFormat(btn.dataset.format, btn.dataset.value);
    });

    document.getElementById('btn-mixer').addEventListener('click', () => mixerInput.click());
    mixerInput.addEventListener('input', () => {
      format.accentCustom = mixerInput.value;
      setFormat('accent', 'custom');
    });

    document.getElementById('btn-format-reset').addEventListener('click', () => {
      format = Object.assign({}, DEFAULT_FORMAT);
      applyFormat();
      announce('Formatting reset to Quantica defaults');
    });

    // Popover open/close
    function setOpen(open) {
      formatPopover.classList.toggle('is-open', open);
      btnFormat.setAttribute('aria-expanded', open);
    }
    btnFormat.addEventListener('click', () => setOpen(!formatPopover.classList.contains('is-open')));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
    document.addEventListener('click', e => {
      if (!formatPopover.contains(e.target) && !btnFormat.contains(e.target)) setOpen(false);
    });

    loadFormat();
    applyFormat();
  }

  // ── Sidebar resize ─────────────────────────────────────────────────────────
  const SIDEBAR_W_KEY = 'md2web-sidebar-w';
  const SIDEBAR_W     = { min: 180, max: 480, default: 240 };

  function setSidebarWidth(px, persist) {
    const w = Math.min(SIDEBAR_W.max, Math.max(SIDEBAR_W.min, Math.round(px)));
    document.documentElement.style.setProperty('--sidebar-w', w + 'px');
    if (persist) {
      try { localStorage.setItem(SIDEBAR_W_KEY, String(w)); } catch (e) { /* private mode */ }
    }
    return w;
  }

  function currentSidebarWidth() {
    return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w'), 10) || SIDEBAR_W.default;
  }

  function initSidebarResize() {
    const resizer = document.getElementById('sidebar-resizer');
    const saved = parseInt(localStorage.getItem(SIDEBAR_W_KEY), 10);
    if (!isNaN(saved)) setSidebarWidth(saved, false);

    let startX = 0, startW = 0;

    resizer.addEventListener('pointerdown', e => {
      e.preventDefault();
      startX = e.clientX;
      startW = currentSidebarWidth();
      resizer.classList.add('is-dragging');
      document.documentElement.classList.add('is-resizing');
      // Keep receiving moves outside the 8px handle; can throw for
      // already-released pointers (e.g. pen lift), so guard it.
      try { resizer.setPointerCapture(e.pointerId); } catch (err) { /* drag still works within the handle */ }
    });

    resizer.addEventListener('pointermove', e => {
      if (!resizer.classList.contains('is-dragging')) return;
      setSidebarWidth(startW + (e.clientX - startX), false);
    });

    function endDrag() {
      if (!resizer.classList.contains('is-dragging')) return;
      resizer.classList.remove('is-dragging');
      document.documentElement.classList.remove('is-resizing');
      setSidebarWidth(currentSidebarWidth(), true);
    }
    resizer.addEventListener('pointerup', endDrag);
    resizer.addEventListener('pointercancel', endDrag);

    resizer.addEventListener('dblclick', () => setSidebarWidth(SIDEBAR_W.default, true));

    // ARIA separator pattern: arrows resize, Shift for bigger steps
    resizer.addEventListener('keydown', e => {
      const step = e.shiftKey ? 48 : 16;
      if      (e.key === 'ArrowLeft')  setSidebarWidth(currentSidebarWidth() - step, true);
      else if (e.key === 'ArrowRight') setSidebarWidth(currentSidebarWidth() + step, true);
      else if (e.key === 'Home')       setSidebarWidth(SIDEBAR_W.min, true);
      else if (e.key === 'End')        setSidebarWidth(SIDEBAR_W.max, true);
      else return;
      e.preventDefault();
    });
  }

  // ── PDF export — uses native browser print → "Save as PDF" ────────────────
  function exportPdf() {
    // Switch the document title so the print dialog's suggested filename matches the .md
    const doc = activeDoc();
    const originalTitle = document.title;
    document.title = ((doc && doc.name) || '').replace(/\.(md|markdown|txt)$/i, '') || 'document';
    window.print();
    // Restore after the print dialog closes
    setTimeout(() => { document.title = originalTitle; }, 100);
  }

  // ── Styled, auto-dismissing toast (replaces blocking alert) ────────────────
  let toastTimer;
  function showToast(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      toast.setAttribute('role', 'alert');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('toast--visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('toast--visible'), 5000);
  }

  // ── Init on DOM ready ──────────────────────────────────────────────────────
  function init() {
    layout        = document.getElementById('layout');
    mainArea      = document.getElementById('main-area');
    article       = document.getElementById('article');
    articleHeader = document.getElementById('article-header');
    articleBody   = document.getElementById('article-body');
    sidebar       = document.getElementById('sidebar');
    filesNav      = document.getElementById('files');
    fileList      = document.getElementById('file-list');
    tocNav        = document.getElementById('toc');
    tocList       = document.getElementById('toc-list');
    topbarMeta    = document.getElementById('topbar-meta');
    siteFooter    = document.getElementById('site-footer');
    srLive        = document.getElementById('sr-live');
    btnPdf        = document.getElementById('btn-pdf');
    btnFormat     = document.getElementById('btn-format');
    formatPopover = document.getElementById('format-popover');
    mixerInput    = document.getElementById('mixer-input');

    const fileInput   = document.getElementById('file-input');
    const dropOverlay = document.getElementById('drop-overlay');
    const btnOpen     = document.getElementById('btn-open');
    const btnOpenDrop = document.getElementById('btn-open-drop');

    [btnOpen, btnOpenDrop].forEach(btn => btn.addEventListener('click', () => fileInput.click()));
    fileInput.addEventListener('change', e => {
      addFiles(e.target.files);
      fileInput.value = '';  // allow re-selecting the same file
    });

    document.addEventListener('dragover',  e => { e.preventDefault(); dropOverlay.style.display = 'flex'; });
    document.addEventListener('dragleave', e => { if (!e.relatedTarget) dropOverlay.style.display = ''; });
    document.addEventListener('drop', e => {
      e.preventDefault();
      dropOverlay.style.display = '';
      if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });

    btnPdf.addEventListener('click', exportPdf);
    initFormatPanel();
    initSidebarResize();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
