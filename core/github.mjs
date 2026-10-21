import path from 'node:path';
import {readJSON,writeJSON} from './storage.mjs';
import {validateCatalog} from './releases.mjs';

const TTL = 5 * 60 * 1000;
const MAX_JSON = 8 * 1024 * 1024;
export class GitHubClient {
  constructor({cacheDir,fetchImpl=fetch}) { this.cacheDir=cacheDir;this.fetch=fetchImpl; }
  async request(key,url,validate,{force=false}={}) {
    const file=path.join(this.cacheDir,`${key}.json`);
    const cached=await readJSON(file,null).catch(()=>null);
    if(cached && !force && Date.now()-cached.fetchedAt<TTL) return {...cached,stale:false};
    try {
      const headers={Accept:'application/vnd.github+json','User-Agent':'OpenVSTManager/0.1.0'};
      if(cached?.etag)headers['If-None-Match']=cached.etag;
      const response=await this.fetch(url,{headers,signal:AbortSignal.timeout(20_000),redirect:'error'});
      let data;
      if(response.status===304 && cached) data=cached.data;
      else {
        if(!response.ok){
          if(response.status===403 || response.status===429) {
            const reset=Number(response.headers.get('x-ratelimit-reset'));
            throw new Error(`GitHub rate limit reached. Try again ${reset ? 'after '+new Date(reset*1000).toLocaleTimeString() : 'in a few minutes'}.`);
          }
          throw new Error(`GitHub returned ${response.status}. Try refreshing again.`);
        }
        let text='',bytes=0;
        const decoder=new TextDecoder('utf-8',{fatal:true});
        for await(const chunk of response.body){ bytes+=chunk.length;if(bytes>MAX_JSON)throw new Error('GitHub response exceeds the metadata size limit.');text+=decoder.decode(chunk,{stream:true}); }
        data=JSON.parse(text+decoder.decode());
      }
      validate(data);
      const result={data,etag:response.headers.get('etag') || cached?.etag || null,fetchedAt:Date.now()};
      await writeJSON(file,result);
      return {...result,stale:false};
    }catch(error){
      if(cached){validate(cached.data);return {...cached,stale:true,error:error.message};}
      throw error;
    }
  }
  releases(repo,options) {
    if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(repo)||repo.includes('..'))throw new Error('Invalid repository.');
    return this.request(`releases-${repo}`,`https://api.github.com/repos/alanmarcero/${repo}/releases?per_page=100`,data=>{
      if(!Array.isArray(data))throw new Error('GitHub returned an invalid release list.');
    },options);
  }
  catalog(options) {
    return this.request('catalog','https://raw.githubusercontent.com/alanmarcero/alan-m-OpenVSTManager/main/catalog.json',validateCatalog,options);
  }
}
