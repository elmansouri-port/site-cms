/*
 * ExperimentResults — what the test found, and whether that may be believed.
 *
 * The design rule for this screen: nothing may look like a verdict until it is
 * one. A conversion rate with a green arrow beside it *will* be acted on, so
 * the guardrails are not a footnote below the table — they are the first thing
 * on the panel, and the winner is not named until they are met.
 *
 * The other rule: never show a lift without its interval. "+18%" is a number
 * anybody can repeat in a meeting; "+18% (−6% to +42%)" is the same number with
 * the honesty attached, and it is the version that stops a coin toss becoming a
 * roadmap.
 */
import { Minus, TrendingDown, TrendingUp, Users } from 'lucide-react';
import {
  Badge, Callout, Card, CardHeader, CardTitle, CardDescription, CardContent,
  Empty, Meter, Select, Table, TBody, THead, TRow, Tooltip,
} from './ui/index.js';

const pct = (n, digits = 2) => (n == null ? '—' : `${Number(n).toFixed(digits)}%`);
const num = (n) => (n == null ? '—' : Number(n).toLocaleString());

export default function ExperimentResults({ results, experiment, locale, onLocale, locales = [] }) {
  if (!results) return null;

  const goalKeys = Object.keys(results.goals || {});
  const totalExposures = (results.totals || []).reduce((sum, t) => sum + t.exposures, 0);

  if (!totalExposures) {
    return (
      <Card>
        <CardContent>
          <Empty icon={Users} title="Nothing measured yet">
            {results.status === 'running'
              ? 'The test is running but no visitor has been counted. Exposure is reported by the '
                + 'browser when a page carrying this test is actually shown — if this stays at zero, '
                + 'check that the test is attached to something on a published page.'
              : 'Start the test to begin counting.'}
          </Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <Readiness results={results} experiment={experiment} />

      {results.srm?.mismatch && (
        <Callout tone="danger">
          <strong>Traffic is not splitting the way it was configured.</strong> The arms below
          received {(results.totals || []).map(t => `${t.variant}: ${num(t.exposures)}`).join(', ')},
          which is further from the intended split than chance explains
          (p&nbsp;=&nbsp;{results.srm.pValue.toExponential(1)}). Something is wrong with the test
          itself — a variant erroring before it reports, or a cached response serving one arm to
          traffic assigned to the other. <strong>Do not read the conversion numbers below</strong>{' '}
          until this is resolved; they describe two populations that were not comparable.
        </Callout>
      )}

      {locales.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-[12.5px]">Language</span>
          <Select
            value={locale || ''}
            onChange={e => onLocale(e.target.value || null)}
            className="w-auto"
            placeholder="All languages"
            options={locales.map(l => ({ value: l, label: l.toUpperCase() }))}
          />
          <span className="text-muted-foreground text-[12px]">
            A result that only holds in one language is worth knowing about before it ships to all of them.
          </span>
        </div>
      )}

      {goalKeys.length === 0 && (
        <Callout tone="warning">
          This test has no goals, so nothing is being measured except how many people saw it.
        </Callout>
      )}

      {goalKeys
        // Primary first: it is the one the decision rests on, and burying it
        // under three secondary metrics is how the wrong one gets quoted.
        .sort((a, b) => (results.goals[b].goal.primary ? 1 : 0) - (results.goals[a].goal.primary ? 1 : 0))
        .map(key => (
          <GoalTable key={key} result={results.goals[key]} target={experiment?.guardrails?.confidenceTarget ?? 95} />
        ))}
    </div>
  );
}

/* ── Can this be acted on? ────────────────────────────────────────────────── */

function Readiness({ results, experiment }) {
  const r = results.readiness || {};
  const leaderLabel = (experiment?.variants || []).find(v => v.key === r.leader)?.label || r.leader;

  if (r.ready && r.leader) {
    return (
      <Callout tone="success">
        <strong>{leaderLabel} has won</strong> on the primary goal, at{' '}
        {pct(r.leaderConfidence, 1)} confidence. Every condition set for this test has been met:
        the sample, the runtime and the confidence target. Finish it and promote the arm to keep
        what it changed.
      </Callout>
    );
  }

  if (!r.blockers?.length) {
    return (
      <Callout>
        Running. No arm is ahead of the control by more than chance explains yet.
      </Callout>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[13.5px]">Not ready to call</CardTitle>
        <CardDescription>
          {r.leader
            ? `${leaderLabel} is ahead, but the conditions this test was set up with are not met yet.`
            : 'The conditions this test was set up with are not met yet.'}
          {' '}Calling it now is how a test produces a confident answer that does not reproduce.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {r.blockers.map(b => (
          <div key={b.kind} className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-[12.5px] font-medium">{BLOCKER_LABEL[b.kind] || b.kind}</span>
              <span className="text-muted-foreground text-[12px] tabular-nums">{b.message}</span>
            </div>
            {/* `good` is [1,1] so the bar only reads as satisfied at 100%: a
                progress bar that turns green at 60% of the required sample is
                telling the reader the opposite of what this panel is for. */}
            <Meter value={b.progress ?? 0} good={[1, 1]} max={1} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const BLOCKER_LABEL = {
  sample: 'Visitors counted',
  runtime: 'Time running',
  confidence: 'Statistical confidence',
};

/* ── One goal's numbers ───────────────────────────────────────────────────── */

function GoalTable({ result, target }) {
  const { goal, arms } = result;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[13.5px]">
          {goal.name}
          {goal.primary
            ? <Badge variant="primary">primary</Badge>
            : <Badge variant="outline">secondary</Badge>}
        </CardTitle>
        <CardDescription>{GOAL_DESCRIPTION[goal.type] || goal.type}</CardDescription>
      </CardHeader>
      <Table>
        <THead>
          <tr>
            <th>Arm</th>
            <th className="text-right">Visitors</th>
            <th className="text-right">Conversions</th>
            <th className="text-right">Rate</th>
            <th className="text-right">Change vs control</th>
            <th className="text-right">Confidence</th>
          </tr>
        </THead>
        <TBody>
          {arms.map(arm => (
            <TRow key={arm.variant}>
              <td>
                <span className="font-medium">{arm.label}</span>
                {arm.isControl && <Badge variant="outline" className="ml-2">control</Badge>}
              </td>
              <td className="text-right tabular-nums">{num(arm.exposures)}</td>
              <td className="text-right tabular-nums">{num(arm.conversions)}</td>
              <td className="text-right tabular-nums font-medium">{pct(arm.rate)}</td>
              <td className="text-right tabular-nums"><Change c={arm.comparison} /></td>
              <td className="text-right tabular-nums"><Confidence c={arm.comparison} target={target} /></td>
            </TRow>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

const GOAL_DESCRIPTION = {
  form: 'Counted when the form is submitted and the endpoint accepts it — not when the button is clicked.',
  click: 'Counted the first time this visitor clicks an element matching the selector.',
  pageview: 'Counted the first time this visitor reaches the matching path.',
  custom: 'Counted when the site calls window.rainbowAB.track() with this event name.',
};

/**
 * A lift, always with its interval.
 *
 * The interval is the part that stops "+18%" being repeated as fact when it
 * spans zero, so it is rendered at the same size rather than as a tooltip
 * nobody opens.
 */
function Change({ c }) {
  if (!c) return <span className="text-muted-foreground">—</span>;
  const spansZero = c.interval.low < 0 && c.interval.high > 0;
  const Icon = spansZero ? Minus : c.relativeLift > 0 ? TrendingUp : TrendingDown;
  const tone = spansZero
    ? 'text-muted-foreground'
    : c.relativeLift > 0 ? 'text-success' : 'text-destructive';

  return (
    <Tooltip content={spansZero
      ? 'The 95% interval includes zero, so this difference is consistent with no difference at all.'
      : 'The 95% interval on the absolute difference in conversion rate.'}
    >
      <span className={`inline-flex items-center justify-end gap-1 ${tone}`}>
        <Icon className="size-3.5" />
        <span className="font-medium">
          {c.relativeLift == null ? pct(c.absoluteLift) : `${c.relativeLift > 0 ? '+' : ''}${c.relativeLift.toFixed(1)}%`}
        </span>
        <span className="text-muted-foreground text-[11px]">
          ({c.interval.low > 0 ? '+' : ''}{c.interval.low.toFixed(2)} to {c.interval.high > 0 ? '+' : ''}{c.interval.high.toFixed(2)} pt)
        </span>
      </span>
    </Tooltip>
  );
}

function Confidence({ c, target }) {
  if (!c) return <span className="text-muted-foreground">—</span>;
  const met = c.confidence >= target;
  return (
    <Tooltip content={`${c.probabilityBetter.toFixed(1)}% chance this arm is genuinely better than the control.`}>
      <Badge variant={met ? 'success' : 'outline'}>{pct(c.confidence, 1)}</Badge>
    </Tooltip>
  );
}
