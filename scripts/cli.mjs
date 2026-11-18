#!/usr/bin/env node
import path from 'node:path';
import {homedir} from 'node:os';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import semver from 'semver';
import {Installer} from '../core/installer.mjs';
import {GitHubClient} from '../core/github.mjs';
import {findPlugin} from '../core/releases.mjs';
import {ManagerService} from '../core/service.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {values,positionals}=parseArgs({allowPositionals:true,options:{format:{type:'string',default:'VST3'},version:{type:'string'},'data-dir':{type:'string'},overwrite:{type:'boolean'},json:{type:'boolean'},help:{type:'boolean'}}});
const [command='list',id,folder]=positionals;
if(values.help){
  console.log('OpenVST Manager\n\nlist [--json]\ninstalled [--json]\nupdates [--json]\nrefresh [--json]\ninstall <plugin> [--version <tag>] [--format VST3|AU] [--overwrite]\ninstall-all [--overwrite]\nupdate-all [--overwrite]\nmove <plugin> [--format VST3|AU] [--overwrite]\nmove-all\nuninstall <plugin> [--format VST3|AU]\nuninstall-all\npaths [VST3|AU <folder>] [--json]\ncheck-update [--json]\nlog [--json]\nclear-log\nclear-cache\n\n--data-dir <folder> uses an isolated settings/receipt directory.');
  process.exit(0);
}
const config=process.platform==='darwin'?path.join(homedir(),'Library','Application Support'):process.platform==='win32'?(process.env.APPDATA||path.join(homedir(),'AppData','Roaming')):(process.env.XDG_CONFIG_HOME||path.join(homedir(),'.config'));
const dataDir=path.resolve(values['data-dir']||process.env.OPENVST_DATA_DIR||path.join(config,'OpenVST Manager'));
const bundledCatalog=JSON.parse(await readFile(path.join(root,'catalog.json'),'utf8'));
const appVersion=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
const manager=new ManagerService({dataDir,client:new GitHubClient({cacheDir:path.join(dataDir,'cache'),appVersion}),installer:new Installer({dataDir,plugins:bundledCatalog}),
  appVersion,
  bundledCatalog,
  onProgress:({message,percent})=>console.error(message+(percent===undefined?'':` ${percent}%`))});
try{
  if(command==='log'){
    const lines=await manager.getActivityLog();
    if(values.json)console.log(JSON.stringify(lines,null,2));
    else for(const line of lines)console.log(line);
  }else if(command==='clear-log'){
    await manager.clearActivityLog();
    console.log('Activity log cleared.');
  }else if(command==='clear-cache'){
    const next=await manager.clearCache();
    console.log(`Refreshed ${next.plugins.length} plugins.`);
  }else if(command==='check-update'){
    const update=await manager.checkAppUpdate({force:true});
    if(values.json)console.log(JSON.stringify(update,null,2));
    else if(update.error)throw new Error(update.error);
    else console.log(update.available?`Update available: ${update.latestVersion} (current ${update.currentVersion})`:`Up to date (${update.currentVersion})`);
  }else{
    const state=command==='refresh'?await manager.refresh():await manager.getState();
    if(command==='list'||command==='refresh'||command==='installed'||command==='updates'){
      const filtered=state.plugins.filter(p=>{
        if(command==='installed')return p.installed.length>0;
        if(command==='updates'){
          const latest=p.releases.find(r=>r.assets.some(a=>a.compatible));
          const latestVer=latest&&semver.valid(latest.tag);
          return Boolean(latestVer && p.installed.some(i=>{const cur=semver.valid(i.version);return Boolean(cur && semver.gt(latestVer,cur));}));
        }
        return true;
      });
      if(values.json){
        console.log(JSON.stringify(filtered.map(p=>({id:p.id,name:p.name,latest:p.releases[0]?.tag||null,installed:p.installed})),null,2));
      }else{
        for(const p of filtered)console.log([p.id,p.releases[0]?.tag||'no release',p.installed.map(i=>`${i.format}:${i.version||'unknown'}${i.managed?'':' (external)'}`).join(', ')||'not installed'].join('\t'));
      }
      if(state.offline)console.error('Some GitHub data is unavailable or cached.');
      else if(state.error)console.error(state.error);
    }else if(command==='paths'){
      const result=id&&folder?await manager.saveSettings({paths:{[id]:path.resolve(folder)}}):state;
      console.log(JSON.stringify(result.settings.paths,null,2));
    }else if(command==='install'){
      const plugin=findPlugin(state.plugins,id);
      if(!plugin)throw new Error('Unknown plugin. Run list to see plugin IDs.');
      await manager.install({id:plugin.id,tag:values.version||plugin.releases[0]?.tag,formats:[values.format],overwrite:Boolean(values.overwrite)});
    }else if(command==='install-all')await manager.installAll({overwrite:Boolean(values.overwrite)});
    else if(command==='update-all')await manager.updateAll({overwrite:Boolean(values.overwrite)});
    else if(command==='move'){
      const plugin=findPlugin(state.plugins,id);
      if(!plugin)throw new Error('Unknown plugin. Run list to see plugin IDs.');
      await manager.move({id:plugin.id,formats:[values.format],overwrite:Boolean(values.overwrite)});
    }else if(command==='move-all')await manager.moveAll();
    else if(command==='uninstall'){
      const plugin=findPlugin(state.plugins,id);
      if(!plugin)throw new Error('Unknown plugin. Run list to see plugin IDs.');
      await manager.uninstall({id:plugin.id,formats:[values.format]});
    }
    else if(command==='uninstall-all')await manager.uninstallAll();
    else throw new Error('Unknown command. Use --help.');
  }
}catch(error){console.error(error.message);process.exitCode=1;}
