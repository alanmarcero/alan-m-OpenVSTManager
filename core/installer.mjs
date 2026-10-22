import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { extractArchive } from './archive.mjs';

const FORMATS = ['VST3', 'AU'];

export function standardPathOptions({ platform = process.platform, home = homedir(), env = process.env } = {}) {
  if (platform === 'win32') {
    return {
      VST3: [
        { label: 'User folder', path: path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData/Local'), 'Programs/Common/VST3') },
        { label: 'Program Files', path: 'C:\\Program Files\\Common Files\\VST3' },
      ],
    };
  }
  if (platform === 'darwin') {
    return {
      VST3: [
        { label: 'User folder (~/Library)', path: path.posix.join(home, 'Library/Audio/Plug-Ins/VST3') },
        { label: 'System folder (/Library)', path: '/Library/Audio/Plug-Ins/VST3' },
      ],
      AU: [
        { label: 'User folder (~/Library)', path: path.posix.join(home, 'Library/Audio/Plug-Ins/Components') },
        { label: 'System folder (/Library)', path: '/Library/Audio/Plug-Ins/Components' },
      ],
    };
  }
  return {
    VST3: [
      { label: 'User folder (~/.vst3)', path: path.posix.join(home, '.vst3') },
      { label: 'System folder (/usr/lib/vst3)', path: '/usr/lib/vst3' },
    ],
  };
}

export function defaultPaths({ platform = process.platform, home = homedir(), env = process.env } = {}) {
  if (platform === 'darwin') return { VST3: path.posix.join(home, 'Library/Audio/Plug-Ins/VST3'), AU: path.posix.join(home, 'Library/Audio/Plug-Ins/Components') };
  if (platform === 'win32') return { VST3: path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData/Local'), 'Programs/Common/VST3') };
  return { VST3: path.posix.join(home, '.vst3') };
}

async function exists(filename) {
  try { return await fs.lstat(filename, { bigint: true }); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function sameIdentity(info, identity) {
  return info && !info.isSymbolicLink() && String(info.dev) === String(identity.dev) && String(info.ino) === String(identity.ino);
}

function validIdentityPart(value) {
  return (Number.isSafeInteger(value) && value >= 0)
    || (typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 0xffffffffffffffffn);
}

// NTFS file IDs can exceed Number precision; JSON stores their exact decimal representation.
function identity(info) { return { dev: String(info.dev), ino: String(info.ino) }; }

function bundleNames(plugin, format) {
  const value = plugin.bundleNames?.[format];
  const names = value == null ? [] : Array.isArray(value) ? value : [value];
  const extension = format === 'VST3' ? '.vst3' : '.component';
  if (names.some((name) => typeof name !== 'string' || name.includes('/') || name.includes('\\') || name.includes(':') || !name.endsWith(extension) || name === extension || /[\x00-\x1f]/.test(name))) throw new Error(`Invalid catalog bundle name for ${format}`);
  return names;
}

function validatePlugin(plugin) {
  if (!plugin || typeof plugin.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,100}$/i.test(plugin.id)) throw new Error('Invalid plugin identity');
  for (const format of FORMATS) bundleNames(plugin, format);
}

function validateRecord(record, plugin, format) {
  if (!record || record.pluginId !== plugin.id || record.format !== format || !bundleNames(plugin, format).includes(record.bundleName)
    || typeof record.path !== 'string' || typeof record.root !== 'string' || !path.isAbsolute(record.path) || !path.isAbsolute(record.root)
    || path.normalize(record.path) !== record.path || path.normalize(record.root) !== record.root
    || record.path !== path.join(record.root, record.bundleName) || typeof record.version !== 'string'
    || !validIdentityPart(record.identity?.dev) || !validIdentityPart(record.identity?.ino)) {
    throw new Error(`Invalid installation receipt for ${plugin.id} ${format}; no files were removed`);
  }
}

async function ownsRecord(record) {
  const info = await exists(record.path);
  if (!info) return false;
  return sameIdentity(info, record.identity) && (info.isDirectory() || info.isFile())
    && await fs.realpath(record.root) === record.root;
}

async function verifyDigest(filename, digest) {
  if (digest == null || digest === '') return;
  if (!/^sha256:[a-f0-9]{64}$/i.test(digest)) throw new Error('Unsupported or invalid archive checksum; expected sha256');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  if (hash.digest('hex') !== digest.slice(7).toLowerCase()) throw new Error('Archive checksum mismatch; download the release again');
}

async function findBundles(root, names) {
  const found = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Unexpected symlink in extracted archive');
      if (names.includes(entry.name) && (entry.isDirectory() || entry.isFile())) found.push(filename);
      else if (entry.isDirectory() && !/\.(vst3|component)$/i.test(entry.name)) await visit(filename);
    }
  }
  await visit(root);
  return found;
}

export class Installer {
  #pending = Promise.resolve();
  #recovering = null;
  #plugins = new Map();
  constructor({ dataDir, paths = {}, platform = process.platform, home = homedir(), plugins = [] }) {
    if (!dataDir || !path.isAbsolute(dataDir)) throw new Error('Installer data directory must be absolute');
    this.dataDir = path.resolve(dataDir);
    this.platform = platform;
    this.paths = defaultPaths({ platform, home });
    this.setPaths(paths);
    for (const plugin of plugins) { validatePlugin(plugin); this.#plugins.set(plugin.id, plugin); }
  }

  setPaths(paths) {
    if (!paths || typeof paths !== 'object' || Array.isArray(paths)) throw new Error('Invalid plugin paths');
    const updated = { ...this.paths };
    for (const [format, directory] of Object.entries(paths)) {
      if (!FORMATS.includes(format) || typeof directory !== 'string' || !path.isAbsolute(directory) || directory.includes('\0')) throw new Error(`Invalid installation path for ${format}`);
      updated[format] = path.resolve(directory);
    }
    this.paths = updated;
  }

  #formats(plugin, formats) {
    validatePlugin(plugin);
    if (!Array.isArray(formats) || !formats.length || new Set(formats).size !== formats.length) throw new Error('Select at least one plugin format');
    for (const format of formats) {
      if (!FORMATS.includes(format) || !bundleNames(plugin, format).length || (format === 'AU' && this.platform !== 'darwin')) throw new Error(`Unsupported plugin format ${format}; AU requires macOS`);
    }
    return formats;
  }

  async #loadReceipts() {
    try {
      const raw = await fs.readFile(path.join(this.dataDir, 'receipts.json'), 'utf8');
      const receipts = JSON.parse(raw);
      if (receipts.version !== 1 || !receipts.installs || typeof receipts.installs !== 'object' || Array.isArray(receipts.installs)) throw new Error('Invalid receipt structure');
      return receipts;
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, installs: {} };
      throw new Error(`Installation receipts could not be read. Restore receipts.json before changing installed plugins: ${error.message}`, { cause: error });
    }
  }

  async #writeState(name, value) {
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.dataDir, `.${name}-${randomUUID()}.tmp`);
    try {
      const file = await fs.open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(value, null, 2)); await file.sync(); } finally { await file.close(); }
      await fs.rename(temporary, path.join(this.dataDir, name));
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }

  async #ensureRecovery(plugin) {
    validatePlugin(plugin);
    this.#plugins.set(plugin.id, plugin);
    if (!this.#recovering) {
      this.#recovering = (async () => {
        let journal;
        try {
          const filename = path.join(this.dataDir, 'transaction.json');
          const info = await fs.lstat(filename);
          if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024) throw new Error('Invalid transaction journal file');
          journal = JSON.parse(await fs.readFile(filename, 'utf8'));
        } catch (error) { if (error.code === 'ENOENT') return; throw new Error(`Installation recovery journal could not be read: ${error.message}`, { cause: error }); }
        await this.#recoverJournal(journal);
      })().finally(() => { this.#recovering = null; });
    }
    return this.#recovering;
  }

  async #validateJournal(journal) {
    if (!journal || journal.version !== 1 || !/^[a-f0-9-]{36}$/.test(journal.id)
      || !Array.isArray(journal.changes) || !journal.changes.length || journal.changes.length > 2
      || !Array.isArray(journal.directories) || journal.directories.length > 4) throw new Error('Invalid installation recovery journal');
    const roots = new Set(), keys = new Set();
    for (const change of journal.changes) {
      const record = change.next || change.previous;
      const plugin = this.#plugins.get(record?.pluginId);
      if (!plugin) throw new Error('Interrupted installation is not in the trusted plugin catalog; recovery was stopped');
      if (!FORMATS.includes(record.format) || keys.has(change.key) || change.key !== `${plugin.id}:${record.format}`) throw new Error('Invalid journal plugin identity');
      keys.add(change.key);
      for (const item of [change.next, change.previous].filter(Boolean)) {
        validateRecord(item, plugin, record.format);
        const realRoot = await fs.realpath(item.root).catch((error) => {
          if (error.code === 'ENOENT' && item === change.previous && !change.backup) return null;
          throw error;
        });
        if (realRoot !== null && realRoot !== item.root) throw new Error('Installation recovery path changed or contains a symlink');
        if (realRoot) roots.add(item.root);
      }
    }
    const directories = new Map();
    for (const directory of journal.directories) {
      if (!directory || typeof directory.path !== 'string' || !roots.has(directory.root)
        || path.dirname(directory.path) !== directory.root || !/^\.openvstmanager-(?:backup-)?[a-z0-9]{6}$/i.test(path.basename(directory.path))
        || !validIdentityPart(directory.identity?.dev) || !validIdentityPart(directory.identity?.ino)
        || directories.has(directory.path)) throw new Error('Invalid journal staging directory');
      const info = await exists(directory.path);
      if (info && (!info.isDirectory() || !sameIdentity(info, directory.identity))) throw new Error('Installation recovery staging directory changed');
      directories.set(directory.path, directory);
    }
    const referenced = new Set();
    for (const change of journal.changes) {
      for (const [field, record] of [['prepared', change.next], ['backup', change.previous]]) {
        const filename = change[field];
        if (filename == null) { if (field === 'prepared' && record) throw new Error('Missing journal preparation path'); continue; }
        const directory = typeof filename === 'string' && directories.get(path.dirname(filename));
        if (!record || !directory || referenced.has(directory.path) || directory.root !== record.root || path.basename(filename) !== record.bundleName) throw new Error('Invalid journal bundle path');
        referenced.add(directory.path);
        const contents = await fs.readdir(directory.path).catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
        if (contents.some((name) => name !== record.bundleName)) throw new Error('Installation recovery directory contains unrelated files');
        const info = await exists(filename);
        if (info && !sameIdentity(info, record.identity)) throw new Error('Installation recovery bundle ownership changed');
      }
    }
    if (referenced.size !== directories.size) throw new Error('Journal contains unrelated directories');
  }

  async #recoverJournal(journal) {
    await this.#validateJournal(journal);
    const receipts = await this.#loadReceipts();
    const committed = receipts.transactionId === journal.id;
    if (!committed) {
      // Validate the entire rollback before removing anything; repeat safely after another interruption.
      for (const change of journal.changes) {
        if (change.next) {
          const current = await exists(change.next.path);
          if (current && !sameIdentity(current, change.next.identity)
            && !(change.previous?.path === change.next.path && sameIdentity(current, change.previous.identity))) throw new Error('Recovery stopped: an external plugin occupies the installation path');
        }
        if (change.backup) {
          const backup = await exists(change.backup), previous = await exists(change.previous.path);
          const originalPresent = sameIdentity(previous, change.previous.identity);
          const replacementPresent = change.next?.path === change.previous.path && sameIdentity(previous, change.next.identity);
          if ((!backup && !originalPresent) || (backup && originalPresent) || (previous && !originalPresent && !replacementPresent)) throw new Error('Recovery stopped: the previous installation or its backup changed');
        }
      }
      for (const change of [...journal.changes].reverse()) {
        if (change.next && sameIdentity(await exists(change.next.path), change.next.identity)) await fs.rm(change.next.path, { recursive: true });
        if (change.backup && await exists(change.backup)) {
          if (await exists(change.previous.path)) throw new Error('Recovery stopped: restore destination is occupied');
          await fs.rename(change.backup, change.previous.path);
        }
      }
    }
    // A receipt commit is final. Obsolete backup cleanup must never roll back a newer version.
    await Promise.allSettled(journal.directories.map((directory) => fs.rm(directory.path, { recursive: true, force: true })));
    await fs.rm(path.join(this.dataDir, 'transaction.json'), { force: true });
    return committed;
  }

  async #detect(plugin) {
    validatePlugin(plugin);
    const receipts = await this.#loadReceipts().catch(() => ({ installs: {} }));
    const installed = [];
    for (const format of FORMATS) {
      if (format === 'AU' && this.platform !== 'darwin') continue;
      const record = receipts.installs[`${plugin.id}:${format}`];
      const seen = new Set();
      if (record) {
        try {
          validateRecord(record, plugin, format);
          if (await exists(record.path)) {
            const managed = await ownsRecord(record);
            installed.push({ format, version: managed ? record.version : null, path: record.path, managed });
            seen.add(record.path);
          }
        } catch { /* Invalid records never grant ownership. */ }
      }
      if (this.paths[format]) {
        const root = await fs.realpath(this.paths[format]).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
        if (root) for (const name of bundleNames(plugin, format)) {
          const filename = path.join(root, name);
          if (!seen.has(filename) && await exists(filename)) installed.push({ format, version: null, path: filename, managed: false });
        }
      }
    }
    return installed;
  }

  async detect(plugin) { await this.#pending; await this.#ensureRecovery(plugin); return this.#detect(plugin); }

  #serialize(operation) {
    const result = this.#pending.then(operation);
    this.#pending = result.catch(() => {});
    return result;
  }

  install({ plugin, tag, archivePath, formats, digest }) {
    return this.#serialize(async () => {
      this.#formats(plugin, formats);
      await this.#ensureRecovery(plugin);
      if (typeof tag !== 'string' || !tag.trim() || tag.length > 200) throw new Error('Invalid plugin version');
      const receipts = await this.#loadReceipts();
      await verifyDigest(archivePath, digest);
      await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
      const stage = await fs.mkdtemp(path.join(this.dataDir, '.extract-'));
      try {
        await extractArchive(archivePath, stage);
        const changes = [];
        for (const format of formats) {
          const candidates = await findBundles(stage, bundleNames(plugin, format));
          if (candidates.length !== 1) throw new Error(candidates.length ? `Multiple matching ${format} bundles in the archive` : `Archive is missing the expected ${format} bundle`);
          const source = candidates[0], bundleName = path.basename(source);
          await fs.mkdir(this.paths[format], { recursive: true });
          const root = await fs.realpath(this.paths[format]);
          const target = path.join(root, bundleName), key = `${plugin.id}:${format}`;
          const previous = receipts.installs[key];
          if (previous) {
            validateRecord(previous, plugin, format);
            if (await exists(previous.path) && !await ownsRecord(previous)) throw new Error(`Installation ownership changed externally: ${previous.path}`);
          }
          if (await exists(target) && (!previous || previous.path !== target || !await ownsRecord(previous))) throw new Error(`An unmanaged plugin already exists at ${target}. Move it before installing with OpenVST Manager.`);
          changes.push({ key, format, source, target, root, bundleName, previous });
        }
        await this.#transaction(receipts, changes, tag);
      } finally { await fs.rm(stage, { recursive: true, force: true }).catch(() => {}); }
      return this.#detect(plugin);
    });
  }

  uninstall({ plugin, formats }) {
    return this.#serialize(async () => {
      this.#formats(plugin, formats);
      await this.#ensureRecovery(plugin);
      const receipts = await this.#loadReceipts(), changes = [];
      for (const format of formats) {
        const key = `${plugin.id}:${format}`, previous = receipts.installs[key];
        if (!previous) continue;
        validateRecord(previous, plugin, format);
        if (await exists(previous.path) && !await ownsRecord(previous)) throw new Error(`Installation ownership or path changed externally: ${previous.path}`);
        changes.push({ key, previous });
      }
      if (changes.length) await this.#transaction(receipts, changes);
      return this.#detect(plugin);
    });
  }

  async #transaction(receipts, changes, version) {
    const journal = { version: 1, id: randomUUID(), directories: [], changes: [] };
    let journalWritten = false;
    const directory = async (root, prefix) => {
      const filename = await fs.mkdtemp(path.join(root, prefix));
      journal.directories.push({ path: filename, root, identity: identity(await fs.lstat(filename, { bigint: true })) });
      return filename;
    };
    try {
      const next = { version: 1, transactionId: journal.id, installs: { ...receipts.installs } };
      for (const change of changes) {
        const entry = { key: change.key, previous: change.previous || null, next: null, prepared: null, backup: null };
        if (change.source) {
          entry.prepared = path.join(await directory(change.root, '.openvstmanager-'), change.bundleName);
          await fs.cp(change.source, entry.prepared, { recursive: true, force: false, errorOnExist: true });
          entry.next = { pluginId: change.key.slice(0, change.key.lastIndexOf(':')), format: change.format, bundleName: change.bundleName, path: change.target, root: change.root, version, identity: identity(await fs.lstat(entry.prepared, { bigint: true })) };
          next.installs[change.key] = entry.next;
        } else delete next.installs[change.key];
        if (change.previous && await exists(change.previous.path)) {
          if (!await ownsRecord(change.previous)) throw new Error(`Installation ownership changed: ${change.previous.path}`);
          entry.backup = path.join(await directory(change.previous.root, '.openvstmanager-backup-'), change.previous.bundleName);
        }
        journal.changes.push(entry);
      }
      // No installed files move until the complete recovery plan is durably written.
      await this.#validateJournal(journal);
      await this.#writeState('transaction.json', journal);
      journalWritten = true;
      for (const change of journal.changes) {
        if (change.backup) {
          if (!await ownsRecord(change.previous)) throw new Error('Installation ownership changed before replacement');
          await fs.rename(change.previous.path, change.backup);
        }
        if (change.prepared) {
          if (await exists(change.next.path)) throw new Error(`An unmanaged plugin appeared at ${change.next.path}`);
          await fs.rename(change.prepared, change.next.path);
        }
      }
      await this.#writeState('receipts.json', next);
      await this.#recoverJournal(journal);
    } catch (error) {
      if (journalWritten) {
        try {
          if (await this.#recoverJournal(journal)) return;
        } catch (failure) {
          throw new AggregateError([error, failure], `Installation interrupted; automatic recovery could not finish. Preserve ${path.join(this.dataDir, 'transaction.json')} and the .openvstmanager backup folders. ${failure.message}`);
        }
      } else {
        await Promise.allSettled(journal.directories.map((item) => fs.rm(item.path, { recursive: true, force: true })));
      }
      throw error;
    }
  }
}
