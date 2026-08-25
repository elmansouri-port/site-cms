# Rainbow by ALE — Lead-Capture Forms Reference

> **Purpose:** Documents the three lead-capture forms on the site — what fields each collects,
> how to open/close them, and what data comes out on submit. Intended for whoever wires the
> `POST` endpoints and for anyone reusing the whitepaper component on a new page.
>
> **Convention:** Each entry shows `File : line` so you can jump straight to the source.
>
> ✅ **Both forms POST to n8n.** The whitepaper component and the demo form each `fetch()` their
> n8n webhook (`https://n8n.openrainbow.org/webhook/livre-blanc-lead` and `.../demo-request-lead`)
> and only show success on a `2xx` response, with a visible error state and re-enabled submit
> button on failure. See [Wiring the backend](#wiring-the-backend). The webhooks themselves still
> need their n8n workflows imported and activated — see `n8n/README.md`.

---

## Overview

| Form | Type | Source |
|---|---|---|
| Livre blanc (type-only cover) | Web component instance | `pages/blog/the-power-of-rainbow.html : 806` |
| Livre blanc (with cover image) | Web component instance | `pages/blog/the-power-of-rainbow.html : 827` |
| Demo request (Rainbow Webinar) | Inline markup + inline script | `pages/webinar.html : 958` |
| Unsubscribe | Standalone page, GET-then-POST | `pages/desinscription.html` |

The two livre blanc forms are **the same component** with different attributes. The demo form and
the unsubscribe page are each standalone and share no code with the others.

---

## 1. `<whitepaper-download-form>`

**Source:** `js/components/whitepaper-download-form.js`
**Class:** `WhitepaperDownloadForm` (`: 551`)

Self-contained custom element using Shadow DOM, so its styles cannot collide with the host page.
No build step, no dependencies — plain `<script src>`.

### Usage

```html
<whitepaper-download-form
    id="my-modal"
    modal
    doc-label="Guide 2026"
    doc-title="Comment choisir sa solution de communication unifiée pour votre PME"
    doc-meta="PDF · 24 pages · 12 min de lecture"
    highlights="Premier point|Deuxième point|Troisième point"
    heading="Recevez le <span class=&quot;wf-accent&quot;>livre blanc</span>"
    subtitle="Renseignez vos coordonnées, le PDF se télécharge immédiatement."
    submit-label="Télécharger le PDF">
</whitepaper-download-form>
<script src="/js/components/whitepaper-download-form.js"></script>
```

Then open it from any trigger:

```html
<a href="#" onclick="event.preventDefault(); document.getElementById('my-modal').open();">
    Télécharger le livre blanc
</a>
```

### Attributes

All optional. Every one has a working default, so the component renders correctly with no
attributes at all.

| Attribute | Type | Default | Notes |
|---|---|---|---|
| `modal` | boolean | absent | Present → renders as a centred overlay, hidden until `.open()`. Absent → renders inline in the page flow (no overlay, no close button). |
| `doc-label` | text | `Livre blanc` | Small uppercase kicker at the top of the cover. |
| `doc-title` | text | `Choisir sa solution de communication unifiée` | The asset's own title, set as the cover headline. |
| `doc-meta` | text | `PDF · Gratuit` | Format / length line, e.g. `PDF · 24 pages · 12 min de lecture`. |
| `highlights` | text | 3 built-in bullets | Value bullets, **pipe-separated**: `"a\|b\|c"`. Whitespace around each item is trimmed; empty items are dropped. Desktop/tablet only — hidden below 660px. |
| `image` | URL | none | Cover artwork. When set, an A4-portrait thumbnail appears on the cover. When absent, the type-only cover is used. |
| `image-alt` | text | `""` | Alt text for `image`. Set this whenever `image` is set. |
| `heading` | **HTML** | `Recevez le <span class="wf-accent">livre blanc</span>` | Form heading. HTML is allowed — wrap a phrase in `<span class="wf-accent">` to render it in brand purple. In an HTML attribute, escape the quotes as `&quot;`. |
| `subtitle` | text | `Renseignez vos coordonnées, le PDF se télécharge immédiatement.` | Form subheading. |
| `submit-label` | text | `Télécharger le PDF` | Submit button text. |
| `privacy-url` | URL | `/politique-de-confidentialite` | Target of the link inside the consent line. |
| `cover-theme` | `lavender` \| `pink` | `lavender` | Cover colour scheme. See [Cover themes](#cover-themes). |

**Default `highlights`** (`: 545`):

1. Comparer les principales solutions UCaaS du marché
2. Les critères qui comptent : coûts, sécurité, intégration
3. Une grille de décision prête à l'emploi

> `heading` is injected with `innerHTML` so markup works. It is authored by the developer, not
> user input — do not pass anything visitor-supplied into it.
>
> `cover-theme` is styled purely in CSS (`:host([cover-theme="pink"])`) and is deliberately **not**
> in `observedAttributes`. It applies immediately, but changing it at runtime via
> `setAttribute` will not trigger a re-render of text content (it doesn't need to).

### Methods

| Method | Behaviour |
|---|---|
| `.open()` | Shows the modal, locks page scroll, focuses the first field, remembers the previously focused element. **No-op unless the `modal` attribute is present.** |
| `.close()` | Hides the modal, restores page scroll, returns focus to whatever opened it. |
| `.reset()` | Clears all fields, clears error states, and returns from the success panel back to the form. Call this if you want the modal blank on reopen — `.open()` alone preserves what was typed. |

### Success state

On success the component sets a `submitted` attribute on itself. This is written by the component,
not by you — it exists so CSS can hide the form's own heading and subtitle, which become stale once
submitted ("Renseignez vos coordonnées…" no longer applies). The confirmation then takes over the
whole form panel and centres on both axes.

`.reset()` removes the attribute and brings the heading, subtitle, and form back.

### Event: `wf-submit`

Fires once the form passes validation. `bubbles: true` and `composed: true`, so it crosses the
shadow boundary and can be caught on `document`.

```js
document.getElementById('whitepaper-modal')
  .addEventListener('wf-submit', (event) => {
    console.log(event.detail);
  });
```

**`event.detail`:**

| Key | Type | Required in form | Notes |
|---|---|---|---|
| `firstName` | string | ✅ | |
| `lastName` | string | ✅ | |
| `email` | string | ✅ | Validated against `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |
| `company` | string | ✅ | |
| `role` | string | — | `""` when left blank |
| `newsletter` | boolean | — | `true` only if the opt-in box is ticked |

> **The privacy consent is not in the payload.** It is required to submit, but the component does
> not report it. If you need to store proof of consent, add it to the `detail` object in
> `_handleSubmit()` (`: 654`).

### Fields as rendered

| `name` | id | Type | Required | Placeholder |
|---|---|---|---|---|
| `firstName` | `wf-first-name` | text | ✅ | Jean |
| `lastName` | `wf-last-name` | text | ✅ | Dupont |
| `email` | `wf-email` | email | ✅ | jean@entreprise.com |
| `company` | `wf-company` | text | ✅ | Acme |
| `role` | `wf-role` | text | — | Directeur des systèmes d'information |
| `consent` | `wf-consent` | checkbox | ✅ | — |
| `newsletter` | `wf-newsletter` | checkbox | — | — |

### Validation behaviour

- Validation is custom (the form is `novalidate`), so messages are styled and in French.
- On invalid submit, every bad field is marked at once and focus jumps to the first one.
- A field's error clears as soon as the visitor starts correcting it (on `input`), rather than
  waiting for another submit.
- The consent checkbox has its own error line beneath it.

### Cover themes

| Value | Panel | Text | Use |
|---|---|---|---|
| `lavender` *(default)* | `linear-gradient(155deg, #fbfaff, #ece6fa 60%, #e4dcf4)` | Navy `#1e1b4b`, purple filled check bullets | Matches the `.info-panel` treatment on `/modifier-rendez-vous` |
| `pink` | Deep plum → magenta, anchored on `#CF0072` (`laurenn.pink`) | White, pink check bullets | Bolder alternative |

Both themes were contrast-checked against **both ends** of their gradient; all cover text clears
WCAG AA (4.5:1 for body, 3:1 for the large title). If you introduce a new theme, re-check it — the
muted greys that pass on a near-white panel do **not** pass on the lavender panel's darker end.

### Responsive behaviour

| Breakpoint | Layout |
|---|---|
| > 860px | Two columns, `304px` cover + form |
| 660–860px | Two columns, `256px` cover, smaller cover title |
| ≤ 660px | Single column. Cover collapses to a compact identity band above the form. |
| ≤ 440px | Prénom / Nom stack into one column |
| ≤ 380px | Narrower cover padding, smaller title, smaller thumbnail |

**Hidden below 660px** — the visitor arrived from a download CTA, so intent is already established
and the persuasion layer is dropped to get the first field near the top of the viewport:

- the `highlights` bullets
- the "Données hébergées en France" line
- the decorative accent rule

With `image` set, the mobile band becomes a thumbnail beside the text (68px, or 56px under 380px)
rather than stacked above it.

---

## 2. The two livre blanc instances

Both at the bottom of `pages/blog/the-power-of-rainbow.html`.

| Instance | Opened by | Cover |
|---|---|---|
| `#whitepaper-modal` | Sidebar resource card → "En savoir plus" (`: 452`) | Type-only |
| `#whitepaper-modal-cover` | Mid-article CTA → "Télécharger le rapport" (`: 403`) | Image thumbnail |

Fields, payload, validation, and event are **identical**. Only the cover differs.

### Adding the real cover artwork

`#whitepaper-modal-cover` currently points `image` at `/images/GUIDES.jpg` as a **placeholder** —
there is no real livre blanc cover in the repo yet. To use the actual one:

1. Put the file in `/images/`
2. Update the attribute: `image="/images/livre-blanc-ucaas-2026.webp"`
3. Update `image-alt` to describe it

Any dimensions work — the slot is a fixed A4-portrait frame and the image is `object-fit: cover`'d,
so it will never stretch or distort. Portrait artwork around 400×566px or larger looks best.

If you settle on one variant, delete the other instance and repoint its trigger.

---

## 3. Demo request form — Rainbow Webinar

**Source:** `pages/webinar.html : 958` (markup), `: ~1340` (script)

Not a component. Inline markup plus an inline IIFE. Specific to this page and **not reusable**
as-is.

**One form, two framings.** Both tabs ("Demander une démo" / "Recevoir une démo vidéo") share the
exact same `<form id="demo-form">` — same fields, same validation, same submit handler. Switching
tabs only swaps the modal title, subtitle, and submit-button copy (see the `COPY` object in the
script) and sets which `requestType` gets sent. There is no separate video panel any more — the
"video" tab does not play anything in-page, it collects the same lead info and is expected to
result in a video demo being sent by e-mail (that follow-up lives in the n8n workflow, not here).

### Controls

| Function | Behaviour |
|---|---|
| `openDemoModal()` | Shows the modal, locks scroll, resets the form, selects the "book" tab, focuses the first field |
| `closeDemoModal()` | Hides the modal, restores scroll, restores focus |
| `setDemoTab('book' \| 'video')` | Re-labels the modal (title/subtitle/submit button) and tags subsequent submits with that `requestType` |

Opened from the page hero (`: 195`). Also closes on `Escape` and on backdrop click.

### Panels

| Element | Content |
|---|---|
| `#demo-panel-form` | The request form (shared by both tabs) |
| `#demo-panel-success` | Post-submit confirmation, text swapped per `requestType` |

### Fields

Accessed **by `id`** — these inputs have no `name` attributes and the form is never serialised via
`FormData`.

| id | Type | Required | Placeholder / options |
|---|---|---|---|
| `demo-first-name` | text | ✅ | Jean |
| `demo-last-name` | text | ✅ | Dupont |
| `demo-email` | email | ✅ | jean@entreprise.com |
| `demo-phone` | tel | — | +33 6 12 34 56 78 |
| `demo-company` | text | ✅ | Acme |
| `demo-company-size` | select | ✅ | 1-10 / 11-50 / 51-200 / 201-500 / 501-1000 / 1000+ employés |
| `demo-country` | select | ✅ | France, Belgique, Suisse, Luxembourg, Allemagne, Espagne, Italie, Royaume-Uni, Autre |
| `demo-source` | select | — | Recherche Google, Réseaux sociaux, Recommandation, Événement / Salon, Partenaire Rainbow, Autre |
| `demo-consent` | checkbox | ✅ | — |

Plus one value that isn't a field: `requestType` (`"book"` or `"video"`), taken from which tab is
active when the form is submitted, added to the JSON payload alongside the fields above.

### Validation

Native browser validation via `form.checkValidity()` / `reportValidity()`, so messages are the
browser's own and follow the browser's language, not the page's.

---

## 4. Unsubscribe

**Source:** `pages/desinscription.html`, routed at `/<lang>/desinscription` (a shared page like
`confirmer-rendez-vous` — see [I18N.md](I18N.md), "Known gaps"). Reached only from an email link,
never linked from the site's own nav or footer.

### Why the link has two methods

| Method | What it does |
|---|---|
| `GET /webhook/unsubscribe-check?u=<token>` | Checks the link is genuine and returns the address masked (`j***t@gmail.com`) so the page can ask "unsubscribe this address?". Records nothing. |
| `POST /webhook/unsubscribe` `{ token }` | Actually records the opt-out. |

The split is the whole point. Mail scanners and corporate security appliances pre-fetch every link
in an email to check it's safe. If the `GET` recorded the opt-out, those robots would silently
unsubscribe people who never clicked — and you'd only find out when the list quietly stopped
growing. Same reasoning as `confirmer-rendez-vous`.

### What happens on confirm

- **The token is checked, not trusted.** The signature is recomputed and compared server-side.
  Editing the address inside the link invalidates it, so nobody can unsubscribe somebody else by
  hand-editing a URL.
- **The existing list is read** matching on the canonical address, so the same person under
  `jean.dupont+news@gmail.com` and `jeandupont@gmail.com` is recognised as one person, not two.
- **A row is written — unless one already exists.** Clicking confirm twice is not an error; the
  second click reports success without writing a duplicate, the same way cancelling an
  already-cancelled booking does (`#done_already` / `res.body.already`).
- **Salesforce would be flagged here.** Today `POST /webhook/unsubscribe` is a NoOp placeholder
  that simply passes through — the opt-out is recorded, but nothing syncs to Salesforce yet.

### Controls

| Function | Behaviour |
|---|---|
| `checkToken()` | Fires the `GET` on page load (and from "Réessayer" on a retryable error). Renders the masked address once it comes back. |
| `confirmUnsubscribe()` | Fires the `POST`, wired to `#btn-confirm`. |

### States

| Element | Shown when |
|---|---|
| `#state-checking` | The `GET` is in flight |
| `#state-ready` | Token is genuine; masked address shown, waiting on a click |
| `#state-working` | The confirm `POST` is in flight |
| `#state-done` | Recorded — text differs for a fresh opt-out vs. `already` |
| `#state-error` | Missing/invalid token or a network failure; `#btn-retry` only shows when retrying could help |

### Query param

`?u=<token>` per the two-method table above. `?token=<token>` is also accepted as a fallback.

---

## Wiring the backend

### The whitepaper component

`_handleSubmit()` now `fetch()`es `LIVRE_BLANC_WEBHOOK_URL`
(`https://n8n.openrainbow.org/webhook/livre-blanc-lead`) with `event.detail` as the JSON body.
The `wf-submit` event still fires (on a successful response only), so existing listeners keep
working. On a non-`2xx` response or network failure, the button re-enables and a `.wf-submit-error`
banner appears below it ("Une erreur est survenue lors de l'envoi. Veuillez réessayer.") — the
form stays populated so the visitor can just retry.

The loading state (spinner + "Envoi en cours…") and the double-submit guard are unchanged.

### The demo form

`pages/webinar.html`'s submit handler now reads the fields **by `id`**, builds the JSON body the
`demo-request-lead` workflow expects (plus `requestType`, see above), and `fetch()`es
`DEMO_WEBHOOK_URL` (`https://n8n.openrainbow.org/webhook/demo-request-lead`). The submit button
(`#demo-submit-btn` / `#demo-submit-label`) disables and reads "Envoi en cours…" while the request
is in flight; on failure, an inline `#demo-error` banner appears above it and the form stays put
for a retry. Validation is still native (`checkValidity()`/`reportValidity()`).

### Unsubscribe

`pages/desinscription.html` calls `GET /webhook/unsubscribe-check?u=<token>` on load and `POST
/webhook/unsubscribe` from the confirm button, both under `n8n.openrainbow.org`. Like the
`booking-lookup`/`booking-confirm` pair the confirm/reschedule pages call, neither workflow is
committed to `n8n/` in this repo yet — the page will show a generic error until both are built and
activated at those webhook paths. Expected response shapes:

- `GET` — `200 { "email_masked": "j***t@gmail.com" }`, or `404` for an unknown/tampered token.
- `POST` — `200 { "already": false }` (or `true` on a duplicate confirm), or a non-2xx with
  `{ "error_code": "..." }` for the retryable-error path.

### CSP

The whitepaper, demo, and unsubscribe `fetch()` calls (and the confirm/reschedule pages' calls to
`ipapi.co` and their own `n8n.openrainbow.org` webhooks) only work because `server.js`'s
`connectSrc` directive allowlists `https://n8n.openrainbow.org` and `https://ipapi.co`. If a new
webhook host is ever introduced, it needs to be added there too, or the browser will silently
block the request (shows as `(blocked:csp)` in the Network tab, not a network error you can
`catch()`).

### Remaining gap

The whitepaper component still does **not** include the privacy-consent checkbox in the
`wf-submit` payload (see `n8n/README.md`, "Consent gap") — add it to the `detail` object in
`_handleSubmit()` if you need to prove consent was given.

### Recommendation

Convert the demo form into a component alongside the whitepaper one so both share a single submit
contract, one loading/error implementation, and one set of field conventions. Right now the two
forms validate differently (custom vs native) and duplicate their field styling, even though both
now follow the same fetch/loading/error pattern.

---

## File map

| Path | Contains |
|---|---|
| `js/components/whitepaper-download-form.js` | The whitepaper component — markup, styles, logic |
| `pages/blog/the-power-of-rainbow.html` | Both livre blanc instances + their triggers |
| `pages/webinar.html` | Demo modal markup, styles, and script |
| `pages/desinscription.html` | Unsubscribe page — markup, styles, and script |

> After editing any page, run `node tools/build-pages.js` to regenerate `docs/` (the GitHub Pages
> build). Note also that `server.js` caches translated HTML per language in memory — restart the
> dev server to see edits on non-English page loads.
