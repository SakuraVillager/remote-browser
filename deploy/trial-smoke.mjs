// Run inside the gateway container after starting the temporary viewer Chromium.
// Uses the real password gate and browser UI; never enables MIRROR_E2E.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { lookup } from 'node:dns/promises';
import puppeteer from 'puppeteer-core';

const marker = 'Remote Browser DOM trial';
const fixtureUrl = 'http://gateway:3010/';
const fixture = `<!doctype html><meta charset="utf-8"><title>DOM trial</title>
<style>body{font:20px sans-serif;padding:30px}button,input,a{font:inherit;margin:12px}</style>
<h1 id="trial-marker">${marker}</h1>
<p>这段文字应当在本地 DOM 中，可以选择和复制。</p>
<label>输入：<input id="echo" oninput="document.querySelector('#echo-result').textContent=this.value"></label>
<p id="echo-result"></p>
<button id="change" onclick="document.querySelector('#result').textContent='Remote click confirmed'">点击验证</button>
<p id="result">Waiting</p>
<input id="file" type="file" onchange="this.files[0].text().then(t=>document.querySelector('#upload-result').textContent=t)">
<p id="upload-result"></p><a id="download" href="/download" download="trial-download.txt">下载验证</a>`;
const server = createServer((req, res) => {
  if (req.url === '/download') {
    res.writeHead(200, {'content-type':'text/plain; charset=utf-8', 'content-disposition':'attachment; filename="trial-download.txt"'});
    res.end('remote-browser-download-ok');
  } else {
    res.writeHead(200, {'content-type':'text/html; charset=utf-8'});
    res.end(fixture);
  }
});
await new Promise(resolve => server.listen(3010, '0.0.0.0', resolve));
const ip = (await lookup('browser')).address;
async function connect(port) {
  let version;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      version = await (await fetch(`http://${ip}:${port}/json/version`, {signal:AbortSignal.timeout(2000)})).json();
      break;
    } catch (error) {
      if (attempt === 39) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  const endpoint = new URL(version.webSocketDebuggerUrl);
  endpoint.host = `${ip}:${port}`;
  return puppeteer.connect({browserWSEndpoint: endpoint.href,
    defaultViewport: port === 9225 ? {width:1280,height:800} : null});
}
let viewer, remote, page;
const report = {checks:[], errors:[], snapshots:0, deltas:0, pixels:0};
const pass = name => { report.checks.push(name); console.log('[pass] ' + name); };
try {
  viewer = await connect(9225);
  remote = await connect(9222);
  const context = await viewer.createBrowserContext();
  page = await context.newPage();
  const network = await page.createCDPSession();
  await network.send('Network.enable');
  network.on('Network.webSocketFrameReceived', ({response}) => {
    try {
      const event = JSON.parse(response.payloadData);
      if (event.t === 'snapshot') report.snapshots++;
      if (event.t === 'delta') report.deltas++;
      if (event.t === 'px') report.pixels++;
    } catch {}
  });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => {
    if (['error', 'warn'].includes(message.type())) report.errors.push(message.text());
  });
  await page.goto('http://localhost:3011/', {waitUntil:'domcontentloaded', timeout:30000});
  await page.type('input[name="password"]', process.env.MIRROR_ACCESS_PASSWORD);
  await Promise.all([
    page.waitForNavigation({waitUntil:'domcontentloaded', timeout:30000}),
    page.click('button[type="submit"]')
  ]);
  await page.waitForSelector('#connection-state[data-state="open"]', {timeout:30000});
  pass('password login and authenticated WebSocket');
  async function navigate(url) {
    await page.waitForSelector('input[aria-label="Address"]:not([disabled])');
    await page.click('input[aria-label="Address"]');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.type(url);
    await page.keyboard.press('Enter');
  }
  async function mirrorContains(text, timeout=30000) {
    await page.waitForFunction(text => {
      const host = document.querySelector('#mirror-host');
      return host?.dataset.mirrorState === 'live' &&
        host.querySelector('iframe')?.contentDocument?.body?.innerText.includes(text);
    }, {timeout}, text);
  }
  await navigate(fixtureUrl);
  await mirrorContains(marker);
  // Viewport agreement can replace the replay iframe after the first snapshot.
  await new Promise(resolve => setTimeout(resolve, 1500));
  const getFrame = async () => (await page.$('#mirror-host iframe')).contentFrame();
  let frame = await getFrame();
  assert(frame);
  assert.equal(await frame.$eval('#trial-marker', node => node.textContent), marker);
  pass('local semantic DOM reconstruction');
  await frame.click('#change');
  await mirrorContains('Remote click confirmed');
  const remotePage = (await remote.pages()).find(candidate => candidate.url() === fixtureUrl);
  assert(remotePage);
  assert.equal(await remotePage.$eval('#result', node => node.textContent), 'Remote click confirmed');
  pass('click round trip and live DOM delta');
  frame = await getFrame();
  await frame.click('#echo');
  await page.keyboard.sendCharacter('中文输入验证');
  await remotePage.waitForFunction(() => document.querySelector('#echo').value === '中文输入验证', {timeout:15000});
  await mirrorContains('中文输入验证');
  pass('Chinese text input round trip');
  frame = await getFrame();
  const chooserPromise = page.waitForFileChooser({timeout:15000});
  await frame.click('#file');
  const chooser = await chooserPromise;
  await chooser.accept(['/tmp/trial-upload.txt']);
  try {
    await mirrorContains('remote-browser-upload-ok', 10000);
    assert.equal(await remotePage.$eval('#upload-result', node => node.textContent), 'remote-browser-upload-ok');
    pass('local file upload relayed to remote page');
  } catch (error) {
    report.uploadFailure = error.message;
    report.remoteUpload = await remotePage.$eval('#file', node => ({
      files:[...node.files].map(file=>({name:file.name,size:file.size})),
      result:document.querySelector('#upload-result').textContent
    }));
    process.exitCode = 1;
  }
  frame = await getFrame();
  await frame.click('#download');
  await page.waitForSelector('.download-save', {timeout:20000});
  const downloaded = await page.$eval('.download-save', async node => {
    const response = await fetch(node.href);
    return {status:response.status, body:await response.text()};
  });
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.body, 'remote-browser-download-ok');
  pass('remote download retrieved by authenticated local viewer');
  assert(report.deltas > 0);
  assert.equal(report.pixels, 0);
  await page.screenshot({path:'/runtime/gateway/trial-smoke.png'});
  await navigate('https://chatgpt.com/');
  await new Promise(resolve => setTimeout(resolve, 15000));
  report.chatgpt = await page.evaluate(() => ({
    url:document.querySelector('input[aria-label="Address"]')?.value,
    state:document.querySelector('#mirror-host')?.dataset.mirrorState,
    text:document.querySelector('#mirror-host iframe')?.contentDocument?.body?.innerText.slice(0,1000)
  }));
  await page.screenshot({path:'/runtime/gateway/trial-chatgpt.png'});
} catch (error) {
  report.failure = error.stack;
  if (page) {
    await page.screenshot({path:'/runtime/gateway/trial-failure.png'}).catch(()=>{});
    report.viewer = await page.evaluate(()=>({
      status:document.querySelector('#connection-state')?.outerHTML,
      mirror:document.querySelector('#mirror-host')?.outerHTML.slice(0,1200),
      body:document.body.innerText.slice(0,1200)
    })).catch(()=>null);
  }
  process.exitCode = 1;
} finally {
  console.log(JSON.stringify(report, null, 2));
  remote?.disconnect();
  if (viewer) await viewer.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
