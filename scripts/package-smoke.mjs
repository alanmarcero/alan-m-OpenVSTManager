import {_electron as electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const executablePath=process.platform==='win32'
  ? path.resolve('release/win-unpacked/OpenVST Manager.exe')
  : path.resolve(`release/mac${process.arch==='arm64'?'-arm64':''}/OpenVST Manager.app/Contents/MacOS/OpenVST Manager`);
const temporary=await mkdtemp(path.join(tmpdir(),'openvst-package-'));
let application;
try{
  application=await electron.launch({executablePath,env:{...process.env,OPENVST_DATA_DIR:temporary},timeout:60000});
  const page=await application.firstWindow();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.getByRole('button',{name:'Settings',exact:true}).waitFor({timeout:90000});
  const state=await page.evaluate(()=>window.manager.getState());
  assert.equal(state.plugins.length,7);
  assert.equal(await application.evaluate(({app})=>app.isPackaged),true);
  assert.equal(await application.evaluate(({app})=>app.getPath('userData')),temporary);
  await page.getByRole('button',{name:'Cyberpunk',exact:true}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('heading',{name:'Installation folders'}).waitFor();
  await page.reload();
  await page.getByRole('button',{name:'Cyberpunk',exact:true}).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'cyberpunk');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({packaged:true,platform:process.platform,arch:process.arch,plugins:state.plugins.length,themePersistence:true}));
}finally{
  if(application)await application.close();
  await rm(temporary,{recursive:true,force:true});
}
