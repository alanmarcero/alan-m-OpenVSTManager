import {mkdtemp,mkdir,rm,appendFile,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import {readJSON,writeJSON} from './storage.mjs';
import {validateCatalog,normalizeReleases,selectAsset} from './releases.mjs';
import {downloadAsset} from './download.mjs';
import {standardPathOptions,defaultPaths} from './installer.mjs';
import {findAppUpdate,downloadAppUpdate,applyAppUpdate} from './updater.mjs';

export class ManagerService {
  constructor({dataDir,client,installer,platform=process.platform,arch=process.arch,appVersion,bundledCatalog,onProgress=()=>{}}) {
    Object.assign(this,{dataDir,client,installer,platform,arch,appVersion,onProgress});
    this.catalog=validateCatalog(bundledCatalog);this.releases=new Map();this.settings=null;this.loaded=false;this.busy=false;
    this.appUpdate=null;
  }
  async init(){
    if(this.settings)return;
    const saved=await readJSON(path.join(this.dataDir,'settings.json'),{});
    this.validateSettings(saved);
    this.installer.setPaths(saved.paths || {});
    const defaultBackup=path.join(this.dataDir,'backups');
    if(this.installer.setBackupFolder) this.installer.setBackupFolder(saved.backupFolder || defaultBackup);
    if(this.client.setToken) this.client.setToken(saved.githubToken);
    this.settings={
      includePrereleases:saved.includePrereleases ?? false,
      autoCheckAppUpdates:saved.autoCheckAppUpdates ?? true,
      paths:{...this.installer.paths},
      backupFolder:saved.backupFolder || defaultBackup,
      preferredFormats:Array.isArray(saved.preferredFormats) ? saved.preferredFormats : (this.platform==='darwin'?['VST3','AU']:['VST3']),
      githubToken:saved.githubToken || '',
    };
  }
  async getState(){
    await this.init();
    if(!this.loaded)return this.refresh();
    const plugins=await Promise.all(this.catalog.map(async plugin=>{
      const result=this.releases.get(plugin.id);
      return {...plugin,formats:Object.keys(plugin.bundleNames).filter(f=>f==='VST3'||this.platform==='darwin'),
        installed:await this.installer.detect(plugin),
        releases:normalizeReleases(result?.data || [],{platform:this.platform,arch:this.arch,repo:plugin.repo,includePrereleases:this.settings.includePrereleases}),
        ...(result?.error ? {error:result.error} : {})};
    }));
    const fetched=[...this.releases.values()].map(r=>r.fetchedAt).filter(Boolean);
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
      offline:[...this.releases.values()].some(r=>r.stale),
      ...(this.catalogError ? {error:this.catalogError} : {})
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
      this.catalog=validateCatalog(result.data);this.catalogError=result.error;
    }catch(error){this.catalogError=`Using the bundled plugin list. ${error.message}`;}
    await Promise.all(this.catalog.map(async plugin=>{
      try{this.releases.set(plugin.id,await this.client.releases(plugin.repo,{force}));}
      catch(error){this.releases.set(plugin.id,{...this.releases.get(plugin.id),data:this.releases.get(plugin.id)?.data || [],stale:true,error:error.message});}
    }));
    if(this.settings.autoCheckAppUpdates){
      await this.checkAppUpdate({force}).catch(()=>{});
    }
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
      this.appUpdate={available:false,currentVersion:this.appVersion,latestVersion:this.appVersion,error:error.message};
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
          onProgress:percent=>this.progress('manager-update','downloading-update',`Downloading OpenVST Manager v${this.appUpdate.latestVersion}`,percent),
          fetchImpl:this.client.fetch
        });
        this.progress('manager-update','installing-update','Launching OpenVST Manager update installer',100);
        applyAppUpdate({installerPath,platform:this.platform});
        return {success:true,installerPath};
      }finally{}
    });
  }
  validateSettings(patch){
    if(!patch || typeof patch!=='object' || Array.isArray(patch))throw new Error('Invalid settings.');
    if(patch.includePrereleases!==undefined && typeof patch.includePrereleases!=='boolean')throw new Error('Prerelease setting must be boolean.');
    if(patch.autoCheckAppUpdates!==undefined && typeof patch.autoCheckAppUpdates!=='boolean')throw new Error('Auto check app updates setting must be boolean.');
    if(patch.backupFolder!==undefined && (typeof patch.backupFolder!=='string'||!path.isAbsolute(patch.backupFolder)||patch.backupFolder.includes('\0')))throw new Error('Choose an absolute backup folder.');
    if(patch.githubToken!==undefined && typeof patch.githubToken!=='string')throw new Error('GitHub token must be a string.');
    if(patch.preferredFormats!==undefined){
      if(!Array.isArray(patch.preferredFormats) || patch.preferredFormats.some(f=>!['VST3','AU'].includes(f)))throw new Error('Invalid preferred formats.');
    }
    if(patch.paths!==undefined){
      if(!patch.paths || typeof patch.paths!=='object' || Array.isArray(patch.paths))throw new Error('Invalid plugin folders.');
      for(const [format,folder] of Object.entries(patch.paths)){
        if(!['VST3','AU'].includes(format)||typeof folder!=='string'||!path.isAbsolute(folder)||folder.includes('\0'))throw new Error('Choose an absolute plugin folder.');
      }
    }
  }
  async saveSettings(patch){
    if(this.busy)throw new Error('Wait for the current installation to finish before changing folders.');
    await this.init();this.validateSettings(patch);
    const next={
      includePrereleases:patch.includePrereleases ?? this.settings.includePrereleases,
      autoCheckAppUpdates:patch.autoCheckAppUpdates ?? this.settings.autoCheckAppUpdates,
      paths:{...this.settings.paths,...patch.paths},
      backupFolder:patch.backupFolder ?? this.settings.backupFolder,
      preferredFormats:patch.preferredFormats ?? this.settings.preferredFormats,
      githubToken:patch.githubToken ?? this.settings.githubToken,
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
    this.settings=next;return this.getState();
  }
  selection({id,formats}){
    const plugin=this.catalog.find(p=>p.id===id);
    if(!plugin)throw new Error('Unknown plugin.');
    if(!Array.isArray(formats)||!formats.length||formats.length>2||new Set(formats).size!==formats.length||formats.some(f=>!plugin.bundleNames[f]||(f==='AU'&&this.platform!=='darwin')))throw new Error('Choose a supported plugin format.');
    return plugin;
  }
  async log(message){
    const file=path.join(this.dataDir,'activity.log');await mkdir(this.dataDir,{recursive:true});
    const size=await stat(file).then(s=>s.size).catch(()=>0);
    if(size>256*1024)await writeFile(file,'');
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
  async install(request){
    await this.getState();
    const plugin=this.selection(request);
    const releases=normalizeReleases(this.releases.get(plugin.id)?.data || [],{platform:this.platform,arch:this.arch,repo:plugin.repo,includePrereleases:this.settings.includePrereleases});
    const release=releases.find(r=>r.tag===request.tag);
    if(!release)throw new Error('This release is unavailable. Refresh the library and choose a version.');
    const groups=new Map();
    for(const format of request.formats){const asset=selectAsset(release,format);const group=groups.get(asset.url)||{asset,formats:[]};group.formats.push(format);groups.set(asset.url,group);}
    return this.operate(plugin.id,async()=>{
      const tempRoot=path.join(this.dataDir,'downloads');await mkdir(tempRoot,{recursive:true});
      const temporary=await mkdtemp(path.join(tempRoot,'install-'));
      try{
        for(const [index,{asset,formats}] of [...groups.values()].entries()){
          const archivePath=path.join(temporary,`${index}.zip`);
          this.progress(plugin.id,'downloading','Downloading from GitHub',0);
          await downloadAsset({asset,repo:plugin.repo,destination:archivePath,onProgress:percent=>this.progress(plugin.id,'downloading','Downloading from GitHub',percent)});
          this.progress(plugin.id,'installing','Verifying and installing');
          await this.installer.install({plugin,tag:release.tag,archivePath,formats,digest:asset.digest,overwrite:Boolean(request.overwrite)});
        }
      }finally{await rm(temporary,{recursive:true,force:true}).catch(()=>{});}
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
      for(const [index,plugin] of plugins.entries()){
        const installed=await this.installer.detect(plugin);
        const formats=installed.filter(i=>i.managed).map(item=>item.format);
        if(formats.length){
          await this.installer.move({plugin,formats,overwrite:true}).catch(()=>{});
        }
        this.progress('all','moving','Moving installed plugins to current folder',Math.round(((index+1)/plugins.length)*100));
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
        const formats = installed.length > 0
          ? [...new Set(installed.map(i => i.format))]
          : (supported.includes('VST3') ? ['VST3'] : supported.slice(0, 1));
        if (!formats.length) continue;
        candidates.push({ plugin, installed, release, formats });
      }
      this.progress('all', 'installing', 'Installing all plugins', 0);
      for (const [index, { plugin, installed, release, formats }] of candidates.entries()) {
        try {
          const groups = new Map();
          for (const format of formats) {
            const asset = selectAsset(release, format);
            const group = groups.get(asset.url) || { asset, formats: [] };
            group.formats.push(format);
            groups.set(asset.url, group);
          }

          const tempRoot = path.join(this.dataDir, 'downloads');
          await mkdir(tempRoot, { recursive: true });
          const temporary = await mkdtemp(path.join(tempRoot, 'install-'));
          try {
            for (const [gIndex, { asset, formats: grpFormats }] of [...groups.values()].entries()) {
              const archivePath = path.join(temporary, `${gIndex}.zip`);
              const basePct = Math.round((index / candidates.length) * 100);
              this.progress(plugin.id, 'downloading', `Downloading ${plugin.name} (${index + 1} of ${candidates.length})`, basePct);
              await downloadAsset({
                asset, repo: plugin.repo, destination: archivePath,
                onProgress: percent => this.progress(plugin.id, 'downloading', `Downloading ${plugin.name} (${index + 1} of ${candidates.length})`, Math.round(basePct + (percent / candidates.length))),
              });
              this.progress(plugin.id, 'installing', `Installing ${plugin.name} (${index + 1} of ${candidates.length})`, Math.round(((index + 0.9) / candidates.length) * 100));
              await this.installer.install({
                plugin, tag: release.tag, archivePath, formats: grpFormats, digest: asset.digest, overwrite: Boolean(options.overwrite || installed.length > 0),
              });
            }
          } finally {
            await rm(temporary, { recursive: true, force: true }).catch(() => {});
          }
        } catch (error) {
          await this.log(`installAll (${plugin.id}): ${error.message}`).catch(() => {});
        }
        this.progress(plugin.id, 'installing', `Installed ${plugin.name} (${index + 1} of ${candidates.length})`, Math.round(((index + 1) / candidates.length) * 100));
      }
    });
  }
  async updateAll(options = {}){
    await this.getState();
    const plugins = this.catalog;
    return this.operate('all', async () => {
      this.progress('all', 'updating', 'Updating all plugins', 0);
      for (const [index, plugin] of plugins.entries()) {
        try {
          const installed = await this.installer.detect(plugin);
          if (!installed.length) continue;
          const releases = normalizeReleases(this.releases.get(plugin.id)?.data || [], {
            platform: this.platform, arch: this.arch, repo: plugin.repo, includePrereleases: this.settings.includePrereleases,
          });
          const release = releases.find(r => r.assets.some(a => a.compatible));
          if (!release) continue;

          const formatsToUpdate = installed.filter(item => {
            const current = semver.valid(item.version);
            const latest = semver.valid(release.tag);
            return Boolean(current && latest && semver.gt(latest, current));
          }).map(item => item.format);

          if (!formatsToUpdate.length) continue;

          const groups = new Map();
          for (const format of formatsToUpdate) {
            const asset = selectAsset(release, format);
            const group = groups.get(asset.url) || { asset, formats: [] };
            group.formats.push(format);
            groups.set(asset.url, group);
          }

          const tempRoot = path.join(this.dataDir, 'downloads');
          await mkdir(tempRoot, { recursive: true });
          const temporary = await mkdtemp(path.join(tempRoot, 'install-'));
          try {
            for (const [gIndex, { asset, formats: grpFormats }] of [...groups.values()].entries()) {
              const archivePath = path.join(temporary, `${gIndex}.zip`);
              const basePct = Math.round((index / plugins.length) * 100);
              this.progress(plugin.id, 'downloading', `Downloading ${plugin.name} update (${index + 1} of ${plugins.length})`, basePct);
              await downloadAsset({
                asset, repo: plugin.repo, destination: archivePath,
                onProgress: percent => this.progress(plugin.id, 'downloading', `Downloading ${plugin.name} update (${index + 1} of ${plugins.length})`, Math.round(basePct + (percent / plugins.length))),
              });
              this.progress(plugin.id, 'installing', `Updating ${plugin.name} (${index + 1} of ${plugins.length})`, Math.round(((index + 0.9) / plugins.length) * 100));
              await this.installer.install({
                plugin, tag: release.tag, archivePath, formats: grpFormats, digest: asset.digest, overwrite: true,
              });
            }
          } finally {
            await rm(temporary, { recursive: true, force: true }).catch(() => {});
          }
        } catch (error) {
          await this.log(`updateAll (${plugin.id}): ${error.message}`).catch(() => {});
        }
        this.progress(plugin.id, 'updating', `Updated ${plugin.name} (${index + 1} of ${plugins.length})`, Math.round(((index + 1) / plugins.length) * 100));
      }
    });
  }
  async uninstallAll(options = {}){
    await this.getState();
    const plugins = this.catalog;
    return this.operate('all', async () => {
      this.progress('all', 'removing', 'Removing all installed plugins', 0);
      for (const [index, plugin] of plugins.entries()) {
        const installed = await this.installer.detect(plugin);
        const formats = installed.map(item => item.format);
        if (formats.length) {
          await this.installer.uninstall({
            plugin,
            formats,
            unmanaged: Boolean(options.unmanaged ?? true),
          }).catch(() => {});
        }
        this.progress('all', 'removing', 'Removing all installed plugins', Math.round(((index + 1) / plugins.length) * 100));
      }
    });
  }
}
