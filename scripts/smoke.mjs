import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temporary=await mkdtemp(path.join(tmpdir(),'openvst-desktop-'));
const pluginDir=path.join(temporary,'plugins');
await mkdir(pluginDir);
await writeFile(path.join(temporary,'settings.json'),JSON.stringify({includePrereleases:false,paths:{VST3:pluginDir,AU:path.join(temporary,'components')}}));
const app=await electron.launch({args:[root],env:{...process.env,OPENVST_DATA_DIR:temporary},timeout:30000});
try{
 const page=await app.firstWindow();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.getByRole('heading',{name:'Library',exact:true}).waitFor();
 await page.getByRole('button',{name:/openMaster Mastering/}).waitFor({timeout:90000});
 await mkdir(path.join(root,'docs','screenshots'),{recursive:true});
 await page.screenshot({path:path.join(root,'docs','screenshots','library.png')});
 const initial=await page.evaluate(()=>window.manager.getState());
 assert.equal(initial.plugins.length,7);
 assert.equal(initial.settings.paths.VST3,pluginDir);
 await page.getByRole('textbox',{name:'Search plugins'}).fill('openMaster');
 await page.getByRole('button',{name:/openMaster Mastering/}).click();
 await page.getByRole('button',{name:'Install plugin',exact:true}).click();
 await page.getByText('openMaster installed.',{exact:true}).waitFor({timeout:180000});

 let state=await page.evaluate(()=>window.manager.getState());
 const installed=state.plugins.find(p=>p.id==='openMaster').installed;
 assert.equal(installed.length,1);assert.equal(installed[0].managed,true);
 const version=installed[0].version;
 await access(installed[0].path);
 await page.screenshot({path:path.join(root,'docs','screenshots','installed.png')});
 await page.getByRole('button',{name:/Remove/}).click();
 await page.getByRole('dialog').getByRole('button',{name:/Remove/}).click();
 await page.getByText('openMaster removed.',{exact:true}).waitFor({timeout:30000});
 await assert.rejects(()=>access(installed[0].path));
 state=await page.evaluate(()=>window.manager.getState());assert.deepEqual(state.plugins.find(p=>p.id==='openMaster').installed,[]);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,platform:process.platform,version,plugins:initial.plugins.length,flow:'real GitHub download → UI install → receipt → UI removal',screenshots:['docs/screenshots/library.png','docs/screenshots/installed.png']},null,2));
}catch(error){
 const page=await app.firstWindow();
 console.error((await page.locator('body').innerText()).slice(0,7000));
 throw error;
}finally{await app.close();await rm(temporary,{recursive:true,force:true});}
