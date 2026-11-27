/* Cineby WS TV: client-side remote navigation, no network requests. */
(function () {
  'use strict';

  // Score candidates in a direction, favoring same-row/column alignment.
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
    // Separate rows by overlap instead of relying entirely on centers.
    return primary + cross * (overlap > 0 ? 1.25 : 3.5) + (overlap > 0 ? 0 : 120);
  }

  function pickNext(from, candidates, direction) {
    var best = null, score = Infinity;
    for (var i = 0; i < candidates.length; i++) {
      var s = directionalScore(from, candidates[i].rect, direction);
      if (s < score) {
        score = s;
        best = candidates[i];
      }
    }
    return best;
  }

  function keyAction(event) {
    var k = event.key, code = event.keyCode || event.which;
    var map = {ArrowLeft:'left',Left:'left',ArrowUp:'up',Up:'up',ArrowRight:'right',Right:'right',ArrowDown:'down',Down:'down',Enter:'ok',NumpadEnter:'ok',Escape:'back',Backspace:'back',GoBack:'back',BrowserBack:'back',MediaPlayPause:'toggle',MediaPlay:'play',MediaPause:'pause',MediaStop:'stop',MediaFastForward:'forward',MediaRewind:'rewind'};
    var codes = {37:'left',38:'up',39:'right',40:'down',13:'ok',27:'back',8:'back',461:'back',10009:'back',10252:'toggle',415:'play',19:'pause',413:'stop',417:'forward',412:'rewind'};
    return (Object.prototype.hasOwnProperty.call(map,k) ? map[k] : null) ||
      (Object.prototype.hasOwnProperty.call(codes,code) ? codes[code] : null);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {directionalScore:directionalScore,pickNext:pickNext,keyAction:keyAction};
    return;
  }
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__cinebyWsRemoteV1) return;
  // Only run on the intended site. Never traverse cross-origin player frames.
  if (!/^(www\.)?cineby\.ws$/i.test(window.location.hostname)) return;
  if (window.top !== window.self) return;
  window.__cinebyWsRemoteV1 = true;

  var selector = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [tabindex]:not([tabindex="-1"]), iframe, video[controls]';
  var focusClass = 'cbws-tv-focus';
  var active = null;
  var nodes = [];
  var dirty = true;
  var previousPath = window.location.href;
  var lastDirection = 0;
  var updateTimer = 0;
  var observer;
  var navigationMode = true;

  function initStyle() {
    if (document.getElementById('cbws-tv-style')) return;
    var style = document.createElement('style');
    style.id = 'cbws-tv-style';
    style.type = 'text/css';
    style.appendChild(document.createTextNode(
      '.' + focusClass + '{outline:3px solid #66f1db!important;outline-offset:4px!important;box-shadow:0 0 0 7px rgba(102,241,219,.30)!important;}' +
      'a.' + focusClass + '{border-radius:6px;}' +
      'input.' + focusClass + ',textarea.' + focusClass + '{outline-offset:2px!important;}' +
      '#cbws-tv-hint{position:fixed;z-index:2147483646;right:22px;bottom:22px;max-width:90vw;padding:11px 16px;border-radius:10px;background:rgba(9,20,29,.94);border:1px solid #66f1db;color:#fff;font:600 15px Arial,sans-serif;pointer-events:none;transition:opacity .2s;}' +
      '@media (min-width:1000px){body{scroll-padding:24px;} }'
    ));
    (document.head || document.documentElement).appendChild(style);
  }

  var hintTimer;
  function hint(message) {
    if (!document.body) return;
    var node = document.getElementById('cbws-tv-hint');
    if (!node) {
      node = document.createElement('div');
      node.id = 'cbws-tv-hint';
      node.setAttribute('aria-live','polite');
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.style.opacity = '1';
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function(){node.style.opacity='0';}, 3500);
  }

  function contains(el) {
    return !!el && (document.documentElement === el || document.documentElement.contains(el));
  }

  function isTextInput(el) {
    if (!el) return false;
    var type = String(el.type || '').toLowerCase();
    return el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && ['button','submit','reset','checkbox','radio','range','file','color','image','hidden'].indexOf(type) === -1) || el.isContentEditable;
  }

  function isVisible(el) {
    if (!contains(el) || el.disabled || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('aria-hidden') === 'true') return false;
    if (!el.getClientRects().length) return false;
    var css = window.getComputedStyle(el);
    if (css.display === 'none' || css.visibility === 'hidden' || css.pointerEvents === 'none') return false;
    var r = el.getBoundingClientRect();
    if (r.width < 7 || r.height < 7) return false;
    // Hidden/clipped slideout menus and background dialogs should not steal focus.
    var parent = el;
    while (parent && parent !== document.body) {
      if (parent.hidden || parent.getAttribute('aria-hidden') === 'true' || parent.hasAttribute('inert')) return false;
      parent = parent.parentElement;
    }
    return true;
  }

  function scope() {
    var dialogs = document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]');
    for (var i = dialogs.length - 1; i >= 0; i--) if (isVisible(dialogs[i])) return dialogs[i];
    return document;
  }

  function rebuild() {
    var container = scope();
    var list = container.querySelectorAll(selector);
    nodes = [];
    for (var i=0; i<list.length; i++) {
      var el = list[i];
      if (!isVisible(el)) continue;
      // Nested links/buttons should appear as one target if the inner node
      // is merely a tabindex wrapper around an already actionable element.
      if (el.tagName !== 'A' && el.tagName !== 'BUTTON' && el.getAttribute('tabindex') !== null &&
          el.getAttribute('role') === null && el.querySelector('a[href],button')) continue;
      nodes.push(el);
    }
    dirty = false;
  }

  function currentNodes() {
    if (dirty) rebuild();
    return nodes;
  }

  function isOnScreen(rect) {
    return rect.right > 0 && rect.left < window.innerWidth && rect.bottom > 0 && rect.top < window.innerHeight;
  }

  function reveal(el) {
    var rect = el.getBoundingClientRect();
    if (rect.top >= 24 && rect.bottom <= window.innerHeight - 24 && rect.left >= 12 && rect.right <= window.innerWidth - 12) return;
    // scrollIntoView handles page and any carousel containing this element.
    try { el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'}); }
    catch (err) { try { el.scrollIntoView(false); } catch (ignore) {} }
  }

  function setActive(el, shouldScroll) {
    if (!isVisible(el)) return false;
    if (active && active !== el) active.classList.remove(focusClass);
    active = el;
    if (!active.classList.contains(focusClass)) active.classList.add(focusClass);
    if (!active.hasAttribute('tabindex') && ['A','BUTTON','INPUT','SELECT','TEXTAREA','IFRAME','SUMMARY'].indexOf(active.tagName) === -1) active.setAttribute('tabindex','0');
    // Text fields open their keyboard only on deliberate OK; likewise iframes
    // are focused on activation rather than on every directional move.
    if (!isTextInput(active) && active.tagName !== 'IFRAME') {
      try { active.focus({preventScroll:true}); } catch(err){ try { active.focus(); } catch(ignore){} }
    } else if (document.activeElement && document.activeElement !== active && !isTextInput(document.activeElement)) {
      try { document.activeElement.blur(); } catch(ignore){}
    }
    if (shouldScroll) reveal(active);
    return true;
  }

  function firstTarget() {
    var list = currentNodes(), first = null, best = Infinity;
    for (var i=0; i<list.length; i++) {
      var r = list[i].getBoundingClientRect();
      if (!isVisible(list[i]) || !isOnScreen(r)) continue;
      var score = Math.max(0,r.top) * 2 + Math.max(0,r.left) * .2;
      if (score < best) { best=score; first=list[i]; }
    }
    return first || list[0] || null;
  }

  function ensureActive() {
    if (active && isVisible(active) && scope().contains(active)) return true;
    var target = firstTarget();
    return target ? setActive(target,false) : false;
  }

  function scrollFallback(direction) {
    var amount = Math.round(window.innerHeight*.55);
    if (direction === 'down' || direction === 'up') {
      var parent = active && active.parentElement;
      while (parent && parent !== document.body) {
        if (parent.scrollHeight > parent.clientHeight + 4 && /auto|scroll/.test(window.getComputedStyle(parent).overflowY)) {
          parent.scrollTop += direction === 'down' ? amount : -amount;
          return;
        }
        parent = parent.parentElement;
      }
      window.scrollBy(0,direction === 'down' ? amount : -amount);
    } else {
      var el = active && active.parentElement;
      while (el && el !== document.body) {
        if (el.scrollWidth > el.clientWidth + 4 && /auto|scroll/.test(window.getComputedStyle(el).overflowX)) {
          el.scrollLeft += direction === 'right' ? amount : -amount;
          return;
        }
        el = el.parentElement;
      }
    }
  }

  function move(direction) {
    if (!ensureActive()) { scrollFallback(direction); return; }
    var from = active.getBoundingClientRect(), list = currentNodes(), candidates = [];
    for (var i=0; i<list.length; i++) {
      var el = list[i];
      if (el === active || !isVisible(el) || el.contains(active) || active.contains(el)) continue;
      var rect = el.getBoundingClientRect();
      candidates.push({element:el,rect:rect});
    }
    var best = pickNext(from,candidates,direction);
    if (best) setActive(best.element,true);
    else scrollFallback(direction);
  }

  function activate() {
    if (!ensureActive()) return;
    if (isTextInput(active)) {
      active.focus();
      try { active.click(); } catch(ignore){}
      return;
    }
    if (active.tagName === 'IFRAME') {
      active.focus();
      hint('Плеер во фрейме: управление зависит от источника');
      return;
    }
    if (active.tagName === 'VIDEO') { media('toggle'); return; }
    // Dispatch the existing site's ordinary click; no changes to restrictions.
    if (typeof active.click === 'function') active.click();
  }

  function findVideo() {
    var list = document.querySelectorAll('video'), best = null, area = 0;
    for (var i=0;i<list.length;i++){
      if(!isVisible(list[i]))continue;
      var r=list[i].getBoundingClientRect(), a=r.width*r.height;
      if(a>area){area=a;best=list[i];}
    }
    return best;
  }

  function media(action) {
    var v = findVideo();
    if (!v) { hint('Нет доступного HTML5-видео на этой странице'); return false; }
    try {
      if (action === 'toggle' || action === 'play') {
        if (action === 'toggle' && !v.paused) v.pause();
        else {
          var p=v.play();
          if(p && typeof p.catch==='function')p.catch(function(){hint('Нажмите Play в плеере');});
        }
      } else if(action === 'pause') v.pause();
      else if(action === 'stop') {v.pause();}
      else if(action === 'forward' || action === 'rewind') {
        var t=v.currentTime+(action==='forward'?10:-10);
        v.currentTime=Math.max(0,isFinite(v.duration)?Math.min(t,v.duration):t);
      }
      return true;
    } catch(err) { hint('Управление этим плеером ограничено'); return false; }
  }

  function onBack() {
    var el = document.activeElement;
    if (isTextInput(el) || el && el.tagName === 'IFRAME') {
      el.blur();
      // Move DOM focus back to the outer page while preserving visual focus.
      if (active) ensureActive();
      return true;
    }
    if (document.fullscreenElement && document.exitFullscreen) { document.exitFullscreen(); return true; }
    if (document.webkitFullscreenElement && document.webkitExitFullscreen) {document.webkitExitFullscreen();return true;}
    return false; // TizenBrew / the site keeps its normal Back behavior.
  }

  function onKey(event) {
    var action = keyAction(event);
    if (!action || event.defaultPrevented) return;
    var el = document.activeElement;
    var editing = isTextInput(el);
    if (editing && action === 'back') {
      // Backspace must continue to delete text in a search field.
      if (event.key === 'Backspace' || event.keyCode === 8) return;
      if (onBack()) { event.preventDefault();event.stopPropagation(); }
      return;
    }
    if (editing && ['left','right','up','down','ok'].indexOf(action)!==-1) return;
    if (el && el.tagName==='SELECT' && (action==='left'||action==='right'||action==='up'||action==='down'||action==='ok')) return;
    if (el && el.tagName==='INPUT' && el.type==='range' && (action==='left'||action==='right')) return;
    if (action === 'back') {
      if (onBack()) {event.preventDefault();event.stopPropagation();}
      return;
    }
    if (['toggle','play','pause','stop','forward','rewind'].indexOf(action)!==-1) {
      if (media(action)) {event.preventDefault();event.stopPropagation();}
      return;
    }
    if (action === 'ok') {
      event.preventDefault();event.stopPropagation();activate();return;
    }
    if (Date.now()-lastDirection<70) {event.preventDefault();return;}
    lastDirection=Date.now();
    navigationMode=true;
    event.preventDefault();event.stopPropagation();move(action);
  }

  function onPointer(event) {
    navigationMode=false;
    var target=event.target;
    if(!target || !target.closest)return;
    var el=target.closest(selector);
    if(el && isVisible(el)) {
      if(active && active!==el)active.classList.remove(focusClass);
      active=el;
    }
  }

  function scheduleRefresh() {
    dirty=true;
    if(updateTimer)return;
    updateTimer=setTimeout(function(){
      updateTimer=0;
      var path=window.location.href;
      if(path!==previousPath){
        previousPath=path;
        if(active)active.classList.remove(focusClass);
        active=null;
      }
      if(navigationMode && (!active || !isVisible(active)) && !isTextInput(document.activeElement))ensureActive();
    },120);
  }

  function start(){
    initStyle();
    document.addEventListener('keydown',onKey,true);
    document.addEventListener('mousedown',onPointer,true);
    document.addEventListener('touchstart',onPointer,true);
    window.addEventListener('resize',scheduleRefresh);
    window.addEventListener('popstate',scheduleRefresh);
    window.addEventListener('hashchange',scheduleRefresh);
    if(typeof MutationObserver!=='undefined'){
      observer=new MutationObserver(scheduleRefresh);
      observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','aria-hidden','disabled','aria-disabled','aria-modal']});
    }
    ensureActive();
    hint('Пульт активен: стрелки · OK · Назад');
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
  else start();
})();
