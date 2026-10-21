#!/usr/bin/env node
import path from 'node:path';
import {homedir} from 'node:os';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {Installer} from '../core/installer.mjs';
import {GitHubClient} from '../core/github.mjs';
import {ManagerService} from '../core/service.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {values,positionals}=parseArgs({allowPositionals:true,options:{format:{type:'string',default:'VST3'},version:{type:'string'},'data-dir':{type:'string'},help:{type:'boolean'}}});
const [command='list',id,folder]=positionals;
if(values.help){
  console.log('OpenVST Manager\n\nlist\ninstall <plugin> [--version <tag>] [--format VST3|AU]\nuninstall <plugin> [--format VST3|AU]\npaths [VST3|AU <folder>]\n\n--data-dir <folder> uses an isolated settings/receipt directory.');
  process.exit(0);
}
const config=process.platform==='darwin'?path.join(homedir(),'Library','Application Support'):process.platform==='win32'?(process.env.APPDATA||path.join(homedir(),'AppData','Roaming')):(process.env.XDG_CONFIG_HOME||path.join(homedir(),'.config'));
const dataDir=path.resolve(values['data-dir']||process.env.OPENVST_DATA_DIR||path.join(config,'OpenVST Manager'));
const bundledCatalog=JSON.parse(await readFile(path.join(root,'catalog.json'),'utf8'));
const manager=new ManagerService({dataDir,client:new GitHubClient({cacheDir:path.join(dataDir,'cache')}),installer:new Installer({dataDir,plugins:bundledCatalog}),
  appVersion:JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version,
  bundledCatalog,
  onProgress:({message,percent})=>console.error(message+(percent===undefined?'':` ${percent}%`))});
try{
  const state=await manager.getState();
  if(command==='list'){
    for(const p of state.plugins)console.log([p.id,p.releases[0]?.tag||'no release',p.installed.map(i=>`${i.format}:${i.version||'unknown'}${i.managed?'':' (external)'}`).join(', ')||'not installed'].join('\t'));
    if(state.offline)console.error('Some GitHub data is unavailable or cached.');
  }else if(command==='paths'){
    const result=id&&folder?await manager.saveSettings({paths:{[id]:path.resolve(folder)}}):state;
    console.log(JSON.stringify(result.settings.paths,null,2));
  }else if(command==='install'){
    const plugin=state.plugins.find(p=>p.id===id);
    if(!plugin)throw new Error('Unknown plugin. Run list to see plugin IDs.');
    await manager.install({id,tag:values.version||plugin.releases[0]?.tag,formats:[values.format]});
  }else if(command==='uninstall')await manager.uninstall({id,formats:[values.format]});
  else throw new Error('Unknown command. Use --help.');
}catch(error){console.error(error.message);process.exitCode=1;}
