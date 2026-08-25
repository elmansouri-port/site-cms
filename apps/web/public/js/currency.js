/* Currency switcher for pricing tables.
 *
 * Each price element carries data-price (numeric amount) and data-cur (its base
 * currency, EUR by default). On selection the amount is normalised to EUR then
 * converted to the chosen currency. The choice is persisted in localStorage so
 * it stays consistent as the user moves between pricing pages.
 *
 * Rates are relative to EUR and intentionally static (no external API call, no
 * CSP/latency concerns). Update RATES here to refresh them site-wide.
 */
(function () {
  'use strict';

  var RATES = {
    EUR: 1, USD: 1.08, GBP: 0.86, CHF: 0.95, SEK: 11.2, DKK: 7.46,
    NOK: 11.6, PLN: 4.30, HUF: 395, CZK: 25.2, RON: 4.97, BGN: 1.9558
  };
  var SYMBOL = {
    EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', SEK: 'kr', DKK: 'kr',
    NOK: 'kr', PLN: 'zł', HUF: 'Ft', CZK: 'Kč', RON: 'lei', BGN: 'лв'
  };
  var LABEL = {
    EUR: 'Euro', USD: 'US Dollar', GBP: 'Livre sterling', CHF: 'Franc suisse',
    SEK: 'Couronne suédoise', DKK: 'Couronne danoise', NOK: 'Couronne norvégienne',
    PLN: 'Zloty', HUF: 'Forint', CZK: 'Couronne tchèque', RON: 'Leu', BGN: 'Lev'
  };
  // Currencies written number-first with the symbol as a suffix (continental European convention).
  var SUFFIX_CURRENCIES = { EUR: true, SEK: true, DKK: true, NOK: true, PLN: true, HUF: true, CZK: true, RON: true, BGN: true };
  var ORDER = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'DKK', 'NOK', 'PLN', 'HUF', 'CZK', 'RON', 'BGN'];
  var STORAGE_KEY = 'rainbow_currency';

  function getCurrency() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (v && RATES[v]) return v;
    } catch (e) {}
    return 'EUR';
  }

  function setCurrency(cur) {
    try { localStorage.setItem(STORAGE_KEY, cur); } catch (e) {}
  }

  function format(amount, baseCur, target) {
    var eur = amount / (RATES[baseCur] || 1);
    var value = eur * RATES[target];
    var whole = Math.abs(value - Math.round(value)) < 0.005;
    var num = whole ? String(Math.round(value)) : value.toFixed(2);
    if (target === 'EUR') return num.replace('.', ',') + '€';
    if (SUFFIX_CURRENCIES[target]) return num.replace('.', ',') + ' ' + SYMBOL[target];
    return SYMBOL[target] + num;
  }

  function convertAll(target) {
    var els = document.querySelectorAll('[data-price]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var amount = parseFloat(el.getAttribute('data-price'));
      if (isNaN(amount)) continue;
      var base = el.getAttribute('data-cur') || 'EUR';
      el.textContent = format(amount, base, target);
    }
  }

  function syncSwitchers(target) {
    var switchers = document.querySelectorAll('.cur-switcher');
    for (var i = 0; i < switchers.length; i++) {
      var sw = switchers[i];
      var sym = sw.querySelector('[data-cur-sym]');
      var code = sw.querySelector('[data-cur-code]');
      if (sym) sym.textContent = SYMBOL[target];
      if (code) code.textContent = target;
      var opts = sw.querySelectorAll('.cur-opt');
      for (var j = 0; j < opts.length; j++) {
        opts[j].classList.toggle('active', opts[j].getAttribute('data-set-cur') === target);
      }
    }
  }

  function apply(target) {
    convertAll(target);
    syncSwitchers(target);
  }

  function initSwitchers() {
    var switchers = document.querySelectorAll('.cur-switcher');
    for (var i = 0; i < switchers.length; i++) {
      (function (sw) {
        var btn = sw.querySelector('.cur-btn');
        if (btn) {
          btn.addEventListener('click', function (e) {
            e.stopPropagation();
            sw.classList.toggle('open');
          });
        }
        var opts = sw.querySelectorAll('.cur-opt');
        for (var j = 0; j < opts.length; j++) {
          opts[j].addEventListener('click', function () {
            var cur = this.getAttribute('data-set-cur');
            setCurrency(cur);
            apply(cur);
            sw.classList.remove('open');
          });
        }
      })(switchers[i]);
    }
    // close on outside click
    document.addEventListener('click', function (e) {
      var all = document.querySelectorAll('.cur-switcher.open');
      for (var i = 0; i < all.length; i++) {
        if (!all[i].contains(e.target)) all[i].classList.remove('open');
      }
    });
  }

  function init() {
    initSwitchers();
    apply(getCurrency());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
