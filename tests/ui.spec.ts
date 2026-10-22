import { test as base, expect, type Page } from '@playwright/test';
import catalog from '../catalog.json' with { type: 'json' };
import type { ManagerState, PluginFormat } from '../src/types';

interface RecordedOperation {
  kind: 'install' | 'uninstall';
  id: string;
  formats: PluginFormat[];
  tag?: string;
}

declare global {
  interface Window {
    __managerTest: { state: ManagerState; calls: RecordedOperation[]; failInstall: boolean };
  }
}

const initialState: ManagerState = {
  platform: 'darwin', arch: 'arm64', appVersion: '0.1.0',
  lastChecked: '2026-10-21T12:00:00Z', offline: false,
  settings: { includePrereleases: false, paths: { VST3: '/tmp/openvst-test/VST3', AU: '/tmp/openvst-test/Components' } },
  pathOptions: {
    VST3: [{ label: 'User folder', path: '/tmp/openvst-test/VST3' }, { label: 'System folder', path: '/Library/Audio/Plug-Ins/VST3' }],
    AU: [{ label: 'User folder', path: '/tmp/openvst-test/Components' }, { label: 'System folder', path: '/Library/Audio/Plug-Ins/Components' }],
  },
  plugins: catalog.map(plugin => ({
    ...plugin,
    url: `https://github.com/alanmarcero/${plugin.repo}`,
    formats: Object.keys(plugin.bundleNames) as PluginFormat[],
    installed: plugin.id === 'openEDMFilter'
      ? [{ format: 'VST3', version: 'v0.9.0', path: '/tmp/openvst-test/existing.vst3', managed: true }]
      : [],
    releases: [{
      tag: 'v1.0.0', name: 'v1.0.0', publishedAt: '2026-10-20T12:00:00Z', notes: '',
      url: `https://github.com/alanmarcero/${plugin.repo}/releases/tag/v1.0.0`,
      assets: [{ name: `${plugin.repo}-macOS.zip`, url: 'https://example.invalid/test.zip', size: 1024, compatible: true }],
    }],
  })),
};

// Only the preload boundary is replaced. Tests exercise the built production UI.
const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(state => {
      const fixture: Window['__managerTest'] = { state, calls: [], failInstall: false };
      window.__managerTest = fixture;
      const snapshot = () => structuredClone(fixture.state);
      window.manager = {
        getState: async () => snapshot(), refresh: async () => snapshot(),
        onProgress: () => () => {}, openExternal: async () => {},
        chooseDirectory: async () => '/tmp/openvst-test/chosen',
        saveSettings: async patch => {
          fixture.state.settings = { ...fixture.state.settings, ...patch, paths: { ...fixture.state.settings.paths, ...patch.paths } };
          return snapshot();
        },
        install: async request => {
          fixture.calls.push({ kind: 'install', ...request });
          if (fixture.failInstall) throw new Error('Download interrupted. Try again.');
          const plugin = fixture.state.plugins.find(item => item.id === request.id)!;
          plugin.installed = plugin.installed.filter(item => !request.formats.includes(item.format));
          plugin.installed.push(...request.formats.map(format => ({ format, version: request.tag, path: '/tmp/openvst-test/plugin', managed: true })));
          return snapshot();
        },
        uninstall: async request => {
          fixture.calls.push({ kind: 'uninstall', ...request });
          const plugin = fixture.state.plugins.find(item => item.id === request.id)!;
          plugin.installed = plugin.installed.filter(item => !request.formats.includes(item.format));
          return snapshot();
        },
      };
    }, initialState);
    await page.goto('/');
    await expect(page.locator('.plugin-row')).toHaveCount(catalog.length);
    await use(page);
  },
});

async function expectSeparatedControls(page: Page) {
  const layout = await page.evaluate(() => {
    const scope = document.querySelector('dialog[open]') ?? document;
    const controls = [...scope.querySelectorAll('button,input,select')].map(element => ({
      name: element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName,
      rect: element.getBoundingClientRect(), visible: getComputedStyle(element).visibility !== 'hidden',
    })).filter(control => control.visible && control.rect.width > 0 && control.rect.height > 0);
    const overlaps: string[] = [];
    for (let a = 0; a < controls.length; a++) {
      for (let b = a + 1; b < controls.length; b++) {
        const first = controls[a], second = controls[b];
        const width = Math.min(first.rect.right, second.rect.right) - Math.max(first.rect.left, second.rect.left);
        const height = Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top, second.rect.top);
        if (width > 1 && height > 1) overlaps.push(`${first.name} overlaps ${second.name}`);
      }
    }
    return { overlaps, horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
  });
  expect(layout).toEqual({ overlaps: [], horizontalOverflow: false });
}

for (const theme of ['Light', 'Dark', 'Cyberpunk']) {
  for (const viewport of [{ width: 1220, height: 820 }, { width: 860, height: 620 }]) {
    test(`${theme} persists and controls stay separate at ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.getByRole('button', { name: theme, exact: true }).click();
      await page.reload();
      await expect(page.getByRole('button', { name: theme, exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
      await expectSeparatedControls(page);

      await page.getByRole('button', { name: /openEDMFilter Filter/ }).click();
      await page.getByRole('button', { name: 'Update plugin', exact: true }).scrollIntoViewIfNeeded();
      await expectSeparatedControls(page);
      await page.getByRole('button', { name: 'Remove openEDMFilter', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectSeparatedControls(page);
      await page.getByRole('button', { name: 'Keep plugin', exact: true }).click();

      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(page.getByRole('button', { name: theme, exact: true })).toBeVisible();
      await expectSeparatedControls(page);
      await page.getByRole('switch', { name: 'Include prereleases' }).click();
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    });
  }
}

test('can select installation folder from options and save', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const select = page.getByRole('combobox', { name: 'VST3 location' });
  await expect(select).toBeVisible();
  await select.selectOption('/Library/Audio/Plug-Ins/VST3');
  await expect(page.locator('#path-VST3')).toHaveValue('/Library/Audio/Plug-Ins/VST3');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  const savedState = await page.evaluate(() => window.__managerTest.state);
  expect(savedState.settings.paths.VST3).toBe('/Library/Audio/Plug-Ins/VST3');
});

test('successful install and confirmed removal still complete with stale metadata', async ({ page }) => {
  await page.evaluate(() => {
    window.__managerTest.state.error = 'Using saved catalog metadata.';
    window.__managerTest.state.offline = true;
  });
  await page.getByRole('button', { name: 'Install plugin', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Installed', exact: true })).toBeDisabled();
  await expect(page.getByText('Using saved catalog metadata.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove openGlitchFX', exact: true }).click();
  await page.getByRole('button', { name: 'Keep plugin', exact: true }).click();
  expect(await page.evaluate(() => window.__managerTest.calls.filter(call => call.kind === 'uninstall'))).toEqual([]);
  await page.getByRole('button', { name: 'Remove openGlitchFX', exact: true }).click();
  await page.getByRole('button', { name: 'Remove plugin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Install plugin', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Remove openGlitchFX', exact: true })).toHaveCount(0);
});

test('a failed installation remains uninstalled and can be retried', async ({ page }) => {
  await page.evaluate(() => { window.__managerTest.failInstall = true; });
  await page.getByRole('button', { name: 'Install plugin', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Download interrupted. Try again.');
  await expect(page.getByRole('button', { name: 'Remove openGlitchFX', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Install plugin', exact: true })).toBeEnabled();
  await page.evaluate(() => { window.__managerTest.failInstall = false; });
  await page.getByRole('button', { name: 'Install plugin', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Installed', exact: true })).toBeDisabled();
});

test('update all promotes prereleases to stable without downgrading a newer format', async ({ page }) => {
  await page.evaluate(() => {
    const plugins = window.__managerTest.state.plugins;
    const glitch = plugins.find(plugin => plugin.id === 'openGlitchFX')!;
    glitch.installed = [{ format: 'VST3', version: 'v2.0.0-beta', path: '/tmp/glitch.vst3', managed: true }];
    glitch.releases[0].tag = 'v2.0.0';
    const filter = plugins.find(plugin => plugin.id === 'openEDMFilter')!;
    filter.installed = [
      { format: 'VST3', version: 'v1.0.0', path: '/tmp/filter.vst3', managed: true },
      { format: 'AU', version: 'v2.0.0-beta', path: '/tmp/filter.component', managed: true },
    ];
    filter.releases[0].tag = 'v1.1.0';
  });
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await page.getByRole('button', { name: 'Updates', exact: true }).click();
  await expect(page.locator('.plugin-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Update all', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'You’re up to date' })).toBeVisible();
  expect(await page.evaluate(() => window.__managerTest.calls)).toEqual([
    { kind: 'install', id: 'openGlitchFX', tag: 'v2.0.0', formats: ['VST3'] },
    { kind: 'install', id: 'openEDMFilter', tag: 'v1.1.0', formats: ['VST3'] },
  ]);
  expect(await page.evaluate(() => window.__managerTest.state.plugins.find(plugin => plugin.id === 'openEDMFilter')!.installed.find(item => item.format === 'AU')!.version)).toBe('v2.0.0-beta');
});

test('can uninstall all installed plugins with confirmation', async ({ page }) => {
  await page.getByRole('button', { name: 'Installed plugins', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Uninstall all', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Uninstall all', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('This removes all 1 installed plugin from your computer.')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Uninstall all', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your collection starts here' })).toBeVisible();
  expect(await page.evaluate(() => window.__managerTest.calls.filter(c => c.kind === 'uninstall'))).toEqual([
    { kind: 'uninstall', id: 'openEDMFilter', formats: ['VST3'], unmanaged: true },
  ]);
});
