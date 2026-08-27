/*
 * ExperimentDetail — one test: how it is set up, what it is attached to, and
 * what it has found.
 *
 * The tab that justifies this screen existing is **Attached to**. The previous
 * A/B feature had no way to see what a test was changing and no way to take it
 * off, so a page that entered a test could not leave it: nothing cleared the
 * reference, and deleting the test left the page pointing at a key that no
 * longer resolved. Every destructive action here says what it will touch before
 * it touches it, and the list it shows is the same list the API acts on.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Copy, Flag, Link2Off, Pause, Play, Plus, Save, Trash2,
} from 'lucide-react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import ExperimentResults from '../components/ExperimentResults.jsx';
import {
  Badge, Button, Callout, Card, CardContent, CardDescription, CardHeader, CardTitle, Code,
  Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, Empty, ErrorBox,
  Field, FieldRow, Input, PageHeader, Select, Spinner, StatusBadge, Table, TBody, THead, TRow,
  Tabs, TabsContent, TabsList, TabsTrigger, Textarea, Tooltip, useConfirm,
} from '../components/ui/index.js';

export default function ExperimentDetail() {
  const { key } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useAuth();

  const [tab, setTab] = useState('results');
  const [locale, setLocale] = useState(null);

  const { data, loading, error, reload } = useResource(`/experiments/${key}`);
  const attachments = useResource(`/experiments/${key}/attachments`);
  const results = useResource(
    `/experiments/${key}/results${locale ? `?locale=${locale}` : ''}`,
    [locale],
  );

  const experiment = data?.item;

  if (loading) return <Spinner label="Loading test…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!experiment) return null;

  const refresh = () => { reload(); attachments.reload(); results.reload(); };

  async function act(path, body, message) {
    try {
      const res = await api.post(`/experiments/${key}${path}`, body);
      toast.success(res?.note || message);
      refresh();
      return res;
    } catch (err) {
      toast.error(err);
      return null;
    }
  }

  async function detach() {
    const a = attachments.data;
    const ok = await confirm({
      title: 'Take this test off everything?',
      body: (
        <>
          The test record stays, with its results. What stops is the varying:
          <AttachmentSummary attachments={a} />
          {a?.arms?.length > 0 && (
            <p className="mt-2">
              Its {a.arms.length} variant page{a.arms.length === 1 ? '' : 's'} will be kept as
              ordinary drafts at a real URL rather than deleted — nothing you built is thrown away.
            </p>
          )}
        </>
      ),
      confirmLabel: 'Detach',
    });
    if (!ok) return;
    await act('/detach', { arms: 'keep' }, 'Detached. Every page is back to its control content.');
  }

  async function remove() {
    const a = attachments.data;
    const ok = await confirm({
      title: `Delete “${experiment.name}”?`,
      body: (
        <>
          <AttachmentSummary attachments={a} />
          <p className="mt-2">
            The measurements are <strong>kept</strong>: deleting a test should not destroy the
            evidence for whatever was shipped because of it.
          </p>
        </>
      ),
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.del(`/experiments/${key}?arms=keep`);
      toast.success('Deleted');
      navigate('/experiments');
    } catch (err) {
      toast.error(err);
    }
  }

  const attached = attachments.data;
  const nothingAttached = attached
    && !attached.controls.length && !attached.blocks.length && !attached.chrome.length;

  return (
    <>
      <PageHeader
        title={experiment.name}
        description={experiment.hypothesis || 'No hypothesis was written for this test.'}
      >
        <Button variant="ghost" onClick={() => navigate('/experiments')}><ArrowLeft /> All tests</Button>
        {can('editor') && experiment.status === 'running' && (
          <Button variant="outline" onClick={() => act('/pause', {}, 'Paused')}><Pause /> Pause</Button>
        )}
        {can('editor') && experiment.status !== 'running' && experiment.status !== 'finished' && (
          <Button onClick={() => act('/start', {}, 'Running')}><Play /> Start</Button>
        )}
        {can('editor') && experiment.status === 'running' && (
          <FinishButton experiment={experiment} results={results.data} onDone={refresh} />
        )}
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={experiment.status} />
        <Code>{experiment.key}</Code>
        {experiment.winner && <Badge variant="success">winner: {experiment.winner}</Badge>}
        {experiment.targeting?.allocation < 100 && (
          <Badge variant="warning">{experiment.targeting.allocation}% of traffic</Badge>
        )}
        {experiment.targeting?.locales?.length > 0 && (
          <Badge variant="outline">{experiment.targeting.locales.join(', ')} only</Badge>
        )}
      </div>

      {nothingAttached && experiment.status !== 'finished' && (
        <Callout tone="warning" className="mb-4">
          <strong>Nothing is using this test.</strong> Attach it to a block from a page&apos;s
          Design tab, to a whole page from that page&apos;s A/B tab, or to the header or footer
          under <Code>Header &amp; footer</Code>. Until then it would split traffic between two
          identical experiences.
        </Callout>
      )}

      {experiment.status !== 'draft' && !experiment.goals?.length && (
        <Callout tone="warning" className="mb-4">
          This test has no goal, so nothing but exposure is being counted.
        </Callout>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="goals">Goals</TabsTrigger>
          <TabsTrigger value="attached">
            Attached to
            {attached && (
              <Badge variant="outline" className="ml-1.5">
                {attached.controls.length + attached.blocks.length + attached.chrome.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="results">
          {results.loading ? <Spinner /> : (
            <ExperimentResults
              results={results.data}
              experiment={experiment}
              locale={locale}
              onLocale={setLocale}
              locales={experiment.targeting?.locales?.length ? experiment.targeting.locales : ['fr', 'en', 'de']}
            />
          )}
        </TabsContent>

        <TabsContent value="setup">
          <Setup experiment={experiment} onSaved={refresh} canEdit={can('editor')} />
        </TabsContent>

        <TabsContent value="goals">
          <Goals experiment={experiment} onSaved={refresh} canEdit={can('editor')} />
        </TabsContent>

        <TabsContent value="attached">
          <Attached
            attachments={attached}
            loading={attachments.loading}
            onDetach={detach}
            canEdit={can('editor')}
          />
        </TabsContent>
      </Tabs>

      {can('editor') && (
        <div className="mt-6 flex gap-2 border-t pt-4">
          <Button variant="outline" onClick={async () => {
            const res = await api.post(`/experiments/${key}/duplicate`).catch(err => { toast.error(err); return null; });
            if (res) navigate(`/experiments/${res.item.key}`);
          }}
          >
            <Copy /> Duplicate
          </Button>
          <span className="grow" />
          <Button variant="outline" onClick={detach}><Link2Off /> Detach from everything</Button>
          <Button variant="destructive" onClick={remove}><Trash2 /> Delete</Button>
        </div>
      )}
    </>
  );
}

/** A plain-English list of what a test currently changes. */
function AttachmentSummary({ attachments }) {
  if (!attachments) return <p>Checking what this test is attached to…</p>;
  const bits = [];
  if (attachments.controls.length) bits.push(`${attachments.controls.length} page(s) it varies as a whole`);
  if (attachments.blocks.length) bits.push(`${attachments.blocks.length} block(s)`);
  if (attachments.chrome.length) bits.push(`${attachments.chrome.length} header/footer part(s)`);
  if (!bits.length) return <p>Nothing is currently using it.</p>;
  return (
    <ul className="mt-2 list-disc pl-5">
      {bits.map(b => <li key={b}>{b}</li>)}
    </ul>
  );
}

/* ── Setup ────────────────────────────────────────────────────────────────── */

function Setup({ experiment, onSaved, canEdit }) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    name: experiment.name,
    hypothesis: experiment.hypothesis || '',
    mode: experiment.mode,
    paramName: experiment.paramName,
    allocation: experiment.targeting?.allocation ?? 100,
    locales: (experiment.targeting?.locales || []).join(','),
    variants: experiment.variants.map(v => ({ ...v })),
    minExposuresPerArm: experiment.guardrails?.minExposuresPerArm ?? 1000,
    minRuntimeHours: experiment.guardrails?.minRuntimeHours ?? 168,
    confidenceTarget: experiment.guardrails?.confidenceTarget ?? 95,
  }));
  const [busy, setBusy] = useState(false);
  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const running = experiment.status === 'running';

  const setVariant = (i, patch) => setForm((f) => {
    const variants = f.variants.slice();
    variants[i] = { ...variants[i], ...patch };
    // Exactly one control: marking a new one has to clear the old, or the
    // baseline becomes whichever the server happens to find first.
    if (patch.isControl) variants.forEach((v, idx) => { v.isControl = idx === i; });
    return { ...f, variants };
  });

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/experiments/${experiment.key}`, {
        name: form.name,
        hypothesis: form.hypothesis,
        mode: form.mode,
        paramName: form.paramName,
        targeting: {
          allocation: Number(form.allocation),
          locales: form.locales.split(',').map(s => s.trim()).filter(Boolean),
        },
        variants: form.variants.map(v => ({
          key: v.key, label: v.label || '', weight: Number(v.weight), isControl: !!v.isControl,
        })),
        guardrails: {
          minExposuresPerArm: Number(form.minExposuresPerArm),
          minRuntimeHours: Number(form.minRuntimeHours),
          confidenceTarget: Number(form.confidenceTarget),
        },
      });
      toast.success('Saved');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>What is being tested</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="Name">
            {id => <Input id={id} value={form.name} onChange={set('name')} disabled={!canEdit} />}
          </Field>
          <Field label="Hypothesis" hint="What you expected, and why. This is what a finished test is worth reading for.">
            {id => <Textarea id={id} rows={3} value={form.hypothesis} onChange={set('hypothesis')} disabled={!canEdit} />}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Arms and split</CardTitle>
          <CardDescription>
            Assignment is a pure function of the visitor and this test&apos;s salt, so a returning
            visitor always lands in the same arm — and changing the weights below re-draws the
            boundary between arms without reshuffling anybody who is already in one.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {running && (
            <Callout tone="warning">
              The test is running, so the arms and weights are locked. Visitors already counted
              were assigned under the current split; changing it now would pool two populations
              into one number that describes neither. Pause it first.
            </Callout>
          )}
          {form.variants.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input mono className="w-16" value={v.key} aria-label={`Arm ${i + 1} key`}
                disabled={running || !canEdit}
                onChange={e => setVariant(i, { key: e.target.value })}
              />
              <Input className="grow" value={v.label || ''} placeholder="Label" aria-label={`Arm ${i + 1} label`}
                disabled={!canEdit}
                onChange={e => setVariant(i, { label: e.target.value })}
              />
              <div className="relative w-24">
                <Input type="number" min="0" max="100" className="pr-6" value={v.weight}
                  aria-label={`Arm ${i + 1} weight`} disabled={running || !canEdit}
                  onChange={e => setVariant(i, { weight: e.target.value })}
                />
                <span className="text-muted-foreground absolute top-1/2 right-2.5 -translate-y-1/2 text-[12px]">%</span>
              </div>
              <Tooltip content="The baseline every other arm is measured against.">
                <Button
                  variant={v.isControl ? 'default' : 'outline'}
                  size="sm"
                  disabled={running || !canEdit}
                  onClick={() => setVariant(i, { isControl: true })}
                >
                  <Flag /> Control
                </Button>
              </Tooltip>
              <Button
                variant="ghost" size="icon-sm"
                disabled={form.variants.length <= 2 || running || !canEdit}
                aria-label={`Remove arm ${v.key}`}
                onClick={() => setForm(f => ({ ...f, variants: f.variants.filter((_, idx) => idx !== i) }))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            variant="outline" size="sm" className="justify-self-start"
            disabled={running || !canEdit}
            onClick={() => setForm(f => ({
              ...f,
              variants: [...f.variants, { key: String.fromCharCode(65 + f.variants.length), label: '', weight: 0, isControl: false }],
            }))}
          >
            <Plus /> Add arm
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Who enters the test</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <FieldRow>
            <Field
              label="Share of traffic"
              hint="Visitors outside this share see the control and are never counted. Ramping a risky change to 10% first is what makes a bad idea cost a tenth as much."
            >
              {id => (
                <div className="relative">
                  <Input id={id} type="number" min="1" max="100" className="pr-6"
                    value={form.allocation} onChange={set('allocation')} disabled={!canEdit}
                  />
                  <span className="text-muted-foreground absolute top-1/2 right-2.5 -translate-y-1/2 text-[12px]">%</span>
                </div>
              )}
            </Field>
            <Field label="Languages" hint="Comma-separated, e.g. fr,de. Empty means every language.">
              {id => <Input id={id} mono value={form.locales} onChange={set('locales')} disabled={!canEdit} placeholder="all" />}
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Assignment">
              {id => (
                <Select id={id} value={form.mode} onChange={set('mode')} disabled={!canEdit}>
                  <option value="cookie">Split traffic — the normal case</option>
                  <option value="param">URL parameter — ad landing pages, never indexed</option>
                </Select>
              )}
            </Field>
            {form.mode === 'param' && (
              <Field label="Parameter" hint={`Entry points become ?${form.paramName}=B`}>
                {id => <Input id={id} mono value={form.paramName} onChange={set('paramName')} disabled={!canEdit} />}
              </Field>
            )}
          </FieldRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>When the result may be believed</CardTitle>
          <CardDescription>
            The results screen refuses to name a winner until all three are met. They are here so
            the decision is made before the numbers exist, which is the only time it can be made
            honestly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldRow>
            <Field label="Visitors per arm" hint="The smallest arm must reach this.">
              {id => <Input id={id} type="number" min="0" value={form.minExposuresPerArm} onChange={set('minExposuresPerArm')} disabled={!canEdit} />}
            </Field>
            <Field label="Hours running" hint="168 is a full week. A test that skips a weekend has measured weekdays.">
              {id => <Input id={id} type="number" min="0" value={form.minRuntimeHours} onChange={set('minRuntimeHours')} disabled={!canEdit} />}
            </Field>
            <Field label="Confidence" hint="95% is the convention. Below 90% you are reading noise.">
              {id => <Input id={id} type="number" min="50" max="99.9" step="0.5" value={form.confidenceTarget} onChange={set('confidenceTarget')} disabled={!canEdit} />}
            </Field>
          </FieldRow>
        </CardContent>
      </Card>

      {canEdit && (
        <div>
          <Button onClick={save} disabled={busy}><Save /> Save setup</Button>
        </div>
      )}
    </div>
  );
}

/* ── Goals ────────────────────────────────────────────────────────────────── */

const GOAL_TYPES = [
  { value: 'form', label: 'A form is submitted' },
  { value: 'click', label: 'An element is clicked' },
  { value: 'pageview', label: 'A page is reached' },
  { value: 'custom', label: 'The site reports a custom event' },
];

function Goals({ experiment, onSaved, canEdit }) {
  const toast = useToast();
  const [goals, setGoals] = useState(() => (experiment.goals || []).map(g => ({ ...g })));
  const [busy, setBusy] = useState(false);
  const forms = useResource('/forms');

  const setGoal = (i, patch) => setGoals((list) => {
    const next = list.slice();
    next[i] = { ...next[i], ...patch };
    if (patch.primary) next.forEach((g, idx) => { g.primary = idx === i; });
    return next;
  });

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/experiments/${experiment.key}`, {
        goals: goals.map(g => ({
          key: g.key, name: g.name || g.key, type: g.type,
          formKey: g.formKey || '', selector: g.selector || '',
          urlPattern: g.urlPattern || '', eventName: g.eventName || '',
          primary: !!g.primary,
        })),
      });
      toast.success('Goals saved');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <Callout>
        One goal decides the test; the rest are there to notice damage. An arm that lifts
        newsletter sign-ups and halves demo requests has not won, and a test with only the first
        metric on it would say it had.
      </Callout>

      {!goals.length && (
        <Card>
          <CardContent>
            <Empty icon={Flag} title="No goals yet">
              A test cannot be started without one — deciding what counts as success once the
              numbers are in is how tests get talked into having won.
            </Empty>
          </CardContent>
        </Card>
      )}

      {goals.map((g, i) => (
        <Card key={i}>
          <CardContent className="grid gap-3 pt-4">
            <FieldRow>
              <Field label="Name">
                {id => <Input id={id} value={g.name || ''} onChange={e => setGoal(i, { name: e.target.value })} disabled={!canEdit} placeholder="Demo requested" />}
              </Field>
              <Field label="Key" hint="Stored with the counts, so it cannot change once data exists.">
                {id => <Input id={id} mono value={g.key} onChange={e => setGoal(i, { key: e.target.value })} disabled={!canEdit} />}
              </Field>
              <Field label="Counted when">
                {id => (
                  <Select id={id} value={g.type} onChange={e => setGoal(i, { type: e.target.value })} disabled={!canEdit}>
                    {GOAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </Select>
                )}
              </Field>
            </FieldRow>

            {g.type === 'form' && (
              <Field label="Which form" hint="Leave empty to count any form on the page. Naming one is almost always what you want.">
                {id => (
                  <Select id={id} value={g.formKey || ''} onChange={e => setGoal(i, { formKey: e.target.value })} disabled={!canEdit}
                    placeholder="Any form"
                    options={(forms.data?.items || []).map(f => ({ value: f.key, label: `${f.name} (${f.key})` }))}
                  />
                )}
              </Field>
            )}
            {g.type === 'click' && (
              <Field label="CSS selector" hint="Counted once per visitor, on the first matching click.">
                {id => <Input id={id} mono value={g.selector || ''} onChange={e => setGoal(i, { selector: e.target.value })} disabled={!canEdit} placeholder="a[href*='/booking']" />}
              </Field>
            )}
            {g.type === 'pageview' && (
              <Field label="Path" hint="A * matches anything. Nothing else is a wildcard.">
                {id => <Input id={id} mono value={g.urlPattern || ''} onChange={e => setGoal(i, { urlPattern: e.target.value })} disabled={!canEdit} placeholder="/fr/merci*" />}
              </Field>
            )}
            {g.type === 'custom' && (
              <Field label="Event name" hint={`The site calls window.rainbowAB.track('${g.eventName || 'name'}')`}>
                {id => <Input id={id} mono value={g.eventName || ''} onChange={e => setGoal(i, { eventName: e.target.value })} disabled={!canEdit} />}
              </Field>
            )}

            <div className="flex items-center gap-2">
              <Button
                variant={g.primary ? 'default' : 'outline'} size="sm"
                disabled={!canEdit} onClick={() => setGoal(i, { primary: true })}
              >
                <Flag /> {g.primary ? 'Primary goal' : 'Make primary'}
              </Button>
              <span className="grow" />
              <Button variant="ghost" size="sm" disabled={!canEdit}
                onClick={() => setGoals(list => list.filter((_, idx) => idx !== i))}
              >
                <Trash2 /> Remove
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {canEdit && (
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setGoals(list => [...list, {
            key: `goal-${list.length + 1}`, name: '', type: 'form', primary: !list.length,
          }])}
          >
            <Plus /> Add goal
          </Button>
          <span className="grow" />
          <Button onClick={save} disabled={busy}><Save /> Save goals</Button>
        </div>
      )}
    </div>
  );
}

/* ── Attached to ──────────────────────────────────────────────────────────── */

function Attached({ attachments, loading, onDetach, canEdit }) {
  if (loading) return <Spinner />;
  if (!attachments) return null;

  const { controls, arms, blocks, chrome } = attachments;
  const total = controls.length + blocks.length + chrome.length;

  if (!total) {
    return (
      <Card>
        <CardContent>
          <Empty icon={Link2Off} title="Not attached to anything">
            This test changes nothing at the moment. Attach it from a page&apos;s Design tab
            (one block), a page&apos;s A/B tab (the whole page), or Header &amp; footer.
          </Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {controls.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Whole-page test</CardTitle>
            <CardDescription>
              These pages serve an alternative document at their own URL. The arms below have no
              URL of their own, which is what keeps one canonical address and nothing duplicate
              in the index.
            </CardDescription>
          </CardHeader>
          <Table>
            <THead><tr><th>Page</th><th>URL</th><th>Arm</th><th>Status</th></tr></THead>
            <TBody>
              {controls.map(p => (
                <TRow key={p.key}>
                  <td className="font-medium">{p.title}</td>
                  <td><Code>/{p.route}</Code></td>
                  <td><Badge variant="outline">{p.variant} · control</Badge></td>
                  <td><StatusBadge status={p.status} /></td>
                </TRow>
              ))}
              {arms.map(p => (
                <TRow key={p.key}>
                  <td className="text-muted-foreground pl-6">{p.title}</td>
                  <td className="text-muted-foreground text-[12px]">no URL of its own</td>
                  <td><Badge variant="primary">{p.variant}</Badge></td>
                  <td><StatusBadge status={p.status} /></td>
                </TRow>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {blocks.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Blocks</CardTitle></CardHeader>
          <Table>
            <THead><tr><th>Page</th><th>Block</th><th>Arms defined</th></tr></THead>
            <TBody>
              {blocks.map(b => (
                <TRow key={`${b.pageKey}:${b.sectionKey}`}>
                  <td className="font-medium">{b.pageTitle}</td>
                  <td>{b.label} <Code>{b.sectionKey}</Code></td>
                  <td className="tabular-nums">{b.variants}</td>
                </TRow>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {chrome.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Header and footer</CardTitle>
            <CardDescription>
              A chrome test runs on every page, so it reaches a usable sample far faster than one
              page&apos;s traffic would — and for the same reason it makes the whole site
              uncacheable while it runs.
            </CardDescription>
          </CardHeader>
          <Table>
            <THead><tr><th>Part</th></tr></THead>
            <TBody>
              {chrome.map((c, i) => (
                <TRow key={i}><td>{c.label || c.key || c.part}</td></TRow>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {canEdit && (
        <div>
          <Button variant="outline" onClick={onDetach}>
            <Link2Off /> Take this test off everything above
          </Button>
        </div>
      )}
    </div>
  );
}

/* ── Finishing ────────────────────────────────────────────────────────────── */

/**
 * Finishing and promoting are one action on purpose.
 *
 * Done by hand they are two, and the second is the one that gets forgotten: the
 * test is switched off, every visitor goes back to the control, and the change
 * that won is quietly lost. That is a real and common way for a whole quarter
 * of experimentation to produce nothing.
 */
function FinishButton({ experiment, results, onDone }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [winner, setWinner] = useState(() => results?.readiness?.leader || '');
  const [conclusion, setConclusion] = useState('');
  const [promote, setPromote] = useState(true);
  const [busy, setBusy] = useState(false);

  const ready = results?.readiness?.ready;

  async function submit() {
    setBusy(true);
    try {
      const res = await api.post(`/experiments/${experiment.key}/finish`, {
        winner: winner || null,
        conclusion,
        promote: promote && !!winner,
      });
      toast.success(res.promoted?.length
        ? `Finished. ${res.promoted.length} place(s) now show “${winner}”.`
        : 'Finished.');
      setOpen(false);
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><Flag /> Finish</Button>
      {open && (
        <Dialog open onOpenChange={(next) => { if (!next) setOpen(false); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Finish this test</DialogTitle></DialogHeader>
            <DialogBody className="grid gap-4">
              {!ready && (
                <Callout tone="warning">
                  This test has not met the conditions it was set up with. Finishing it now is a
                  decision to stop, which is often the right one — but whatever you record here
                  is not a result, and the next person will read it as one unless you say so
                  below.
                </Callout>
              )}
              <Field label="Winning arm" hint="Leave empty if nothing won. That is a real and useful outcome.">
                {id => (
                  <Select id={id} value={winner} onChange={e => setWinner(e.target.value)} placeholder="No winner">
                    {experiment.variants.map(v => (
                      <option key={v.key} value={v.key}>{v.label || v.key}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="What you concluded" hint="Read later by whoever proposes the same idea again.">
                {id => <Textarea id={id} rows={3} value={conclusion} onChange={e => setConclusion(e.target.value)} />}
              </Field>
              {winner && (
                <label className="flex items-start gap-2 text-[12.5px]">
                  <input type="checkbox" checked={promote} onChange={e => setPromote(e.target.checked)} className="mt-0.5" />
                  <span>
                    <strong>Keep the winning content.</strong> Copies this arm&apos;s markup or
                    field overrides onto the live block or page and removes the split, so what won
                    is what ships. A restore point is written first.
                  </span>
                </label>
              )}
            </DialogBody>
            <DialogFooter>
              <span className="grow" />
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={busy}>Finish test</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
