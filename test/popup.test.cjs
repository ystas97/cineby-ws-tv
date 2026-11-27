const {test}=require('node:test');
const assert=require('node:assert/strict');
const {installPopupGuard}=require('../embed.js');
const tv=require('../tv.js');

function makeRealm(origin,navigated,shared){
  class EventTarget{dispatchEvent(e){return true;}}
  class Node extends EventTarget{appendChild(c){(this.children??=[]).push(c);c.connected=true;return c;}}
  class Element extends Node{constructor(tag,attrs={},connected=true){super();this.tagName=tag;this.attrs=attrs;this.connected=connected;this.nodeType=1;this.ownerDocument=shared.doc;}
    getAttribute(k){return this.attrs[k]??null;} closest(sel){return /a\[href\]/.test(sel)&&this.tagName==='A'&&this.attrs.href?this:null;}
    getElementsByTagName(){return [];}
    get href(){return new URL(this.attrs.href,origin+'/e/1').href;} get action(){return this.attrs.action||'';}}
  class HTMLElement extends Element{click(){navigated.push(this.tagName==='A'?this.href:'click');}}
  class HTMLAnchorElement extends HTMLElement{}
  class HTMLFormElement extends HTMLElement{submit(){navigated.push('form:'+this.attrs.action);}}
  class HTMLIFrameElement extends HTMLElement{get contentWindow(){return this._win;} get contentDocument(){return this._win&&this._win.document;}}
  return {EventTarget,Node,Element,HTMLElement,HTMLAnchorElement,HTMLFormElement,HTMLIFrameElement};
}
function setup(origin='https://player.example'){
  const listeners={},blocked=[],navigated=[],shared={};
  const doc={baseURI:origin+'/e/1',documentElement:{contains:n=>n.connected},addEventListener(t,fn){(listeners[t]??=[]).push(fn);},getElementsByTagName(){return [];}};
  shared.doc=doc;
  const R=makeRealm(origin,navigated,shared);
  const win={location:{href:origin+'/e/1',origin},URL,document:doc,...R,open(){navigated.push('real-open');return {};}};
  installPopupGuard(win,doc,u=>u.origin===origin,url=>blocked.push(url));
  function click(el){const ev={target:el,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};for(const fn of listeners.click)fn(ev);return ev.defaultPrevented;}
  // A fresh same-site helper frame with its own, untouched window.open.
  function helperFrame(){const child={location:{origin},document:{addEventListener(){},getElementsByTagName(){return [];}},open(){navigated.push('child-open');return {};},...makeRealm(origin,navigated,shared)};const f=new R.HTMLIFrameElement('IFRAME');f._win=child;return f;}
  return {win,doc,blocked,navigated,click,helperFrame,...R};
}
test('window.open is blocked and returns a harmless window object',()=>{
  const {win,blocked,navigated}=setup();
  const w=win.open('https://casino.example/ad','_blank');
  assert.equal(navigated.length,0);
  assert.deepEqual(blocked,['https://casino.example/ad']);
  assert.equal(typeof w.close,'function');w.close();assert.equal(w.closed,true);
  win.open='restored';assert.notEqual(win.open,'restored','Ad scripts cannot put it back.');
});
test('links to another site or a new window are stopped, player links still work',()=>{
  const {click,HTMLAnchorElement}=setup();
  assert.equal(click(new HTMLAnchorElement('A',{href:'https://google.com/'})),true);
  assert.equal(click(new HTMLAnchorElement('A',{href:'/e/2',target:'_blank'})),true);
  assert.equal(click(new HTMLAnchorElement('A',{href:'/e/2'})),false,'Same-site link inside the player.');
  assert.equal(click(new HTMLAnchorElement('A',{href:'#'})),false);
});
test('scripted clicks on hidden ad links and scripted form posts are stopped',()=>{
  const {HTMLAnchorElement,HTMLFormElement,navigated,blocked}=setup();
  const ad=new HTMLAnchorElement('A',{href:'https://casino.example/',target:'_blank'},false);
  ad.click();
  assert.equal(ad.dispatchEvent({type:'click'}),false);
  new HTMLFormElement('FORM',{action:'https://casino.example/go',target:'_blank'}).submit();
  assert.equal(navigated.length,0);
  assert.equal(blocked.length,3);
  new HTMLAnchorElement('A',{href:'/e/3'}).click();
  assert.equal(navigated.length,1,'Own links keep working.');
});
test('window.open borrowed from a fresh hidden iframe is blocked too',()=>{
  const {win,doc,navigated,blocked,helperFrame}=setup();
  const body=new win.Element('BODY');
  const frame=helperFrame();
  body.appendChild(frame);
  frame.contentWindow.open.call(win,'https://casino.example/');
  const other=helperFrame();
  other.contentWindow.open('https://google.com/');
  assert.equal(navigated.length,0);
  assert.deepEqual(blocked,['https://casino.example/','https://google.com/']);
});
test('tv.js ships the same guard',()=>{
  assert.equal(typeof tv.installPopupGuard,'function');
  assert.equal(tv.installPopupGuard.toString(),installPopupGuard.toString());
});
