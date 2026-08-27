/*
 * cms-form.js — submitting a CMS-managed form.
 *
 * One handler for every form on the page, wherever the markup came from: a page
 * block, a section inside a blog article, or two of each. It is a separate file
 * rather than an inline script for exactly that reason — the markup is built in
 * three places and a second copy of this logic is the bug somebody would be
 * chasing in six months when a form worked on a page and did nothing in an
 * article.
 *
 * What it does beyond posting the fields:
 *
 *   - captures the page, the language, the A/B arm and the campaign parameters,
 *     because none of the site's original forms did and every one of them
 *     should have. The two API routes already accept all four;
 *   - runs the browser's own validation on demand, so a failed submit shows a
 *     message under the field rather than a native bubble the page cannot style;
 *   - interpolates the thank-you copy with what was submitted and with the
 *     response keys the integration allows through, so "we have sent it to
 *     {email}" and "your reference is {reference}" need no developer;
 *   - says something true when it fails. The API distinguishes "we stored your
 *     details, the confirmation is delayed" from "that did not go through", and
 *     a visitor who has been captured should not be told to try again.
 *
 * Progressive enhancement is deliberately not attempted: the API answers JSON,
 * so a plain form POST would show a visitor a JSON document. The form says so in
 * a <noscript> instead of pretending.
 */
(function () {
  'use strict';

  if (window.__cmsFormsBound) return;
  window.__cmsFormsBound = true;

  /** The campaign parameters worth keeping, and nothing else. */
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'msclkid'];

  function campaign() {
    var out = {};
    try {
      var params = new URLSearchParams(window.location.search);
      for (var i = 0; i < UTM_KEYS.length; i++) {
        var value = params.get(UTM_KEYS[i]);
        if (value) out[UTM_KEYS[i]] = value.slice(0, 200);
      }
    } catch (err) { /* a URL we cannot parse is not worth failing a submit over */ }
    return out;
  }

  /** Which A/B arm produced this page, if any. */
  function variant() {
    try {
      var assigned = window.__CMS__ && window.__CMS__.variants;
      if (!assigned) return '';
      var keys = Object.keys(assigned);
      return keys.length ? keys.map(function (k) { return k + '=' + assigned[k]; }).join(',') : '';
    } catch (err) { return ''; }
  }

  /**
   * Fill `{name}` placeholders from what was submitted and what came back.
   *
   * The submitted values first, then the response — so an integration that
   * returns a `reference` can be quoted, and a response key cannot be shadowed
   * by a field of the same name. Anything with no value is left as it was
   * written, which reads as a mistake in the copy rather than as a blank.
   */
  function interpolate(text, submitted, response) {
    if (!text || text.indexOf('{') === -1) return text;
    return text.replace(/\{([A-Za-z0-9_]+)\}/g, function (whole, key) {
      if (response && response[key] !== undefined && response[key] !== null && response[key] !== '') {
        return String(response[key]);
      }
      if (submitted && submitted[key] !== undefined && submitted[key] !== '') return String(submitted[key]);
      return whole;
    });
  }

  function fieldError(form, element) {
    var target = form.querySelector('[data-error-for="' + element.name + '"]');
    if (!target) return;
    target.textContent = element.validationMessage;
    target.classList.remove('hidden');
  }

  function clearErrors(form) {
    var nodes = form.querySelectorAll('[data-error-for], [data-form-error]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = '';
      nodes[i].classList.add('hidden');
    }
  }

  function showFailure(form, message) {
    var box = form.querySelector('[data-form-error]');
    if (!box) return;
    box.textContent = message;
    box.classList.remove('hidden');
  }

  document.addEventListener('submit', function (event) {
    var form = event.target && event.target.closest && event.target.closest('form[data-cms-form]');
    if (!form) return;
    event.preventDefault();

    // `novalidate` is set on the form so a failure shows our own message; run
    // the browser's validation here instead of losing it.
    var elements = form.elements;
    for (var i = 0; i < elements.length; i++) {
      var element = elements[i];
      if (element.willValidate && !element.checkValidity()) {
        clearErrors(form);
        fieldError(form, element);
        element.focus();
        return;
      }
    }
    clearErrors(form);

    var button = form.querySelector('button[type="submit"]');
    var label = form.querySelector('[data-submit-label]');
    var original = label ? label.textContent : '';
    var sending = form.getAttribute('data-sending') || original;
    if (button) button.disabled = true;
    if (label && sending) label.textContent = sending;

    var payload = {};
    var entries = new FormData(form).entries();
    var next = entries.next();
    while (!next.done) {
      payload[next.value[0]] = next.value[1];
      next = entries.next();
    }

    // Context the forms never used to send. The API stores all four on the lead.
    payload.page = window.location.pathname;
    payload.locale = document.documentElement.lang || '';
    var arm = variant();
    if (arm) payload.variant = arm;
    var utm = campaign();
    if (Object.keys(utm).length) payload.utm = utm;

    var submitted = payload;

    fetch(form.getAttribute('action'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (body) {
          return { res: res, body: body || {} };
        });
      })
      .then(function (result) {
        var res = result.res;
        var body = result.body;

        if (!res.ok) {
          /*
           * A 502 with `stored: true` means the submission is safe and the
           * automation is late. Telling that visitor to try again would produce
           * a second lead and a worse impression, so the API's own wording is
           * used rather than a generic failure.
           */
          throw new Error(body.error || 'Something went wrong. Please try again.');
        }

        /*
         * Announce the success before anything else happens.
         *
         * Emitted here rather than on submit because this is the point at which
         * the endpoint accepted it: a goal wired to a click on the button would
         * count every failed validation as a conversion. Dispatched before the
         * redirect below, because after `location.assign` this page is gone and
         * anything listening never runs.
         */
        try {
          document.dispatchEvent(new CustomEvent('rainbow:form-success', {
            detail: {
              formKey: form.getAttribute('data-form-key') || '',
              formId: form.id || '',
            },
          }));
        } catch (e) { /* a listener throwing must not break the confirmation */ }

        var redirect = form.getAttribute('data-redirect');
        if (redirect) { window.location.assign(redirect); return; }

        var panel = form.parentElement && form.parentElement.querySelector('[data-form-success]');
        form.classList.add('hidden');
        if (!panel) return;

        var message = panel.querySelector('[data-success-message]');
        if (message) {
          var template = message.getAttribute('data-template') || message.textContent;
          message.setAttribute('data-template', template);
          message.textContent = interpolate(template, submitted, body);
        }
        panel.classList.remove('hidden');
        panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      })
      .catch(function (err) {
        showFailure(form, err.message || 'Something went wrong. Please try again.');
      })
      .then(function () {
        if (button) button.disabled = false;
        if (label) label.textContent = original;
      });
  });
}());
