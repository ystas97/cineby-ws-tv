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
    ].join('\n');
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
    function imageOf(img){
      if(!img)return '';
      var url=img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original') || img.currentSrc || img.getAttribute('src') || '';
      if(!url || /^data:/i.test(url))return '';
      var a=document.createElement('a');a.href=url;
      return /^https?:$/i.test(a.protocol)?a.href:'';
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
      return {title:name,path:a.href,url:imageOf(img),year:parsed.year,rating:parsed.rating,episode:parsed.episode,type:routeOf(a).indexOf('/movie/')===0?'Movie':'Series'};
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
          if(!card || group.seen[card.path])continue;
          group.seen[card.path]=true;group.items.push(card);
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
      root=null;mountedUrl='';
      clearFocus();
    }
    function showModeButton(){
      if(openModeButton && openModeButton.parentNode)return;
      openModeButton=button(document.body,'','TV view',function(){
        suppressed='';removeModeButton();update();ensureActive();
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
      }else ensureActive();
    }
    function addImage(frame,card){
      add(frame,'span','cbws-placeholder',card.title);
      if(!card.url)return;
      var img=add(frame,'img','');
      img.alt=card.title;img.src=card.url;
      img.addEventListener('error',function(){if(img.parentNode)img.parentNode.removeChild(img);});
    }
    function metadata(card){
      return [card.type,card.year,card.episode].filter(function(v){return !!v;}).join('  ·  ');
    }
    function tile(parent,card){
      var a=link(parent,'cbws-card',null,card.path);
      a.setAttribute('aria-label',card.title);
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
      var items=[['Home','/home'],['Movies','/movies'],['Series','/tv'],['My shelf','/my-room']];
      for(var i=0;i<items.length;i++){
        var cls=currentPath===items[i][1] || (currentPath==='/'&&i===0)?'is-current':'';
        link(nav,cls,items[i][0],items[i][1]);
      }
      var actions=add(head,'div','cbws-actions');
      button(actions,'','Search',function(){nativeMode(true);});
      button(actions,'','Site view',function(){nativeMode(false);});
    }
    function addHero(content,card){
      var hero=add(content,'section','cbws-hero');
      var copy=add(hero,'div','cbws-hero-copy');
      add(copy,'span','cbws-kicker','FEATURED ON CINEBY');
      add(copy,'h1','',card.title);
      add(copy,'p','cbws-hero-meta',metadata(card)+(card.rating?'  ·  ★ '+card.rating:''));
      var actions=add(copy,'div','cbws-hero-buttons');
      link(actions,'cbws-primary','Open details  →',card.path);
      link(actions,'cbws-secondary','Browse '+(card.type==='Movie'?'movies':'series'),card.type==='Movie'?'/movies':'/tv');
      var art=add(hero,'div','cbws-hero-art');
      addImage(art,card);
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
      var content=add(screen,'div','cbws-content');
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
      var footer=add(screen,'footer','cbws-footer');
      add(footer,'span','','↑ ↓ ← →  Navigate     ·     OK  Select     ·     Back  Return');
      add(footer,'span','','TV EDITION  /  CINEBY.WS');
      removeModeButton();
      document.body.appendChild(screen);
      root=screen;mountedUrl=window.location.href;
      clearFocus();
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
      if(root && mountedUrl!==href)unmount();
      if(suppressed && suppressed!==href){suppressed='';removeModeButton();}
      if(suppressed===href){showModeButton();return;}
      if(!isBrowsePath(window.location.pathname)){if(root)unmount();removeModeButton();return;}
      if(root && root.parentNode)return;
      // If the original page isn't populated yet, leave it usable and try
      // again on the next mutation. Never hide a failed or empty page.
      var groups=collect();var count=0;
      for(var i=0;i<groups.length;i++)count+=groups[i].items.length;
      if(count<3)return;
      render(groups);
    }
    function getRoot(){return root && root.parentNode?root:null;}
    return {update:update,getRoot:getRoot};
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
      observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','aria-hidden','disabled','aria-disabled','aria-modal']});
    }
    tvLayout.update();
    ensureActive();
    hint('Пульт активен: стрелки · OK · Назад');
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
  else start();
})();
