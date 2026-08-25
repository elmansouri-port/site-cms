// Language switcher for Rainbow Portal.
// The URL is the source of truth for language (/fr/..., /en/..., /de/...) —
// every page is a fully-translated static file per language, so this file's
// only job is: read the lang from the URL, render the switcher UI, and on a
// switch, navigate to the equivalent path under the new lang prefix.
(function () {
    'use strict';

    var SUPPORTED = ['fr', 'en', 'de'];
    var DEFAULT_LANG = 'fr';

    function currentLangFromUrl() {
        // No `^` anchor: this must also match under a GitHub Pages subpath
        // (e.g. /store/fr/tarifs), not just a root-served /fr/tarifs.
        var m = location.pathname.match(/\/(fr|en|de)(\/|$)/);
        return m ? m[1] : DEFAULT_LANG;
    }

    var currentLang = currentLangFromUrl();

    // Remember the explicit choice so a later visit to an unprefixed URL
    // (e.g. a bookmark from before this migration) redirects consistently.
    function setCookie(lang) {
        document.cookie = 'lang=' + lang + ';path=/;max-age=31536000;SameSite=Lax';
    }
    setCookie(currentLang);

    function targetPath(lang) {
        // Preserve everything before the lang segment too (e.g. a GitHub
        // Pages "/store" subpath base), not just what follows it.
        var path = location.pathname;
        var m = path.match(/^(.*?)\/(fr|en|de)(\/.*|$)/);
        if (m) return m[1] + '/' + lang + m[3] + location.search + location.hash;
        return '/' + lang + path + location.search + location.hash;
    }

    function setLang(lang) {
        if (SUPPORTED.indexOf(lang) === -1) lang = DEFAULT_LANG;
        if (lang === currentLang) return;
        setCookie(lang);
        window.location.href = targetPath(lang);
    }

    function initLangSwitcher() {
        var langs = {
            fr: { name: 'Français', flag: '🇫🇷' },
            en: { name: 'English',  flag: '🇬🇧' },
            de: { name: 'Deutsch',  flag: '🇩🇪' }
        };

        var dropdown = document.getElementById('lang-dropdown');
        if (dropdown) {
            dropdown.innerHTML = '';
            Object.keys(langs).forEach(function (code) {
                var btn = document.createElement('button');
                btn.className = 'lang-opt' + (code === currentLang ? ' active' : '');
                btn.innerHTML =
                    '<span class="lang-flag">' + langs[code].flag + '</span>' +
                    '<span>' + langs[code].name + '</span>' +
                    (code === currentLang
                        ? '<svg class="lang-check" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>'
                        : '');
                btn.onclick = function (e) {
                    e.stopPropagation();
                    setLang(code);
                };
                dropdown.appendChild(btn);
            });
        }

        var mobileSwitcher = document.getElementById('mobile-lang-switcher');
        if (mobileSwitcher) {
            mobileSwitcher.innerHTML = '';
            Object.keys(langs).forEach(function (code) {
                var btn = document.createElement('button');
                btn.className = 'mobile-lang-btn' + (code === currentLang ? ' active' : '');
                btn.innerHTML = '<span>' + langs[code].flag + '</span><span>' + code.toUpperCase() + '</span>';
                btn.onclick = function () { setLang(code); };
                mobileSwitcher.appendChild(btn);
            });
        }

        var langCurrent = document.getElementById('lang-current');
        if (langCurrent) langCurrent.textContent = currentLang.toUpperCase();
    }

    // Close desktop dropdown on outside click
    document.addEventListener('click', function (e) {
        var sw = document.getElementById('lang-switcher');
        if (sw && !sw.contains(e.target)) sw.classList.remove('open');
    });

    function init() {
        document.documentElement.lang = currentLang;
        initLangSwitcher();
        window.dispatchEvent(new CustomEvent('langchange', { detail: { lang: currentLang } }));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Public API — kept for pages that read the current language (e.g. the
    // help-center search locale routing on centre-aide-rainbow.html).
    window.i18n = {
        setLang: setLang,
        getLang: function () { return currentLang; },
        supported: SUPPORTED
    };
})();
