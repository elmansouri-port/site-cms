/*
 * SharePreview — what this page looks like everywhere it gets seen.
 *
 * A title field and an "OG image" field tell you nothing about the thing you are
 * actually shipping. What people react to is a browser tab, a Google result, a
 * card in a WhatsApp thread — and those crop, truncate and fall back in ways no
 * character counter conveys. So this renders them.
 *
 * The rules encoded here are the ones that surprise people:
 *
 *   - a browser tab shows about 30 characters, not 60
 *   - Google shows ~60 of the title and ~155 of the description, and rewrites
 *     the description when it is missing or thin
 *   - X and Facebook crop to 1.91:1, so a tall image loses its top and bottom
 *   - WhatsApp uses a small square thumbnail and shows very little text
 *   - LinkedIn ignores the description entirely on most cards
 *
 * Nothing here is a network call: it is the same values the page will emit,
 * drawn the way each surface draws them.
 */
import { useState } from 'react';
import { AlertCircle, Info, Search, TriangleAlert } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { Segmented } from './ui/index.js';

const SURFACES = [
  { value: 'tab', label: 'Tab' },
  { value: 'google', label: 'Google' },
  { value: 'x', label: 'X' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'linkedin', label: 'LinkedIn' },
];

export default function SharePreview({
  title,
  description,
  image,
  url,
  siteName = 'Rainbow by ALE',
  fallbackTitle = '',
  fallbackDescription = '',
  fallbackImage = '',
}) {
  const [surface, setSurface] = useState('tab');

  const shownTitle = (title || fallbackTitle || '').trim();
  const shownDescription = (description || fallbackDescription || '').trim();
  const shownImage = image || fallbackImage || '';

  const host = hostOf(url);
  const path = pathOf(url);

  return (
    <div>
      <Segmented value={surface} onChange={setSurface} options={SURFACES} className="mb-3.5 flex-wrap" />

      {surface === 'tab' && <TabPreview title={shownTitle} host={host} />}
      {surface === 'google' && (
        <GooglePreview title={shownTitle} description={shownDescription} host={host} path={path} />
      )}
      {surface === 'x' && (
        <SocialCard
          title={clip(shownTitle, 70)}
          description={clip(shownDescription, 125)}
          image={shownImage}
          host={host}
          missing="No image — X will post this as a plain link"
        />
      )}
      {surface === 'whatsapp' && (
        <WhatsAppPreview title={shownTitle} description={shownDescription} image={shownImage} host={host} url={url} />
      )}
      {surface === 'linkedin' && (
        <SocialCard
          title={clip(shownTitle, 100)}
          host={`${host} · ${siteName}`}
          image={shownImage}
          missing="No image — LinkedIn will show a small text-only card"
        />
      )}

      <Notes
        surface={surface}
        title={shownTitle}
        description={shownDescription}
        image={shownImage}
        usedFallbackTitle={!title && !!fallbackTitle}
        usedFallbackDescription={!description && !!fallbackDescription}
        usedFallbackImage={!image && !!fallbackImage}
      />
    </div>
  );
}

/**
 * A browser tab.
 *
 * The single most-seen and least-considered rendering of a title: about 30
 * characters in a tab, which is why "Rainbow by ALE — Cloud Communication &
 * Collaboration Platform" reads as "Rainbow by ALE — Cl…".
 */
function TabPreview({ title, host }) {
  return (
    <div className="bg-muted overflow-hidden rounded-lg border">
      <div className="flex items-end gap-1 px-2 pt-2">
        <span className="bg-card flex min-w-0 max-w-52 items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 py-1.5">
          <span className="bg-primary size-3 shrink-0 rounded-sm" aria-hidden="true" />
          <span className="min-w-0 truncate text-[11.5px]">{title || 'Untitled page'}</span>
          <span className="text-muted-foreground shrink-0 text-[13px] leading-none" aria-hidden="true">×</span>
        </span>
        <span className="text-muted-foreground pb-1.5 text-[13px] leading-none" aria-hidden="true">+</span>
      </div>
      <div className="bg-card text-muted-foreground flex items-center gap-2 border-t px-3 py-2 text-[12px]">
        <Search className="size-3" />
        <span>{host}</span>
      </div>
    </div>
  );
}

function GooglePreview({ title, description, host, path }) {
  const crumbs = path ? path.split('/').filter(Boolean).join(' › ') : '';
  return (
    <div className="bg-card rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <span className="bg-muted size-6 shrink-0 rounded-full border" aria-hidden="true" />
        <span className="min-w-0 text-[12px] leading-tight">
          <strong className="block truncate font-medium">{host}</strong>
          {crumbs && <span className="text-muted-foreground block truncate">{`› ${crumbs}`}</span>}
        </span>
      </div>
      <div className="mt-2 text-[17px] leading-snug text-[#1a0dab] dark:text-[#8ab4f8]">
        {clip(title, 60) || 'Untitled page'}
      </div>
      <div className="text-muted-foreground mt-1 text-[12.5px] leading-relaxed">
        {description
          ? clip(description, 155)
          : 'No description set — Google will write one from the page copy, and it is usually worse than yours.'}
      </div>
    </div>
  );
}

/** The 1.91:1 card X, Facebook and LinkedIn all draw, with their own trimmings. */
function SocialCard({ title, description, image, host, missing }) {
  return (
    <div className="bg-card overflow-hidden rounded-lg border">
      <div className="bg-muted text-muted-foreground flex aspect-[1.91/1] items-center justify-center p-4 text-center text-[12px]">
        {image
          ? <img src={image} alt="" className="size-full object-cover" onError={hideBroken} />
          : <span>{missing}</span>}
      </div>
      <div className="grid gap-1 p-3">
        <div className="text-muted-foreground text-[11.5px] uppercase">{host}</div>
        <div className="text-[13.5px] leading-snug font-semibold">{title}</div>
        {description && <div className="text-muted-foreground text-[12px] leading-snug">{description}</div>}
      </div>
    </div>
  );
}

function WhatsAppPreview({ title, description, image, host, url }) {
  return (
    <div className="rounded-lg bg-[#e5ddd5] p-4 dark:bg-[#0b141a]">
      <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-none bg-[#dcf8c6] p-1.5 shadow-sm dark:bg-[#005c4b]">
        <div className="flex gap-2 rounded-md bg-black/5 p-2 dark:bg-white/10">
          {image
            ? <img src={image} alt="" className="size-14 shrink-0 rounded object-cover" onError={hideBroken} />
            : <div className="size-14 shrink-0 rounded bg-black/10 dark:bg-white/10" aria-hidden="true" />}
          <div className="min-w-0 text-[#111b21] dark:text-[#e9edef]">
            <div className="truncate text-[12.5px] font-medium">{clip(title, 60)}</div>
            {description && <div className="truncate text-[11.5px] opacity-70">{clip(description, 80)}</div>}
            <div className="truncate text-[11px] opacity-55">{host}</div>
          </div>
        </div>
        <div className="mt-1 truncate px-1 text-[12px] text-[#027eb5] dark:text-[#53bdeb]">{url}</div>
        <div className="px-1 text-right text-[10.5px] text-[#111b21]/45 dark:text-[#e9edef]/45">
          {new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} ✓✓
        </div>
      </div>
    </div>
  );
}

/**
 * What to fix, phrased as a consequence rather than a rule.
 *
 * "Title is 74 characters" is a fact. "Google will cut it after 'Collaboration'"
 * is a reason to change it.
 */
function Notes({ surface, title, description, image, usedFallbackTitle, usedFallbackDescription, usedFallbackImage }) {
  const notes = [];

  if (!title) notes.push(['fail', 'No title. Every surface above needs one.']);
  else if (surface === 'tab' && title.length > 32) {
    notes.push(['warn', `A tab shows about 30 characters — this reads as “${clip(title, 30)}”. Front-load the words that identify the page.`]);
  } else if (surface === 'google' && title.length > 60) {
    notes.push(['warn', `Google cuts this after “${clip(title, 60)}”.`]);
  }

  if (surface === 'google') {
    if (!description) notes.push(['warn', 'No description, so Google will write its own from the page.']);
    else if (description.length > 155) notes.push(['warn', `Cut after “…${clip(description, 155).slice(-28)}”.`]);
    else if (description.length < 60) notes.push(['warn', 'Under 60 characters — short descriptions often get replaced.']);
  }

  if (['x', 'whatsapp', 'linkedin'].includes(surface) && !image) {
    notes.push(['fail', 'No sharing image. A link with no image gets markedly fewer clicks.']);
  }
  if (surface === 'x' && image) {
    notes.push(['info', 'X and Facebook crop to 1.91:1. Keep anything important away from the top and bottom edges.']);
  }
  if (surface === 'whatsapp' && image) {
    notes.push(['info', 'WhatsApp crops to a small square. Text inside the image will not be readable.']);
  }

  if (usedFallbackTitle) notes.push(['info', 'Using the page title — set a meta title to differ from it.']);
  if (usedFallbackDescription) notes.push(['info', 'Using the excerpt as the description.']);
  if (usedFallbackImage) notes.push(['info', 'Using the cover image for sharing.']);

  if (!notes.length) return null;

  const ICONS = { fail: AlertCircle, warn: TriangleAlert, info: Info };
  const TONES = {
    fail: 'bg-destructive/15 text-destructive',
    warn: 'bg-warning/15 text-warning',
    info: 'bg-muted text-muted-foreground',
  };

  return (
    <ul className="mt-3 grid gap-1.5">
      {notes.map(([level, text], i) => {
        const IconComponent = ICONS[level];
        return (
          <li key={i} className="flex items-start gap-2 text-[12px] leading-snug">
            <span
              className={cn('mt-px flex size-4 shrink-0 items-center justify-center rounded-full', TONES[level])}
              aria-hidden="true"
            >
              <IconComponent className="size-2.5" />
            </span>
            <span className="text-muted-foreground">{text}</span>
          </li>
        );
      })}
    </ul>
  );
}

const clip = (s, n) => {
  const text = String(s || '');
  return text.length > n ? `${text.slice(0, n).trimEnd()}…` : text;
};

const hostOf = (url) => {
  try { return new URL(url, window.location.origin).host; } catch { return window.location.host; }
};
const pathOf = (url) => {
  try { return new URL(url, window.location.origin).pathname; } catch { return ''; }
};

/** A broken image URL should read as "no image", not as a broken-image icon. */
const hideBroken = (e) => { e.currentTarget.style.display = 'none'; };
