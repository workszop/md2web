/**
 * md2web — formatting panel mockups, shared logic
 * Controls write data-* attributes on <html>; shared.css does the rest.
 * Plain script, works from file://.
 */

(function () {
  'use strict';

  const DEFAULTS = {
    accent:  'pink',
    font:    'satoshi',
    scale:   'md',
    leading: 'normal',
    measure: 'default',
    theme:   'light',
  };

  const PRESETS = {
    default: DEFAULTS,
    reading: { font: 'serif', measure: 'narrow', leading: 'relaxed', theme: 'sepia' },
    compact: { scale: 'sm', leading: 'compact', measure: 'wide' },
  };

  const root = document.documentElement;

  function apply(key, value) {
    root.dataset[key] = value;
    document.querySelectorAll('[data-set="' + key + '"]').forEach(btn => {
      const on = btn.dataset.value === value;
      btn.classList.toggle('is-selected', on);
      btn.setAttribute('aria-pressed', on);
    });
    updateReadout();
  }

  function applyPreset(name) {
    const preset = Object.assign({}, DEFAULTS, PRESETS[name] || {});
    Object.keys(preset).forEach(key => apply(key, preset[key]));
  }

  function updateReadout() {
    const el = document.getElementById('panel-state');
    if (!el) return;
    el.textContent = Object.keys(DEFAULTS)
      .map(key => key + '=' + root.dataset[key])
      .join(' · ');
  }

  document.addEventListener('click', e => {
    const setBtn = e.target.closest('[data-set]');
    if (setBtn) { apply(setBtn.dataset.set, setBtn.dataset.value); return; }
    const presetBtn = e.target.closest('[data-preset]');
    if (presetBtn) applyPreset(presetBtn.dataset.preset);
  });

  function init() {
    Object.keys(DEFAULTS).forEach(key => apply(key, DEFAULTS[key]));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
