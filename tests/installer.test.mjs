import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Installer, defaultPaths } from '../core/installer.mjs';

const plugin = { id: 'test-plugin', bundleNames: { VST3: 'Test.vst3', AU: 'Test.component' } };

function zip(entries) {
  const parts = [], records = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const filename = Buffer.from(name), body = Buffer.from(content), header = Buffer.alloc(30), record = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc32(body), 14);
    header.writeUInt32LE(body.length, 18); header.writeUInt32LE(body.length, 22); header.writeUInt16LE(filename.length, 26);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(0x0314, 4); record.writeUInt16LE(20, 6);
    record.writeUInt32LE(crc32(body), 16); record.writeUInt32LE(body.length, 20); record.writeUInt32LE(body.length, 24);
    record.writeUInt16LE(filename.length, 28); record.writeUInt32LE((0o100755 << 16) >>> 0, 38); record.writeUInt32LE(offset, 42);
    parts.push(header, filename, body); records.push(record, filename); offset += 30 + filename.length + body.length;
  }
  const directory = Buffer.concat(records), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

async function fixture(t, { platform = 'darwin' } = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'openvst-installer-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data'), paths = { VST3: path.join(root, 'vst3'), AU: path.join(root, 'au') };
  const installer = new Installer({ dataDir, paths, platform, home: root, plugins: [plugin] });
  const archivePath = path.join(root, 'plugins.zip');
  async function archive(version = 'v1', entries = null) {
    const bytes = zip(entries ?? [['package/VST3/Test.vst3/Contents/MacOS/Test', version], ['package/AU/Test.component/Contents/MacOS/Test', version]]);
    await writeFile(archivePath, bytes);
    return { archivePath, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
  }
  return { root, dataDir, paths, installer, archive };
}

test('provides per-user paths for supported operating systems', () => {
  assert.deepEqual(defaultPaths({ platform: 'darwin', home: '/home/test' }), { VST3: '/home/test/Library/Audio/Plug-Ins/VST3', AU: '/home/test/Library/Audio/Plug-Ins/Components' });
  assert.deepEqual(defaultPaths({ platform: 'linux', home: '/home/test' }), { VST3: '/home/test/.vst3' });
  assert.equal(defaultPaths({ platform: 'win32', home: 'C:\\Users\\Test', env: { LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local' } }).VST3, 'C:\\Users\\Test\\AppData\\Local\\Programs\\Common\\VST3');
});

test('installs selected formats, persists versions, replaces them and removes only managed bundles', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.installer.detect(plugin), []);
  const installed = await f.installer.install({ plugin, tag: 'v1', formats: ['VST3', 'AU'], ...await f.archive() });
  assert.equal(installed.length, 2);
  assert.ok(installed.every((item) => item.managed && item.version === 'v1'));
  const restarted = new Installer({ dataDir: f.dataDir, paths: f.paths, platform: 'darwin', home: f.root });
  assert.deepEqual(await restarted.detect(plugin), installed);
  await writeFile(path.join(f.paths.VST3, 'keep.txt'), 'unrelated');
  await restarted.install({ plugin, tag: 'v2', formats: ['VST3'], ...await f.archive('v2') });
  assert.equal(await readFile(path.join(f.paths.VST3, 'Test.vst3/Contents/MacOS/Test'), 'utf8'), 'v2');
  assert.equal((await restarted.detect(plugin)).find((entry) => entry.format === 'AU').version, 'v1');
  await restarted.uninstall({ plugin, formats: ['VST3'] });
  assert.equal(await readFile(path.join(f.paths.VST3, 'keep.txt'), 'utf8'), 'unrelated');
  assert.deepEqual((await restarted.detect(plugin)).map((entry) => entry.format), ['AU']);
});

test('installs root bundles and Windows VST3 files', async (t) => {
  const f = await fixture(t, { platform: 'win32' });
  await f.installer.install({ plugin, tag: 'v1', formats: ['VST3'], ...await f.archive('v1', [['Test.vst3', 'binary']]) });
  assert.equal(await readFile(path.join(f.paths.VST3, 'Test.vst3'), 'utf8'), 'binary');
});

test('rejects checksum mismatch before touching an installed plugin', async (t) => {
  const f = await fixture(t);
  await f.installer.install({ plugin, tag: 'v1', formats: ['VST3'], ...await f.archive() });
  await assert.rejects(f.installer.install({ plugin, tag: 'v2', formats: ['VST3'], ...await f.archive('v2'), digest: `sha256:${'0'.repeat(64)}` }), /checksum|digest/i);
  assert.equal(await readFile(path.join(f.paths.VST3, 'Test.vst3/Contents/MacOS/Test'), 'utf8'), 'v1');
});

test('detects existing external bundles with unknown version and refuses overwrite or removal', async (t) => {
  const f = await fixture(t);
  await mkdir(path.join(f.paths.VST3, 'Test.vst3'), { recursive: true });
  await writeFile(path.join(f.paths.VST3, 'Test.vst3', 'external'), 'keep');
  assert.deepEqual(await f.installer.detect(plugin), [{ format: 'VST3', version: null, path: path.join(f.paths.VST3, 'Test.vst3'), managed: false }]);
  await assert.rejects(f.installer.install({ plugin, tag: 'v1', formats: ['VST3'], ...await f.archive() }), /unmanaged|untracked|existing/i);
  await f.installer.uninstall({ plugin, formats: ['VST3'] });
  assert.equal(await readFile(path.join(f.paths.VST3, 'Test.vst3', 'external'), 'utf8'), 'keep');
});

test('keeps ownership of the original location after settings change', async (t) => {
  const f = await fixture(t);
  await f.installer.install({ plugin, tag: 'v1', formats: ['VST3'], ...await f.archive() });
  const moved = path.join(f.root, 'new-vst3');
  f.installer.setPaths({ VST3: moved });
  assert.equal((await f.installer.detect(plugin))[0].path, path.join(f.paths.VST3, 'Test.vst3'));
  await f.installer.install({ plugin, tag: 'v2', formats: ['VST3'], ...await f.archive('v2') });
  assert.equal((await f.installer.detect(plugin))[0].path, path.join(moved, 'Test.vst3'));
  await assert.rejects(stat(path.join(f.paths.VST3, 'Test.vst3')), { code: 'ENOENT' });
  await f.installer.uninstall({ plugin, formats: ['VST3'] });
  await assert.rejects(stat(path.join(moved, 'Test.vst3')), { code: 'ENOENT' });
});

test('does not trust arbitrary paths injected into a receipt', async (t) => {
  const f = await fixture(t);
  await f.installer.install({ plugin, tag: 'v1', formats: ['VST3'], ...await f.archive() });
  const victim = path.join(f.root, 'important');
  await mkdir(victim); await writeFile(path.join(victim, 'keep'), 'safe');
  const receiptPath = path.join(f.dataDir, 'receipts.json');
  const receipts = JSON.parse(await readFile(receiptPath, 'utf8'));
  receipts.installs['test-plugin:VST3'].path = victim;
  await writeFile(receiptPath, JSON.stringify(receipts));
  await assert.rejects(f.installer.uninstall({ plugin, formats: ['VST3'] }), /receipt|record|path/i);
  assert.equal(await readFile(path.join(victim, 'keep'), 'utf8'), 'safe');
});

test('does not remove a bundle replaced externally after installation', async (t) => {
  const f = await fixture(t);
  await f.installer.install({ plugin, tag: 'v1', formats: ['VST3'], ...await f.archive() });
  const bundle = path.join(f.paths.VST3, 'Test.vst3');
  await rename(bundle, path.join(f.root, 'old-bundle'));
  await mkdir(bundle); await writeFile(path.join(bundle, 'external'), 'safe');
  assert.equal((await f.installer.detect(plugin))[0].managed, false);
  await assert.rejects(f.installer.uninstall({ plugin, formats: ['VST3'] }), /changed|ownership|managed|external/i);
  assert.equal(await readFile(path.join(bundle, 'external'), 'utf8'), 'safe');
});

test('rolls replacement back when saving the receipt fails', async (t) => {
  const f = await fixture(t);
  await f.installer.install({ plugin, tag: 'v1', formats: ['VST3', 'AU'], ...await f.archive() });
  const receiptPath = path.join(f.dataDir, 'receipts.json');
  const originalRename = fs.rename;
  t.mock.method(fs, 'rename', async (source, destination) => {
    if (destination === receiptPath) {
      assert.equal(await readFile(path.join(f.paths.VST3, 'Test.vst3/Contents/MacOS/Test'), 'utf8'), 'v2');
      assert.equal(await readFile(path.join(f.paths.AU, 'Test.component/Contents/MacOS/Test'), 'utf8'), 'v2');
      throw new Error('Receipt write failed: simulated disk error');
    }
    return originalRename(source, destination);
  });
  await assert.rejects(f.installer.install({ plugin, tag: 'v2', formats: ['VST3', 'AU'], ...await f.archive('v2') }), /receipt/i);
  assert.equal(await readFile(path.join(f.paths.VST3, 'Test.vst3/Contents/MacOS/Test'), 'utf8'), 'v1');
  assert.equal(await readFile(path.join(f.paths.AU, 'Test.component/Contents/MacOS/Test'), 'utf8'), 'v1');
  assert.ok((await f.installer.detect(plugin)).every((item) => item.version === 'v1'));
  assert.deepEqual(await readdir(f.paths.VST3), ['Test.vst3']);
});

test('rejects an archive missing requested formats without partial installation', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.installer.install({ plugin, tag: 'v1', formats: ['VST3', 'AU'], ...await f.archive('v1', [['Test.vst3/Contents/MacOS/Test', 'v1']]) }), /AU|component|missing/i);
  assert.deepEqual(await f.installer.detect(plugin), []);
});

test('rejects duplicate allowlisted bundles in different archive folders', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.installer.install({ plugin, tag: 'v1', formats: ['VST3'], ...await f.archive('v1', [['one/Test.vst3/file', 'one'], ['two/Test.vst3/file', 'two']]) }), /multiple|ambiguous|duplicate/i);
});

test('detects bundles safely when receipts are corrupt and blocks mutations', async (t) => {
  const f = await fixture(t);
  await f.installer.install({ plugin, tag: 'v1', formats: ['VST3'], ...await f.archive() });
  await writeFile(path.join(f.dataDir, 'receipts.json'), '{broken');
  assert.equal((await f.installer.detect(plugin))[0].managed, false);
  await assert.rejects(f.installer.uninstall({ plugin, formats: ['VST3'] }), /receipt|records/i);
  await assert.rejects(f.installer.install({ plugin, tag: 'v2', formats: ['VST3'], ...await f.archive('v2') }), /receipt|records/i);
});

test('rejects AU on non-macOS platforms', async (t) => {
  const f = await fixture(t, { platform: 'linux' });
  await assert.rejects(f.installer.install({ plugin, tag: 'v1', formats: ['AU'], ...await f.archive() }), /AU|macOS|unsupported/i);
});

test('refuses a managed path redirected through a symlink', async (t) => {
  const f = await fixture(t);
  await f.installer.install({ plugin, tag: 'v1', formats: ['VST3'], ...await f.archive() });
  await rename(f.paths.VST3, path.join(f.root, 'original'));
  const outside = path.join(f.root, 'outside');
  await mkdir(path.join(outside, 'Test.vst3'), { recursive: true });
  await writeFile(path.join(outside, 'Test.vst3', 'keep'), 'safe');
  await symlink(outside, f.paths.VST3, 'dir');
  await assert.rejects(f.installer.uninstall({ plugin, formats: ['VST3'] }), /path|changed|symlink|ownership/i);
  assert.equal(await readFile(path.join(outside, 'Test.vst3', 'keep'), 'utf8'), 'safe');
});

test('restores removed bundles when persisting the removal fails', async (t) => {
  const f = await fixture(t);
  await f.installer.install({ plugin, tag: 'v1', formats: ['VST3', 'AU'], ...await f.archive() });
  const originalRename = fs.rename;
  t.mock.method(fs, 'rename', async (source, destination) => {
    if (destination === path.join(f.dataDir, 'receipts.json')) throw new Error('Receipt disk error');
    return originalRename(source, destination);
  });
  await assert.rejects(f.installer.uninstall({ plugin, formats: ['VST3', 'AU'] }), /receipt/i);
  assert.equal(await readFile(path.join(f.paths.VST3, 'Test.vst3/Contents/MacOS/Test'), 'utf8'), 'v1');
  assert.equal(await readFile(path.join(f.paths.AU, 'Test.component/Contents/MacOS/Test'), 'utf8'), 'v1');
  assert.ok((await f.installer.detect(plugin)).every((item) => item.managed && item.version === 'v1'));
});

test('reports a committed installation accurately when obsolete backup cleanup fails', async (t) => {
  const f = await fixture(t);
  await f.installer.install({ plugin, tag: 'v1', formats: ['VST3'], ...await f.archive() });
  const originalRm = fs.rm;
  const mock = t.mock.method(fs, 'rm', async (filename, options) => {
    if (path.basename(filename).startsWith('.openvstmanager-backup-')) throw new Error('Backup cleanup unavailable');
    return originalRm(filename, options);
  });
  const result = await f.installer.install({ plugin, tag: 'v2', formats: ['VST3'], ...await f.archive('v2') });
  assert.equal(result[0].version, 'v2');
  assert.equal(await readFile(path.join(f.paths.VST3, 'Test.vst3/Contents/MacOS/Test'), 'utf8'), 'v2');
  mock.mock.restore();
});

test('rejects a receipt pointed at a different allowlisted bundle without its ownership identity', async (t) => {
  const f = await fixture(t);
  await f.installer.install({ plugin, tag: 'v1', formats: ['VST3'], ...await f.archive() });
  const victimRoot = path.join(f.root, 'external');
  await mkdir(path.join(victimRoot, 'Test.vst3'), { recursive: true });
  await writeFile(path.join(victimRoot, 'Test.vst3', 'keep'), 'safe');
  const receiptPath = path.join(f.dataDir, 'receipts.json');
  const receipts = JSON.parse(await readFile(receiptPath, 'utf8'));
  Object.assign(receipts.installs['test-plugin:VST3'], { root: victimRoot, path: path.join(victimRoot, 'Test.vst3') });
  await writeFile(receiptPath, JSON.stringify(receipts));
  await assert.rejects(f.installer.uninstall({ plugin, formats: ['VST3'] }), /ownership|changed/i);
  assert.equal(await readFile(path.join(victimRoot, 'Test.vst3', 'keep'), 'utf8'), 'safe');
});

for (const operation of ['install', 'uninstall']) for (const committed of [false, true]) {
  test(`recovers a terminated ${operation} process ${committed ? 'after' : 'before'} receipt commit`, async (t) => {
    const f = await fixture(t);
    await f.installer.install({ plugin, tag: 'v1', formats: ['VST3'], ...await f.archive() });
    const archive = await f.archive('v2');
    const script = `
      import fs from 'node:fs/promises';
      import path from 'node:path';
      import { Installer } from ${JSON.stringify(new URL('../core/installer.mjs', import.meta.url).href)};
      const options = JSON.parse(process.argv[1]);
      const originalRename = fs.rename;
      fs.rename = async (source, destination) => {
        await originalRename(source, destination);
        const receipt = destination === path.join(options.dataDir, 'receipts.json');
        const bundle = options.operation === 'install'
          ? destination === path.join(options.paths.VST3, 'Test.vst3')
          : path.basename(path.dirname(destination)).startsWith('.openvstmanager-backup-');
        if (options.committed ? receipt : bundle) process.exit(73);
      };
      const installer = new Installer({ ...options, plugins: [options.plugin] });
      await installer[options.operation]({ plugin: options.plugin, formats: ['VST3'], tag: 'v2', ...options.archive });
      throw new Error('Expected to terminate at the transaction boundary');
    `;
    await assert.rejects(promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, JSON.stringify({ dataDir: f.dataDir, paths: f.paths, platform: 'darwin', home: f.root, plugin, operation, committed, archive })]), { code: 73 });
    const restarted = new Installer({ dataDir: f.dataDir, paths: f.paths, platform: 'darwin', plugins: [plugin] });
    const [first, concurrent] = await Promise.all([restarted.detect(plugin), restarted.detect(plugin)]);
    assert.deepEqual(first, concurrent);
    if (operation === 'uninstall' && committed) {
      assert.deepEqual(first, []);
    } else {
      assert.equal(first[0].managed, true);
      assert.equal(first[0].version, committed ? 'v2' : 'v1');
      assert.equal(await readFile(path.join(f.paths.VST3, 'Test.vst3/Contents/MacOS/Test'), 'utf8'), committed ? 'v2' : 'v1');
    }
    await assert.rejects(stat(path.join(f.dataDir, 'transaction.json')), { code: 'ENOENT' });
    assert.ok((await readdir(f.paths.VST3)).every((entry) => !entry.startsWith('.openvstmanager-')));
  });
}

test('can reinstall when an old managed plugin folder was removed externally', async (t) => {
  const f = await fixture(t);
  await f.installer.install({ plugin, tag: 'v1', formats: ['VST3'], ...await f.archive() });
  await rm(f.paths.VST3, { recursive: true });
  f.installer.setPaths({ VST3: path.join(f.root, 'replacement-folder') });
  const result = await f.installer.install({ plugin, tag: 'v2', formats: ['VST3'], ...await f.archive('v2') });
  assert.equal(result[0].version, 'v2');
  assert.equal(result[0].managed, true);
});

test('can remove stale ownership when the whole managed folder is missing', async (t) => {
  const f = await fixture(t);
  await f.installer.install({ plugin, tag: 'v1', formats: ['VST3'], ...await f.archive() });
  await rm(f.paths.VST3, { recursive: true });
  assert.deepEqual(await f.installer.uninstall({ plugin, formats: ['VST3'] }), []);
});

test('recovery refuses journal directories containing unrelated files', async (t) => {
  const f = await fixture(t);
  await f.installer.install({ plugin, tag: 'v1', formats: ['VST3'], ...await f.archive() });
  const record = JSON.parse(await readFile(path.join(f.dataDir, 'receipts.json'), 'utf8')).installs['test-plugin:VST3'];
  const directory = path.join(f.paths.VST3, '.openvstmanager-backup-ABC123');
  await mkdir(directory);
  await writeFile(path.join(directory, 'unrelated'), 'safe');
  const info = await stat(directory);
  await writeFile(path.join(f.dataDir, 'transaction.json'), JSON.stringify({ version: 1, id: '11111111-1111-1111-1111-111111111111',
    directories: [{ path: directory, root: f.paths.VST3, identity: { dev: info.dev, ino: info.ino } }],
    changes: [{ key: 'test-plugin:VST3', previous: record, next: null, prepared: null, backup: path.join(directory, 'Test.vst3') }],
  }));
  const restarted = new Installer({ dataDir: f.dataDir, paths: f.paths, platform: 'darwin', plugins: [plugin] });
  await assert.rejects(restarted.detect(plugin), /recovery|journal|unrelated/i);
  assert.equal(await readFile(path.join(directory, 'unrelated'), 'utf8'), 'safe');
  assert.equal(await readFile(path.join(f.paths.VST3, 'Test.vst3/Contents/MacOS/Test'), 'utf8'), 'v1');
});

test('removes plugins when backup directory file IDs exceed Number precision', async (t) => {
  const f = await fixture(t);
  await f.installer.install({ plugin, tag: 'v1', formats: ['VST3'], ...await f.archive() });
  const originalLstat = fs.lstat;
  t.mock.method(fs, 'lstat', async (filename, options) => {
    const info = await originalLstat(filename, options);
    if (path.basename(filename).startsWith('.openvstmanager-backup-')) {
      const ino = (1n << 60n) + BigInt(info.ino);
      info.ino = options?.bigint ? ino : Number(ino);
    }
    return info;
  });
  assert.deepEqual(await f.installer.uninstall({ plugin, formats: ['VST3'] }), []);
  await assert.rejects(stat(path.join(f.paths.VST3, 'Test.vst3')), { code: 'ENOENT' });
});

test('preserves exact large file identities and rejects adjacent identities rounded to the same Number', async (t) => {
  const f = await fixture(t);
  const originalLstat = fs.lstat;
  t.mock.method(fs, 'lstat', async (filename, options) => {
    const info = await originalLstat(filename, options);
    const ino = (1n << 60n) + (BigInt(info.ino) % (1n << 48n)) * 256n;
    info.ino = options?.bigint ? ino : Number(ino);
    return info;
  });
  await f.installer.install({ plugin, tag: 'v1', formats: ['VST3'], ...await f.archive() });
  const receiptPath = path.join(f.dataDir, 'receipts.json');
  const receipts = JSON.parse(await readFile(receiptPath, 'utf8'));
  const record = receipts.installs['test-plugin:VST3'];
  const actual = await originalLstat(record.path, { bigint: true });
  assert.equal(record.identity.ino, ((1n << 60n) + (actual.ino % (1n << 48n)) * 256n).toString());
  const adjacent = (BigInt(record.identity.ino) + 1n).toString();
  assert.equal(Number(adjacent), Number(record.identity.ino));
  record.identity.ino = adjacent;
  await writeFile(receiptPath, JSON.stringify(receipts));
  assert.equal((await f.installer.detect(plugin))[0].managed, false);
  await assert.rejects(f.installer.uninstall({ plugin, formats: ['VST3'] }), /ownership|changed/i);
  assert.equal(await readFile(path.join(f.paths.VST3, 'Test.vst3/Contents/MacOS/Test'), 'utf8'), 'v1');
});

test('still recognizes and removes installations recorded with safe numeric identities', async (t) => {
  const f = await fixture(t);
  const originalLstat = fs.lstat;
  t.mock.method(fs, 'lstat', async (filename, options) => {
    const info = await originalLstat(filename, options);
    for (const field of ['dev', 'ino']) {
      const value = BigInt(info[field]) % (1n << 48n);
      info[field] = options?.bigint ? value : Number(value);
    }
    return info;
  });
  await f.installer.install({ plugin, tag: 'v1', formats: ['VST3'], ...await f.archive() });
  const receiptPath = path.join(f.dataDir, 'receipts.json');
  const receipts = JSON.parse(await readFile(receiptPath, 'utf8'));
  const identity = receipts.installs['test-plugin:VST3'].identity;
  identity.dev = Number(identity.dev);
  identity.ino = Number(identity.ino);
  await writeFile(receiptPath, JSON.stringify(receipts));
  const restarted = new Installer({ dataDir: f.dataDir, paths: f.paths, platform: 'darwin', plugins: [plugin] });
  assert.equal((await restarted.detect(plugin))[0].managed, true);
  assert.deepEqual(await restarted.uninstall({ plugin, formats: ['VST3'] }), []);
});
