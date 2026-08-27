import { textOf } from '@rainbow/core/article';

/**
 * A block label as a human should read it.
 *
 * The labels were derived from the authored markup at migration time, so they
 * carry whatever entities that markup used: "Section: Vos donn&eacute;es". Left
 * raw they are unreadable in a list; decoding at display keeps the stored value
 * untouched.
 */
export const plainText = (value) => textOf(value) || '';

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

/**
 * The admin's own locale, fixed.
 *
 * The interface is in English; taking the browser's locale instead produced
 * "27 aout 2026" in one column and "just now" in the next, which reads as a bug
 * rather than as localisation. Site *content* is translated — the tool around
 * it is not.
 */
const UI_LOCALE = 'en-GB';

export function formatDate(value, withTime = false) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(UI_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

const UNITS = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/**
 * "3 minutes ago", for lists where the exact timestamp is noise.
 *
 * A restore point is chosen by how recent it is relative to the mistake, not by
 * its clock time — "11 minutes ago" answers that and "14:32" does not.
 */
export function formatRelative(value) {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  if (diff < 45_000) return 'just now';

  const rtf = new Intl.RelativeTimeFormat(UI_LOCALE, { numeric: 'auto' });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(-Math.round(diff / ms), unit);
  }
  return rtf.format(-Math.round(diff / 1000), 'second');
}
