import { Fragment, type ReactNode } from 'react';
import { cleanReleaseNoteLines } from './releaseNoteText';

export { hasReleaseNotesContent, releaseNoteTargets, summarizeReleaseNotes } from './releaseNoteText';

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
    return <p className="release-notes-empty">No release notes for this version.</p>;
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
