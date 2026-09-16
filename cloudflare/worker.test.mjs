import test from 'node:test';
import assert from 'node:assert/strict';
import {handle, origins} from './worker.mjs';
function mock(aws,azure,fail=false) {
 const calls=[];
 const send=async (url,opts)=>{
  calls.push({url,opts});
  if(url.endsWith('/health')) {
   const server=url.startsWith(origins.aws)?'aws':'azure';
   const up=server==='aws'?aws:azure;
   return Response.json({status:up?'healthy':'degraded',db:up?'connected':'down',server},{status:up?200:503});
  }
  if(fail) throw Error('interrupted');
  return new Response('ok',{headers:{Location:origins.azure+'/dashboard'}});
 };
 return {send,calls};
}
test('uses AWS when healthy',async()=>{const m=mock(true,true);const r=await handle(new Request('https://gateway.test/login'),m.send);assert.equal(r.headers.get('X-NovaPay-Cloud'),'aws');});
test('uses Azure when AWS fails',async()=>{const m=mock(false,true);const r=await handle(new Request('https://gateway.test/login?a=1&a=2'),m.send);assert.equal(r.headers.get('X-NovaPay-Cloud'),'azure');assert.equal(r.headers.get('Location'),'https://gateway.test/dashboard');assert.ok(m.calls.at(-1).url.endsWith('?a=1&a=2'));});
test('both down returns 503 without forwarding',async()=>{const m=mock(false,false);const r=await handle(new Request('https://gateway.test/'),m.send);assert.equal(r.status,503);assert.equal(m.calls.length,2);});
test('never replays a POST after connection failure',async()=>{const m=mock(true,true,true);const r=await handle(new Request('https://gateway.test/transfer',{method:'POST',body:'amount=1'}),m.send);assert.equal(r.status,502);assert.equal(m.calls.filter(c=>c.opts.method==='POST').length,1);});
test('rejects manual routing',async()=>{const m=mock(true,true);const r=await handle(new Request('https://gateway.test/proxy/update-routing',{method:'POST'}),m.send);assert.equal(r.status,409);assert.equal(m.calls.length,0);});
test('translates legitimate login origin and preserves CSRF token',async()=>{const m=mock(true,true);await handle(new Request('https://gateway.test/api/auth/login',{method:'POST',headers:{Origin:'https://gateway.test',Referer:'https://gateway.test/login','X-CSRF-Token':'test-token'},body:'{}'}),m.send);const h=m.calls.at(-1).opts.headers;assert.equal(h.get('Origin'),origins.aws);assert.equal(h.get('Referer'),origins.aws+'/login');assert.equal(h.get('X-CSRF-Token'),'test-token');});
test('rejects foreign login origin before forwarding',async()=>{const m=mock(true,true);const r=await handle(new Request('https://gateway.test/api/auth/login',{method:'POST',headers:{Origin:'https://evil.test'},body:'{}'}),m.send);assert.equal(r.status,403);assert.equal(m.calls.length,0);});
test('rejects foreign referrer without Origin header',async()=>{const m=mock(true,true);const r=await handle(new Request('https://gateway.test/api/auth/login',{method:'POST',headers:{Referer:origins.aws+'/login'},body:'{}'}),m.send);assert.equal(r.status,403);assert.equal(m.calls.length,0);});
