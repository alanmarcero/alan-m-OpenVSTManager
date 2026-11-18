import { Fragment, type ReactNode } from 'react';

const stripInlineMarkdown = (text: string) =>
  text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();

function cleanReleaseNoteLines(notes: string): string[] {
  const withoutComments = (notes || '').replace(/<!--[\s\S]*?-->/g, '');
  const lines = withoutComments
    .split(/\r?\n/)
    .map(line => line.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trimEnd())
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

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenPattern = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<Fragment key={key++}>{text.slice(lastIndex, match.index)}</Fragment>);
    }
    const token = match[0];
    if (token.startsWith('**')) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      nodes.push(<Fragment key={key++}>{linkMatch ? linkMatch[1] : token}</Fragment>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    nodes.push(<Fragment key={key++}>{text.slice(lastIndex)}</Fragment>);
  }
  return nodes;
}

export function ReleaseNotesBody({ notes }: { notes: string }) {
  const lines = cleanReleaseNoteLines(notes);
  if (!lines.length) {
    return <p className="release-notes-empty">Updated release notes are available on GitHub.</p>;
  }

  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let ordered: string[] = [];
  let paragraph: string[] = [];
  let key = 0;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(<p key={key++}>{renderInline(paragraph.join(' '))}</p>);
    paragraph = [];
  };
  const flushBullets = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={key++}>
        {bullets.map((item, idx) => (
          <li key={idx}>{renderInline(item)}</li>
        ))}
      </ul>
    );
    bullets = [];
  };
  const flushOrdered = () => {
    if (!ordered.length) return;
    blocks.push(
      <ol key={key++}>
        {ordered.map((item, idx) => (
          <li key={idx}>{renderInline(item)}</li>
        ))}
      </ol>
    );
    ordered = [];
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      flushParagraph();
      flushBullets();
      flushOrdered();
      continue;
    }
    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      flushParagraph();
      flushBullets();
      flushOrdered();
      continue;
    }
    const heading = trimmed.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushBullets();
      flushOrdered();
      blocks.push(<h4 key={key++}>{renderInline(heading[1])}</h4>);
      continue;
    }
    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      flushOrdered();
      bullets.push(bullet[1]);
      continue;
    }
    const numbered = trimmed.match(/^\d+\.\s+(.*)$/);
    if (numbered) {
      flushParagraph();
      flushBullets();
      ordered.push(numbered[1]);
      continue;
    }
    flushBullets();
    flushOrdered();
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushBullets();
  flushOrdered();

  return <div className="release-notes-body">{blocks}</div>;
}
