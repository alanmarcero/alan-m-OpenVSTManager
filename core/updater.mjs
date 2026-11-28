import { open, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, createPublicKey, verify } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import semver from 'semver';

const APP_REPO = 'alanmarcero/alan-m-OpenVSTManager';
const APP_DOWNLOAD_PREFIX = `/${APP_REPO}/releases/download/`;
const APP_RELEASE_TAG_PREFIX = `/${APP_REPO}/releases/tag/`;
const CDN_HOSTS = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const DEFAULT_UPDATE_PUBLIC_KEY_PEM = null;

function isTrustedUpdateUrl(value) {
  try {
    const target = new URL(value);
    return target.protocol === 'https:'
      && !target.port
      && !target.username
      && !target.password
      && target.hostname === 'github.com'
      && target.pathname.startsWith(APP_DOWNLOAD_PREFIX);
  } catch {
    return false;
  }
}

function assertTrustedUpdateUrl(value) {
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new Error('Invalid update download URL.');
  }
  if (!isTrustedUpdateUrl(target.href)) {
    throw new Error('Refused an untrusted update download URL.');
  }
  return target.href;
}

function isTrustedRedirectTarget(target) {
  if (target.protocol !== 'https:' || target.port || target.username || target.password) {
    return false;
  }
  return isTrustedUpdateUrl(target.href) || CDN_HOSTS.has(target.hostname);
}

function trustedReleasePageUrl(htmlUrl, tagName) {
  const fallback = `https://github.com/${APP_REPO}/releases/tag/${encodeURIComponent(tagName)}`;
  if (typeof htmlUrl !== 'string' || !htmlUrl) return fallback;
  try {
    const target = new URL(htmlUrl);
    if (
      target.protocol === 'https:'
      && !target.port
      && !target.username
      && !target.password
      && target.hostname === 'github.com'
      && target.pathname.startsWith(APP_RELEASE_TAG_PREFIX)
    ) {
      return target.href;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function resolveSigningPublicKey(publicKey) {
  if (!publicKey) {
    throw new Error('Automatic update verification failed: update signing public key is not configured.');
  }
  const keyObject = typeof publicKey === 'string' || Buffer.isBuffer(publicKey)
    ? createPublicKey(publicKey)
    : publicKey;
  if (keyObject?.asymmetricKeyType !== 'ed25519') {
    throw new Error('Automatic update verification failed: invalid Ed25519 signing public key.');
  }
  return keyObject;
}

function decodeSignatureBytes(sigBuffer) {
  if (sigBuffer.length === 64) return sigBuffer;
  const text = sigBuffer.toString('utf8').trim();
  const decoded = Buffer.from(text, 'base64');
  if (decoded.length === 64 && decoded.toString('base64').replace(/=+$/, '') === text.replace(/=+$/, '')) {
    return decoded;
  }
  throw new Error('Checksum signature has invalid format.');
}

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
    const rawAssets = Array.isArray(release.assets) ? release.assets : [];
    const assets = rawAssets.filter((a) => typeof a?.name === 'string' && isTrustedUpdateUrl(a?.browser_download_url));
    let matchingAsset = null;

    if (platform === 'win32') {
      matchingAsset = assets.find((a) => a.name.endsWith('.exe') && (a.name.includes('-win-') || a.name.includes('win')));
      if (!matchingAsset) matchingAsset = assets.find((a) => a.name.endsWith('.exe'));
    } else if (platform === 'darwin') {
      const dmgs = assets.filter((a) => a.name.endsWith('.dmg'));
      if (arch === 'arm64') {
        matchingAsset = dmgs.find((a) => a.name.includes('arm64')) || dmgs.find((a) => !a.name.includes('x64')) || dmgs[0];
      } else {
        matchingAsset = dmgs.find((a) => a.name.includes('x64')) || dmgs.find((a) => !a.name.includes('arm64')) || dmgs[0];
      }
    } else {
      matchingAsset = assets.find((a) => a.name.endsWith('.AppImage') || a.name.endsWith('.tar.gz'));
    }

    if (matchingAsset) {
      const expectedShaName = `${matchingAsset.name.toLowerCase()}.sha256`;
      const shaAsset = assets.find((a) => a.name === 'SHA256SUMS.txt')
        || assets.find((a) => a.name.toLowerCase() === expectedShaName)
        || null;
      const sigAsset = shaAsset
        ? (assets.find((a) => a.name === `${shaAsset.name}.sig`) || null)
        : null;
      const latestVersion = (semver.clean(release.tag_name) || release.tag_name).replace(/^v(?=\d)/, '');
      return {
        available: true,
        currentVersion,
        latestVersion,
        tag: release.tag_name,
        releaseName: release.name || release.tag_name,
        publishedAt: release.published_at,
        notes: typeof release.body === 'string' ? release.body : '',
        url: trustedReleasePageUrl(release.html_url, release.tag_name),
        autoInstallSupported: Boolean(shaAsset && sigAsset && DEFAULT_UPDATE_PUBLIC_KEY_PEM),
        asset: {
          name: matchingAsset.name,
          url: matchingAsset.browser_download_url,
          size: matchingAsset.size,
        },
        checksumAsset: shaAsset ? {
          name: shaAsset.name,
          url: shaAsset.browser_download_url,
        } : null,
        signatureAsset: sigAsset ? {
          name: sigAsset.name,
          url: sigAsset.browser_download_url,
        } : null,
      };
    }
  }

  return { available: false, currentVersion, latestVersion: currentVersion };
}

async function fetchWithRedirects(url, { maxRedirects = 6, fetchImpl = fetch, timeoutMs = 60_000, appVersion = '1.4.0' } = {}) {
  let response, currentUrl = assertTrustedUpdateUrl(url);
  const signal = AbortSignal.timeout(timeoutMs);
  for (let redirects = 0; redirects < maxRedirects; redirects++) {
    response = await fetchImpl(currentUrl, {
      redirect: 'manual',
      signal,
      headers: { 'User-Agent': `OpenVSTManager/${appVersion}` },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location) throw new Error('Download redirect is missing a target location.');
    const target = new URL(location, currentUrl);
    if (!isTrustedRedirectTarget(target)) {
      throw new Error('Refused an unsafe download redirect.');
    }
    await response.body?.cancel?.().catch(() => {});
    currentUrl = target.href;
  }
  if (!response?.ok || !response.body) {
    throw new Error(`Download failed (${response?.status ?? 'no response'}). Try again.`);
  }
  return response;
}

async function readBoundedResponse(response, maxBytes, overflowMessage) {
  const headerLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(headerLength) && headerLength > maxBytes) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error(overflowMessage);
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maxBytes) throw new Error(overflowMessage);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function fetchVerifiedChecksumManifest({ assetName, checksumAsset, signatureAsset, signingKey, fetchImpl, appVersion }) {
  try {
    const [shaResponse, sigResponse] = await Promise.all([
      fetchWithRedirects(checksumAsset.url, { fetchImpl, timeoutMs: 30_000, appVersion }),
      fetchWithRedirects(signatureAsset.url, { fetchImpl, timeoutMs: 30_000, appVersion }),
    ]);
    const [loadedSha, loadedSig] = await Promise.all([
      readBoundedResponse(shaResponse, 1024 * 1024, 'Checksum manifest exceeds size limit.'),
      readBoundedResponse(sigResponse, 16 * 1024, 'Checksum signature exceeds size limit.'),
    ]);
    const sigBytes = decodeSignatureBytes(loadedSig);
    if (!verify(null, loadedSha, signingKey, sigBytes)) {
      throw new Error('Checksum manifest signature is invalid.');
    }
    return loadedSha;
  } catch (error) {
    throw new Error(`Checksum verification failed for ${assetName}: ${error.message}`, { cause: error });
  }
}

export async function downloadAppUpdate({
  asset,
  checksumAsset,
  signatureAsset,
  publicKey = DEFAULT_UPDATE_PUBLIC_KEY_PEM,
  tempDir,
  appVersion = '1.4.0',
  onProgress = () => {},
  fetchImpl = fetch,
  maxBytes = 512 * 1024 * 1024,
}) {
  if (!asset?.url || !asset?.name || !tempDir) throw new Error('Invalid download parameters.');
  assertTrustedUpdateUrl(asset.url);
  const safeName = path.basename(asset.name);
  if (!safeName || safeName !== asset.name || safeName === '.' || safeName === '..' || /[\x00-\x1f\\/]/.test(safeName)) {
    throw new Error('Invalid update asset filename.');
  }
  if (!checksumAsset?.url) {
    throw new Error('Checksum verification failed: release is missing SHA256SUMS.txt.');
  }
  assertTrustedUpdateUrl(checksumAsset.url);
  if (!signatureAsset?.url) {
    throw new Error('Signature verification failed: release is missing checksum signature.');
  }
  assertTrustedUpdateUrl(signatureAsset.url);
  const signingKey = resolveSigningPublicKey(publicKey);
  if (asset.size > maxBytes) {
    throw new Error('Download exceeds size limit.');
  }

  const shaBuffer = await fetchVerifiedChecksumManifest({
    assetName: asset.name,
    checksumAsset,
    signatureAsset,
    signingKey,
    fetchImpl,
    appVersion,
  });

  const shaText = shaBuffer.toString('utf8');
  const nonEmptyLines = shaText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const matchedLine = nonEmptyLines
    .map((trimmed) => trimmed.match(/^([a-f0-9]{64})\s+[*]?(.+)$/i))
    .find((match) => match && path.posix.basename(match[2].trim().replace(/\\/g, '/')) === asset.name);
  const expectedHash = matchedLine
    ? matchedLine[1].toLowerCase()
    : (nonEmptyLines.length === 1 && /^[a-f0-9]{64}$/i.test(nonEmptyLines[0]) ? nonEmptyLines[0].toLowerCase() : null);
  if (!expectedHash) {
    throw new Error(`Checksum verification failed for ${asset.name}: Checksum manifest does not include ${asset.name}.`);
  }

  const destination = path.join(tempDir, safeName);

  // Download main update asset
  const response = await fetchWithRedirects(asset.url, { fetchImpl, timeoutMs: 5 * 60 * 1000, appVersion });
  const headerLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(headerLength) && headerLength > maxBytes) {
    await response.body.cancel().catch(() => {});
    throw new Error('Download exceeds size limit.');
  }
  if (asset.size > 0 && Number.isFinite(headerLength) && headerLength > 0 && headerLength !== asset.size) {
    await response.body.cancel().catch(() => {});
    throw new Error('Download size does not match release metadata. Try again.');
  }
  const length = (Number.isFinite(headerLength) && headerLength > 0 ? headerLength : 0) || asset.size || 0;

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
    await file.close().catch(() => {});
    await rm(destination, { force: true }).catch(() => {});
    throw error;
  }
  await file.close();

  // Verify downloaded file matches signed sha256 checksum
  try {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(destination)) {
      hash.update(chunk);
    }
    const actualHash = hash.digest('hex').toLowerCase();
    if (actualHash !== expectedHash) {
      throw new Error(`Checksum mismatch for ${asset.name}. Expected ${expectedHash}, got ${actualHash}.`);
    }
  } catch (error) {
    await rm(destination, { force: true }).catch(() => {});
    if (error.message.includes('Checksum mismatch')) throw error;
    throw new Error(`Checksum verification failed for ${asset.name}: ${error.message}`, { cause: error });
  }

  return destination;
}

export function applyAppUpdate({
  installerPath,
  platform = process.platform,
  spawnImpl = spawn,
}) {
  const isAbsolute = platform === 'win32' ? path.win32.isAbsolute : path.posix.isAbsolute;
  if (typeof installerPath !== 'string' || !installerPath.trim() || !isAbsolute(installerPath)) {
    throw new Error('Absolute installer path required.');
  }

  if (platform === 'win32') {
    const child = spawnImpl(installerPath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return true;
  }

  if (platform === 'darwin') {
    const child = spawnImpl('open', [installerPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return true;
  }

  return false;
}
