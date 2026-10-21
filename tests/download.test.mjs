import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {downloadAsset} from '../core/download.mjs';
const url='https://github.com/alanmarcero/openMaster/releases/download/v1.0.0/openMaster-macOS.zip';
async function target(t){const dir=await mkdtemp(path.join(tmpdir(),'openvst-download-'));t.after(()=>rm(dir,{recursive:true,force:true}));return path.join(dir,'plugin.zip');}
test('streams release asset through approved CDN and reports completed bytes',async t=>{
 const destination=await target(t),progress=[];
 await downloadAsset({asset:{url,size:5},repo:'openMaster',destination,onProgress:p=>progress.push(p),fetchImpl:async input=>input===url?new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/a/file'}}):new Response('hello')});
 assert.equal(await readFile(destination,'utf8'),'hello');assert.equal(progress.at(-1),100);
});
test('refuses foreign redirects and incomplete or oversized downloads without leaving files',async t=>{
 const destination=await target(t);
 await assert.rejects(()=>downloadAsset({asset:{url,size:5},repo:'openMaster',destination,fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://evil.example/a'}})}),/redirect/i);
 await assert.rejects(()=>access(destination));
 await assert.rejects(()=>downloadAsset({asset:{url,size:10},repo:'openMaster',destination,fetchImpl:async()=>new Response('hello')}),/incomplete/i);
 await assert.rejects(()=>access(destination));
 await assert.rejects(()=>downloadAsset({asset:{url,size:5},repo:'openMaster',destination,maxBytes:4,fetchImpl:async()=>new Response('hello')}),/size limit/i);
});
