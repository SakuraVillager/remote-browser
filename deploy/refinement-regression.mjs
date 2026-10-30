import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {lookup} from 'node:dns/promises';
import puppeteer from 'puppeteer-core';

const server=createServer((req,res)=>{
  if(req.url==='/icons.svg'){
    res.setHeader('content-type','image/svg+xml');
    res.end('<svg xmlns="http://www.w3.org/2000/svg"><symbol id="star" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></symbol><symbol id="dot" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></symbol></svg>');return;
  }
  if(req.url==='/download'){
    res.setHeader('content-type','application/octet-stream');
    res.setHeader('content-disposition','attachment; filename="mirror-local-download.txt"');
    res.end('Direct download regression: 测试\n');return;
  }
  res.setHeader('content-type','text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><title>Refinement fixture</title>
  <style>body{font:18px sans-serif;margin:20px}svg{width:32px;height:32px;color:green}#chat{height:280px;overflow:auto;scroll-behavior:smooth;border:1px solid}#messages{height:2800px;background:linear-gradient(white,#eee)}#prompt{border:1px solid;padding:10px;min-height:40px}button,a{display:inline-block;padding:10px}#prompt p{margin:0}</style>
  <h1>Refinement fixture</h1>
  <svg id="icon"><use href="https://chatgpt.com/cdn/assets/icons-962aa5d92d37c6d8.svg#codex-icon-chevron-down-md-light-16"/></svg><svg id="icon-legacy"><use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://chatgpt.com/cdn/assets/icons-962aa5d92d37c6d8.svg#codex-icon-sidebar-light-20"/></svg>
  <div id="chat"><div id="messages">Long conversation</div></div>
  <div id="prompt" contenteditable="true" oninput="document.querySelector('#server-value').textContent=this.innerText"><p><br></p></div>
  <p id="server-value"></p><a id="download" href="/download" download>Download fixture</a>
  <script>window.scrollHistory=[];document.querySelector('#chat').addEventListener('scroll',e=>window.scrollHistory.push(e.target.scrollTop));</script>`);
});
await new Promise(r=>server.listen(3010,'0.0.0.0',r));
const ip=(await lookup('browser')).address;
async function connect(port,viewport){
  let version;
  for(let i=0;i<60;i++){
    try{version=await(await fetch(`http://${ip}:${port}/json/version`)).json();break;}
    catch(e){if(i===59)throw e;await new Promise(r=>setTimeout(r,250));}
  }
  const endpoint=new URL(version.webSocketDebuggerUrl);endpoint.host=`${ip}:${port}`;
  return puppeteer.connect({browserWSEndpoint:endpoint.href,defaultViewport:viewport,protocolTimeout:20000});
}
let viewer,remote,page;
const results=[];
const check=async(name,run)=>{
  try{const detail=await run();results.push({name,ok:true,detail});console.log('[pass]',name,JSON.stringify(detail??{}));}
  catch(e){
    const state=page?await page.evaluate(()=>{
      const d=document.querySelector('#mirror-host iframe')?.contentDocument;
      return {mirrorState:document.querySelector('#mirror-host')?.dataset.mirrorState,scroll:d?.querySelector('#chat')?.scrollTop,prompt:d?.querySelector('#prompt')?.innerText};
    }).catch(()=>null):null;
    results.push({name,ok:false,error:e.message,state});console.log('[fail]',name,e.message,JSON.stringify(state));process.exitCode=1;
  }
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
  viewer=await connect(9225,{width:1280,height:900});remote=await connect(9222,null);
  page=await(await viewer.createBrowserContext()).newPage();
  await page.evaluateOnNewDocument(()=>{
    const Native=window.WebSocket;
    window.fixtureEvents=[];
    window.WebSocket=class extends Native{
      constructor(...args){super(...args);window.fixtureSocket=this;this.addEventListener('message',event=>{
        const message=JSON.parse(event.data);
        if(message.t==='snapshot')window.fixtureEvents.push({kind:'snapshot',reason:message.reason});
        if(message.t==='delta')for(const e of message.data)if(e.type===3&&e.data.source===3)window.fixtureEvents.push({kind:'down-scroll',...e.data});
        if(window.fixtureEvents.length>200)window.fixtureEvents.splice(0,100);
      });}
      send(data){const m=JSON.parse(data);if(m.t==='scroll')window.fixtureEvents.push({kind:'up-scroll',nodeId:m.nodeId,x:m.x,y:m.y});return super.send(data);}
    };
  });
  await page.goto('http://localhost:3011/',{waitUntil:'domcontentloaded'});
  await page.type('input[name="password"]',process.env.MIRROR_ACCESS_PASSWORD);
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('button[type="submit"]')]);
  await page.waitForSelector('#connection-state[data-state="open"]');
  await page.click('input[aria-label="Address"]');await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');
  await page.keyboard.type('http://gateway:3010/fixture');await page.keyboard.press('Enter');
  const mirrorReady=()=>page.waitForFunction(()=>document.querySelector('#mirror-host')?.dataset.mirrorState==='live'&&document.querySelector('#mirror-host iframe')?.contentDocument?.querySelector('#prompt'),{timeout:20000});
  await mirrorReady();await sleep(1500);
  const frame=async()=> (await page.$('#mirror-host iframe')).contentFrame();
  const authoritative=(await remote.pages()).find(p=>p.url()==='http://gateway:3010/fixture');assert(authoritative);
  await check('SVG href and xlink sprite fragments render',async()=>{
    await(await frame()).waitForFunction(()=>['#icon use','#icon-legacy use'].every(s=>document.querySelector(s)?.getBBox().width>0),{timeout:15000});
    return (await frame()).evaluate(()=>Array.from(document.querySelectorAll('use')).map(n=>({width:n.getBBox().width,href:n.getAttribute('href')??n.getAttribute('xlink:href')})));
  });
  await check('Chinese native insertion reaches remote contenteditable without blur or Enter',async()=>{
    await(await frame()).click('#prompt');await page.keyboard.sendCharacter('你好世界');
    await authoritative.waitForFunction(()=>document.querySelector('#prompt').innerText==='你好世界'&&document.querySelector('#server-value').textContent==='你好世界',{timeout:2500});
  });
  await check('IME composition is synchronized and committed exactly once',async()=>{
    await(await frame()).click('#prompt');
    await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');
    const cdp=await page.createCDPSession();
    await cdp.send('Input.imeSetComposition',{text:'中文',selectionStart:2,selectionEnd:2});
    await authoritative.waitForFunction(()=>document.querySelector('#prompt').innerText.includes('中文'),{timeout:2500});
    await cdp.send('Input.insertText',{text:'中文输入'});
    await authoritative.waitForFunction(()=>document.querySelector('#prompt').innerText==='中文输入',{timeout:2500});
    await sleep(600);assert.equal(await authoritative.$eval('#prompt',n=>n.innerText),'中文输入');
    await cdp.detach();
  });
  await check('Resnapshot keeps a scrolled conversation in place',async()=>{
    const summaries=[];
    for(const behavior of ['smooth','auto']){
    // Set the authoritative position independently of local wheel prediction.
    await authoritative.$eval('#chat',(n,value)=>{n.style.scrollBehavior=value;},behavior);
    await authoritative.$eval('#chat',n=>n.scrollTo({top:1800,behavior:'instant'}));
    try{await page.waitForFunction(()=>document.querySelector('#mirror-host iframe')?.contentDocument?.querySelector('#chat')?.scrollTop>1750,{timeout:10000});}
    catch(e){
      e.message+=' '+JSON.stringify({remote:await authoritative.evaluate(()=>({position:document.querySelector('#chat').scrollTop,history:window.scrollHistory.slice(-20)})),events:await page.evaluate(()=>window.fixtureEvents.slice(-35))});throw e;
    }
    await sleep(800);
    const targetSession=await authoritative.createCDPSession();
    const tab=(await targetSession.send('Target.getTargetInfo')).targetInfo.targetId;
    await targetSession.detach();
    await page.evaluate(tab=>{
      window.fixtureScrolls=[];window.fixtureSampling=true;
      const sample=()=>{if(!window.fixtureSampling)return;const d=document.querySelector('#mirror-host iframe')?.contentDocument;const n=d?.querySelector('#chat');if(n)window.fixtureScrolls.push(n.scrollTop);requestAnimationFrame(sample);};sample();
      window.fixtureSocket.send(JSON.stringify({t:'resync-req',tab,reason:'refinement scroll regression'}));
    },tab);
    await sleep(2200);
    const samples=await page.evaluate(()=>{window.fixtureSampling=false;return window.fixtureScrolls;});
    assert(samples.length>5);assert(Math.min(...samples)>1750,`scroll dipped to ${Math.min(...samples)}`);
    assert((await authoritative.$eval('#chat',n=>n.scrollTop))>1750);
    summaries.push({behavior,samples:samples.length,min:Math.min(...samples),max:Math.max(...samples)});
    }
    return summaries;
  });
  await check('Remote download automatically downloads in the local viewer browser',async()=>{
    const root=await viewer.target().createCDPSession();
    const downloads=[];const progress=[];
    root.on('Browser.downloadWillBegin',e=>downloads.push(e));root.on('Browser.downloadProgress',e=>progress.push(e));
    await root.send('Browser.setDownloadBehavior',{behavior:'allowAndName',browserContextId:page.browserContext().id,downloadPath:'/tmp/local-downloads',eventsEnabled:true});
    await(await frame()).click('#download');
    for(let i=0;i<50&&!progress.some(p=>p.state==='completed');i++)await sleep(100);
    assert.equal(downloads.length,1,'local browser did not begin exactly one download');
    assert.equal(downloads[0].suggestedFilename,'mirror-local-download.txt');
    assert(progress.some(e=>e.guid===downloads[0].guid&&e.state==='completed'),JSON.stringify(progress));
    const file=await page.browserContext().newPage();await file.goto('file:///tmp/local-downloads/'+downloads[0].guid);
    assert.equal(await file.$eval('body',n=>n.innerText),'Direct download regression: 测试\n');
    await file.close();await root.detach();
  });
  await page.screenshot({path:'/runtime/gateway/refinement-regression.png'});
}catch(e){results.push({name:'setup',ok:false,error:e.stack});process.exitCode=1;}
finally{
  console.log(JSON.stringify({results},null,2));remote?.disconnect();if(viewer)await viewer.close();
  server.closeAllConnections();await new Promise(r=>server.close(r));
}
