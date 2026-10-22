export type PluginFormat = 'VST3' | 'AU';

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
  digest?: string | null;
  compatible: boolean;
}

export interface PluginRelease {
  tag: string;
  name: string;
  publishedAt: string;
  notes: string;
  url: string;
  assets: ReleaseAsset[];
  availableFormats?: PluginFormat[];
}

export interface InstalledPlugin {
  format: PluginFormat;
  version: string | null;
  path: string;
  managed: boolean;
  locationMismatch?: boolean;
}

export interface Plugin {
  id: string;
  name: string;
  description: string;
  category: string;
  repo: string;
  url: string;
  bundleNames: { VST3: string | string[]; AU?: string | string[] };
  formats: PluginFormat[];
  installed: InstalledPlugin[];
  releases: PluginRelease[];
  error?: string;
  notice?: string;
}

export interface PathOption {
  label: string;
  path: string;
}

export interface Settings {
  includePrereleases: boolean;
  paths: Record<PluginFormat, string>;
}

export interface ManagerState {
  platform: string;
  arch: string;
  appVersion: string;
  plugins: Plugin[];
  settings: Settings;
  pathOptions?: Partial<Record<PluginFormat, PathOption[]>>;
  lastChecked: string | number | null;
  offline: boolean;
  error?: string;
}

export interface Progress {
  id: string;
  phase: string;
  message: string;
  percent?: number;
}

export interface ManagerAPI {
  getState(): Promise<ManagerState>;
  refresh(): Promise<ManagerState>;
  install(options: { id: string; tag: string; formats: PluginFormat[]; overwrite?: boolean }): Promise<ManagerState>;
  uninstall(options: { id: string; formats: PluginFormat[]; unmanaged?: boolean }): Promise<ManagerState>;
  move?(options: { id: string; formats: PluginFormat[]; overwrite?: boolean }): Promise<ManagerState>;
  moveAll?(): Promise<ManagerState>;
  saveSettings(settings: { includePrereleases?: boolean; paths?: Partial<Record<PluginFormat, string>> }): Promise<ManagerState>;
  chooseDirectory(format: PluginFormat): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  onProgress(callback: (progress: Progress) => void): () => void;
}

declare global {
  interface Window {
    manager?: ManagerAPI;
  }
}
