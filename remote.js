/* Cineby WS TV loader.
 *
 * TizenBrew keeps this file cached in its background service until the TV
 * reboots, so it stays tiny and almost never changes. On every page load it
 * asks GitHub for the newest commit on main and runs the real code from that
 * exact commit through jsDelivr. Pushing to main is enough to update the TV:
 * the new code is picked up on the next page load (the commit id is
 * remembered for a few minutes to stay well inside GitHub's rate limit).
 *
 * TizenBrew evaluates this file in every frame of the cineby tab:
 *   - the cineby.ws page itself loads tv.js (TV interface);
 *   - embedded player frames load embed.js (remote control for the player's
 *     own menus). They ask the cineby page for its commit id first, so all
 *     parts run the same version without extra GitHub requests.
 */
(function () {
  'use strict';
  var REPO = 'ystas97/cineby-ws-tv';
  var KEY = 'cbws-loader-ref';
  var TTL = 5 * 60 * 1000;
  var SHA = /^[0-9a-f]{40}$/;

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__cinebyWsLoader) return;

  var isTop = window.top === window.self;
  var onCineby = /^(www\.)?cineby\.ws$/i.test(window.location.hostname);
  function underCineby() {
    var origins = window.location.ancestorOrigins;
    if (!origins || typeof origins.length !== 'number') return true; // only cineby tabs run this module
    for (var i = 0; i < origins.length; i++) if (/^https?:\/\/(www\.)?cineby\.ws$/i.test(origins[i])) return true;
    return false;
  }
  var file;
  if (isTop && onCineby) file = 'tv.js';
  else if (!isTop && underCineby()) file = 'embed.js';
  else return;
  window.__cinebyWsLoader = true;

  function readCache() {
    try {
      var data = JSON.parse(window.localStorage.getItem(KEY) || 'null');
      if (data && SHA.test(data.sha) && typeof data.time === 'number') return data;
    } catch (ignore) {}
    return null;
  }
  function writeCache(sha) {
    try { window.localStorage.setItem(KEY, JSON.stringify({sha: sha, time: Date.now()})); } catch (ignore) {}
  }
  function inject(ref, onFail) {
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/gh/' + REPO + '@' + ref + '/' + file;
    script.async = false;
    script.onerror = function () {
      if (script.parentNode) script.parentNode.removeChild(script);
      if (onFail) onFail();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  // The commit this tab runs, shared with player frames.
  var chosen = '', waiting = [];
  function answer(target) {
    try { target.postMessage({cbws: 'ref', sha: chosen}, '*'); } catch (ignore) {}
  }
  function use(ref) {
    if (chosen) return;
    chosen = ref;
    for (var i = 0; i < waiting.length; i++) answer(waiting[i]);
    waiting = [];
    inject(ref, ref === 'main' ? null : function () { inject('main', null); });
  }
  if (file === 'tv.js') {
    window.addEventListener('message', function (event) {
      var data = event.data;
      if (!data || data.cbws !== 'ref?' || !event.source) return;
      if (chosen) answer(event.source); else waiting.push(event.source);
    });
  }

  function lookup(cached) {
    var done = false;
    function finish(sha) {
      if (done) return;
      done = true;
      if (sha) { writeCache(sha); use(sha); }
      else use(cached ? cached.sha : 'main');
    }
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'https://api.github.com/repos/' + REPO + '/commits/main', true);
      xhr.timeout = 5000;
      xhr.onload = function () {
        var sha = '';
        if (xhr.status === 200) {
          try { sha = JSON.parse(xhr.responseText).sha || ''; } catch (ignore) {}
        }
        finish(SHA.test(sha) ? sha : '');
      };
      xhr.onerror = xhr.ontimeout = function () { finish(''); };
      xhr.send();
    } catch (err) {
      finish('');
    }
  }
  function resolveOwn() {
    var cached = readCache();
    if (cached && Date.now() - cached.time < TTL) use(cached.sha);
    else lookup(cached);
  }

  if (file === 'embed.js') {
    // Ask the cineby page which commit it runs; look it up ourselves only if
    // it does not answer (for example when tv.js was not loaded by us).
    var timer = 0;
    window.addEventListener('message', function (event) {
      var data = event.data;
      if (chosen || !data || data.cbws !== 'ref' || event.source !== window.top) return;
      if (timer) window.clearTimeout(timer);
      use(SHA.test(data.sha) || data.sha === 'main' ? data.sha : 'main');
    });
    try { window.top.postMessage({cbws: 'ref?'}, '*'); } catch (ignore) {}
    timer = window.setTimeout(function () { if (!chosen) resolveOwn(); }, 1500);
  } else {
    resolveOwn();
  }
})();
