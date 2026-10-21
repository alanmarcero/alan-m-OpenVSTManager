import {app,BrowserWindow,ipcMain,dialog,shell,session,Menu,protocol,net} from 'electron';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Installer} from '../core/installer.mjs';
import {GitHubClient} from '../core/github.mjs';
import {ManagerService} from '../core/service.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const origin='openvst://app';
app.setName('OpenVST Manager');
protocol.registerSchemesAsPrivileged([{scheme:'openvst',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
if(process.env.OPENVST_DATA_DIR)app.setPath('userData',path.resolve(process.env.OPENVST_DATA_DIR));
if(!app.requestSingleInstanceLock())app.quit();
else {
  let window;
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
  app.whenReady().then(async()=>{
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  protocol.handle('openvst',request=>{
    const url=new URL(request.url);
    if(url.hostname!=='app')return new Response('Forbidden',{status:403});
    let pathname;
    try{pathname=decodeURIComponent(url.pathname);}catch{return new Response('Bad request',{status:400});}
    const file=path.resolve(root,'dist','.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(path.join(root,'dist')+path.sep))return new Response('Forbidden',{status:403});
    return net.fetch(pathToFileURL(file).href);
  });
  const dataDir=app.getPath('userData');
  const bundledCatalog=JSON.parse(await readFile(path.join(root,'catalog.json'),'utf8'));
  const manager=new ManagerService({dataDir,
    client:new GitHubClient({cacheDir:path.join(dataDir,'cache')}),
    installer:new Installer({dataDir,plugins:bundledCatalog}),
    appVersion:app.getVersion(),bundledCatalog,
    onProgress:progress=>{if(window&&!window.isDestroyed())window.webContents.send('manager:progress',progress);}
  });
  const handlers={
    getState:()=>manager.getState(),refresh:()=>manager.refresh(),
    install:request=>manager.install(request),uninstall:request=>manager.uninstall(request),
    saveSettings:patch=>manager.saveSettings(patch),
    chooseDirectory:async format=>{
      if(!['VST3','AU'].includes(format))throw new Error('Unknown plugin format.');
      const state=await manager.getState();
      const result=await dialog.showOpenDialog(window,{title:`Choose ${format} folder`,defaultPath:state.settings.paths[format],properties:['openDirectory','createDirectory']});
      return result.canceled?null:result.filePaths[0];
    },
    openExternal:async value=>{
      const url=new URL(value);
      if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||url.port||!url.pathname.startsWith('/alanmarcero/'))throw new Error('Only Alan Marcero GitHub project links can be opened.');
      await shell.openExternal(url.href);
    }
  };
  for(const [name,handler] of Object.entries(handlers))ipcMain.handle(`manager:${name}`,async(event,...args)=>{
    if(!window || event.sender!==window.webContents || event.senderFrame!==window.webContents.mainFrame || !event.senderFrame.url.startsWith(origin+'/'))throw new Error('Untrusted window.');
    return handler(...args);
  });
  function createWindow(){
    window=new BrowserWindow({width:1220,height:820,minWidth:860,minHeight:620,title:'OpenVST Manager',backgroundColor:'#f4f6f7',show:false,
      icon:path.join(root,'assets','icon.png'),
      webPreferences:{preload:path.join(root,'electron','preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',event=>event.preventDefault());
    window.on('close',event=>{if(manager.busy){event.preventDefault();dialog.showMessageBox(window,{type:'info',message:'An installation is still running.',detail:'Wait for it to finish before closing OpenVST Manager.'});}});
    window.once('ready-to-show',()=>window.show());
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
