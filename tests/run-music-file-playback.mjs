import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from './dom-runtime/node_modules/playwright-core/index.mjs';

const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,channel:process.env.CHROME_BIN?undefined:'chrome'});
try {
  const page=await browser.newPage();
  await page.route('https://test.example/**', async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/')return route.fulfill({contentType:'text/html',body:'<main><div id="tracks"></div><div id="catalog"></div><div id="playlist"></div></main>'});
    assert.match(path,/^\/app\/assets\/[a-z-]+\.mjs$/);
    return route.fulfill({contentType:'text/javascript',body:await readFile('.'+path)});
  });
  await page.goto('https://test.example/');
  await page.evaluate(async()=>{
    const {mountMusicLibrary}=await import('/app/assets/music-library-view.mjs');
    const {mountCatalog}=await import('/app/assets/music-catalog.mjs');
    const buffer=new ArrayBuffer(44+16000*4), view=new DataView(buffer);
    const text=(at,s)=>[...s].forEach((c,i)=>view.setUint8(at+i,c.charCodeAt(0)));
    text(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);text(8,'WAVEfmt ');
    view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
    view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
    text(36,'data');view.setUint32(40,buffer.byteLength-44,true);
    for(let i=44;i<buffer.byteLength;i+=2)view.setInt16(i,600*Math.sin((i-44)*Math.PI*440/8000),true);
    const track={name:'Trainingsauftakt',sha256:'a'.repeat(64),catalog:true,available:true,favourite:true,mime_type:'audio/wav',size_bytes:buffer.byteLength};
    const api={list:async()=>[track],source:async()=>new Blob([buffer],{type:'audio/wav'}),overview:async()=>({plan:'delta',credits:0,tracks:[track]})};
    mountMusicLibrary({doc:document,host:document.querySelector('#tracks'),api});
    mountMusicLibrary({doc:document,host:document.querySelector('#playlist'),playlist:true,api});
    mountCatalog({doc:document,host:document.querySelector('#catalog'),api});
  });
  const label=id=>page.locator('#'+id).getByRole('button',{name:/Trainingsauftakt/});
  const playing=id=>page.waitForFunction(id=>{const a=document.querySelector('#'+id+' audio');return !a.paused&&a.currentTime>0;},id);
  await label('tracks').click();await playing('tracks');
  await label('tracks').click();assert.ok(await page.locator('#tracks audio').evaluate(a=>a.paused));
  await label('tracks').focus();await page.keyboard.press('Enter');await playing('tracks');
  await label('catalog').click();await playing('catalog');
  assert.ok(await page.locator('#tracks audio').evaluate(a=>a.paused&&a.hidden));
  await label('playlist').click();await playing('playlist');
  assert.ok(await page.locator('#catalog audio').evaluate(a=>a.paused&&a.hidden));
  assert.equal(await page.getByRole('button',{name:'Anhören',exact:true}).count(),0);
  console.log('Direct file playback, pause, keyboard, and switching between tracks, catalog and playlist passed.');
} finally {
  await browser.close();
}
