const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const source=readFileSync(path.join(__dirname,'../remote.js'),'utf8');
function pageFixture(){
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
    click(){for(const fn of this.listeners.click||[])fn({target:this});}
    focus(){document.activeElement=this;}
    blur(){document.activeElement=document.body;}
    scrollIntoView(){}
    getClientRects(){return [this.getBoundingClientRect()];}
    getBoundingClientRect(){return{left:20,top:30,right:160,bottom:80,width:140,height:50};}
    querySelectorAll(q){
      const ds=all(this);
      if(q==='h2,a[href]')return ds.filter(n=>n.tagName==='H2'||(n.tagName==='A'&&n.href));
      if(q==='a[href]')return ds.filter(n=>n.tagName==='A'&&n.href);
      if(q==='img')return ds.filter(n=>n.tagName==='IMG');
      if(q==='a[href],button')return ds.filter(n=>n.tagName==='A'||n.tagName==='BUTTON');
      if(q.indexOf('dialog[open]')===0)return [];
      if(q.indexOf('a[href], button')===0)return ds.filter(n=>['A','BUTTON','INPUT','SELECT','TEXTAREA'].includes(n.tagName));
      if(q.indexOf('input[placeholder')===0)return ds.filter(n=>n.tagName==='INPUT');
      if(q.startsWith('.'))return ds.filter(n=>n.classList.contains(q.slice(1)));
      return [];
    }
    querySelector(q){return this.querySelectorAll(q)[0]||null;}
  }
  const html=new Node('html'),head=html.appendChild(new Node('head')),body=html.appendChild(new Node('body'));
  document={documentElement:html,head,body,activeElement:body,readyState:'complete',createElement(t){return new Node(t);},createTextNode(x){const n=new Node('text');n._text=String(x);return n;},getElementById(id){return all(html).find(n=>n.id===id)||null;},querySelectorAll(q){return html.querySelectorAll(q);},querySelector(q){return html.querySelector(q);},contains(n){return html.contains(n);},addEventListener(){}};
  const window={location:{hostname:'cineby.ws',pathname:'/home',href:'https://cineby.ws/home'},innerWidth:1280,innerHeight:720,getComputedStyle(){return{display:'block',visibility:'visible',pointerEvents:'auto',overflowY:'visible',overflowX:'visible'};},addEventListener(){},scrollBy(){}};
  window.top=window.self=window;
  const nav=body.appendChild(new Node('nav'));const input=nav.appendChild(new Node('input'));input.setAttribute('placeholder','Search movies, TV shows...');
  const main=body.appendChild(new Node('main'));
  function section(name,kind,titles){const h=main.appendChild(new Node('h2'));h.textContent=name;
    titles.forEach((t,i)=>{const a=main.appendChild(new Node('a'));a.href='/'+kind+'/title-'+i;a.textContent=(kind==='tv'?'TV ★ 8.1 S1 E1 ':'★ 7.8 ')+t+' 2026';const image=a.appendChild(new Node('img'));image.setAttribute('alt',t);image.setAttribute('src','https://example.invalid/art-'+i+'.jpg');});}
  section('New Movies','movie',['Nebula','Horizon','Solstice']);section('New TV Shows','tv',['North','Ocean','Awake']);
  const context={window,document,setTimeout(){return 1;},clearTimeout(){},Date,console};
  vm.runInNewContext(source,context);
  return {document,main,input};
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
