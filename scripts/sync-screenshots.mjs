// Refreshes public/bundled-screenshots/<repo>.png from each catalog plugin's
// main branch screenshot so offline fallbacks stay current.
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitHubClient } from '../core/github.mjs';
import { validateCatalog } from '../core/releases.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = validateCatalog(JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8')));
const outDir = path.join(root, 'public', 'bundled-screenshots');
await mkdir(outDir, { recursive: true });

const cacheDir = await mkdtemp(path.join(tmpdir(), 'openvst-sync-shots-'));
const client = new GitHubClient({ cacheDir, token: process.env.GITHUB_TOKEN || null });
try {
  for (const plugin of catalog) {
    const shot = await client.screenshot(plugin.repo, plugin.screenshotPath, { force: true, includeData: true });
    if (shot.stale || !shot.data?.length) {
      throw new Error(`Failed to fetch ${plugin.repo}: ${shot.error || 'empty response'}`);
    }
    const target = path.join(outDir, `${plugin.id}.png`);
    await writeFile(target, shot.data);
    console.log(`synced ${plugin.id}.png (${shot.data.length} bytes)`);
  }
} finally {
  await rm(cacheDir, { recursive: true, force: true });
}
