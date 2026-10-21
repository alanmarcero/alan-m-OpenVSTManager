# OpenVST Manager Implementation Plan

**Goal:** Publish a functional public desktop plugin manager and usable plugin releases.
**Architecture:** Sandboxed Electron renderer with a React interface and tested Node core. Public GitHub Releases supply a curated catalog.
**Tech Stack:** Electron, electron-builder, React, TypeScript, Vite, Node test runner, ZIP extraction.
**Spec:** ../specs/2026-10-21-openvstmanager-design.md

## Global constraints

Seven plugin repositories only. Public manager. macOS and Windows packaged in Actions. Linux builds documented. No signing credentials required. Preserve existing plugin code and tests. Publish only verified work.

## Review focus

- Unsafe ZIP paths and symlinks must never escape staging.
- An install failure must retain the previous working installation.
- Untracked plugins must not be deleted or overwritten silently.
- Stale or missing GitHub releases must not look like successful refreshes.
- UI state and backend receipts must agree after install, update and remove.

## Work

- [ ] Release pipelines: inspect latest remote state in isolated clones, add tag publication, preserve validation and notices, push changes, publish version tags, verify jobs/assets.
- [ ] Installer: implement tested bounded extraction, checksum verification, bundle allowlist, staged replacement and receipts, managed removal, detection, platform paths.
- [ ] Interface: implement catalog rows, detail pane, search/filter, format/version choice, progress/error state, settings, keyboard access and generated artwork.
- [ ] Integration: implement catalog/release client, IPC service, Electron security boundaries, packager, app workflows and README.
- [ ] Verification: run tests/typecheck/build; actual app flow with disposable install folder; package launch; review security and failure handling; push and tag; inspect GitHub-built assets.

## Shared interface

`window.manager` has `getState()`, `refresh()`, `install({id,tag,formats})`, `uninstall({id,formats})`, `saveSettings({includePrereleases?,paths?})`, `chooseDirectory(format)`, `openExternal(url)`, `onProgress(callback)` (returns unsubscribe).

State: `{platform,arch,appVersion,plugins,settings:{includePrereleases,paths:{VST3,AU}},lastChecked,offline,error?}`.
Plugin: `{id,name,description,category,repo,url,bundleNames:{VST3,AU?},formats,installed:[{format,version,path,managed}],releases:[{tag,name,publishedAt,notes,url,assets:[{name,url,size,digest?}]}],error?}`.
Progress: `{id,phase,message,percent?}`. Operations resolve a fresh state, except chooseDirectory returns a chosen path or null; openExternal resolves void.

Installer module exports are coordinated with integration before use. UI never supplies arbitrary asset URLs or bundle paths. Main resolves selected releases from trusted metadata.
