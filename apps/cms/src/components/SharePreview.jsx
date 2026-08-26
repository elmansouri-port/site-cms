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
import { Icon } from './ui.jsx';

const SURFACES = [
  { key: 'tab', label: 'Tab' },
  { key: 'google', label: 'Google' },
  { key: 'x', label: 'X' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'linkedin', label: 'LinkedIn' },
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
    <div className="share">
      <div className="pill-group" style={{ marginBottom: 14 }}>
        {SURFACES.map(s => (
          <button
            key={s.key}
            type="button"
            className={`pill ${surface === s.key ? 'is-active' : ''}`}
            onClick={() => setSurface(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {surface === 'tab' && <TabPreview title={shownTitle} host={host} />}
      {surface === 'google' && (
        <GooglePreview title={shownTitle} description={shownDescription} host={host} path={path} />
      )}
      {surface === 'x' && (
        <XPreview title={shownTitle} description={shownDescription} image={shownImage} host={host} />
      )}
      {surface === 'whatsapp' && (
        <WhatsAppPreview title={shownTitle} description={shownDescription} image={shownImage} host={host} url={url} />
      )}
      {surface === 'linkedin' && (
        <LinkedInPreview title={shownTitle} image={shownImage} host={host} siteName={siteName} />
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
 * characters in a pinned-ish tab, which is why "Rainbow by ALE — Cloud
 * Communication & Collaboration Platform" reads as "Rainbow by ALE — Cl…".
 */
function TabPreview({ title, host }) {
  return (
    <div className="tab-preview">
      <div className="tab-preview__bar">
        <span className="tab-preview__tab">
          <span className="tab-preview__favicon" aria-hidden="true" />
          <span className="tab-preview__title">{title || 'Untitled page'}</span>
          <span className="tab-preview__close" aria-hidden="true">×</span>
        </span>
        <span className="tab-preview__newtab" aria-hidden="true">+</span>
      </div>
      <div className="tab-preview__url">
        <Icon name="search" />
        <span>{host}</span>
      </div>
    </div>
  );
}

function GooglePreview({ title, description, host, path }) {
  const clipped = clip(title, 60);
  return (
    <div className="serp">
      <div className="serp__site">
        <span className="serp__favicon" aria-hidden="true" />
        <span>
          <strong>{host}</strong>
          <span className="serp__crumbs">{path ? ` › ${path.split('/').filter(Boolean).join(' › ')}` : ''}</span>
        </span>
      </div>
      <div className="serp__title">{clipped || 'Untitled page'}</div>
      <div className="serp__desc">
        {description
          ? clip(description, 155)
          : 'No description set — Google will write one from the page copy, and it is usually worse than yours.'}
      </div>
    </div>
  );
}

function XPreview({ title, description, image, host }) {
  return (
    <div className="social social--x">
      <div className="social__media social__media--wide">
        {image
          ? <img src={image} alt="" onError={hideBroken} />
          : <span className="social__missing">No image — X will post this as a plain link</span>}
      </div>
      <div className="social__body">
        <div className="social__host">{host}</div>
        <div className="social__title">{clip(title, 70)}</div>
        {description && <div className="social__desc">{clip(description, 125)}</div>}
      </div>
    </div>
  );
}

function WhatsAppPreview({ title, description, image, host, url }) {
  return (
    <div className="whatsapp">
      <div className="whatsapp__bubble">
        <div className="whatsapp__card">
          {image
            ? <img className="whatsapp__thumb" src={image} alt="" onError={hideBroken} />
            : <div className="whatsapp__thumb whatsapp__thumb--empty" aria-hidden="true" />}
          <div className="whatsapp__text">
            <div className="whatsapp__title">{clip(title, 60)}</div>
            {description && <div className="whatsapp__desc">{clip(description, 80)}</div>}
            <div className="whatsapp__host">{host}</div>
          </div>
        </div>
        <div className="whatsapp__link">{url}</div>
        <div className="whatsapp__meta">
          {new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} ✓✓
        </div>
      </div>
    </div>
  );
}

function LinkedInPreview({ title, image, host, siteName }) {
  return (
    <div className="social social--linkedin">
      <div className="social__media social__media--wide">
        {image
          ? <img src={image} alt="" onError={hideBroken} />
          : <span className="social__missing">No image — LinkedIn will show a small text-only card</span>}
      </div>
      <div className="social__body">
        <div className="social__title">{clip(title, 100)}</div>
        <div className="social__host">{host} · {siteName}</div>
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

  if ((surface === 'x' || surface === 'whatsapp' || surface === 'linkedin') && !image) {
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

  return (
    <ul className="checks" style={{ marginTop: 12 }}>
      {notes.map(([level, text], i) => (
        <li key={i} className={`checks__row is-${level === 'info' ? 'pass' : level}`}>
          <span className="checks__icon" aria-hidden="true">
            {level === 'fail' ? '×' : level === 'warn' ? '!' : 'i'}
          </span>
          <span>{text}</span>
        </li>
      ))}
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
