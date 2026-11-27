/* Cineby WS TV loader.
 *
 * TizenBrew keeps this file cached in its background service until the TV
 * reboots, so it stays tiny and almost never changes. On every page load it
 * asks GitHub for the newest commit on main and runs tv.js from that exact
 * commit through jsDelivr. Pushing to main is enough to update the TV: the
 * new code is picked up on the next page load (the commit id is remembered
 * for a few minutes to stay well inside GitHub's rate limit).
 */
(function () {
  'use strict';
  var REPO = 'ystas97/cineby-ws-tv';
  var FILE = 'tv.js';
  var KEY = 'cbws-loader-ref';
  var TTL = 5 * 60 * 1000;

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__cinebyWsLoader) return;
  if (!/^(www\.)?cineby\.ws$/i.test(window.location.hostname)) return;
  if (window.top !== window.self) return;
  window.__cinebyWsLoader = true;

  function readCache() {
    try {
      var data = JSON.parse(window.localStorage.getItem(KEY) || 'null');
      if (data && /^[0-9a-f]{40}$/.test(data.sha) && typeof data.time === 'number') return data;
    } catch (ignore) {}
    return null;
  }
  function writeCache(sha) {
    try { window.localStorage.setItem(KEY, JSON.stringify({sha: sha, time: Date.now()})); } catch (ignore) {}
  }
  function inject(ref, onFail) {
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/gh/' + REPO + '@' + ref + '/' + FILE;
    script.async = false;
    script.onerror = function () {
      if (script.parentNode) script.parentNode.removeChild(script);
      if (onFail) onFail();
    };
    (document.head || document.documentElement).appendChild(script);
  }
  // Last resort: the branch itself (may be a few hours old on the CDN).
  function loadBranch() { inject('main', null); }
  function loadSha(sha) { inject(sha, loadBranch); }

  var cached = readCache();
  if (cached && Date.now() - cached.time < TTL) { loadSha(cached.sha); return; }

  var done = false;
  function finish(sha) {
    if (done) return;
    done = true;
    if (sha) { writeCache(sha); loadSha(sha); }
    else if (cached) loadSha(cached.sha);
    else loadBranch();
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
      finish(/^[0-9a-f]{40}$/.test(sha) ? sha : '');
    };
    xhr.onerror = xhr.ontimeout = function () { finish(''); };
    xhr.send();
  } catch (err) {
    finish('');
  }
})();
