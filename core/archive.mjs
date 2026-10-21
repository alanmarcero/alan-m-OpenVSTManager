import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32 } from 'node:zlib';
import yauzl from 'yauzl';

const DEFAULT_LIMITS = { maxEntries: 20_000, maxTotalBytes: 2 * 1024 ** 3, maxFileBytes: 1024 ** 3 };

function entryPath(name) {
  if (!name || /[\\\x00-\x1f:]/.test(name) || name.startsWith('/')) {
    throw new Error(`Unsafe archive path: ${JSON.stringify(name)}`);
  }
  const segments = name.replace(/\/$/, '').split('/');
  if (segments.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) {
    throw new Error(`Unsafe archive path: ${JSON.stringify(name)}`);
  }
  return segments;
}

async function safeDirectory(root, segments) {
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    await fs.mkdir(current, { mode: 0o755 }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
    const info = await fs.lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink() || await fs.realpath(current) !== current) {
      throw new Error(`Unsafe archive directory or symlink: ${current}`);
    }
  }
  return current;
}

/** Extract ZIPs without following links, overwriting files, or trusting declared sizes. */
export async function extractArchive(archivePath, destination, { limits = {} } = {}) {
  const bounds = { ...DEFAULT_LIMITS, ...limits };
  if (Object.values(bounds).some((value) => !Number.isSafeInteger(value) || value < 1)) throw new Error('Invalid archive limits');
  await fs.mkdir(destination, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(destination)).isSymbolicLink()) throw new Error('Unsafe extraction destination symlink');
  const root = await fs.realpath(destination);
  const zip = await new Promise((resolve, reject) => yauzl.open(archivePath, {
    lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true,
  }, (error, value) => error ? reject(error) : resolve(value)));
  let totalBytes = 0, entryCount = 0;
  const seen = new Map();
  try {
    if (zip.entryCount > bounds.maxEntries) throw new Error('Archive entry limit exceeded');
    await new Promise((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry) => {
        (async () => {
          if (++entryCount > bounds.maxEntries) throw new Error('Archive entry limit exceeded');
          const segments = entryPath(entry.fileName);
          const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
          const type = mode & 0o170000;
          const directory = entry.fileName.endsWith('/');
          if (type !== 0 && type !== 0o100000 && type !== 0o040000) throw new Error('Archive contains a symlink or special file type');
          if ((type === 0o040000 && !directory) || (type === 0o100000 && directory)) throw new Error('Archive file type does not match its path');
          if (entry.generalPurposeBitFlag & 1) throw new Error('Encrypted archives are unsupported');
          for (let index = 0; index < segments.length; index++) {
            const spelling = segments.slice(0, index + 1).join('/');
            const key = spelling.normalize('NFC').toLowerCase();
            const isDirectory = index < segments.length - 1 || directory;
            const previous = seen.get(key);
            if (previous && (previous.spelling !== spelling || previous.directory !== isDirectory || (!isDirectory && index === segments.length - 1))) {
              throw new Error(`Archive contains duplicate paths or a case collision: ${entry.fileName}`);
            }
            seen.set(key, { spelling, directory: isDirectory });
          }
          if (entry.uncompressedSize > bounds.maxFileBytes || totalBytes + entry.uncompressedSize > bounds.maxTotalBytes) throw new Error('Archive size limit exceeded');
          if (directory) {
            if (entry.uncompressedSize !== 0) throw new Error('Archive directory contains unexpected data');
            await safeDirectory(root, segments);
          } else {
            const parent = await safeDirectory(root, segments.slice(0, -1));
            const target = path.join(parent, segments.at(-1));
            const source = await new Promise((res, rej) => zip.openReadStream(entry, (error, stream) => error ? rej(error) : res(stream)));
            let fileBytes = 0, checksum = 0;
            const counter = new Transform({ transform(chunk, encoding, callback) {
              fileBytes += chunk.length; totalBytes += chunk.length;
              if (fileBytes > bounds.maxFileBytes || totalBytes > bounds.maxTotalBytes) return callback(new Error('Archive size limit exceeded during extraction'));
              checksum = crc32(chunk, checksum);
              callback(null, chunk);
            } });
            await pipeline(source, counter, createWriteStream(target, { flags: 'wx', mode: (mode & 0o111) ? 0o755 : 0o644 }));
            if (fileBytes !== entry.uncompressedSize || checksum !== entry.crc32) throw new Error('Archive file checksum or size mismatch');
          }
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  return root;
}
