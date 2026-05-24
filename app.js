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
        '<div style="padding:40px;font-family:system-ui;color:#C41E54">' +
        '<h1>Failed to load libraries</h1>' +
        '<p>marked / DOMPurify / highlight.js could not be loaded from the CDN. ' +
        'Check your internet connection and reload the page.</p></div>';
    });
    return;
  }

  const marked    = window.marked;
  const DOMPurify = window.DOMPurify;
  const hljs      = window.hljs;

  // ── DOM refs used outside init() (resolved on DOMContentLoaded) ───────────
  let layout, mainArea, article;
  let articleHeader, articleBody, tocNav, tocList, topbarMeta, siteFooter;
  let btnPdf;

  // ── marked: positional-argument renderer (correct for marked v12) ─────────
  marked.use({
    gfm: true,
    renderer: {
      heading(text, level, raw) {
        const slug = String(raw).toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
        return '<h' + level + ' id="' + slug + '" class="md-h' + level + '">' + text + '</h' + level + '>\n';
      },

      blockquote(quote) {
        return '<blockquote class="md-blockquote">' + quote + '</blockquote>\n';
      },

      hr() {
        return '<div class="md-hr" role="separator"><span></span></div>\n';
      },

      image(href, title, text) {
        const titleAttr = title ? ' title="' + title + '"' : '';
        const cap = title ? '<figcaption>' + title + '</figcaption>' : '';
        return '<figure class="md-figure"><img src="' + href + '" alt="' + (text || '') + '"' + titleAttr + ' loading="lazy" />' + cap + '</figure>\n';
      },

      table(header, body) {
        return '<div class="md-table-wrap"><table class="md-table"><thead>' + header + '</thead><tbody>' + body + '</tbody></table></div>\n';
      },

      code(code, infostring) {
        const lang = (infostring || '').match(/\S*/)[0];
        const validLang = lang && hljs.getLanguage(lang) ? lang : null;
        let hl;
        try {
          hl = validLang
            ? hljs.highlight(code, { language: validLang }).value
            : hljs.highlightAuto(code).value;
        } catch (e) {
          hl = escapeHtml(code);
        }
        const label = lang ? '<span class="code-lang">' + lang + '</span>' : '';
        return '<div class="md-code-block">' + label + '<pre><code class="hljs' + (lang ? ' language-' + lang : '') + '">' + hl + '</code></pre></div>\n';
      },
    },
  });

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── Front-matter parser ────────────────────────────────────────────────────
  function parseFrontMatter(raw) {
    const fm = {};
    let body = raw;
    if (raw.startsWith('---')) {
      const end = raw.indexOf('\n---', 3);
      if (end !== -1) {
        raw.slice(3, end).trim().split('\n').forEach(line => {
          const colon = line.indexOf(':');
          if (colon === -1) return;
          fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
        });
        body = raw.slice(end + 4).trimStart();
      }
    }
    return { fm, body };
  }

  // ── Render pipeline ────────────────────────────────────────────────────────
  let currentFilename = '';

  function render(rawMd, filename) {
    currentFilename = filename || '';
    const { fm, body } = parseFrontMatter(rawMd);

    articleHeader.innerHTML = '';
    if (fm.title || fm.category || fm.date || fm.author) {
      const eyebrow = [fm.category, fm.date, fm.author].filter(Boolean).join(' · ');
      articleHeader.innerHTML =
        '<div class="article-fm">' +
        (eyebrow      ? '<p class="type-eyebrow article-fm__eyebrow">' + eyebrow + '</p>' : '') +
        (fm.title     ? '<h1 class="article-fm__title">' + fm.title + '</h1>' : '') +
        (fm.subtitle  ? '<p class="article-fm__subtitle type-body-lg">' + fm.subtitle + '</p>' : '') +
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
      ADD_ATTR: ['id', 'loading'],
      ADD_TAGS: ['figure', 'figcaption'],
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

    const dateStr = fm.date || new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const label   = fm.title || filename || 'Untitled';
    topbarMeta.innerHTML =
      '<span class="topbar__filename type-mono">' + escapeHtml(label) + '</span>' +
      '<span class="topbar__date type-mono">' + escapeHtml(dateStr) + '</span>';

    mainArea.hidden   = true;
    article.hidden    = false;
    siteFooter.hidden = false;
    btnPdf.disabled   = false;
    window.scrollTo({ top: 0 });
  }

  // ── Table of Contents ──────────────────────────────────────────────────────
  function buildToC() {
    const headings = Array.from(articleBody.querySelectorAll('h2, h3'));
    tocList.innerHTML = '';

    if (headings.length < 3) {
      tocNav.hidden = true;
      layout.classList.remove('layout--toc');
      return;
    }

    headings.forEach((h, i) => {
      const li = document.createElement('li');
      li.className = 'toc__item toc__item--h' + h.tagName[1];
      const num = String(i + 1).padStart(2, '0');
      li.innerHTML =
        '<a href="#' + h.id + '" class="toc__link">' +
        '<span class="toc__num type-mono">' + num + '</span>' +
        '<span class="toc__text">' + h.textContent + '</span></a>';
      tocList.appendChild(li);
    });

    tocNav.hidden = false;
    layout.classList.add('layout--toc');

    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        tocList.querySelectorAll('.toc__link').forEach(a => a.classList.remove('toc__link--active'));
        const active = tocList.querySelector('a[href="#' + e.target.id + '"]');
        if (active) active.classList.add('toc__link--active');
      });
    }, { rootMargin: '-10% 0px -80% 0px' });

    headings.forEach(h => observer.observe(h));
  }

  // ── PDF export — uses native browser print → "Save as PDF" ───────────────────
  function exportPdf() {
    // Switch the document title so the print dialog's suggested filename matches the .md
    const originalTitle = document.title;
    document.title = (currentFilename.replace(/\.(md|markdown|txt)$/i, '') || 'document');
    window.print();
    // Restore after the print dialog closes
    setTimeout(() => { document.title = originalTitle; }, 100);
  }

  // ── File loading ───────────────────────────────────────────────────────────
  function loadFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload  = e => render(e.target.result, file.name);
    reader.onerror = e => alert('Failed to read file: ' + e.target.error);
    reader.readAsText(file);
  }

  // ── Init on DOM ready ──────────────────────────────────────────────────────
  function init() {
    layout        = document.getElementById('layout');
    mainArea      = document.getElementById('main-area');
    article       = document.getElementById('article');
    articleHeader = document.getElementById('article-header');
    articleBody   = document.getElementById('article-body');
    tocNav        = document.getElementById('toc');
    tocList       = document.getElementById('toc-list');
    topbarMeta    = document.getElementById('topbar-meta');
    siteFooter    = document.getElementById('site-footer');
    btnPdf        = document.getElementById('btn-pdf');

    const fileInput   = document.getElementById('file-input');
    const dropOverlay = document.getElementById('drop-overlay');
    const btnOpen     = document.getElementById('btn-open');
    const btnOpenDrop = document.getElementById('btn-open-drop');

    [btnOpen, btnOpenDrop].forEach(btn => btn.addEventListener('click', () => fileInput.click()));
    fileInput.addEventListener('change', e => {
      loadFile(e.target.files[0]);
      fileInput.value = '';  // allow re-selecting the same file
    });

    document.addEventListener('dragover',  e => { e.preventDefault(); dropOverlay.style.display = 'flex'; });
    document.addEventListener('dragleave', e => { if (!e.relatedTarget) dropOverlay.style.display = ''; });
    document.addEventListener('drop', e => {
      e.preventDefault();
      dropOverlay.style.display = '';
      if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });

    btnPdf.addEventListener('click', exportPdf);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
