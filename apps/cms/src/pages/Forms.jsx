/*
 * Forms — the list.
 *
 * Two columns earn their place here and the rest are decoration: where a form
 * sends what it collects, and how many places are showing it. Those are the two
 * questions somebody opening this screen actually has — "which form is the demo
 * one" and "is it safe to change this".
 *
 * The usage column is also the delete guard made visible: a form that four pages
 * show cannot be deleted, and seeing that before clicking is better than being
 * told afterwards.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, FileInput, Plus, Trash2 } from 'lucide-react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Badge, Button, Callout, Card, CardHeader, CardTitle, Code, Dialog, DialogBody, DialogContent,
  DialogFooter, DialogHeader, DialogTitle, Empty, ErrorBox, Field, Input, PageHeader,
  SkeletonRows, TActions, TBody, THead, TRow, Table, Tooltip, formatRelative, useConfirm,
} from '../components/ui/index.js';

export default function Forms() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useResource('/forms');
  const [creating, setCreating] = useState(false);

  const items = data?.items || [];

  async function duplicate(item) {
    try {
      const res = await api.post(`/forms/${item.key}/duplicate`);
      toast.success('Form duplicated');
      navigate(`/forms/${res.form.key}`);
    } catch (err) {
      toast.error(err);
    }
  }

  async function remove(item) {
    const ok = await confirm({
      title: `Delete “${item.name}”?`,
      body: 'A restore point is written first, so this can be brought back from the History tab of any screen.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.del(`/forms/${item.key}`);
      toast.success('Form deleted');
      reload();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <>
      <PageHeader
        title="Forms"
        description="Built once, used anywhere — on a page, inside an article, or both. Everything submitted is stored under Leads before any automation is called, so a broken workflow costs a retry rather than the enquiry."
      >
        {can('editor') && <Button onClick={() => setCreating(true)}><Plus /> New form</Button>}
      </PageHeader>

      <Card>
        <CardHeader><CardTitle>Your forms</CardTitle></CardHeader>

        {loading && <SkeletonRows rows={4} cols={5} />}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {data && !items.length && (
          <Empty icon={FileInput} title="No forms yet">
            A form is a list of fields and a destination. Build one here, then place it with the
            <strong> Form</strong> block on any page — or as a section inside an article.
          </Empty>
        )}

        {items.length > 0 && (
          <Table>
            <THead>
              <tr>
                <th>Form</th><th>Fields</th><th>Sends to</th><th>Shown on</th><th>Changed</th><th />
              </tr>
            </THead>
            <TBody>
              {items.map(item => (
                <TRow key={item.key} interactive>
                  <td>
                    <Link to={`/forms/${item.key}`} className="font-semibold hover:underline">
                      {item.name}
                    </Link>
                    <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[12px]">
                      <Code>{item.key}</Code>
                      {item.note && <span className="truncate">{item.note}</span>}
                    </div>
                  </td>
                  <td>
                    {item.fieldCount}
                    {item.requiredCount > 0 && (
                      <span className="text-muted-foreground"> · {item.requiredCount} required</span>
                    )}
                  </td>
                  <td><TargetBadge target={item.target} /></td>
                  <td><Usage usedBy={item.usedBy} /></td>
                  <td className="text-muted-foreground text-[12px]">{formatRelative(item.updatedAt)}</td>
                  <TActions>
                    {can('editor') && (
                      <>
                        <Tooltip content="Duplicate">
                          <Button variant="ghost" size="icon-sm" aria-label="Duplicate" onClick={() => duplicate(item)}>
                            <Copy />
                          </Button>
                        </Tooltip>
                        <Tooltip content={item.usedBy?.length ? 'In use — remove it from those places first' : 'Delete'}>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="hover:text-destructive"
                            aria-label="Delete"
                            onClick={() => remove(item)}
                          >
                            <Trash2 />
                          </Button>
                        </Tooltip>
                      </>
                    )}
                  </TActions>
                </TRow>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Callout className="mt-4">
        The four booking pages are deliberately not forms: a slot picker and a lookup-then-confirm
        handshake are not field lists, and pretending otherwise would give you a builder that
        half-works on the hardest pages on the site. Those stay as authored pages.
      </Callout>

      {creating && <NewFormDialog onClose={() => setCreating(false)} />}
    </>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function TargetBadge({ target }) {
  const [kind, rest] = String(target || '').split(':');
  if (kind === 'hook') {
    return (
      <span className="flex flex-col gap-0.5">
        <Badge variant="primary">automation</Badge>
        <Code className="text-[11px]">{rest}</Code>
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-0.5">
      <Badge variant="outline">leads</Badge>
      <span className="text-muted-foreground text-[11px]">filed as {rest || 'contact'}</span>
    </span>
  );
}

function Usage({ usedBy = [] }) {
  if (!usedBy.length) return <span className="text-muted-foreground">nowhere yet</span>;
  const first = usedBy.slice(0, 2);
  return (
    <span className="text-[12px]">
      {first.map(u => (
        <Link
          key={`${u.kind}-${u.id}`}
          to={u.kind === 'page' ? `/pages/${u.id}` : `/blog/${u.id}`}
          className="mr-1.5 hover:underline"
        >
          {u.label}
        </Link>
      ))}
      {usedBy.length > first.length && (
        <span className="text-muted-foreground">+{usedBy.length - first.length} more</span>
      )}
    </span>
  );
}

/**
 * A new form needs a name, and that is all.
 *
 * The key is derived, because a key an editor invents at this moment is a key
 * they will regret — and it is the identity every block uses, so it cannot be
 * changed afterwards. Two starting points beyond blank, because "email address
 * and a message" is most of what anybody builds.
 */
const STARTERS = {
  contact: {
    label: 'Contact form',
    hint: 'Name, email, company, message. Stored under Leads.',
    build: () => ({
      target: 'lead:contact',
      fields: [
        field('firstName', 'firstName', 'First name', { autocomplete: 'given-name', required: true }),
        field('lastName', 'lastName', 'Last name', { autocomplete: 'family-name', required: true }),
        field('email', 'email', 'Work email', { type: 'email', autocomplete: 'email', required: true }),
        field('company', 'company', 'Company', { autocomplete: 'organization' }),
        field('message', 'message', 'How can we help?', { type: 'textarea', width: 'full' }),
      ],
    }),
  },
  demo: {
    label: 'Demo request',
    hint: 'What the product pages ask for, matching the automation’s field names.',
    build: () => ({
      target: 'lead:demo',
      fields: [
        field('firstName', 'firstName', 'First name', { autocomplete: 'given-name', required: true }),
        field('lastName', 'lastName', 'Last name', { autocomplete: 'family-name', required: true }),
        field('email', 'email', 'Work email', { type: 'email', autocomplete: 'email', required: true }),
        field('company', 'company', 'Company', { autocomplete: 'organization', required: true }),
        field('country', 'country', 'Country', { autocomplete: 'country-name', required: true }),
        field('employees', 'employees', 'Company size', {
          type: 'select',
          options: [
            { value: '1-50', label: { fr: '1 à 50', en: '1 to 50' } },
            { value: '51-250', label: { fr: '51 à 250', en: '51 to 250' } },
            { value: '250+', label: { fr: 'Plus de 250', en: 'More than 250' } },
          ],
        }),
      ],
    }),
  },
  blank: { label: 'Empty', hint: 'Start with nothing and add the fields you need.', build: () => ({ fields: [] }) },
};

const field = (key, name, label, extra = {}) => ({
  key, name, label: { fr: label, en: label }, ...extra,
});

function NewFormDialog({ onClose }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [starter, setStarter] = useState('contact');
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const res = await api.post('/forms', { name: name.trim(), ...STARTERS[starter].build() });
      toast.success('Form created');
      navigate(`/forms/${res.form.key}`);
    } catch (err) {
      toast.error(err);
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New form</DialogTitle></DialogHeader>
        <DialogBody className="grid gap-3">
          <Field label="Name" hint="What you will call it in this list. Visitors never see it.">
            {id => (
              <Input
                id={id}
                autoFocus
                value={name}
                placeholder="Demo request"
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && name.trim()) create(); }}
              />
            )}
          </Field>

          <div className="grid min-w-0 gap-2">
            <span className="text-[13px] font-medium">Start from</span>
            {Object.entries(STARTERS).map(([key, option]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStarter(key)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  starter === key ? 'border-primary bg-accent' : 'hover:bg-muted'
                }`}
              >
                <span className="block text-[13px] font-medium">{option.label}</span>
                <span className="text-muted-foreground block text-[12px]">{option.hint}</span>
              </button>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!name.trim() || busy} onClick={create}>
            {busy ? 'Creating…' : 'Create and edit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
