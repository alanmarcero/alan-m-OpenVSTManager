import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateCatalog} from '../core/releases.mjs';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('every catalog plugin has a bundled PNG screenshot fallback', async () => {
  const catalog = validateCatalog(JSON.parse(await readFile(new URL('../catalog.json', import.meta.url), 'utf8')));
  assert.ok(catalog.length >= 13);
  for (const plugin of catalog) {
    const data = await readFile(new URL(`../public/bundled-screenshots/${plugin.repo}.png`, import.meta.url));
    assert.ok(data.subarray(0, 8).equals(PNG), `${plugin.id} is not a PNG`);
    assert.ok(data.length > 1000, `${plugin.id} screenshot is empty`);
  }
});
