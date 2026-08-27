/*
 * Experiments — every A/B test, and how far each one is from an answer.
 *
 * The list deliberately does not show a conversion rate. A rate in a table is
 * read as a result, and most of the tests on this screen at any moment do not
 * have one yet — so the column that matters here is how much traffic each test
 * has collected against what it needs, and whether anything is wrong with it.
 * The verdict lives one click away, next to the conditions it depends on.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FlaskConical, Plus } from 'lucide-react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Badge, Button, Card, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader,
  DialogTitle, Empty, ErrorBox, Field, FieldRow, Input, PageHeader, Select, SkeletonRows,
  StatusBadge, TBody, THead, TRow, Table, Textarea, Tooltip, formatDate,
} from '../components/ui/index.js';

export default function Experiments() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useResource('/experiments');
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="A/B tests"
        description="Arms are chosen on the server before the page renders, so a visitor never sees a flash of the control and a crawler sees an ordinary page."
      >
        {can('editor') && <Button onClick={() => setCreating(true)}><Plus /> New test</Button>}
      </PageHeader>

      <Card>
        {loading && <SkeletonRows rows={4} cols={6} />}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {data && !data.items.length && (
          <Empty icon={FlaskConical} title="No tests yet">
            Create one, give it a goal, then attach it to a block from a page&apos;s Design tab —
            or to a whole page from that page&apos;s A/B tab.
          </Empty>
        )}
        {data?.items?.length > 0 && (
          <Table>
            <THead>
              <tr>
                <th>Test</th><th>Varies</th><th>Split</th>
                <th className="text-right">Visitors</th><th>Goal</th><th>Status</th><th>Started</th>
              </tr>
            </THead>
            <TBody>
              {data.items.map(x => (
                <TRow key={x.key} interactive>
                  <td>
                    <Link to={`/experiments/${x.key}`} className="font-semibold hover:underline">
                      {x.name}
                    </Link>
                    <div className="text-muted-foreground font-mono text-[11.5px]">{x.key}</div>
                  </td>
                  <td>
                    <Badge variant={x.scope === 'page' ? 'primary' : 'default'}>{SCOPE_LABEL[x.scope] || x.scope}</Badge>
                    {x.pageKey && <div className="text-muted-foreground mt-0.5 font-mono text-[11px]">{x.pageKey}</div>}
                  </td>
                  <td className="text-muted-foreground whitespace-nowrap text-[12px]">
                    {x.variants.map(v => `${v.key} ${v.weight}%`).join(' · ')}
                    {x.targeting?.allocation < 100 && (
                      <Tooltip content={`Only ${x.targeting.allocation}% of visitors enter this test at all. The rest see the control and are not counted.`}>
                        <Badge variant="warning" className="ml-1.5">{x.targeting.allocation}% of traffic</Badge>
                      </Tooltip>
                    )}
                  </td>
                  <td className="text-right tabular-nums">
                    {x.exposures ? x.exposures.toLocaleString() : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="text-muted-foreground text-[12px]">
                    {x.goals?.length
                      ? (x.goals.find(g => g.primary) || x.goals[0]).name || (x.goals.find(g => g.primary) || x.goals[0]).key
                      : (
                        <Tooltip content="A test with no goal measures nothing. It cannot be started until it has one.">
                          <Badge variant="warning">none set</Badge>
                        </Tooltip>
                      )}
                  </td>
                  <td><StatusBadge status={x.status} /></td>
                  <td className="text-muted-foreground whitespace-nowrap">{formatDate(x.startedAt)}</td>
                </TRow>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {creating && (
        <NewExperiment onClose={() => setCreating(false)} onCreated={reload} />
      )}
    </>
  );
}

const SCOPE_LABEL = {
  block: 'a block',
  page: 'whole page',
  chrome: 'header/footer',
};

/**
 * Creating a test asks for four things, and the hypothesis is one of them.
 *
 * Everything else — arms, goals, guardrails, targeting — is on the test's own
 * screen, because those are decisions worth making with the results panel
 * visible next to them. What cannot be deferred is *why* the test exists: it is
 * the field nobody fills in afterwards, and the one that makes a finished test
 * worth reading a year later.
 */
function NewExperiment({ onClose, onCreated }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: '', key: '', hypothesis: '', scope: 'block',
  });
  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  // Suggest the key from the name, but stop the moment somebody edits it: a
  // key that keeps rewriting itself under the cursor is worse than typing one.
  const [keyTouched, setKeyTouched] = useState(false);
  const suggested = form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const key = keyTouched ? form.key : suggested;

  async function submit(e) {
    e?.preventDefault();
    setBusy(true);
    try {
      const { item } = await api.post('/experiments', {
        key,
        name: form.name,
        hypothesis: form.hypothesis,
        scope: form.scope,
        status: 'draft',
        variants: [
          { key: 'A', label: 'Control', weight: 50, isControl: true },
          { key: 'B', label: 'Variant B', weight: 50, isControl: false },
        ],
      });
      toast.success('Created as a draft — add a goal before starting it');
      onCreated?.();
      navigate(`/experiments/${item.key}`);
    } catch (err) {
      toast.error(err);
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>New A/B test</DialogTitle></DialogHeader>
        <DialogBody>
          <form onSubmit={submit} className="grid gap-4">
            <FieldRow>
              <Field label="Name">
                {id => <Input id={id} value={form.name} onChange={set('name')} autoFocus placeholder="Pricing page headline" />}
              </Field>
              <Field label="Key" hint="Fixes the bucketing and appears in reports. It cannot change later.">
                {id => (
                  <Input
                    id={id}
                    mono
                    value={key}
                    onChange={(e) => { setKeyTouched(true); setForm(f => ({ ...f, key: e.target.value })); }}
                  />
                )}
              </Field>
            </FieldRow>

            <Field
              label="Hypothesis"
              hint="What you expect to happen, and why. Written now, it is what makes the result mean something later."
            >
              {id => (
                <Textarea
                  id={id}
                  rows={3}
                  value={form.hypothesis}
                  onChange={set('hypothesis')}
                  placeholder="Leading with the price rather than the feature list will raise demo requests, because visitors arriving from search already know what the product does."
                />
              )}
            </Field>

            <Field label="What varies" hint="You attach the test to the actual block or page afterwards.">
              {id => (
                <Select id={id} value={form.scope} onChange={set('scope')}>
                  <option value="block">One block on a page</option>
                  <option value="page">A whole alternative page, at the same URL</option>
                  <option value="chrome">The header or footer — runs on every page</option>
                </Select>
              )}
            </Field>
          </form>
        </DialogBody>
        <DialogFooter>
          <span className="grow" />
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !form.name || !key}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
