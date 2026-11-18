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
test('screenshots cache via ETag, update version when bytes change, and reject invalid payloads',async t=>{
 const png1=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00,0x00,0x01]);
 const png2=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00,0x00,0x02]);
 let mode='first',seenIfNoneMatch=null;
 const client=await setup(t,async(url,init)=>{
  assert.equal(url,'https://raw.githubusercontent.com/alanmarcero/openEDMDelay/main/docs/screenshots/preview.png');
  seenIfNoneMatch=init?.headers?.['If-None-Match'] || null;
  if(mode==='first')return new Response(png1,{headers:{etag:'"v1"'}});
  if(mode==='not-modified')return new Response(null,{status:304,headers:{etag:'"v1"'}});
  if(mode==='updated')return new Response(png2,{headers:{etag:'"v2"'}});
  if(mode==='invalid')return new Response('not-an-image');
  throw new Error('network down');
 });
 const first=await client.screenshot('openEDMDelay');
 assert.equal(first.contentType,'image/png');
 assert.deepEqual(first.data,png1);
 assert.equal(first.stale,false);
 mode='not-modified';
 const same=await client.screenshot('openEDMDelay',{force:true});
 assert.equal(seenIfNoneMatch,'"v1"');
 assert.equal(same.version,first.version);
 assert.deepEqual(same.data,png1);
 mode='invalid';
 const fallback=await client.screenshot('openEDMDelay',{force:true});
 assert.equal(fallback.stale,true);
 assert.equal(fallback.version,first.version);
 mode='updated';
 const updated=await client.screenshot('openEDMDelay',{force:true});
 assert.notEqual(updated.version,first.version);
 assert.deepEqual(updated.data,png2);
 mode='offline';
 const offline=await client.screenshot('openEDMDelay',{force:true});
 assert.equal(offline.stale,true);
 assert.deepEqual(offline.data,png2);
});
test('401 unauthorized surfaces an actionable GitHub token error',async t=>{
  const client=await setup(t,async()=>new Response('{}',{status:401}));
  client.setToken('bad_token');
  await assert.rejects(()=>client.releases('openMaster'),/token.*401|rejected your token/i);
});
test('Content-Length pre-check rejects oversized responses before reading body and 403 distinguishes access denied from rate limit',async t=>{
  let bodyRead=false;
  const oversized=await setup(t,async()=>({
    ok:true,
    status:200,
    headers:new Headers({'content-length':String(9*1024*1024)}),
    body:{
      async cancel(){},
      async *[Symbol.asyncIterator](){bodyRead=true;yield Buffer.from('[]');}
    }
  }));
  await assert.rejects(()=>oversized.releases('openMaster'),/exceeds the metadata size limit/);
  assert.equal(bodyRead,false);

  const forbidden=await setup(t,async()=>new Response('{}',{status:403}));
  await assert.rejects(()=>forbidden.releases('openMaster'),err=>{
    assert.equal(err.httpStatus,403);
    assert.match(err.message,/denied access \(403\)/i);
    assert.doesNotMatch(err.message,/rate limit/i);
    return true;
  });

  const limitedAnon=await setup(t,async()=>new Response('{}',{status:403,headers:{'x-ratelimit-remaining':'0'}}));
  await assert.rejects(()=>limitedAnon.releases('openMaster'),/GitHub Token in Settings/i);
});
