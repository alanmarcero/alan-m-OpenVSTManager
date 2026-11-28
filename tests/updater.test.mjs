import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { findAppUpdate, downloadAppUpdate, applyAppUpdate } from '../core/updater.mjs';

const RELEASE_DL = 'https://github.com/alanmarcero/alan-m-OpenVSTManager/releases/download/v1.2.0';
const { publicKey: TEST_PUBLIC_KEY, privateKey: TEST_PRIVATE_KEY } = generateKeyPairSync('ed25519');
const signManifest = (content) => sign(null, Buffer.from(content, 'utf8'), TEST_PRIVATE_KEY);

test('findAppUpdate finds a newer release with compatible asset for Windows', () => {
  const releases = [
    {
      tag_name: 'v1.2.0',
      name: 'v1.2.0 Release',
      published_at: '2026-11-11T12:00:00Z',
      body: 'Bug fixes and auto-update support.',
      html_url: 'https://github.com/alanmarcero/alan-m-OpenVSTManager/releases/tag/v1.2.0',
      assets: [
        { name: 'OpenVSTManager-1.2.0-win-x64.exe', browser_download_url: `${RELEASE_DL}/OpenVSTManager-1.2.0-win-x64.exe`, size: 1000 },
        { name: 'OpenVSTManager-1.2.0-mac-arm64.dmg', browser_download_url: `${RELEASE_DL}/OpenVSTManager-1.2.0-mac-arm64.dmg`, size: 1000 },
        { name: 'SHA256SUMS.txt', browser_download_url: `${RELEASE_DL}/SHA256SUMS.txt`, size: 200 },
        { name: 'SHA256SUMS.txt.sig', browser_download_url: `${RELEASE_DL}/SHA256SUMS.txt.sig`, size: 64 },
      ],
    },
    {
      tag_name: 'v1.1.0',
      name: 'v1.1.0',
      published_at: '2026-11-10T21:00:00Z',
      assets: [],
    },
  ];

  const update = findAppUpdate({
    currentVersion: '1.1.0',
    platform: 'win32',
    arch: 'x64',
    releases,
  });

  assert.equal(update.available, true);
  assert.equal(update.latestVersion, '1.2.0');
  assert.equal(update.tag, 'v1.2.0');
  assert.equal(update.asset.name, 'OpenVSTManager-1.2.0-win-x64.exe');
  assert.equal(update.checksumAsset.name, 'SHA256SUMS.txt');
  assert.equal(update.signatureAsset.name, 'SHA256SUMS.txt.sig');
});

test('findAppUpdate finds arm64 and x64 dmg for macOS and picks exact per-asset sha256', () => {
  const releases = [
    {
      tag_name: 'v1.2.0',
      published_at: '2026-11-11T12:00:00Z',
      assets: [
        { name: 'OpenVSTManager-1.2.0-win-x64.exe', browser_download_url: `${RELEASE_DL}/OpenVSTManager-1.2.0-win-x64.exe`, size: 100 },
        { name: 'OpenVSTManager-1.2.0-win-x64.exe.sha256', browser_download_url: `${RELEASE_DL}/OpenVSTManager-1.2.0-win-x64.exe.sha256`, size: 64 },
        { name: 'OpenVSTManager-1.2.0-mac-arm64.dmg', browser_download_url: `${RELEASE_DL}/OpenVSTManager-1.2.0-mac-arm64.dmg`, size: 100 },
        { name: 'OpenVSTManager-1.2.0-mac-arm64.dmg.sha256', browser_download_url: `${RELEASE_DL}/OpenVSTManager-1.2.0-mac-arm64.dmg.sha256`, size: 64 },
        { name: 'OpenVSTManager-1.2.0-mac-x64.dmg', browser_download_url: `${RELEASE_DL}/OpenVSTManager-1.2.0-mac-x64.dmg`, size: 100 },
      ],
    },
  ];

  const updateArm = findAppUpdate({
    currentVersion: '1.1.0',
    platform: 'darwin',
    arch: 'arm64',
    releases,
  });
  assert.equal(updateArm.available, true);
  assert.equal(updateArm.asset.name, 'OpenVSTManager-1.2.0-mac-arm64.dmg');
  assert.equal(updateArm.checksumAsset.name, 'OpenVSTManager-1.2.0-mac-arm64.dmg.sha256');

  const updateX64 = findAppUpdate({
    currentVersion: '1.1.0',
    platform: 'darwin',
    arch: 'x64',
    releases,
  });
  assert.equal(updateX64.available, true);
  assert.equal(updateX64.asset.name, 'OpenVSTManager-1.2.0-mac-x64.dmg');
  assert.equal(updateX64.checksumAsset, null);
});

test('findAppUpdate returns available false when already up to date or older', () => {
  const releases = [
    { tag_name: 'v1.1.0', assets: [{ name: 'app.exe', browser_download_url: `${RELEASE_DL}/app.exe`, size: 100 }] },
    { tag_name: 'v1.0.0', assets: [{ name: 'app.exe', browser_download_url: `${RELEASE_DL}/app.exe`, size: 100 }] },
  ];

  const update = findAppUpdate({
    currentVersion: '1.1.0',
    platform: 'win32',
    arch: 'x64',
    releases,
  });
  assert.equal(update.available, false);
});

test('findAppUpdate respects includePrereleases flag and discards untrusted foreign repo assets', () => {
  const releases = [
    {
      tag_name: 'v1.3.0-beta.1',
      prerelease: true,
      assets: [
        { name: 'Evil.exe', browser_download_url: 'https://github.com/evil/repo/releases/download/v1.3.0/Evil.exe', size: 100 },
        { name: 'OpenVSTManager-1.3.0-beta.1-win-x64.exe', browser_download_url: `${RELEASE_DL}/OpenVSTManager-1.3.0-beta.1-win-x64.exe`, size: 100 },
      ],
    },
    {
      tag_name: 'v1.1.0',
      assets: [],
    },
  ];

  const withoutBeta = findAppUpdate({
    currentVersion: '1.1.0',
    platform: 'win32',
    arch: 'x64',
    releases,
    includePrereleases: false,
  });
  assert.equal(withoutBeta.available, false);

  const withBeta = findAppUpdate({
    currentVersion: '1.1.0',
    platform: 'win32',
    arch: 'x64',
    releases,
    includePrereleases: true,
  });
  assert.equal(withBeta.available, true);
  assert.equal(withBeta.latestVersion, '1.3.0-beta.1');
  assert.equal(withBeta.asset.name, 'OpenVSTManager-1.3.0-beta.1-win-x64.exe');
});

test('downloadAppUpdate downloads and verifies Ed25519 signature and sha256 checksum', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'updater-test-'));
  const payload = Buffer.from('mock-installer-binary-data');
  const expectedHash = createHash('sha256').update(payload).digest('hex');
  const shaContent = `${expectedHash}  OpenVSTManager-1.2.0-win-x64.exe\n`;
  const sigBytes = signManifest(shaContent);

  const fetchMock = async (url) => {
    if (url.endsWith('.sig')) return new Response(sigBytes, { status: 200 });
    if (url.includes('SHA256SUMS.txt')) return new Response(shaContent, { status: 200 });
    return new Response(payload, {
      status: 200,
      headers: { 'content-length': String(payload.length) },
    });
  };

  const downloadedPath = await downloadAppUpdate({
    asset: {
      name: 'OpenVSTManager-1.2.0-win-x64.exe',
      url: `${RELEASE_DL}/OpenVSTManager-1.2.0-win-x64.exe`,
      size: payload.length,
    },
    checksumAsset: {
      name: 'SHA256SUMS.txt',
      url: `${RELEASE_DL}/SHA256SUMS.txt`,
    },
    signatureAsset: {
      name: 'SHA256SUMS.txt.sig',
      url: `${RELEASE_DL}/SHA256SUMS.txt.sig`,
    },
    publicKey: TEST_PUBLIC_KEY,
    tempDir: dir,
    fetchImpl: fetchMock,
  });

  const content = await readFile(downloadedPath);
  assert.deepEqual(content, payload);
  await rm(dir, { recursive: true, force: true });
});

test('downloadAppUpdate throws on checksum mismatch even with valid manifest signature', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'updater-test-'));
  const payload = Buffer.from('corrupted-data');
  const shaContent = `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  OpenVSTManager-1.2.0-win-x64.exe\n`;
  const sigBytes = signManifest(shaContent);

  const fetchMock = async (url) => {
    if (url.endsWith('.sig')) return new Response(sigBytes, { status: 200 });
    if (url.includes('SHA256SUMS.txt')) return new Response(shaContent, { status: 200 });
    return new Response(payload, { status: 200, headers: { 'content-length': String(payload.length) } });
  };

  await assert.rejects(async () => {
    await downloadAppUpdate({
      asset: {
        name: 'OpenVSTManager-1.2.0-win-x64.exe',
        url: `${RELEASE_DL}/OpenVSTManager-1.2.0-win-x64.exe`,
        size: payload.length,
      },
      checksumAsset: {
        name: 'SHA256SUMS.txt',
        url: `${RELEASE_DL}/SHA256SUMS.txt`,
      },
      signatureAsset: {
        name: 'SHA256SUMS.txt.sig',
        url: `${RELEASE_DL}/SHA256SUMS.txt.sig`,
      },
      publicKey: TEST_PUBLIC_KEY,
      tempDir: dir,
      fetchImpl: fetchMock,
    });
  }, /Checksum mismatch/);

  await rm(dir, { recursive: true, force: true });
});

test('applyAppUpdate spawns detached installer on Windows', () => {
  let spawned = null;
  const mockSpawn = (cmd, args, opts) => {
    spawned = { cmd, args, opts, unrefed: false };
    return {
      unref: () => { spawned.unrefed = true; },
    };
  };

  const result = applyAppUpdate({
    installerPath: 'C:\\temp\\installer.exe',
    platform: 'win32',
    spawnImpl: mockSpawn,
  });

  assert.equal(result, true);
  assert.equal(spawned.cmd, 'C:\\temp\\installer.exe');
  assert.equal(spawned.opts.detached, true);
  assert.equal(spawned.unrefed, true);
});

test('downloadAppUpdate rejects untrusted or unscoped github.com URLs and unsafe asset filenames', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'updater-sec-'));
  try {
    await assert.rejects(() => downloadAppUpdate({
      asset: { name: 'OpenVSTManager.exe', url: 'https://evil.example/app.exe', size: 10 },
      tempDir: dir,
      fetchImpl: async () => { throw new Error('should not fetch'); },
    }), /untrusted/i);

    await assert.rejects(() => downloadAppUpdate({
      asset: { name: 'OpenVSTManager.exe', url: 'https://github.com/otherorg/otherrepo/releases/download/v1.0.0/app.exe', size: 10 },
      tempDir: dir,
      fetchImpl: async () => { throw new Error('should not fetch'); },
    }), /untrusted/i);

    await assert.rejects(() => downloadAppUpdate({
      asset: { name: 'OpenVSTManager.exe', url: 'https://objects.githubusercontent.com/some/path/app.exe', size: 10 },
      tempDir: dir,
      fetchImpl: async () => { throw new Error('should not fetch'); },
    }), /untrusted/i);

    await assert.rejects(() => downloadAppUpdate({
      asset: { name: '../escape.exe', url: `${RELEASE_DL}/escape.exe`, size: 10 },
      tempDir: dir,
      fetchImpl: async () => { throw new Error('should not fetch'); },
    }), /Invalid update asset filename/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('applyAppUpdate opens dmg on macOS and returns false on Linux', () => {
  let spawned = null;
  const mockSpawn = (cmd, args, opts) => {
    spawned = { cmd, args, opts, unrefed: false };
    return { unref: () => { spawned.unrefed = true; } };
  };
  assert.equal(applyAppUpdate({ installerPath: '/tmp/app.dmg', platform: 'darwin', spawnImpl: mockSpawn }), true);
  assert.equal(spawned.cmd, 'open');
  assert.deepEqual(spawned.args, ['/tmp/app.dmg']);
  assert.equal(spawned.unrefed, true);
  assert.equal(applyAppUpdate({ installerPath: '/tmp/app.AppImage', platform: 'linux', spawnImpl: mockSpawn }), false);
});

test('downloadAppUpdate verifies ./ prefixed manifests and refuses unsigned or tampered manifests', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'updater-sha-'));
  try {
    const payload = Buffer.from('verified-installer-payload');
    const expectedHash = createHash('sha256').update(payload).digest('hex');
    const shaContent = `${expectedHash}  ./OpenVSTManager-1.4.3-win-x64.exe\n`;
    const sigBytes = signManifest(shaContent);

    const downloaded = await downloadAppUpdate({
      asset: { name: 'OpenVSTManager-1.4.3-win-x64.exe', url: `${RELEASE_DL}/OpenVSTManager-1.4.3-win-x64.exe`, size: payload.length },
      checksumAsset: { name: 'SHA256SUMS.txt', url: `${RELEASE_DL}/SHA256SUMS.txt` },
      signatureAsset: { name: 'SHA256SUMS.txt.sig', url: `${RELEASE_DL}/SHA256SUMS.txt.sig` },
      publicKey: TEST_PUBLIC_KEY,
      tempDir: dir,
      fetchImpl: async (url) => {
        if (url.endsWith('.sig')) return new Response(sigBytes, { status: 200 });
        if (url.includes('SHA256SUMS')) return new Response(shaContent, { status: 200 });
        return new Response(payload, { status: 200, headers: { 'content-length': String(payload.length) } });
      },
    });
    assert.deepEqual(await readFile(downloaded), payload);
    await rm(downloaded, { force: true });

    let fetchedBinary = false;
    await assert.rejects(() => downloadAppUpdate({
      asset: { name: 'OpenVSTManager-1.4.3-win-x64.exe', url: `${RELEASE_DL}/OpenVSTManager-1.4.3-win-x64.exe`, size: payload.length },
      checksumAsset: { name: 'SHA256SUMS.txt', url: `${RELEASE_DL}/SHA256SUMS.txt` },
      signatureAsset: { name: 'SHA256SUMS.txt.sig', url: `${RELEASE_DL}/SHA256SUMS.txt.sig` },
      publicKey: TEST_PUBLIC_KEY,
      tempDir: dir,
      fetchImpl: async (url) => {
        if (url.endsWith('.sig')) return new Response(sigBytes, { status: 200 });
        if (url.includes('SHA256SUMS')) return new Response('tampered-manifest', { status: 200 });
        fetchedBinary = true;
        return new Response(payload, { status: 200 });
      },
    }), /signature is invalid/i);
    assert.equal(fetchedBinary, false);

    await assert.rejects(() => downloadAppUpdate({
      asset: { name: 'OpenVSTManager-1.4.3-win-x64.exe', url: `${RELEASE_DL}/OpenVSTManager-1.4.3-win-x64.exe`, size: payload.length },
      checksumAsset: { name: 'SHA256SUMS.txt', url: `${RELEASE_DL}/SHA256SUMS.txt` },
      signatureAsset: { name: 'SHA256SUMS.txt.sig', url: `${RELEASE_DL}/SHA256SUMS.txt.sig` },
      tempDir: dir,
      fetchImpl: async () => { throw new Error('should not fetch without public key'); },
    }), /signing public key/i);

    await assert.rejects(() => downloadAppUpdate({
      asset: { name: 'OpenVSTManager-1.4.3-win-x64.exe', url: `${RELEASE_DL}/OpenVSTManager-1.4.3-win-x64.exe`, size: payload.length },
      checksumAsset: { name: 'SHA256SUMS.txt', url: `${RELEASE_DL}/SHA256SUMS.txt` },
      signatureAsset: { name: 'SHA256SUMS.txt.sig', url: `${RELEASE_DL}/SHA256SUMS.txt.sig` },
      publicKey: TEST_PUBLIC_KEY,
      tempDir: dir,
      fetchImpl: async (url) => url.includes('SHA256SUMS.txt.sig')
        ? new Response(sigBytes, { status: 200 })
        : url.includes('SHA256SUMS')
          ? new Response('not found', { status: 404 })
          : new Response(payload, { status: 200, headers: { 'content-length': String(payload.length) } }),
    }), /Checksum verification failed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('downloadAppUpdate rejects untrusted checksum/signature URLs before downloading installer and applyAppUpdate requires absolute paths', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'updater-sec-url-'));
  try {
    let fetched = false;
    await assert.rejects(() => downloadAppUpdate({
      asset: { name: 'OpenVSTManager.exe', url: `${RELEASE_DL}/OpenVSTManager.exe`, size: 10 },
      checksumAsset: { name: 'SHA256SUMS.txt', url: 'https://evil.example/SHA256SUMS.txt' },
      signatureAsset: { name: 'SHA256SUMS.txt.sig', url: `${RELEASE_DL}/SHA256SUMS.txt.sig` },
      publicKey: TEST_PUBLIC_KEY,
      tempDir: dir,
      fetchImpl: async () => { fetched = true; return new Response('x'); },
    }), /untrusted/i);
    assert.equal(fetched, false);
    assert.throws(() => applyAppUpdate({ installerPath: 'relative/setup.exe', platform: 'win32' }), /Absolute installer path/);

    await assert.rejects(() => downloadAppUpdate({
      asset: { name: 'OpenVSTManager.exe', url: `${RELEASE_DL}/OpenVSTManager.exe`, size: 10 },
      tempDir: dir,
      fetchImpl: async () => new Response('x'),
    }), /SHA256SUMS\.txt/);

    await assert.rejects(() => downloadAppUpdate({
      asset: { name: 'OpenVSTManager.exe', url: `${RELEASE_DL}/OpenVSTManager.exe`, size: 10 },
      checksumAsset: { name: 'SHA256SUMS.txt', url: `${RELEASE_DL}/SHA256SUMS.txt` },
      tempDir: dir,
      fetchImpl: async () => new Response('x'),
    }), /missing checksum signature/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
