import {mkdtemp,mkdir,readdir,readFile,rm,appendFile,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import {readJSON,writeJSON} from './storage.mjs';
import {validateCatalog,normalizeReleases,selectAsset} from './releases.mjs';
import {downloadAsset} from './download.mjs';
import {standardPathOptions,defaultPaths} from './installer.mjs';
import {findAppUpdate,downloadAppUpdate,applyAppUpdate} from './updater.mjs';

const FETCH_CONCURRENCY = 6;

async function mapWithConcurrency(items, limit, worker) {
  const queue = items.entries();
  const count = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({length: count}, async () => {
    for (const [, item] of queue) {
      await worker(item);
    }
  }));
}

export class ManagerService {
  constructor({dataDir,client,installer,platform=process.platform,arch=process.arch,appVersion,bundledCatalog,screenshotBaseUrl=null,onProgress=()=>{}}) {
    Object.assign(this,{dataDir,client,installer,platform,arch,appVersion,screenshotBaseUrl,onProgress});
    this.catalog=validateCatalog(bundledCatalog);this.releases=new Map();this.screenshots=new Map();this.settings=null;this.loaded=false;this.busy=false;
    this.appUpdate=null;
  }
  async cleanupTempDownloads(){
    const tempRoot=path.join(this.dataDir,'downloads');
    const entries=await readdir(tempRoot,{withFileTypes:true}).catch(()=>[]);
    await Promise.allSettled(
      entries
        .filter(entry=>entry.isDirectory() && (entry.name.startsWith('install-') || entry.name.startsWith('update-')))
        .map(entry=>rm(path.join(tempRoot,entry.name),{recursive:true,force:true}))
    );
  }
  async init(){
    if(this.settings)return;
    if(this.initializing)return this.initializing;
    this.initializing=(async()=>{
      const saved=await readJSON(path.join(this.dataDir,'settings.json'),{});
      this.validateSettings(saved);
      this.installer.setPaths(saved.paths || {});
      const defaultBackup=path.join(this.dataDir,'backups');
      const resolvedBackup=typeof saved.backupFolder==='string'&&saved.backupFolder.trim()?saved.backupFolder.trim():defaultBackup;
      if(this.installer.setBackupFolder) this.installer.setBackupFolder(resolvedBackup);
      const resolvedToken=typeof saved.githubToken==='string'?saved.githubToken.trim():'';
      if(this.client.setToken) this.client.setToken(resolvedToken);
      this.settings={
        includePrereleases:saved.includePrereleases ?? false,
        autoCheckAppUpdates:saved.autoCheckAppUpdates ?? true,
        paths:{...this.installer.paths},
        backupFolder:resolvedBackup,
        preferredFormats:Array.isArray(saved.preferredFormats) ? saved.preferredFormats : (this.platform==='darwin'?['VST3','AU']:['VST3']),
        githubToken:resolvedToken,
      };
      await this.cleanupTempDownloads().catch(()=>{});
    })();
    try{return await this.initializing;}finally{this.initializing=null;}
  }
  async getState(){
    await this.init();
    if(!this.loaded)return this.refresh();
    const plugins=await Promise.all(this.catalog.map(async plugin=>{
      const result=this.releases.get(plugin.id);
      const screenshot=this.screenshots.get(plugin.id);
      const screenshotUrl=this.screenshotBaseUrl && screenshot?.version
        ? `${this.screenshotBaseUrl}/${encodeURIComponent(plugin.id)}.png?v=${screenshot.version}`
        : undefined;
      return {...plugin,formats:Object.keys(plugin.bundleNames).filter(f=>f==='VST3'||this.platform==='darwin'),
        installed:await this.installer.detect(plugin),
        releases:normalizeReleases(result?.data || [],{platform:this.platform,arch:this.arch,repo:plugin.repo,includePrereleases:this.settings.includePrereleases}),
        ...(screenshotUrl ? {screenshotUrl} : {}),
        ...(result?.error ? {error:result.error} : {})};
    }));
    const releaseEntries=[...this.releases.values()];
    const fetched=releaseEntries.map(r=>r.fetchedAt).filter(Boolean);
    const allReleasesStale=releaseEntries.length>0 && releaseEntries.every(r=>r.stale);
    const hasHttpErrorResponse=releaseEntries.some(r=>Number.isInteger(r?.httpStatus)||/GitHub (?:rate limit|rejected|denied|returned \d+)|not found on GitHub/i.test(r?.error||''));
    const appUpdateHttpError=Number.isInteger(this.appUpdate?.httpStatus)||/GitHub (?:rate limit|rejected|denied|returned \d+)/i.test(this.appUpdate?.error||'');
    const offline=allReleasesStale && !hasHttpErrorResponse && !appUpdateHttpError;
    const topLevelError=this.catalogError || (!offline && allReleasesStale ? releaseEntries.find(r=>r.error)?.error : undefined);
    return {
      platform:this.platform,
      arch:this.arch,
      appVersion:this.appVersion,
      settings:this.settings,
      plugins,
      pathOptions:standardPathOptions({platform:this.platform}),
      defaultPaths:defaultPaths({platform:this.platform}),
      defaultBackupFolder:path.join(this.dataDir,'backups'),
      appUpdate:this.appUpdate,
      lastChecked:fetched.length?new Date(Math.min(...fetched)).toISOString():null,
      offline,
      ...(topLevelError ? {error:topLevelError} : {})
    };
  }
  async refresh(){
    if(this.refreshing)return this.refreshing;
    this.refreshing=this.fetchState();
    try{return await this.refreshing;}finally{this.refreshing=null;}
  }
  async fetchState(){
    await this.init();
    const force=this.loaded;
    try{
      const result=await this.client.catalog({force});
      this.catalog=validateCatalog(result.data);
      this.catalogError=result.stale && result.error && (Number.isInteger(result.httpStatus) || /GitHub/i.test(result.error)) ? result.error : null;
    }catch(error){this.catalogError=`Using the bundled plugin list. ${error.message}`;}
    await Promise.all([
      mapWithConcurrency(this.catalog,FETCH_CONCURRENCY,async plugin=>{
        try{this.releases.set(plugin.id,await this.client.releases(plugin.repo,{force}));}
        catch(error){
          this.releases.set(plugin.id,{
            ...this.releases.get(plugin.id),
            data:this.releases.get(plugin.id)?.data || [],
            stale:true,
            error:error.message,
            ...(Number.isInteger(error?.httpStatus)?{httpStatus:error.httpStatus}:{})
          });
        }
        if(typeof this.client.screenshot==='function'){
          try{
            const shot=await this.client.screenshot(plugin.repo,plugin.screenshotPath,{force,includeData:false});
            this.screenshots.set(plugin.id,shot);
          }catch{}
        }
      }),
      ...(this.settings.autoCheckAppUpdates ? [this.checkAppUpdate({force}).catch(()=>{})] : []),
    ]);
    this.loaded=true;
    return this.getState();
  }
  async checkAppUpdate({force=false}={}){
    await this.init();
    try{
      const result=await this.client.appReleases({force});
      this.appUpdate=findAppUpdate({
        currentVersion:this.appVersion,
        platform:this.platform,
        arch:this.arch,
        releases:result?.data || [],
        includePrereleases:this.settings.includePrereleases
      });
      return this.appUpdate;
    }catch(error){
      this.appUpdate={available:false,currentVersion:this.appVersion,latestVersion:this.appVersion,error:error.message,...(Number.isInteger(error?.httpStatus)?{httpStatus:error.httpStatus}:{})};
      return this.appUpdate;
    }
  }
  async installAppUpdate(){
    await this.init();
    if(this.busy)throw new Error('Another plugin operation is running. Wait for it to finish.');
    if(!this.appUpdate?.available || !this.appUpdate.asset){
      await this.checkAppUpdate({force:true});
    }
    if(!this.appUpdate?.available || !this.appUpdate.asset){
      throw new Error('No OpenVST Manager update is available.');
    }
    return this.operate('manager-update',async()=>{
      const tempRoot=path.join(this.dataDir,'downloads');await mkdir(tempRoot,{recursive:true});
      const temporary=await mkdtemp(path.join(tempRoot,'update-'));
      try{
        this.progress('manager-update','downloading-update',`Downloading OpenVST Manager v${this.appUpdate.latestVersion}`,0);
        const installerPath=await downloadAppUpdate({
          asset:this.appUpdate.asset,
          checksumAsset:this.appUpdate.checksumAsset,
          tempDir:temporary,
          appVersion:this.appVersion,
          onProgress:percent=>this.progress('manager-update','downloading-update',`Downloading OpenVST Manager v${this.appUpdate.latestVersion}`,percent),
          fetchImpl:this.client.fetch
        });
        this.progress('manager-update','installing-update','Launching OpenVST Manager update installer',100);
        const launched=applyAppUpdate({installerPath,platform:this.platform});
        return {success:true,launched,installerPath};
      }catch(error){
        await rm(temporary,{recursive:true,force:true}).catch(()=>{});
        throw error;
      }
    });
  }
  validateSettings(patch){
    if(!patch || typeof patch!=='object' || Array.isArray(patch))throw new Error('Invalid settings.');
    if(patch.includePrereleases!==undefined && typeof patch.includePrereleases!=='boolean')throw new Error('Prerelease setting must be boolean.');
    if(patch.autoCheckAppUpdates!==undefined && typeof patch.autoCheckAppUpdates!=='boolean')throw new Error('Auto check app updates setting must be boolean.');
    if(patch.backupFolder!==undefined && (typeof patch.backupFolder!=='string'||patch.backupFolder.includes('\0')||(patch.backupFolder.trim() && !path.isAbsolute(patch.backupFolder.trim()))))throw new Error('Choose an absolute backup folder.');
    if(patch.githubToken!==undefined && typeof patch.githubToken!=='string')throw new Error('GitHub token must be a string.');
    if(patch.preferredFormats!==undefined){
      if(!Array.isArray(patch.preferredFormats) || patch.preferredFormats.some(f=>!['VST3','AU'].includes(f)))throw new Error('Invalid preferred formats.');
    }
    if(patch.paths!==undefined){
      if(!patch.paths || typeof patch.paths!=='object' || Array.isArray(patch.paths))throw new Error('Invalid plugin folders.');
      for(const [format,folder] of Object.entries(patch.paths)){
        if(!['VST3','AU'].includes(format)||typeof folder!=='string'||!folder.trim()||!path.isAbsolute(folder.trim())||folder.includes('\0'))throw new Error('Choose an absolute plugin folder.');
      }
    }
  }
  async saveSettings(patch){
    if(this.busy)throw new Error('Wait for the current installation to finish before changing folders.');
    await this.init();this.validateSettings(patch);
    const trimmedPaths=patch.paths?Object.fromEntries(Object.entries(patch.paths).map(([f,p])=>[f,p.trim()])):{};
    const defaultBackup=path.join(this.dataDir,'backups');
    const nextBackupFolder=patch.backupFolder!==undefined?(patch.backupFolder.trim()||defaultBackup):this.settings.backupFolder;
    const nextToken=patch.githubToken!==undefined?patch.githubToken.trim():this.settings.githubToken;
    const next={
      includePrereleases:patch.includePrereleases ?? this.settings.includePrereleases,
      autoCheckAppUpdates:patch.autoCheckAppUpdates ?? this.settings.autoCheckAppUpdates,
      paths:{...this.settings.paths,...trimmedPaths},
      backupFolder:nextBackupFolder,
      preferredFormats:patch.preferredFormats ?? this.settings.preferredFormats,
      githubToken:nextToken,
    };
    this.installer.setPaths(next.paths);
    if(this.installer.setBackupFolder) this.installer.setBackupFolder(next.backupFolder);
    if(this.client.setToken) this.client.setToken(next.githubToken);
    try{await writeJSON(path.join(this.dataDir,'settings.json'),next);}
    catch(error){
      this.installer.setPaths(this.settings.paths);
      if(this.installer.setBackupFolder) this.installer.setBackupFolder(this.settings.backupFolder);
      if(this.client.setToken) this.client.setToken(this.settings.githubToken);
      throw error;
    }
    const tokenChanged=next.githubToken!==this.settings.githubToken;
    const enabledAutoCheck=!this.settings.autoCheckAppUpdates && next.autoCheckAppUpdates;
    const prereleaseChanged=next.includePrereleases!==this.settings.includePrereleases;
    this.settings=next;
    if(this.loaded && tokenChanged){
      return this.refresh();
    }
    if(this.loaded && (enabledAutoCheck || (prereleaseChanged && next.autoCheckAppUpdates))){
      await this.checkAppUpdate({force:false}).catch(()=>{});
    }
    return this.getState();
  }
  async getActivityLog(limit=100){
    const file=path.join(this.dataDir,'activity.log');
    const text=await readFile(file,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
    const lines=text.split(/\r?\n/).filter(Boolean);
    return lines.slice(-Math.max(1,limit)).reverse();
  }
  async clearActivityLog(){
    const file=path.join(this.dataDir,'activity.log');
    await rm(file,{force:true});
    return [];
  }
  async clearCache(){
    if(this.busy)throw new Error('Another plugin operation is running. Wait for it to finish.');
    const cacheDir=this.client?.cacheDir;
    if(cacheDir)await rm(cacheDir,{recursive:true,force:true}).catch(()=>{});
    this.releases.clear();
    this.screenshots.clear();
    this.loaded=false;
    return this.refresh();
  }
  selection({id,formats}){
    const plugin=this.catalog.find(p=>p.id===id);
    if(!plugin)throw new Error('Unknown plugin.');
    if(!Array.isArray(formats)||!formats.length||formats.length>2||new Set(formats).size!==formats.length||new Set(formats).size===0||formats.some(f=>!plugin.bundleNames[f]||(f==='AU'&&this.platform!=='darwin')))throw new Error('Choose a supported plugin format.');
    return plugin;
  }
  async log(message){
    const file=path.join(this.dataDir,'activity.log');await mkdir(this.dataDir,{recursive:true});
    const size=await stat(file).then(s=>s.size).catch(()=>0);
    if(size>256*1024){
      const tail=await readFile(file).then(buf=>{
        const slice=buf.subarray(Math.max(0,buf.length-128*1024));
        const nl=slice.indexOf(0x0a);
        return nl>=0?slice.subarray(nl+1):slice;
      }).catch(()=>Buffer.alloc(0));
      await writeFile(file,tail,{mode:0o600});
    }
    await appendFile(file,`${new Date().toISOString()} ${message}\n`,{mode:0o600});
  }
  progress(id,phase,message,percent){this.onProgress({id,phase,message,...(percent===undefined?{}:{percent})});}
  async operate(id,action){
    if(this.busy)throw new Error('Another plugin operation is running. Wait for it to finish.');
    this.busy=true;
    try{await action();this.progress(id,'complete','Complete',100);await this.log(`${id}: complete`).catch(()=>{});}
    catch(error){
      const message=['EACCES','EPERM','EBUSY'].includes(error.code)?'Cannot change the plugin files. Close your DAW and choose a writable folder in Settings, then try again.':error.message;
      this.progress(id,'error',message);await this.log(`${id}: ${message}`).catch(()=>{});throw new Error(message,{cause:error});
    }finally{this.busy=false;}
    return this.getState();
  }
  async #installReleaseGroups({ plugin, release, groups, overwrite, progressId, phase, statusText, basePercent = 0, spanPercent = 100 }) {
    const tempRoot = path.join(this.dataDir, 'downloads');
    await mkdir(tempRoot, { recursive: true });
    const temporary = await mkdtemp(path.join(tempRoot, 'install-'));
    try {
      for (const [index, { asset, formats }] of [...groups.values()].entries()) {
        const archivePath = path.join(temporary, `${index}.zip`);
        this.progress(progressId, phase === 'updating' ? 'downloading' : 'downloading', statusText.downloading, basePercent);
        await downloadAsset({
          asset,
          repo: plugin.repo,
          destination: archivePath,
          appVersion: this.appVersion,
          onProgress: percent => this.progress(progressId, 'downloading', statusText.downloading, Math.round(basePercent + (percent * spanPercent) / 100)),
        });
        this.progress(progressId, 'installing', statusText.installing, Math.min(99, Math.round(basePercent + spanPercent * 0.9)));
        await this.installer.install({
          plugin,
          tag: release.tag,
          archivePath,
          formats,
          digest: asset.digest,
          overwrite: Boolean(overwrite),
        });
      }
    } finally {
      await rm(temporary, { recursive: true, force: true }).catch(() => {});
    }
  }
  #groupReleaseAssets(release, formats) {
    const groups = new Map();
    for (const format of formats) {
      const asset = selectAsset(release, format);
      const group = groups.get(asset.url) || { asset, formats: [] };
      group.formats.push(format);
      groups.set(asset.url, group);
    }
    return groups;
  }
  async install(request){
    await this.getState();
    const plugin=this.selection(request);
    const releases=normalizeReleases(this.releases.get(plugin.id)?.data || [],{platform:this.platform,arch:this.arch,repo:plugin.repo,includePrereleases:this.settings.includePrereleases});
    const release=releases.find(r=>r.tag===request.tag);
    if(!release)throw new Error('This release is unavailable. Refresh the library and choose a version.');
    const groups=this.#groupReleaseAssets(release, request.formats);
    return this.operate(plugin.id,async()=>{
      await this.#installReleaseGroups({
        plugin,
        release,
        groups,
        overwrite: Boolean(request.overwrite),
        progressId: plugin.id,
        phase: 'installing',
        statusText: { downloading: 'Downloading from GitHub', installing: 'Verifying and installing' },
      });
    });
  }
  async move(request){
    await this.getState();const plugin=this.selection(request);
    return this.operate(plugin.id,async()=>{
      this.progress(plugin.id,'moving','Moving to new folder');
      await this.installer.move({plugin,formats:request.formats,overwrite:Boolean(request.overwrite)});
    });
  }
  async moveAll(){
    await this.getState();
    const plugins=this.catalog;
    return this.operate('all',async()=>{
      this.progress('all','moving','Moving installed plugins to current folder',0);
      const failures=[];
      for(const [index,plugin] of plugins.entries()){
        const installed=await this.installer.detect(plugin);
        const formats=installed.filter(i=>i.managed).map(item=>item.format);
        if(formats.length){
          try{
            await this.installer.move({plugin,formats,overwrite:true});
          }catch(error){
            failures.push(`${plugin.name}: ${error.message}`);
            await this.log(`moveAll (${plugin.id}): ${error.message}`).catch(()=>{});
          }
        }
        this.progress('all','moving','Moving installed plugins to current folder',Math.round(((index+1)/plugins.length)*100));
      }
      if(failures.length){
        throw new Error(`Could not move ${failures.length} plugin${failures.length===1?'':'s'}: ${failures.slice(0,2).join('; ')}`);
      }
    });
  }
  async uninstall(request){
    await this.getState();const plugin=this.selection(request);
    return this.operate(plugin.id,async()=>{
      this.progress(plugin.id,'removing','Removing files');
      await this.installer.uninstall({plugin,formats:request.formats,unmanaged:Boolean(request.unmanaged)});
    });
  }
  async installAll(options = {}){
    await this.getState();
    const plugins = this.catalog;
    return this.operate('all', async () => {
      const candidates = [];
      for (const plugin of plugins) {
        const installed = await this.installer.detect(plugin);
        if (installed.length > 0 && !options.overwrite) continue;
        const releases = normalizeReleases(this.releases.get(plugin.id)?.data || [], {
          platform: this.platform, arch: this.arch, repo: plugin.repo, includePrereleases: this.settings.includePrereleases,
        });
        const release = releases.find(r => r.assets.some(a => a.compatible));
        if (!release) continue;
        const supported = Object.keys(plugin.bundleNames).filter(f => f === 'VST3' || this.platform === 'darwin');
        const preferred = Array.isArray(this.settings.preferredFormats)
          ? this.settings.preferredFormats.filter(f => supported.includes(f))
          : [];
        const formats = installed.length > 0
          ? [...new Set(installed.map(i => i.format))]
          : (preferred.length > 0 ? preferred : (supported.includes('VST3') ? ['VST3'] : supported.slice(0, 1)));
        if (!formats.length) continue;
        candidates.push({ plugin, installed, release, formats });
      }
      this.progress('all', 'installing', 'Installing all plugins', 0);
      const failures = [];
      for (const [index, { plugin, installed, release, formats }] of candidates.entries()) {
        const basePercent = Math.round((index / candidates.length) * 100);
        const spanPercent = 100 / candidates.length;
        try {
          const groups = this.#groupReleaseAssets(release, formats);
          await this.#installReleaseGroups({
            plugin,
            release,
            groups,
            overwrite: Boolean(options.overwrite || installed.length > 0),
            progressId: plugin.id,
            phase: 'installing',
            statusText: {
              downloading: `Downloading ${plugin.name} (${index + 1} of ${candidates.length})`,
              installing: `Installing ${plugin.name} (${index + 1} of ${candidates.length})`,
            },
            basePercent,
            spanPercent,
          });
          this.progress(plugin.id, 'installing', `Installed ${plugin.name} (${index + 1} of ${candidates.length})`, Math.round(((index + 1) / candidates.length) * 100));
        } catch (error) {
          failures.push(`${plugin.name}: ${error.message}`);
          await this.log(`installAll (${plugin.id}): ${error.message}`).catch(() => {});
        }
      }
      if (failures.length) {
        const installedOk = candidates.length - failures.length;
        throw new Error(`Installed ${installedOk} of ${candidates.length} plugins; ${failures.length} failed (${failures.slice(0, 2).join('; ')}).`);
      }
    });
  }
  async updateAll(options = {}){
    await this.getState();
    const plugins = this.catalog;
    return this.operate('all', async () => {
      const candidates = [];
      for (const plugin of plugins) {
        const installed = await this.installer.detect(plugin);
        if (!installed.length) continue;
        const releases = normalizeReleases(this.releases.get(plugin.id)?.data || [], {
          platform: this.platform, arch: this.arch, repo: plugin.repo, includePrereleases: this.settings.includePrereleases,
        });
        const release = releases.find(r => r.assets.some(a => a.compatible));
        if (!release) continue;
        const formats = installed.filter(item => {
          const current = semver.valid(item.version);
          const latest = semver.valid(release.tag);
          return Boolean(current && latest && semver.gt(latest, current));
        }).map(item => item.format);
        if (formats.length) candidates.push({ plugin, release, formats });
      }
      this.progress('all', 'updating', 'Updating all plugins', 0);
      const failures = [];
      for (const [index, { plugin, release, formats }] of candidates.entries()) {
        const basePercent = Math.round((index / candidates.length) * 100);
        const spanPercent = 100 / candidates.length;
        try {
          const groups = this.#groupReleaseAssets(release, formats);
          await this.#installReleaseGroups({
            plugin,
            release,
            groups,
            overwrite: true,
            progressId: plugin.id,
            phase: 'updating',
            statusText: {
              downloading: `Downloading ${plugin.name} update (${index + 1} of ${candidates.length})`,
              installing: `Updating ${plugin.name} (${index + 1} of ${candidates.length})`,
            },
            basePercent,
            spanPercent,
          });
          this.progress(plugin.id, 'updating', `Updated ${plugin.name} (${index + 1} of ${candidates.length})`, Math.round(((index + 1) / candidates.length) * 100));
        } catch (error) {
          failures.push(`${plugin.name}: ${error.message}`);
          await this.log(`updateAll (${plugin.id}): ${error.message}`).catch(() => {});
        }
      }
      if (failures.length) {
        const updatedOk = candidates.length - failures.length;
        throw new Error(`Updated ${updatedOk} of ${candidates.length} plugins; ${failures.length} failed (${failures.slice(0, 2).join('; ')}).`);
      }
    });
  }
  async uninstallAll(options = {}){
    await this.getState();
    const plugins = this.catalog;
    return this.operate('all', async () => {
      this.progress('all', 'removing', 'Removing all installed plugins', 0);
      const failures = [];
      let total = 0;
      for (const [index, plugin] of plugins.entries()) {
        const installed = await this.installer.detect(plugin);
        const formats = installed.map(item => item.format);
        if (formats.length) {
          total++;
          try {
            await this.installer.uninstall({
              plugin,
              formats,
              unmanaged: Boolean(options.unmanaged ?? true),
            });
          } catch (error) {
            failures.push(`${plugin.name}: ${error.message}`);
            await this.log(`uninstallAll (${plugin.id}): ${error.message}`).catch(() => {});
          }
        }
        this.progress('all', 'removing', 'Removing all installed plugins', Math.round(((index + 1) / plugins.length) * 100));
      }
      if (failures.length) {
        const removedOk = total - failures.length;
        throw new Error(`Removed ${removedOk} of ${total} plugins; ${failures.length} failed (${failures.slice(0, 2).join('; ')}).`);
      }
    });
  }
}
