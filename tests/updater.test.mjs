import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { findAppUpdate, downloadAppUpdate, applyAppUpdate } from '../core/updater.mjs';

test('findAppUpdate finds a newer release with compatible asset for Windows', () => {
  const releases = [
    {
      tag_name: 'v1.2.0',
      name: 'v1.2.0 Release',
      published_at: '2026-11-11T12:00:00Z',
      body: 'Bug fixes and auto-update support.',
      html_url: 'https://github.com/alanmarcero/alan-m-OpenVSTManager/releases/tag/v1.2.0',
      assets: [
        { name: 'OpenVSTManager-1.2.0-win-x64.exe', browser_download_url: 'https://github.com/alanmarcero/alan-m-OpenVSTManager/releases/download/v1.2.0/OpenVSTManager-1.2.0-win-x64.exe', size: 1000 },
        { name: 'OpenVSTManager-1.2.0-mac-arm64.dmg', browser_download_url: 'https://github.com/alanmarcero/alan-m-OpenVSTManager/releases/download/v1.2.0/OpenVSTManager-1.2.0-mac-arm64.dmg', size: 1000 },
        { name: 'SHA256SUMS.txt', browser_download_url: 'https://github.com/alanmarcero/alan-m-OpenVSTManager/releases/download/v1.2.0/SHA256SUMS.txt', size: 200 },
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
});

test('findAppUpdate finds arm64 and x64 dmg for macOS', () => {
  const releases = [
    {
      tag_name: 'v1.2.0',
      published_at: '2026-11-11T12:00:00Z',
      assets: [
        { name: 'OpenVSTManager-1.2.0-win-x64.exe', browser_download_url: 'https://github.com/win.exe', size: 100 },
        { name: 'OpenVSTManager-1.2.0-mac-arm64.dmg', browser_download_url: 'https://github.com/mac-arm.dmg', size: 100 },
        { name: 'OpenVSTManager-1.2.0-mac-x64.dmg', browser_download_url: 'https://github.com/mac-x64.dmg', size: 100 },
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

  const updateX64 = findAppUpdate({
    currentVersion: '1.1.0',
    platform: 'darwin',
    arch: 'x64',
    releases,
  });
  assert.equal(updateX64.available, true);
  assert.equal(updateX64.asset.name, 'OpenVSTManager-1.2.0-mac-x64.dmg');
});

test('findAppUpdate returns available false when already up to date or older', () => {
  const releases = [
    { tag_name: 'v1.1.0', assets: [{ name: 'app.exe', browser_download_url: 'https://github.com/app.exe', size: 100 }] },
    { tag_name: 'v1.0.0', assets: [{ name: 'app.exe', browser_download_url: 'https://github.com/app.exe', size: 100 }] },
  ];

  const update = findAppUpdate({
    currentVersion: '1.1.0',
    platform: 'win32',
    arch: 'x64',
    releases,
  });
  assert.equal(update.available, false);
});

test('findAppUpdate respects includePrereleases flag', () => {
  const releases = [
    {
      tag_name: 'v1.3.0-beta.1',
      prerelease: true,
      assets: [{ name: 'OpenVSTManager-1.3.0-beta.1-win-x64.exe', browser_download_url: 'https://github.com/win.exe', size: 100 }],
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
});

test('downloadAppUpdate downloads and verifies sha256 checksum', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'updater-test-'));
  const payload = Buffer.from('mock-installer-binary-data');
  const expectedHash = createHash('sha256').update(payload).digest('hex');
  const shaContent = `${expectedHash}  OpenVSTManager-1.2.0-win-x64.exe\n`;

  const fetchMock = async (url) => {
    if (url.includes('SHA256SUMS.txt')) {
      return new Response(shaContent, { status: 200 });
    }
    return new Response(payload, {
      status: 200,
      headers: { 'content-length': String(payload.length) },
    });
  };

  const downloadedPath = await downloadAppUpdate({
    asset: {
      name: 'OpenVSTManager-1.2.0-win-x64.exe',
      url: 'https://github.com/alanmarcero/alan-m-OpenVSTManager/releases/download/v1.2.0/OpenVSTManager-1.2.0-win-x64.exe',
      size: payload.length,
    },
    checksumAsset: {
      name: 'SHA256SUMS.txt',
      url: 'https://github.com/alanmarcero/alan-m-OpenVSTManager/releases/download/v1.2.0/SHA256SUMS.txt',
    },
    tempDir: dir,
    fetchImpl: fetchMock,
  });

  const content = await readFile(downloadedPath);
  assert.deepEqual(content, payload);
  await rm(dir, { recursive: true, force: true });
});

test('downloadAppUpdate throws on checksum mismatch', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'updater-test-'));
  const payload = Buffer.from('corrupted-data');
  const shaContent = `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  OpenVSTManager-1.2.0-win-x64.exe\n`;

  const fetchMock = async (url) => {
    if (url.includes('SHA256SUMS.txt')) {
      return new Response(shaContent, { status: 200 });
    }
    return new Response(payload, { status: 200, headers: { 'content-length': String(payload.length) } });
  };

  await assert.rejects(async () => {
    await downloadAppUpdate({
      asset: {
        name: 'OpenVSTManager-1.2.0-win-x64.exe',
        url: 'https://github.com/download.exe',
        size: payload.length,
      },
      checksumAsset: {
        name: 'SHA256SUMS.txt',
        url: 'https://github.com/SHA256SUMS.txt',
      },
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
