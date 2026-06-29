# md2web

A zero-build, client-side Markdown → web viewer styled with the **Quantica Lab**
design system. Open or drag-and-drop a `.md` file and it renders to a polished,
print-ready page with a generated table of contents and one-click PDF export.

## Features

- **Drag & drop or file picker** — load any `.md`, `.markdown`, or `.txt` file.
- **GitHub-flavored Markdown** via [marked](https://marked.js.org/) — tables,
  task lists (rendered with brand SVG icons), fenced code, etc.
- **Syntax highlighting** via [highlight.js](https://highlightjs.org/) with
  Quantica token colors.
- **Front matter** — a leading `---` block sets the article title, subtitle,
  category, date, and author (see below).
- **Auto table of contents** — built from `h2`/`h3` headings (shown when there
  are 3+), with scroll-spy highlighting.
- **PDF export** — uses the browser's native print → "Save as PDF" with an
  A4 layout, repeating per-page Quantica header, and orphan/widow protection.
- **Sanitized output** — rendered HTML is run through
  [DOMPurify](https://github.com/cure53/DOMPurify); front-matter values are
  HTML-escaped.

## Usage

It's a static site — no build step, no server required for the app shell.

```bash
# Just open index.html in a browser, e.g.
xdg-open index.html      # Linux
open index.html          # macOS
```

> **Note:** the third-party libraries (marked, DOMPurify, highlight.js) are
> loaded from a CDN with [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity),
> so an **internet connection is required on first load**. If you need a fully
> offline build, vendor those files into `assets/` and point the `<script>` /
> `<link>` tags at the local copies.

`sample.md` is included as a demo document.

## Front matter

An optional YAML-style block at the very top of the file populates the article
header:

```markdown
---
title: My Document
subtitle: An optional standfirst
category: Engineering
date: 29 Jun 2026
author: Jane Doe
---

# Content starts here
```

The parser is intentionally minimal: one `key: value` per line, surrounding
quotes are stripped. Multi-line values, lists, and nested objects are **not**
supported.

## Project layout

| File | Purpose |
|------|---------|
| `index.html` | App shell and markup |
| `app.js` | Render pipeline (front matter, marked, DOMPurify, ToC, PDF) |
| `md-styles.css` | Markdown / article / print styling |
| `colors_and_type.css` | Quantica design tokens (color, type scale, spacing) |
| `design-guide.html` | Rendered Quantica design reference |
| `sample.md` | Demo document |
| `assets/` | Quantica logos and marks |

## Maintenance notes

- The custom renderer in `app.js` uses marked's **object-argument** API
  (`heading({ text, depth, tokens })`), introduced in **marked v14.0.0** and
  current through v18. If you ever downgrade below v14 the renderer will break,
  since older versions pass positional arguments. Child tokens are rendered with
  `this.parser.parseInline()` / `.parse()`.
- marked 18 ships its UMD build at `lib/marked.umd.js` (older versions used
  `marked.min.js`) — keep that path if you bump the version.
- CDN URLs carry SRI `integrity` hashes — if you change a library version, the
  hash must be regenerated or the resource will be blocked by the browser.

## License

Released under the [MIT License](LICENSE). The license file names *Quantica Lab*
as the copyright holder — update it if that is not correct for your use.
