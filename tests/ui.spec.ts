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

const TEST_SCREENSHOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAD0lEQVR4nGNg+M/A8J+BAAYSAQM3K07jAAAAAElFTkSuQmCC';

const initialState: ManagerState = {
  platform: 'darwin', arch: 'arm64', appVersion: '0.1.0',
  lastChecked: '2026-10-21T12:00:00Z', offline: false,
  settings: {
    includePrereleases: false,
    autoCheckAppUpdates: true,
    paths: { VST3: '/tmp/openvst-test/VST3', AU: '/tmp/openvst-test/Components' },
    backupFolder: '/tmp/openvst-test/backups',
    preferredFormats: ['VST3', 'AU'],
    githubToken: '',
  },
  pathOptions: {
    VST3: [{ label: 'User folder', path: '/tmp/openvst-test/VST3' }, { label: 'System folder', path: '/Library/Audio/Plug-Ins/VST3' }],
    AU: [{ label: 'User folder', path: '/tmp/openvst-test/Components' }, { label: 'System folder', path: '/Library/Audio/Plug-Ins/Components' }],
  },
  plugins: catalog.map(plugin => ({
    ...plugin,
    url: `https://github.com/alanmarcero/${plugin.repo}`,
    screenshotUrl: TEST_SCREENSHOT,
    formats: Object.keys(plugin.bundleNames) as PluginFormat[],
    installed: plugin.id === 'openEDMFilter'
      ? [{ format: 'VST3', version: 'v0.9.0', path: '/tmp/openvst-test/existing.vst3', managed: true }]
      : [],
    releases: [{
      tag: 'v1.0.0', name: 'v1.0.0', publishedAt: '2026-10-20T12:00:00Z',
      notes: plugin.id === 'openEDMFilter'
        ? '# openEDMFilter 1.0.0\n\nAdds analog drive curves and LFO sync refinements.\n\n- Improved filter envelope tracking.\n\n![Preview](https://raw.githubusercontent.com/alanmarcero/openEDMFilter/v1.0.0/assets/native-ui.png)'
        : '',
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
      let logLines = ['2026-11-18T16:00:00Z openEDMFilter: complete'];
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async (text: string) => { (window as unknown as { __copied?: string }).__copied = text; } },
        configurable: true,
      });
      const snapshot = () => structuredClone(fixture.state);
      window.manager = {
        getState: async () => snapshot(), refresh: async () => snapshot(),
        onProgress: () => () => {}, openExternal: async () => {},
        openFolder: async () => {},
        openDataFolder: async () => {},
        getActivityLog: async () => [...logLines],
        clearActivityLog: async () => { logLines = []; return []; },
        clearCache: async () => snapshot(),
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
  await page.getByRole('button', { name: /openGlitchFX Creative/ }).click();
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
  await page.getByRole('button', { name: /openGlitchFX Creative/ }).click();
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

test('can install all uninstalled plugins with one button press', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Install all', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Install all', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Install all', exact: true })).toHaveCount(0);
  const installCalls = await page.evaluate(() => window.__managerTest.calls.filter(c => c.kind === 'install'));
  expect(installCalls.length).toBe(catalog.length - 1);
});

test('shows latest release notes when updates exist, renders auto-updating screenshots with lightbox, and gives every plugin a distinct icon', async ({ page }) => {
  const glyphMarkups = await page.locator('.plugin-row .plugin-glyph svg').evaluateAll(svgs => svgs.map(s => s.innerHTML));
  expect(glyphMarkups.length).toBe(catalog.length);
  expect(new Set(glyphMarkups).size).toBe(catalog.length);

  await page.getByRole('button', { name: /openEDMFilter Filter/ }).click();
  const notesPanel = page.getByRole('region', { name: 'Release notes for version 1.0.0' });
  await expect(notesPanel).toBeVisible();
  await expect(notesPanel).toContainText('Adds analog drive curves and LFO sync refinements.');
  await expect(notesPanel).toContainText('Improved filter envelope tracking.');

  const shotButton = page.getByRole('button', { name: 'Enlarge openEDMFilter screenshot' });
  await expect(shotButton).toBeVisible();
  await expect(shotButton.locator('img')).toHaveAttribute('src', TEST_SCREENSHOT);
  await shotButton.click();
  const modal = page.getByRole('dialog', { name: 'openEDMFilter' });
  await expect(modal).toBeVisible();
  await expectSeparatedControls(page);
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(modal).toHaveCount(0);

  await page.getByRole('button', { name: 'Updates', exact: true }).click();
  await expect(page.locator('.plugin-row .plugin-version')).toContainText('0.9.0 → 1.0.0');
  await expect(page.locator('.plugin-row .plugin-update-summary')).toContainText('Adds analog drive curves and LFO sync refinements.');
  const toggle = page.getByRole('button', { name: 'Show full notes' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('region', { name: /Full release notes for openEDMFilter/ })).toHaveCount(0);
  await toggle.click();
  const fullNotes = page.getByRole('region', { name: /Full release notes for openEDMFilter/ });
  await expect(fullNotes).toContainText('Improved filter envelope tracking.');
  await expectSeparatedControls(page);
  await page.getByRole('button', { name: 'Collapse all notes', exact: true }).click();
  await expect(fullNotes).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand all notes', exact: true }).click();
  await expect(fullNotes).toContainText('Improved filter envelope tracking.');
  await page.getByRole('button', { name: 'Hide full notes' }).click();
  await expect(fullNotes).toHaveCount(0);
  await expectSeparatedControls(page);

  await page.getByRole('button', { name: 'Installed plugins', exact: true }).click();
  await expect(page.locator('.plugin-row .plugin-update-summary')).toContainText('Adds analog drive curves and LFO sync refinements.');
  await page.getByRole('button', { name: 'Expand all notes', exact: true }).click();
  const installedNotes = page.getByRole('region', { name: /Full release notes for openEDMFilter/ });
  await expect(installedNotes).toContainText('Improved filter envelope tracking.');
  await expectSeparatedControls(page);
  await page.getByRole('button', { name: 'Collapse all notes', exact: true }).click();
  await expect(installedNotes).toHaveCount(0);
});

test('supports sorting, alias search, keyboard focus, detail release notes, formatted update modal, and path validation', async ({ page }) => {
  const sortSelect = page.getByRole('combobox', { name: 'Sort' });
  await sortSelect.selectOption('name');
  const names = await page.locator('.plugin-row .plugin-name').allTextContents();
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));

  await page.keyboard.press('/');
  const search = page.getByRole('textbox', { name: 'Search plugins' });
  await expect(search).toBeFocused();
  await search.fill('openMaster');
  await expect(page.locator('.plugin-row')).toHaveCount(1);
  await expect(page.locator('.plugin-row .plugin-name')).toHaveText('openBassSpace');
  await search.press('Escape');
  await expect(search).toHaveValue('');

  await page.evaluate(() => {
    const bass = window.__managerTest.state.plugins.find(p => p.id === 'openBassSpace')!;
    bass.releases[0].notes = '### Changes\n\n---\n\n1. Added *stereo* width mode. See [guide](https://example.com).\n2. Tightened low-end mono.';
    window.__managerTest.state.error = 'GitHub rate limit reached. Try again later.';
    window.__managerTest.state.offline = false;
    window.__managerTest.state.appUpdate = {
      available: true,
      currentVersion: '1.3.1',
      latestVersion: '1.4.0',
      notes: '## Highlights\n\n- **Faster** refresh with [details](https://example.com).',
      url: 'https://github.com/alanmarcero/alan-m-OpenVSTManager/releases/tag/v1.4.0',
    };
  });
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'GitHub rate limit reached.' })).toBeVisible();
  await expect(page.locator('.last-checked')).not.toContainText('Offline');
  await expect(page.getByRole('combobox', { name: 'Category' })).toContainText(/Mastering \(\d+\)/);

  await page.getByRole('button', { name: /openEDMFilter Filter/ }).click();
  await page.getByRole('button', { name: 'Copy openEDMFilter VST3 path' }).click();
  await expect(page.getByText('Copied path to clipboard.')).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __copied?: string }).__copied)).toBe('/tmp/openvst-test/existing.vst3');
  await expectSeparatedControls(page);

  await page.getByRole('button', { name: /openBassSpace Mastering/ }).click();
  await expect(page.locator('.version-label')).toContainText('1 KB');
  const detailToggle = page.getByRole('button', { name: 'Release notes for v1.0.0' });
  await detailToggle.click();
  const detailNotes = page.getByRole('region', { name: 'Release notes for version 1.0.0' });
  await expect(detailNotes.locator('ol li')).toHaveCount(2);
  await expect(detailNotes).toContainText('Added stereo width mode. See guide.');
  await expect(detailNotes).not.toContainText('---');
  await expect(detailNotes).not.toContainText('https://example.com');

  await page.getByRole('button', { name: 'Update to v1.4.0' }).click();
  const updateDialog = page.getByRole('dialog', { name: 'Update OpenVST Manager' });
  await expect(updateDialog).toBeVisible();
  await expect(updateDialog).toContainText('Faster refresh with details.');
  await expect(updateDialog).not.toContainText('https://example.com');
  await expectSeparatedControls(page);
  await page.keyboard.press('Escape');
  await expect(updateDialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#path-VST3').fill('relative/path');
  await expect(page.getByText('Enter an absolute folder path.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.locator('#path-VST3')).toHaveValue('/tmp/openvst-test/VST3');
  await page.getByRole('button', { name: 'Show recent activity' }).click();
  await expect(page.getByText(/openEDMFilter: complete/)).toBeVisible();
  await expectSeparatedControls(page);
  await page.getByRole('button', { name: 'Clear log' }).click();
  await expect(page.getByText('No activity recorded yet.')).toBeVisible();
  await expectSeparatedControls(page);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  await page.keyboard.press('Control+,');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.evaluate(() => {
    const bass = window.__managerTest.state.plugins.find(p => p.id === 'openBassSpace')!;
    bass.error = 'GitHub rate limit reached. Try again later.';
    const filter = window.__managerTest.state.plugins.find(p => p.id === 'openEDMFilter')!;
    filter.installed = [{ format: 'VST3', version: 'v1.0.0', path: '/tmp/openvst-test/existing.vst3', managed: true }];
  });
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(page.getByRole('button', { name: /openBassSpace Mastering/ })).not.toContainText('Release unavailable');

  const searchBox = page.getByRole('textbox', { name: 'Search plugins' });
  await searchBox.fill('openMaster');
  await expect(page.locator('.result-count')).toHaveText(`1 of ${catalog.length} plugins`);
  await searchBox.press('Escape');

  await page.getByRole('button', { name: 'Installed plugins', exact: true }).click();
  await expect(page.locator('.plugin-row .plugin-update-summary')).toContainText('Adds analog drive curves and LFO sync refinements.');
  await page.getByRole('button', { name: 'Show full notes' }).click();
  await expect(page.getByRole('region', { name: /Full release notes for openEDMFilter 1\.0\.0/ })).toContainText('Improved filter envelope tracking.');
});
