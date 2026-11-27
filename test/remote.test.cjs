const {test}=require('node:test');
const assert=require('node:assert/strict');
const {directionalScore,pickNext,keyAction,isTitlePath,isBrowsePath,cardText,sectionLabel}=require('../remote.js');
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
  assert.equal(p.websiteURL,'https://cineby.ws/home');
  assert.equal(p.main,'remote.js');
  assert.ok(p.keys.includes('MediaPlayPause'));
});

test('TV browse routing excludes detail and playback pages',()=>{
  for(const path of ['/','/home','/movies','/tv','/my-room','/search','/search/drama'])assert.equal(isBrowsePath(path),true);
  for(const path of ['/movie/example','/tv/example','/tv/example/season-1','/watch/example'])assert.equal(isBrowsePath(path),false);
  assert.equal(isTitlePath('/movie/example'),true);
  assert.equal(isTitlePath('/tv/example'),true);
  assert.equal(isTitlePath('/tv'),false);
  assert.equal(isTitlePath('/tv/example/season-1'),false);
});
test('card metadata parses visible title and rating',()=>{
  assert.deepEqual(cardText('TV ★ 8.6 S1 E8 The Remarried Empress 2026'),{title:'The Remarried Empress',year:'2026',rating:'8.6',episode:'S1 E8'});
  assert.deepEqual(cardText('★ 6.1 How to Rob a Bank 2026'),{title:'How to Rob a Bank',year:'2026',rating:'6.1',episode:''});
  assert.equal(cardText('See More').title,'');
  assert.equal(cardText('Play').title,'');
});
test('home section labels follow the native page grouping',()=>{
  assert.equal(sectionLabel('New Movies'),'New movies');
  assert.equal(sectionLabel('New TV Shows'),'New series');
  assert.equal(sectionLabel('Updated TV Shows'),'Just updated');
  assert.equal(sectionLabel('Why Cineby?'),'');
});
