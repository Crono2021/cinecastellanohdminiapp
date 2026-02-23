(function () {
  if (window.TVNav && window.TVNav.__ok) return;

  // Visible focus for TV.
  var CSS = [
    '.tv-focus{outline:4px solid #ffffff;outline-offset:4px;border-radius:14px}',
    '.tv-focusable{scroll-margin:18vh}'
  ].join('\n');
  var s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);

  function $all(root, sel) {
    return Array.from((root || document).querySelectorAll(sel));
  }
  function isVisible(n) {
    var r = n.getBoundingClientRect();
    return r.width > 5 && r.height > 5 && !!n.offsetParent;
  }
  function isNaturallyFocusable(el) {
    return /^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.hasAttribute('tabindex');
  }
  function ensureFocusable(el) {
    if (!isNaturallyFocusable(el)) {
      el.setAttribute('tabindex', '0');
      if (!el.getAttribute('role')) el.setAttribute('role', 'button');
    }
    if (el.classList) el.classList.add('tv-focusable');
  }

  function getOpenModal() {
    return document.querySelector('.modal.open');
  }
  function isPopupOpen() {
    return !!getOpenModal();
  }

  function getItems() {
    var modal = getOpenModal();
    if (modal) {
      var focusables = $all(modal, 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')
        .filter(function (n) { return !n.disabled && isVisible(n); });
      focusables.forEach(ensureFocusable);
      return focusables;
    }

    // Main catalog tiles and common card containers.
    var nodes = $all(document, '.movie-item, .card-tile, .card, .grid > div, .row-scroller > div');
    var items = nodes.filter(isVisible);
    items.forEach(ensureFocusable);
    return items;
  }

  var index = -1;
  var lastFocusBeforeModal = null;
  var lastModalOpen = false;

  function clearHighlight(items) {
    items.forEach(function (el) {
      if (el.classList) el.classList.remove('tv-focus');
    });
  }

  function highlight(i) {
    var items = getItems();
    clearHighlight(items);
    if (!items.length) { index = -1; return; }
    if (i < 0) i = 0;
    if (i >= items.length) i = items.length - 1;
    index = i;
    var el = items[index];
    if (!el) return;
    if (el.classList) el.classList.add('tv-focus');
    try { el.focus({ preventScroll: true }); } catch (e) { }
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { }
  }

  function nearestByDir(dir) {
    var items = getItems();
    if (!items.length) return -1;
    if (index < 0 || index >= items.length) index = 0;

    var from = items[index];
    if (!from) return -1;

    var r0 = from.getBoundingClientRect();
    var fx = r0.left + r0.width / 2;
    var fy = r0.top + r0.height / 2;

    var best = -1;
    var bestScore = 1e15;

    for (var i = 0; i < items.length; i++) {
      if (i === index) continue;

      var r = items[i].getBoundingClientRect();
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var dx = cx - fx;
      var dy = cy - fy;

      if (dir === 'left' && dx >= -4) continue;
      if (dir === 'right' && dx <= 4) continue;
      if (dir === 'up' && dy >= -4) continue;
      if (dir === 'down' && dy <= 4) continue;

      var primary = (dir === 'left' || dir === 'right') ? Math.abs(dx) : Math.abs(dy);
      var secondary = (dir === 'left' || dir === 'right') ? Math.abs(dy) : Math.abs(dx);
      var score = primary * primary + secondary * secondary * 3;

      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  function move(dir) {
    var items = getItems();
    if (!items.length) { index = -1; return; }
    if (index < 0) highlight(0);
    else {
      var j = nearestByDir(dir);
      if (j >= 0) highlight(j);
    }
  }

  function enter() {
    var items = getItems();
    if (index < 0 || index >= items.length) return;
    var el = items[index];
    if (!el) return;

    if (isPopupOpen()) {
      if (typeof el.click === 'function') el.click();
      return;
    }

    var target = el.querySelector && el.querySelector('a[href],button,[role="button"],.play');
    (target || el).click();
  }

  function dispatchBack() {
    try {
      var ev = document.createEvent('Event');
      ev.initEvent('backbutton', true, true);
      document.dispatchEvent(ev);
    } catch (e) { }
  }

  function back() {
    dispatchBack();
    if (isPopupOpen()) return; // back-handler should close it
    try { history.back(); } catch (e) { }
  }

  function onKey(e) {
    var k = e.key;
    var tag = (e.target && e.target.tagName) || '';
    var isForm = /input|textarea|select/i.test(tag);

    // Modal open: keep control inside the modal.
    if (isPopupOpen()) {
      if (k === 'Backspace' || k === 'Escape') {
        if (!isForm) {
          e.preventDefault();
          e.stopPropagation();
          back();
        }
        return;
      }
      if (k === 'Enter' || k === 'NumpadEnter' || k === ' ') {
        e.preventDefault();
        e.stopPropagation();
        enter();
        return;
      }
      if (k === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); move('left'); return; }
      if (k === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); move('right'); return; }
      if (k === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); move('up'); return; }
      if (k === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); move('down'); return; }
      if (k === 'Tab') { e.stopPropagation(); }
      return;
    }

    // No modal: normal navigation.
    if ((k === 'Backspace' || k === 'Escape') && !isForm) {
      e.preventDefault();
      back();
      return;
    }
    if (k === 'Enter' || k === 'NumpadEnter' || k === ' ') {
      e.preventDefault();
      enter();
      return;
    }
    if (k === 'ArrowLeft') { e.preventDefault(); move('left'); return; }
    if (k === 'ArrowRight') { e.preventDefault(); move('right'); return; }
    if (k === 'ArrowUp') { e.preventDefault(); move('up'); return; }
    if (k === 'ArrowDown') { e.preventDefault(); move('down'); return; }
  }

  function syncModalFocus() {
    var open = isPopupOpen();
    if (open && !lastModalOpen) {
      lastFocusBeforeModal = document.activeElement;
      index = -1;
      highlight(0);
    }
    if (!open && lastModalOpen) {
      if (lastFocusBeforeModal && lastFocusBeforeModal.focus) {
        try { lastFocusBeforeModal.focus({ preventScroll: true }); } catch (e) { }
      }
      lastFocusBeforeModal = null;
      index = -1;
      if (getItems().length) highlight(0);
    }
    lastModalOpen = open;
  }

  function lazyInit() {
    if (getItems().length) { highlight(0); return; }
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (getItems().length) { highlight(0); clearInterval(t); }
      if (tries > 40) clearInterval(t);
    }, 200);
  }

  // Observe modal open/close.
  var mo = new MutationObserver(function () { syncModalFocus(); });
  mo.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: ['class', 'style', 'aria-hidden']
  });

  window.TVNav = { __ok: true, move: move, enter: enter, back: back };
  window.addEventListener('keydown', onKey, { passive: false, capture: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      lazyInit();
      syncModalFocus();
    });
  } else {
    lazyInit();
    syncModalFocus();
  }
})();
