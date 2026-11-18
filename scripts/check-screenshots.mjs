// Verifies every catalog plugin's screenshot is reachable and valid on GitHub.
// Uses the same GitHubClient.screenshot() path as the app (redirect: 'error',
// PNG/JPEG/WebP magic bytes, 10 MiB cap), so anything that would break in the
// app (404, repo rename redirect, bad image) fails here.
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {GitHubClient} from '../core/github.mjs';
import {validateCatalog,DEFAULT_SCREENSHOT_PATH} from '../core/releases.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const catalog=validateCatalog(JSON.parse(await readFile(path.join(root,'catalog.json'),'utf8')));
const cacheDir=await mkdtemp(path.join(tmpdir(),'openvst-shots-'));
const client=new GitHubClient({cacheDir,token:process.env.GITHUB_TOKEN||null});
const failures=[];
try{
  for(const plugin of catalog){
    try{
      const shot=await client.screenshot(plugin.repo,plugin.screenshotPath,{force:true,includeData:true});
      if(shot.stale)throw new Error(shot.error||'served from stale cache');
      console.log(`ok   ${plugin.id.padEnd(32)} ${shot.contentType} ${shot.data.length} bytes (${plugin.screenshotPath})`);
      if(plugin.screenshotPath!==DEFAULT_SCREENSHOT_PATH)console.warn(`warn ${plugin.id}: non-standard screenshotPath ${plugin.screenshotPath}`);
    }catch(error){
      failures.push(plugin.id);
      console.error(`FAIL ${plugin.id.padEnd(32)} https://raw.githubusercontent.com/alanmarcero/${plugin.repo}/main/${plugin.screenshotPath} -> ${error.message}`);
    }
  }
}finally{await rm(cacheDir,{recursive:true,force:true});}
if(failures.length){console.error(`\n${failures.length} of ${catalog.length} screenshots failed: ${failures.join(', ')}`);process.exit(1);}
console.log(`\nAll ${catalog.length} catalog screenshots are valid.`);
