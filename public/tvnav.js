// public/tvnav.js
(function () {
  if (window.TVNav && window.TVNav.__ok) return;

  function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 5 && r.height > 5 && style.visibility !== 'hidden' && style.display !== 'none';
  }
  function isFichaOpen() {
    const p = document.querySelector('.popup-ficha.is-open, .popup-ficha[aria-hidden="false"], .modal.open');
    return !!p;
  }
  function fichaRoot() {
    return document.querySelector('.popup-ficha.is-open, .popup-ficha[aria-hidden="false"], .modal.open') || null;
  }

  function getCatalogItems() {
    const nodes = $all('.movie-item, .card-tile, .catalog-grid .card, .lista .item');
    return nodes.filter(visible);
  }

  function getFichaItems() {
    const root = fichaRoot();
    if (!root) return [];
    const sel = [
      '[data-tvnav]',
      'a[tabindex], button[tabindex], [role="button"][tabindex]',
      'a, button, [role="button"]',
      '.btn, .play, .btn-cerrar-ficha, .btn-reproducir'
    ].join(',');
    const items = $all(sel, root).filter(visible).filter(el => !el.closest('[aria-hidden="true"]'));
    return Array.from(new Set(items));
  }

  function currentItems() {
    return isFichaOpen() ? getFichaItems() : getCatalogItems();
  }

  let index = -1;
  function highlight(i) {
    const items = currentItems();
    if (!items.length) return;
    index = Math.max(0, Math.min(i, items.length - 1));
    items.forEach(el => el.classList.remove('tvnav-focus'));
    const el = items[index];
    el.classList.add('tvnav-focus');
    if (typeof el.focus === 'function') el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }

  function nearestByDir(dir) {
    const items = currentItems();
    if (!items.length || index < 0 || index >= items.length) return -1;
    const ref = centerOf(items[index]);
    let best = -1, bestScore = 1e15;
    for (let i = 0; i < items.length; i++) {
      if (i === index) continue;
      const c = centerOf(items[i]);
      const dx = c.x - ref.x, dy = c.y - ref.y;
      if (dir === 'left'  && dx >= -4) continue;
      if (dir === 'right' && dx <= 4)  continue;
      if (dir === 'up'    && dy >= -4) continue;
      if (dir === 'down'  && dy <= 4)  continue;
      const primary = (dir === 'left' || dir === 'right') ? Math.abs(dx) : Math.abs(dy);
      const secondary = (dir === 'left' || dir === 'right') ? Math.abs(dy) : Math.abs(dx);
      const score = primary * 10 + secondary * 3;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  function move(dir) {
    const items = currentItems();
    if (!items.length) return;
    if (index < 0) { highlight(0); return; }
    const j = nearestByDir(dir);
    if (j >= 0) highlight(j);
  }

  function enter() {
    const items = currentItems();
    if (!items.length) return;
    if (index < 0) index = 0;
    const el = items[index];

    if (isFichaOpen()) {
      const root = fichaRoot();
      const target = root.querySelector('[data-tvnav="primary"], .play, .btn-reproducir, a.btn-primaria, button.btn-primaria');
      if (target && visible(target)) { target.click(); return; }
    }

    const clickable = el.matches('a, button, [role="button"]') ? el
      : el.querySelector('a, button, [role="button"], .play');
    if (clickable) { clickable.click(); return; }
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  function back() {
    if (isFichaOpen()) {
      const root = fichaRoot();
      const closer = root.querySelector('.btn-cerrar-ficha, .btn-cerrar, [data-action="close"]');
      if (closer) { closer.click(); return; }
      root.setAttribute('aria-hidden', 'true');
      root.classList.remove('is-open', 'open');
      root.style.display = 'none';
      return;
    }
    history.back();
  }

  function onKey(e) {
    const k = e.key;
    if (k === 'Backspace' || k === 'Escape') { e.preventDefault(); back(); return; }
    if (k === 'Enter' || k === ' ')          { e.preventDefault(); enter(); return; }
    if (k === 'ArrowLeft')  { e.preventDefault(); move('left');  return; }
    if (k === 'ArrowRight') { e.preventDefault(); move('right'); return; }
    if (k === 'ArrowUp')    { e.preventDefault(); move('up');    return; }
    if (k === 'ArrowDown')  { e.preventDefault(); move('down');  return; }
  }

  function lazyInit() {
    let tries = 0;
    const t = setInterval(() => {
      const items = currentItems();
      if (items.length) { highlight(0); clearInterval(t); }
      if (++tries > 50) clearInterval(t);
    }, 200);
  }

  document.addEventListener('click', function (ev) {
    const btn = ev.target.closest('.play-external');
    if (!btn) return;
    const direct = btn.getAttribute('data-url');
    if (direct) { window.open(direct, '_blank'); return; }
    const iframe = document.querySelector('.popup-ficha iframe, .modal.open iframe');
    if (iframe) iframe.focus();
  }, true);

  window.addEventListener('keydown', onKey, { passive: false });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', lazyInit);
  } else {
    lazyInit();
  }

  window.TVNav = { __ok: true, move, enter, back };
})();
