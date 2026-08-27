/*
 * Experiments — the A/B tests a block, a page or the header can opt into.
 *
 * Two modes, as described in reco.md 3: a cookie-assigned split that persists
 * for a fortnight, and a URL-parameter variant for ad campaigns that is never
 * indexed and never remembered.
 */
import { useState } from 'react';
import { FlaskConical, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Badge, Button, Callout, Card, Code, Dialog, DialogBody, DialogContent, DialogFooter,
  DialogHeader, DialogTitle, Empty, ErrorBox, Field, FieldRow, Input, PageHeader, Select,
  SkeletonRows, StatusBadge, TActions, TBody, THead, TRow, Table, Textarea, Tooltip, formatDate,
  useConfirm,
} from '../components/ui/index.js';

export default function Experiments() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useResource('/experiments');
  const [editing, setEditing] = useState(null);
  const toast = useToast();

  async function setStatus(experiment, status) {
    try {
      await api.patch(`/experiments/${experiment.key}`, { status });
      toast.success(`“${experiment.name}” is now ${status}`);
      reload();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <>
      <PageHeader
        title="A/B tests"
        description="Variants are chosen on the server before the page renders, so visitors never see a flash of the control and a crawler sees an ordinary page."
      >
        {can('editor') && <Button onClick={() => setEditing({ isNew: true })}><Plus /> New test</Button>}
      </PageHeader>

      <Card>
        {loading && <SkeletonRows rows={4} cols={6} />}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {data && !data.items.length && (
          <Empty icon={FlaskConical} title="No tests yet">
            Create one, then attach it to a block from a page&apos;s Design tab — or start a
            whole-page test from that page&apos;s A/B tab, which creates the test for you.
          </Empty>
        )}
        {data?.items?.length > 0 && (
          <Table>
            <THead>
              <tr><th>Test</th><th>Varies</th><th>Assignment</th><th>Split</th><th>Status</th><th>Started</th><th /></tr>
            </THead>
            <TBody>
              {data.items.map(x => (
                <TRow key={x.key} interactive>
                  <td>
                    <div className="font-semibold">{x.name}</div>
                    <div className="text-muted-foreground font-mono text-[11.5px]">{x.key}</div>
                  </td>
                  <td>
                    <Badge variant={x.scope === 'page' ? 'primary' : 'default'}>
                      {x.scope === 'page' ? 'whole page' : 'a block'}
                    </Badge>
                    {x.pageKey && <div className="text-muted-foreground mt-0.5 font-mono text-[11px]">{x.pageKey}</div>}
                  </td>
                  <td>
                    <Tooltip content={x.mode === 'param'
                      ? 'Assigned by a URL parameter. Never indexed and never remembered — for ad landings.'
                      : `Assigned once and kept in a cookie for ${x.cookieDays} days, so a returning visitor is not counted twice.`}
                    >
                      <Badge variant="outline">
                        {x.mode === 'param' ? `?${x.paramName}=` : `cookie · ${x.cookieDays}d`}
                      </Badge>
                    </Tooltip>
                  </td>
                  <td className="text-muted-foreground whitespace-nowrap">
                    {x.variants.map(v => `${v.key} ${v.weight}%`).join(' · ')}
                  </td>
                  <td><StatusBadge status={x.status} /></td>
                  <td className="text-muted-foreground whitespace-nowrap">{formatDate(x.startedAt)}</td>
                  <TActions>
                    {can('editor') && (
                      <div className="flex justify-end gap-1.5">
                        {x.status === 'running' ? (
                          <Button variant="outline" size="sm" onClick={() => setStatus(x, 'paused')}>
                            <Pause /> Pause
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => setStatus(x, 'running')}>
                            <Play /> Start
                          </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => setEditing(x)}>Edit</Button>
                      </div>
                    )}
                  </TActions>
                </TRow>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {editing && (
        <ExperimentDialog
          experiment={editing.isNew ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </>
  );
}

function ExperimentDialog({ experiment, onClose, onSaved }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState(() => experiment || {
    key: '',
    name: '',
    description: '',
    mode: 'cookie',
    paramName: 'version',
    cookieDays: 14,
    status: 'draft',
    variants: [{ key: 'A', label: 'Control', weight: 50 }, { key: 'B', label: 'Variant B', weight: 50 }],
  });
  const [busy, setBusy] = useState(false);
  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const setVariant = (i, patch) => setForm((f) => {
    const variants = f.variants.slice();
    variants[i] = { ...variants[i], ...patch };
    return { ...f, variants };
  });

  const totalWeight = form.variants.reduce((sum, v) => sum + Number(v.weight || 0), 0);

  async function submit(e) {
    e?.preventDefault();
    setBusy(true);
    try {
      const payload = {
        key: form.key,
        name: form.name,
        description: form.description || '',
        mode: form.mode,
        paramName: form.paramName,
        cookieDays: Number(form.cookieDays),
        status: form.status,
        variants: form.variants.map(v => ({ key: v.key, label: v.label || '', weight: Number(v.weight) })),
      };
      if (experiment) await api.patch(`/experiments/${experiment.key}`, payload);
      else await api.post('/experiments', payload);
      toast.success('Saved');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: 'Delete this test?',
      body: 'Blocks assigned to it fall back to their control markup, so nothing breaks — but the split stops being recorded.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.del(`/experiments/${experiment.key}`);
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{experiment ? 'Edit test' : 'New A/B test'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={submit} className="grid gap-4">
            <FieldRow>
              <Field label="Name">
                {id => <Input id={id} value={form.name} onChange={set('name')} autoFocus />}
              </Field>
              <Field label="Key" hint="Lowercase. Used in cookies and reports, so it cannot change later.">
                {id => <Input id={id} mono value={form.key} onChange={set('key')} disabled={!!experiment} />}
              </Field>
            </FieldRow>

            <Field label="What is being tested" hint="The hypothesis, so whoever reads the result knows what it means.">
              {id => <Textarea id={id} rows={2} value={form.description || ''} onChange={set('description')} />}
            </Field>

            <FieldRow>
              <Field label="Assignment">
                {id => (
                  <Select id={id} value={form.mode} onChange={set('mode')}>
                    <option value="cookie">Cookie — split traffic, persists per visitor</option>
                    <option value="param">URL parameter — campaign landing, noindex</option>
                  </Select>
                )}
              </Field>
              {form.mode === 'cookie' ? (
                <Field label="Cookie lifetime" hint="Days. A returning visitor stays in the same arm.">
                  {id => <Input id={id} type="number" min="1" value={form.cookieDays} onChange={set('cookieDays')} />}
                </Field>
              ) : (
                <Field label="Parameter name" hint={`Entry points become ?${form.paramName}=B`}>
                  {id => <Input id={id} mono value={form.paramName} onChange={set('paramName')} />}
                </Field>
              )}
            </FieldRow>

            <Field
              label="Variants"
              hint={totalWeight === 100 ? 'Weights add up to 100%.' : `Weights add up to ${totalWeight}% — traffic is shared out in proportion either way.`}
            >
              <div className="grid gap-2">
                {form.variants.map((v, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      mono
                      className="w-16"
                      value={v.key}
                      aria-label={`Variant ${i + 1} key`}
                      onChange={e => setVariant(i, { key: e.target.value })}
                    />
                    <Input
                      className="grow"
                      value={v.label || ''}
                      placeholder="Label"
                      aria-label={`Variant ${i + 1} label`}
                      onChange={e => setVariant(i, { label: e.target.value })}
                    />
                    <div className="relative w-24">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        className="pr-6"
                        value={v.weight}
                        aria-label={`Variant ${i + 1} weight`}
                        onChange={e => setVariant(i, { weight: e.target.value })}
                      />
                      <span className="text-muted-foreground absolute top-1/2 right-2.5 -translate-y-1/2 text-[12px]">%</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={form.variants.length <= 2}
                      aria-label={`Remove variant ${v.key}`}
                      onClick={() => setForm(f => ({ ...f, variants: f.variants.filter((_, idx) => idx !== i) }))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  onClick={() => setForm(f => ({
                    ...f,
                    variants: [...f.variants, { key: String.fromCharCode(65 + f.variants.length), label: '', weight: 0 }],
                  }))}
                >
                  <Plus /> Add variant
                </Button>
              </div>
            </Field>

            {form.mode === 'cookie' && (
              <Callout>
                A test on the <strong>header or footer</strong> runs on every page, so it reaches a
                usable sample far faster than one page&apos;s traffic would — and for the same reason
                it makes the whole site uncacheable while it runs. Attach one under{' '}
                <Code>Header &amp; footer</Code>.
              </Callout>
            )}
          </form>
        </DialogBody>
        <DialogFooter>
          {experiment && <Button variant="destructive" onClick={remove}>Delete</Button>}
          <span className="grow" />
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !form.key || !form.name}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
