import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {GitHubClient} from '../core/github.mjs';

async function setup(t,fetchImpl) {
 const cacheDir=await mkdtemp(path.join(tmpdir(),'openvst-cache-'));
 t.after(()=>rm(cacheDir,{recursive:true,force:true}));
 return new GitHubClient({cacheDir,fetchImpl});
}
test('public releases are cached and remain available when GitHub is offline',async t=>{
 let offline=false,calls=0;
 const client=await setup(t,async url=>{
  assert.equal(url,'https://api.github.com/repos/alanmarcero/openMaster/releases?per_page=100');
  calls++; if(offline)throw new Error('network down');
  return new Response(JSON.stringify([{tag_name:'v1.0.0'}]),{headers:{etag:'abc'}});
 });
 assert.equal((await client.releases('openMaster')).data[0].tag_name,'v1.0.0');
 await client.releases('openMaster'); assert.equal(calls,1);
 offline=true;
 const cached=await client.releases('openMaster',{force:true});
 assert.equal(cached.stale,true);assert.equal(cached.data[0].tag_name,'v1.0.0');
 assert.match(cached.error,/network down/);
});
test('a repo with no releases returns an empty list while rate limits surface actionable errors',async t=>{
 let limited=false;
 const client=await setup(t,async()=>limited?new Response('{}',{status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':'1790000000'}}):new Response('[]'));
 assert.deepEqual((await client.releases('openMaster')).data,[]);
 limited=true;
 const cached=await client.releases('openMaster',{force:true});
 assert.match(cached.error,/rate limit/i);
 await assert.rejects(()=>client.releases('openGlitchFX'),/rate limit/i);
});
test('invalid network JSON never replaces a usable cached release list',async t=>{
 let broken=false;
 const client=await setup(t,async()=>new Response(broken?'{}':'[{"tag_name":"v1.0.0"}]'));
 await client.releases('openMaster');broken=true;
 const result=await client.releases('openMaster',{force:true});
 assert.equal(result.stale,true);assert.equal(result.data[0].tag_name,'v1.0.0');
});
test('release notes preserve multibyte text split across network chunks',async t=>{
 const bytes=Buffer.from('[{"body":"Café"}]');
 const split=bytes.indexOf(0xc3)+1;
 const client=await setup(t,async()=>new Response(new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,split));controller.enqueue(bytes.subarray(split));controller.close();}})));
 assert.equal((await client.releases('openMaster')).data[0].body,'Café');
});
