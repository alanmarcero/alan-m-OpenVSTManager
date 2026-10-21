const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('manager',{
  getState:()=>ipcRenderer.invoke('manager:getState'),
  refresh:()=>ipcRenderer.invoke('manager:refresh'),
  install:request=>ipcRenderer.invoke('manager:install',request),
  uninstall:request=>ipcRenderer.invoke('manager:uninstall',request),
  saveSettings:settings=>ipcRenderer.invoke('manager:saveSettings',settings),
  chooseDirectory:format=>ipcRenderer.invoke('manager:chooseDirectory',format),
  openExternal:url=>ipcRenderer.invoke('manager:openExternal',url),
  onProgress:callback=>{
    const listener=(_event,progress)=>callback(progress);
    ipcRenderer.on('manager:progress',listener);
    return ()=>ipcRenderer.removeListener('manager:progress',listener);
  }
});
