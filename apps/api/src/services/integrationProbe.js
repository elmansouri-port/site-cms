/*
 * integrationProbe.js — ask an endpoint what it expects, and believe the answer.
 *
 * A form builder is only as good as its knowledge of the endpoint behind it. The
 * usual arrangement is that somebody reads the automation workflow, writes the
 * field names into the CMS by hand, and the two drift apart the first time the
 * workflow changes. Then a form silently collects the wrong fields and the leads
 * arrive empty.
 *
 * The endpoints are willing to say. n8n answers:
 *
 *   wrong method     404 "This webhook is not registered for POST requests.
 *                        Did you mean to make a GET request?"
 *   inactive         404 "The requested webhook ... is not registered.
 *                        The workflow must be active ..."
 *   missing fields   400 {"error": "Champs invalides ou manquants: firstName, ..."}
 *                    400 {"errors": ["email is required", ...]}
 *
 * So a probe with a deliberately empty payload learns the method, whether the
 * workflow is live, and the required field names — without creating a booking,
 * sending an e-mail or unsubscribing anybody. That is the whole trick: the probe
 * is safe *because* it is invalid.
 *
 * Everything this returns is admin-only. The upstream's words never reach a
 * visitor; that is what `routes/hooks.js` exists to prevent.
 */
import { logger } from '../lib/log.js';

/** A payload that no workflow will accept, and every workflow will complain about. */
const PROBE_BODY = { __rainbowCmsProbe: true };

/**
 * The method n8n says the endpoint is really registered for.
 *
 * `Did you mean to make a GET request?` is a gift: it means the path exists and
 * the only thing wrong is the verb.
 */
function detectMethod(text) {
  const match = /Did you mean to make an? (\w+) request/i.exec(text || '');
  return match ? match[1].toUpperCase() : '';
}

/** Whether n8n is telling us the workflow behind this path is switched off. */
function looksInactive(text) {
  return /is not registered/i.test(text || '') && /workflow must be active/i.test(text || '');
}

/*
 * Field names inside a validation complaint.
 *
 * Three shapes, because the workflows were written by different people at
 * different times and all three are in production:
 *
 *   {"error": "Champs invalides ou manquants: firstName, lastName, email"}
 *   {"errors": ["email is required", "datetime is required"]}
 *   {"message": "No booking reference supplied."}
 *
 * The first two name fields; the third does not, and pretending otherwise would
 * put "No" and "booking" in a required-fields list.
 */
const FIELD_LIST = /(?:manquants?|missing|required|invalides?|invalid)\s*[:-]\s*([A-Za-z0-9_,\s]+)/i;
const FIELD_IS_REQUIRED = /^([A-Za-z][A-Za-z0-9_]*)(?:\s+or\s+([A-Za-z][A-Za-z0-9_]*))?\s+is required/i;

const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{1,39}$/;

/**
 * Two different lists, because they mean two different things.
 *
 * `required` is what the endpoint *demanded* — it named these as missing, so a
 * form that does not collect them will fail. Worth a warning.
 *
 * `known` is what the endpoint *reads*: several workflows echo the payload they
 * received, which names every field they look at, including ones they derive
 * themselves (`email_canonical`, `contact_json`). Those are useful as
 * suggestions and would be wrong as warnings — telling an editor their form is
 * missing `email_canonical` would send them off inventing a field the workflow
 * computes.
 */
function detectFields(payload, text) {
  const required = new Set();
  const known = new Set();

  const fromSentence = (sentence) => {
    const listed = FIELD_LIST.exec(sentence);
    if (listed) {
      for (const raw of listed[1].split(',')) {
        const name = raw.trim();
        if (FIELD_NAME.test(name)) required.add(name);
      }
      return;
    }
    const single = FIELD_IS_REQUIRED.exec(sentence.trim());
    if (single) {
      required.add(single[1]);
      if (single[2]) required.add(single[2]);
    }
  };

  if (payload && typeof payload === 'object') {
    if (typeof payload.error === 'string') fromSentence(payload.error);
    if (typeof payload.message === 'string') fromSentence(payload.message);
    for (const item of Array.isArray(payload.errors) ? payload.errors : []) {
      if (typeof item === 'string') fromSentence(item);
    }
    if (payload.received && typeof payload.received === 'object') {
      for (const key of Object.keys(payload.received)) {
        if (FIELD_NAME.test(key)) known.add(key);
      }
    }
  } else if (typeof text === 'string') {
    fromSentence(text);
  }

  for (const name of required) known.add(name);
  return { required: [...required], known: [...known] };
}

/**
 * Build the URL a GET integration should be called with.
 *
 * A GET webhook cannot read a JSON body — the proxy used to send one anyway,
 * which is why the availability lookup and the booking lookup received nothing
 * at all and answered "no reference supplied" to every visitor. `queryFields`
 * names what to put in the URL; empty means everything scalar we hold.
 */
export function withQuery(url, payload, queryFields = []) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const names = queryFields?.length ? queryFields : Object.keys(source);

  const target = new URL(url);
  for (const name of names) {
    const value = source[name];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'object') continue; // a query string is not a place for structure
    target.searchParams.set(name, String(value));
  }
  return target.toString();
}

/** Does this method carry a request body at all? */
export const sendsBody = (method) => method !== 'GET' && method !== 'HEAD';

/**
 * Call an endpoint once with a deliberately invalid payload and report what it
 * said about itself. Never throws.
 */
export async function probeIntegration(row) {
  const method = row.method || 'POST';
  const headers = { 'content-type': 'application/json' };
  for (const [name, value] of (row.headers || new Map()).entries()) headers[name] = value;

  const url = sendsBody(method) ? row.url : withQuery(row.url, PROBE_BODY, row.queryFields);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), row.timeoutMs || 10000);
  const startedAt = Date.now();

  let status = null;
  let text = '';
  let payload = null;
  let transport = '';

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: sendsBody(method) ? JSON.stringify(PROBE_BODY) : undefined,
      signal: controller.signal,
      redirect: 'error',
    });
    status = res.status;
    text = (await res.text()).slice(0, 4000);
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  } catch (err) {
    transport = err.name === 'AbortError' ? 'timed out' : 'unreachable';
  } finally {
    clearTimeout(timer);
  }

  const ms = Date.now() - startedAt;
  const detectedMethod = detectMethod(text);
  const fields = detectFields(payload, text);
  const upstreamMessage = String(
    payload?.error || payload?.message || (Array.isArray(payload?.errors) ? payload.errors.join('; ') : '') || text,
  ).replace(/\s+/g, ' ').trim().slice(0, 400);

  /*
   * The verdict, in the order an operator cares about. A method mismatch and an
   * inactive workflow are configuration faults that look identical in a status
   * code and are fixed completely differently — which is the reason a bare
   * "answered 404" was not worth reading.
   */
  let verdict;
  if (transport) verdict = 'unreachable';
  else if (detectedMethod && detectedMethod !== method) verdict = 'method-mismatch';
  else if (looksInactive(text)) verdict = 'not-registered';
  else if (status >= 200 && status < 400) verdict = 'ok';
  else if (status >= 400 && status < 500) verdict = 'validation';
  else verdict = 'upstream-error';

  const result = {
    verdict,
    status,
    ms,
    detectedMethod,
    requiredFields: fields.required,
    knownFields: fields.known,
    message: transport || upstreamMessage,
    // A 4xx naming its missing fields means the endpoint is alive and listening:
    // the probe was *meant* to be rejected.
    reachable: !transport && verdict !== 'not-registered',
  };

  logger.info({ slug: row.slug, ...result, message: undefined }, 'integration probed');
  return result;
}

/** The sentence the CMS shows for a verdict. */
export const VERDICTS = {
  ok: 'Answered successfully.',
  validation: 'Alive and validating — it rejected the deliberately empty probe, which is what a working endpoint does.',
  'method-mismatch': 'Registered for a different HTTP method than this integration is set to.',
  'not-registered': 'The workflow behind this path is not active in the automation tool.',
  unreachable: 'Nothing answered.',
  'upstream-error': 'The endpoint answered with a server error.',
};
