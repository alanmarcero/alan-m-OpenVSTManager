import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
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
test('rate limits keep the cached release notes',async t=>{
 let limited=false;
 const client=await setup(t,async()=>limited
  ? new Response('{}',{status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':'1790000000'}})
  : new Response(JSON.stringify([{tag_name:'v2.7.1',body:'Draws the sidechain.'}])));
 assert.equal((await client.releases('openDucker')).data[0].body,'Draws the sidechain.');
 limited=true;
 const cached=await client.releases('openDucker',{force:true});
 assert.equal(cached.stale,true);
 assert.match(cached.error,/rate limit/i);
 assert.equal(cached.data[0].body,'Draws the sidechain.');
});
test('offline screenshots use the bundled image, while a live image replaces it',async t=>{
 const bundled=await mkdtemp(path.join(tmpdir(),'openvst-bundled-'));
 t.after(()=>rm(bundled,{recursive:true,force:true}));
 const bundledPng=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x11]);
 const livePng=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x22]);
 await writeFile(path.join(bundled,'openDucker.png'),bundledPng);
 let mode='offline';
 const client=await setup(t,async url=>{
  assert.equal(url,'https://raw.githubusercontent.com/alanmarcero/openDucker/main/docs/screenshots/preview.png');
  if(mode==='offline')throw new Error('network down');
  if(mode==='limited')return new Response('{}',{status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':'1790000000'}});
  return new Response(livePng,{headers:{etag:'"live"'}});
 });
 client.bundledScreenshotsDir=bundled;
 const fallback=await client.screenshot('openDucker');
 assert.equal(fallback.bundled,true);
 assert.equal(fallback.stale,true);
 assert.match(fallback.error,/network down/);
 assert.deepEqual(fallback.data,bundledPng);
 mode='live';
 const live=await client.screenshot('openDucker',{force:true});
 assert.equal(live.stale,false);
 assert.equal(live.bundled,undefined);
 assert.deepEqual(live.data,livePng);
 mode='limited';
 const cached=await client.screenshot('openDucker',{force:true});
 assert.equal(cached.stale,true);
 assert.match(cached.error,/rate limit/i);
 assert.deepEqual(cached.data,livePng);
});
test('a rate-limited screenshot with no cache still shows the bundled image',async t=>{
 const bundled=await mkdtemp(path.join(tmpdir(),'openvst-bundled-'));
 t.after(()=>rm(bundled,{recursive:true,force:true}));
 const bundledPng=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x33]);
 await writeFile(path.join(bundled,'openHatter.png'),bundledPng);
 await writeFile(path.join(bundled,'openClapper.png'),Buffer.from('not an image'));
 const client=await setup(t,async()=>new Response('{}',{status:403,headers:{'x-ratelimit-remaining':'0'}}));
 client.bundledScreenshotsDir=bundled;
 const shot=await client.screenshot('openHatter',{includeData:false});
 assert.equal(shot.bundled,true);
 assert.equal(shot.data,undefined);
 assert.match(shot.version,/^[a-f0-9]{12}$/);
 assert.match(shot.error,/rate limit/i);
 await assert.rejects(()=>client.screenshot('openClapper'),/rate limit/i);
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
test('Authorization header is sent only to api.github.com and never to raw.githubusercontent.com',async t=>{
  const seen=[];
  const png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00]);
  const client=await setup(t,async(url,init)=>{
    seen.push({url,auth:init?.headers?.Authorization || null});
    if(url.includes('/catalog.json')){
      return new Response(JSON.stringify([{id:'openMaster',repo:'openMaster',name:'Master',description:'d',category:'Mastering',bundleNames:{VST3:'openMaster.vst3'}}]));
    }
    if(url.endsWith('.png')) return new Response(png);
    return new Response('[]');
  });
  client.setToken('ghp_secret_pat');
  await client.releases('openMaster');
  await client.catalog();
  await client.screenshot('openMaster');
  assert.equal(seen[0].auth,'Bearer ghp_secret_pat');
  assert.equal(seen[1].auth,null);
  assert.equal(seen[2].auth,null);
});
