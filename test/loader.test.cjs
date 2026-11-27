const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const source=readFileSync(path.join(__dirname,'../remote.js'),'utf8');
const SHA='0123456789abcdef0123456789abcdef01234567';
const OLD='fedcba9876543210fedcba9876543210fedcba98';

function run({status=200,body=JSON.stringify({sha:SHA}),fail=false,storage={},hostname='cineby.ws',failScripts=0,frame=false,ancestors=['https://cineby.ws'],top=null}={}){
  const scripts=[],requests=[],listeners=[],timers=[],posted=[];
  const head={appendChild(s){scripts.push(s);s.parentNode=head;if(failScripts>0){failScripts--;s.onerror();}},removeChild(s){s.parentNode=null;}};
  const document={head,documentElement:head,createElement(){return {};}};
  const localStorage={getItem:k=>storage[k]??null,setItem:(k,v)=>{storage[k]=v;}};
  class XMLHttpRequest{open(m,u){requests.push(u);}send(){this.status=status;this.responseText=body;fail?this.onerror():this.onload();}}
  const window={location:{hostname,ancestorOrigins:frame?ancestors:[]},localStorage,addEventListener(t,fn){if(t==='message')listeners.push(fn);},setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){},postMessage(m){posted.push(m);}};
  window.self=window;
  window.top=frame?(top||{postMessage(m){posted.push(m);}}):window;
  vm.runInNewContext(source,{window,document,XMLHttpRequest,JSON,Date});
  return {get scripts(){return scripts.map(s=>s.src);},requests,storage,listeners,timers,posted,window};
}
test('loads tv.js from the newest commit on main and remembers it',()=>{
  const r=run();
  assert.equal(r.requests[0],'https://api.github.com/repos/ystas97/cineby-ws-tv/commits/main');
  assert.deepEqual(r.scripts,['https://cdn.jsdelivr.net/gh/ystas97/cineby-ws-tv@'+SHA+'/tv.js']);
  assert.equal(JSON.parse(r.storage['cbws-loader-ref']).sha,SHA);
});
test('a recent commit id is reused without asking GitHub again',()=>{
  const r=run({storage:{'cbws-loader-ref':JSON.stringify({sha:OLD,time:Date.now()})}});
  assert.equal(r.requests.length,0);
  assert.deepEqual(r.scripts,['https://cdn.jsdelivr.net/gh/ystas97/cineby-ws-tv@'+OLD+'/tv.js']);
});
test('a stale commit id is refreshed',()=>{
  const r=run({storage:{'cbws-loader-ref':JSON.stringify({sha:OLD,time:Date.now()-10*60*1000})}});
  assert.equal(r.requests.length,1);
  assert.ok(r.scripts[0].includes(SHA));
});
test('GitHub unavailable: falls back to the last known commit, then to main',()=>{
  const withCache=run({fail:true,storage:{'cbws-loader-ref':JSON.stringify({sha:OLD,time:Date.now()-60*1000})}});
  assert.ok(withCache.scripts[0].includes(OLD));
  const rateLimited=run({status:403,body:'{"message":"rate limit"}'});
  assert.deepEqual(rateLimited.scripts,['https://cdn.jsdelivr.net/gh/ystas97/cineby-ws-tv@main/tv.js']);
});
test('a commit that fails to load falls back to main',()=>{
  const r=run({failScripts:1});
  assert.equal(r.scripts.length,2);
  assert.ok(r.scripts[1].endsWith('@main/tv.js'));
});
test('does nothing outside cineby.ws',()=>{
  const r=run({hostname:'example.com'});
  assert.equal(r.requests.length+r.scripts.length,0);
});
test('cineby page answers player frames with the commit it runs',()=>{
  const page=run();
  const replies=[];
  page.listeners[0]({data:{cbws:'ref?'},source:{postMessage(m){replies.push(m);}}});
  assert.deepEqual(JSON.parse(JSON.stringify(replies)),[{cbws:'ref',sha:SHA}]);
});
test('player frame loads embed.js from the commit the cineby page reports',()=>{
  const top={postMessage(){}};
  const r=run({frame:true,hostname:'play.xpass.top',top});
  assert.equal(r.requests.length,0,'No GitHub request from the frame.');
  r.listeners[0]({data:{cbws:'ref',sha:SHA},source:top});
  assert.deepEqual(r.scripts,['https://cdn.jsdelivr.net/gh/ystas97/cineby-ws-tv@'+SHA+'/embed.js']);
});
test('player frame ignores replies from other windows and falls back to its own lookup',()=>{
  const r=run({frame:true,hostname:'vidfast.vc'});
  r.listeners[0]({data:{cbws:'ref',sha:OLD},source:{}});
  assert.equal(r.scripts.length,0);
  r.timers[0]();
  assert.deepEqual(r.scripts,['https://cdn.jsdelivr.net/gh/ystas97/cineby-ws-tv@'+SHA+'/embed.js']);
});
test('frames of other sites are left alone',()=>{
  const r=run({frame:true,hostname:'ads.example',ancestors:['https://news.example']});
  assert.equal(r.scripts.length+r.requests.length+r.timers.length,0);
});
test('a TV clock behind the saved time does not keep an old version',()=>{
  const r=run({storage:{'cbws-loader-ref':JSON.stringify({sha:OLD,time:Date.now()+24*3600*1000})}});
  assert.equal(r.requests.length,1,'GitHub is asked again.');
  assert.ok(r.scripts[0].includes(SHA));
  assert.equal(r.window.__cbwsLoaderInfo.via,'github');
});
test('GitHub unreachable: a saved id older than 6 h is not trusted, the branch is used',()=>{
  const r=run({fail:true,storage:{'cbws-loader-ref':JSON.stringify({sha:OLD,time:Date.now()-7*3600*1000})}});
  assert.deepEqual(r.scripts,['https://cdn.jsdelivr.net/gh/ystas97/cineby-ws-tv@main/tv.js']);
  assert.equal(r.window.__cbwsLoaderInfo.via,'cdn');
});
test('GitHub unreachable: a saved id from the last hours is used and reported',()=>{
  const r=run({fail:true,storage:{'cbws-loader-ref':JSON.stringify({sha:OLD,time:Date.now()-30*60*1000})}});
  assert.ok(r.scripts[0].includes(OLD));
  assert.equal(r.window.__cbwsLoaderInfo.via,'saved');
});
