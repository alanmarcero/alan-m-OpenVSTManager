import test from 'node:test';
import assert from 'node:assert/strict';
import { compatibleAsset, normalizeReleases, selectAsset, validateCatalog } from '../core/releases.mjs';

const asset = (name, extras = {}) => ({name,browser_download_url:`https://github.com/alanmarcero/openMaster/releases/download/v1.0.0/${name}`,size:100,digest:'sha256:abcd',...extras});
const release = (tag, extras = {}) => ({tag_name:tag,name:tag,draft:false,prerelease:false,published_at:'2026-10-01T00:00:00Z',body:'Notes',html_url:`https://github.com/alanmarcero/openMaster/releases/tag/${tag}`,assets:[asset('openMaster-VST3-macOS.zip')],...extras});

test('selects mac universal, Windows x64 and Linux builds without crossing platforms or architecture',()=>{
 assert.equal(compatibleAsset('openMaster-VST3-macOS.zip','darwin','arm64'),true);
 assert.equal(compatibleAsset('openSausage-macOS-universal.zip','darwin','x64'),true);
 assert.equal(compatibleAsset('openSausage-Windows-x64.zip','darwin','arm64'),false);
 assert.equal(compatibleAsset('openSausage-Windows-x64.zip','win32','x64'),true);
 assert.equal(compatibleAsset('openSausage-Windows-arm64.zip','win32','x64'),false);
 assert.equal(compatibleAsset('openEDMFilter-Linux.zip','linux','x64'),true);
 assert.equal(compatibleAsset('openEDMFilter-Linux.zip','linux','arm64'),false);
 assert.equal(compatibleAsset('source.zip','darwin','arm64'),false);
 assert.equal(compatibleAsset('openMaster-macOS.zip.exe','darwin','arm64'),false);
});

test('stable releases exclude drafts and prereleases and sort by semantic version',()=>{
 const releases=normalizeReleases([release('v1.9.0'),release('v1.10.0'),release('v2.0.0-beta',{prerelease:true}),release('v3.0.0',{draft:true})],{platform:'darwin',arch:'arm64',repo:'openMaster'});
 assert.deepEqual(releases.map(r=>r.tag),['v1.10.0','v1.9.0']);
 assert.equal(releases[0].assets[0].compatible,true);
});

test('prereleases can be selected explicitly, and invalid external asset URLs are discarded',()=>{
 const releases=normalizeReleases([release('v2.0.0-beta',{prerelease:true,assets:[asset('openMaster-macOS.zip'),asset('openMaster-Windows.zip',{browser_download_url:'https://evil.example/a.zip'})]})],{platform:'darwin',arch:'arm64',repo:'openMaster',includePrereleases:true});
 assert.equal(releases.length,1);
 assert.equal(releases[0].assets.length,1);
 assert.equal(selectAsset(releases[0],'VST3').name,'openMaster-macOS.zip');
 assert.throws(()=>selectAsset({assets:[]},'VST3'),/No compatible/);
});

test('format-specific archives are preferred and do not mix AU with VST3',()=>{
 const releases=normalizeReleases([release('v1.0.0',{assets:[asset('openMaster-AU-macOS.zip'),asset('openMaster-VST3-macOS.zip')]})],{platform:'darwin',arch:'arm64',repo:'openMaster'});
 assert.equal(selectAsset(releases[0],'VST3').name,'openMaster-VST3-macOS.zip');
 assert.equal(selectAsset(releases[0],'AU').name,'openMaster-AU-macOS.zip');
});

test('catalog rejects foreign repos, unsafe bundle paths and duplicate ids',()=>{
 const good={id:'openMaster',repo:'openMaster',name:'openMaster',description:'Mastering',category:'Mastering',bundleNames:{VST3:'openMaster.vst3'}};
 assert.equal(validateCatalog([good]).length,1);
 assert.throws(()=>validateCatalog([{...good,repo:'someone/repo'}]),/repository/);
 assert.throws(()=>validateCatalog([{...good,bundleNames:{VST3:'../outside.vst3'}}]),/bundle/);
 assert.throws(()=>validateCatalog([good,good]),/duplicate/);
});
test('catalog supports explicit historical bundle aliases but still rejects unsafe names',()=>{
 const plugin={id:'openMaster',repo:'openMaster',name:'Master',description:'Master',category:'Mastering',bundleNames:{VST3:['openMaster.vst3','Analog Master Strip.vst3']}};
 assert.deepEqual(validateCatalog([plugin])[0].bundleNames.VST3,['openMaster.vst3','Analog Master Strip.vst3']);
 assert.throws(()=>validateCatalog([{...plugin,bundleNames:{VST3:['openMaster.vst3','../../evil.vst3']}}]),/bundle/);
});
