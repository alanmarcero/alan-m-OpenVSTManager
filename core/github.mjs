import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {readJSON,writeBinary,writeJSON} from './storage.mjs';
import {DEFAULT_SCREENSHOT_PATH,normalizeScreenshotPath,validateCatalog} from './releases.mjs';

const TTL = 5 * 60 * 1000;
const MAX_JSON = 8 * 1024 * 1024;
const MAX_IMAGE = 10 * 1024 * 1024;

function assertValidRepo(repo) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(repo) || repo.includes('..')) {
    throw new Error('Invalid repository.');
  }
}

function detectImageContentType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  throw new Error('GitHub returned an invalid screenshot image.');
}

async function readResponseBytes(response, maxBytes, overflowMessage) {
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error(overflowMessage);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function formatHttpError(response) {
  if (response.status === 401) {
    return new Error('GitHub rejected your token (401). Check or clear your GitHub Token in Settings.');
  }
  if (response.status === 403 || response.status === 429) {
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    return new Error(`GitHub rate limit reached. Try again ${reset ? 'after ' + new Date(reset * 1000).toLocaleTimeString() : 'in a few minutes'}.`);
  }
  if (response.status === 404) {
    return new Error('Plugin resource not found on GitHub (404).');
  }
  return new Error(`GitHub returned ${response.status}. Try refreshing again.`);
}

export class GitHubClient {
  constructor({cacheDir,fetchImpl=fetch,token=null,appVersion='1.4.0'}={}) {
    this.cacheDir=cacheDir;
    this.fetch=fetchImpl;
    this.token=token ? String(token).trim() : null;
    this.appVersion=appVersion;
  }
  setToken(token) {
    this.token = token ? String(token).trim() : null;
  }
  buildHeaders(accept, etag = null) {
    const headers = { Accept: accept, 'User-Agent': `OpenVSTManager/${this.appVersion}` };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (etag) headers['If-None-Match'] = etag;
    return headers;
  }
  async request(key,url,validate,{force=false}={}) {
    const file=path.join(this.cacheDir,`${key}.json`);
    const cached=await readJSON(file,null).catch(()=>null);
    if(cached && !force && Date.now()-cached.fetchedAt<TTL) return {...cached,stale:false};
    try {
      const headers=this.buildHeaders('application/vnd.github+json',cached?.etag);
      const response=await this.fetch(url,{headers,signal:AbortSignal.timeout(20_000),redirect:'error'});
      let data;
      if(response.status===304 && cached) data=cached.data;
      else {
        if(!response.ok) throw formatHttpError(response);
        const bytes=await readResponseBytes(response,MAX_JSON,'GitHub response exceeds the metadata size limit.');
        data=JSON.parse(bytes.toString('utf8'));
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
  async screenshot(repo,pathOrOptions=DEFAULT_SCREENSHOT_PATH,maybeOptions={}) {
    assertValidRepo(repo);
    const hasPathArg = typeof pathOrOptions === 'string' || pathOrOptions == null;
    const screenshotPath = normalizeScreenshotPath(hasPathArg ? pathOrOptions : DEFAULT_SCREENSHOT_PATH);
    const {force=false,includeData=true} = (hasPathArg ? maybeOptions : pathOrOptions) || {};
    const base=path.join(this.cacheDir,'screenshots',repo);
    const metaFile=`${base}.json`;
    const binFile=`${base}.bin`;
    const cachedMeta=await readJSON(metaFile,null).catch(()=>null);
    const samePath=cachedMeta?.screenshotPath===screenshotPath;
    const cachedBuffer=samePath ? await readFile(binFile).catch(()=>null) : null;
    const cachedValid=Boolean(samePath && cachedBuffer && cachedMeta?.version && cachedMeta?.contentType);
    if(cachedValid && !force && Date.now()-cachedMeta.fetchedAt<TTL) {
      return {contentType:cachedMeta.contentType,version:cachedMeta.version,fetchedAt:cachedMeta.fetchedAt,stale:false,...(includeData?{data:cachedBuffer}:{})};
    }
    try {
      const url=`https://raw.githubusercontent.com/alanmarcero/${repo}/main/${screenshotPath}`;
      const headers=this.buildHeaders('image/png,image/jpeg,image/webp,image/*',cachedValid?cachedMeta.etag:null);
      const response=await this.fetch(url,{headers,signal:AbortSignal.timeout(20_000),redirect:'error'});
      let data,contentType,version;
      if(response.status===304 && cachedValid) {
        data=cachedBuffer;
        contentType=cachedMeta.contentType;
        version=cachedMeta.version;
      } else {
        if(!response.ok) throw formatHttpError(response);
        data=await readResponseBytes(response,MAX_IMAGE,'GitHub screenshot exceeds the size limit.');
        contentType=detectImageContentType(data);
        version=createHash('sha256').update(data).digest('hex').slice(0,12);
        await writeBinary(binFile,data);
      }
      const fetchedAt=Date.now();
      const meta={etag:response.headers.get('etag') || (cachedValid ? cachedMeta.etag : null),fetchedAt,contentType,screenshotPath,version};
      await writeJSON(metaFile,meta);
      return {contentType,version,fetchedAt,stale:false,...(includeData?{data}:{})};
    } catch(error) {
      if(cachedValid) return {contentType:cachedMeta.contentType,version:cachedMeta.version,fetchedAt:cachedMeta.fetchedAt,stale:true,error:error.message,...(includeData?{data:cachedBuffer}:{})};
      throw error;
    }
  }
  releases(repo,options) {
    assertValidRepo(repo);
    return this.request(`releases-${repo}`,`https://api.github.com/repos/alanmarcero/${repo}/releases?per_page=100`,data=>{
      if(!Array.isArray(data))throw new Error('GitHub returned an invalid release list.');
    },options);
  }
  catalog(options) {
    return this.request('catalog','https://raw.githubusercontent.com/alanmarcero/alan-m-OpenVSTManager/main/catalog.json',validateCatalog,options);
  }
  appReleases(options) {
    return this.request('releases-OpenVSTManager','https://api.github.com/repos/alanmarcero/alan-m-OpenVSTManager/releases?per_page=50',data=>{
      if(!Array.isArray(data))throw new Error('GitHub returned an invalid release list.');
    },options);
  }
}
