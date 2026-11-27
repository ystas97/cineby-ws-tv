const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const source=readFileSync(path.join(__dirname,'../remote.js'),'utf8');
function pageFixture(options={}){
  let document;
  const all=(e)=>e.children.flatMap(c=>[c,...all(c)]);
  class Node {
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs={};this.style={};this.className='';this._text='';this.listeners={};this.id='';this.hidden=false;this.disabled=false;this.type='';}
    get textContent(){return this._text+this.children.map(c=>c.textContent).join(' ');}
    set textContent(v){this._text=String(v);this.children=[];}
    get innerText(){return this.textContent;}
    get parentElement(){return this.parentNode;}
    get classList(){const node=this;return{contains(c){return node.className.split(/\s+/).includes(c);},add(c){if(!this.contains(c))node.className=(node.className+' '+c).trim();},remove(c){node.className=node.className.split(/\s+/).filter(v=>v!==c).join(' ');}};}
    set href(v){this._href=new URL(v,'https://cineby.ws/home');}
    get href(){return this._href?this._href.href:'';}
    get hostname(){return this._href?.hostname||'';}
    get protocol(){return this._href?.protocol||'';}
    get pathname(){return this._href?.pathname||'';}
    appendChild(c){this.children.push(c);c.parentNode=this;return c;}
    removeChild(c){this.children=this.children.filter(n=>n!==c);c.parentNode=null;return c;}
    contains(n){return this===n||all(this).includes(n);}
    setAttribute(k,v){this.attrs[k]=String(v);}
    hasAttribute(k){return Object.hasOwn(this.attrs,k);}
    getAttribute(k){return this.attrs[k]??null;}
    addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}
    removeEventListener(k,fn){this.listeners[k]=(this.listeners[k]||[]).filter(f=>f!==fn);}
    fire(k){for(const fn of this.listeners[k]||[])fn({target:this});}
    click(){for(const fn of this.listeners.click||[])fn({target:this});}
    focus(){document.activeElement=this;}
    blur(){document.activeElement=document.body;}
    scrollIntoView(){}
    getClientRects(){return [this.getBoundingClientRect()];}
    getBoundingClientRect(){return this.rect||{left:20,top:30,right:160,bottom:80,width:140,height:50};}
    querySelectorAll(q){
      const ds=all(this);
      if(q==='h2,a[href]')return ds.filter(n=>n.tagName==='H2'||(n.tagName==='A'&&n.href));
      if(q==='a[href]')return ds.filter(n=>n.tagName==='A'&&n.href);
      if(q==='img'||q==='img[alt]')return ds.filter(n=>n.tagName==='IMG'&&(q==='img'||n.hasAttribute('alt')));
      if(q.indexOf('button,[role=')===0)return ds.filter(n=>n.tagName==='BUTTON'||n.getAttribute('role')==='button'||/play/.test(n.getAttribute('class')||''));
      if(q.indexOf('[class*="play-button"]')===0)return ds.filter(n=>/play/.test(n.getAttribute('class')||''));
      if(q==='h1'||q==='p'||q==='video')return ds.filter(n=>n.tagName===q.toUpperCase());
      if(q==='h2,h3')return ds.filter(n=>n.tagName==='H2'||n.tagName==='H3');
      if(q==='video,iframe')return ds.filter(n=>n.tagName==='VIDEO'||n.tagName==='IFRAME');
      if(q==='a[href],button,[role="button"]')return ds.filter(n=>n.tagName==='A'||n.tagName==='BUTTON'||n.getAttribute('role')==='button');
      if(q.indexOf('img,source,')===0)return ds.filter(n=>['IMG','SOURCE'].includes(n.tagName)||n.style.backgroundImage||Object.keys(n.attrs).some(k=>k.startsWith('data-')));
      if(q==='a[href],button')return ds.filter(n=>n.tagName==='A'||n.tagName==='BUTTON');
      if(q.indexOf('dialog[open]')===0)return [];
      if(q.indexOf('a[href], button')===0)return ds.filter(n=>['A','BUTTON','INPUT','SELECT','TEXTAREA'].includes(n.tagName));
      if(q.indexOf('input[placeholder')===0)return ds.filter(n=>n.tagName==='INPUT');
      if(q.startsWith('.'))return ds.filter(n=>n.classList.contains(q.slice(1)));
      return [];
    }
    querySelector(q){return this.querySelectorAll(q)[0]||null;}
  }
  const timerQueue=new Map();let timerId=0;const html=new Node('html'),head=html.appendChild(new Node('head')),body=html.appendChild(new Node('body'));
  document={documentElement:html,head,body,activeElement:body,title:'Fixture',readyState:'complete',listeners:{},createElement(t){return new Node(t);},createTextNode(x){const n=new Node('text');n._text=String(x);return n;},getElementById(id){return all(html).find(n=>n.id===id)||null;},querySelectorAll(q){return html.querySelectorAll(q);},querySelector(q){return html.querySelector(q);},contains(n){return html.contains(n);},addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}};
  const window={location:{hostname:'cineby.ws',pathname:options.detail?'/movie/sample':'/home',href:options.detail?'https://cineby.ws/movie/sample':'https://cineby.ws/home'},innerWidth:1280,innerHeight:720,getComputedStyle(){return{display:'block',visibility:'visible',pointerEvents:'auto',overflowY:'visible',overflowX:'visible'};},addEventListener(){},scrollBy(){},history:{length:2,back(){}}};
  window.top=window.self=window;
  const nav=body.appendChild(new Node('nav'));const input=nav.appendChild(new Node('input'));input.setAttribute('placeholder','Search movies, TV shows...');
  const main=body.appendChild(new Node('main'));
  function section(name,kind,titles){const h=main.appendChild(new Node('h2'));h.textContent=name;
    titles.forEach((t,i)=>{const a=main.appendChild(new Node('a'));a.href='/'+kind+'/title-'+i;a.textContent=(kind==='tv'?'TV ★ 8.1 S1 E1 ':'★ 7.8 ')+t+' 2026';if(options.backgroundOnly){const art=a.appendChild(new Node('div'));art.style.backgroundImage='url(https://example.invalid/bg-'+i+'.jpg)';}else{const image=a.appendChild(new Node('img'));image.setAttribute('alt',t);image.setAttribute('data-src','https://example.invalid/lazy-'+i+'.jpg');image.setAttribute('src','https://example.invalid/art-'+i+'.jpg');}});}
  let play,mediaNode,previewControl;
  if(options.detail){
    const h=main.appendChild(new Node('h1'));h.textContent='Sample Film';
    const meta=main.appendChild(new Node('p'));meta.textContent='2026 1h 29m — A short sample synopsis about a fictional character who travels to a remote island.';
    const poster=main.appendChild(new Node('img'));poster.setAttribute('alt','Sample Film');poster.setAttribute('data-src','https://example.invalid/poster.jpg');
    const backdrop=main.appendChild(new Node('img'));backdrop.setAttribute('alt','Hero backdrop');backdrop.setAttribute('src','https://example.invalid/backdrop.jpg');backdrop.rect={left:400,top:0,right:1200,bottom:480,width:800,height:480};
    play=main.appendChild(new Node('button'));play.textContent='Play Now';
    function createMedia(){
      mediaNode=main.appendChild(new Node(options.iframe?'iframe':'video'));
      mediaNode.rect={left:20,top:220,right:1150,bottom:850,width:1130,height:630};
      mediaNode.paused=true;mediaNode.currentTime=0;mediaNode.duration=120;
      mediaNode.play=function(){this.paused=false;this.fire('play');};mediaNode.pause=function(){this.paused=true;this.fire('pause');};
    }
    play.addEventListener('click',()=>{
      if(!options.preview){createMedia();return;}
      const wrapper=main.appendChild(new Node('div'));wrapper.rect={left:30,top:200,right:1250,bottom:900,width:1220,height:700};
      const image=wrapper.appendChild(new Node('img'));image.setAttribute('alt','Play movie');image.rect=wrapper.rect;
      previewControl=wrapper.appendChild(new Node('div'));previewControl.setAttribute('class','play-overlay');previewControl.rect={left:590,top:540,right:690,bottom:640,width:100,height:100};
      previewControl.addEventListener('click',()=>{main.removeChild(wrapper);createMedia();});
    });

  } else {
    section('New Movies','movie',['Nebula','Horizon','Solstice']);section('New TV Shows','tv',['North','Ocean','Awake']);
  }
  const context={window,document,setTimeout(fn,delay){timerQueue.set(++timerId,{fn,delay});return timerId;},clearTimeout(id){timerQueue.delete(id);},Date,console};
  vm.runInNewContext(source,context);
  function flush(){for(let i=0;i<8;i++){const next=[...timerQueue].find(([id,t])=>t.delay<=500);if(!next)break;timerQueue.delete(next[0]);next[1].fn();}}
  function key(value){for(const fn of document.listeners.keydown)fn({keyCode:typeof value==='number'?value:undefined,key:typeof value==='string'?value:undefined,preventDefault(){},stopPropagation(){}});}
  function runTimers(max){for(const [id,t] of [...timerQueue]){if(t.delay<=max){timerQueue.delete(id);t.fn();}}}
  return {document,main,input,play,flush,runTimers,window,key,media:()=>mediaNode,preview:()=>previewControl};
}
test('browse shell builds six poster cards in two rails and preserves native content',()=>{
  const {document,main}=pageFixture();
  const shell=document.getElementById('cbws-tv-screen');
  assert.ok(shell);
  assert.equal(shell.querySelectorAll('.cbws-card').length,6);
  assert.equal(shell.querySelectorAll('.cbws-rail').length,2);
  assert.ok(shell.querySelector('.cbws-hero').textContent.includes('Nebula'));
  assert.equal(main.querySelectorAll('a[href]').length,6);
  assert.ok(document.querySelector('.cbws-tv-focus'));
});
test('Site view and TV view are reversible',()=>{
  const {document}=pageFixture();
  const shell=document.getElementById('cbws-tv-screen');
  const action=shell.querySelector('.cbws-actions');
  action.children[1].click();
  assert.equal(document.getElementById('cbws-tv-screen'),null);
  const restore=document.getElementById('cbws-tv-native-toggle');
  assert.ok(restore);
  restore.click();
  assert.ok(document.getElementById('cbws-tv-screen'));
});
test('Search returns to original site input rather than guessing an API',()=>{
  const {document,input}=pageFixture();
  document.getElementById('cbws-tv-screen').querySelector('.cbws-actions').children[0].click();
  assert.equal(document.getElementById('cbws-tv-screen'),null);
  assert.equal(document.activeElement,input);
});

test('poster candidates use the original lazy image and retry the native src',()=>{
  const {document}=pageFixture();
  const tile=document.getElementById('cbws-tv-screen').querySelector('.cbws-card');
  const art=tile.querySelector('img');
  assert.equal(art.src,'https://example.invalid/lazy-0.jpg');
  art.fire('error');
  assert.equal(tile.querySelector('img').src,'https://example.invalid/art-0.jpg');
});
test('title page builds cinematic details and uses the original Play button',()=>{
  const fixture=pageFixture({detail:true});
  const {document,main,flush}=fixture;
  const shell=document.getElementById('cbws-tv-screen');
  assert.ok(shell.querySelector('.cbws-detail-hero'));
  assert.ok(shell.querySelector('.cbws-detail-title').textContent.includes('Sample Film'));
  assert.ok(shell.querySelector('.cbws-detail-poster').querySelector('img'));
  assert.ok(shell.querySelector('.cbws-detail-backdrop').querySelector('img'));
  shell.querySelector('.cbws-detail-actions').children[0].click();
  assert.ok(fixture.media());
  flush();
  const hud=document.getElementById('cbws-tv-player-ui');
  assert.ok(hud);
  assert.ok(fixture.media().classList.contains('cbws-theatre-media'));
  assert.ok(main.contains(fixture.media()),'The player stays in its original DOM.');
  const controls=hud.querySelector('.cbws-player-controls');
  controls.children[1].click();
  assert.equal(fixture.media().paused,false);
  hud.querySelector('.cbws-player-top').children[0].click();
  assert.equal(document.getElementById('cbws-tv-player-ui'),null);
  assert.ok(!fixture.media().classList.contains('cbws-theatre-media'));
});
test('external iframe opens full-screen right after Play Now and stays in the native page',()=>{
  const fixture=pageFixture({detail:true,iframe:true});
  const {document,main,flush}=fixture;
  document.getElementById('cbws-tv-screen').querySelector('.cbws-detail-actions').children[0].click();
  flush();
  const hud=document.getElementById('cbws-tv-player-ui');
  assert.ok(hud,'The player opens without a separate Enlarge step.');
  assert.ok(fixture.media().classList.contains('cbws-theatre-media'));
  assert.ok(main.contains(fixture.media()));
  assert.ok(hud.textContent.includes('embedded player’s own controls'));
  assert.equal(document.activeElement,hud.querySelector('.cbws-player-primary'));
});
test('one OK on Play Now presses the original big play button and opens the player',()=>{
  const fixture=pageFixture({detail:true,preview:true});
  const {document,key}=fixture;
  key(13);
  assert.ok(fixture.preview());
  assert.ok(fixture.media(),'No second OK is needed.');
  const hud=document.getElementById('cbws-tv-player-ui');
  assert.ok(hud);
  assert.ok(fixture.media().classList.contains('cbws-theatre-media'));
});
test('the full-screen overlay fades and the first key only brings it back',()=>{
  const fixture=pageFixture({detail:true,iframe:true});
  const {document,key}=fixture;
  key(13);
  const hud=document.getElementById('cbws-tv-player-ui');
  hud.querySelector('.cbws-player-primary').click();
  assert.ok(hud.classList.contains('cbws-player-idle'));
  document.activeElement=hud.querySelector('.cbws-player-primary');
  key('ArrowRight');
  assert.ok(!hud.classList.contains('cbws-player-idle'));
});
test('focus returns from the embedded player so Return closes it',()=>{
  const fixture=pageFixture({detail:true,iframe:true});
  const {document,key,runTimers}=fixture;
  key(13);
  const hud=document.getElementById('cbws-tv-player-ui');
  hud.querySelector('.cbws-player-primary').click();
  assert.equal(document.activeElement,fixture.media(),'OK enters the player controls.');
  runTimers(8000);
  assert.equal(document.activeElement,hud.querySelector('.cbws-player-primary'));
  fixture.window.location.reload=function(){this.reloaded=true;};
  key(10009);
  assert.equal(document.getElementById('cbws-tv-player-ui'),null,'Return leaves the player.');
});
test('Samsung Return goes from the preview to title then from title to browse',()=>{
  const fixture=pageFixture({detail:true,preview:true});
  const {document,key,window}=fixture;
  key(13);
  assert.equal(document.getElementById('cbws-tv-screen'),null);
  key(10009);assert.ok(document.getElementById('cbws-tv-screen'));
  key(10009);assert.equal(window.location.href,'/home');
});
test('OK on a highlighted poster opens its exact normal title URL',()=>{
  const {document,key,window}=pageFixture();
  const card=document.getElementById('cbws-tv-screen').querySelector('.cbws-card');
  assert.equal(document.activeElement,card);key(13);assert.equal(window.location.href,card.href);
});
test('Down on the first poster moves to the same position in the next shelf',()=>{
  const {document,key}=pageFixture();
  const cards=document.getElementById('cbws-tv-screen').querySelectorAll('.cbws-card');
  key('ArrowDown');assert.equal(document.activeElement,cards[3]);
});

test('poster fallback recognizes CSS background artwork from the actual card',()=>{
  const {document}=pageFixture({backgroundOnly:true});
  const art=document.getElementById('cbws-tv-screen').querySelector('.cbws-card').querySelector('img');
  assert.equal(art.src,'https://example.invalid/bg-0.jpg');
});
test('remote moves right and updates the cinematic hero title',()=>{
  const {document}=pageFixture();
  const shell=document.getElementById('cbws-tv-screen');
  const cards=shell.querySelectorAll('.cbws-card');
  cards[1].rect={left:205,top:30,right:345,bottom:80,width:140,height:50};
  for(const fn of document.listeners.keydown)fn({key:'ArrowRight',preventDefault(){},stopPropagation(){}});
  assert.equal(document.activeElement,cards[1]);
  assert.ok(shell.querySelector('.cbws-hero').textContent.includes('Horizon'));
});
