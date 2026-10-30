import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {lookup} from 'node:dns/promises';
import puppeteer from 'puppeteer-core';

const email='sakuravillager@outlook.com';
const server=createServer((req,res)=>{
  res.setHeader('content-type','text/html; charset=utf-8');
  if(req.url==='/one') res.end(`<!doctype html><title>Background tab</title><h1>Background page</h1><script>let tick=0;setInterval(()=>{document.title='Background '+ ++tick;},300)</script>`);
  else res.end(`<!doctype html><meta charset="utf-8"><title>Email regression</title>
    <style>body{font:20px sans-serif;padding:30px}input,button{font:inherit;margin:12px}</style>
    <h1 id="marker">Email input regression</h1>
    <input id="email" name="email" type="email" required autocomplete="email" oninput="document.querySelector('#value').textContent=this.value">
    <button id="check" onclick="document.querySelector('#result').textContent=document.querySelector('#email').checkValidity()?'Email valid':'Email invalid'">Check email locally</button>
    <p id="value"></p><p id="result"></p>`);
});
await new Promise(resolve=>server.listen(3010,'0.0.0.0',resolve));
const ip=(await lookup('browser')).address;
async function connect(port,viewport){
  let version;
  for(let attempt=0;attempt<40;attempt++){
    try{version=await(await fetch(`http://${ip}:${port}/json/version`)).json();break;}
    catch(error){if(attempt===39)throw error;await new Promise(resolve=>setTimeout(resolve,250));}
  }
  const endpoint=new URL(version.webSocketDebuggerUrl);endpoint.host=`${ip}:${port}`;
  return puppeteer.connect({browserWSEndpoint:endpoint.href,defaultViewport:viewport});
}
let viewer,remote,page;
const report={checks:[]};
const pass=name=>{report.checks.push(name);console.log('[pass] '+name);};
try{
  viewer=await connect(9225,{width:1280,height:800});
  remote=await connect(9222,null);
  page=await(await viewer.createBrowserContext()).newPage();
  await page.goto('http://localhost:3011/',{waitUntil:'domcontentloaded'});
  await page.type('input[name="password"]',process.env.MIRROR_ACCESS_PASSWORD);
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('button[type="submit"]')]);
  await page.waitForSelector('#connection-state[data-state="open"]');
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const mirror=async text=>page.waitForFunction(text=>document.querySelector('#mirror-host')?.dataset.mirrorState==='live'&&document.querySelector('#mirror-host iframe')?.contentDocument?.body?.innerText.includes(text),{timeout:20000},text);
  const frame=async()=> (await page.$('#mirror-host iframe')).contentFrame();
  const navigate=async url=>{
    await page.click('input[aria-label="Address"]');
    await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');
    await page.keyboard.type(url);await page.keyboard.press('Enter');
  };
  await navigate('http://gateway:3010/one');
  await mirror('Background page');
  const tabCount=await page.$$eval('[role="tab"]',nodes=>nodes.length);
  await page.click('#new-tab');
  await page.waitForFunction(count=>document.querySelectorAll('[role="tab"]').length>count,{timeout:15000},tabCount);
  await page.waitForFunction(()=>document.querySelector('input[aria-label="Address"]')?.value==='about:blank');
  await navigate('http://gateway:3010/two');await mirror('Email input regression');await wait(1200);
  await page.evaluate(()=>{
    window.trialTabSwitches=[];
    const nav=document.querySelector('#tabstrip');
    new MutationObserver(()=>{
      const active=nav.querySelector('[role="tab"][aria-selected="true"]');
      if(active?.getAttribute('title')!=='http://gateway:3010/two')window.trialTabSwitches.push(active?.getAttribute('title'));
    }).observe(nav,{subtree:true,attributes:true,attributeFilter:['aria-selected']});
  });
  await(await frame()).click('#email');
  await page.keyboard.type(email,{delay:5});
  await(await frame()).click('#check');
  await mirror('Email valid');
  let authoritative=(await remote.pages()).find(p=>p.url()==='http://gateway:3010/two');
  assert(authoritative);
  assert.deepEqual(await authoritative.$eval('#email',n=>({value:n.value,valid:n.validity.valid})),{value:email,valid:true});
  pass('rapid email typing, blur and native validity match on the remote page');
  await(await frame()).click('#email');
  await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');
  await page.keyboard.sendCharacter(email);
  await(await frame()).click('#check');await mirror('Email valid');
  assert.equal(await authoritative.$eval('#email',n=>n.value),email);
  pass('complete native text insertion is synchronized without duplicate characters');
  await wait(5000);
  assert.deepEqual(await page.evaluate(()=>window.trialTabSwitches),[]);
  assert.equal(await page.$eval('[role="tab"][aria-selected="true"]',n=>n.getAttribute('title')),'http://gateway:3010/two');
  pass('background title updates do not steal the selected second tab');
  await page.reload({waitUntil:'domcontentloaded'});await mirror('Email input regression');await wait(2000);
  assert.equal(await page.$eval('[role="tab"][aria-selected="true"]',n=>n.getAttribute('title')),'http://gateway:3010/two');
  pass('viewer reconnect restores the active tab instead of the first snapshot tab');
  assert(await page.$$eval('.replayer-mouse,.replayer-mouse-tail',nodes=>nodes.every(n=>getComputedStyle(n).display==='none')));
  pass('recorded mouse overlays are hidden');
  await page.screenshot({path:'/runtime/gateway/input-regression.png'});
}catch(error){
  report.failure=error.stack;process.exitCode=1;
  if(page){await page.screenshot({path:'/runtime/gateway/input-regression-failure.png'}).catch(()=>{});report.ui=await page.evaluate(()=>({url:document.querySelector('input[aria-label="Address"]')?.value,text:document.querySelector('#mirror-host iframe')?.contentDocument?.body?.innerText.slice(0,1000)})).catch(()=>null);}
}finally{
  console.log(JSON.stringify(report,null,2));remote?.disconnect();
  if(viewer)await viewer.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
