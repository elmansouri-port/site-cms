/*
 * ElementInspector — click a button on the page, change where it goes.
 *
 * The block inspector is the right tool for "edit this section": a form of every
 * field the block has. It is the wrong tool for "that button points at the old
 * pricing page", which is the most common single edit anybody makes. Finding
 * `secondaryHref` among eighteen fields, on a block whose name you have to guess
 * from the layout, is a worse experience than the site's HTML was.
 *
 * So a click on a link opens this instead: the one element, its destination, its
 * label, and a way to reach the whole block when that is what you wanted. The
 * canvas tells us what was clicked (see cms-editor.js `describeElement`), and
 * there are three honest answers depending on where that element came from:
 *
 *   a named field       the block drew this link from `primaryHref`. Edit the
 *                       field — and its label and new-tab companion, which the
 *                       naming convention tells us the names of.
 *   a label-only field  the destination is not the editor's to choose (the blog
 *                       list's button goes to the blog). Say so, edit the words.
 *   authored markup     the link is written in the section's own HTML. The href
 *                       is spliced over its byte range server-side, so the rest
 *                       of the section is untouched — which is what keeps the
 *                       fidelity guarantee true for a page nobody has converted.
 *
 * The fourth case is a form: its fields belong to the form, not to the page that
 * placed it, so this points at the form rather than pretending to edit it here.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Link2, PanelRightClose, Save, SquarePen, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import LinkPicker from './LinkPicker.jsx';
import { Button, Callout, CheckboxField, Field, Input, Spinner } from './ui/index.js';

/* ── Field paths ──────────────────────────────────────────────────────────── */

const get = (object, path) => String(path).split('.').reduce(
  (node, part) => (node == null ? undefined : node[part]),
  object,
);

/** Set a dotted path, cloning along the way so React sees a new object. */
function set(object, path, value) {
  const parts = String(path).split('.');
  const root = Array.isArray(object) ? [...object] : { ...(object || {}) };
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const next = node[part];
    node[part] = Array.isArray(next) ? [...next] : { ...(next || {}) };
    node = node[part];
  }
  node[parts[parts.length - 1]] = value;
  return root;
}

/**
 * The companion fields of a link field.
 *
 * Every block in this codebase names them the same way — `primaryHref` next to
 * `primaryLabel`, `ctaHref` next to `ctaLabel` — so the convention is the lookup
 * and no per-block map has to be kept in step. A field that does not end in
 * `Href` is not a destination, which is how the label-only case is detected.
 */
function companions(field) {
  if (!field) return null;
  const match = /^(.*?)Href$/.exec(field);
  if (!match) return null;
  return {
    href: field,
    label: `${match[1]}Label`,
    newTab: `${match[1]}NewTab`,
  };
}

/** A human name for a field path, for the panel's subtitle. */
function fieldTitle(field) {
  if (!field) return 'Link';
  const leaf = field.split('.').pop();
  const words = leaf
    .replace(/Href$|Label$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  const index = /\.(\d+)\./.exec(field);
  const nth = index ? ` ${Number(index[1]) + 1}` : '';
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}${nth}`.trim() || 'Link';
}

export default function ElementInspector({
  pageKey, section, element, canEdit, anchors = [], onSaved, onClose, onOpenBlock,
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const isComponent = section?.type === 'component';
  const paths = useMemo(() => companions(element.field), [element.field]);
  const labelOnly = !!element.field && !paths;

  /*
   * A draft of just the values this panel edits, seeded from the block. The
   * whole block is not copied: the panel patches the fields it shows and nothing
   * else, so a stale copy of the rest cannot be written back over somebody's
   * concurrent edit.
   */
  const initial = useMemo(() => {
    if (isComponent && element.field) {
      const data = section.data || {};
      return {
        href: paths ? (get(data, paths.href) ?? '') : '',
        label: get(data, paths ? paths.label : element.field) ?? '',
        newTab: paths ? !!get(data, paths.newTab) : false,
      };
    }
    // Authored markup: what the canvas read off the element is the truth, and
    // the href it reports has been through reference resolution, so the stored
    // value is fetched below rather than guessed from the rendered one.
    return { href: '', label: element.text || '', newTab: element.target === '_blank' };
  }, [isComponent, element, section, paths]);

  const [draft, setDraft] = useState(initial);
  const [stored, setStored] = useState(initial);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setDraft(initial); setStored(initial); }, [initial]);

  /*
   * For an authored link the rendered href is not the stored one — `page:tarifs`
   * has become `/fr/tarifs` by the time the browser sees it. Ask the API what
   * the markup actually says, so the editor is shown the reference they wrote
   * rather than its resolved form, and saving does not flatten it.
   */
  const authoredIndex = element.authoredIndex;
  const wantsAuthored = !element.field && Number.isInteger(authoredIndex) && authoredIndex >= 0;

  useEffect(() => {
    if (!wantsAuthored) return undefined;
    let alive = true;
    setLoading(true);
    api.get(`/pages/${pageKey}/sections/${section.key}/anchors`)
      .then(({ items, fieldBacked }) => {
        if (!alive) return;
        const found = (items || [])[authoredIndex];
        const next = {
          href: found?.href ?? '',
          label: found?.text ?? element.text ?? '',
          newTab: found?.target === '_blank',
          editable: found ? found.editable : false,
          missing: !found,
          // The block holds no markup: its links come from fields, and this one
          // is from a field the block does not annotate. Worth saying, because
          // the answer — open the block — is different from "not editable".
          fieldBacked: !!fieldBacked,
        };
        setDraft(next);
        setStored(next);
      })
      .catch(err => { if (alive) toast.error(err); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [wantsAuthored, pageKey, section.key, authoredIndex, element.text, toast]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);

  async function save() {
    setBusy(true);
    try {
      if (isComponent && element.field) {
        let data = section.data || {};
        if (paths) {
          data = set(data, paths.href, draft.href);
          // Only written when it is on: an object full of `false` companions is
          // noise in the stored block and in every diff of it.
          if (draft.newTab) data = set(data, paths.newTab, true);
          else if (get(data, paths.newTab) !== undefined) data = set(data, paths.newTab, false);
          if (get(section.data || {}, paths.label) !== undefined || draft.label) {
            data = set(data, paths.label, draft.label);
          }
        } else {
          data = set(data, element.field, draft.label);
        }
        await api.patch(`/pages/${pageKey}/sections/${section.key}`, { data });
      } else {
        await api.patch(
          `/pages/${pageKey}/sections/${section.key}/anchors/${authoredIndex}`,
          { href: draft.href, target: draft.newTab ? '_blank' : '_self' },
        );
      }
      setStored(draft);
      toast.success('Link saved');
      await onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  /* ── A form's own controls belong to the form ───────────────────────────── */

  if (element.formKey) {
    return (
      <Panel element={element} onClose={onClose} onOpenBlock={onOpenBlock} title="Form field">
        <Callout>
          This control belongs to the form <strong>{element.formKey}</strong>, which is edited in one
          place and can appear on several pages. Changing it here would change it everywhere without
          saying so.
        </Callout>
        <Button size="sm" asChild className="justify-self-start">
          <Link to={`/forms/${element.formKey}`}><SquarePen /> Open this form</Link>
        </Button>
        <p className="text-muted-foreground text-[12px] leading-relaxed">
          The block that places it — its heading, its intro and where it sends people afterwards — is
          on the block itself.
        </p>
      </Panel>
    );
  }

  if (loading) {
    return (
      <Panel element={element} onClose={onClose} onOpenBlock={onOpenBlock} title="Link">
        <Spinner label="Reading the link…" />
      </Panel>
    );
  }

  /* ── A link the CMS cannot address ──────────────────────────────────────── */

  const unaddressable = !element.field && (!wantsAuthored || draft.missing || draft.editable === false);
  if (unaddressable) {
    return (
      <Panel element={element} onClose={onClose} onOpenBlock={onOpenBlock} title={titleFor(element)}>
        <Callout tone="warning">
          {draft.fieldBacked
            ? 'This block builds its links from its own fields, and this one is not a field you can point somewhere else.'
            : draft.editable === false
              ? 'That link has no address of its own — it is handled by the page’s own script.'
              : 'This element is not one the CMS can edit on its own.'}
        </Callout>
        <p className="text-muted-foreground text-[12px] leading-relaxed">
          {draft.fieldBacked
            ? 'Open the block to see everything it does expose.'
            : 'Open the block to edit its markup directly. Everything inside an authored section is '
              + 'stored as it was written, so what you see in the editor is what the page ships.'}
        </p>
        <Button variant="outline" size="sm" className="justify-self-start" onClick={onOpenBlock}>
          <PanelRightClose /> Open the whole block
        </Button>
      </Panel>
    );
  }

  return (
    <Panel element={element} onClose={onClose} onOpenBlock={onOpenBlock} title={titleFor(element)}>
      {labelOnly ? (
        <>
          <Field label="Button text">
            {id => (
              <Input
                id={id}
                value={draft.label}
                disabled={!canEdit}
                onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
              />
            )}
          </Field>
          <Callout>
            Where this goes is decided by the block, not by you — {destinationNote(element.field)}.
            That is deliberate: a link that has to keep working cannot be a free-text field.
          </Callout>
        </>
      ) : (
        <>
          <LinkPicker
            label="Goes to"
            value={draft.href}
            anchors={anchors}
            disabled={!canEdit}
            onChange={value => setDraft(d => ({ ...d, href: value }))}
            hint="Choose a page and the link follows it — including after a rename, and in every language."
          />

          {paths && (
            <Field label="Button text">
              {id => (
                <Input
                  id={id}
                  value={draft.label}
                  disabled={!canEdit}
                  onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
                />
              )}
            </Field>
          )}

          <CheckboxField
            label="Open in a new tab"
            hint="Adds rel=&quot;noopener&quot; too, which a new tab should never be without."
            checked={!!draft.newTab}
            disabled={!canEdit}
            onChange={value => setDraft(d => ({ ...d, newTab: value }))}
          />

          {!element.field && (
            <Callout>
              This link is written in the block&apos;s own markup. Only the address changes — the
              rest of it stays byte-for-byte as it was written.
            </Callout>
          )}
        </>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" disabled={!canEdit || !dirty || busy} onClick={save}>
          <Save /> {busy ? 'Saving…' : 'Save'}
        </Button>
        {dirty && (
          <Button variant="ghost" size="sm" onClick={() => setDraft(stored)}>Reset</Button>
        )}
        <span className="grow" />
        <Button variant="outline" size="sm" onClick={onOpenBlock}>
          Whole block <ArrowRight />
        </Button>
      </div>
    </Panel>
  );
}

/* ── Shell ────────────────────────────────────────────────────────────────── */

function Panel({ element, title, onClose, children }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-2 border-b p-3">
        <span className="bg-primary/10 text-primary mt-0.5 grid size-7 shrink-0 place-items-center rounded-md">
          {element.formKey ? <SquarePen className="size-4" /> : <Link2 className="size-4" />}
        </span>
        <div className="min-w-0 grow">
          <h3 className="truncate text-[13.5px] font-semibold">{title}</h3>
          <p className="text-muted-foreground truncate text-[11.5px]">
            {element.text ? `“${element.text}”` : `<${element.tag}>`}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="grid min-h-0 grow content-start gap-3 overflow-y-auto p-3">{children}</div>
    </div>
  );
}

/* ── Wording ──────────────────────────────────────────────────────────────── */

function titleFor(element) {
  if (element.field) return fieldTitle(element.field);
  if (element.tag === 'button') return 'Button';
  return 'Link';
}

/**
 * Why a label-only element has no destination field.
 *
 * Vague is worse than nothing here: "the block decides" invites a support
 * question, and the answer is different for each of the three cases.
 */
function destinationNote(field) {
  const leaf = String(field || '').split('.').pop();
  if (leaf === 'ctaLabel') return 'it goes to the blog index in the language being read';
  if (leaf === 'monthlyLabel' || leaf === 'yearlyLabel') return 'it switches the prices on this page';
  if (leaf === 'question') return 'it opens and closes the answer underneath';
  return 'it is part of how the block works';
}
