import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {ManagerService} from '../core/service.mjs';
const plugin={id:'openMaster',repo:'openMaster',name:'Master',description:'Mastering plugin',category:'Mastering',bundleNames:{VST3:'openMaster.vst3'}};
async function setup(t){
 const dataDir=await mkdtemp(path.join(tmpdir(),'openvst-service-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
 const client={catalog:async()=>({data:[plugin],stale:false}),releases:async()=>({data:[],stale:false,fetchedAt:12345})};
 const installer={paths:{VST3:'/tmp/plugins'},setPaths(paths){this.paths={...this.paths,...paths};},detect:async()=>[]};
 return {service:new ManagerService({dataDir,client,installer,platform:'darwin',arch:'arm64',appVersion:'1.1.0',bundledCatalog:[plugin]}),dataDir,client};
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

test('service routes installAll and updateAll correctly', async t => {
  const {service,client}=await setup(t);
  const installedPlugins = [];
  t.mock.method(globalThis, 'fetch', async () => new Response('hello'));
  service.installer.install = async (opts) => { installedPlugins.push(opts); return []; };
  service.installer.detect = async () => [];
  client.releases = async () => ({
    data: [{ tag_name: 'v1.0.0', published_at: '2026-10-20T00:00:00Z', assets: [{ name: 'openMaster-macOS.zip', browser_download_url: 'https://github.com/alanmarcero/openMaster/releases/download/v1.0.0/openMaster-macOS.zip', size: 5 }] }],
    stale: false,
    fetchedAt: 12345,
  });

  await service.installAll();
  assert.equal(installedPlugins.length, 1);
  assert.equal(installedPlugins[0].plugin.id, 'openMaster');
  assert.equal(installedPlugins[0].tag, 'v1.0.0');

  installedPlugins.length = 0;
  service.installer.detect = async () => [{ format: 'VST3', version: 'v0.9.0', managed: true }];
  await service.updateAll();
  assert.equal(installedPlugins.length, 1);
  assert.equal(installedPlugins[0].plugin.id, 'openMaster');
  assert.equal(installedPlugins[0].tag, 'v1.0.0');
  assert.equal(installedPlugins[0].overwrite, true);
});

test('service persists backupFolder, githubToken, preferredFormats, and handles app updates', async t => {
  const {service, dataDir, client}=await setup(t);
  const customBackup = path.join(dataDir, 'custom-backups');
  await service.saveSettings({
    backupFolder: customBackup,
    githubToken: 'ghp_test_token_123',
    preferredFormats: ['VST3'],
    autoCheckAppUpdates: true,
  });

  const state = await service.getState();
  assert.equal(state.settings.backupFolder, customBackup);
  assert.equal(state.settings.githubToken, 'ghp_test_token_123');
  assert.deepEqual(state.settings.preferredFormats, ['VST3']);
  assert.equal(state.settings.autoCheckAppUpdates, true);
  assert.ok(state.defaultBackupFolder);
  assert.ok(state.defaultPaths);

  client.appReleases = async () => ({
    data: [{
      tag_name: 'v2.0.0',
      assets: [{
        name: 'OpenVSTManager-2.0.0-mac-arm64.dmg',
        browser_download_url: 'https://github.com/alanmarcero/alan-m-OpenVSTManager/releases/download/v2.0.0/OpenVSTManager-2.0.0-mac-arm64.dmg',
        size: 50,
      }],
    }],
    stale: false,
    fetchedAt: 12345,
  });

  const update = await service.checkAppUpdate({ force: true });
  assert.equal(update.available, true);
  assert.equal(update.latestVersion, '2.0.0');
});
test('service attaches and auto-updates plugin screenshotUrl without failing on screenshot errors', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'openvst-service-shot-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let version = 'aaa111';
  let failShot = false;
  const client = {
    catalog: async () => ({ data: [plugin], stale: false }),
    releases: async () => ({ data: [], stale: false, fetchedAt: 12345 }),
    screenshot: async () => {
      if (failShot) throw new Error('404 Not Found');
      return { contentType: 'image/png', version, fetchedAt: 12345, stale: false };
    },
  };
  const installer = { paths: { VST3: '/tmp/plugins' }, setPaths() {}, detect: async () => [] };
  const service = new ManagerService({
    dataDir, client, installer, platform: 'win32', arch: 'x64',
    appVersion: '1.3.0', bundledCatalog: [plugin],
    screenshotBaseUrl: 'openvst://app/screenshots',
  });

  const first = await service.getState();
  assert.equal(first.plugins[0].screenshotUrl, 'openvst://app/screenshots/openMaster.png?v=aaa111');

  version = 'bbb222';
  const refreshed = await service.refresh();
  assert.equal(refreshed.plugins[0].screenshotUrl, 'openvst://app/screenshots/openMaster.png?v=bbb222');

  failShot = true;
  const resilient = await service.refresh();
  assert.equal(resilient.offline, false);
  assert.equal(resilient.plugins[0].screenshotUrl, 'openvst://app/screenshots/openMaster.png?v=bbb222');
});

test('init cleans up stale temp downloads and offline requires all plugins to be stale', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'openvst-service-clean-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const staleInstall = path.join(dataDir, 'downloads', 'install-old');
  const staleUpdate = path.join(dataDir, 'downloads', 'update-old');
  await mkdir(staleInstall, { recursive: true });
  await mkdir(staleUpdate, { recursive: true });

  const pluginA = { id: 'openA', repo: 'openA', name: 'A', description: 'A', category: 'FX', bundleNames: { VST3: 'openA.vst3' } };
  const pluginB = { id: 'openB', repo: 'openB', name: 'B', description: 'B', category: 'FX', bundleNames: { VST3: 'openB.vst3' } };
  const client = {
    catalog: async () => ({ data: [pluginA, pluginB], stale: false }),
    releases: async repo => {
      if (repo === 'openA') throw new Error('404 Not Found');
      return { data: [], stale: false, fetchedAt: 12345 };
    },
  };
  const installer = { paths: { VST3: '/tmp/plugins' }, setPaths() {}, detect: async () => [] };
  const service = new ManagerService({
    dataDir, client, installer, platform: 'win32', arch: 'x64',
    appVersion: '1.4.0', bundledCatalog: [pluginA, pluginB],
  });

  const state = await service.getState();
  await assert.rejects(() => access(staleInstall));
  await assert.rejects(() => access(staleUpdate));
  assert.equal(state.offline, false);
  assert.match(state.plugins[0].error, /404 Not Found/);
  assert.equal(state.plugins[1].error, undefined);
});

test('installAll and updateAll report partial failures accurately', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'openvst-service-batch-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const pluginA = { id: 'openA', repo: 'openA', name: 'Alpha', description: 'A', category: 'FX', bundleNames: { VST3: 'openA.vst3' } };
  const pluginB = { id: 'openB', repo: 'openB', name: 'Beta', description: 'B', category: 'FX', bundleNames: { VST3: 'openB.vst3' } };
  t.mock.method(globalThis, 'fetch', async () => new Response('zipdata'));
  const client = {
    catalog: async () => ({ data: [pluginA, pluginB], stale: false }),
    releases: async repo => ({
      data: [{
        tag_name: 'v1.0.0',
        published_at: '2026-10-20T00:00:00Z',
        assets: [{ name: `${repo}-Windows.zip`, browser_download_url: `https://github.com/alanmarcero/${repo}/releases/download/v1.0.0/${repo}-Windows.zip`, size: 7 }],
      }],
      stale: false,
      fetchedAt: 12345,
    }),
  };
  const installedIds = [];
  const installer = {
    paths: { VST3: '/tmp/plugins' },
    setPaths() {},
    detect: async () => [],
    install: async ({ plugin }) => {
      if (plugin.id === 'openB') throw new Error('File in use');
      installedIds.push(plugin.id);
      return [];
    },
  };
  const service = new ManagerService({
    dataDir, client, installer, platform: 'win32', arch: 'x64',
    appVersion: '1.4.0', bundledCatalog: [pluginA, pluginB],
  });

  await assert.rejects(() => service.installAll(), /Installed 1 of 2 plugins; 1 failed \(Beta: File in use\)/);
  assert.deepEqual(installedIds, ['openA']);
});
