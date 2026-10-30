// Read-only production probe: never sends input, navigation, or viewport changes.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import WebSocket from 'ws';

const base='http://127.0.0.1:3000';
const login=await fetch(`${base}/gate`,{
  method:'POST',redirect:'manual',
  headers:{'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({password:process.env.MIRROR_ACCESS_PASSWORD}),
});
assert.equal(login.status,303);
const access=login.headers.getSetCookie().find(c=>c.startsWith('__Host-mirror-access='))?.split(';')[0];
assert(access);
const payload=Buffer.from(JSON.stringify({sid:'dev',role:'viewer',exp:Math.floor(Date.now()/1000)+120})).toString('base64url');
const signature=createHmac('sha256',Buffer.from(process.env.MIRROR_AUTH_SECRET)).update(payload,'ascii').digest('base64url');
const cookie=`${access}; __Host-mirror-session=${payload}.${signature}`;
const socket=new WebSocket('ws://127.0.0.1:3000/ws',{headers:{cookie}});
const assets=new Set();
const report={snapshots:0,pongs:0,assets:0,assetErrors:0,closedEarly:false};
let expectedClose=false;
socket.on('message',data=>{
  const message=JSON.parse(data.toString());
  if(message.t==='pong')report.pongs++;
  if(message.t==='snapshot'){
    report.snapshots++;
    for(const match of JSON.stringify(message.data).matchAll(/\/s\/dev\/a\/[A-Za-z0-9_-]+/g))assets.add(match[0]);
  }
});
socket.on('close',()=>{if(!expectedClose)report.closedEarly=true;});
await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('WebSocket open timeout')),5000);
  socket.once('open',()=>{clearTimeout(timer);resolve();});
  socket.once('error',error=>{clearTimeout(timer);reject(error);});
});
const ping=()=>socket.send(JSON.stringify({t:'ping',id:Date.now(),sentTs:Date.now()}));
ping();
const interval=setInterval(ping,2000);
try{
  await new Promise(resolve=>setTimeout(resolve,4000));
  for(const path of [...assets].slice(0,30)){
    try{
      const response=await fetch(`${base}${path}`,{headers:{cookie},signal:AbortSignal.timeout(5000)});
      if(response.ok)report.assets++;else report.assetErrors++;
      await response.body?.cancel();
    }catch{report.assetErrors++;}
  }
  await new Promise(resolve=>setTimeout(resolve,20000));
  assert(!report.closedEarly,'WebSocket disconnected unexpectedly');
  assert(report.pongs>=10,'Missing WebSocket ping responses');
  assert(report.snapshots>0,'No mirrored page snapshot received');
  const health=await(await fetch(`${base}/healthz`)).json();
  assert(health.ok&&health.browser);
  console.log(JSON.stringify({ok:true,...report}));
}finally{
  clearInterval(interval);expectedClose=true;socket.close();
}
