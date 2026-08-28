/*
 * ChromeLinksPanel — where the header and footer point.
 *
 * The second thing anybody opens the header to change, after the words. Doing it
 * in the markup means finding the right one of thirteen anchors in a wall of
 * utility classes and not breaking the quoting — so it is a list instead, with
 * each link's own anchor text next to it, and the same picker every block uses.
 *
 * Links are addressed by their position in the markup, so the same page linked
 * from both the desktop bar and the mobile drawer are two rows and change
 * independently. The value each row was read with travels back with the change:
 * if somebody edited the markup in another tab meanwhile, the save is refused
 * rather than splicing a URL over whatever now sits at that offset.
 */
import { useEffect, useState } from 'react';
import { ExternalLink, Link2, Save } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import LinkPicker from './LinkPicker.jsx';
import {
  Badge, Button, Callout, Code, Empty, ErrorBox, Spinner, Tooltip,
} from './ui/index.js';
import { cn } from '../lib/cn.js';

export default function ChromeLinksPanel({ part, canEdit, onSaved }) {
  const toast = useToast();
  const [state, setState] = useState({ loading: true, error: null, items: [] });
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setState(s => ({ ...s, loading: true, error: null }));
    api.get(`/chrome/${part}/links`)
      .then((data) => {
        if (!alive) return;
        setState({ loading: false, error: null, items: data.items || [] });
        setEdits({});
      })
      .catch((error) => { if (alive) setState(s => ({ ...s, loading: false, error })); });
    return () => { alive = false; };
  }, [part, nonce]);

  const valueOf = (item) => (edits[item.index] !== undefined ? edits[item.index] : item.value);
  const changed = state.items.filter(i => edits[i.index] !== undefined && edits[i.index] !== i.value);

  async function save() {
    setBusy(true);
    try {
      const res = await api.patch(`/chrome/${part}/links`, {
        links: changed.map(i => ({ index: i.index, was: i.value, value: edits[i.index] })),
      });
      const n = res.changed?.length || 0;
      toast.success(n
        ? `${n} link${n === 1 ? '' : 's'} repointed — live on every page`
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

  if (state.loading) return <Spinner label="Reading the links…" />;
  if (state.error) return <ErrorBox error={state.error} onRetry={() => setNonce(x => x + 1)} />;
  if (!state.items.length) {
    return <Empty icon={Link2} title="No links in this part" />;
  }

  return (
    <div className="grid gap-4">
      <Callout>
        Every link in this part, in the order it appears in the markup. The same page linked from the
        desktop bar and the mobile drawer is two rows — change one and the other stays as it was.
      </Callout>

      <div className="grid min-w-0 gap-1.5">
        {state.items.map((item) => {
          const dirty = edits[item.index] !== undefined && edits[item.index] !== item.value;
          return (
            <div
              key={item.index}
              className={cn(
                'bg-card grid min-w-0 gap-1.5 rounded-lg border p-2.5 transition-colors',
                dirty && 'border-primary/50',
              )}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] font-semibold">
                  {item.label || <em className="text-muted-foreground font-normal">no visible text</em>}
                </span>
                {item.attrName === 'action' && (
                  <Tooltip content="A form's submit target, not a link somebody clicks.">
                    <Badge variant="outline">form action</Badge>
                  </Tooltip>
                )}
                {item.external && (
                  <Tooltip content="Points off this site, so it is stored as typed rather than as a page reference.">
                    <Badge variant="outline"><ExternalLink className="size-3" /> external</Badge>
                  </Tooltip>
                )}
                {dirty && <Badge variant="primary">edited</Badge>}
                <span className="grow" />
                <Code className="text-muted-foreground text-[11px]">{item.value}</Code>
              </div>
              <LinkPicker
                value={valueOf(item)}
                disabled={!canEdit}
                onChange={next => setEdits(v => ({ ...v, [item.index]: next }))}
              />
            </div>
          );
        })}
      </div>

      {canEdit && (
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={busy || !changed.length}>
            <Save /> {busy ? 'Saving…' : 'Save links'}
          </Button>
          {changed.length > 0 && (
            <>
              <Badge variant="warning">{changed.length} unsaved</Badge>
              <Button variant="ghost" size="sm" onClick={() => setEdits({})} disabled={busy}>
                Discard
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
