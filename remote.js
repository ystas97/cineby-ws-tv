/* Cineby WS TV: TV layout and client-side remote navigation, no player API requests. */
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

  // TV layout helpers: presentation-only, using links and artwork already
  // present in the current document. No requests to content or player APIs.
  function isTitlePath(path) {
    return /^\/(movie|tv)\/[^/]+\/?$/i.test(path || '');
  }
  function isBrowsePath(path) {
    return /^(\/|\/home\/?|\/movies\/?|\/tv\/?|\/search(?:\/.*)?\/?|\/my-room\/?)$/i.test(path || '');
  }
  function cardText(raw) {
    var s = String(raw || '').replace(/\s+/g,' ').trim();
    var year = s.match(/(?:\s|^)((?:19|20)\d{2})\s*$/);
    var rating = s.match(/★\s*(\d+(?:\.\d+)?)/);
    var episode = s.match(/\bS\d+\s*E\d+\b/i);
    s = s.replace(/^#?\d+\s+(?=TV\b)/i,'').replace(/^TV\s+/i,'')
      .replace(/^★\s*\d+(?:\.\d+)?\s*/,'').replace(/^S\d+\s*E\d+\s*/i,'')
      .replace(/\s+(?:19|20)\d{2}\s*$/,'').trim();
    if (/^(play|see more|watch now|view all|\d+)$/i.test(s)) s='';
    return {title:s,year:year?year[1]:'',rating:rating?rating[1]:'',episode:episode?episode[0].toUpperCase():''};
  }
  function sectionLabel(raw) {
    var s=String(raw || '').replace(/\s+/g,' ').trim().toLowerCase();
    if (s.indexOf('updated tv')>=0) return 'Just updated';
    if (s.indexOf('new tv')>=0) return 'New series';
    if (s.indexOf('new movies')>=0) return 'New movies';
    if (s.indexOf('hot right now')>=0 || s.indexOf('trending')>=0) return 'Popular now';
    return '';
  }

  function createTvLayout() {
    var root=null, suppressed='', mountedUrl='', refreshDelay=0, openModeButton=null;
    var layoutId='cbws-tv-screen';
    var artFrames=[],lastArtRefresh=0,artRefreshTimer=0,heroRefs=null;
    var theatre=null,playerUI=null,playRequest=null,playerTimer=0,playerModeButton=null;
    var nativeClass='cbws-native-tv';
    var CSS=[
      '#cbws-tv-screen{position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;z-index:2147483000!important;background:#080e18!important;color:#f3f5fa!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;font-family:Arial,Helvetica,sans-serif!important;font-size:20px!important;line-height:1.4!important;margin:0!important;padding:0!important;text-align:left!important;}',
      '#cbws-tv-screen *{box-sizing:border-box;}',
      '#cbws-tv-screen a,#cbws-tv-screen button{font-family:inherit!important;text-decoration:none!important;color:inherit!important;cursor:pointer;outline:none;border:0!important;box-shadow:none;max-width:none!important;}',
      '#cbws-tv-screen a:focus,#cbws-tv-screen button:focus,#cbws-tv-screen .cbws-tv-focus{outline:3px solid #a5fbec!important;outline-offset:3px!important;box-shadow:0 0 0 6px rgba(165,251,236,.19)!important;}',
      '#cbws-tv-screen .cbws-masthead{height:82px;min-height:70px;flex:none;display:flex;align-items:center;padding:0 3.8vw;border-bottom:1px solid #222d3c;background:#0b1320;}',
      '#cbws-tv-screen .cbws-brand{display:flex;align-items:center;font-weight:900;font-size:27px;letter-spacing:1px;white-space:nowrap;margin-right:3.4vw;color:#fff!important;background:transparent!important;padding:8px 0!important;}',
      '#cbws-tv-screen .cbws-orbit{display:inline-block;border:3px solid #a5fbec;width:24px;height:24px;border-radius:50%;margin-right:11px;transform:rotate(-35deg);position:relative;}',
      '#cbws-tv-screen .cbws-orbit:after{content:"";position:absolute;left:-5px;right:-5px;top:8px;border-top:2px solid #a5fbec;}',
      '#cbws-tv-screen .cbws-brand small{font-weight:800;font-size:13px;color:#a5fbec;margin-left:7px;letter-spacing:2px;align-self:center;}',
      '#cbws-tv-screen .cbws-nav{display:flex;flex:1;align-items:center;white-space:nowrap;height:100%;}',
      '#cbws-tv-screen .cbws-nav a,#cbws-tv-screen .cbws-nav button{background:transparent!important;font-weight:700;font-size:18px!important;color:#acb9ca!important;padding:14px 15px!important;border-radius:8px!important;margin-right:3px;line-height:1.1!important;}',
      '#cbws-tv-screen .cbws-nav .is-current{background:#263443!important;color:#d0fff5!important;}',
      '#cbws-tv-screen .cbws-actions{display:flex;align-items:center;}',
      '#cbws-tv-screen .cbws-actions button{background:#1b293a!important;color:#d9e5ef!important;border-radius:8px!important;padding:12px 16px!important;font-size:16px!important;margin-left:10px;white-space:nowrap;line-height:1.1!important;}',
      '#cbws-tv-screen .cbws-content{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:24px 3.8vw 48px;scrollbar-width:none;}',
      '#cbws-tv-screen .cbws-content::-webkit-scrollbar,#cbws-tv-screen .cbws-rail::-webkit-scrollbar{width:0;height:0;}',
      '#cbws-tv-screen .cbws-hero{position:relative;min-height:275px;height:27vh;max-height:420px;display:flex;align-items:stretch;background:linear-gradient(115deg,#122b3d 0%,#162032 54%,#263e4e 100%);border:1px solid #2f4353;border-radius:16px;overflow:hidden;margin:0 0 27px;}',
      '#cbws-tv-screen .cbws-hero-copy{padding:25px 32px;width:64%;position:relative;z-index:2;display:flex;flex-direction:column;justify-content:center;}',
      '#cbws-tv-screen .cbws-kicker{font-weight:800;font-size:13px;letter-spacing:3px;color:#a5fbec;margin-bottom:12px;}',
      '#cbws-tv-screen .cbws-hero h1{color:#fff!important;font-size:44px!important;line-height:1.05!important;font-weight:850!important;margin:0 0 12px!important;padding:0!important;letter-spacing:-1px;max-width:100%;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
      '#cbws-tv-screen .cbws-hero-meta{color:#aebdce;font-size:18px;margin:0 0 24px!important;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;}',
      '#cbws-tv-screen .cbws-hero-buttons{display:flex;align-items:center;}',
      '#cbws-tv-screen .cbws-primary,#cbws-tv-screen .cbws-secondary{display:inline-flex;align-items:center;justify-content:center;border-radius:10px!important;font-size:18px!important;font-weight:800;padding:13px 22px!important;margin-right:12px;white-space:nowrap;line-height:1.2!important;}',
      '#cbws-tv-screen .cbws-primary{background:#a5fbec!important;color:#122b32!important;}',
      '#cbws-tv-screen .cbws-secondary{background:#30445a!important;color:#edf6ff!important;}',
      '#cbws-tv-screen .cbws-hero-art{position:absolute;top:0;bottom:0;right:0;width:43%;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#142233;}',
      '#cbws-tv-screen .cbws-hero-art img{position:absolute;top:0;left:0;width:100%!important;height:100%!important;object-fit:cover!important;object-position:50% 32%;opacity:.9;border:0!important;margin:0!important;max-height:none!important;}',
      '#cbws-tv-screen .cbws-hero-art:after{content:"";position:absolute;top:0;bottom:0;left:0;right:0;background:linear-gradient(90deg,#192b3c 0%,rgba(25,43,60,.1) 40%,rgba(12,22,37,.02) 100%);}',
      '#cbws-tv-screen .cbws-section{margin:22px 0 8px;}',
      '#cbws-tv-screen .cbws-section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}',
      '#cbws-tv-screen .cbws-section-head h2,#cbws-tv-screen .cbws-page-title{font-size:27px!important;font-weight:800!important;line-height:1.2!important;color:#f3f5fa!important;margin:0!important;letter-spacing:-.4px;}',
      '#cbws-tv-screen .cbws-page-title{font-size:38px!important;margin:3px 0 15px!important;}',
      '#cbws-tv-screen .cbws-section-counter{font-size:15px;color:#94a9be;}',
      '#cbws-tv-screen .cbws-rail{display:flex;overflow-x:auto;overflow-y:hidden;padding:7px 7px 14px;margin:0 -7px;scrollbar-width:none;}',
      '#cbws-tv-screen .cbws-grid{display:flex;flex-wrap:wrap;padding:7px 7px 14px;margin:0 -7px;}',
      '#cbws-tv-screen .cbws-card{display:flex!important;flex-direction:column;flex:none;width:15.1vw;min-width:145px;max-width:260px!important;border-radius:11px!important;overflow:hidden;background:#152233!important;padding:0!important;margin:0 18px 0 0!important;text-align:left!important;white-space:normal!important;}',
      '#cbws-tv-screen .cbws-grid .cbws-card{width:calc(16.666% - 15px);min-width:0;margin:0 15px 24px 0!important;}',
      '#cbws-tv-screen .cbws-poster{position:relative;height:0;padding-bottom:140%;background:linear-gradient(150deg,#273d4d,#142133);overflow:hidden;}',
      '#cbws-tv-screen .cbws-poster img{position:absolute;top:0;left:0;width:100%!important;height:100%!important;object-fit:cover!important;border:0!important;margin:0!important;max-height:none!important;}',
      '#cbws-tv-screen .cbws-art-image{display:block!important;visibility:visible!important;opacity:1!important;z-index:1;}',
      '#cbws-tv-screen .cbws-art-ready .cbws-placeholder{display:none!important;}',
      '#cbws-tv-screen .cbws-placeholder{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:18px;color:#92c8d0;font-size:25px;font-weight:bold;line-height:1.1;}',
      '#cbws-tv-screen .cbws-rating{position:absolute;top:10px;right:10px;background:rgba(7,14,21,.91);color:#fbe6a6;padding:5px 7px;border-radius:6px;font-size:13px;font-weight:bold;z-index:1;}',
      '#cbws-tv-screen .cbws-card-body{padding:13px 12px 14px;min-height:83px;}',
      '#cbws-tv-screen .cbws-card-name{display:block!important;font-size:18px!important;font-weight:750!important;line-height:1.15!important;color:#f3f5fa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0!important;}',
      '#cbws-tv-screen .cbws-card-meta{display:block;font-size:14px!important;color:#9daec2;margin-top:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '#cbws-tv-screen .cbws-toolbar{display:flex;align-items:center;flex-wrap:wrap;margin:0 0 20px;}',
      '#cbws-tv-screen .cbws-chip{display:inline-flex!important;align-items:center;background:#1d2b3b!important;color:#dce7f5!important;border-radius:9px!important;padding:10px 15px!important;margin:0 10px 8px 0!important;font-size:16px!important;font-weight:bold;line-height:1.15!important;white-space:nowrap;}',
      '#cbws-tv-screen .cbws-footer{flex:none;display:flex;align-items:center;justify-content:space-between;min-height:41px;padding:6px 3.8vw;background:#0b1320;border-top:1px solid #222d3c;font-size:13px;color:#91a0b2;letter-spacing:.2px;}',
      '#cbws-tv-screen .cbws-footer b{color:#e7effc;}',
      '#cbws-tv-native-toggle{position:fixed!important;bottom:16px!important;right:20px!important;z-index:2147482999!important;background:#142637!important;color:#a5fbec!important;border:2px solid #a5fbec!important;border-radius:9px!important;padding:12px 18px!important;font:700 17px Arial,sans-serif!important;}',
      'html.cbws-native-tv h1{font-size:clamp(28px,3.4vw,50px);line-height:1.15;}',
      'html.cbws-native-tv h2{font-size:clamp(22px,2.1vw,34px);line-height:1.2;}',
      'html.cbws-native-tv main input,html.cbws-native-tv main select,html.cbws-native-tv main button{font-size:18px;min-height:40px;}',
      '@media(max-width:1400px){#cbws-tv-screen .cbws-masthead{height:65px;min-height:65px;}#cbws-tv-screen .cbws-brand{font-size:23px;margin-right:2vw;}#cbws-tv-screen .cbws-nav a,#cbws-tv-screen .cbws-nav button{font-size:16px!important;padding:11px 13px!important;}#cbws-tv-screen .cbws-actions button{padding:10px 12px!important;font-size:14px!important;}#cbws-tv-screen .cbws-content{padding-top:20px;}#cbws-tv-screen .cbws-hero{min-height:224px;height:30vh;}#cbws-tv-screen .cbws-hero-copy{padding:20px 25px;}#cbws-tv-screen .cbws-hero h1{font-size:36px!important;}#cbws-tv-screen .cbws-card-name{font-size:16px!important;}#cbws-tv-screen .cbws-card-meta{font-size:13px!important;}}',
      '@media(max-width:900px){#cbws-tv-screen .cbws-brand{font-size:20px;margin-right:2vw;}#cbws-tv-screen .cbws-brand small{display:none;}#cbws-tv-screen .cbws-nav a,#cbws-tv-screen .cbws-nav button{font-size:14px!important;padding:10px!important;}#cbws-tv-screen .cbws-actions button{padding:9px!important;font-size:13px!important;margin-left:5px;}#cbws-tv-screen .cbws-hero{min-height:200px;}#cbws-tv-screen .cbws-hero h1{font-size:30px!important;}#cbws-tv-screen .cbws-hero-meta{font-size:15px;}#cbws-tv-screen .cbws-grid .cbws-card{width:calc(25% - 15px);}#cbws-tv-screen .cbws-card{width:20vw;min-width:120px;}}'
    ].join('\n')+'\n'+"#cbws-tv-screen{flex-direction:row!important;background:#080e18!important;}\n#cbws-tv-screen .cbws-masthead{width:116px;height:100%!important;min-height:0!important;padding:22px 12px!important;flex-direction:column!important;justify-content:flex-start!important;align-items:stretch!important;border-bottom:0!important;border-right:1px solid #263242!important;background:#0b1420!important;flex:none!important;}\n#cbws-tv-screen .cbws-brand{flex-direction:column;justify-content:center;margin:0 0 30px!important;gap:4px;padding:12px 0!important;letter-spacing:.2px!important;font-size:17px!important;text-align:center;}\n#cbws-tv-screen .cbws-brand .cbws-orbit{width:28px;height:28px;margin:0 0 7px!important;}\n#cbws-tv-screen .cbws-brand small{margin:0!important;font-size:10px!important;display:block!important;}\n#cbws-tv-screen .cbws-nav{flex:1;flex-direction:column!important;align-items:stretch!important;justify-content:center;height:auto!important;white-space:normal!important;}\n#cbws-tv-screen .cbws-nav a,#cbws-tv-screen .cbws-nav button{display:flex!important;flex-direction:column;align-items:center;justify-content:center;margin:0 0 11px!important;min-height:73px;padding:9px 4px!important;font-size:13px!important;line-height:1.05!important;}\n#cbws-tv-screen .cbws-nav-icon{font-size:24px;font-weight:700;line-height:1;margin-bottom:7px;}\n#cbws-tv-screen .cbws-nav .is-current{border-left:3px solid #a5fbec!important;background:#263849!important;color:#e0fff8!important;}\n#cbws-tv-screen .cbws-actions{flex-direction:column;align-items:stretch!important;margin-top:auto!important;}\n#cbws-tv-screen .cbws-actions button{margin:6px 0 0!important;padding:11px 3px!important;font-size:12px!important;white-space:normal!important;}\n#cbws-tv-screen .cbws-stage{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;}\n#cbws-tv-screen .cbws-content{padding:0 3vw 38px!important;position:relative;}\n#cbws-tv-screen .cbws-hero{min-height:330px;height:44vh;max-height:510px;margin:0 -3vw 8px!important;border:0!important;border-radius:0!important;background:#132334;}\n#cbws-tv-screen .cbws-hero-copy{padding:36px 3vw 46px!important;width:62%;z-index:3;}\n#cbws-tv-screen .cbws-hero h1{font-size:53px!important;line-height:1.02!important;letter-spacing:-1.6px;}\n#cbws-tv-screen .cbws-hero-meta{margin-bottom:13px!important;}\n#cbws-tv-screen .cbws-hero-description{max-width:92%;font-size:18px!important;line-height:1.35!important;color:#c6d6e1!important;margin:0 0 17px!important;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;}#cbws-tv-screen .cbws-hero-description:empty{display:none!important;}\n#cbws-tv-screen .cbws-hero-art{width:76%;background:linear-gradient(115deg,#0e1d2b,#243848);}\n#cbws-tv-screen .cbws-hero-art:after{z-index:2;background:linear-gradient(90deg,#152435 0%,rgba(13,23,36,.67) 24%,rgba(9,17,26,.05) 76%),linear-gradient(0deg,#080e18 0%,rgba(8,14,24,0) 30%);}\n#cbws-tv-screen .cbws-hero-art .cbws-placeholder,#cbws-tv-screen .cbws-detail-backdrop .cbws-placeholder{display:none!important;}\n#cbws-tv-screen .cbws-section{margin:15px 0 5px;}\n#cbws-tv-screen .cbws-rail{padding:9px 7px 19px!important;}\n#cbws-tv-screen .cbws-card{width:14.5vw;max-width:242px!important;min-width:140px;}\n#cbws-tv-screen .cbws-card.cbws-tv-focus{transform:scale(1.025);transition:transform .12s ease-out;position:relative;}\n#cbws-tv-screen .cbws-poster{padding-bottom:144%;}\n#cbws-tv-screen .cbws-rating{z-index:4;}\n#cbws-tv-screen .cbws-page-title{margin-top:30px!important;}\n#cbws-tv-screen .cbws-footer{padding-left:3vw!important;padding-right:3vw!important;}\n#cbws-tv-screen .cbws-detail-hero{position:relative;min-height:64vh;display:flex;align-items:center;overflow:hidden;margin:0 -3vw 20px!important;background:linear-gradient(115deg,#101a28,#172b3e);}\n#cbws-tv-screen .cbws-detail-backdrop{position:absolute;top:0;bottom:0;right:0;width:80%;overflow:hidden;}\n#cbws-tv-screen .cbws-detail-backdrop img{position:absolute;top:0;left:0;width:100%!important;height:100%!important;object-fit:cover!important;object-position:center center;}\n#cbws-tv-screen .cbws-detail-backdrop:after{content:\"\";position:absolute;inset:0;top:0;left:0;right:0;bottom:0;z-index:2;background:linear-gradient(90deg,#101a28 0%,rgba(13,24,38,.82) 24%,rgba(8,14,24,.28) 80%),linear-gradient(0deg,#080e18 0%,rgba(8,14,24,0) 36%);}\n#cbws-tv-screen .cbws-detail-copy{position:relative;z-index:3;width:68%;padding:42px 3vw 56px;}\n#cbws-tv-screen .cbws-detail-title{font-size:65px!important;line-height:1.04!important;letter-spacing:-1.8px!important;color:#fff!important;max-width:100%;margin:0 0 19px!important;font-weight:850!important;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}\n#cbws-tv-screen .cbws-detail-meta{font-size:20px!important;color:#afc9d6!important;margin:0 0 24px!important;}\n#cbws-tv-screen .cbws-detail-description{font-size:21px!important;line-height:1.45!important;max-width:95%;color:#d3deea!important;margin:0 0 29px!important;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:5;overflow:hidden;}\n#cbws-tv-screen .cbws-detail-actions{display:flex;align-items:center;flex-wrap:wrap;}\n#cbws-tv-screen .cbws-detail-actions button{margin:0 12px 12px 0!important;}\n#cbws-tv-screen .cbws-detail-actions .cbws-primary{min-width:180px!important;padding:18px 26px!important;font-size:22px!important;}\n#cbws-tv-screen .cbws-detail-actions .cbws-secondary{padding:18px 20px!important;font-size:18px!important;}\n#cbws-tv-screen .cbws-back-link{border-radius:8px!important;background:transparent!important;color:#b7cbd9!important;font-size:16px!important;padding:12px!important;}\n#cbws-tv-screen .cbws-detail-poster{position:absolute;right:4vw;top:16%;width:21%;height:68%;max-height:460px;overflow:hidden;border-radius:13px;z-index:3;border:1px solid rgba(255,255,255,.16);background:#1b2e42;box-shadow:0 18px 55px rgba(0,0,0,.48);}\n#cbws-tv-screen .cbws-detail-poster img{position:absolute;top:0;left:0;width:100%!important;height:100%!important;object-fit:cover!important;}\n#cbws-tv-player-toggle{position:fixed!important;bottom:16px!important;right:150px!important;z-index:2147482999!important;background:#142637!important;color:#a5fbec!important;border:2px solid #a5fbec!important;border-radius:9px!important;padding:12px 18px!important;font:700 17px Arial,sans-serif!important;}\nhtml.cbws-theatre-active,html.cbws-theatre-active body{overflow:hidden!important;background:#000!important;}\nhtml.cbws-theatre-active .cbws-theatre-ancestor{z-index:auto!important;overflow:visible!important;transform:none!important;filter:none!important;perspective:none!important;contain:none!important;isolation:auto!important;opacity:1!important;will-change:auto!important;}\n.cbws-theatre-media{position:fixed!important;display:block!important;visibility:visible!important;top:66px!important;left:0!important;right:auto!important;bottom:auto!important;width:100vw!important;height:calc(100vh - 154px)!important;max-width:none!important;max-height:none!important;min-height:0!important;margin:0!important;padding:0!important;border:0!important;transform:none!important;z-index:2147482500!important;background:#000!important;object-fit:contain!important;}\n#cbws-tv-player-ui{position:static!important;font:18px Arial,Helvetica,sans-serif!important;color:#f5f7fa!important;}\n#cbws-tv-player-ui .cbws-theatre-background{position:fixed!important;top:0;left:0;right:0;bottom:0;background:#000!important;z-index:2147482000!important;pointer-events:none;}\n#cbws-tv-player-ui .cbws-player-top,#cbws-tv-player-ui .cbws-player-bottom{position:fixed!important;left:0!important;right:0!important;z-index:2147483001!important;background:#0b1421!important;color:#f3f6fb!important;box-sizing:border-box!important;padding:11px 2.8vw!important;}\n#cbws-tv-player-ui .cbws-player-top{top:0;height:66px;display:flex;align-items:center;}\n#cbws-tv-player-ui .cbws-player-bottom{bottom:0;min-height:88px;}\n#cbws-tv-player-ui .cbws-player-title{font-size:23px!important;margin:0 0 0 20px!important;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n#cbws-tv-player-ui .cbws-player-badge{font-size:13px;color:#a5fbec;letter-spacing:2px;}\n#cbws-tv-player-ui .cbws-player-controls{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;}\n#cbws-tv-player-ui .cbws-player-button{display:inline-flex!important;justify-content:center;align-items:center;min-height:42px!important;border:0!important;border-radius:8px!important;background:#26374b!important;color:#e9f3fa!important;padding:10px 17px!important;font:700 17px Arial,sans-serif!important;margin:2px 6px!important;cursor:pointer!important;}\n#cbws-tv-player-ui .cbws-player-primary{background:#a5fbec!important;color:#142735!important;}\n#cbws-tv-player-ui .cbws-player-button:focus,#cbws-tv-player-ui .cbws-tv-focus{outline:3px solid #a5fbec!important;outline-offset:3px!important;box-shadow:0 0 0 6px rgba(165,251,236,.17)!important;}\n#cbws-tv-player-ui .cbws-player-progress{display:flex;align-items:center;justify-content:center;font-size:14px!important;padding-bottom:5px;}\n#cbws-tv-player-ui .cbws-player-progress input{width:75%;margin:0 16px!important;accent-color:#a5fbec;}\n#cbws-tv-player-ui .cbws-player-note{font-size:13px!important;text-align:center;color:#9caec2!important;margin:6px 0 0!important;}\n@media(max-width:1400px){#cbws-tv-screen .cbws-masthead{width:88px;padding:14px 8px!important;}#cbws-tv-screen .cbws-brand{font-size:14px!important;margin-bottom:18px!important;}#cbws-tv-screen .cbws-nav a{min-height:61px;margin-bottom:6px!important;}#cbws-tv-screen .cbws-nav-icon{font-size:21px;}#cbws-tv-screen .cbws-hero{min-height:260px;height:44vh;}#cbws-tv-screen .cbws-hero h1{font-size:42px!important;}#cbws-tv-screen .cbws-detail-title{font-size:49px!important;}#cbws-tv-screen .cbws-detail-description{font-size:17px!important;}#cbws-tv-screen .cbws-detail-meta{font-size:17px!important;}#cbws-tv-screen .cbws-detail-copy{padding-top:30px;padding-bottom:36px;}#cbws-tv-screen .cbws-detail-actions .cbws-primary{font-size:19px!important;padding:14px 20px!important;}#cbws-tv-screen .cbws-detail-actions .cbws-secondary{font-size:16px!important;padding:14px 16px!important;}}\n@media(max-width:900px){#cbws-tv-screen .cbws-masthead{width:68px!important;padding:8px 5px!important;}#cbws-tv-screen .cbws-brand{font-size:11px!important;}#cbws-tv-screen .cbws-nav a{font-size:11px!important;min-height:48px;}#cbws-tv-screen .cbws-nav-icon{font-size:17px;margin-bottom:3px;}#cbws-tv-screen .cbws-hero{min-height:220px;}#cbws-tv-screen .cbws-hero h1{font-size:34px!important;}#cbws-tv-screen .cbws-card{width:20vw;min-width:115px;}#cbws-tv-screen .cbws-detail-title{font-size:37px!important;}#cbws-tv-screen .cbws-detail-description{font-size:15px!important;}#cbws-tv-screen .cbws-actions button{font-size:10px!important;}}\n";
    function element(tag, cls, value){
      var e=document.createElement(tag);
      if(cls)e.className=cls;
      if(value!==undefined && value!==null)e.textContent=String(value);
      return e;
    }
    function add(parent,tag,cls,value){var e=element(tag,cls,value);parent.appendChild(e);return e;}
    function button(parent,cls,label,fn){
      var b=add(parent,'button',cls,label);
      b.type='button';b.addEventListener('click',fn);
      return b;
    }
    function link(parent,cls,label,url){
      var a=add(parent,'a',cls,label);
      a.href=url;
      return a;
    }
    function routeOf(a){
      if(!a || !a.hostname || !/^(www\.)?cineby\.ws$/i.test(a.hostname) || !/^https?:$/i.test(a.protocol))return '';
      return a.pathname;
    }
    function imageUrl(value){
      if(typeof value!=='string')return '';
      value=value.trim();
      if(!value || /^(javascript:|#)/i.test(value))return '';
      if(/^blob:https?:\/\/(?:www\.)?cineby\.ws\//i.test(value))return value;
      if(/^data:image\/(?:png|jpe?g|webp|gif|avif);base64,/i.test(value))return value.length>1000 && value.length<1500000?value:'';
      if(/^(data:|blob:)/i.test(value))return '';
      if(!/^https?:/i.test(value) && value.indexOf('/')<0 && !/\.(?:png|jpe?g|webp|avif|gif|svg)(?:[?#]|$)/i.test(value))return '';
      var a=document.createElement('a');a.href=value;
      if(!/^https?:$/i.test(a.protocol))return '';
      if(/(?:placeholder|spacer|transparent|loading|pixel)[._-]/i.test(a.pathname))return '';
      return a.href;
    }
    function artworkCandidates(node, neighbour){
      var results=[],seen={};
      var props=['data-src','data-lazy-src','data-original','data-original-src','data-lazy','data-lazyload','data-image','data-poster','data-bg','data-background','data-cover','data-background-image','data-image-url','data-img','data-img-src','data-thumb','data-thumbnail','data-lazy-background'];
      var elementSelector='img,source,[data-src],[data-original],[data-lazy-src],[data-lazy],[data-srcset],[data-bg],[data-background],[data-image],[data-poster],[data-cover],[data-background-image],[data-img],[data-thumbnail],[data-lazy-background],[style],[class*="poster"],[class*="thumb"],[class*="cover"]';
      function remember(value,policy){
        if(typeof value==='string'){var wrapped=value.match(/^url\(\s*['"]?([^'"\)]+)['"]?\s*\)$/i);if(wrapped)value=wrapped[1];}
        var url=imageUrl(value);
        if(url && !seen[url]){seen[url]=true;results.push({url:url,policy:policy||''});}
      }
      function fromSet(set,policy){
        if(!set)return;
        // Prefer a still image sized for the TV card; other declared variants
        // remain available in case the preferred native image fails to load.
        var candidates=set.split(','), choices=[];
        for(var i=0;i<candidates.length;i++){
          var parts=candidates[i].trim().split(/\s+/);
          if(parts[0])choices.push({url:parts[0],size:parseInt(parts[1],10)||400});
        }
        choices.sort(function(a,b){return Math.abs(a.size-480)-Math.abs(b.size-480);});
        for(var j=0;j<choices.length;j++)remember(choices[j].url,policy);
      }
      function scan(el,compute){
        if(!el || !el.getAttribute)return;
        var policy=el.getAttribute('referrerpolicy')||'';
        for(var i=0;i<props.length;i++)remember(el.getAttribute(props[i]),policy);
        if(el.tagName==='IMG'||el.tagName==='SOURCE'){
          fromSet(el.getAttribute('data-srcset'),policy);
          remember(el.currentSrc,policy);
          fromSet(el.getAttribute('srcset'),policy);
          remember(el.getAttribute('src'),policy);
        }
        var bg=el.style&&el.style.backgroundImage;
        if(compute && (!bg || bg==='none')){
          try{bg=window.getComputedStyle(el).backgroundImage;}catch(ignore){}
        }
        if(bg){
          var re=/url\(\s*['"]?([^"'\)]+)['"]?\s*\)/ig, match;
          while((match=re.exec(bg)))remember(match[1],policy);
        }
      }
      function scanScope(el){
        if(!el)return;
        scan(el,true);
        var elements=el.querySelectorAll(elementSelector);
        var limit=Math.min(elements.length,30);
        for(var i=0;i<limit;i++)scan(elements[i],true);
      }
      scanScope(node);
      // Some catalogue cards put the artwork beside the title link. Only
      // consider a nearby wrapper when its title links represent one item.
      if(neighbour && node && isTitlePath(routeOf(node))){
        var p=node.parentElement;
        for(var n=0;p && n<2 && p!==document.body;n++,p=p.parentElement){
          var links=p.querySelectorAll('a[href]'), different=false;
          for(var q=0;q<links.length;q++)if(isTitlePath(routeOf(links[q])) && links[q].href!==node.href){different=true;break;}
          if(different)break;
          scanScope(p);
          if(results.length)break;
        }
      }
      return results;
    }
    function titleFor(a) {
      if(!isTitlePath(routeOf(a)))return null;
      var parsed=cardText(a.innerText || a.textContent);
      var img=a.querySelector('img');
      var alt=img && (img.getAttribute('alt')||'').trim();
      var explicit=(a.getAttribute('title')||a.getAttribute('aria-label')||'').trim();
      var name=alt && !/^(image|poster|thumbnail|play episode|play|logo)$/i.test(alt)?cardText(alt).title:'';
      if(!name && explicit)name=cardText(explicit).title;
      if(!name)name=parsed.title;
      if(!name || name.length>160 || /^(play(?:\s+s\d+e\d+)?|see more|watch|watch now|latest|\d+)$/i.test(name))return null;
      var images=artworkCandidates(a,true);
      return {title:name,path:a.href,images:images,url:images.length?images[0].url:'',year:parsed.year,rating:parsed.rating,episode:parsed.episode,type:routeOf(a).indexOf('/movie/')===0?'Movie':'Series'};
    }
    function mergeImages(first,second){
      var seen={},out=[],all=(first||[]).concat(second||[]);
      for(var i=0;i<all.length;i++)if(!seen[all[i].url]){seen[all[i].url]=true;out.push(all[i]);}
      return out;
    }
    function collect() {
      var path=window.location.pathname.replace(/\/$/,'') || '/';
      var home=path==='/'||path==='/home';
      var groups=[], group=null, names={};
      function createGroup(label){
        if(names[label])return names[label];
        var g={label:label,items:[],seen:{}};
        names[label]=g;groups.push(g);return g;
      }
      group=createGroup(home?'Explore':path==='/movies'?'Movies':path==='/tv'?'Series':path==='/my-room'?'My shelf':'Search results');
      var nodes=document.querySelectorAll('h2,a[href]');
      for(var i=0;i<nodes.length;i++){
        var node=nodes[i];
        if(root && root.contains(node))continue;
        if(home && node.tagName==='H2'){
          var l=sectionLabel(node.textContent);
          if(l)group=createGroup(l);
        } else if(node.tagName==='A'){
          var card=titleFor(node);
          if(!card)continue;
          if(group.seen[card.path]){
            var existing=group.seen[card.path];existing.images=mergeImages(existing.images,card.images);existing.url=existing.images.length?existing.images[0].url:'';continue;
          }
          group.seen[card.path]=card;group.items.push(card);
        }
      }
      var output=[];
      for(var j=0;j<groups.length;j++)if(groups[j].items.length>= (home?2:1)) output.push(groups[j]);
      return output;
    }
    function clearFocus(){
      if(active)active.classList.remove(focusClass);
      active=null;dirty=true;
    }
    function removeModeButton(){
      if(openModeButton && openModeButton.parentNode)openModeButton.parentNode.removeChild(openModeButton);
      openModeButton=null;
    }
    function unmount(){
      if(root && root.parentNode)root.parentNode.removeChild(root);
      root=null;mountedUrl='';artFrames=[];heroRefs=null;
      if(artRefreshTimer){clearTimeout(artRefreshTimer);artRefreshTimer=0;}
      clearFocus();
    }
    function showModeButton(){
      if(openModeButton && openModeButton.parentNode)return;
      openModeButton=button(document.body,'','TV view',function(){
        suppressed='';stopPlayerWait();removeModeButton();removePlayerModeButton();update();ensureActive();
      });
      openModeButton.id='cbws-tv-native-toggle';
    }
    function nativeMode(search){
      suppressed=window.location.href;
      unmount();showModeButton();
      if(search){
        var input=document.querySelector('input[placeholder*="Search"],input[type="search"],input[name="q"],input[name="search"]');
        if(input && isVisible(input)){
          setActive(input,false);input.focus();
          try{input.click();}catch(ignore){}
          reveal(input);
        }else hint('Use the original site search');
      }else{ensureActive();if(isTitlePath(window.location.pathname))offerPlayer();}
    }
    function applyArt(frameState) {
      if(frameState.ready || frameState.loading || !frameState.frame.parentNode)return;
      var choices=frameState.card.images||[];
      for(var i=0;i<choices.length;i++){
        var choice=choices[i];
        if(frameState.attempted[choice.url])continue;
        frameState.attempted[choice.url]=true;
        var img=element('img','cbws-art-image');
        img.alt=frameState.card.title;
        img.setAttribute('loading','eager');
        img.setAttribute('decoding','async');
        if(choice.policy)img.setAttribute('referrerpolicy',choice.policy);
        frameState.loading=true;
        img.addEventListener('load',function(){
          frameState.ready=true;frameState.loading=false;
          frameState.frame.classList.add('cbws-art-ready');
        });
        img.addEventListener('error',function(){
          frameState.loading=false;
          if(img.parentNode)img.parentNode.removeChild(img);
          applyArt(frameState);
        });
        frameState.frame.appendChild(img);
        img.src=choice.url;
        return;
      }
    }
    function addImage(frame,card){
      add(frame,'span','cbws-placeholder',card.title);
      if(!card.images && card.url)card.images=[{url:card.url,policy:''}];
      var state={frame:frame,card:card,attempted:{},loading:false,ready:false};
      artFrames.push(state);applyArt(state);
    }
    function refreshArt(){
      var pending=false;
      for(var i=0;i<artFrames.length;i++)if(!artFrames[i].ready && !artFrames[i].loading){pending=true;break;}
      if(!pending)return;
      var now=Date.now();
      if(now-lastArtRefresh<1050){
        if(!artRefreshTimer)artRefreshTimer=setTimeout(function(){artRefreshTimer=0;refreshArt();},1100);
        return;
      }
      lastArtRefresh=now;
      var groups=collect(), found={};
      for(var j=0;j<groups.length;j++)for(var k=0;k<groups[j].items.length;k++){
        var card=groups[j].items[k];
        found[card.path]=mergeImages(found[card.path],card.images);
      }
      // Detail poster and backdrop use the native artwork for that title.
      var detail=isTitlePath(window.location.pathname)?readDetail():null;
      for(var n=0;n<artFrames.length;n++){
        var state=artFrames[n];
        if(state.ready||state.loading)continue;
        var additional=found[state.card.path];
        if(state.card.artRole==='hero')additional=mergeImages(additional,heroArtwork(state.card).images);
        if(detail && state.card.path===detail.card.path)additional=state.card.artRole==='backdrop'?detail.backdrop:detail.card.images;
        state.card.images=mergeImages(state.card.images,additional);applyArt(state);
      }
    }
    function metadata(card){
      return [card.type,card.year,card.episode].filter(function(v){return !!v;}).join('  ·  ');
    }
    function tile(parent,card){
      var a=link(parent,'cbws-card',null,card.path);
      a.setAttribute('aria-label',card.title);
      a._cbwsCard=card;
      var poster=add(a,'div','cbws-poster');
      addImage(poster,card);
      if(card.rating)add(poster,'span','cbws-rating','★ '+card.rating);
      var body=add(a,'div','cbws-card-body');
      add(body,'span','cbws-card-name',card.title);
      add(body,'span','cbws-card-meta',metadata(card));
    }
    function addHeader(screen,currentPath){
      var head=add(screen,'header','cbws-masthead');
      var brand=link(head,'cbws-brand',null,'/home');
      add(brand,'span','cbws-orbit');
      add(brand,'span','','CINEBY');
      add(brand,'small','','TV');
      var nav=add(head,'nav','cbws-nav');
      var items=[['Home','/home','⌂'],['Movies','/movies','▰'],['Series','/tv','▣'],['My shelf','/my-room','◇']];
      for(var i=0;i<items.length;i++){
        var cls=currentPath===items[i][1] || (currentPath==='/'&&i===0)?'is-current':'';
        var navLink=link(nav,cls,null,items[i][1]);
        add(navLink,'span','cbws-nav-icon',items[i][2]);add(navLink,'span','',items[i][0]);
        navLink.setAttribute('aria-label',items[i][0]);
      }
      var actions=add(head,'div','cbws-actions');
      button(actions,'','Search',function(){nativeMode(true);});
      button(actions,'','Site view',function(){nativeMode(false);});
    }
    function addHero(content,card){
      var hero=add(content,'section','cbws-hero');
      var copy=add(hero,'div','cbws-hero-copy');
      add(copy,'span','cbws-kicker','DISCOVER  /  CINEBY TV');
      var name=add(copy,'h1','',card.title);
      var meta=add(copy,'p','cbws-hero-meta',metadata(card)+(card.rating?'  ·  ★ '+card.rating:''));
      var desc=add(copy,'p','cbws-hero-description',heroDescription(card));
      var actions=add(copy,'div','cbws-hero-buttons');
      var primary=link(actions,'cbws-primary','Open details  →',card.path);
      var secondary=link(actions,'cbws-secondary','Browse '+(card.type==='Movie'?'movies':'series'),card.type==='Movie'?'/movies':'/tv');
      var art=add(hero,'div','cbws-hero-art');
      addImage(art,heroArtwork(card));
      heroRefs={title:name,meta:meta,desc:desc,primary:primary,secondary:secondary,art:art,path:card.path};
    }
    function heroDescription(card){
      var images=document.querySelectorAll('img');
      for(var i=0;i<images.length;i++){
        var image=images[i];
        if(root&&root.contains(image))continue;
        if((image.getAttribute('alt')||'').trim().toLowerCase()!==card.title.toLowerCase())continue;
        var parent=image.parentElement;
        for(var level=0;parent&&parent!==document.body&&level<4;level++,parent=parent.parentElement){
          var links=parent.querySelectorAll('a[href]'), matched=false, other=false;
          for(var k=0;k<links.length;k++){
            if(isTitlePath(routeOf(links[k]))){
              if(links[k].href===card.path)matched=true;
              else other=true;
            }
          }
          if(other)break;
          if(!matched)continue;
          var paragraphs=parent.querySelectorAll('p');
          for(var j=0;j<paragraphs.length;j++){
            var t=nativeText(paragraphs[j]);
            if(t.length>45&&!/disclaimer|indexing service/i.test(t))return t.slice(0,300);
          }
        }
      }
      return '';
    }
    function heroArtwork(card){
      var pictures=document.querySelectorAll('img'), wide=[];
      for(var i=0;i<pictures.length;i++){
        var el=pictures[i];
        if(root&&root.contains(el))continue;
        var alt=(el.getAttribute('alt')||'').trim().toLowerCase();
        if(alt!==card.title.toLowerCase())continue;
        var r=el.getBoundingClientRect(),w=el.naturalWidth||r.width,hh=el.naturalHeight||r.height;
        if(w>=hh*1.3)wide=mergeImages(wide,artworkCandidates(el,false));
      }
      return {title:card.title,path:card.path,images:mergeImages(wide,card.images),artRole:'hero'};
    }
    function focusHero(el){
      if(!heroRefs||!el||!el._cbwsCard||heroRefs.path===el._cbwsCard.path)return;
      var card=el._cbwsCard;heroRefs.path=card.path;
      heroRefs.title.textContent=card.title;
      heroRefs.meta.textContent=metadata(card)+(card.rating?'  ·  ★ '+card.rating:'');
      heroRefs.desc.textContent=heroDescription(card);
      heroRefs.primary.href=card.path;
      heroRefs.secondary.href=card.type==='Movie'?'/movies':'/tv';
      heroRefs.secondary.textContent='Browse '+(card.type==='Movie'?'movies':'series');
      var previous=heroRefs.art,container=previous.parentNode;
      if(container){
        container.removeChild(previous);
        artFrames=artFrames.filter(function(frame){return frame.frame!==previous;});
        heroRefs.art=add(container,'div','cbws-hero-art');
        addImage(heroRefs.art,heroArtwork(card));
      }
    }
    function addFooter(stage){
      var footer=add(stage,'footer','cbws-footer');
      add(footer,'span','','↑ ↓ ← →  Navigate     ·     OK  Select     ·     Back  Return');
      add(footer,'span','','TV EDITION  1.2  /  CINEBY.WS');
    }
    function pageLinks(currentPath) {
      var out=[], seen={};
      var all=document.querySelectorAll('a[href]');
      for(var i=0;i<all.length;i++){
        var a=all[i], text=(a.textContent||'').replace(/\s+/g,' ').trim();
        if(routeOf(a)!==currentPath || !/^(\d+|«|»|‹|›|Next|Previous|Most Recent|Top Watched|Top Rated)$/i.test(text))continue;
        if(seen[text] || a.href===window.location.href)continue;
        seen[text]=true;out.push({label:text,url:a.href});
      }
      return out;
    }
    function render(groups){
      var p=window.location.pathname.replace(/\/$/,'')||'/';
      var home=p==='/'||p==='/home';
      var catalog=p==='/movies'||p==='/tv';
      var pageNav=catalog?pageLinks(p):[];
      var screen=element('div','');
      screen.id=layoutId;screen.setAttribute('role','main');
      addHeader(screen,p);
      var stage=add(screen,'div','cbws-stage');
      var content=add(stage,'div','cbws-content');
      if(home){
        var featured=groups[0].items[0];
        for(var k=0;k<groups[0].items.length;k++)if(groups[0].items[k].url){featured=groups[0].items[k];break;}
        addHero(content,featured);
      }else{
        add(content,'h1','cbws-page-title',p==='/movies'?'Movies':p==='/tv'?'Series':p==='/my-room'?'My shelf':'Search results');
        var toolbar=add(content,'div','cbws-toolbar');
        if(catalog)button(toolbar,'cbws-chip','Genres and filters',function(){nativeMode(false);});
        for(var q=0;q<pageNav.length;q++)if(/Most Recent|Top Watched|Top Rated/i.test(pageNav[q].label))link(toolbar,'cbws-chip',pageNav[q].label,pageNav[q].url);
      }
      for(var i=0;i<groups.length;i++){
        var g=groups[i], section=add(content,'section','cbws-section');
        if(home){
          var head=add(section,'div','cbws-section-head');
          add(head,'h2','',g.label);
          add(head,'span','cbws-section-counter',g.items.length+' titles');
        }
        var row=add(section,'div',home?'cbws-rail':'cbws-grid');
        for(var j=0;j<g.items.length;j++)tile(row,g.items[j]);
      }
      if(catalog){
        var pagination=add(content,'div','cbws-toolbar');
        for(var n=0;n<pageNav.length;n++)if(/^(\d+|«|»|‹|›|Next|Previous)$/i.test(pageNav[n].label))link(pagination,'cbws-chip',pageNav[n].label,pageNav[n].url);
      }
      addFooter(stage);
      removeModeButton();removePlayerModeButton();
      document.body.appendChild(screen);
      root=screen;mountedUrl=window.location.href;
      clearFocus();
      var first=screen.querySelector('.cbws-card');if(first)setActive(first,false);
    }
    function nativeText(el){
      return el?String(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim():'';
    }
    function findNativeAction(pattern){
      var list=document.querySelectorAll('a[href],button,[role="button"]');
      var best=null;
      for(var i=0;i<list.length;i++){
        var el=list[i];
        if(root && root.contains(el) || playerUI && playerUI.contains(el))continue;
        var label=nativeText(el)||el.getAttribute('aria-label')||el.getAttribute('title')||'';
        if(pattern.test(label) && isVisible(el)){best=el;break;}
      }
      return best;
    }
    function readDetail(){
      var headings=document.querySelectorAll('h1'), h=null;
      for(var i=0;i<headings.length;i++){
        if(!(root&&root.contains(headings[i])) && nativeText(headings[i])){h=headings[i];break;}
      }
      if(!h)return null;
      var title=nativeText(h);
      if(title.length>180)return null;
      var type=window.location.pathname.indexOf('/movie/')===0?'Movie':'Series';
      var desc='',meta='',region=h.parentElement,near=h;
      // Pick the nearest detail container that includes a meaningful summary.
      for(var level=0;region && region!==document.body && level<6;level++,region=region.parentElement){
        var paragraphs=region.querySelectorAll('p');
        for(var j=0;j<paragraphs.length;j++){
          var t=nativeText(paragraphs[j]);
          if(t.length>=50 && !/disclaimer|indexing service|share with friends/i.test(t)){desc=t.slice(0,850);near=region;break;}
        }
        if(desc)break;
      }
      if(!desc){
        var pp=document.querySelectorAll('p');
        for(var z=0;z<pp.length;z++){
          if(root&&root.contains(pp[z]))continue;
          var text=nativeText(pp[z]);
          if(text.length>75 && !/disclaimer|indexing service|share with friends|cineby is a free/i.test(text)){desc=text.slice(0,850);break;}
        }
      }
      var detailText=nativeText(near);
      var year=(detailText.match(/\b(?:19|20)\d{2}\b/)||[])[0]||'';
      var runtime=(detailText.match(/\b\d+h\s*\d+m\b|\b\d{2,3}\s*min\b/i)||[])[0]||'';
      var seasons=(detailText.match(/\b\d+\s+Seasons?\b/i)||[])[0]||'';
      meta=[type,year,runtime||seasons].filter(function(x){return !!x;}).join('  ·  ');
      var poster=[],backdrop=[],images=document.querySelectorAll('img');
      var norm=title.toLowerCase().trim(), bestWide=0;
      for(var k=0;k<images.length;k++){
        var img=images[k];
        if(root&&root.contains(img))continue;
        var alt=(img.getAttribute('alt')||'').toLowerCase().trim();
        var rect=img.getBoundingClientRect(), w=img.naturalWidth||rect.width,hh=img.naturalHeight||rect.height;
        var art=artworkCandidates(img,false);
        if(!art.length)continue;
        var matches=alt===norm || alt===norm+' poster' || alt==='poster of '+norm;
        if(matches && (w<=hh*1.25 || !w || !hh))poster=mergeImages(poster,art);
        if(w>=hh*1.3 && rect.width>=window.innerWidth*.28 && rect.top<window.innerHeight*.75){
          var area=rect.width*rect.height;
          if(area>bestWide){bestWide=area;backdrop=art;}
        }
        if(matches && !poster.length)poster=mergeImages(poster,art);
      }
      // The native hero may use a CSS background instead of an image element.
      if(!backdrop.length){
        var n=h.parentElement;
        for(var p=0;n&&n!==document.body&&p<5;p++,n=n.parentElement){
          var computed='';
          try{computed=window.getComputedStyle(n).backgroundImage;}catch(ignore){}
          if(computed && /url\(/.test(computed)){
            var a=artworkCandidates(n,false);
            if(a.length){backdrop=a;break;}
          }
        }
      }
      if(!poster.length)poster=artworkCandidates(near,false);
      if(!backdrop.length)backdrop=poster.slice(0);
      var play=findNativeAction(/^(?:▶\s*)?(?:play(?:\s+now|\s+s\d+\s*e\d+)?|watch now|start watching|continue watching)(?:\s*▶)?$/i);
      var latest=findNativeAction(/^latest(?:\s+s\d+\s*e\d+)?$/i);
      return {card:{title:title,path:window.location.href,type:type,year:year,episode:'',rating:'',images:poster,url:poster.length?poster[0].url:'',description:desc,meta:meta},backdrop:backdrop,play:play,latest:latest};
    }
    function detailNativeSection(searchForEpisodes){
      nativeMode(false);
      if(!searchForEpisodes)return;
      var hh=document.querySelectorAll('h2,h3');
      for(var i=0;i<hh.length;i++){
        if(/^episodes$/i.test(nativeText(hh[i]))){
          try{hh[i].scrollIntoView({block:'start'});}catch(err){hh[i].scrollIntoView(true);}
          break;
        }
      }
    }
    function returnFromDetail(){
      if(window.history && window.history.length>1)window.history.back();
      else window.location.href='/home';
    }
    function renderDetail(detail){
      var p=window.location.pathname;
      var screen=element('div','cbws-detail-screen');screen.id=layoutId;screen.setAttribute('role','main');
      addHeader(screen,p);
      var stage=add(screen,'div','cbws-stage'),content=add(stage,'div','cbws-content');
      var hero=add(content,'section','cbws-detail-hero');
      var bg=add(hero,'div','cbws-detail-backdrop');
      addImage(bg,{title:detail.card.title,path:detail.card.path,images:detail.backdrop,artRole:'backdrop'});
      var copy=add(hero,'div','cbws-detail-copy');
      add(copy,'div','cbws-kicker',detail.card.type==='Movie'?'CINEBY  /  FEATURE FILM':'CINEBY  /  SERIES');
      add(copy,'h1','cbws-detail-title',detail.card.title);
      add(copy,'p','cbws-detail-meta',detail.card.meta);
      if(detail.card.description)add(copy,'p','cbws-detail-description',detail.card.description);
      var actions=add(copy,'div','cbws-detail-actions');
      button(actions,'cbws-primary','▶  '+(detail.play?nativeText(detail.play).replace(/^▶\s*/,''):'Watch'),function(){beginPlay(detail.play);});
      if(detail.latest)button(actions,'cbws-secondary',nativeText(detail.latest),function(){beginPlay(detail.latest);});
      if(detail.card.type==='Series')button(actions,'cbws-secondary','Episodes',function(){detailNativeSection(true);});
      button(actions,'cbws-secondary','Full details',function(){detailNativeSection(false);});
      button(actions,'cbws-back-link','←  Back to browse',returnFromDetail);
      if(detail.card.images.length){
        var poster=add(hero,'div','cbws-detail-poster');
        addImage(poster,detail.card);
      }
      var recommendations=collect(), seen={}, items=[];
      for(var i=0;i<recommendations.length;i++)for(var j=0;j<recommendations[i].items.length;j++){
        var card=recommendations[i].items[j];
        if(card.path.split(/[?#]/)[0]===window.location.href.split(/[?#]/)[0])continue;
        if(!seen[card.path]){seen[card.path]=true;items.push(card);}
      }
      if(items.length){
        var rowSection=add(content,'section','cbws-section');
        var rowHead=add(rowSection,'div','cbws-section-head');
        add(rowHead,'h2','','You may also like');
        var rail=add(rowSection,'div','cbws-rail');
        for(var n=0;n<items.length;n++)tile(rail,items[n]);
      }
      addFooter(stage);
      removeModeButton();removePlayerModeButton();document.body.appendChild(screen);root=screen;mountedUrl=window.location.href;
      clearFocus();
      // A detail screen opens with its main action selected, not the sidebar.
      if(actions.children.length)setActive(actions.children[0],false);
    }

    // Theatre mode never replaces, copies or reads the media stream. It
    // enlarges the existing player element and wraps it in a TV control bar.
    function findPlayer(){
      var list=document.querySelectorAll('video,iframe'),best=null,score=0;
      for(var i=0;i<list.length;i++){
        var el=list[i];
        if(root&&root.contains(el) || !isVisible(el))continue;
        var r=el.getBoundingClientRect(), area=r.width*r.height;
        if(r.width<260 || r.height<130 || r.width<r.height*1.05)continue;
        if(el.tagName==='IFRAME'){
          var context='', parent=el;
          for(var n=0;parent&&n<4;n++,parent=parent.parentElement){
            context+=' '+(parent.getAttribute('id')||'')+' '+(parent.getAttribute('class')||'')+' '+(parent.getAttribute('title')||'');
          }
          if(!/player|video|watch|embed/i.test(context) && r.width<window.innerWidth*.48)continue;
        }
        var rank=area*(el.tagName==='VIDEO'?2:1);
        if(rank>score){score=rank;best=el;}
      }
      return best;
    }
    function playerTime(seconds){
      if(!isFinite(seconds)||seconds<0)return '0:00';
      seconds=Math.floor(seconds);
      var m=Math.floor(seconds/60),s=seconds%60;
      return m+':'+(s<10?'0':'')+s;
    }
    function removePlayerModeButton(){
      if(playerModeButton&&playerModeButton.parentNode)playerModeButton.parentNode.removeChild(playerModeButton);
      playerModeButton=null;
    }
    function offerPlayer(){
      if(theatre || playerModeButton&&playerModeButton.parentNode)return;
      var el=findPlayer();
      if(!el)return;
      playerModeButton=button(document.body,'','TV player',function(){var player=findPlayer();if(player)startTheatre(player);});
      playerModeButton.id='cbws-tv-player-toggle';
    }
    function stopPlayerWait(){
      playRequest=null;
      if(playerTimer){clearTimeout(playerTimer);playerTimer=0;}
    }
    function waitForPlayer(){
      if(!playRequest)return;
      if(window.location.pathname!==playRequest.path && !/\/(?:watch|play)\b/i.test(window.location.pathname)){stopPlayerWait();return;}
      if(Date.now()>playRequest.until){stopPlayerWait();offerPlayer();return;}
      if(!playerTimer)playerTimer=setTimeout(function(){playerTimer=0;update();},450);
    }
    function beginPlay(control){
      var info=readDetail();
      var title=info?info.card.title:(document.title||'Cineby TV');
      playRequest={path:window.location.pathname,until:Date.now()+16000,title:title};
      suppressed=window.location.href;unmount();showModeButton();
      if(control&&typeof control.click==='function'){
        try{control.click();}catch(ignore){}
      }else{
        var candidate=findPlayer();
        if(candidate){startTheatre(candidate);return;}
        var placeholder=document.querySelector('img[alt="Play episode"],img[alt="Play movie"],[aria-label="Play"]');
        if(placeholder && isVisible(placeholder))try{placeholder.click();}catch(ignore){}
        else hint('Select Play or a source on the original page');
      }
      waitForPlayer();offerPlayer();
    }
    function fullscreenPlayer(el){
      var method=el.requestFullscreen||el.webkitRequestFullscreen||el.webkitRequestFullScreen;
      if(typeof method!=='function'){hint('Full-screen is unavailable on this player');return;}
      try{
        var result=method.call(el);
        if(result&&typeof result.catch==='function')result.catch(function(){hint('Use the player’s own fullscreen button');});
      }catch(err){hint('Use the player’s own fullscreen button');}
    }
    function closeTheatre(){
      if(!theatre)return false;
      var st=theatre;
      theatre=null;stopPlayerWait();
      if(st.media)st.media.classList.remove('cbws-theatre-media');
      for(var i=0;i<st.ancestors.length;i++)st.ancestors[i].classList.remove('cbws-theatre-ancestor');
      for(var j=0;j<st.listeners.length;j++)if(st.media.removeEventListener)st.media.removeEventListener(st.listeners[j][0],st.listeners[j][1]);
      if(playerUI&&playerUI.parentNode)playerUI.parentNode.removeChild(playerUI);
      playerUI=null;
      document.documentElement.classList.remove('cbws-theatre-active');
      suppressed=window.location.href;
      clearFocus();showModeButton();offerPlayer();ensureActive();
      return true;
    }
    function startTheatre(el){
      if(!el||theatre)return;
      var info=readDetail(),title=playRequest&&playRequest.title || info&&info.card.title || document.title || 'Cineby TV';
      stopPlayerWait();
      unmount();removeModeButton();removePlayerModeButton();
      theatre={media:el,path:window.location.pathname,ancestors:[],listeners:[]};
      var ancestor=el.parentElement;
      while(ancestor&&ancestor!==document.body&&ancestor!==document.documentElement){
        theatre.ancestors.push(ancestor);ancestor.classList.add('cbws-theatre-ancestor');ancestor=ancestor.parentElement;
      }
      document.documentElement.classList.add('cbws-theatre-active');
      el.classList.add('cbws-theatre-media');
      playerUI=element('div','');playerUI.id='cbws-tv-player-ui';
      var background=add(playerUI,'div','cbws-theatre-background');
      var top=add(playerUI,'div','cbws-player-top');
      button(top,'cbws-player-button','←  Back',closeTheatre);
      add(top,'strong','cbws-player-title',title);
      add(top,'span','cbws-player-badge','CINEBY TV  /  PLAYER');
      var bottom=add(playerUI,'div','cbws-player-bottom');
      if(el.tagName==='VIDEO'){
        var progress=add(bottom,'div','cbws-player-progress');
        var time=add(progress,'span','','0:00');
        var slider=add(progress,'input','');slider.type='range';slider.min='0';slider.max='1000';slider.value='0';slider.setAttribute('aria-label','Playback position');
        var duration=add(progress,'span','','0:00');
        var controls=add(bottom,'div','cbws-player-controls');
        button(controls,'cbws-player-button','↶ 10 s',function(){media('rewind');});
        var toggle=button(controls,'cbws-player-button cbws-player-primary','Play / Pause',function(){media('toggle');});
        button(controls,'cbws-player-button','10 s ↷',function(){media('forward');});
        button(controls,'cbws-player-button','Full screen',function(){fullscreenPlayer(el);});
        button(controls,'cbws-player-button','Site controls',closeTheatre);
        function updateStatus(){
          var length=el.duration,position=el.currentTime;
          time.textContent=playerTime(position);duration.textContent=playerTime(length);
          if(isFinite(length)&&length>0 && document.activeElement!==slider)slider.value=String(Math.round(position/length*1000));
          toggle.textContent=el.paused?'▶  Play':'Ⅱ  Pause';
        }
        slider.addEventListener('change',function(){if(isFinite(el.duration)&&el.duration>0)el.currentTime=Number(slider.value)/1000*el.duration;});
        ['timeupdate','loadedmetadata','play','pause'].forEach(function(event){el.addEventListener(event,updateStatus);theatre.listeners.push([event,updateStatus]);});
        updateStatus();
      }else{
        var row=add(bottom,'div','cbws-player-controls');
        button(row,'cbws-player-button cbws-player-primary','Player controls',function(){try{el.focus();}catch(ignore){}});
        button(row,'cbws-player-button','Full screen',function(){fullscreenPlayer(el);});
        button(row,'cbws-player-button','Original page',closeTheatre);
        add(bottom,'p','cbws-player-note','This embedded player keeps its own playback controls.');
      }
      document.body.appendChild(playerUI);
      clearFocus();ensureActive();
    }

    function update(){
      if(!document.body)return;
      if(!document.getElementById('cbws-layout-style')){
        var style=element('style','');style.id='cbws-layout-style';style.type='text/css';
        style.appendChild(document.createTextNode(CSS));
        (document.head||document.documentElement).appendChild(style);
      }
      document.documentElement.classList.add(nativeClass);
      var href=window.location.href;
      if(theatre){
        if(!contains(theatre.media) || window.location.pathname!==theatre.path){var changed=window.location.pathname!==theatre.path;closeTheatre();if(changed){suppressed='';removeModeButton();removePlayerModeButton();}}
        else return;
      }
      if(root && mountedUrl!==href)unmount();
      if(playRequest){
        var canWait=window.location.pathname===playRequest.path || /\/(?:watch|play)\b/i.test(window.location.pathname);
        if(canWait){
          suppressed=href;
          var mediaEl=findPlayer();
          if(mediaEl){startTheatre(mediaEl);return;}
          waitForPlayer();showModeButton();return;
        }else stopPlayerWait();
      }
      if(suppressed && suppressed!==href){suppressed='';removeModeButton();removePlayerModeButton();}
      if(suppressed===href){showModeButton();if(isTitlePath(window.location.pathname))offerPlayer();return;}
      if(root && root.parentNode){refreshArt();return;}
      if(isTitlePath(window.location.pathname)){
        var detail=readDetail();
        if(detail)renderDetail(detail);
        return;
      }
      if(!isBrowsePath(window.location.pathname)){if(root)unmount();removeModeButton();removePlayerModeButton();return;}
      var groups=collect();var count=0;
      for(var i=0;i<groups.length;i++)count+=groups[i].items.length;
      if(count<3)return;
      render(groups);
    }
    function getRoot(){return playerUI&&playerUI.parentNode?playerUI:root&&root.parentNode?root:null;}
    return {update:update,getRoot:getRoot,back:closeTheatre,focused:focusHero};

  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {directionalScore:directionalScore,pickNext:pickNext,keyAction:keyAction,isTitlePath:isTitlePath,isBrowsePath:isBrowsePath,cardText:cardText,sectionLabel:sectionLabel};
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
  var tvLayout = createTvLayout();

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
    var tvRoot=tvLayout.getRoot();
    if(tvRoot)return tvRoot;
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
    tvLayout.focused(active);
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
    if(tvLayout.back())return true;
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
      tvLayout.update();
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
      observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','aria-hidden','disabled','aria-disabled','aria-modal','src','srcset','data-src','data-srcset','data-original','data-bg','data-background','data-poster','style']});
    }
    tvLayout.update();
    ensureActive();
    hint('Пульт активен: стрелки · OK · Назад');
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
  else start();
})();
