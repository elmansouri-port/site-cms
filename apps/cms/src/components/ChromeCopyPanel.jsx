/*
 * ChromeCopyPanel — the words in the header and footer, as a list.
 *
 * This is the screen that was missing. The header editor showed sixty lines of
 * markup with the French text visible inside it, so of course people changed the
 * text there — and nothing happened, because every one of those strings is
 * marked with a translation key and the renderer splices the catalogue over the
 * marked range on the way out. The markup's copy is a *default*, overridden on
 * every render.
 *
 * Editing the markup now writes the catalogue too (see routes/admin/chrome.js),
 * but that still asks somebody to find "Se connecter" inside a wall of utility
 * classes to change two words. This is the direct route: every string the part
 * renders, one row each, in the language you pick, with the other languages
 * shown next to it so an empty translation is visible rather than inferred from
 * the site looking wrong.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Languages, Save, Type } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import {
  Badge, Button, Callout, Code, Empty, ErrorBox, Input, Segmented, Spinner, Tooltip,
} from './ui/index.js';
import { cn } from '../lib/cn.js';

/**
 * What kind of string this is, said in terms of consequence.
 *
 * The distinction that matters to an editor is not "text vs rich vs attr", it is
 * whether they can safely retype it here.
 */
function kindNote(item) {
  if (item.kind === 'attr') {
    return `The ${item.attrName} of a ${item.tag || 'element'} — read by screen readers and search engines, not shown on the page.`;
  }
  if (item.rich) {
    return 'This sentence has a link or a styled word inside it. Editing it here would delete that, so it opens in the copy editor instead.';
  }
  return null;
}

export default function ChromeCopyPanel({ part, locales = ['fr', 'en', 'de'], canEdit, onSaved }) {
  const toast = useToast();
  const [state, setState] = useState({ loading: true, error: null, items: [], locales });
  const [locale, setLocale] = useState(locales[0] || 'fr');
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setState(s => ({ ...s, loading: true, error: null }));
    api.get(`/chrome/${part}/copy`)
      .then((data) => {
        if (!alive) return;
        setState({ loading: false, error: null, items: data.items || [], locales: data.locales || locales });
        setEdits({});
      })
      .catch((error) => { if (alive) setState(s => ({ ...s, loading: false, error })); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part, nonce]);

  const editable = useMemo(
    () => state.items.filter(i => !i.orphan && !i.rich && i.kind !== 'raw' && i.kind !== 'js'),
    [state.items],
  );
  const referenceOnly = useMemo(
    () => state.items.filter(i => i.orphan || i.rich || i.kind === 'raw' || i.kind === 'js'),
    [state.items],
  );

  const valueOf = (item) => (
    edits[item.key] !== undefined ? edits[item.key] : (item.values?.[locale] ?? '')
  );
  const changedKeys = Object.keys(edits).filter((key) => {
    const item = state.items.find(i => i.key === key);
    return item && edits[key] !== (item.values?.[locale] ?? '');
  });

  // Switching language mid-edit would write French text into German. The
  // unsaved values belong to the language they were typed in, so they go.
  function switchLocale(next) {
    if (changedKeys.length && !window.confirm('Discard the unsaved text and switch language?')) return;
    setEdits({});
    setLocale(next);
  }

  async function save() {
    setBusy(true);
    try {
      const values = Object.fromEntries(changedKeys.map(k => [k, edits[k]]));
      const res = await api.patch(`/chrome/${part}/copy`, { locale, values });
      const n = res.written?.length || 0;
      if (res.refused?.length) {
        toast.error(`${res.refused.length} string(s) could not be saved here — they contain inline markup. Open them in Copy & languages.`);
      }
      toast.success(n
        ? `${n} string${n === 1 ? '' : 's'} updated in ${locale.toUpperCase()} — live on every page`
        : 'Nothing to save');
      setEdits({});
      setNonce(x => x + 1);
      onSaved?.();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  if (state.loading) return <Spinner label="Reading the copy…" />;
  if (state.error) return <ErrorBox error={state.error} onRetry={() => setNonce(x => x + 1)} />;
  if (!state.items.length) {
    return (
      <Empty icon={Type} title="No translated strings in this part">
        Nothing here is marked for translation, so the markup&apos;s own words are what ships.
        Edit them on the <strong>Markup</strong> tab.
      </Empty>
    );
  }

  const others = state.locales.filter(l => l !== locale);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={locale}
          onChange={switchLocale}
          options={state.locales.map(l => ({ value: l, label: l.toUpperCase() }))}
        />
        <span className="text-muted-foreground text-[12px]">
          {editable.length} string{editable.length === 1 ? '' : 's'}
        </span>
        <span className="grow" />
        {changedKeys.length > 0 && (
          <Badge variant="warning">{changedKeys.length} unsaved</Badge>
        )}
      </div>

      <Callout tone="primary">
        These are the words the site actually renders. The markup tab holds a copy of them as a
        default, and the value here wins on every request — which is why changing the text in the
        markup alone used to appear to do nothing.
      </Callout>

      <div className="grid min-w-0 gap-1.5">
        {editable.map((item) => {
          const dirty = edits[item.key] !== undefined && edits[item.key] !== (item.values?.[locale] ?? '');
          const missing = !(item.values?.[locale] ?? '').trim();
          return (
            <div
              key={item.key}
              className={cn(
                'bg-card grid min-w-0 gap-1.5 rounded-lg border p-2.5 transition-colors',
                dirty && 'border-primary/50',
              )}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <Code className="text-[11px]">{item.key}</Code>
                {item.kind === 'attr' && (
                  <Tooltip content={kindNote(item)}>
                    <Badge variant="outline">{item.attrName}</Badge>
                  </Tooltip>
                )}
                {item.occurrences > 1 && (
                  <Tooltip content={`Marked in ${item.occurrences} places in this part — the desktop bar and the mobile drawer, usually. One value serves them all.`}>
                    <Badge variant="outline">×{item.occurrences}</Badge>
                  </Tooltip>
                )}
                {missing && (
                  <Tooltip content={`No ${locale.toUpperCase()} translation, so this falls back to the source language.`}>
                    <Badge variant="warning">not translated</Badge>
                  </Tooltip>
                )}
                {dirty && <Badge variant="primary">edited</Badge>}
              </div>

              <Input
                value={valueOf(item)}
                disabled={!canEdit}
                placeholder={item.inMarkup || '—'}
                aria-label={item.key}
                onChange={e => setEdits(v => ({ ...v, [item.key]: e.target.value }))}
              />

              {others.length > 0 && (
                <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px]">
                  {others.map(l => (
                    <span key={l}>
                      <span className="font-semibold">{l.toUpperCase()}</span>{' '}
                      {(item.values?.[l] ?? '').trim() || <em>not translated</em>}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {referenceOnly.length > 0 && (
        <div className="grid min-w-0 gap-1.5">
          <p className="text-muted-foreground text-[12px] font-semibold">
            Edited elsewhere
          </p>
          <p className="text-muted-foreground text-[11.5px] leading-snug">
            A sentence with a link or a styled word inside it stores that structure as numbered
            placeholders. Retyping it as plain text here would delete the link, so these open in{' '}
            <Link to="/strings" className="underline">Copy &amp; languages</Link>, which shows the
            placeholders.
          </p>
          {referenceOnly.map(item => (
            <div key={item.key} className="bg-muted/40 flex min-w-0 flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2">
              <Languages className="text-muted-foreground size-3.5 shrink-0" />
              <Code className="text-[11px]">{item.key}</Code>
              {item.rich && <Badge variant="outline">has markup</Badge>}
              {item.orphan && (
                <Tooltip content="This marker is in the markup but the renderer produces no unit for it, so it is never spliced. Usually a marker left on an element whose text has since moved into a child.">
                  <Badge variant="warning">not rendered</Badge>
                </Tooltip>
              )}
              <span className="text-muted-foreground min-w-0 grow truncate text-[12px]">
                {(item.values?.[locale] ?? '').trim() || <em>not translated</em>}
              </span>
              <Button asChild variant="ghost" size="sm">
                <Link to={`/strings?q=${encodeURIComponent(item.key)}`}>Open</Link>
              </Button>
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={busy || !changedKeys.length}>
            <Save /> {busy ? 'Saving…' : `Save ${locale.toUpperCase()} copy`}
          </Button>
          {changedKeys.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setEdits({})} disabled={busy}>
              Discard
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
