import test from 'node:test';
import assert from 'node:assert/strict';
import today from './fixtures/today-release-notes.json' with { type: 'json' };
import { cleanReleaseNoteLines, hasReleaseNotesContent, releaseNoteTargets, summarizeReleaseNotes } from '../src/releaseNoteText.ts';

const expected = {
  openDucker: 'v2.7.1',
  openSausage: 'v1.10.1',
  openWallLimiter: 'v1.9.1',
  openBassSpace: 'v2.6.1',
  openSmacker: 'v2.7.0',
  openGlitchFX: 'v1.8.0',
  openTunerEQ: 'v1.8.0',
  openEDMKick: 'v3.9.0',
  openFruit: 'v1.9.0',
  openEDMFilter: 'v1.13.0',
  openEDMDelay: 'v1.7.0',
  openClapper: 'v3.11.0',
  openHatter: 'v4.7.0',
};

test('today’s plugin release notes stay readable and drop remote images', () => {
  assert.deepEqual(Object.keys(today).sort(), Object.keys(expected).sort());
  for (const [id, entry] of Object.entries(today)) {
    assert.equal(entry.tag, expected[id], id);
    assert.equal(hasReleaseNotesContent(entry.notes), true, id);
    const summary = summarizeReleaseNotes(entry.notes);
    assert.ok(summary.includes(entry.excerpt), `${id} summary missing ${entry.excerpt}`);
    assert.doesNotMatch(summary, /raw\.githubusercontent|Full Changelog|<img|<script/i, id);
    const rendered = cleanReleaseNoteLines(entry.notes).join('\n');
    assert.match(rendered, new RegExp(entry.excerpt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), id);
    assert.doesNotMatch(rendered, /!\[[^\]]*\]\([^)]*\)/);
  }
});

test('release note targets include the latest, installed, and selected versions once each', () => {
  const targets = releaseNoteTargets({
    releases: [
      { tag: 'v1.13.0', notes: 'latest text' },
      { tag: 'v1.12.0', notes: 'installed text' },
      { tag: 'v1.11.0', notes: 'older text' },
    ],
    installedVersions: ['v1.12.0', '1.12.0'],
    selectedTag: 'v1.11.0',
  });
  assert.deepEqual(targets.map(target => [target.role, target.tag]), [
    ['latest', 'v1.13.0'],
    ['installed', 'v1.12.0'],
    ['selected', 'v1.11.0'],
  ]);
  assert.deepEqual(releaseNoteTargets({
    releases: [{ tag: 'v2.7.1', notes: 'same' }],
    installedVersions: ['2.7.1'],
    selectedTag: 'v2.7.1',
  }).map(target => target.role), ['latest']);
  assert.deepEqual(releaseNoteTargets({
    releases: [{ tag: 'v1.0.0', notes: '' }],
    installedVersions: ['v0.9.0', null],
  }).map(target => target.tag), ['v1.0.0']);
});

test('missing notes and raw HTML are handled without being treated as markup', () => {
  assert.equal(hasReleaseNotesContent(''), false);
  assert.equal(hasReleaseNotesContent('![preview](https://example.com/a.png)\n\n**Full Changelog**: https://github.com/alanmarcero/openDucker/compare/v1...v2\n'), false);
  assert.equal(summarizeReleaseNotes(''), '');
  const hostile = 'Hello <script>alert(1)</script> <img src=x onerror=alert(1)>';
  assert.equal(cleanReleaseNoteLines(hostile).join('\n'), hostile);
  assert.equal(hasReleaseNotesContent(hostile), true);
});
