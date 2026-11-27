const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const source=readFileSync(path.join(__dirname,'../remote.js'),'utf8');
const SHA='0123456789abcdef0123456789abcdef01234567';
const OLD='fedcba9876543210fedcba9876543210fedcba98';

function run({status=200,body=JSON.stringify({sha:SHA}),fail=false,storage={},hostname='cineby.ws',failScripts=0}={}){
  const scripts=[],requests=[];
  const head={appendChild(s){scripts.push(s);s.parentNode=head;if(failScripts>0){failScripts--;s.onerror();}},removeChild(s){s.parentNode=null;}};
  const document={head,documentElement:head,createElement(){return {};}};
  const localStorage={getItem:k=>storage[k]??null,setItem:(k,v)=>{storage[k]=v;}};
  class XMLHttpRequest{open(m,u){requests.push(u);}send(){this.status=status;this.responseText=body;fail?this.onerror():this.onload();}}
  const window={location:{hostname},localStorage};window.top=window.self=window;
  vm.runInNewContext(source,{window,document,XMLHttpRequest,JSON,Date});
  return {scripts:scripts.map(s=>s.src),requests,storage};
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
  const withCache=run({fail:true,storage:{'cbws-loader-ref':JSON.stringify({sha:OLD,time:0})}});
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
