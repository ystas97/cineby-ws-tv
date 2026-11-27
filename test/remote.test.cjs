const {test}=require('node:test');
const assert=require('node:assert/strict');
const {directionalScore,pickNext,keyAction}=require('../remote.js');
function rect(x,y,w=100,h=60){return{left:x,top:y,right:x+w,bottom:y+h};}
test('direction selects same row before diagonal',()=>{
  const from=rect(100,100);
  const candidates=[{name:'diagonal',rect:rect(220,200)},{name:'right',rect:rect(280,100)},{name:'left',rect:rect(0,100)}];
  assert.equal(pickNext(from,candidates,'right').name,'right');
  assert.equal(pickNext(from,candidates,'left').name,'left');
});
test('vertical navigation favors aligned column',()=>{
  const from=rect(300,120);
  const candidates=[{name:'left below',rect:rect(100,200)},{name:'below',rect:rect(300,280)},{name:'above',rect:rect(300,0)}];
  assert.equal(pickNext(from,candidates,'down').name,'below');
  assert.equal(pickNext(from,candidates,'up').name,'above');
});
test('invalid direction candidate excluded',()=>{
  assert.equal(directionalScore(rect(200,200),rect(50,200),'right'),Infinity);
  assert.equal(pickNext(rect(0,0),[],'right'),null);
});
test('Tizen and keyboard key codes',()=>{
  assert.equal(keyAction({keyCode:10009}),'back');
  assert.equal(keyAction({keyCode:10252}),'toggle');
  assert.equal(keyAction({keyCode:417}),'forward');
  assert.equal(keyAction({key:'ArrowLeft'}),'left');
  assert.equal(keyAction({key:'Enter'}),'ok');
  assert.equal(keyAction({key:'a'}),null);
});
test('TizenBrew manifest',()=>{
  const p=require('../package.json');
  assert.equal(p.packageType,'mods');
  assert.equal(p.websiteURL,'https://cineby.ws/');
  assert.equal(p.main,'remote.js');
  assert.ok(p.keys.includes('MediaPlayPause'));
});
