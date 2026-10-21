import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { extractArchive } from '../core/archive.mjs';

function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const { name, content = '', mode = 0o100644 } of entries) {
    const filename = Buffer.from(name), body = Buffer.from(content);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(body), 14); header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(body.length, 22); header.writeUInt16LE(filename.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(0x0314, 4); record.writeUInt16LE(20, 6);
    record.writeUInt32LE(crc32(body), 16); record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(body.length, 24); record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE((mode << 16) >>> 0, 38); record.writeUInt32LE(offset, 42);
    local.push(header, filename, body); central.push(record, filename);
    offset += header.length + filename.length + body.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

async function fixture(t, entries) {
  const root = await mkdtemp(path.join(tmpdir(), 'openvst-archive-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archive = path.join(root, 'fixture.zip'), destination = path.join(root, 'stage');
  await writeFile(archive, zip(entries));
  return { root, archive, destination };
}

test('extracts nested bundles and preserves executable permissions', async (t) => {
  const f = await fixture(t, [{ name: 'package/VST3/Test.vst3/Contents/MacOS/Test', content: 'binary', mode: 0o100755 }]);
  await extractArchive(f.archive, f.destination);
  const binary = path.join(f.destination, 'package/VST3/Test.vst3/Contents/MacOS/Test');
  assert.equal(await readFile(binary, 'utf8'), 'binary');
  if (process.platform !== 'win32') assert.equal((await stat(binary)).mode & 0o777, 0o755);
});

for (const name of ['../escape', '/absolute', 'C:/escape', 'dir\\escape', 'dir/../escape', 'dir/./escape', 'file:stream']) {
  test(`rejects unsafe archive path ${JSON.stringify(name)}`, async (t) => {
    const f = await fixture(t, [{ name, content: 'unsafe' }]);
    await assert.rejects(extractArchive(f.archive, f.destination), /path|filename|absolute|traversal|backslash/i);
    await assert.rejects(stat(path.join(f.root, 'escape')), { code: 'ENOENT' });
  });
}

for (const mode of [0o120777, 0o010644, 0o020644, 0o060644, 0o140644]) {
  test(`rejects symlinks and special files with mode ${mode.toString(8)}`, async (t) => {
    const f = await fixture(t, [{ name: 'link', content: '../outside', mode }]);
    await assert.rejects(extractArchive(f.archive, f.destination), /symlink|special|file type/i);
  });
}

test('refuses to extract through a preexisting directory symlink', async (t) => {
  const f = await fixture(t, [{ name: 'link/escape', content: 'unsafe' }]);
  await mkdir(f.destination);
  await mkdir(path.join(f.root, 'outside'));
  await symlink(path.join(f.root, 'outside'), path.join(f.destination, 'link'), 'dir');
  await assert.rejects(extractArchive(f.archive, f.destination), /symlink|unsafe|empty/i);
  await assert.rejects(stat(path.join(f.root, 'outside', 'escape')), { code: 'ENOENT' });
});

test('rejects duplicate names that collide on case-insensitive filesystems', async (t) => {
  const f = await fixture(t, [{ name: 'File', content: 'one' }, { name: 'file', content: 'two' }]);
  await assert.rejects(extractArchive(f.archive, f.destination), /duplicate|collision/i);
});

for (const [limits, entries] of [
  [{ maxEntries: 1 }, [{ name: 'one' }, { name: 'two' }]],
  [{ maxTotalBytes: 5 }, [{ name: 'one', content: '123' }, { name: 'two', content: '456' }]],
  [{ maxFileBytes: 2 }, [{ name: 'one', content: '123' }]],
]) {
  test(`enforces extraction limit ${Object.keys(limits)[0]}`, async (t) => {
    const f = await fixture(t, entries);
    await assert.rejects(extractArchive(f.archive, f.destination, { limits }), /limit|large|many/i);
  });
}

test('rejects damaged file data even when declared sizes still match', async (t) => {
  const f = await fixture(t, [{ name: 'binary', content: 'original' }]);
  const bytes = await readFile(f.archive);
  bytes[30 + Buffer.byteLength('binary')] ^= 1;
  await writeFile(f.archive, bytes);
  await assert.rejects(extractArchive(f.archive, f.destination), /checksum/i);
});

test('rejects case collisions in parent directories', async (t) => {
  const f = await fixture(t, [{ name: 'Bundle/one', content: 'one' }, { name: 'bundle/two', content: 'two' }]);
  await assert.rejects(extractArchive(f.archive, f.destination), /collision|duplicate/i);
});

test('rejects a symlink used as the extraction root', async (t) => {
  const f = await fixture(t, [{ name: 'escape', content: 'unsafe' }]);
  const outside = path.join(f.root, 'outside');
  await mkdir(outside);
  await symlink(outside, f.destination, 'dir');
  await assert.rejects(extractArchive(f.archive, f.destination), /symlink/i);
  await assert.rejects(stat(path.join(outside, 'escape')), { code: 'ENOENT' });
});
