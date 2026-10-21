import {open,rm} from 'node:fs/promises';
import {trustedAssetURL} from './releases.mjs';

const CDN_HOSTS=new Set(['release-assets.githubusercontent.com','objects.githubusercontent.com','github.com']);
export async function downloadAsset({asset,repo,destination,onProgress=()=>{},fetchImpl=fetch,maxBytes=512*1024*1024}) {
  if(!trustedAssetURL(asset.url,repo))throw new Error('Download is not a release from this plugin repository.');
  if(asset.size>maxBytes)throw new Error('Download exceeds the size limit.');
  let response,url=asset.url;
  const signal=AbortSignal.timeout(5*60*1000);
  for(let redirects=0;redirects<6;redirects++){
    response=await fetchImpl(url,{redirect:'manual',signal,headers:{'User-Agent':'OpenVSTManager/0.1.0'}});
    if(![301,302,303,307,308].includes(response.status))break;
    const target=new URL(response.headers.get('location'),url);
    if(target.protocol!=='https:' || target.port || target.username || target.password || !CDN_HOSTS.has(target.hostname))throw new Error('Refused an unsafe download redirect.');
    await response.body?.cancel();
    url=target.href;
  }
  if(!response?.ok || !response.body)throw new Error(`Download failed (${response?.status ?? 'no response'}). Try again.`);
  const length=Number(response.headers.get('content-length'));
  if(length>maxBytes) {await response.body.cancel();throw new Error('Download exceeds the size limit.');}
  const file=await open(destination,'wx',0o600);
  let bytes=0;
  try{
    for await(const chunk of response.body){
      bytes+=chunk.length;
      if(bytes>maxBytes)throw new Error('Download exceeds the size limit.');
      await file.writeFile(chunk);
      if(asset.size>0)onProgress(Math.min(100,Math.round(bytes/asset.size*100)));
    }
    if(!bytes || (asset.size>0 && bytes!==asset.size))throw new Error('Download is incomplete. Try again.');
    onProgress(100);
  }catch(error){await file.close();await rm(destination,{force:true});throw error;}
  await file.close();
}
