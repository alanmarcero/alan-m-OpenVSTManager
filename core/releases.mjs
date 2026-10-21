import semver from 'semver';

export function compatibleAsset(name, platform, arch) {
  if (typeof name !== 'string' || !/\.zip$/i.test(name)) return false;
  const mac = /macos|darwin|(?:^|[-_])mac(?:[-_.]|$)/i.test(name);
  const windows = /windows|win64|win32|(?:^|[-_])win(?:[-_.]|$)/i.test(name);
  const linux = /linux/i.test(name);
  if (platform === 'darwin' ? !mac : platform === 'win32' ? !windows : platform === 'linux' ? !linux : true) return false;
  if (/universal/i.test(name)) return platform === 'darwin';
  if (/arm64|aarch64/i.test(name)) return arch === 'arm64';
  if (/x64|x86_64|amd64|win64/i.test(name)) return arch === 'x64';
  // The catalog's unqualified macOS archives are universal; other legacy builds are x64.
  return platform === 'darwin' || arch === 'x64';
}

export function trustedAssetURL(value, repo) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && !url.port
      && url.pathname.startsWith(`/alanmarcero/${repo}/releases/download/`);
  } catch { return false; }
}

export function normalizeReleases(raw, { platform, arch, repo, includePrereleases = false }) {
  if (!Array.isArray(raw)) throw new Error('GitHub returned an invalid release list.');
  return raw.filter(r => !r.draft && (includePrereleases || !r.prerelease) && typeof r.tag_name === 'string')
    .map(r => ({
      tag: r.tag_name, name: r.name || r.tag_name, publishedAt: r.published_at,
      notes: typeof r.body === 'string' ? r.body : '',
      url: `https://github.com/alanmarcero/${repo}/releases/tag/${encodeURIComponent(r.tag_name)}`,
      prerelease: Boolean(r.prerelease),
      assets: (Array.isArray(r.assets) ? r.assets : []).filter(a => trustedAssetURL(a.browser_download_url, repo) && /\.zip$/i.test(a.name))
        .map(a => ({ name: a.name, url: a.browser_download_url, size: a.size, digest: a.digest || null, compatible: compatibleAsset(a.name, platform, arch) })),
    })).sort((a,b) => {
      const av = semver.valid(a.tag), bv = semver.valid(b.tag);
      return av && bv ? semver.rcompare(av,bv) : (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0);
    });
}

export function selectAsset(release, format) {
  const assets = release.assets.filter(a => a.compatible);
  const formatOf = a => a.name.match(/(?:^|[-_])(VST3|AU|LV2|CLAP|Standalone)(?:[-_.]|$)/i)?.[1].toUpperCase();
  const asset = assets.find(a => formatOf(a) === format) || assets.find(a => !formatOf(a));
  if (!asset) throw new Error(`No compatible ${format} download is available for this system.`);
  return asset;
}

export function validateCatalog(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw new Error('Invalid plugin catalog.');
  const ids = new Set();
  return value.map(p => {
    if (!p || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(p.repo) || p.repo.includes('..') || p.id !== p.repo) throw new Error('Invalid catalog repository.');
    if (ids.has(p.id)) throw new Error('Invalid catalog: duplicate plugin.');
    ids.add(p.id);
    for (const key of ['name','description','category']) if (typeof p[key] !== 'string' || p[key].length > 1000) throw new Error(`Invalid catalog ${key}.`);
    if (!p.bundleNames?.VST3) throw new Error('Missing VST3 bundle name.');
    const bundleNames = {};
    for (const [format,name] of Object.entries(p.bundleNames)) {
      const suffix = format === 'VST3' ? '.vst3' : format === 'AU' ? '.component' : null;
      const names = Array.isArray(name) ? name : [name];
      if (!suffix || !names.length || names.length > 8 || names.some(value => typeof value !== 'string' || /[\\/:\x00-\x1f]/.test(value) || value.includes('..') || !value.endsWith(suffix))) throw new Error('Invalid plugin bundle name.');
      bundleNames[format] = name;
    }
    return { id:p.id,repo:p.repo,name:p.name,description:p.description,category:p.category,bundleNames,
      url:`https://github.com/alanmarcero/${p.repo}`, ...(typeof p.notice === 'string' ? {notice:p.notice.slice(0,1000)} : {}) };
  });
}
