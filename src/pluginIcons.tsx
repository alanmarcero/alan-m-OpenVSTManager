import type { ReactNode } from 'react';

interface IconShape {
  variant: number;
  render: () => ReactNode;
}

const PLUGIN_ICONS: Record<string, IconShape> = {
  openedmdelay: {
    variant: 0,
    render: () => (
      <>
        <path d="M11 33c4-14 14-14 18-3" opacity=".45" />
        <path d="M23 31c3-9 10-9 13-1" opacity=".65" />
        <rect x="9" y="21" width="5" height="17" rx="2.5" fill="currentColor" fillOpacity=".22" />
        <rect x="19" y="25" width="4.5" height="13" rx="2.25" fill="currentColor" fillOpacity=".18" />
        <rect x="28.5" y="28.5" width="4" height="9.5" rx="2" fill="currentColor" fillOpacity=".14" />
        <rect x="37" y="31.5" width="4" height="6.5" rx="2" />
        <circle cx="11.5" cy="14.5" r="2.2" fill="currentColor" stroke="none" />
      </>
    ),
  },
  openwalllimiter: {
    variant: 1,
    render: () => (
      <>
        <path d="M9 17V12h6v5h5v-5h6v5h5v-5h6v5h6v4H9z" fill="currentColor" fillOpacity=".2" />
        <path d="M9 21h34" />
        <path d="M10 38c3-9 6-14 9-14h14c3 0 6 5 9 14" />
        <path d="M19 29h14" opacity=".6" />
        <path d="M14 39h24" opacity=".4" />
      </>
    ),
  },
  openglitchfx: {
    variant: 2,
    render: () => (
      <>
        <path d="M8 26h5V14h6v24h7V18h5v11h6V14h4v12h3" />
        <path d="M12 10h8M31 41h9" opacity=".55" />
        <rect x="19" y="20" width="6" height="6" rx="1" fill="currentColor" fillOpacity=".22" stroke="none" />
      </>
    ),
  },
  openedmfilter: {
    variant: 3,
    render: () => (
      <>
        <path d="M7 36h38" opacity=".4" />
        <path d="M8 35c7 0 9-20 15-20s5 20 19 20" fill="currentColor" fillOpacity=".14" />
        <path d="M8 35c7 0 9-20 15-20s5 20 19 20" />
        <circle cx="23" cy="15" r="2.5" fill="currentColor" stroke="none" />
        <path d="M23 19v17" strokeDasharray="2.5 2.5" opacity=".55" />
      </>
    ),
  },
  openedmkick: {
    variant: 4,
    render: () => (
      <>
        <circle cx="31" cy="30" r="10.5" fill="currentColor" fillOpacity=".14" />
        <circle cx="31" cy="30" r="4" />
        <path d="M10 13c2 15 8 18 14 17" />
        <circle cx="10" cy="13" r="2.2" fill="currentColor" stroke="none" />
      </>
    ),
  },
  openfruit: {
    variant: 5,
    render: () => (
      <>
        <rect x="10" y="12" width="7.5" height="7.5" rx="2" fill="currentColor" fillOpacity=".28" />
        <rect x="22" y="12" width="7.5" height="7.5" rx="2" />
        <rect x="34" y="12" width="7.5" height="7.5" rx="2" fill="currentColor" fillOpacity=".28" />
        <rect x="10" y="22.5" width="7.5" height="7.5" rx="2" />
        <rect x="22" y="22.5" width="7.5" height="7.5" rx="2" fill="currentColor" fillOpacity=".28" />
        <rect x="34" y="22.5" width="7.5" height="7.5" rx="2" />
        <rect x="10" y="33" width="7.5" height="7.5" rx="2" fill="currentColor" fillOpacity=".28" />
        <rect x="22" y="33" width="7.5" height="7.5" rx="2" fill="currentColor" fillOpacity=".28" />
        <rect x="34" y="33" width="7.5" height="7.5" rx="2" fill="currentColor" fillOpacity=".28" />
      </>
    ),
  },
  openclapper: {
    variant: 6,
    render: () => (
      <>
        <path d="M10 26v6M15 20v14M20 15v22" />
        <path d="M25 22c5-7 13-7 18-2v12c-5 5-13 5-18-2z" fill="currentColor" fillOpacity=".18" />
        <path d="M29 19l9-5M29 33l9 5" opacity=".55" />
      </>
    ),
  },
  opensmacker: {
    variant: 7,
    render: () => (
      <>
        <ellipse cx="26" cy="21" rx="14" ry="5.5" fill="currentColor" fillOpacity=".18" />
        <path d="M12 21v12c0 3 6.3 5.5 14 5.5s14-2.5 14-5.5V21" />
        <path d="M18 33l16-4M18 29l16 4" opacity=".6" />
        <path d="M26 11v4M19 12l2 3M33 12l-2 3" />
      </>
    ),
  },
  openhatter: {
    variant: 8,
    render: () => (
      <>
        <path d="M9 24c11-4 23-4 34 0-11 2-23 2-34 0z" fill="currentColor" fillOpacity=".22" />
        <path d="M10 30c10 3 22 3 32 0" />
        <path d="M26 14v33M21 43h10" />
        <path d="M16 17c3-4 17-4 20 0" opacity=".6" />
      </>
    ),
  },
  opensausage: {
    variant: 9,
    render: () => (
      <>
        <path d="M8 33c7 0 9-16 18-16s11 16 18 16" fill="currentColor" fillOpacity=".16" />
        <path d="M8 33c7 0 9-16 18-16s11 16 18 16" />
        <rect x="16" y="13" width="20" height="7" rx="3.5" opacity=".5" />
        <path d="M10 38h32" opacity=".4" />
      </>
    ),
  },
  openducker: {
    variant: 10,
    render: () => (
      <>
        <path d="M8 17h36" strokeDasharray="3 3" opacity=".45" />
        <path d="M9 17v19c5 0 9-15 17-19v19c5 0 9-15 17-19v7" />
        <circle cx="9" cy="36" r="2" fill="currentColor" stroke="none" />
        <circle cx="26" cy="36" r="2" fill="currentColor" stroke="none" />
      </>
    ),
  },
  opentunereq: {
    variant: 11,
    render: () => (
      <>
        <path d="M7 28c5 0 6-12 12-12s7 18 13 18 7-13 13-13" />
        <circle cx="19" cy="16" r="2.6" fill="currentColor" />
        <circle cx="32" cy="34" r="2.6" fill="currentColor" />
        <path d="M10 40h32" opacity=".4" />
        <path d="M19 36v4M26 36v4M32 37v3" opacity=".55" />
      </>
    ),
  },
  openbassspace: {
    variant: 12,
    render: () => (
      <>
        <path d="M14 14c-6 5-6 19 0 24M38 14c6 5 6 19 0 24" opacity=".6" />
        <path d="M19 18c-4 4-4 12 0 16M33 18c4 4 4 12 0 16" />
        <circle cx="26" cy="26" r="4" fill="currentColor" fillOpacity=".32" />
        <path d="M26 34v6" />
      </>
    ),
  },
  'winamp-classic-equalizer-vst': {
    variant: 13,
    render: () => (
      <>
        <path d="M11 12v28M18.5 12v28M26 12v28M33.5 12v28M41 12v28" opacity=".45" />
        <rect x="8.5" y="17" width="5" height="5" rx="1.2" fill="currentColor" fillOpacity=".28" />
        <rect x="16" y="27" width="5" height="5" rx="1.2" fill="currentColor" fillOpacity=".28" />
        <rect x="23.5" y="14" width="5" height="5" rx="1.2" fill="currentColor" fillOpacity=".28" />
        <rect x="31" y="23" width="5" height="5" rx="1.2" fill="currentColor" fillOpacity=".28" />
        <rect x="38.5" y="29" width="5" height="5" rx="1.2" fill="currentColor" fillOpacity=".28" />
      </>
    ),
  },
  'winamp-classic-visualizer-vst': {
    variant: 14,
    render: () => (
      <>
        <path d="M9 17l6-4 5 7 6-9 5 8 6-6 6 4" />
        <rect x="10" y="30" width="4.5" height="10" rx="1" fill="currentColor" fillOpacity=".25" />
        <rect x="17" y="25" width="4.5" height="15" rx="1" fill="currentColor" fillOpacity=".25" />
        <rect x="24" y="21" width="4.5" height="19" rx="1" fill="currentColor" fillOpacity=".25" />
        <rect x="31" y="26" width="4.5" height="14" rx="1" fill="currentColor" fillOpacity=".25" />
        <rect x="38" y="32" width="4.5" height="8" rx="1" fill="currentColor" fillOpacity=".25" />
      </>
    ),
  },
};

const ALIAS_KEYS: Record<string, string> = {
  openkicker: 'openedmkick',
  openmaster: 'openbassspace',
};

export function BrandMark({ size = 25 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 3 27 8.5 28.5 20.5 22.5 29H9.5L3.5 20.5 5 8.5Z" strokeWidth="1.6" fill="currentColor" fillOpacity=".1" />
      <rect x="9.2" y="13.5" width="2.6" height="8" rx="1.3" fill="currentColor" stroke="none" opacity=".72" />
      <rect x="14.7" y="8.5" width="2.6" height="13" rx="1.3" fill="currentColor" stroke="none" />
      <rect x="20.2" y="13.5" width="2.6" height="8" rx="1.3" fill="currentColor" stroke="none" opacity=".72" />
      <path d="M11.5 23.8 16 26.3 20.5 23.8" strokeWidth="1.75" />
    </svg>
  );
}

export function PluginGlyph({ id, large = false }: { id: string; large?: boolean }) {
  const normalized = ALIAS_KEYS[id.toLowerCase()] ?? id.toLowerCase();
  const entry = PLUGIN_ICONS[normalized];
  const variant = entry ? entry.variant : [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 15;
  const content = entry ? entry.render() : (
    <>
      <circle cx="26" cy="26" r="14" opacity=".4" />
      <path d="M15 26c4-9 8-9 11 0s7 9 11 0" />
    </>
  );
  return (
    <span className={`plugin-glyph glyph-${variant}${large ? ' glyph-large' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
        {content}
      </svg>
    </span>
  );
}
