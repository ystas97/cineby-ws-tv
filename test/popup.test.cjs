const {test}=require('node:test');
const assert=require('node:assert/strict');
const {installPopupGuard}=require('../embed.js');
const tv=require('../tv.js');

function setup(origin='https://player.example'){
  const listeners={},blocked=[],navigated=[];
  class EventTarget{dispatchEvent(e){return true;}}
  class Element extends EventTarget{constructor(tag,attrs={},connected=true){super();this.tagName=tag;this.attrs=attrs;this.connected=connected;}
    getAttribute(k){return this.attrs[k]??null;} closest(sel){return /a\[href\]/.test(sel)&&this.tagName==='A'&&this.attrs.href?this:null;}
    get href(){return new URL(this.attrs.href,origin+'/e/1').href;} get action(){return this.attrs.action||'';}}
  class HTMLAnchorElement extends Element{click(){navigated.push(this.href);}}
  class HTMLFormElement extends Element{submit(){navigated.push('form:'+this.attrs.action);}}
  const doc={baseURI:origin+'/e/1',documentElement:{contains:n=>n.connected},addEventListener(t,fn){(listeners[t]??=[]).push(fn);}};
  const win={location:{href:origin+'/e/1',origin},URL,HTMLAnchorElement,HTMLFormElement,EventTarget,open(){navigated.push('real-open');return {};}};
  installPopupGuard(win,doc,u=>u.origin===origin,url=>blocked.push(url));
  function click(el){const ev={target:el,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};for(const fn of listeners.click)fn(ev);return ev.defaultPrevented;}
  return {win,doc,blocked,navigated,click,HTMLAnchorElement,HTMLFormElement};
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
test('tv.js ships the same guard',()=>{
  assert.equal(typeof tv.installPopupGuard,'function');
  assert.equal(tv.installPopupGuard.toString(),installPopupGuard.toString());
});
