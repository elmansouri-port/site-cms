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
 * Creating a test asks two questions, and the rest are optional.
 *
 * It used to ask for a **key** — a slug matching `^[a-z0-9-]+$`, with the note
 * "it cannot change later". That is a database concern presented as a decision:
 * the interface generated it from the name anyway, and the only thing asking
 * achieved was a form that could fail validation on a field nobody meant to
 * touch. It is derived now, and two tests with the same name get `-2` rather
 * than a conflict about a field the editor never filled in.
 *
 * What is still asked, and why each one is here rather than later:
 *
 *   - **What are you testing** — the name, and the only required answer.
 *   - **What varies** — a block, a whole page, or the header and footer. This
 *     decides which screen the test is attached from, so asking afterwards would
 *     mean asking on the wrong screen.
 *   - **What counts as a win** — offered here rather than deferred, because a
 *     test with no goal measures nothing and cannot be started. It was the thing
 *     everybody had to come back for.
 *   - **Why you expect it** — the hypothesis, optional and last. It is the field
 *     nobody fills in afterwards and the one that makes a finished test worth
 *     reading a year later, so it is offered now and not demanded.
 *
 * The key is still settable, behind a disclosure, for when a report somewhere
 * else already names a particular one.
 */
function NewExperiment({ onClose, onCreated }) {
  const toast = useToast();
  const navigate = useNavigate();
  const forms = useResource('/forms');
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [form, setForm] = useState({
    name: '', key: '', hypothesis: '', scope: 'block', goalType: 'form', formKey: '', selector: '',
  });
  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  // Shown as a placeholder, not asked for. Only sent if somebody opened
  // Advanced and typed one.
  const suggested = form.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

  /**
   * The goal, if one is answerable yet.
   *
   * A click goal needs a selector and a form goal needs a form, so a goal that
   * is only half-chosen is left off rather than saved incomplete — the test's own
   * Goals tab is a better place to finish it than a dialog is.
   */
  function goalOf() {
    if (form.goalType === 'form') {
      if (!form.formKey) return null;
      const named = (forms.data?.items || []).find(x => x.key === form.formKey);
      return {
        key: 'primary',
        name: `${named?.name || form.formKey} submitted`,
        type: 'form',
        formKey: form.formKey,
        primary: true,
      };
    }
    if (form.goalType === 'click') {
      if (!form.selector.trim()) return null;
      return {
        key: 'primary',
        name: 'Call to action clicked',
        type: 'click',
        selector: form.selector.trim(),
        primary: true,
      };
    }
    return null;
  }

  async function submit(e) {
    e?.preventDefault();
    setBusy(true);
    try {
      const goal = goalOf();
      const { item } = await api.post('/experiments', {
        name: form.name,
        // Sent only when it was deliberately set. Otherwise the API derives it,
        // and derives a free one rather than colliding.
        ...(advanced && form.key ? { key: form.key } : {}),
        hypothesis: form.hypothesis,
        scope: form.scope,
        status: 'draft',
        ...(goal ? { goals: [goal] } : {}),
      });
      toast.success(goal
        ? 'Created as a draft — attach it to a block, then start it'
        : 'Created as a draft — add a goal before starting it');
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
            <Field label="What are you testing?" hint="Shows in the list and in every report.">
              {id => (
                <Input
                  id={id}
                  value={form.name}
                  onChange={set('name')}
                  autoFocus
                  placeholder="Pricing page headline"
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

            <FieldRow>
              <Field
                label="What counts as a win"
                hint="A test cannot be started without one. Changeable later."
              >
                {id => (
                  <Select id={id} value={form.goalType} onChange={set('goalType')}>
                    <option value="form">A form is submitted</option>
                    <option value="click">An element is clicked</option>
                    <option value="none">Decide later</option>
                  </Select>
                )}
              </Field>

              {form.goalType === 'form' && (
                <Field label="Which form" hint="Every form on the site, by name.">
                  {id => (
                    <Select id={id} value={form.formKey} onChange={set('formKey')}>
                      <option value="">Choose a form…</option>
                      {(forms.data?.items || []).map(f => (
                        <option key={f.key} value={f.key}>{f.name || f.key}</option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}

              {form.goalType === 'click' && (
                <Field label="Which element" hint="A CSS selector, e.g. #demo-cta or .pricing-card a.">
                  {id => (
                    <Input id={id} mono value={form.selector} onChange={set('selector')} placeholder="#demo-cta" />
                  )}
                </Field>
              )}
            </FieldRow>

            <Field
              label="Why do you expect it to work?"
              hint="Optional. Written now, it is what makes the result mean something later."
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

            {advanced ? (
              <Field
                label="Key"
                hint="Fixes the bucketing and appears in reports. It cannot change later. Leave it alone unless a report elsewhere already names one."
              >
                {id => (
                  <Input
                    id={id}
                    mono
                    value={form.key}
                    placeholder={suggested || 'derived-from-the-name'}
                    onChange={set('key')}
                  />
                )}
              </Field>
            ) : (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground justify-self-start text-[12px] underline"
                onClick={() => setAdvanced(true)}
              >
                Set the key myself
              </button>
            )}
          </form>
        </DialogBody>
        <DialogFooter>
          <span className="grow" />
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !form.name.trim()}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
