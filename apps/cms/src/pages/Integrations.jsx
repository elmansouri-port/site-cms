/*
 * Integrations — the outbound endpoints the site calls, and their health.
 *
 * The forms used to post straight from the visitor's browser to the automation
 * platform. Three things followed from that, none of them good: the platform and
 * every webhook path were readable in the page source, the endpoints could be
 * hammered without ever loading the site, and the platform's raw reply was
 * handed to anyone with the network tab open.
 *
 * Now the browser posts to a path on this origin and the server makes the call.
 * This screen is where the mapping lives — and, more usefully day to day, where
 * you can see whether a form is actually working without logging into the
 * automation tool.
 */
import { useState } from 'react';
import { Plug, Plus } from 'lucide-react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Badge, Button, Callout, Card, CardContent, CardHeader, CardTitle, CheckboxField, Code, Dialog,
  DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, Empty, ErrorBox, Field,
  FieldRow, Input, PageHeader, Select, SkeletonRows, TActions, TBody, THead, TRow, Table,
  formatDate,
} from '../components/ui/index.js';

const LEAD_TYPES = ['whitepaper', 'demo', 'partner', 'booking', 'unsubscribe', 'contact', 'other'];

export default function Integrations() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useResource('/integrations');
  const [editing, setEditing] = useState(null);
  const [testing, setTesting] = useState(null);
  const [results, setResults] = useState({});

  const items = data?.items || [];
  const failing = items.filter(i => i.enabled && i.failures > 0 && i.lastError);

  async function test(item) {
    setTesting(item.slug);
    try {
      const res = await api.post(`/integrations/${item.slug}/test`);
      setResults(r => ({ ...r, [item.slug]: res }));
      if (res.ok) toast.success(`${item.label || item.slug} answered in ${res.ms} ms`);
      else toast.error(new Error(`${item.label || item.slug}: ${res.error || `answered ${res.status}`}`));
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setTesting(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Where the forms send what visitors submit. The calls are made by the server, so the destination never appears in the page source and its replies never reach the browser."
      >
        {can('admin') && (
          <Button onClick={() => setEditing({ isNew: true })}><Plus /> New integration</Button>
        )}
      </PageHeader>

      {failing.length > 0 && (
        <Callout
          tone="warning"
          className="mb-4"
          title={`${failing.length} integration${failing.length === 1 ? '' : 's'} last failed`}
        >
          Submissions are still being stored under Leads, so nothing has been lost — but the
          follow-up automation is not running. {failing.map(f => f.label || f.slug).join(', ')}.
        </Callout>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader><CardTitle>Endpoints</CardTitle></CardHeader>
          {loading && <SkeletonRows rows={5} cols={5} />}
          {error && <ErrorBox error={error} onRetry={reload} />}
          {data && !items.length && (
            <Empty icon={Plug} title="No integrations yet">
              Run <Code>npm run seed</Code> to register the endpoints the authored pages call, or add
              one by hand.
            </Empty>
          )}

          {items.length > 0 && (
            <Table>
              <THead>
                <tr>
                  <th>Integration</th><th>The pages call</th><th>Goes to</th>
                  <th>Leads</th><th>Health</th><th />
                </tr>
              </THead>
              <TBody>
                {items.map(item => (
                  <TRow key={item.slug} interactive>
                    <td>
                      <div className="font-semibold">{item.label || item.slug}</div>
                      {item.note && <div className="text-muted-foreground text-[12px]">{item.note}</div>}
                      {!item.enabled && <Badge variant="warning" className="mt-1">switched off</Badge>}
                    </td>
                    <td><Code>{item.publicPath}</Code></td>
                    <td>
                      <div className="font-mono text-[11.5px]">{item.upstreamHost}</div>
                      <div className="text-muted-foreground font-mono text-[11px]">
                        {item.method} {item.upstreamPathHint}
                      </div>
                    </td>
                    <td>
                      {item.captureLead
                        ? <Badge variant="success">stored</Badge>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td><Health item={item} result={results[item.slug]} /></td>
                    <TActions>
                      {can('admin') && (
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => test(item)}
                            disabled={testing === item.slug}
                          >
                            {testing === item.slug ? 'Testing…' : 'Test'}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setEditing(item)}>Edit</Button>
                        </div>
                      )}
                    </TActions>
                  </TRow>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader><CardTitle>How this protects you</CardTitle></CardHeader>
          <CardContent className="prose-sm">
            <p>
              <strong>The destination stays private.</strong> The page source says{' '}
              <code>/api/v1/hooks/…</code>. Which platform runs your lead flow, and the webhook path
              for each form, are not published to competitors or scrapers.
            </p>
            <p>
              <strong>Replies are filtered.</strong> A form is told whether it worked, plus any
              fields you have explicitly allowed. Internal ids, execution URLs and error text stay on
              the server.
            </p>
            <p>
              <strong>Nothing is lost.</strong> A submission is stored under <strong>Leads</strong>{' '}
              before the outbound call. If the automation is down the visitor still counts.
            </p>
            <p>
              <strong>It cannot be abused directly.</strong> Requests are rate limited per visitor and
              the honeypot field is checked before anything is forwarded.
            </p>
            <p>
              <strong>Internal addresses are refused.</strong> An endpoint has to be a public URL, so
              this cannot be turned into a way to reach the database.
            </p>
          </CardContent>
        </Card>
      </div>

      {editing && (
        <IntegrationDialog
          item={editing.isNew ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </>
  );
}

function Health({ item, result }) {
  if (result) {
    return result.ok
      ? <Badge variant="success">answered in {result.ms} ms</Badge>
      : <Badge variant="destructive">{result.error || `HTTP ${result.status}`}</Badge>;
  }
  if (!item.calls) return <span className="text-muted-foreground">not used yet</span>;

  const rate = Math.round(((item.calls - item.failures) / item.calls) * 100);
  return (
    <div className="grid gap-0.5">
      <Badge variant={item.lastError ? 'destructive' : rate === 100 ? 'success' : 'warning'}>
        {rate}% of {item.calls}
      </Badge>
      <span className="text-muted-foreground text-[11px]">{formatDate(item.lastCallAt, true)}</span>
      {item.lastError && <span className="text-destructive text-[11px]">{item.lastError}</span>}
    </div>
  );
}

function IntegrationDialog({ item, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    slug: item?.slug || '',
    label: item?.label || '',
    note: item?.note || '',
    url: '',
    method: item?.method || 'POST',
    enabled: item ? item.enabled : true,
    responseMode: item?.responseMode || 'ok',
    responseFields: (item?.responseFields || []).join(', '),
    captureLead: item ? item.captureLead : true,
    leadType: item?.leadType || 'other',
    timeoutMs: item?.timeoutMs || 10000,
    rateMax: item?.rateLimit?.max ?? 20,
  }));
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e?.preventDefault();
    setBusy(true);
    try {
      const payload = {
        label: form.label,
        note: form.note,
        method: form.method,
        enabled: !!form.enabled,
        responseMode: form.responseMode,
        responseFields: form.responseFields.split(',').map(s => s.trim()).filter(Boolean),
        captureLead: !!form.captureLead,
        leadType: form.leadType,
        timeoutMs: Number(form.timeoutMs),
        rateLimit: { max: Number(form.rateMax) },
      };
      // An empty URL on an edit means "leave it as it is" — the field is blank
      // because the current value is deliberately never sent to the browser.
      if (form.url) payload.url = form.url.trim();
      if (item) {
        await api.patch(`/integrations/${item.slug}`, payload);
      } else {
        if (!form.url) throw new Error('An endpoint URL is required');
        await api.post('/integrations', { ...payload, slug: form.slug, url: form.url.trim() });
      }
      toast.success('Saved');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{item ? `Edit “${item.label || item.slug}”` : 'New integration'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={submit} className="grid gap-4">
            <FieldRow>
              <Field label="Name">
                {id => (
                  <Input id={id} value={form.label} autoFocus onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
                )}
              </Field>
              <Field
                label="Public path"
                hint={item ? 'Fixed — the pages call this.' : 'Lowercase, hyphens. Becomes /api/v1/hooks/…'}
              >
                {id => (
                  <Input
                    id={id}
                    mono
                    value={form.slug}
                    disabled={!!item}
                    onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
                  />
                )}
              </Field>
            </FieldRow>

            <Field label="Note" hint="Which form this serves, and who owns the automation behind it.">
              {id => <Input id={id} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />}
            </Field>

            <Field
              label="Endpoint URL"
              hint={item
                ? `Currently ${item.upstreamHost}${item.upstreamPathHint}. Leave blank to keep it — the full URL is never sent to this screen.`
                : 'The address the server will call. Must be a public https URL.'}
            >
              {id => (
                <Input
                  id={id}
                  mono
                  value={form.url}
                  placeholder={item ? '•••••••••••••••••••' : 'https://…'}
                  onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                />
              )}
            </Field>

            <FieldRow>
              <Field label="Method">
                {id => (
                  <Select
                    id={id}
                    value={form.method}
                    options={['POST', 'GET', 'PUT', 'PATCH']}
                    onChange={e => setForm(f => ({ ...f, method: e.target.value }))}
                  />
                )}
              </Field>
              <Field label="Give up after" hint="Milliseconds.">
                {id => (
                  <Input
                    id={id}
                    type="number"
                    value={form.timeoutMs}
                    onChange={e => setForm(f => ({ ...f, timeoutMs: e.target.value }))}
                  />
                )}
              </Field>
            </FieldRow>

            <Field label="What the page is told back" hint="Nothing is ever passed through wholesale.">
              {id => (
                <Select
                  id={id}
                  value={form.responseMode}
                  onChange={e => setForm(f => ({ ...f, responseMode: e.target.value }))}
                >
                  <option value="ok">Only whether it worked</option>
                  <option value="fields">That, plus specific fields</option>
                </Select>
              )}
            </Field>
            {form.responseMode === 'fields' && (
              <Field
                label="Fields to pass through"
                hint="Comma separated. Only these keys are copied out of the reply — e.g. slots, reference, message."
              >
                {id => (
                  <Input
                    id={id}
                    mono
                    value={form.responseFields}
                    onChange={e => setForm(f => ({ ...f, responseFields: e.target.value }))}
                  />
                )}
              </Field>
            )}

            <CheckboxField
              label="Store each submission as a lead first"
              hint="A submission then survives the automation being down, mid-deploy or misconfigured. Leave it on for anything a human filled in; turn it off for lookups, where nobody has asked for anything yet."
              checked={form.captureLead}
              onChange={v => setForm(f => ({ ...f, captureLead: v }))}
            />
            {form.captureLead && (
              <Field label="File leads as">
                {id => (
                  <Select
                    id={id}
                    value={form.leadType}
                    options={LEAD_TYPES}
                    onChange={e => setForm(f => ({ ...f, leadType: e.target.value }))}
                  />
                )}
              </Field>
            )}

            <FieldRow>
              <Field label="Max requests per visitor" hint="Per ten minutes. 0 removes the per-endpoint limit.">
                {id => (
                  <Input
                    id={id}
                    type="number"
                    value={form.rateMax}
                    onChange={e => setForm(f => ({ ...f, rateMax: e.target.value }))}
                  />
                )}
              </Field>
              <CheckboxField
                label="Accepting requests"
                hint="Off returns a clean error and keeps storing leads."
                checked={!!form.enabled}
                onChange={v => setForm(f => ({ ...f, enabled: v }))}
                className="self-end pb-2"
              />
            </FieldRow>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
