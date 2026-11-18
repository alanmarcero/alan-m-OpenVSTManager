import {app,BrowserWindow,ipcMain,dialog,shell,session,Menu,protocol,net} from 'electron';
import {mkdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Installer} from '../core/installer.mjs';
import {GitHubClient} from '../core/github.mjs';
import {findPlugin} from '../core/releases.mjs';
import {ManagerService} from '../core/service.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const origin='openvst://app';
app.setName('OpenVST Manager');
protocol.registerSchemesAsPrivileged([{scheme:'openvst',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
if(process.env.OPENVST_DATA_DIR)app.setPath('userData',path.resolve(process.env.OPENVST_DATA_DIR));
if(!app.requestSingleInstanceLock())app.quit();
else {
  app.disableHardwareAcceleration();
  let window;
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
  app.whenReady().then(async()=>{
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  const dataDir=app.getPath('userData');
  const bundledCatalog=JSON.parse(await readFile(path.join(root,'catalog.json'),'utf8'));
  const client=new GitHubClient({cacheDir:path.join(dataDir,'cache'),appVersion:app.getVersion()});
  const manager=new ManagerService({dataDir,
    client,
    installer:new Installer({dataDir,plugins:bundledCatalog}),
    appVersion:app.getVersion(),bundledCatalog,
    screenshotBaseUrl:`${origin}/screenshots`,
    onProgress:progress=>{if(window&&!window.isDestroyed())window.webContents.send('manager:progress',progress);}
  });
  protocol.handle('openvst',async request=>{
    const url=new URL(request.url);
    if(url.hostname!=='app')return new Response('Forbidden',{status:403});
    let pathname;
    try{pathname=decodeURIComponent(url.pathname);}catch{return new Response('Bad request',{status:400});}
    if(pathname.startsWith('/screenshots/')){
      const id=pathname.slice('/screenshots/'.length).replace(/\.png$/i,'');
      const plugin=findPlugin(manager.catalog,id);
      if(!plugin)return new Response('Not found',{status:404});
      try{
        const shot=await client.screenshot(plugin.repo,plugin.screenshotPath);
        return new Response(shot.data,{status:200,headers:{'Content-Type':shot.contentType,'Cache-Control':'no-store'}});
      }catch{
        return new Response('Not found',{status:404});
      }
    }
    const file=path.resolve(root,'dist','.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(path.join(root,'dist')+path.sep))return new Response('Forbidden',{status:403});
    return net.fetch(pathToFileURL(file).href);
  });
  const handlers={
    getState:()=>manager.getState(),refresh:()=>manager.refresh(),
    install:request=>manager.install(request),uninstall:request=>manager.uninstall(request),
    installAll:options=>manager.installAll(options),updateAll:options=>manager.updateAll(options),
    uninstallAll:options=>manager.uninstallAll(options),
    move:request=>manager.move(request),moveAll:()=>manager.moveAll(),
    saveSettings:patch=>manager.saveSettings(patch),
    checkAppUpdate:()=>manager.checkAppUpdate({force:true}),
    installAppUpdate:async()=>{
      const result=await manager.installAppUpdate();
      if(result?.success && result?.launched && process.platform==='win32'){
        setTimeout(()=>app.quit(), 800);
      }
      return result;
    },
    getActivityLog:()=>manager.getActivityLog(),
    clearCache:()=>manager.clearCache(),
    openDataFolder:async()=>{
      await mkdir(dataDir,{recursive:true});
      const openError=await shell.openPath(dataDir);
      if(openError)throw new Error(openError);
    },
    chooseDirectory:async format=>{
      if(!['VST3','AU'].includes(format))throw new Error('Unknown plugin format.');
      const state=await manager.getState();
      const result=await dialog.showOpenDialog(window,{title:`Choose ${format} folder`,defaultPath:state.settings.paths[format],properties:['openDirectory','createDirectory']});
      return result.canceled?null:result.filePaths[0];
    },
    chooseBackupDirectory:async()=>{
      const state=await manager.getState();
      const result=await dialog.showOpenDialog(window,{title:'Choose Backups folder',defaultPath:state.settings.backupFolder,properties:['openDirectory','createDirectory']});
      return result.canceled?null:result.filePaths[0];
    },
    openExternal:async value=>{
      const url=new URL(value);
      const isGitHub = url.hostname === 'github.com' && (url.pathname === '/alanmarcero' || url.pathname.startsWith('/alanmarcero/'));
      const isWebsite = url.hostname === 'alanmarcero.com' || url.hostname === 'www.alanmarcero.com';
      if(url.protocol!=='https:' || (!isGitHub && !isWebsite) || url.username || url.password || url.port) {
        throw new Error('Only Alan Marcero website and GitHub links can be opened.');
      }
      await shell.openExternal(url.href);
    },
    openFolder:async value=>{
      if(typeof value!=='string'||!value.trim()||!path.isAbsolute(value)||value.includes('\0'))throw new Error('Choose an absolute folder path.');
      const resolved=path.resolve(value);
      const state=await manager.getState();
      const allowedRoots=[
        ...Object.values(state.settings.paths||{}),
        state.settings.backupFolder,
        dataDir,
      ].filter(Boolean).map(p=>path.resolve(p));
      const allowedInstalls=state.plugins.flatMap(p=>p.installed.map(i=>path.resolve(i.path)));
      const normalizeCmp=p=>process.platform==='win32'?p.toLowerCase():p;
      const targetCmp=normalizeCmp(resolved);
      const isAllowed=allowedRoots.some(r=>normalizeCmp(r)===targetCmp)
        || allowedInstalls.some(p=>normalizeCmp(p)===targetCmp||normalizeCmp(path.dirname(p))===targetCmp);
      if(!isAllowed)throw new Error('Only configured plugin, backup, or data folders can be opened.');
      const info=await stat(resolved).catch(()=>null);
      const folderToOpen=info&&!info.isDirectory()?path.dirname(resolved):resolved;
      if(!info)await mkdir(folderToOpen,{recursive:true});
      const openError=await shell.openPath(folderToOpen);
      if(openError)throw new Error(openError);
    }
  };
  for(const [name,handler] of Object.entries(handlers))ipcMain.handle(`manager:${name}`,async(event,...args)=>{
    if(!window || event.sender!==window.webContents || event.senderFrame!==window.webContents.mainFrame || !event.senderFrame.url.startsWith(origin+'/'))throw new Error('Untrusted window.');
    return handler(...args);
  });
  function createWindow(){
    window=new BrowserWindow({width:1220,height:820,minWidth:860,minHeight:620,title:'OpenVST Manager',backgroundColor:'#f4f6f7',show:true,
      icon:path.join(root,'assets','icon.png'),
      webPreferences:{preload:path.join(root,'electron','preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',event=>event.preventDefault());
    window.on('close',event=>{if(manager.busy){event.preventDefault();dialog.showMessageBox(window,{type:'info',message:'An installation is still running.',detail:'Wait for it to finish before closing OpenVST Manager.'});}});
    window.loadURL(origin+'/index.html');
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform==='darwin'?[{label:app.name,submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]}]:[]),
    {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'View',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{type:'separator'},{role:'togglefullscreen'}]},
    {label:'Window',submenu:[{role:'minimize'},{role:'close'}]},
    {label:'Help',submenu:[{label:'Project & support',click:()=>shell.openExternal('https://github.com/alanmarcero/alan-m-OpenVSTManager')},{label:'Download manager updates',click:()=>shell.openExternal('https://github.com/alanmarcero/alan-m-OpenVSTManager/releases/latest')}]}
  ]));
  createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
  app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
  app.on('before-quit',event=>{if(manager.busy)event.preventDefault();});
  }).catch(error=>{console.error(error);app.quit();});
}
