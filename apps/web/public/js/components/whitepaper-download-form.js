/**
 * <whitepaper-download-form>
 * Gated-content lead capture. Split panel: a designed document cover on the
 * left (the asset you receive), the form on the right (the action you take).
 * Works inline or as a modal (add `modal`, then call .open()/.close()).
 *
 * Visual system is shared with the "Besoin d'une démo Rainbow Webinar ?" modal
 * on /products/webinar — same field styling, labels, buttons and success state.
 *
 * Attributes:
 *   doc-label   cover kicker            (default "Livre blanc")
 *   doc-title   the asset's own title   (rendered as the cover headline)
 *   doc-meta    format/length line      (e.g. "PDF · 24 pages · Gratuit")
 *   highlights  pipe-separated bullets  ("Comparer…|Critères clés…|Panorama…")
 *   image       optional real cover art (replaces the designed cover)
 *   image-alt   alt text for `image`
 *   cover-theme "lavender" (default) or "pink"
 *   heading     form heading (HTML ok; .wf-accent highlights a phrase)
 *   subtitle    form subheading
 *   submit-label / privacy-url / modal
 *
 * Events: "wf-submit" → detail { firstName, lastName, email, company, role, newsletter }
 */
(function () {
    // A path on this origin, not the automation platform's webhook. The server
    // stores the lead, makes the outbound call and answers with whether it
    // worked — so the platform, its webhook path and its reply never reach the
    // browser, and the endpoint cannot be posted to without going through the
    // site's rate limiting. Managed under Integrations in the CMS.
    const LIVRE_BLANC_ENDPOINT = '/api/v1/hooks/livre-blanc-lead';

    const TEMPLATE = document.createElement('template');
    TEMPLATE.innerHTML = `
        <style>
            :host { display: contents; }

            /* ── Overlay ───────────────────────────────────────────── */
            :host([modal]) .wf-scrim {
                position: fixed; inset: 0; z-index: 1000;
                background: rgba(30,10,24,0.55);
                backdrop-filter: blur(4px);
                display: none; align-items: flex-start; justify-content: center;
                padding: 16px; overflow-y: auto;
                /* stop a scroll that runs off the end of the modal from carrying
                   on down the article behind it */
                overscroll-behavior: contain;
                -webkit-overflow-scrolling: touch;
            }
            :host([modal][open]) .wf-scrim { display: flex; }
            :host(:not([modal])) .wf-scrim {
                position: static; display: block; padding: 0;
                background: none; backdrop-filter: none;
            }
            @media (min-width: 700px) {
                :host([modal]) .wf-scrim { align-items: center; padding: 28px; }
            }

            /* ── Shell ─────────────────────────────────────────────── */
            .wf-card {
                position: relative;
                width: 100%; max-width: 880px; margin: 24px auto;
                max-height: calc(100vh - 32px);
                /* dvh tracks the visible viewport as mobile browser chrome
                   collapses; vh does not, so a vh-capped card runs under the
                   toolbar and puts the submit button out of reach. */
                max-height: calc(100dvh - 32px);
                background: #fff;
                border-radius: 18px;
                overflow: hidden;
                box-sizing: border-box;
                font-family: 'Google Sans', system-ui, -apple-system, sans-serif;
                display: grid;
                grid-template-columns: 304px 1fr;
                /* Implicit grid rows are auto-sized, so they grow to fit their
                   content and overflow a max-height container — overflow:hidden
                   then slices the bottom off whichever panel is taller (the
                   cover, once it carries A4 art) and the form becomes unusable.
                   The panels' own overflow-y never engages, because a panel
                   that is exactly as tall as its content never overflows
                   itself; the card does. minmax(0, 1fr) caps the row at the
                   card height so the panels really can scroll. Plain 1fr is
                   not enough: its implied auto minimum overflows just the same. */
                grid-template-rows: minmax(0, 1fr);
                box-shadow:
                    0 24px 48px -12px rgba(17,15,38,0.28),
                    0 8px 16px -8px rgba(17,15,38,0.16);
                animation: wf-enter .42s cubic-bezier(0.16,1,0.3,1) both;
            }
            /* Cap to the viewport (minus scrim padding) and let the cover/body
               panels scroll internally instead of relying on the scrim's own
               overflow — a centered flex item taller than its container can
               get clipped and unreachable in some browsers, so the card must
               never actually need to overflow the scrim. */
            @media (min-width: 700px) {
                .wf-card {
                    margin: 0 auto;
                    max-height: calc(100vh - 56px);
                    max-height: calc(100dvh - 56px);
                }
            }
            :host(:not([modal])) .wf-card { animation: none; }
            @keyframes wf-enter {
                from { opacity: 0; transform: translateY(12px) scale(.985); }
                to   { opacity: 1; transform: none; }
            }

            /* ── Cover panel (the asset) ─────────────────────────────
               Themed via tokens. Default "lavender" matches the
               .info-panel treatment on /modifier-rendez-vous;
               cover-theme="pink" keeps the deep laurenn.pink variant. */
            .wf-cover {
                position: relative;
                display: flex; flex-direction: column;
                padding: 34px 28px 28px;
                min-height: 0; overflow-y: auto; overflow-x: hidden;

                --cover-bg: linear-gradient(155deg, #fbfaff 0%, #ece6fa 60%, #e4dcf4 100%);
                /* muted tones are darker than the site's --muted (#6b6a85) on purpose:
                   they must clear 4.5:1 against the gradient's deepest end (#e4dcf4),
                   not just the near-white top */
                --cover-kicker: #605a7d;
                --cover-title: #1e1b4b;
                --cover-rule: #5e2d91;
                --cover-meta: #5b5675;
                --cover-body: #514c66;
                --cover-check-bg: #5e2d91;
                --cover-check-fg: #fff;
                --cover-check-pad: 3.5px;
                --cover-foot: #605a7d;
                --cover-texture: rgba(94,45,145,0.05);
                --cover-edge: 1px solid #eceafc;
                --cover-art-edge: 1px solid rgba(94,45,145,0.12);
                --cover-art-shadow: 0 10px 22px -10px rgba(30,27,75,0.28);

                background: var(--cover-bg);
                border-right: var(--cover-edge);
            }
            :host([cover-theme="pink"]) .wf-cover {
                /* laurenn.pink (#CF0072) family, deepened so white type stays legible */
                --cover-bg:
                    radial-gradient(120% 90% at 6% 2%, #9e1455 0%, transparent 60%),
                    linear-gradient(158deg, #7d1450 0%, #5c1040 52%, #430c31 100%);
                --cover-kicker: #fcd5e8;
                --cover-title: #fff;
                --cover-rule: #ff5faa;
                --cover-meta: rgba(255,255,255,0.87);
                --cover-body: rgba(255,255,255,0.9);
                --cover-check-bg: transparent;
                --cover-check-fg: #ff86c2;
                --cover-check-pad: 0px;
                --cover-foot: rgba(255,255,255,0.78);
                --cover-texture: rgba(255,255,255,0.045);
                --cover-edge: 0;
                --cover-art-edge: 1px solid rgba(255,255,255,0.16);
                --cover-art-shadow: 0 12px 24px -10px rgba(0,0,0,0.55);
            }

            /* faint ruled texture: reads as paper stock, not as a gradient wash */
            .wf-cover::after {
                content: ''; position: absolute; inset: 0; pointer-events: none;
                background-image: linear-gradient(var(--cover-texture) 1px, transparent 1px);
                background-size: 100% 7px;
                mask-image: linear-gradient(to bottom, #000 0%, transparent 72%);
                -webkit-mask-image: linear-gradient(to bottom, #000 0%, transparent 72%);
            }
            .wf-cover > * { position: relative; z-index: 1; }

            .wf-doc-label {
                display: inline-flex; align-self: flex-start; align-items: center; gap: 6px;
                font-size: 0.6875rem; font-weight: 700;
                letter-spacing: 0.14em; text-transform: uppercase;
                color: var(--cover-kicker);
                margin: 0 0 20px;
            }
            .wf-doc-label svg { width: 13px; height: 13px; }

            .wf-doc-title {
                font-size: 1.5rem; font-weight: 800; line-height: 1.16;
                letter-spacing: -0.022em; color: var(--cover-title);
                margin: 0 0 18px; text-wrap: balance;
            }

            .wf-doc-rule {
                width: 34px; height: 2px; border-radius: 2px;
                background: var(--cover-rule); margin-bottom: 16px;
            }

            .wf-doc-meta {
                font-size: 0.75rem; font-weight: 500; line-height: 1.5;
                color: var(--cover-meta); margin: 0;
            }

            /* Cover-art slot — shown only when the "image" attribute is set.
               A4-portrait frame + object-fit:cover means any file drops in
               cleanly whatever its native dimensions, so the panel never
               reflows around an unexpected aspect ratio. */
            .wf-doc-art {
                width: 100%; max-width: 172px;
                aspect-ratio: 1 / 1.414;
                margin: 0 0 22px; border-radius: 8px; overflow: hidden;
                background: #fff;
                border: var(--cover-art-edge);
                box-shadow: var(--cover-art-shadow);
            }
            .wf-doc-art img { display: block; width: 100%; height: 100%; object-fit: cover; }
            .wf-doc-art[hidden] { display: none; }

            .wf-highlights {
                list-style: none; margin: 26px 0 0; padding: 0;
                display: flex; flex-direction: column; gap: 11px;
            }
            .wf-highlights li {
                display: flex; align-items: flex-start; gap: 9px;
                font-size: 0.8125rem; line-height: 1.45;
                color: var(--cover-body);
            }
            .wf-highlights svg {
                width: 18px; height: 18px; flex-shrink: 0; margin-top: 0;
                box-sizing: border-box; padding: var(--cover-check-pad);
                border-radius: 50%;
                background: var(--cover-check-bg);
                color: var(--cover-check-fg);
            }

            .wf-cover-foot {
                margin-top: auto; padding-top: 26px;
                display: flex; align-items: center; gap: 8px;
                font-size: 0.6875rem; font-weight: 500;
                color: var(--cover-foot);
            }
            .wf-cover-foot svg { width: 13px; height: 13px; }

            /* ── Form panel (the action) ───────────────────────────── */
            .wf-body {
                padding: 34px 32px 32px; min-width: 0; min-height: 0;
                overflow-y: auto;
                display: flex; flex-direction: column;
            }
            @media (min-width: 700px) { .wf-body { padding: 38px 40px 34px; } }

            .wf-body::-webkit-scrollbar, .wf-cover::-webkit-scrollbar { width: 4px; }
            .wf-body::-webkit-scrollbar-thumb, .wf-cover::-webkit-scrollbar-thumb {
                background: #dcd7f0; border-radius: 3px;
            }

            .wf-close {
                position: absolute; z-index: 3; top: 14px; right: 14px;
                width: 32px; height: 32px; border-radius: 8px;
                border: none; background: transparent; color: #9ca3af;
                display: flex; align-items: center; justify-content: center;
                cursor: pointer; transition: background .15s, color .15s;
            }
            .wf-close:hover { background: #f3f4f6; color: #4b5563; }
            .wf-close svg { width: 17px; height: 17px; }
            :host(:not([modal])) .wf-close { display: none; }

            .wf-accent { color: #5e2d91; }
            .wf-heading {
                font-size: 1.375rem; font-weight: 800; color: #16143a;
                letter-spacing: -0.019em; line-height: 1.22;
                margin: 0 0 7px; text-wrap: balance;
            }
            .wf-subtitle {
                font-size: 0.875rem; color: #6b7280; line-height: 1.6;
                margin: 0 0 26px; max-width: 46ch;
            }

            /* ── Fields ────────────────────────────────────────────── */
            form { display: flex; flex-direction: column; }
            .wf-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
            .wf-field { display: flex; flex-direction: column; min-width: 0; margin-bottom: 14px; }
            .wf-row .wf-field { margin-bottom: 0; }
            .wf-row { margin-bottom: 14px; }

            .wf-field label {
                font-size: 0.75rem; font-weight: 600; color: #374151;
                margin-bottom: 6px; letter-spacing: -0.003em;
            }
            .wf-field .wf-req { color: #5e2d91; }
            .wf-field .opt { font-weight: 400; color: #9ca3af; }

            .wf-field input {
                width: 100%; box-sizing: border-box;
                padding: 11px 14px; border-radius: 10px;
                border: 1px solid #e3e5ea; background: #fff;
                color: #16143a; font-size: 0.9375rem; font-family: inherit;
                outline: none;
                transition: border-color .16s ease, box-shadow .16s ease, background .16s ease;
            }
            .wf-field input::placeholder { color: #b0b4bd; }
            .wf-field input:hover:not(:focus) { border-color: #d2d5dc; }
            .wf-field input:focus {
                border-color: #5e2d91;
                box-shadow: 0 0 0 3px rgba(94,45,145,0.13);
            }
            .wf-field input[aria-invalid="true"] { border-color: #e5484d; background: #fffafa; }
            .wf-field input[aria-invalid="true"]:focus { box-shadow: 0 0 0 3px rgba(229,72,77,0.13); }

            .wf-err {
                display: none; align-items: center; gap: 5px;
                font-size: 0.75rem; color: #c62a2f; margin-top: 6px;
            }
            .wf-err svg { width: 12px; height: 12px; flex-shrink: 0; }
            .wf-field.has-error .wf-err { display: flex; }

            /* ── Consents ──────────────────────────────────────────── */
            .wf-consents {
                display: flex; flex-direction: column; gap: 11px;
                margin-top: 8px; padding-top: 18px;
                border-top: 1px solid #f1f2f4;
            }
            .wf-consent { display: flex; align-items: flex-start; gap: 10px; }
            .wf-consent input[type="checkbox"] {
                width: 16px; height: 16px; flex-shrink: 0; margin: 2px 0 0;
                accent-color: #5e2d91; cursor: pointer;
            }
            .wf-consent label {
                font-size: 0.78125rem; line-height: 1.55; color: #6b7280; cursor: pointer;
            }
            .wf-consent a { color: #5e2d91; font-weight: 600; text-decoration: none; }
            .wf-consent a:hover { text-decoration: underline; }
            .wf-consent.has-error label { color: #c62a2f; }
            .wf-consent-err {
                display: none; align-items: center; gap: 5px;
                font-size: 0.75rem; color: #c62a2f; margin: -3px 0 0 26px;
            }
            .wf-consent-err svg { width: 12px; height: 12px; flex-shrink: 0; }

            .wf-submit-error {
                display: none; align-items: center; gap: 6px;
                font-size: 0.8125rem; color: #c62a2f; margin-top: 12px;
                padding: 10px 12px; border-radius: 8px;
                background: #fdf1f1; border: 1px solid #f4cccc;
            }
            .wf-submit-error.visible { display: flex; }
            .wf-submit-error svg { width: 14px; height: 14px; flex-shrink: 0; }

            /* ── Submit ────────────────────────────────────────────── */
            .wf-submit {
                display: flex; align-items: center; justify-content: center; gap: 9px;
                width: 100%; padding: 13px; margin-top: 20px;
                border: none; border-radius: 10px;
                background: #5e2d91; color: #fff;
                font-size: 0.9375rem; font-weight: 700; font-family: inherit;
                letter-spacing: -0.006em; cursor: pointer;
                box-shadow: 0 8px 16px -6px rgba(94,45,145,0.42);
                transition: background .16s ease, box-shadow .16s ease, transform .12s ease;
            }
            .wf-submit:hover { background: #4d2478; box-shadow: 0 10px 20px -6px rgba(94,45,145,0.5); }
            .wf-submit:active { transform: translateY(1px); }
            .wf-submit svg { width: 17px; height: 17px; flex-shrink: 0; }
            .wf-submit:disabled { opacity: .7; cursor: not-allowed; }

            .wf-submit-icon-spinner { display: none; animation: wf-spin .65s linear infinite; }
            .wf-submit.is-loading { cursor: default; background: #4d2478; }
            .wf-submit.is-loading .wf-submit-icon-download { display: none; }
            .wf-submit.is-loading .wf-submit-icon-spinner { display: block; }
            @keyframes wf-spin { to { transform: rotate(360deg); } }

            .wf-reassure {
                display: flex; align-items: center; justify-content: center; gap: 6px;
                margin: 12px 0 0; font-size: 0.71875rem; color: #9096a1; line-height: 1.5;
            }
            .wf-reassure svg { width: 12px; height: 12px; flex-shrink: 0; }

            /* ── Transitions between panels ────────────────────────── */
            .wf-form-wrap { position: relative; flex: 1; display: flex; flex-direction: column; }

            /* Once submitted, the form's own heading and subtitle are stale
               ("Renseignez vos coordonnées…" no longer applies), so the
               confirmation takes over the whole panel and centres itself. */
            :host([submitted]) .wf-heading,
            :host([submitted]) .wf-subtitle { display: none; }
            form.wf-form-exit {
                animation: wf-leave .2s cubic-bezier(0.16,1,0.3,1) forwards;
                pointer-events: none;
            }
            @keyframes wf-leave { to { opacity: 0; transform: translateY(-6px); } }

            /* ── Success ─────────────────────────────────────────────
               Takes over the whole form panel and centres on both axes, so
               the confirmation reads as a finished state rather than content
               stranded at the top of an empty column. */
            .wf-success { display: none; }
            .wf-success.visible {
                flex: 1;
                display: flex; flex-direction: column;
                align-items: center; justify-content: center;
                text-align: center;
                padding: 8px 0 4px;
                animation: wf-rise .38s cubic-bezier(0.16,1,0.3,1) both;
            }
            @keyframes wf-rise {
                from { opacity: 0; transform: translateY(10px); }
                to   { opacity: 1; transform: none; }
            }
            .wf-success-icon {
                width: 60px; height: 60px; border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
                background: #f3efff; margin-bottom: 24px;
            }
            .wf-success-icon svg {
                width: 27px; height: 27px; color: #5e2d91;
                stroke-dasharray: 22; stroke-dashoffset: 22;
                animation: wf-draw .4s cubic-bezier(0.16,1,0.3,1) .16s forwards;
            }
            @keyframes wf-draw { to { stroke-dashoffset: 0; } }
            .wf-success h3 {
                font-size: 1.3125rem; font-weight: 800; letter-spacing: -0.021em;
                color: #16143a; margin: 0 0 12px; text-wrap: balance;
            }
            .wf-success p {
                font-size: 0.875rem; color: #6b7280; line-height: 1.65;
                margin: 0 auto; max-width: 34ch;
            }
            .wf-success-mail {
                color: #16143a; font-weight: 600;
                overflow-wrap: anywhere;
            }
            /* button and hint stack, so the hint reads as a footnote to the action */
            .wf-success-actions {
                display: flex; flex-direction: column; align-items: center;
                gap: 14px; margin-top: 30px;
            }
            .wf-success-close {
                padding: 12px 30px; border: none; border-radius: 10px;
                background: #5e2d91; color: #fff;
                font-size: 0.875rem; font-weight: 700; font-family: inherit;
                letter-spacing: -0.006em; cursor: pointer;
                box-shadow: 0 8px 16px -6px rgba(94,45,145,0.42);
                transition: background .16s ease, box-shadow .16s ease, transform .12s ease;
            }
            .wf-success-close:hover {
                background: #4d2478; box-shadow: 0 10px 20px -6px rgba(94,45,145,0.5);
            }
            .wf-success-close:active { transform: translateY(1px); }
            .wf-success-hint {
                font-size: 0.71875rem; color: #9096a1; line-height: 1.5;
                max-width: 30ch;
            }

            /* ── Tablet ────────────────────────────────────────────── */
            @media (max-width: 860px) {
                .wf-card { grid-template-columns: 256px 1fr; }
                .wf-cover { padding: 28px 22px 24px; }
                .wf-doc-title { font-size: 1.3125rem; }
                .wf-highlights { margin-top: 22px; }
            }

            /* ── Short viewports (laptops) ───────────────────────────
               A 1366x768 or 1440x900 laptop is WIDE but SHORT: no width
               breakpoint fires, yet once browser chrome is subtracted there is
               only ~600-800px of height for a card whose cover panel runs past
               600px with A4 art. Trim the cover's vertical cost by height
               instead, so the panel fits rather than becoming a scroller —
               scrolling a decorative panel to reach nothing is a poor trade. */
            @media (min-width: 661px) and (max-height: 860px) {
                .wf-cover { padding: 26px 24px 22px; }
                .wf-doc-art { max-width: 128px; margin-bottom: 16px; }
                .wf-doc-title { font-size: 1.25rem; }
                .wf-highlights { margin-top: 18px; gap: 9px; }
                .wf-cover-foot { padding-top: 18px; }
                .wf-body { padding: 28px 34px 26px; }
                .wf-heading { font-size: 1.375rem; }
                .wf-subtitle { margin-bottom: 20px; }
                .wf-field, .wf-row { margin-bottom: 13px; }
            }
            /* Shorter still: the visitor arrived from a download CTA, so intent
               is established — drop the persuasion layer rather than the form. */
            @media (min-width: 661px) and (max-height: 700px) {
                .wf-highlights, .wf-cover-foot, .wf-doc-rule { display: none; }
                .wf-doc-art { max-width: 104px; margin-bottom: 14px; }
                .wf-cover { padding: 22px 22px 20px; }
                .wf-body { padding: 24px 32px 22px; }
                .wf-subtitle { margin-bottom: 16px; }
                .wf-consents { margin-top: 4px; padding-top: 12px; }
                .wf-submit { margin-top: 14px; }
            }

            /* ── Mobile ──────────────────────────────────────────────
               The visitor reached this modal from a download CTA, so intent is
               already established. The cover collapses to a compact identity
               band — what the asset is, nothing more — and the desktop
               persuasion layer (value bullets, accent rule, hosting line) is
               dropped so the first field sits near the top of the viewport. */
            @media (max-width: 660px) {
                .wf-card {
                    grid-template-columns: 1fr;
                    /* Stacked: identity band takes what it needs, the form takes
                       the rest. Without the minmax(0,...) the form row would size
                       to content and overflow the card. */
                    grid-template-rows: auto minmax(0, 1fr);
                    border-radius: 16px; margin: 8px auto;
                }
                /* On a phone, capping the card forces a scroll container inside
                   a scroll container — the page moves when the visitor means to
                   move the form, and the submit button is easy to strand. Let
                   the card run its natural height and give the scrim the single
                   scroll context instead. The panels keep their overflow rules
                   but never engage them, since nothing constrains them now. */
                :host([modal]) .wf-card { max-height: none; }
                .wf-cover {
                    padding: 18px 20px;
                    border-right: 0; border-bottom: var(--cover-edge);
                }
                .wf-highlights,
                .wf-cover-foot,
                .wf-doc-rule { display: none; }

                .wf-doc-label { margin-bottom: 8px; font-size: 0.65625rem; letter-spacing: 0.12em; }
                .wf-doc-label svg { width: 12px; height: 12px; }
                .wf-doc-title { font-size: 1.0625rem; line-height: 1.28; margin-bottom: 6px; }
                .wf-doc-meta { font-size: 0.71875rem; }

                /* with cover art, the band becomes a thumbnail beside the text */
                :host([image]) .wf-cover {
                    display: grid;
                    grid-template-columns: 68px 1fr;
                    column-gap: 14px;
                    align-items: start;
                }
                :host([image]) .wf-doc-art {
                    grid-area: 1 / 1 / 4 / 2;
                    align-self: start;
                    width: 68px; max-width: 68px; margin: 0;
                }
                :host([image]) .wf-doc-label { grid-area: 1 / 2; }
                :host([image]) .wf-doc-title { grid-area: 2 / 2; }
                :host([image]) .wf-doc-meta  { grid-area: 3 / 2; margin-bottom: 0; }

                .wf-body { padding: 24px 20px 24px; }
                /* the close button overlays the cover on mobile — invert it only on the dark theme */
                :host([cover-theme="pink"]) .wf-close { color: #d8d3ea; }
                :host([cover-theme="pink"]) .wf-close:hover { background: rgba(255,255,255,.14); color: #fff; }
                /* keep the title clear of the close button */
                .wf-doc-label { padding-right: 34px; }
                .wf-heading { font-size: 1.1875rem; }
                .wf-subtitle { font-size: 0.84375rem; margin-bottom: 20px; }
                .wf-field, .wf-row { margin-bottom: 12px; }
                .wf-consents { margin-top: 6px; padding-top: 14px; }
                .wf-submit { margin-top: 16px; }
                /* the panel is short on mobile, so give the confirmation its own room */
                .wf-success.visible { padding: 26px 0 18px; }
                .wf-success-icon { width: 54px; height: 54px; margin-bottom: 20px; }
                .wf-success-icon svg { width: 24px; height: 24px; }
                .wf-success h3 { font-size: 1.1875rem; margin-bottom: 10px; }
                .wf-success-actions { margin-top: 26px; }
                .wf-success-close { width: 100%; padding: 13px 24px; }
            }
            @media (max-width: 440px) {
                .wf-row { grid-template-columns: 1fr; gap: 0; margin-bottom: 0; }
                .wf-row .wf-field { margin-bottom: 12px; }
            }
            /* narrow phones: give the title back some measure */
            @media (max-width: 380px) {
                .wf-cover { padding: 16px 18px; }
                .wf-doc-title { font-size: 1rem; }
                :host([image]) .wf-cover { grid-template-columns: 56px 1fr; column-gap: 12px; }
                :host([image]) .wf-doc-art { width: 56px; max-width: 56px; }
                .wf-body { padding: 22px 18px 22px; }
            }

            @media (prefers-reduced-motion: reduce) {
                .wf-card, .wf-success.visible, form.wf-form-exit,
                .wf-success-icon svg, .wf-submit-icon-spinner { animation: none; }
                .wf-success-icon svg { stroke-dashoffset: 0; }
            }
        </style>

        <div class="wf-scrim" part="scrim">
            <div class="wf-card" role="dialog" aria-modal="true" aria-labelledby="wf-title" part="card">

                <!-- ── The asset ── -->
                <aside class="wf-cover">
                    <p class="wf-doc-label">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 5.5A2.5 2.5 0 016.5 3H18a1 1 0 011 1v16a1 1 0 01-1 1H6.5A2.5 2.5 0 014 18.5v-13zM8 7h7M8 11h7"/></svg>
                        <span class="wf-doc-label-text"></span>
                    </p>

                    <div class="wf-doc-art" hidden><img alt=""></div>

                    <h3 class="wf-doc-title"></h3>
                    <div class="wf-doc-rule" aria-hidden="true"></div>
                    <p class="wf-doc-meta"></p>

                    <ul class="wf-highlights"></ul>

                    <p class="wf-cover-foot">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3l7 3.5v5c0 4.2-2.9 7.9-7 9-4.1-1.1-7-4.8-7-9v-5L12 3z"/></svg>
                        Données hébergées en France
                    </p>
                </aside>

                <!-- ── The action ── -->
                <div class="wf-body">
                    <button type="button" class="wf-close" aria-label="Fermer">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>

                    <div class="wf-form-wrap">
                        <h2 class="wf-heading" id="wf-title"></h2>
                        <p class="wf-subtitle"></p>

                        <form novalidate>
                            <div class="wf-row">
                                <div class="wf-field">
                                    <label for="wf-first-name">Prénom <span class="wf-req">*</span></label>
                                    <input id="wf-first-name" name="firstName" type="text" autocomplete="given-name" placeholder="Jean" required>
                                    <span class="wf-err"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M12 8v4m0 3.5v.5"/></svg>Ce champ est requis.</span>
                                </div>
                                <div class="wf-field">
                                    <label for="wf-last-name">Nom <span class="wf-req">*</span></label>
                                    <input id="wf-last-name" name="lastName" type="text" autocomplete="family-name" placeholder="Dupont" required>
                                    <span class="wf-err"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M12 8v4m0 3.5v.5"/></svg>Ce champ est requis.</span>
                                </div>
                            </div>

                            <div class="wf-field">
                                <label for="wf-email">E-mail professionnel <span class="wf-req">*</span></label>
                                <input id="wf-email" name="email" type="email" autocomplete="email" placeholder="jean@entreprise.com" required>
                                <span class="wf-err"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M12 8v4m0 3.5v.5"/></svg>Veuillez renseigner un e-mail valide.</span>
                            </div>

                            <div class="wf-field">
                                <label for="wf-company">Entreprise <span class="wf-req">*</span></label>
                                <input id="wf-company" name="company" type="text" autocomplete="organization" placeholder="Acme" required>
                                <span class="wf-err"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M12 8v4m0 3.5v.5"/></svg>Ce champ est requis.</span>
                            </div>

                            <div class="wf-field">
                                <label for="wf-role">Votre fonction <span class="opt">(optionnel)</span></label>
                                <input id="wf-role" name="role" type="text" autocomplete="organization-title" placeholder="Directeur des systèmes d'information">
                            </div>

                            <div class="wf-consents">
                                <div class="wf-consent">
                                    <input id="wf-consent" name="consent" type="checkbox" required>
                                    <label for="wf-consent" class="wf-consent-label"></label>
                                </div>
                                <span class="wf-consent-err"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M12 8v4m0 3.5v.5"/></svg>Vous devez accepter la politique de confidentialité.</span>

                                <div class="wf-consent">
                                    <input id="wf-newsletter" name="newsletter" type="checkbox">
                                    <label for="wf-newsletter" class="wf-newsletter-label"></label>
                                </div>
                            </div>

                            <button type="submit" class="wf-submit">
                                <svg class="wf-submit-icon-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                                <svg class="wf-submit-icon-spinner" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="34 100"/></svg>
                                <span class="wf-submit-label"></span>
                            </button>

                            <p class="wf-submit-error" role="alert"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M12 8v4m0 3.5v.5"/></svg>Une erreur est survenue lors de l'envoi. Veuillez réessayer.</p>

                            <p class="wf-reassure">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M7 11V8a5 5 0 0110 0v3M6 11h12a1 1 0 011 1v7a1 1 0 01-1 1H6a1 1 0 01-1-1v-7a1 1 0 011-1z"/></svg>
                                Aucun spam. Désinscription en un clic.
                            </p>
                        </form>

                        <div class="wf-success" role="status">
                            <div class="wf-success-icon">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                            </div>
                            <h3>Votre livre blanc arrive</h3>
                            <p>Le téléchargement démarre dans un instant. Nous avons aussi envoyé le lien à <span class="wf-success-mail">votre adresse</span> pour que vous puissiez le retrouver plus tard.</p>
                            <div class="wf-success-actions">
                                <button type="button" class="wf-success-close">Fermer</button>
                                <span class="wf-success-hint">Rien reçu&nbsp;? Vérifiez vos indésirables.</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // All UI chrome that isn't already exposed as a per-instance attribute
    // (field labels, placeholders, error/success copy) is driven by the
    // `lang` attribute ("fr" default, "en", "de") so the same shared
    // component renders correctly on every language's copy of a page.
    const LABELS = {
        fr: {
            close: 'Fermer',
            docLabel: 'Livre blanc', docTitle: 'Choisir sa solution de communication unifiée', docMeta: 'PDF · Gratuit',
            defaultHighlights: [
                'Comparer les principales solutions UCaaS du marché',
                'Les critères qui comptent : coûts, sécurité, intégration',
                'Une grille de décision prête à l’emploi',
            ],
            firstNameLabel: 'Prénom', lastNameLabel: 'Nom', emailLabel: 'E-mail professionnel',
            companyLabel: 'Entreprise', roleLabel: 'Votre fonction', optional: '(optionnel)',
            placeholders: { firstName: 'Jean', lastName: 'Dupont', email: 'jean@entreprise.com', company: 'Acme', role: 'Directeur des systèmes d\'information' },
            requiredErr: 'Ce champ est requis.', emailErr: 'Veuillez renseigner un e-mail valide.',
            consentErr: 'Vous devez accepter la politique de confidentialité.',
            submitError: 'Une erreur est survenue lors de l\'envoi. Veuillez réessayer.',
            sending: 'Envoi en cours…', reassure: 'Aucun spam. Désinscription en un clic.',
            consentLabelHtml: (privacyUrl) => 'J\'accepte que mes données soient utilisées par Rainbow&trade; by Alcatel-Lucent conformément à la ' +
                `<a href="${privacyUrl}" target="_blank" rel="noopener noreferrer">politique de confidentialité</a>. *`,
            newsletterLabel: 'Je souhaite recevoir les actualités Rainbow™ by Alcatel-Lucent.',
            heading: 'Recevez le <span class="wf-accent">livre blanc</span>',
            subtitle: 'Renseignez vos coordonnées, le PDF se télécharge immédiatement.',
            submitLabel: 'Télécharger le PDF',
            successTitle: 'Votre livre blanc arrive',
            successBodyTpl: 'Le téléchargement démarre dans un instant. Nous avons aussi envoyé le lien à {email} pour que vous puissiez le retrouver plus tard.',
            successClose: 'Fermer', successHint: 'Rien reçu&nbsp;? Vérifiez vos indésirables.'
        },
        en: {
            close: 'Close',
            docLabel: 'Whitepaper', docTitle: 'Choosing your unified communications solution', docMeta: 'PDF · Free',
            defaultHighlights: [
                'Compare the leading UCaaS solutions on the market',
                'The criteria that matter: cost, security, integration',
                'A ready-to-use decision matrix',
            ],
            firstNameLabel: 'First name', lastNameLabel: 'Last name', emailLabel: 'Work email',
            companyLabel: 'Company', roleLabel: 'Your role', optional: '(optional)',
            placeholders: { firstName: 'John', lastName: 'Smith', email: 'john@company.com', company: 'Acme', role: 'Head of IT' },
            requiredErr: 'This field is required.', emailErr: 'Please enter a valid email address.',
            consentErr: 'You must accept the privacy policy.',
            submitError: 'Something went wrong while sending. Please try again.',
            sending: 'Sending…', reassure: 'No spam. Unsubscribe with one click.',
            consentLabelHtml: (privacyUrl) => 'I agree to my data being used by Rainbow&trade; by Alcatel-Lucent in accordance with the ' +
                `<a href="${privacyUrl}" target="_blank" rel="noopener noreferrer">privacy policy</a>. *`,
            newsletterLabel: 'I would like to receive Rainbow™ by Alcatel-Lucent news.',
            heading: 'Get the <span class="wf-accent">whitepaper</span>',
            subtitle: 'Fill in your details and the PDF downloads immediately.',
            submitLabel: 'Download the PDF',
            successTitle: 'Your whitepaper is on its way',
            successBodyTpl: 'The download starts in a moment. We\'ve also sent the link to {email} so you can find it again later.',
            successClose: 'Close', successHint: 'Didn\'t get anything? Check your spam folder.'
        },
        de: {
            close: 'Schließen',
            docLabel: 'Whitepaper', docTitle: 'Die richtige Lösung für Unified Communications wählen', docMeta: 'PDF · Kostenlos',
            defaultHighlights: [
                'Vergleichen Sie die führenden UCaaS-Lösungen auf dem Markt',
                'Die entscheidenden Kriterien: Kosten, Sicherheit, Integration',
                'Eine gebrauchsfertige Entscheidungsmatrix',
            ],
            firstNameLabel: 'Vorname', lastNameLabel: 'Nachname', emailLabel: 'Geschäftliche E-Mail',
            companyLabel: 'Unternehmen', roleLabel: 'Ihre Funktion', optional: '(optional)',
            placeholders: { firstName: 'Max', lastName: 'Mustermann', email: 'max@unternehmen.de', company: 'Acme', role: 'IT-Leiter' },
            requiredErr: 'Dieses Feld ist erforderlich.', emailErr: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.',
            consentErr: 'Sie müssen die Datenschutzrichtlinie akzeptieren.',
            submitError: 'Beim Senden ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.',
            sending: 'Wird gesendet…', reassure: 'Kein Spam. Abmeldung mit einem Klick.',
            consentLabelHtml: (privacyUrl) => 'Ich stimme zu, dass meine Daten von Rainbow&trade; by Alcatel-Lucent gemäß der ' +
                `<a href="${privacyUrl}" target="_blank" rel="noopener noreferrer">Datenschutzrichtlinie</a> verwendet werden. *`,
            newsletterLabel: 'Ich möchte Neuigkeiten von Rainbow™ by Alcatel-Lucent erhalten.',
            heading: 'Erhalten Sie das <span class="wf-accent">Whitepaper</span>',
            subtitle: 'Geben Sie Ihre Daten ein, und das PDF wird sofort heruntergeladen.',
            submitLabel: 'PDF herunterladen',
            successTitle: 'Ihr Whitepaper ist auf dem Weg',
            successBodyTpl: 'Der Download startet in Kürze. Wir haben den Link auch an {email} gesendet, damit Sie ihn später wiederfinden.',
            successClose: 'Schließen', successHint: 'Nichts erhalten? Prüfen Sie Ihren Spam-Ordner.'
        }
    };

    class WhitepaperDownloadForm extends HTMLElement {
        static get observedAttributes() {
            return ['doc-label', 'doc-title', 'doc-meta', 'highlights', 'image', 'image-alt',
                'heading', 'subtitle', 'privacy-url', 'submit-label', 'lang'];
        }

        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));
        }

        connectedCallback() {
            const root = this.shadowRoot;
            this._scrim = root.querySelector('.wf-scrim');
            this._form = root.querySelector('form');
            this._success = root.querySelector('.wf-success');
            this._submitBtn = root.querySelector('.wf-submit');

            root.querySelector('.wf-close').addEventListener('click', () => this.close());
            root.querySelector('.wf-success-close').addEventListener('click', () => this.close());
            this._scrim.addEventListener('click', (e) => {
                if (e.target === this._scrim) this.close();
            });
            this._form.addEventListener('submit', (e) => this._handleSubmit(e));

            // clear a field's error as soon as the visitor starts fixing it
            root.querySelectorAll('.wf-field input').forEach((input) => {
                input.addEventListener('input', () => {
                    if (input.getAttribute('aria-invalid') === 'true') this._setFieldError(input, false);
                });
            });
            root.getElementById('wf-consent').addEventListener('change', (e) => {
                if (e.target.checked) this._setConsentError(false);
            });

            this._onKeydown = (e) => {
                if (e.key === 'Escape' && this.hasAttribute('open')) this.close();
            };
            document.addEventListener('keydown', this._onKeydown);

            this._render();
        }

        disconnectedCallback() {
            if (this._onKeydown) document.removeEventListener('keydown', this._onKeydown);
        }

        attributeChangedCallback() {
            if (this.isConnected) this._render();
        }

        _render() {
            const root = this.shadowRoot;
            const val = (name, fallback) => this.getAttribute(name) || fallback;

            const lang = (this.getAttribute('lang') || 'fr').toLowerCase();
            const L = LABELS[lang] || LABELS.fr;
            this._L = L;

            // — cover —
            root.querySelector('.wf-doc-label-text').textContent = val('doc-label', L.docLabel);
            root.querySelector('.wf-doc-title').textContent = val('doc-title', L.docTitle);
            root.querySelector('.wf-doc-meta').textContent = val('doc-meta', L.docMeta);

            const rawHighlights = this.getAttribute('highlights');
            const items = rawHighlights
                ? rawHighlights.split('|').map((s) => s.trim()).filter(Boolean)
                : L.defaultHighlights;
            const list = root.querySelector('.wf-highlights');
            list.textContent = '';
            items.forEach((text) => {
                const li = document.createElement('li');
                li.innerHTML =
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true">' +
                    '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>';
                li.appendChild(document.createTextNode(text));
                list.appendChild(li);
            });

            const art = root.querySelector('.wf-doc-art');
            const src = this.getAttribute('image');
            if (src) {
                const img = art.querySelector('img');
                img.src = src;
                img.alt = val('image-alt', '');
                art.hidden = false;
            } else {
                art.hidden = true;
            }

            // — form chrome (labels, placeholders, errors) —
            root.querySelector('.wf-close').setAttribute('aria-label', L.close);
            root.querySelector('.wf-success-close').textContent = L.successClose;

            const FIELD_LABELS = {
                'wf-first-name': L.firstNameLabel, 'wf-last-name': L.lastNameLabel,
                'wf-email': L.emailLabel, 'wf-company': L.companyLabel,
            };
            Object.keys(FIELD_LABELS).forEach((id) => {
                const input = root.getElementById(id);
                const label = input.closest('.wf-field').querySelector('label');
                label.childNodes[0].textContent = FIELD_LABELS[id] + ' ';
                const err = input.closest('.wf-field').querySelector('.wf-err');
                if (err) err.lastChild.textContent = id === 'wf-email' ? L.emailErr : L.requiredErr;
                input.placeholder = L.placeholders[
                    id === 'wf-first-name' ? 'firstName' : id === 'wf-last-name' ? 'lastName'
                        : id === 'wf-email' ? 'email' : 'company'
                ];
            });
            const roleInput = root.getElementById('wf-role');
            const roleLabel = roleInput.closest('.wf-field').querySelector('label');
            roleLabel.childNodes[0].textContent = L.roleLabel + ' ';
            roleLabel.querySelector('.opt').textContent = L.optional;
            roleInput.placeholder = L.placeholders.role;

            root.querySelector('.wf-consent-err').lastChild.textContent = L.consentErr;
            root.querySelector('.wf-submit-error').lastChild.textContent = L.submitError;
            root.querySelector('.wf-reassure').lastChild.textContent = L.reassure;

            // — form —
            root.querySelector('.wf-heading').innerHTML = val('heading', L.heading);
            root.querySelector('.wf-subtitle').textContent = val('subtitle', L.subtitle);
            root.querySelector('.wf-submit-label').textContent = val('submit-label', L.submitLabel);

            const privacyUrl = val('privacy-url', '/politique-de-confidentialite');
            root.querySelector('.wf-consent-label').innerHTML = L.consentLabelHtml(privacyUrl);
            root.querySelector('.wf-newsletter-label').textContent = L.newsletterLabel;

            root.querySelector('.wf-success h3').textContent = L.successTitle;
            root.querySelector('.wf-success-hint').innerHTML = L.successHint;
        }

        _handleSubmit(e) {
            e.preventDefault();
            const root = this.shadowRoot;
            const data = new FormData(this._form);
            let firstInvalid = null;

            [['firstName', 'wf-first-name'], ['lastName', 'wf-last-name'], ['company', 'wf-company']]
                .forEach(([name, id]) => {
                    const input = root.getElementById(id);
                    const empty = !(data.get(name) || '').trim();
                    this._setFieldError(input, empty);
                    if (empty && !firstInvalid) firstInvalid = input;
                });

            const emailInput = root.getElementById('wf-email');
            const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((data.get('email') || '').trim());
            this._setFieldError(emailInput, !emailOk);
            if (!emailOk && !firstInvalid) firstInvalid = emailInput;

            const consentEl = root.getElementById('wf-consent');
            this._setConsentError(!consentEl.checked);
            if (!consentEl.checked && !firstInvalid) firstInvalid = consentEl;

            if (firstInvalid) { firstInvalid.focus(); return; }
            if (this._submitting) return;

            this._submitting = true;
            const btn = this._submitBtn;
            const labelEl = btn.querySelector('.wf-submit-label');
            const originalLabel = labelEl.textContent;
            btn.classList.add('is-loading');
            btn.disabled = true;
            labelEl.textContent = (this._L || LABELS.fr).sending;
            this.shadowRoot.querySelector('.wf-submit-error').classList.remove('visible');

            const email = (data.get('email') || '').trim();
            const detail = {
                firstName: data.get('firstName'),
                lastName: data.get('lastName'),
                email: data.get('email'),
                company: data.get('company'),
                role: data.get('role'),
                newsletter: data.get('newsletter') === 'on',
            };

            fetch(LIVRE_BLANC_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(detail),
            })
                .then((res) => {
                    if (!res.ok) throw new Error('request failed: ' + res.status);
                    this.dispatchEvent(new CustomEvent('wf-submit', {
                        bubbles: true,
                        composed: true,
                        detail,
                    }));

                    const mailEl = this.shadowRoot.querySelector('.wf-success-mail');
                    if (mailEl && email) mailEl.textContent = email;

                    this._form.classList.add('wf-form-exit');
                    window.setTimeout(() => {
                        this._form.style.display = 'none';
                        this._form.classList.remove('wf-form-exit');
                        btn.classList.remove('is-loading');
                        btn.disabled = false;
                        labelEl.textContent = originalLabel;
                        this._submitting = false;
                        // hides the now-stale form heading/subtitle via CSS
                        this.setAttribute('submitted', '');
                        this._success.classList.add('visible');
                        const closeBtn = this.shadowRoot.querySelector('.wf-success-close');
                        if (closeBtn) closeBtn.focus();
                    }, 200);
                })
                .catch((err) => {
                    console.error('[whitepaper-download-form] submit failed:', err);
                    btn.classList.remove('is-loading');
                    btn.disabled = false;
                    labelEl.textContent = originalLabel;
                    this._submitting = false;
                    this.shadowRoot.querySelector('.wf-submit-error').classList.add('visible');
                });
        }

        _setFieldError(input, hasError) {
            input.setAttribute('aria-invalid', String(hasError));
            input.closest('.wf-field').classList.toggle('has-error', hasError);
        }

        _setConsentError(hasError) {
            const root = this.shadowRoot;
            root.getElementById('wf-consent').closest('.wf-consent')
                .classList.toggle('has-error', hasError);
            root.querySelector('.wf-consent-err').style.display = hasError ? 'flex' : 'none';
        }

        open() {
            if (!this.hasAttribute('modal')) return;
            this._lastFocused = document.activeElement;
            this.setAttribute('open', '');
            document.body.style.overflow = 'hidden';
            const first = this.shadowRoot.getElementById('wf-first-name');
            if (first) requestAnimationFrame(() => first.focus());
        }

        close() {
            this.removeAttribute('open');
            document.body.style.overflow = '';
            if (this._lastFocused && this._lastFocused.focus) this._lastFocused.focus();
        }

        reset() {
            this._submitting = false;
            this.removeAttribute('submitted');
            this._form.reset();
            this._form.style.display = '';
            this._form.classList.remove('wf-form-exit');
            this._success.classList.remove('visible');
            this._submitBtn.classList.remove('is-loading');
            this._submitBtn.disabled = false;
            this._submitBtn.querySelector('.wf-submit-label').textContent =
                this.getAttribute('submit-label') || (this._L || LABELS.fr).submitLabel;
            this.shadowRoot.querySelectorAll('.has-error').forEach((el) => el.classList.remove('has-error'));
            this.shadowRoot.querySelectorAll('[aria-invalid="true"]')
                .forEach((el) => el.setAttribute('aria-invalid', 'false'));
            this._setConsentError(false);
            this.shadowRoot.querySelector('.wf-submit-error').classList.remove('visible');
        }
    }

    if (!customElements.get('whitepaper-download-form')) {
        customElements.define('whitepaper-download-form', WhitepaperDownloadForm);
    }
})();
