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

test('uninstallAll reports partial failures, saveSettings refreshes on token change, and clearCache/getActivityLog work', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'openvst-service-log-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const cacheDir = path.join(dataDir, 'cache');
  await mkdir(cacheDir, { recursive: true });
  await mkdir(path.join(cacheDir, 'screenshots'), { recursive: true });

  const pluginA = { id: 'openA', repo: 'openA', name: 'Alpha', description: 'A', category: 'FX', bundleNames: { VST3: 'openA.vst3' } };
  let releaseCalls = 0;
  const client = {
    cacheDir,
    setToken() {},
    catalog: async () => ({ data: [pluginA], stale: false }),
    releases: async () => {
      releaseCalls++;
      return { data: [], stale: false, fetchedAt: 12345 };
    },
  };
  const installer = {
    paths: { VST3: '/tmp/plugins' },
    setPaths() {},
    detect: async () => [{ format: 'VST3', version: 'v1.0.0', path: '/tmp/plugins/openA.vst3', managed: true }],
    uninstall: async () => { throw new Error('Locked by DAW'); },
  };
  const service = new ManagerService({
    dataDir, client, installer, platform: 'win32', arch: 'x64',
    appVersion: '1.4.1', bundledCatalog: [pluginA],
  });

  await service.getState();
  assert.equal(releaseCalls, 1);

  await service.saveSettings({ githubToken: 'ghp_new_token' });
  assert.equal(releaseCalls, 2);

  await assert.rejects(() => service.uninstallAll(), /Removed 0 of 1 plugins; 1 failed \(Alpha: Locked by DAW\)/);
  const log = await service.getActivityLog();
  assert.ok(log.some(line => line.includes('uninstallAll (openA): Locked by DAW')));

  await service.clearCache();
  assert.equal(releaseCalls, 3);
});

test('GitHub HTTP rate limits keep offline false, fetchState bounds concurrency, log rotation keeps history, and enabling autoCheck triggers checkAppUpdate', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'openvst-service-v142-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const plugins = Array.from({ length: 12 }, (_, i) => ({
    id: `openP${i}`, repo: `openP${i}`, name: `Plugin ${i}`,
    description: 'FX', category: 'FX', bundleNames: { VST3: `openP${i}.vst3` },
  }));

  let inFlight = 0;
  let maxInFlight = 0;
  let rateLimited = false;
  let appChecks = 0;
  const client = {
    catalog: async () => ({ data: plugins, stale: false }),
    releases: async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 15));
      inFlight--;
      if (rateLimited) {
        return { data: [], stale: true, httpStatus: 403, error: 'GitHub rate limit reached. Try again later. Add a GitHub Token in Settings to raise the hourly limit.' };
      }
      return { data: [], stale: false, fetchedAt: 12345 };
    },
    appReleases: async () => {
      appChecks++;
      return { data: [], stale: false, fetchedAt: 12345 };
    },
  };
  const installer = { paths: { VST3: '/tmp/plugins' }, setPaths() {}, detect: async () => [] };
  const service = new ManagerService({
    dataDir, client, installer, platform: 'win32', arch: 'x64',
    appVersion: '1.4.2', bundledCatalog: plugins,
  });

  const initial = await service.getState();
  assert.equal(initial.offline, false);
  assert.ok(maxInFlight <= 6, `expected <= 6 concurrent release fetches, got ${maxInFlight}`);

  rateLimited = true;
  const limitedState = await service.refresh();
  assert.equal(limitedState.offline, false);
  assert.match(limitedState.error || '', /GitHub rate limit reached/i);

  await service.saveSettings({ autoCheckAppUpdates: false });
  const checksBeforeEnable = appChecks;
  await service.saveSettings({ autoCheckAppUpdates: true });
  assert.equal(appChecks, checksBeforeEnable + 1);

  const padding = 'x'.repeat(200);
  const { writeFile } = await import('node:fs/promises');
  const lines = Array.from({ length: 1200 }, (_, i) => `2026-11-18T00:00:00.000Z entry-${i} ${padding}\n`).join('');
  await writeFile(path.join(dataDir, 'activity.log'), lines, 'utf8');
  await service.log('final-entry');
  const log = await service.getActivityLog(500);
  assert.equal(log[0].includes('final-entry'), true);
  assert.ok(log.some(line => line.includes('entry-1199')), 'expected recent entries preserved on log rotation');

  await service.clearActivityLog();
  assert.deepEqual(await service.getActivityLog(), []);
});

test('installAll respects preferredFormats, blank backupFolder resets to default, and concurrent init deduplicates', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'openvst-service-pref-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const plugin = {
    id: 'openDual', repo: 'openDual', name: 'Dual', description: 'FX', category: 'FX',
    bundleNames: { VST3: 'openDual.vst3', AU: 'openDual.component' },
  };
  let detectCalls = 0;
  const installedFormats = [];
  t.mock.method(globalThis, 'fetch', async () => new Response('zipdata'));
  const client = {
    catalog: async () => ({ data: [plugin], stale: false }),
    releases: async () => ({
      data: [{
        tag_name: 'v1.0.0', published_at: '2026-11-18T00:00:00Z',
        assets: [
          { name: 'openDual-VST3-macOS.zip', browser_download_url: 'https://github.com/alanmarcero/openDual/releases/download/v1.0.0/openDual-VST3-macOS.zip', size: 7 },
          { name: 'openDual-AU-macOS.zip', browser_download_url: 'https://github.com/alanmarcero/openDual/releases/download/v1.0.0/openDual-AU-macOS.zip', size: 7 },
        ],
      }],
      stale: false, fetchedAt: 12345,
    }),
  };
  const installer = {
    paths: { VST3: '/tmp/vst3', AU: '/tmp/au' },
    setPaths() {},
    detect: async () => { detectCalls++; return []; },
    install: async (opts) => { installedFormats.push(...opts.formats); return []; },
  };
  const service = new ManagerService({
    dataDir, client, installer, platform: 'darwin', arch: 'arm64',
    appVersion: '1.4.3', bundledCatalog: [plugin],
  });

  await Promise.all([service.init(), service.init()]);
  await service.saveSettings({ preferredFormats: ['AU'], backupFolder: '   ' });
  const state = await service.getState();
  assert.equal(state.settings.backupFolder, path.join(dataDir, 'backups'));

  await service.installAll();
  assert.deepEqual(installedFormats, ['AU']);
  assert.ok(detectCalls >= 1);
});
