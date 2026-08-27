/*
 * FormDeliveryPanel — where a form sends what it collects, and whether it will work.
 *
 * The check is the reason this panel exists. Every automation endpoint on this
 * site tells you what it wants when you send it something it cannot use: it
 * refuses with the fields it was missing. The Integrations screen records that
 * answer, so a form can be compared against it here — before it goes on a page,
 * and without submitting anything.
 *
 * Three honest states, and the middle one matters most:
 *
 *   matched      every field the endpoint demanded is on the form
 *   missing      it wants `company` and there is no `company` field
 *   not checked  nobody has tested that endpoint yet, so we do not know
 *
 * A builder that showed a green tick for the third case would be worse than one
 * with no check at all — it would be confidently wrong at exactly the moment
 * somebody stops checking.
 */
import { useState } from 'react';
import { Check, Play, Send, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useResource } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';
import {
  Badge, Button, Callout, Code, CollapsiblePanel, Field, Select, Spinner,
} from './ui/index.js';

export default function FormDeliveryPanel({ formKey, draft, dirty, canEdit, onChange }) {
  const toast = useToast();
  const targets = useResource('/forms/meta/targets');
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);

  const target = draft.target || 'lead:contact';
  const [kind] = target.split(':');

  async function check() {
    setChecking(true);
    try {
      // The saved form is what the endpoint would receive, so the check runs
      // against it. Saying so is better than checking a draft and implying the
      // live form is fine.
      const res = await api.post(`/forms/${formKey}/check`);
      setResult(res);
    } catch (err) {
      toast.error(err);
    } finally {
      setChecking(false);
    }
  }

  const hooks = targets.data?.hooks || [];
  const leads = targets.data?.leads || [];
  const chosenHook = hooks.find(h => h.value === target);

  return (
    <CollapsiblePanel
      id="form.delivery"
      title="Where submissions go"
      icon={Send}
      subtitle={kind === 'hook' ? 'Stored here, then forwarded' : 'Stored here'}
      actions={(
        <Button variant="outline" size="sm" disabled={checking} onClick={check}>
          {checking ? <Spinner className="size-3.5" /> : <Play />} Check
        </Button>
      )}
    >
      <div className="grid gap-3">
        <Field
          label="Destination"
          hint="Everything is stored under Leads first, whichever you choose. A failing automation costs a retry, not the enquiry."
        >
          {id => (
            <Select
              id={id}
              value={target}
              disabled={!canEdit || targets.loading}
              onChange={e => onChange({ target: e.target.value })}
            >
              <optgroup label="Store it under Leads">
                {leads.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </optgroup>
              {hooks.length > 0 && (
                <optgroup label="Store it and forward to an automation">
                  {hooks.map(h => (
                    <option key={h.value} value={h.value}>
                      {h.label}{h.enabled ? '' : ' — switched off'}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          )}
        </Field>

        {chosenHook && !chosenHook.enabled && (
          <Callout tone="warning">
            That integration is switched off, so submissions will be stored and not forwarded.{' '}
            <Link to="/integrations">Open Integrations</Link>.
          </Callout>
        )}

        {chosenHook && chosenHook.enabled && !chosenHook.probed && (
          <Callout>
            Nobody has tested this endpoint yet, so what it expects is unknown.{' '}
            <Link to="/integrations">Run its test</Link> and the check below can tell you whether
            this form sends the right fields.
          </Callout>
        )}

        {dirty && (
          <p className="text-muted-foreground text-[11.5px] leading-snug">
            The check reads the <strong>saved</strong> form. Save first to check what you have just
            changed.
          </p>
        )}

        {result && <CheckResult result={result} />}
      </div>
    </CollapsiblePanel>
  );
}

/* ── The verdict ──────────────────────────────────────────────────────────── */

function CheckResult({ result }) {
  const { checked, missing = [], extra = [], contract = {}, fieldNames = [], duplicates = [] } = result;

  return (
    <div className="grid gap-2.5 border-t pt-3">
      {duplicates.length > 0 && (
        <Callout tone="danger" title="Two fields share a name" icon={false}>
          <Code>{duplicates.join(', ')}</Code> — only one of each pair would arrive.
        </Callout>
      )}

      {!checked && (
        <Callout>
          <strong>Not checked.</strong> {contract.kind === 'hook'
            ? 'That endpoint has never been tested, so what it requires is unknown.'
            : 'A form stored under Leads needs only an email address.'}
        </Callout>
      )}

      {checked && missing.length === 0 && (
        <Callout tone="success" title="Every required field is here" icon={false}>
          <span className="flex items-center gap-1.5">
            <Check className="size-3.5" />
            The endpoint asked for {contract.requiredFields?.join(', ') || 'nothing in particular'}.
          </span>
        </Callout>
      )}

      {checked && missing.length > 0 && (
        <Callout tone="warning" title={`Missing ${missing.length} required field${missing.length === 1 ? '' : 's'}`} icon={false}>
          <span className="flex items-start gap-1.5">
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
            <span>
              The endpoint refuses a submission without{' '}
              {missing.map((name, i) => (
                <span key={name}>
                  {i > 0 && ', '}
                  <Code>{name}</Code>
                </span>
              ))}. Add a field with that exact name, or a hidden field with a fixed value.
            </span>
          </span>
        </Callout>
      )}

      {extra.length > 0 && (
        <p className="text-muted-foreground text-[11.5px] leading-snug">
          Also sending <Code>{extra.join(', ')}</Code>, which the endpoint did not ask for. Usually
          fine — some workflows ignore unknown keys, a few reject them.
        </p>
      )}

      <details className="text-[11.5px]">
        <summary className="text-muted-foreground cursor-pointer select-none">
          What a submission looks like on the wire
        </summary>
        <pre className="bg-muted mt-1.5 overflow-x-auto rounded-md p-2 font-mono text-[11px] leading-relaxed">
          {JSON.stringify(result.samplePayload || {}, null, 2)}
        </pre>
        <p className="text-muted-foreground mt-1.5">
          {fieldNames.length} field{fieldNames.length === 1 ? '' : 's'} sent. The page, the language,
          the A/B arm and any campaign parameters travel with it automatically.
        </p>
      </details>

      {contract.message && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          The endpoint last said: <span className="font-mono">{contract.message}</span>
        </p>
      )}

      {contract.knownFields?.length > 0 && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          It also recognises{' '}
          {contract.knownFields.slice(0, 8).map(f => <Badge key={f} variant="outline" className="mr-1">{f}</Badge>)}
          {contract.knownFields.length > 8 && '…'}
        </p>
      )}
    </div>
  );
}
