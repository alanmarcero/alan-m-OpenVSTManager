import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {ManagerService} from '../core/service.mjs';
const plugin={id:'openMaster',repo:'openMaster',name:'Master',description:'Mastering plugin',category:'Mastering',bundleNames:{VST3:'openMaster.vst3'}};
async function setup(t){
 const dataDir=await mkdtemp(path.join(tmpdir(),'openvst-service-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
 const client={catalog:async()=>({data:[plugin],stale:false}),releases:async()=>({data:[],stale:false,fetchedAt:12345})};
 const installer={paths:{VST3:'/tmp/plugins'},setPaths(paths){this.paths={...this.paths,...paths};},detect:async()=>[]};
 return {service:new ManagerService({dataDir,client,installer,platform:'darwin',arch:'arm64',appVersion:'0.1.0',bundledCatalog:[plugin]}),dataDir,client};
}
test('state distinguishes no published release from a failed refresh',async t=>{
 const {service,client}=await setup(t);
 const first=await service.getState();assert.deepEqual(first.plugins[0].releases,[]);assert.equal(first.offline,false);
 client.releases=async()=>{throw new Error('Network disconnected');};
 const next=await service.refresh();assert.equal(next.offline,true);assert.match(next.plugins[0].error,/Network disconnected/);
});
test('settings persist and invalid plugin or format cannot reach install',async t=>{
 const {service,dataDir}=await setup(t);
 await service.saveSettings({includePrereleases:true,paths:{VST3:'/tmp/custom-vst3'}});
 const settings=JSON.parse(await readFile(path.join(dataDir,'settings.json'),'utf8'));
 assert.equal(settings.includePrereleases,true);assert.equal(settings.paths.VST3,'/tmp/custom-vst3');
 await assert.rejects(()=>service.install({id:'foreign-repo',tag:'v1',formats:['VST3']}),/Unknown plugin/);
 await assert.rejects(()=>service.install({id:'openMaster',tag:'v1',formats:['AU']}),/format/i);
 await assert.rejects(()=>service.saveSettings({includePrereleases:'yes'}),/boolean/);
});
test('state includes pathOptions with available folder options',async t=>{
 const {service}=await setup(t);
 const state=await service.getState();
 assert.ok(state.pathOptions?.VST3?.length);
 assert.equal(state.pathOptions.VST3[0].label,'User folder (~/Library)');
 assert.equal(state.pathOptions.VST3[1].path,'/Library/Audio/Plug-Ins/VST3');
});
test('failed activity logging cannot turn a committed operation into an error',async t=>{
 const {service}=await setup(t);await service.getState();
 service.log=async()=>{throw new Error('log is read-only');};
 let committed=false;
 const result=await service.operate('openMaster',async()=>{committed=true;});
 assert.equal(committed,true);assert.equal(result.plugins.length,1);
});

test('service routes move, moveAll, and overwrite/unmanaged flags correctly', async t => {
  const {service}=await setup(t);
  let installOptions = null;
  let moveOptions = null;
  let uninstallOptions = null;
  service.installer.install = async (opts) => { installOptions = opts; return []; };
  service.installer.move = async (opts) => { moveOptions = opts; return []; };
  service.installer.uninstall = async (opts) => { uninstallOptions = opts; return []; };
  service.installer.detect = async () => [{ format: 'VST3', version: 'v1', managed: true }];
  service.releases.set('openMaster', {
    data: [{ tag_name: 'v1.0.0', published_at: '2026-10-20T00:00:00Z', assets: [{ name: 'openMaster-macOS.zip', browser_download_url: 'https://example.com/asset.zip', size: 100 }] }],
    fetchedAt: 12345,
  });

  await service.move({ id: 'openMaster', formats: ['VST3'], overwrite: true });
  assert.equal(moveOptions.overwrite, true);
  assert.deepEqual(moveOptions.formats, ['VST3']);

  await service.moveAll();
  assert.ok(moveOptions);

  await service.uninstall({ id: 'openMaster', formats: ['VST3'], unmanaged: true });
  assert.equal(uninstallOptions.unmanaged, true);

  let uninstalledFormats = null;
  service.installer.uninstall = async (opts) => { uninstalledFormats = opts.formats; return []; };
  await service.uninstallAll();
  assert.deepEqual(uninstalledFormats, ['VST3']);
});
