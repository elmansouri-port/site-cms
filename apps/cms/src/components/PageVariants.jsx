/*
 * PageVariants — testing a whole page rather than one block.
 *
 * A block test is the right tool for a headline. A redesigned pricing page is
 * not one block, and cutting it into a dozen block-level tests measures nothing
 * useful. So an arm here is a complete page document: duplicate the page, change
 * whatever you like, split the traffic.
 *
 * The arm never gets a URL. Visitors assigned to it are served its content at
 * the control's address, which is what keeps a single canonical URL and nothing
 * duplicate for a crawler to find — the mistake that makes most page-level A/B
 * testing quietly expensive.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FlaskConical, Pause, Play, Plus } from 'lucide-react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import {
  Badge, Button, Callout, Card, CardContent, CardHeader, CardTitle, CheckboxField, Code, Dialog,
  DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, Empty, Field, FieldRow,
  Input, Spinner, StatusBadge, TActions, TBody, THead, TRow, Table, formatDate,
} from './ui/index.js';

export default function PageVariants({ page, canEdit, onChanged }) {
  const toast = useToast();
  const { data, loading, reload } = useResource(`/pages/${page.key}/variants`);
  const [creating, setCreating] = useState(false);

  const experiment = data?.experiment;
  const arms = data?.items || [];

  async function setStatus(status) {
    try {
      await api.patch(`/experiments/${experiment.key}`, { status });
      toast.success(`Test ${status}`);
      reload();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader>
          <CardTitle>Whole-page test</CardTitle>
          {canEdit && (
            <div data-slot="card-actions">
              <Button size="sm" onClick={() => setCreating(true)}><Plus /> New variant</Button>
            </div>
          )}
        </CardHeader>

        {loading && <Spinner />}

        {!loading && !arms.length && (
          <Empty icon={FlaskConical} title="This page is not being tested">
            Create a variant to duplicate the page, change what you want to test, and split traffic
            between them. Visitors stay on this URL either way.
          </Empty>
        )}

        {arms.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b p-3">
              <Code>{experiment?.key}</Code>
              <StatusBadge status={experiment?.status || 'draft'} />
              {canEdit && experiment && (
                experiment.status === 'running'
                  ? <Button variant="outline" size="sm" onClick={() => setStatus('paused')}><Pause /> Pause</Button>
                  : <Button size="sm" onClick={() => setStatus('running')}><Play /> Start test</Button>
              )}
              <span className="grow" />
              <Button variant="outline" size="sm" asChild>
                <Link to="/experiments">Weights &amp; mode</Link>
              </Button>
            </div>

            <Table>
              <THead>
                <tr><th>Arm</th><th>Page</th><th>Split</th><th>Status</th><th>Updated</th><th /></tr>
              </THead>
              <TBody>
                {arms.map((arm) => {
                  const weight = experiment?.variants?.find(v => v.key === arm.variant)?.weight;
                  return (
                    <TRow key={arm.key} interactive>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={arm.isControl ? 'primary' : 'warning'}>{arm.variant}</Badge>
                          {arm.isControl && <span className="text-muted-foreground text-[12px]">control</span>}
                        </div>
                      </td>
                      <td>
                        <div className="font-medium">{arm.title}</div>
                        <div className="text-muted-foreground font-mono text-[11.5px]">{arm.key}</div>
                      </td>
                      <td className="text-muted-foreground tabular-nums">
                        {weight === undefined ? '—' : `${weight}%`}
                      </td>
                      <td><StatusBadge status={arm.status} /></td>
                      <td className="text-muted-foreground whitespace-nowrap">{formatDate(arm.updatedAt)}</td>
                      <TActions>
                        {arm.isControl
                          ? <span className="text-muted-foreground text-[12px]">this page</span>
                          : (
                            <Button variant="outline" size="sm" asChild>
                              <Link to={`/pages/${arm.key}`}>Edit arm</Link>
                            </Button>
                          )}
                      </TActions>
                    </TRow>
                  );
                })}
              </TBody>
            </Table>

            {arms.some(a => !a.isControl && a.status !== 'published') && (
              <CardContent>
                <Callout tone="warning">
                  An arm still in draft is skipped: visitors assigned to it fall back to the control.
                  Publish it before starting the test.
                </Callout>
              </CardContent>
            )}
          </>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle>How it behaves</CardTitle></CardHeader>
        <CardContent className="prose-sm">
          <p>
            <strong>Assigned before render.</strong> The arm is chosen in server middleware, so the
            HTML the visitor receives already is their version. No flash, no layout shift.
          </p>
          <p>
            <strong>One URL.</strong> Both arms are served at <code>/{'{lang}'}/{page.route}</code>.
            The variant page has no address of its own, is <code>noindex</code>, and is excluded from
            the sitemap.
          </p>
          <p>
            <strong>Sticky per visitor.</strong> A cookie keeps somebody on the same arm for the
            experiment&apos;s window, so a returning visitor is not counted twice or shown both
            versions.
          </p>
          <p>
            <strong>Readable by analytics.</strong> The arm is exposed as{' '}
            <code>window.__CMS__.page.variant</code>, so any tool can segment on it.
          </p>
          <p>
            <strong>Caching is handled.</strong> A cookie-assigned response is marked private and
            varies on Cookie, so a CDN cannot serve one visitor&apos;s arm to everybody.
          </p>
        </CardContent>
      </Card>

      {creating && (
        <NewVariant
          page={page}
          existing={arms}
          suggestedKey={experiment?.key}
          onClose={() => setCreating(false)}
          onCreated={async () => { setCreating(false); reload(); await onChanged(); }}
        />
      )}
    </div>
  );
}

function NewVariant({ page, existing, suggestedKey, onClose, onCreated }) {
  const toast = useToast();
  const used = new Set(existing.map(a => a.variant));
  const nextLetter = ['B', 'C', 'D', 'E'].find(l => !used.has(l)) || 'B';

  const [form, setForm] = useState({
    experimentKey: suggestedKey || `${page.key}-test`,
    variant: nextLetter,
    label: '',
    copyControl: true,
  });
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e?.preventDefault();
    setBusy(true);
    try {
      const res = await api.post(`/pages/${page.key}/variants`, {
        experimentKey: form.experimentKey,
        variant: form.variant,
        label: form.label || undefined,
        copyControl: form.copyControl,
      });
      toast.success(`Variant ${form.variant} created as “${res.page.key}”`);
      onCreated();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New page variant</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={submit} className="grid gap-4">
            <Field label="Test key" hint="Lowercase. Used in the cookie and in reporting, so it cannot change later.">
              {id => (
                <Input
                  id={id}
                  mono
                  value={form.experimentKey}
                  disabled={!!suggestedKey}
                  onChange={e => setForm(f => ({ ...f, experimentKey: e.target.value }))}
                />
              )}
            </Field>
            <FieldRow>
              <Field label="Arm">
                {id => (
                  <Input
                    id={id}
                    mono
                    value={form.variant}
                    onChange={e => setForm(f => ({ ...f, variant: e.target.value.toUpperCase() }))}
                  />
                )}
              </Field>
              <Field label="Name" hint="What you are trying.">
                {id => (
                  <Input
                    id={id}
                    value={form.label}
                    placeholder={`Variant ${form.variant}`}
                    onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                  />
                )}
              </Field>
            </FieldRow>
            <CheckboxField
              label="Start from a copy of this page"
              hint={form.copyControl
                ? 'The arm starts identical to this page, so you change only what you are testing.'
                : 'The arm starts with the header, footer and scripts only — an empty page to build from.'}
              checked={form.copyControl}
              onChange={v => setForm(f => ({ ...f, copyControl: v }))}
            />
            <Callout>
              The test is created <strong>paused</strong>: no traffic moves until you start it, and
              the arm is a draft until you publish it.
            </Callout>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !form.experimentKey}>Create variant</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
