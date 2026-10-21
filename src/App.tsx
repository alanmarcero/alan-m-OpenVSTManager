import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine, ArrowUpRight, AudioLines, Check, CheckCheck, ChevronDown,
  ChevronRight, CircleAlert, CircleCheck, Download, ExternalLink, Folder,
  Library, LoaderCircle, Monitor, Moon, RefreshCw, Search, Settings2, SlidersHorizontal,
  Sun, Trash2, WifiOff, X, Zap,
} from 'lucide-react';
import type { ManagerAPI, ManagerState, Plugin, PluginFormat, PluginRelease, Progress, Settings } from './types';

type View = 'library' | 'installed' | 'updates' | 'settings';
type Busy = { id: string; action: string } | null;
type Notice = { message: string; kind: 'error' | 'success' } | null;
type Theme = 'light' | 'dark' | 'cyberpunk';
const formatVersion = (tag: string) => tag.replace(/^v(?=\d)/, '');
const errorMessage = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error);
const platformName = (platform: string) => ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' })[platform] || platform;
const isAvailable = (release?: PluginRelease) => Boolean(release?.assets.some(asset => asset.compatible));

function Github({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 19c-4.3 1.3-4.3-2.2-6-2.7m12 5v-3.9c0-1.1-.4-1.9-.9-2.4 3-.3 6.1-1.5 6.1-6.9 0-1.5-.5-2.7-1.4-3.7.1-.4.6-1.8-.1-3.6 0 0-1.2-.4-3.8 1.4a13 13 0 0 0-6.8 0C5.5.4 4.3.8 4.3.8c-.7 1.8-.2 3.2-.1 3.6a5.4 5.4 0 0 0-1.4 3.7c0 5.4 3.1 6.6 6.1 6.9-.4.4-.8 1.1-.9 2.1v4.2" transform="translate(1 1) scale(.9)" /></svg>;
}

function hasUpdate(plugin: Plugin): boolean {
  const latest = plugin.releases[0];
  if (!latest || !isAvailable(latest)) return false;
  return plugin.installed.some(installation => {
    if (!installation.managed || formatVersion(installation.version) === formatVersion(latest.tag)) return false;
    const currentIndex = plugin.releases.findIndex(release => formatVersion(release.tag) === formatVersion(installation.version));
    if (currentIndex > 0) return true;
    const current = formatVersion(installation.version).match(/^(\d+)\.(\d+)\.(\d+)/);
    const next = formatVersion(latest.tag).match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!current || !next) return false;
    for (let index = 1; index <= 3; index++) {
      if (Number(next[index]) !== Number(current[index])) return Number(next[index]) > Number(current[index]);
    }
    return false;
  });
}

function checkedTime(value: ManagerState['lastChecked']) {
  if (!value) return 'Not checked yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not checked yet';
  return `Checked ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function PluginGlyph({ id, large = false }: { id: string; large?: boolean }) {
  const seed = [...id].reduce((total, character) => total + character.charCodeAt(0), 0);
  const shapes = [
    <path key="glitch" d="M8 24h6V13h6v23h7V19h6v10h7V16h4" />,
    <path key="filter" d="M7 35c9 0 10-23 20-23s10 24 18 24M7 35h38" />,
    <path key="wave" d="M7 26c4-17 9-17 13 0s9 17 13 0 9-17 13 0" />,
    <><path key="eq" d="M10 15v24M21 10v29M32 15v24M43 10v29" /><path key="sliders" d="M7 23h6M18 31h6M29 22h6M40 17h6" /></>,
    <path key="master" d="M8 35V23m7 12V16m7 19V11m7 24V20m7 15V14m7 21V24" />,
    <path key="curve" d="M7 34c10 0 10-18 18-18s10 13 20 13" />,
    <path key="scope" d="m7 27 7-3 5 8 6-21 6 28 5-15 9 3" />,
  ];
  const known = ['openglitchfx', 'openedmfilter', 'opensausage', 'opentunereq', 'openmaster', 'winamp-classic-equalizer-vst', 'winamp-classic-visualizer-vst'];
  const knownIndex = known.indexOf(id.toLowerCase());
  const shape = knownIndex >= 0 ? knownIndex : seed % shapes.length;
  return <span className={`plugin-glyph glyph-${shape}${large ? ' glyph-large' : ''}`} aria-hidden="true"><svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{shapes[shape]}</svg></span>;
}

function Brand() {
  return <div className="brand"><span className="brand-mark" aria-hidden="true"><AudioLines size={25} strokeWidth={1.5} /></span><span>OpenVST<span className="brand-subtitle">Manager</span></span></div>;
}

export function App() {
  const manager = window.manager;
  const [theme, setTheme] = useState<Theme>(() => {
    try { const saved = localStorage.getItem('openvst-theme'); if (saved === 'dark' || saved === 'cyberpunk') return saved; } catch { /* Theme storage is optional. */ }
    return 'light';
  });
  const [state, setState] = useState<ManagerState | null>(null);
  const [loading, setLoading] = useState(Boolean(manager));
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState<View>('library');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All categories');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const operationLock = useRef(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('openvst-theme', theme); } catch { /* Keep the selected theme for this session. */ }
  }, [theme]);

  const load = useCallback(async () => {
    if (!manager) return;
    setLoading(true);
    setLoadError('');
    try { setState(await manager.getState()); }
    catch (error) { setLoadError(errorMessage(error)); }
    finally { setLoading(false); }
  }, [manager]);

  useEffect(() => {
    void load();
    if (manager) return manager.onProgress(setProgress);
  }, [load, manager]);

  useEffect(() => {
    if (notice?.kind !== 'success') return;
    const timer = window.setTimeout(() => setNotice(null), 5500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const operate = async (id: string, action: string, operation: () => Promise<ManagerState>, success?: string): Promise<boolean> => {
    if (operationLock.current) return false;
    operationLock.current = true;
    setBusy({ id, action });
    setProgress(null);
    setNotice(null);
    try {
      const next = await operation();
      setState(next);
      if (id === 'refresh' && next.error) setNotice({ message: next.error, kind: 'error' });
      else if (success) setNotice({ message: success, kind: 'success' });
      return true;
    } catch (error) {
      setNotice({ message: errorMessage(error), kind: 'error' });
      // Reconcile receipts even if a multi-format operation only partly completed.
      try { if (manager) setState(await manager.getState()); } catch { /* Keep the last known state visible. */ }
      return false;
    } finally {
      operationLock.current = false;
      setBusy(null);
      setProgress(null);
    }
  };

  const openExternal = async (url: string) => {
    if (!manager) return;
    try { await manager.openExternal(url); }
    catch (error) { setNotice({ kind: 'error', message: errorMessage(error) }); }
  };

  const plugins = state?.plugins ?? [];
  const updateCount = plugins.filter(hasUpdate).length;
  const installedCount = plugins.filter(plugin => plugin.installed.length > 0).length;
  const visible = plugins.filter(plugin => {
    if (view === 'installed' && plugin.installed.length === 0) return false;
    if (view === 'updates' && !hasUpdate(plugin)) return false;
    if (category !== 'All categories' && plugin.category !== category) return false;
    return `${plugin.name} ${plugin.description} ${plugin.category}`.toLowerCase().includes(query.toLowerCase());
  });
  const selected = visible.find(plugin => plugin.id === selectedId) ?? visible[0];
  const categories = [...new Set(plugins.map(plugin => plugin.category))].sort();
  const viewTitle = { library: 'Library', installed: 'Installed', updates: 'Updates', settings: 'Settings' }[view];

  const navigate = (next: View) => { setView(next); setQuery(''); setCategory('All categories'); };
  const updateAll = async () => {
    if (!manager) return;
    const updates = plugins.filter(hasUpdate);
    await operate('all', 'Updating plugins', async () => {
      let next = state!;
      for (const plugin of updates) {
        const formats = plugin.installed.filter(item => item.managed && formatVersion(item.version) !== formatVersion(plugin.releases[0].tag)).map(item => item.format);
        if (formats.length) next = await manager.install({ id: plugin.id, tag: plugin.releases[0].tag, formats });
      }
      return next;
    }, 'Your plugins are up to date.');
  };

  return <div className="app-shell">
    <aside className="sidebar" aria-label="Main navigation">
      <Brand />
      <div className="sidebar-content">
        <p className="nav-heading">Collection</p>
        <nav className="primary-nav">
          <button className={`nav-item ${view === 'library' ? 'active' : ''}`} aria-label="All plugins" aria-current={view === 'library' ? 'page' : undefined} onClick={() => navigate('library')}><Library size={18} /><span>All plugins</span>{state && <span className="nav-count">{plugins.length}</span>}</button>
          <button className={`nav-item ${view === 'installed' ? 'active' : ''}`} aria-label="Installed plugins" aria-current={view === 'installed' ? 'page' : undefined} onClick={() => navigate('installed')}><ArrowDownToLine size={18} /><span>Installed</span>{state && installedCount > 0 && <span className="nav-count">{installedCount}</span>}</button>
          <button className={`nav-item ${view === 'updates' ? 'active' : ''}`} aria-label="Updates" aria-current={view === 'updates' ? 'page' : undefined} onClick={() => navigate('updates')}><RefreshCw size={17} /><span>Updates</span>{updateCount > 0 && <span className="nav-count update-count">{updateCount}</span>}</button>
        </nav>
      </div>
      <div className="sidebar-footer">
        <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} aria-label="Settings" aria-current={view === 'settings' ? 'page' : undefined} onClick={() => navigate('settings')}><Settings2 size={18} /><span>Settings</span></button>
        <button className="nav-item source-link" aria-label="View on GitHub" onClick={() => void openExternal('https://github.com/alanmarcero/alan-m-OpenVSTManager')} disabled={!manager}><Github size={17} /><span>View on GitHub</span><ArrowUpRight size={13} /></button>
        <div className="app-version">OpenVST Manager{state?.appVersion ? ` ${state.appVersion}` : ''}</div>
      </div>
    </aside>

    <main className={`main-content ${view === 'settings' ? 'settings-view' : ''}`}>
      <header className="page-header">
        <div className="header-copy"><h1>{viewTitle}</h1><p>{view === 'settings' ? 'Plugin folders and release preferences.' : view === 'installed' ? 'Plugins on this computer.' : view === 'updates' ? 'New releases for installed plugins.' : 'Audio tools by Alan Marcero.'}</p></div>
        {view !== 'settings' && <img className="header-art" src={theme === 'cyberpunk' ? './artwork/cyberpunk-signal.png' : './artwork/signal-sculpture.png'} alt="" />}
        <div className="header-actions"><div className="theme-toggle" role="group" aria-label="Appearance"><button aria-pressed={theme === 'light'} onClick={() => setTheme('light')}><Sun size={13} />Light</button><button aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><Moon size={13} />Dark</button><button aria-pressed={theme === 'cyberpunk'} onClick={() => setTheme('cyberpunk')}><Zap size={13} />Cyberpunk</button></div>{state && view !== 'settings' && <><button className="button button-quiet refresh-button" disabled={Boolean(busy)} onClick={() => void operate('refresh', 'Checking releases', () => manager!.refresh())}><RefreshCw size={15} className={busy?.id === 'refresh' ? 'spin' : ''} />Check for updates</button><span className="last-checked">{state.offline ? 'Offline · saved releases' : checkedTime(state.lastChecked)}</span></>}</div>
      </header>

      {!manager ? <div className="state-screen"><span className="state-symbol"><Monitor size={31} strokeWidth={1.5} /></span><h2>Made for your desktop</h2><p>OpenVST Manager installs audio plugins on your computer. Open the desktop app to browse releases and manage your collection.</p><span className="state-footnote">Available for macOS and Windows. Build from source on Linux.</span></div>
        : loading ? <div className="loading-layout" role="status" aria-label="Loading plugin library"><div className="loading-toolbar" /><div className="loading-rows">{Array.from({ length: 7 }, (_, index) => <div className="loading-row" key={index}><i /><span /><b /></div>)}</div><p><LoaderCircle className="spin" size={15} />Loading your collection</p></div>
          : loadError || !state ? <div className="state-screen"><span className="state-symbol"><CircleAlert size={31} strokeWidth={1.5} /></span><h2>Couldn’t open your library</h2><p>{loadError || 'The desktop app did not return a library.'}</p><button className="button button-primary" onClick={() => void load()}>Try again</button></div>
            : <>
              {(state.offline || state.error) && <div className="connection-notice" role="status">{state.offline ? <WifiOff size={17} /> : <CircleAlert size={17} />}<span>{state.error || 'You’re offline. Showing your saved releases; reconnect to check for updates.'}</span></div>}
              {view === 'settings' ? <SettingsPanel key={JSON.stringify(state.settings)} state={state} manager={manager} busy={busy} save={settings => operate('settings', 'Saving settings', () => manager.saveSettings(settings), 'Settings saved.')} onError={message => setNotice({ kind: 'error', message })} openExternal={openExternal} />
                : <>
                  <section className="library-toolbar" aria-label="Filter plugins"><div className="search-field"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search plugins" aria-label="Search plugins" />{query && <button className="icon-button clear-search" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}</div><div className="category-select"><SlidersHorizontal size={15} /><select aria-label="Category" value={category} onChange={event => setCategory(event.target.value)}><option>All categories</option>{categories.map(item => <option key={item}>{item}</option>)}</select><ChevronDown size={13} /></div>{view === 'updates' && updateCount > 0 ? <button className="button button-primary update-all" disabled={Boolean(busy)} onClick={() => void updateAll()}><Download size={15} />Update all</button> : <span className="result-count">{visible.length} {visible.length === 1 ? 'plugin' : 'plugins'}</span>}</section>
                  {visible.length === 0 ? <div className="state-screen empty-state"><span className="state-symbol">{view === 'updates' && !query && category === 'All categories' ? <CheckCheck size={31} strokeWidth={1.5} /> : <AudioLines size={31} strokeWidth={1.5} />}</span><h2>{query || category !== 'All categories' ? 'No matching plugins' : view === 'installed' ? 'Your collection starts here' : view === 'updates' ? 'You’re up to date' : 'No plugins to show'}</h2><p>{query || category !== 'All categories' ? 'Try another search or choose a different category.' : view === 'installed' ? 'Choose a plugin from the library to install your first audio tool.' : view === 'updates' ? 'There are no newer releases for your installed plugins.' : 'Check for updates to load available releases.'}</p>{query || category !== 'All categories' ? <button className="button button-secondary" onClick={() => { setQuery(''); setCategory('All categories'); }}>Clear filters</button> : view === 'installed' ? <button className="button button-secondary" onClick={() => navigate('library')}>Browse library</button> : null}</div>
                    : <div className="library-layout"><section className="plugin-list" aria-label="Plugin library"><div className="list-heading"><span>Plugin</span><span>Version</span></div>{visible.map(plugin => <PluginRow key={plugin.id} plugin={plugin} selected={plugin.id === selected?.id} busy={busy} onSelect={() => setSelectedId(plugin.id)} />)}<p className="library-footnote">Rescan plugins in your DAW after installing.</p></section>{selected && <PluginDetail key={selected.id} plugin={selected} state={state} busy={busy} progress={progress} openExternal={openExternal} install={(tag, formats) => operate(selected.id, 'Installing', () => manager.install({ id: selected.id, tag, formats }), `${selected.name} installed.`)} uninstall={formats => operate(selected.id, 'Removing', () => manager.uninstall({ id: selected.id, formats }), `${selected.name} removed.`)} />}</div>}
                </>}
            </>}
      {busy?.id === 'all' && <div className="batch-progress" role="status"><LoaderCircle className="spin" size={16} /><span>{progress?.message || 'Preparing updates…'}</span></div>}
    </main>
    {notice && <div className={`toast toast-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.kind === 'error' ? <CircleAlert size={18} /> : <CircleCheck size={18} />}<span>{notice.message}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={16} /></button></div>}
  </div>;
}

function PluginRow({ plugin, selected, busy, onSelect }: { plugin: Plugin; selected: boolean; busy: Busy; onSelect: () => void }) {
  const update = hasUpdate(plugin);
  const installed = plugin.installed.length > 0;
  const release = plugin.releases[0];
  return <button className={`plugin-row ${selected ? 'selected' : ''}`} onClick={onSelect} aria-pressed={selected}>
    <PluginGlyph id={plugin.id} />
    <span className="plugin-row-copy"><span className="plugin-name">{plugin.name}</span><span className="plugin-category">{plugin.category}</span></span>
    <span className="plugin-row-status"><span className="plugin-version">{release ? formatVersion(release.tag) : '—'}</span><span className={`status-label ${update ? 'status-update' : installed ? 'status-installed' : ''}`}>{busy?.id === plugin.id ? <><LoaderCircle size={11} className="spin" />{busy.action}</> : update ? <><span className="status-dot" />Update available</> : installed ? <><Check size={12} />Installed</> : plugin.error ? 'Release unavailable' : isAvailable(release) ? plugin.formats.join(' / ') : 'Source available'}</span></span>
    <ChevronRight className="row-chevron" size={14} />
  </button>;
}

function PluginDetail({ plugin, state, busy, progress, openExternal, install, uninstall }: {
  plugin: Plugin; state: ManagerState; busy: Busy; progress: Progress | null;
  openExternal: (url: string) => Promise<void>;
  install: (tag: string, formats: PluginFormat[]) => Promise<boolean>;
  uninstall: (formats: PluginFormat[]) => Promise<boolean>;
}) {
  const [tag, setTag] = useState(plugin.releases[0]?.tag ?? '');
  const [formats, setFormats] = useState<PluginFormat[]>(() => plugin.installed.filter(item => item.managed).map(item => item.format).length ? plugin.installed.filter(item => item.managed).map(item => item.format) : plugin.formats.includes('VST3') ? ['VST3'] : plugin.formats.slice(0, 1));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const release = plugin.releases.find(item => item.tag === tag) ?? plugin.releases[0];
  const managed = plugin.installed.filter(item => item.managed);
  const unmanaged = plugin.installed.filter(item => !item.managed);
  const sameVersion = formats.length > 0 && formats.every(format => plugin.installed.some(item => item.managed && item.format === format && formatVersion(item.version) === formatVersion(release?.tag ?? '')));
  const available = isAvailable(release);
  const working = busy?.id === plugin.id || (busy?.id === 'all' && progress?.id === plugin.id);
  const percent = progress?.id === plugin.id && typeof progress.percent === 'number' ? Math.min(100, Math.max(0, progress.percent)) : undefined;
  const action = sameVersion ? 'Installed' : managed.length && release?.tag === plugin.releases[0]?.tag && hasUpdate(plugin) ? 'Update plugin' : managed.length ? 'Install version' : 'Install plugin';
  const toggleFormat = (format: PluginFormat) => setFormats(current => current.includes(format) ? current.filter(item => item !== format) : [...current, format]);

  return <aside className="plugin-detail" aria-label={`${plugin.name} details`}>
    <div className="detail-heading"><PluginGlyph id={plugin.id} large /><span className="detail-category">{plugin.category}</span></div>
    <h2>{plugin.name}</h2>
    <p className="plugin-description">{plugin.description}</p>
    {plugin.notice && <p className="plugin-notice">{plugin.notice}</p>}
    <div className="detail-divider" />
    {plugin.error && <p className="inline-error"><CircleAlert size={15} />{plugin.error}</p>}
    <div className="version-label"><label htmlFor={`release-${plugin.id}`}>Release</label>{release?.publishedAt && <span>{new Date(release.publishedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>}</div>
    <div className="release-select"><select id={`release-${plugin.id}`} value={release?.tag ?? ''} onChange={event => setTag(event.target.value)} disabled={!plugin.releases.length || Boolean(busy)}>{plugin.releases.length ? plugin.releases.map((item, index) => <option key={item.tag} value={item.tag}>Version {formatVersion(item.tag)}{index === 0 ? ' (latest)' : ''}</option>) : <option value="">No releases yet</option>}</select><ChevronDown size={15} /></div>
    <fieldset className="format-fieldset" disabled={Boolean(busy) || !available}><legend>Plugin formats</legend><div className="format-options">{plugin.formats.map(format => <label className={`format-option ${formats.includes(format) ? 'checked' : ''}`} key={format}><input type="checkbox" checked={formats.includes(format)} onChange={() => toggleFormat(format)} /><span className="checkbox-mark">{formats.includes(format) && <Check size={11} strokeWidth={2.4} />}</span><span>{format}</span></label>)}</div></fieldset>
    {available ? <button className="button button-primary install-button" disabled={Boolean(busy) || formats.length === 0 || sameVersion || formats.some(format => unmanaged.some(item => item.format === format))} onClick={() => release && void install(release.tag, formats)}>{working ? <LoaderCircle size={16} className="spin" /> : sameVersion ? <Check size={16} /> : <Download size={16} />}{working ? busy?.action === 'Removing' ? 'Removing…' : 'Installing…' : action}</button> : <div className="source-availability"><p>{release ? `No ${platformName(state.platform)} download for this release.` : 'A packaged release is not available yet.'}</p><button className="button button-secondary" onClick={() => void openExternal(`${plugin.url}#readme`)}>Build from source<ArrowUpRight size={14} /></button></div>}
    {working && <div className="install-progress" role="status"><div className={`progress-track ${percent === undefined ? 'indeterminate' : ''}`} role="progressbar" aria-label="Installation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={percent === undefined ? undefined : { width: `${percent}%` }} /></div><p>{progress?.id === plugin.id ? progress.message : 'Preparing…'}</p></div>}
    {unmanaged.length > 0 && <p className="unmanaged-note"><CircleAlert size={14} /><span>{unmanaged.map(item => item.format).join(', ')} found outside this manager. Move the existing plugin or choose another installation folder to install a managed copy.</span></p>}
    {managed.length > 0 && <div className="installed-details"><div className="installed-details-heading"><Check size={13} /><span>On this computer</span><button className="icon-button remove-button" onClick={() => setConfirmRemove(true)} disabled={Boolean(busy)} aria-label={`Remove ${plugin.name}`} title="Remove plugin"><Trash2 size={14} /></button></div>{managed.map(item => <div className="installed-version" key={item.format} title={item.path}><span>{item.format}</span><span>{formatVersion(item.version)}</span></div>)}</div>}
    <div className="detail-links"><button onClick={() => void openExternal(plugin.url)}><Github size={14} /><span>View project</span><ArrowUpRight size={13} /></button>{release && <button onClick={() => void openExternal(release.url)}><ExternalLink size={14} /><span>Release notes</span><ArrowUpRight size={13} /></button>}</div>
    {confirmRemove && <ConfirmDialog title={`Remove ${plugin.name}?`} description={`This removes the managed ${managed.map(item => item.format).join(' and ')} ${managed.length > 1 ? 'plugins' : 'plugin'} from your computer. You can install them again from the library.`} busy={Boolean(busy)} onCancel={() => setConfirmRemove(false)} onConfirm={async () => { if (await uninstall(managed.map(item => item.format))) setConfirmRemove(false); }} />}
  </aside>;
}

function ConfirmDialog({ title, description, busy, onCancel, onConfirm }: { title: string; description: string; busy: boolean; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className="confirm-dialog" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }} onClick={event => { if (event.target === event.currentTarget && !busy) onCancel(); }} aria-labelledby="confirm-title" aria-describedby="confirm-description"><div className="dialog-content"><span className="dialog-icon"><Trash2 size={22} strokeWidth={1.5} /></span><h2 id="confirm-title">{title}</h2><p id="confirm-description">{description}</p><div className="dialog-actions"><button autoFocus className="button button-secondary" disabled={busy} onClick={onCancel}>Keep plugin</button><button className="button button-danger" disabled={busy} onClick={() => void onConfirm()}>{busy ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}{busy ? 'Removing…' : 'Remove plugin'}</button></div></div></dialog>;
}

function SettingsPanel({ state, manager, busy, save, onError, openExternal }: { state: ManagerState; manager: ManagerAPI; busy: Busy; save: (settings: Settings) => Promise<boolean>; onError: (message: string) => void; openExternal: (url: string) => Promise<void> }) {
  const [draft, setDraft] = useState<Settings>(state.settings);
  const [choosing, setChoosing] = useState(false);
  const changed = JSON.stringify(draft) !== JSON.stringify(state.settings);
  const formats: PluginFormat[] = state.platform === 'darwin' ? ['VST3', 'AU'] : ['VST3'];
  const choose = async (format: PluginFormat) => {
    setChoosing(true);
    try { const path = await manager.chooseDirectory(format); if (path) setDraft(current => ({ ...current, paths: { ...current.paths, [format]: path } })); }
    catch (error) { onError(errorMessage(error)); }
    finally { setChoosing(false); }
  };
  return <div className="settings-panel"><section className="settings-section"><h2>Installation folders</h2><p>New plugins install here. Existing installations stay in their current folders.</p>{formats.map(format => <div className="path-setting" key={format}><label htmlFor={`path-${format}`}>{format === 'AU' ? 'Audio Units' : 'VST3'}</label><div className="path-control"><Folder size={17} /><input id={`path-${format}`} value={draft.paths[format]} onChange={event => setDraft(current => ({ ...current, paths: { ...current.paths, [format]: event.target.value } }))} spellCheck={false} autoComplete="off" disabled={Boolean(busy) || choosing} /><button className="button button-secondary" onClick={() => void choose(format)} disabled={Boolean(busy) || choosing}>Choose folder</button></div></div>)}{state.platform === 'win32' && <p className="settings-hint">Add your VST3 folder to your DAW’s plugin search paths, then rescan.</p>}</section><section className="settings-section release-settings"><div><h2>Prereleases</h2><p>Include early versions when checking for updates.</p></div><button type="button" role="switch" aria-checked={draft.includePrereleases} aria-label="Include prereleases" className={`switch ${draft.includePrereleases ? 'switch-on' : ''}`} disabled={Boolean(busy)} onClick={() => setDraft(current => ({ ...current, includePrereleases: !current.includePrereleases }))}><span /></button></section><div className="settings-actions"><span>{changed ? 'You have unsaved changes.' : 'Your preferences are saved on this computer.'}</span><button className="button button-primary" disabled={!changed || Boolean(busy) || choosing || formats.some(format => !draft.paths[format]?.trim())} onClick={() => void save(draft)}>{busy?.id === 'settings' ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}Save changes</button></div><div className="about-settings"><AudioLines size={21} strokeWidth={1.5} /><div><span>OpenVST Manager {state.appVersion}</span><p>{platformName(state.platform)} {state.arch}</p></div><button className="button button-quiet" onClick={() => void openExternal('https://github.com/alanmarcero/alan-m-OpenVSTManager/releases/latest')}>Manager releases<ArrowUpRight size={13} /></button></div></div>;
}
