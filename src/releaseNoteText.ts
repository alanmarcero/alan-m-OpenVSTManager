import semver from 'semver';

const stripInlineMarkdown = (text: string) =>
  text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();

export function cleanReleaseNoteLines(notes: string): string[] {
  const withoutComments = (notes || '').replace(/<!--[\s\S]*?-->/g, '');
  const lines = withoutComments
    .split(/\r?\n/)
    .map(line =>
      line
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/^\s*>\s?/, '')
        .replace(/\s+in\s+https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)\b/gi, ' (#$1)')
        .trimEnd()
    )
    .filter(line => !/^\s*\*\*Full Changelog\*\*:\s*https?:\/\//i.test(line));

  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines.length && /^#\s+\S/.test(lines[0])) {
    lines.shift();
    while (lines.length && !lines[0].trim()) lines.shift();
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines;
}

export function summarizeReleaseNotes(notes: string): string {
  const lines = cleanReleaseNoteLines(notes);
  const parts: string[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || /^#{1,6}\s+/.test(trimmed) || /^([-*_])\1{2,}$/.test(trimmed)) continue;
    const text = stripInlineMarkdown(trimmed.replace(/^(?:[-*]|\d+\.)\s+/, ''));
    if (text) parts.push(text);
    if (parts.join(' ').length >= 160) break;
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function hasReleaseNotesContent(notes: string): boolean {
  return cleanReleaseNoteLines(notes).length > 0;
}

export function canonicalVersion(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return semver.valid(trimmed) || trimmed.replace(/^v(?=\d)/i, '');
}

export interface ReleaseNoteTarget {
  role: 'latest' | 'installed' | 'selected';
  tag: string;
  notes: string;
}

export function releaseNoteTargets({
  releases = [],
  installedVersions = [],
  selectedTag,
}: {
  releases?: { tag?: string; notes?: string }[];
  installedVersions?: Array<string | null | undefined>;
  selectedTag?: string;
} = {}): ReleaseNoteTarget[] {
  const list = Array.isArray(releases) ? releases : [];
  const seen = new Set<string>();
  const targets: ReleaseNoteTarget[] = [];
  const find = (tag: string | null | undefined) => {
    const key = canonicalVersion(tag);
    if (!key) return undefined;
    return list.find(release => canonicalVersion(release?.tag) === key);
  };
  const push = (role: ReleaseNoteTarget['role'], release: { tag?: string; notes?: string } | undefined) => {
    if (!release || typeof release.tag !== 'string' || !release.tag) return;
    const key = canonicalVersion(release.tag);
    if (!key || seen.has(key)) return;
    seen.add(key);
    targets.push({ role, tag: release.tag, notes: typeof release.notes === 'string' ? release.notes : '' });
  };
  if (list[0]) push('latest', list[0]);
  for (const version of installedVersions) push('installed', find(version));
  if (selectedTag) push('selected', find(selectedTag));
  return targets;
}
