/* Cineby WS TV: remote control inside the embedded video player.
 *
 * TizenBrew evaluates the module in every frame of the cineby tab, so this
 * file runs inside the external player iframes (JW Player and others). It
 * only adds remote navigation to the player's own buttons and menus
 * (quality, subtitles, audio, servers…): arrows move, OK clicks, Return
 * closes an open menu and otherwise hands control back to the page.
 * It does not change the stream, requests or ads of the player.
 */
(function () {
  'use strict';

  var MENU = '[role="menu"],[role="listbox"],[role="dialog"],[class*="settings-menu"],[class*="settings-popup"],[class*="submenu"],[class*="dropdown"],[class*="popup"],[class*="popover"],[class*="-menu"],[class*="_menu"],[class*="menu-"]';
  var SELECTOR = 'button,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="option"],[role="tab"],[role="switch"],[role="radio"],[role="checkbox"],a[href],input:not([type="hidden"]),select,summary,[tabindex]:not([tabindex="-1"]),iframe';
  var FOCUS = 'cbws-embed-focus';

  function directionalScore(from, to, direction) {
    var horizontal = direction === 'left' || direction === 'right';
    var ax = (from.left + from.right) / 2, ay = (from.top + from.bottom) / 2;
    var bx = (to.left + to.right) / 2, by = (to.top + to.bottom) / 2;
    var primary = horizontal ? bx - ax : by - ay;
    if (direction === 'left' || direction === 'up') primary = -primary;
    if (primary < 2) return Infinity;
    var cross = horizontal ? Math.abs(by - ay) : Math.abs(bx - ax);
    var overlap = horizontal
      ? Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top)
      : Math.min(from.right, to.right) - Math.max(from.left, to.left);
    return primary + cross * (overlap > 0 ? 1.25 : 3.5) + (overlap > 0 ? 0 : 120);
  }
  function keyAction(event) {
    var k = event.key, code = event.keyCode || event.which;
    var map = {ArrowLeft:'left',Left:'left',ArrowUp:'up',Up:'up',ArrowRight:'right',Right:'right',ArrowDown:'down',Down:'down',Enter:'ok',NumpadEnter:'ok',OK:'ok',Select:'ok',Accept:'ok',Escape:'back',Esc:'back',XF86Back:'back',GoBack:'back',BrowserBack:'back',MediaPlayPause:'toggle',MediaPlay:'play',MediaPause:'pause',MediaStop:'pause',MediaFastForward:'forward',MediaRewind:'rewind'};
    var codes = {37:'left',38:'up',39:'right',40:'down',13:'ok',27:'back',461:'back',10009:'back',10252:'toggle',415:'play',19:'pause',413:'pause',417:'forward',412:'rewind'};
    return (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null) ||
      (Object.prototype.hasOwnProperty.call(codes, code) ? codes[code] : null);
  }

  function createEmbedRemote(window, document) {
    var active = null, opener = null, started = false;

    function isVisible(el) {
      if (!el || !document.documentElement.contains(el) || el.disabled) return false;
      if (el.getAttribute('aria-hidden') === 'true' || el.getAttribute('aria-disabled') === 'true') return false;
      if (!el.getClientRects().length) return false;
      var r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6) return false;
      if (r.right <= 0 || r.bottom <= 0 || r.left >= window.innerWidth || r.top >= window.innerHeight) return false;
      for (var p = el; p && p !== document.documentElement; p = p.parentElement) {
        var css = window.getComputedStyle(p);
        if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false;
        if (p.hidden || p.getAttribute('aria-hidden') === 'true') return false;
      }
      return true;
    }
    function candidates(container) {
      var list = (container || document).querySelectorAll(SELECTOR), out = [];
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (!isVisible(el)) continue;
        // A tabindex wrapper around a real button counts once.
        if (el.tagName !== 'BUTTON' && el.tagName !== 'A' && !el.getAttribute('role') &&
            el.querySelector && el.querySelector('button,[role="button"],a[href]')) continue;
        out.push(el);
      }
      return out;
    }
    // The nearest visible menu-like container around el with several choices
    // (a "menu-button" itself is not a menu).
    function openMenu(el) {
      var p = el ? el.parentElement : null;
      while (p && p !== document.body && p.closest) {
        var menu = p.closest(MENU);
        if (!menu) return null;
        if (isVisible(menu) && candidates(menu).length >= 2) return menu;
        p = menu.parentElement;
      }
      return null;
    }
    function visibleMenu() {
      var menus = document.querySelectorAll(MENU);
      for (var i = menus.length - 1; i >= 0; i--) {
        if (isVisible(menus[i]) && candidates(menus[i]).length >= 2) return menus[i];
      }
      return null;
    }
    function label(el) {
      return String(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim();
    }
    function setActive(el) {
      if (!el) return false;
      if (active && active !== el && active.classList) active.classList.remove(FOCUS);
      active = el;
      if (el.classList) el.classList.add(FOCUS);
      if (el.tagName !== 'IFRAME') {
        try { el.focus({preventScroll: true}); } catch (err) { try { el.focus(); } catch (ignore) {} }
      }
      return true;
    }
    function video() {
      var list = document.querySelectorAll('video'), best = null, area = 0;
      for (var i = 0; i < list.length; i++) {
        var r = list[i].getBoundingClientRect(), a = r.width * r.height;
        if (a > area) { area = a; best = list[i]; }
      }
      return best;
    }
    // Players hide their control bar while the video plays; a synthetic mouse
    // move over the player shows it again, as moving a real mouse would.
    function wake() {
      var x = Math.round(window.innerWidth / 2), y = Math.round(window.innerHeight / 2);
      var targets = [];
      try { var at = document.elementFromPoint(x, y); if (at) targets.push(at); } catch (ignore) {}
      var v = video(); if (v) targets.push(v);
      for (var i = 0; i < targets.length; i++) {
        var types = ['pointermove', 'mousemove'];
        for (var t = 0; t < types.length; t++) {
          try {
            var ev = typeof window.MouseEvent === 'function'
              ? new window.MouseEvent(types[t], {bubbles: true, cancelable: true, clientX: x, clientY: y, view: window})
              : null;
            if (ev) targets[i].dispatchEvent(ev);
          } catch (ignore) {}
        }
      }
    }
    // Many players (JW Player among them) react to pointer events rather
    // than to a bare click(), so press like a real mouse would.
    function press(el) {
      var r = el.getBoundingClientRect();
      var o = {bubbles: true, cancelable: true, view: window, button: 0, buttons: 1,
        clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
        pointerId: 1, pointerType: 'mouse', isPrimary: true};
      var types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
      var sent = false;
      for (var i = 0; i < types.length; i++) {
        var pointer = types[i].indexOf('pointer') === 0;
        var Ctor = pointer ? window.PointerEvent : window.MouseEvent;
        if (typeof Ctor !== 'function') continue;
        try { el.dispatchEvent(new Ctor(types[i], o)); if (types[i] === 'click') sent = true; } catch (ignore) {}
      }
      if (!sent) { try { el.click(); } catch (ignore) {} }
    }
    function defaultTarget() {
      var menu = visibleMenu();
      var list = candidates(menu);
      if (!list.length) return null;
      if (menu) {
        for (var m = 0; m < list.length; m++) {
          if (list[m].getAttribute('aria-checked') === 'true' || /\b(active|selected|checked)\b/i.test(String(list[m].className))) return list[m];
        }
        return list[0];
      }
      // Prefer the play/pause button of the control bar, else the lowest,
      // leftmost control.
      var best = null, score = -Infinity;
      for (var i = 0; i < list.length; i++) {
        var text = label(list[i]);
        var r = list[i].getBoundingClientRect();
        var s = r.bottom * 2 - r.left * 0.3 + (/^(play|pause)$/i.test(text) ? 4000 : 0);
        if (s > score) { score = s; best = list[i]; }
      }
      return best;
    }
    function ensureActive() {
      if (active && isVisible(active)) return true;
      if (active && active.classList) active.classList.remove(FOCUS);
      active = null;
      return setActive(defaultTarget());
    }
    // Players without accessible markup build menus from plain elements with
    // a pointer cursor. Take the outermost such element as one choice.
    function clickablesIn(root) {
      if (!root || !root.querySelectorAll) return [];
      var all = root.querySelectorAll('*'), out = [], plain = [];
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (el.tagName === 'svg' || el.tagName === 'path' || el.namespaceURI === 'http://www.w3.org/2000/svg') continue;
        var match = false;
        try { match = el.matches ? el.matches(SELECTOR) : false; } catch (ignore) {}
        if (!match) {
          var css = window.getComputedStyle(el);
          if (css.cursor !== 'pointer') continue;
          var parent = el.parentElement;
          if (parent && parent !== root && window.getComputedStyle(parent).cursor === 'pointer') continue;
        }
        if (!isVisible(el)) continue;
        // Skip parts of a plain clickable block already taken, but keep
        // choices placed inside a real button (popup menus nested in it).
        var nested = false;
        for (var j = 0; j < plain.length; j++) if (plain[j].contains(el)) { nested = true; break; }
        if (nested) continue;
        out.push(el);
        if (!match) plain.push(el);
      }
      return out;
    }
    function commonAncestor(list) {
      var node = list[0];
      while (node) {
        var all = true;
        for (var i = 1; i < list.length; i++) if (!node.contains(list[i])) { all = false; break; }
        if (all) return node;
        node = node.parentElement;
      }
      return document.body;
    }
    function preferred(list) {
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true' ||
            /\b(active|selected|checked|current)\b/i.test(String(el.className))) return el;
      }
      return list[0];
    }
    // A popup opened by OK that has no menu markup: {root, opener}.
    var popup = null;
    function popupItems() {
      if (!popup || !document.documentElement.contains(popup.root)) return [];
      var items = clickablesIn(popup.root);
      return items.length >= 2 ? items : [];
    }
    function inPopup(el) {
      return !!(popup && el && popup.root.contains(el) && el !== popup.root && popupItems().length);
    }
    function move(direction) {
      if (!ensureActive()) return;
      var pool;
      if (inPopup(active)) pool = popupItems();
      else {
        var menu = openMenu(active);
        pool = candidates(menu);
        if (menu && pool.length < 2) pool = candidates(null);
      }
      var from = active.getBoundingClientRect(), best = null, score = Infinity;
      for (var i = 0; i < pool.length; i++) {
        if (pool[i] === active || pool[i].contains(active) || active.contains(pool[i])) continue;
        var s = directionalScore(from, pool[i].getBoundingClientRect(), direction);
        if (s < score) { score = s; best = pool[i]; }
      }
      if (best) setActive(best);
    }
    function activate() {
      if (!ensureActive()) { media('toggle'); return; }
      if (active.tagName === 'IFRAME') { try { active.focus(); } catch (ignore) {} return; }
      if (active.tagName === 'VIDEO') { media('toggle'); return; }
      var el = active, before = visibleMenu(), wasInPopup = inPopup(el);
      var known = clickablesIn(document.body);
      press(el);
      // Follow a menu that just opened (Settings → Quality → 720p …). Menus
      // may fade in, so look again a little later if nothing showed yet.
      var tries = 0;
      function settle() {
        tries++;
        var after = visibleMenu();
        if (after && after !== before) {
          if (!openMenu(el)) opener = el;
          popup = null;
          var first = defaultTarget();
          if (first) setActive(first);
          return;
        }
        var now = clickablesIn(document.body), fresh = [];
        for (var i = 0; i < now.length; i++) if (known.indexOf(now[i]) < 0 && now[i] !== el) fresh.push(now[i]);
        if (fresh.length >= 2) {
          popup = {root: commonAncestor(fresh), opener: wasInPopup && popup ? popup.opener : el};
          setActive(preferred(popupItems().length ? popupItems() : fresh));
          return;
        }
        if (!wasInPopup && isVisible(el) && tries < 3) { window.setTimeout(settle, 180); return; }
        if (wasInPopup && !popupItems().length) {
          // A choice closed its popup (e.g. subtitles picked).
          var back = popup.opener; popup = null;
          if (el.classList) el.classList.remove(FOCUS);
          active = null;
          if (back && isVisible(back)) setActive(back); else ensureActive();
          return;
        }
        if (!isVisible(el)) {
          // The choice closed its menu (e.g. a quality was picked): go back
          // to the button that opened it.
          if (el.classList) el.classList.remove(FOCUS);
          active = null;
          if (!visibleMenu() && opener && isVisible(opener)) { setActive(opener); opener = null; }
          else ensureActive();
        }
      }
      window.setTimeout(settle, 120);
    }
    function sendEscape() {
      var target = active || document.activeElement || document.body;
      try {
        var esc = new window.KeyboardEvent('keydown', {key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true});
        esc.__cbwsSynthetic = true;
        target.dispatchEvent(esc);
      } catch (ignore) {}
    }
    function closeMenu(menu) {
      sendEscape();
      window.setTimeout(function () {
        if (isVisible(menu) && opener && isVisible(opener)) press(opener);
        if (opener && isVisible(opener)) setActive(opener);
        else { if (active && active.classList) active.classList.remove(FOCUS); active = null; ensureActive(); }
        if (!visibleMenu()) opener = null;
      }, 60);
    }
    function closePopup() {
      var p = popup;
      sendEscape();
      window.setTimeout(function () {
        if (popupItems().length && p.opener && isVisible(p.opener)) press(p.opener);
        popup = null;
        if (active && active.classList) active.classList.remove(FOCUS);
        active = null;
        if (p.opener && isVisible(p.opener)) setActive(p.opener); else ensureActive();
      }, 60);
    }
    function back() {
      if (popupItems().length) { closePopup(); return; }
      popup = null;
      var menu = (active && openMenu(active)) || visibleMenu();
      if (menu) { closeMenu(menu); return; }
      // Nothing open: give the remote back to the page around the player.
      if (active && active.classList) active.classList.remove(FOCUS);
      active = null;
      try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (ignore) {}
      try { window.parent.postMessage({cbws: 'exit'}, '*'); } catch (ignore) {}
    }
    function media(action) {
      var v = video();
      if (!v) return false;
      try {
        if (action === 'toggle') { if (v.paused) v.play(); else v.pause(); }
        else if (action === 'play') v.play();
        else if (action === 'pause') v.pause();
        else if (action === 'forward' || action === 'rewind') {
          var t = v.currentTime + (action === 'forward' ? 10 : -10);
          v.currentTime = Math.max(0, isFinite(v.duration) ? Math.min(t, v.duration) : t);
        }
      } catch (ignore) {}
      return true;
    }
    function onKey(event) {
      if (event.__cbwsSynthetic || event.__cbwsHandled) return;
      var action = keyAction(event);
      if (!action) return;
      var el = document.activeElement;
      var editing = el && (el.tagName === 'INPUT' && !/^(button|submit|checkbox|radio|range)$/i.test(el.type || '') || el.tagName === 'TEXTAREA');
      if (editing && action !== 'back') return;
      try { event.__cbwsHandled = true; } catch (ignore) {}
      if (event.preventDefault) event.preventDefault();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      wake();
      // Give the player a moment to show its controls before measuring them.
      window.setTimeout(function () {
        if (action === 'back') back();
        else if (action === 'ok') activate();
        else if (action === 'left' || action === 'right' || action === 'up' || action === 'down') move(action);
        else media(action);
      }, 30);
    }
    function onMessage(event) {
      var data = event.data;
      if (!data || data.cbws !== 'exit') return;
      // A nested player frame handed control back to this one.
      var frames = document.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].contentWindow === event.source) {
          try { frames[i].blur(); } catch (ignore) {}
          try { window.focus(); } catch (ignore) {}
          setActive(frames[i]);
          return;
        }
      }
    }
    function onFocus() {
      wake();
      window.setTimeout(function () { active = null; ensureActive(); }, 60);
    }
    function start() {
      if (started) return;
      started = true;
      var style = document.createElement('style');
      style.textContent = '.' + FOCUS + '{outline:3px solid #a5fbec!important;outline-offset:2px!important;box-shadow:0 0 0 6px rgba(165,251,236,.35)!important;border-radius:6px;}';
      (document.head || document.documentElement).appendChild(style);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('message', onMessage);
      window.addEventListener('focus', onFocus);
      try { window.parent.postMessage({cbws: 'embed-ready'}, '*'); } catch (ignore) {}
    }
    return {start: start, move: move, activate: activate, back: back, onKey: onKey, getActive: function () { return active; }};
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {createEmbedRemote: createEmbedRemote, keyAction: keyAction};
    return;
  }
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__cinebyWsEmbed) return;
  if (window.top === window.self && !window.__cbwsEmbedTest) return;
  window.__cinebyWsEmbed = true;
  var remote = createEmbedRemote(window, document);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', remote.start);
  else remote.start();
})();
