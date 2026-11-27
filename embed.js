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
  var CONTROL_TAGS = /^(BUTTON|A|INPUT|SELECT|SUMMARY|IFRAME)$/;
  var CONTROL_ROLES = /^(button|menuitem|menuitemradio|menuitemcheckbox|option|tab|switch|radio|checkbox|slider)$/;

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

  // Pop-up and redirect guard, like a browser's pop-up blocker. Ad scripts
  // in player pages open a new window (or follow a link out) on any click;
  // on the TV that replaces the whole screen. The player keeps working; only
  // windows and links that leave it are stopped. Ad scripts also borrow
  // window.open from a fresh hidden iframe, so every same-site child frame
  // gets the guard as soon as it is inserted or its window is touched.
  // Shared with tv.js (kept identical; see test/popup.test.cjs).
  function installPopupGuard(win, doc, allowed, onBlock) {
    if (win.__cbwsPopupGuard) return;
    function report(url) { try { if (onBlock) onBlock(String(url || '')); } catch (ignore) {} }
    function fakeWindow() {
      var noop = function () {};
      var w = {closed: false, opener: null, name: '', frames: [], length: 0,
        location: {href: 'about:blank', assign: noop, replace: noop, reload: noop},
        document: {write: noop, writeln: noop, open: noop, close: noop, body: null, documentElement: null},
        close: function () { w.closed = true; }, focus: noop, blur: noop, moveTo: noop, resizeTo: noop,
        postMessage: noop, addEventListener: noop, removeEventListener: noop};
      w.window = w.self = w;
      return w;
    }
    function blockedOpen(url) { report(url); return fakeWindow(); }
    function leaves(el) {
      if (!el || !el.getAttribute) return false;
      var href = el.getAttribute(el.tagName === 'FORM' ? 'action' : 'href');
      var target = String(el.getAttribute('target') || '').toLowerCase();
      if (target && target !== '_self') return true;
      if (!href || /^\s*(#|javascript:)/i.test(href)) return false;
      var url;
      try { url = new win.URL(href, (el.ownerDocument && el.ownerDocument.baseURI) || doc.baseURI || win.location.href); } catch (ignore) { return false; }
      if (!/^https?:$/.test(url.protocol)) return false;
      return !allowed(url);
    }
    function detached(el) {
      var d = el.ownerDocument;
      return !d || !d.documentElement || !d.documentElement.contains(el);
    }
    var frameGetter = null;
    function childWindow(frame) {
      try { return frameGetter ? frameGetter.call(frame) : frame.contentWindow; } catch (ignore) { return null; }
    }
    function guardFrames(node) {
      if (!node || node.nodeType !== 1) return;
      var list = node.tagName === 'IFRAME' || node.tagName === 'FRAME' ? [node] : [];
      if (node.getElementsByTagName) {
        var inner = node.getElementsByTagName('iframe');
        for (var i = 0; i < inner.length; i++) list.push(inner[i]);
      }
      for (var j = 0; j < list.length; j++) guardRealm(childWindow(list[j]));
    }
    function wrap(proto, name, make) {
      if (!proto || typeof proto[name] !== 'function') return;
      var original = proto[name];
      try { proto[name] = make(original); } catch (ignore) {}
    }
    function guardRealm(w) {
      if (!w) return;
      try { if (w.__cbwsPopupGuard) return; w.__cbwsPopupGuard = true; } catch (ignore) { return; } // other site: not ours to touch
      try { Object.defineProperty(w, 'open', {value: blockedOpen, writable: false, configurable: false}); }
      catch (err) { try { w.open = blockedOpen; } catch (ignore) {} }
      var H = w.HTMLElement && w.HTMLElement.prototype;
      wrap(H, 'click', function (original) {
        return function () {
          if ((this.tagName === 'A' || this.tagName === 'AREA') && leaves(this)) { report(this.href); return; }
          return original.apply(this, arguments);
        };
      });
      var F = w.HTMLFormElement && w.HTMLFormElement.prototype;
      var formWrap = function (original) {
        return function () { if (leaves(this)) { report(this.action); return; } return original.apply(this, arguments); };
      };
      wrap(F, 'submit', formWrap);
      wrap(F, 'requestSubmit', formWrap);
      // A click dispatched on a link that is not in the page still navigates.
      wrap(w.EventTarget && w.EventTarget.prototype, 'dispatchEvent', function (original) {
        return function (event) {
          if (event && event.type === 'click' && this && this.tagName === 'A' && detached(this) && leaves(this)) { report(this.href); return false; }
          return original.apply(this, arguments);
        };
      });
      // Same-site child frames (about:blank helpers) get the guard too.
      var I = w.HTMLIFrameElement && w.HTMLIFrameElement.prototype;
      if (I && Object.getOwnPropertyDescriptor) {
        var props = ['contentWindow', 'contentDocument'];
        for (var p = 0; p < props.length; p++) (function (prop) {
          var desc = Object.getOwnPropertyDescriptor(I, prop);
          if (!desc || !desc.get || !desc.configurable) return;
          if (prop === 'contentWindow' && !frameGetter) frameGetter = desc.get;
          try {
            Object.defineProperty(I, prop, {configurable: true, enumerable: desc.enumerable, get: function () {
              var value = desc.get.call(this);
              try { guardRealm(prop === 'contentWindow' ? value : value && value.defaultView); } catch (ignore) {}
              return value;
            }});
          } catch (ignore) {}
        })(props[p]);
      }
      var N = w.Node && w.Node.prototype, El = w.Element && w.Element.prototype;
      var insertWrap = function (original) {
        return function () {
          var result = original.apply(this, arguments);
          for (var a = 0; a < arguments.length; a++) guardFrames(arguments[a]);
          return result;
        };
      };
      wrap(N, 'appendChild', insertWrap);
      wrap(N, 'insertBefore', insertWrap);
      wrap(N, 'replaceChild', insertWrap);
      wrap(El, 'append', insertWrap);
      wrap(El, 'prepend', insertWrap);
      wrap(El, 'after', insertWrap);
      wrap(El, 'before', insertWrap);
      wrap(El, 'replaceWith', insertWrap);
      wrap(El, 'insertAdjacentElement', function (original) {
        return function (where, el) { var r = original.apply(this, arguments); guardFrames(el); return r; };
      });
      var d = w.document;
      if (d && d.addEventListener) {
        d.addEventListener('click', function (event) {
          var t = event.target, a = t && t.closest ? t.closest('a[href],area[href]') : null;
          if (a && leaves(a)) { event.preventDefault(); report(a.href); }
        }, true);
        d.addEventListener('submit', function (event) {
          if (leaves(event.target)) { event.preventDefault(); report(event.target.action); }
        }, true);
      }
    }
    guardRealm(win);
    if (doc && doc.getElementsByTagName) {
      var frames = doc.getElementsByTagName('iframe');
      for (var f = 0; f < frames.length; f++) guardRealm(childWindow(frames[f]));
    }
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
        // A focusable wrapper (e.g. JW Player's whole "Video Player" box)
        // around real controls is not a target itself: arrows could never
        // leave it, since everything else lies inside it.
        if (!CONTROL_TAGS.test(el.tagName) && !CONTROL_ROLES.test(el.getAttribute('role') || '') &&
            el.querySelector && el.querySelector(SELECTOR)) continue;
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
      // On the progress bar, left/right seek instead of leaving it.
      if (isSlider(active) && (direction === 'left' || direction === 'right')) { media(direction === 'left' ? 'rewind' : 'forward'); return; }
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
      if (active.tagName === 'IFRAME') { enterChild(active); return; }
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
        if (!wasInPopup && isVisible(el) && tries < 7) { window.setTimeout(settle, 180); return; }
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
    // ---- Player API for the page's own on-screen display (OSD) ----------
    function jwApi() {
      try {
        if (typeof window.jwplayer !== 'function') return null;
        var p = window.jwplayer();
        return p && typeof p.getPosition === 'function' ? p : null;
      } catch (ignore) { return null; }
    }
    function childFrames() { return document.querySelectorAll('iframe'); }
    function toChildren(data) {
      var frames = childFrames();
      for (var f = 0; f < frames.length; f++) post(frames[f].contentWindow, data);
      return frames.length > 0;
    }
    function status() {
      var v = video();
      if (!v) return null;
      var jw = jwApi(), t = v.currentTime, d = v.duration, paused = v.paused, buffering = v.readyState < 3 && !v.paused;
      if (jw) {
        try { t = jw.getPosition(); d = jw.getDuration(); var st = jw.getState(); paused = st !== 'playing' && st !== 'buffering'; buffering = st === 'buffering'; } catch (ignore) {}
      }
      return {cbws: 'status', t: isFinite(t) ? t : 0, d: isFinite(d) ? d : 0, paused: !!paused, buffering: !!buffering};
    }
    function reportStatus() {
      if (window.parent === window) return;
      var s = status();
      if (s) post(window.parent, s);
    }
    function textTracks(v) {
      var out = [], list = v && v.textTracks ? v.textTracks : [];
      for (var i = 0; i < list.length; i++) {
        var k = list[i].kind;
        if (k === 'subtitles' || k === 'captions') out.push(list[i]);
      }
      return out;
    }
    function tracks() {
      var v = video();
      if (!v) return null;
      var jw = jwApi(), quality = [], q = -1, subs = [], sub = -1, i;
      if (jw) {
        try {
          var levels = jw.getQualityLevels() || [];
          for (i = 0; i < levels.length; i++) quality.push({id: i, label: String(levels[i].label || levels[i].height || i)});
          q = jw.getCurrentQuality();
          var caps = jw.getCaptionsList() || [];
          for (i = 0; i < caps.length; i++) subs.push({id: i, label: String(caps[i].label || caps[i].name || (i ? 'Track ' + i : 'Off'))});
          sub = jw.getCurrentCaptions();
        } catch (ignore) {}
      } else {
        var list = textTracks(v);
        subs.push({id: -1, label: 'Off'});
        for (i = 0; i < list.length; i++) {
          subs.push({id: i, label: String(list[i].label || list[i].language || 'Track ' + (i + 1))});
          if (list[i].mode === 'showing' || list[i] === subTrack) sub = i;
        }
        if (subs.length === 1) subs = [];
      }
      return {cbws: 'tracks', quality: quality, q: q, subs: subs, sub: sub};
    }
    function setQuality(id) {
      var jw = jwApi();
      if (jw) { try { jw.setCurrentQuality(id); } catch (ignore) {} }
    }
    // Players other than JW often hide the browser's own subtitle rendering
    // and draw subtitles themselves only for their own menu. Draw the chosen
    // track here: the cue text, large, at the bottom of the picture.
    var subBox = null, subTrack = null;
    function drawCue() {
      if (!subBox || !subTrack) return;
      var cues = subTrack.activeCues, text = [];
      for (var i = 0; cues && i < cues.length; i++) text.push(String(cues[i].text || '').replace(/<[^>]*>/g, ''));
      subBox.textContent = text.join('\n');
      subBox.style.display = text.length ? 'block' : 'none';
    }
    function stopSubs() {
      if (subTrack) { try { subTrack.removeEventListener('cuechange', drawCue); } catch (ignore) {} subTrack = null; }
      if (subBox && subBox.parentNode) subBox.parentNode.removeChild(subBox);
      subBox = null;
    }
    function setSub(id) {
      var jw = jwApi();
      if (jw) { try { jw.setCurrentCaptions(id); } catch (ignore) {} return; }
      var list = textTracks(video());
      stopSubs();
      for (var i = 0; i < list.length; i++) list[i].mode = i === id ? 'hidden' : 'disabled';
      if (id < 0 || !list[id]) return;
      subTrack = list[id];
      subBox = document.createElement('div');
      subBox.style.cssText = 'position:fixed;left:8%;right:8%;bottom:11%;z-index:2147483647;text-align:center;white-space:pre-line;pointer-events:none;display:none;' +
        'font:600 4.4vh/1.25 Arial,Helvetica,sans-serif;color:#fff;text-shadow:0 0 4px #000,0 2px 3px #000,0 0 10px rgba(0,0,0,.8);';
      (document.body || document.documentElement).appendChild(subBox);
      subTrack.addEventListener('cuechange', drawCue);
      drawCue();
    }
    function seekTo(t) {
      var v = video();
      if (!v) return;
      var d = v.duration;
      t = Math.max(0, isFinite(d) ? Math.min(t, d - 1) : t);
      var jw = jwApi();
      try { if (jw) jw.seek(t); else v.currentTime = t; } catch (ignore) {}
    }
    // While the page shows its own OSD, JW Player's control bar stays hidden
    // (its captions stay visible). Opening the player's menu shows it again.
    function setOsd(on) {
      var html = document.documentElement;
      if (!html || !html.classList) return;
      if (!osdStyle) {
        osdStyle = document.createElement('style');
        osdStyle.textContent = 'html.cbws-osd .jw-controls,html.cbws-osd .jw-display,html.cbws-osd .jw-controlbar{opacity:0!important;pointer-events:none!important;}';
        (document.head || html).appendChild(osdStyle);
      }
      if (on) html.classList.add('cbws-osd'); else html.classList.remove('cbws-osd');
    }
    var osdStyle = null;
    function command(data) {
      if (!video()) { toChildren(data); return; }
      var op = data.op;
      if (op === 'tracks') { var tr = tracks(); if (tr) post(window.parent, tr); }
      else if (op === 'seekTo' && typeof data.t === 'number') seekTo(data.t);
      else if (op === 'seekBy' && typeof data.s === 'number') { var st = status(); if (st) seekTo(st.t + data.s); }
      else if (op === 'toggle') media('toggle');
      else if (op === 'setQuality' && typeof data.id === 'number') setQuality(data.id);
      else if (op === 'setSub' && typeof data.id === 'number') setSub(data.id);
      else if (op === 'osd') setOsd(!!data.on);
      if (op !== 'tracks' && op !== 'osd') window.setTimeout(reportStatus, 150);
    }

    // Play/pause and ±10 s on the player's own video. JW Player is driven
    // through its API so its interface stays in sync. With no video in this
    // document (the real player sits in a nested frame), pass it down.
    function media(action) {
      var v = video();
      if (!v) {
        var frames = document.querySelectorAll('iframe');
        for (var f = 0; f < frames.length; f++) post(frames[f].contentWindow, {cbws: 'key', action: action});
        return frames.length > 0;
      }
      var jw = null;
      try { if (typeof window.jwplayer === 'function') { jw = window.jwplayer(); if (!jw || typeof jw.seek !== 'function') jw = null; } } catch (ignore) { jw = null; }
      try {
        if (action === 'toggle' || action === 'play' || action === 'pause') {
          var play = action === 'play' || (action === 'toggle' && v.paused);
          if (jw) { if (play) jw.play(); else jw.pause(); }
          else if (play) { var p = v.play(); if (p && typeof p.catch === 'function') p.catch(function () {}); }
          else v.pause();
        } else if (action === 'forward' || action === 'rewind') {
          var t = v.currentTime + (action === 'forward' ? 10 : -10);
          t = Math.max(0, isFinite(v.duration) ? Math.min(t, v.duration - 1) : t);
          if (jw) jw.seek(t); else v.currentTime = t;
        }
      } catch (ignore) {}
      return true;
    }
    function isSlider(el) {
      return !!el && (el.getAttribute('role') === 'slider' || (el.tagName === 'INPUT' && String(el.type).toLowerCase() === 'range'));
    }
    function run(action) {
      // A nested player frame has the remote: pass the key on.
      if (child) { sendToChild(action); return; }
      wake();
      // Give the player a moment to show its controls before measuring them.
      window.setTimeout(function () {
        if (action === 'back') back();
        else if (action === 'ok') activate();
        else if (action === 'left' || action === 'right' || action === 'up' || action === 'down') move(action);
        else media(action);
      }, 90);
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
      run(action);
    }
    // TV browsers may not move keyboard focus into a cross-origin frame, so
    // the page around the player keeps the focus and sends each remote key
    // here as a message ({cbws:'key'}); every key is acknowledged.
    var child = null, childTimer = 0;
    function post(target, data) { try { target.postMessage(data, '*'); } catch (ignore) {} }
    function enterChild(frame) {
      child = frame;
      post(frame.contentWindow, {cbws: 'control'});
      try { frame.focus(); } catch (ignore) {}
    }
    function leaveChild() {
      var frame = child;
      child = null;
      if (childTimer) { window.clearTimeout(childTimer); childTimer = 0; }
      if (frame) { try { frame.blur(); } catch (ignore) {} setActive(frame); }
    }
    function sendToChild(action) {
      post(child.contentWindow, {cbws: 'key', action: action});
      if (childTimer) window.clearTimeout(childTimer);
      // No answer: that frame has no helper, take the remote back.
      childTimer = window.setTimeout(function () { childTimer = 0; leaveChild(); }, 1200);
    }
    function frameOf(source) {
      var frames = document.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) if (frames[i].contentWindow === source) return frames[i];
      return null;
    }
    var ACTIONS = /^(left|right|up|down|ok|back|toggle|play|pause|forward|rewind)$/;
    function onMessage(event) {
      var data = event.data;
      if (!data || typeof data !== 'object' || typeof data.cbws !== 'string') return;
      if (data.cbws === 'blocked') {
        // Relay from a nested player frame up to the cineby page, never to ourselves.
        if (event.source !== window && window.parent !== window) post(window.parent, {cbws: 'blocked'});
        return;
      }
      if (event.source === window.parent && window.parent !== window) {
        if (data.cbws === 'ping') { post(window.parent, {cbws: 'embed-ready'}); return; }
        if (data.cbws === 'control') { child = null; setOsd(false); toChildren({cbws: 'cmd', op: 'osd', on: false}); onFocus(); return; }
        if (data.cbws === 'cmd' && typeof data.op === 'string') { command(data); return; }
        if (data.cbws === 'key' && ACTIONS.test(String(data.action))) {
          post(window.parent, {cbws: 'ack'});
          run(data.action);
        }
        return;
      }
      var frame = frameOf(event.source);
      if (!frame) return;
      // The real player sits in a nested frame: pass its reports up.
      if ((data.cbws === 'status' || data.cbws === 'tracks') && window.parent !== window && !video()) {
        post(window.parent, data);
        return;
      }
      if (data.cbws === 'ack' && frame === child) {
        if (childTimer) { window.clearTimeout(childTimer); childTimer = 0; }
        return;
      }
      if (data.cbws === 'exit') {
        // A nested player frame handed control back to this one.
        if (frame === child) leaveChild();
        else { try { frame.blur(); } catch (ignore) {} try { window.focus(); } catch (ignore) {} setActive(frame); }
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
      window.setInterval(reportStatus, 500);
      try { window.parent.postMessage({cbws: 'embed-ready'}, '*'); } catch (ignore) {}
    }
    return {start: start, move: move, activate: activate, back: back, onKey: onKey, getActive: function () { return active; }};
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {createEmbedRemote: createEmbedRemote, keyAction: keyAction, installPopupGuard: installPopupGuard};
    return;
  }
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__cinebyWsEmbed) return;
  if (window.top === window.self && !window.__cbwsEmbedTest) return;
  window.__cinebyWsEmbed = true;
  installPopupGuard(window, document, function (url) { return url.origin === window.location.origin; }, function () {
    if (window.parent !== window) { try { window.parent.postMessage({cbws: 'blocked'}, '*'); } catch (ignore) {} }
  });
  var remote = createEmbedRemote(window, document);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', remote.start);
  else remote.start();
})();
