import { open, rm, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import semver from 'semver';

const CDN_HOSTS = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github.com']);

export function findAppUpdate({
  currentVersion,
  platform = process.platform,
  arch = process.arch,
  releases = [],
  includePrereleases = false,
} = {}) {
  if (!Array.isArray(releases) || !currentVersion) {
    return { available: false, currentVersion, latestVersion: currentVersion };
  }

  const cleanCurrent = semver.clean(currentVersion) || currentVersion;
  const validCurrent = semver.valid(cleanCurrent);
  if (!validCurrent) {
    return { available: false, currentVersion, latestVersion: currentVersion };
  }

  const candidates = releases.filter((release) => {
    if (!release || release.draft || (!includePrereleases && release.prerelease)) return false;
    const cleanTag = semver.clean(release.tag_name) || release.tag_name;
    const validTag = semver.valid(cleanTag);
    return Boolean(validTag && semver.gt(validTag, validCurrent));
  }).sort((a, b) => {
    const va = semver.clean(a.tag_name) || a.tag_name;
    const vb = semver.clean(b.tag_name) || b.tag_name;
    return semver.rcompare(va, vb);
  });

  for (const release of candidates) {
    const assets = Array.isArray(release.assets) ? release.assets : [];
    let matchingAsset = null;

    if (platform === 'win32') {
      matchingAsset = assets.find((a) => typeof a.name === 'string' && a.name.endsWith('.exe') && (a.name.includes('-win-') || a.name.includes('win')));
      if (!matchingAsset) matchingAsset = assets.find((a) => typeof a.name === 'string' && a.name.endsWith('.exe'));
    } else if (platform === 'darwin') {
      const dmgs = assets.filter((a) => typeof a.name === 'string' && a.name.endsWith('.dmg'));
      if (arch === 'arm64') {
        matchingAsset = dmgs.find((a) => a.name.includes('arm64')) || dmgs.find((a) => !a.name.includes('x64')) || dmgs[0];
      } else {
        matchingAsset = dmgs.find((a) => a.name.includes('x64')) || dmgs.find((a) => !a.name.includes('arm64')) || dmgs[0];
      }
    } else {
      matchingAsset = assets.find((a) => typeof a.name === 'string' && (a.name.endsWith('.AppImage') || a.name.endsWith('.tar.gz')));
    }

    if (matchingAsset) {
      const shaAsset = assets.find((a) => a.name === 'SHA256SUMS.txt' || a.name.toLowerCase().endsWith('.sha256'));
      const latestVersion = (semver.clean(release.tag_name) || release.tag_name).replace(/^v(?=\d)/, '');
      return {
        available: true,
        currentVersion,
        latestVersion,
        tag: release.tag_name,
        releaseName: release.name || release.tag_name,
        publishedAt: release.published_at,
        notes: typeof release.body === 'string' ? release.body : '',
        url: release.html_url || `https://github.com/alanmarcero/alan-m-OpenVSTManager/releases/tag/${encodeURIComponent(release.tag_name)}`,
        asset: {
          name: matchingAsset.name,
          url: matchingAsset.browser_download_url,
          size: matchingAsset.size,
        },
        checksumAsset: shaAsset ? {
          name: shaAsset.name,
          url: shaAsset.browser_download_url,
        } : null,
      };
    }
  }

  return { available: false, currentVersion, latestVersion: currentVersion };
}

async function fetchWithRedirects(url, { maxRedirects = 6, fetchImpl = fetch, timeoutMs = 60_000 } = {}) {
  let response, currentUrl = url;
  const signal = AbortSignal.timeout(timeoutMs);
  for (let redirects = 0; redirects < maxRedirects; redirects++) {
    response = await fetchImpl(currentUrl, {
      redirect: 'manual',
      signal,
      headers: { 'User-Agent': 'OpenVSTManager-Updater' },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const target = new URL(response.headers.get('location'), currentUrl);
    if (target.protocol !== 'https:' || target.port || target.username || target.password || !CDN_HOSTS.has(target.hostname)) {
      throw new Error('Refused an unsafe download redirect.');
    }
    await response.body?.cancel();
    currentUrl = target.href;
  }
  if (!response?.ok || !response.body) {
    throw new Error(`Download failed (${response?.status ?? 'no response'}). Try again.`);
  }
  return response;
}

export async function downloadAppUpdate({
  asset,
  checksumAsset,
  tempDir,
  onProgress = () => {},
  fetchImpl = fetch,
  maxBytes = 512 * 1024 * 1024,
}) {
  if (!asset?.url || !tempDir) throw new Error('Invalid download parameters.');
  const destination = path.join(tempDir, asset.name);

  // Download main update asset
  const response = await fetchWithRedirects(asset.url, { fetchImpl, timeoutMs: 5 * 60 * 1000 });
  const length = Number(response.headers.get('content-length')) || asset.size || 0;
  if (length > maxBytes) {
    await response.body.cancel();
    throw new Error('Download exceeds size limit.');
  }

  const file = await open(destination, 'wx', 0o755);
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error('Download exceeds size limit.');
      await file.writeFile(chunk);
      if (length > 0) onProgress(Math.min(100, Math.round((bytes / length) * 100)));
    }
    if (!bytes || (length > 0 && bytes !== length)) {
      throw new Error('Download was incomplete. Try again.');
    }
    onProgress(100);
  } catch (error) {
    await file.close();
    await rm(destination, { force: true });
    throw error;
  }
  await file.close();

  // Verify sha256 checksum if available
  if (checksumAsset?.url) {
    try {
      const shaResponse = await fetchWithRedirects(checksumAsset.url, { fetchImpl, timeoutMs: 30_000 });
      const shaText = await shaResponse.text();
      let expectedHash = null;
      for (const line of shaText.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^([a-f0-9]{64})\s+[*]?(.+)$/i);
        if (match && match[2].trim() === asset.name) {
          expectedHash = match[1].toLowerCase();
          break;
        }
      }
      if (expectedHash) {
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(destination)) {
          hash.update(chunk);
        }
        const actualHash = hash.digest('hex').toLowerCase();
        if (actualHash !== expectedHash) {
          await rm(destination, { force: true });
          throw new Error(`Checksum mismatch for ${asset.name}. Expected ${expectedHash}, got ${actualHash}.`);
        }
      }
    } catch (error) {
      if (error.message.includes('Checksum mismatch')) throw error;
      // If checksum file cannot be fetched, don't abort an otherwise valid download unless mismatch
    }
  }

  return destination;
}

export function applyAppUpdate({
  installerPath,
  platform = process.platform,
  spawnImpl = spawn,
}) {
  if (!installerPath) throw new Error('Installer path required.');

  if (platform === 'win32') {
    const child = spawnImpl(installerPath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return true;
  }

  return false;
}
