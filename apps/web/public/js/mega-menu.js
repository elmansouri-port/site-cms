(function () {
  'use strict';

  // No `^` anchor, and BASE_PREFIX captures whatever precedes the lang
  // segment: this must also work under a GitHub Pages subpath
  // (e.g. /store/fr/tarifs), not just a root-served /fr/tarifs.
  var LANG_MATCH = location.pathname.match(/^(.*?)\/(fr|en|de)(\/|$)/);
  var BASE_PREFIX = LANG_MATCH ? LANG_MATCH[1] : '';
  var LANG = LANG_MATCH ? LANG_MATCH[2] : 'fr';
  function url(p) { return BASE_PREFIX + '/' + LANG + p; }

  var icons = {
    'video-camera': '<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"/>',
    'chat': '<path stroke-linecap="round" stroke-linejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"/>',
    'calendar': '<path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/>',
    'chart-bar': '<path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"/>',
    'phone': '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"/>',
    'lock-closed': '<path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>',
    'newspaper': '<path stroke-linecap="round" stroke-linejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125c-.621 0-1.125.504-1.125 1.125v13.5c0 .621.504 1.125 1.125 1.125h12.75"/>',
    'academic-cap': '<path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5"/>',
    'book-open': '<path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"/>',
    'users': '<path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"/>',
    'lifebuoy': '<path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Zm0 0v4.5m-6.375-9.75 3.185 3.185m0 0 3.185-3.185M12 12l3.185 3.185M12 12l-3.185-3.185"/>',
    'sparkles': '<path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"/>',
    'question-mark-circle': '<path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z"/>',
    'light-bulb': '<path stroke-linecap="round" stroke-linejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"/>',
    'information-circle': '<path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"/>'
  };

  function svgIcon(name) {
    var p = icons[name] || icons['chat'];
    return '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">' + p + '</svg>';
  }

  var COPY = {
    fr: {
      products: {
        sectionTitle: 'Nos produits', seeAll: 'Voir tous les produits',
        items: [
          ['Rainbow Collaboration', "Messagerie d'équipe, canaux et partage de fichiers en un seul endroit."],
          ['Rainbow Webinar', "Webinaires live et en replay avec outils d'engagement intégrés."],
          ['Rainbow Smart Hotel', 'Réservation de salles et gestion de calendrier pour les hôtels.'],
          ['Rainbow Analytics', 'Rapports en temps réel et analyses de vos données de communication.'],
          ['Rainbow Voice', "Téléphonie cloud avec voix HD, SVI et routage d'appels."],
          ['Rainbow Security', 'Chiffrement de niveau entreprise et contrôles de conformité.']
        ],
        itemsMobile: ["Messagerie et canaux d'équipe.", 'Webinaires live et en replay.', 'Réservation de salles intelligente.', 'Rapports en temps réel.', 'Téléphonie cloud.', 'Conformité entreprise.'],
        showcaseTitle: 'Rainbow Collaboration', showcaseDesc: "Messagerie, visioconférence et appels audio, propulsés par l'IA.",
        showcaseTag: 'Populaire', sideTitle: 'À la une',
        integrationsTitle: 'Intégrations', integrationsCtaTitle: 'Connectez vos outils', integrationsCtaDesc: 'Google, Outlook, Teams &amp; plus',
        footerText: "Besoin d'aide pour choisir ? Nous sommes là pour vous guider.",
        footerBtnSecondary: 'Contacter un expert', footerBtnPrimary: 'Nous contacter'
      },
      ressources: {
        sectionTitle: 'Ressources',
        leftItems: [
          ['À propos', 'Découvrez Rainbow, ALE International et notre mission.'],
          ['Souveraineté', 'Vos données hébergées et protégées en France.'],
          ['FAQ', 'Les réponses aux questions les plus fréquentes sur Rainbow.']
        ],
        rightItems: [
          ['Blog', "Actualités, conseils et mises à jour produit de l'équipe Rainbow."],
          ['Partenaires', 'Rejoignez le réseau Rainbow et développez votre activité.']
        ],
        mobileItems: [
          ['À propos', 'Découvrez Rainbow et ALE International.'],
          ['Souveraineté', 'Données hébergées et protégées en France.'],
          ['FAQ', 'Questions fréquentes sur Rainbow.'],
          ['Blog', 'Actualités et mises à jour.'],
          ['Partenaires', 'Rejoignez le réseau Rainbow.']
        ],
        sideTitle: 'Guide populaire', showcaseTitle: 'Débuter avec Rainbow',
        showcaseDesc: "Tout ce qu'il faut savoir pour configurer et commencer à utiliser Rainbow en 10 minutes.",
        showcaseTag: 'Populaire', helpTitle: "Besoin d'aide ?",
        helpCtaTitle: "Accéder au centre d'aide", helpCtaDesc: 'Disponible 24h/7j pour vous aider',
        footerText: 'Restez informé des dernières nouveautés Rainbow.',
        footerBtnSecondary: 'Visiter notre blog', footerBtnPrimary: "Obtenir de l'aide"
      },
      tarifs: {
        sectionTitle: 'Nos tarifs',
        items: [
          ['Rainbow Collaboration', "Tarifs adaptés à vos besoins de collaboration d'équipe."],
          ['Rainbow Webinar', 'Plans et tarifs pour nos solutions de webinaires interactifs.']
        ],
        itemsMobile: ['Plans collaboration.', 'Plans webinaires.'],
        seeAll: 'Voir tous les plans',
        footerText: 'Des tarifs simples et transparents pour votre équipe.',
        footerBtnPrimary: 'Nous contacter'
      },
      navWords: { produits: 'produits', ressources: 'ressources', tarifs: 'tarifs' }
    },
    en: {
      products: {
        sectionTitle: 'Our products', seeAll: 'See all products',
        items: [
          ['Rainbow Collaboration', 'Team messaging, channels, and file sharing in one place.'],
          ['Rainbow Webinar', 'Live and on-demand webinars with built-in engagement tools.'],
          ['Rainbow Smart Hotel', 'Room booking and calendar management for hotels.'],
          ['Rainbow Analytics', 'Real-time reporting and analytics for your communication data.'],
          ['Rainbow Voice', 'Cloud telephony with HD voice, IVR, and call routing.'],
          ['Rainbow Security', 'Enterprise-grade encryption and compliance controls.']
        ],
        itemsMobile: ['Team messaging and channels.', 'Live and on-demand webinars.', 'Smart room booking.', 'Real-time reporting.', 'Cloud telephony.', 'Enterprise compliance.'],
        showcaseTitle: 'Rainbow Collaboration', showcaseDesc: 'Messaging, video conferencing, and voice calls, powered by AI.',
        showcaseTag: 'Popular', sideTitle: 'Featured',
        integrationsTitle: 'Integrations', integrationsCtaTitle: 'Connect your tools', integrationsCtaDesc: 'Google, Outlook, Teams &amp; more',
        footerText: "Need help choosing? We're here to guide you.",
        footerBtnSecondary: 'Talk to an expert', footerBtnPrimary: 'Contact us'
      },
      ressources: {
        sectionTitle: 'Resources',
        leftItems: [
          ['About', 'Discover Rainbow, ALE International, and our mission.'],
          ['Data sovereignty', 'Your data hosted and protected in France.'],
          ['FAQ', 'Answers to the most common questions about Rainbow.']
        ],
        rightItems: [
          ['Blog', 'News, tips, and product updates from the Rainbow team.'],
          ['Partners', 'Join the Rainbow network and grow your business.']
        ],
        mobileItems: [
          ['About', 'Discover Rainbow and ALE International.'],
          ['Data sovereignty', 'Data hosted and protected in France.'],
          ['FAQ', 'Frequently asked questions about Rainbow.'],
          ['Blog', 'News and updates.'],
          ['Partners', 'Join the Rainbow network.']
        ],
        sideTitle: 'Popular guide', showcaseTitle: 'Getting started with Rainbow',
        showcaseDesc: 'Everything you need to set up and start using Rainbow in 10 minutes.',
        showcaseTag: 'Popular', helpTitle: 'Need help?',
        helpCtaTitle: 'Visit the help center', helpCtaDesc: 'Available 24/7 to help you',
        footerText: 'Stay up to date with the latest Rainbow news.',
        footerBtnSecondary: 'Visit our blog', footerBtnPrimary: 'Get help'
      },
      tarifs: {
        sectionTitle: 'Our pricing',
        items: [
          ['Rainbow Collaboration', 'Pricing tailored to your team collaboration needs.'],
          ['Rainbow Webinar', 'Plans and pricing for our interactive webinar solutions.']
        ],
        itemsMobile: ['Collaboration plans.', 'Webinar plans.'],
        seeAll: 'See all plans',
        footerText: 'Simple, transparent pricing for your team.',
        footerBtnPrimary: 'Contact us'
      },
      navWords: { produits: 'products', ressources: 'resources', tarifs: 'pricing' }
    },
    de: {
      products: {
        sectionTitle: 'Unsere Produkte', seeAll: 'Alle Produkte ansehen',
        items: [
          ['Rainbow Collaboration', 'Team-Messaging, Kanäle und Dateiaustausch an einem Ort.'],
          ['Rainbow Webinar', 'Live- und Aufzeichnungs-Webinare mit integrierten Engagement-Tools.'],
          ['Rainbow Smart Hotel', 'Raumbuchung und Kalenderverwaltung für Hotels.'],
          ['Rainbow Analytics', 'Echtzeit-Berichte und Analysen Ihrer Kommunikationsdaten.'],
          ['Rainbow Voice', 'Cloud-Telefonie mit HD-Sprache, IVR und Anrufweiterleitung.'],
          ['Rainbow Security', 'Verschlüsselung auf Unternehmensniveau und Compliance-Kontrollen.']
        ],
        itemsMobile: ['Team-Messaging und Kanäle.', 'Live- und Aufzeichnungs-Webinare.', 'Intelligente Raumbuchung.', 'Echtzeit-Berichte.', 'Cloud-Telefonie.', 'Unternehmens-Compliance.'],
        showcaseTitle: 'Rainbow Collaboration', showcaseDesc: 'Messaging, Videokonferenzen und Sprachanrufe, unterstützt durch KI.',
        showcaseTag: 'Beliebt', sideTitle: 'Im Fokus',
        integrationsTitle: 'Integrationen', integrationsCtaTitle: 'Verbinden Sie Ihre Tools', integrationsCtaDesc: 'Google, Outlook, Teams &amp; mehr',
        footerText: 'Unsicher bei der Wahl? Wir helfen Ihnen gerne weiter.',
        footerBtnSecondary: 'Experten kontaktieren', footerBtnPrimary: 'Kontaktieren Sie uns'
      },
      ressources: {
        sectionTitle: 'Ressourcen',
        leftItems: [
          ['Über uns', 'Entdecken Sie Rainbow, ALE International und unsere Mission.'],
          ['Datenhoheit', 'Ihre Daten werden in Frankreich gehostet und geschützt.'],
          ['FAQ', 'Antworten auf die häufigsten Fragen zu Rainbow.']
        ],
        rightItems: [
          ['Blog', 'Neuigkeiten, Tipps und Produktupdates vom Rainbow-Team.'],
          ['Partner', 'Werden Sie Teil des Rainbow-Netzwerks und wachsen Sie mit uns.']
        ],
        mobileItems: [
          ['Über uns', 'Entdecken Sie Rainbow und ALE International.'],
          ['Datenhoheit', 'Daten gehostet und geschützt in Frankreich.'],
          ['FAQ', 'Häufig gestellte Fragen zu Rainbow.'],
          ['Blog', 'Neuigkeiten und Updates.'],
          ['Partner', 'Werden Sie Teil des Rainbow-Netzwerks.']
        ],
        sideTitle: 'Beliebter Leitfaden', showcaseTitle: 'Erste Schritte mit Rainbow',
        showcaseDesc: 'Alles, was Sie wissen müssen, um Rainbow in 10 Minuten einzurichten und zu nutzen.',
        showcaseTag: 'Beliebt', helpTitle: 'Brauchen Sie Hilfe?',
        helpCtaTitle: 'Zum Hilfe-Center', helpCtaDesc: 'Rund um die Uhr für Sie da',
        footerText: 'Bleiben Sie über die neuesten Rainbow-Neuigkeiten informiert.',
        footerBtnSecondary: 'Unseren Blog besuchen', footerBtnPrimary: 'Hilfe erhalten'
      },
      tarifs: {
        sectionTitle: 'Unsere Preise',
        items: [
          ['Rainbow Collaboration', 'Preise, die auf Ihre Team-Collaboration-Bedürfnisse zugeschnitten sind.'],
          ['Rainbow Webinar', 'Pläne und Preise für unsere interaktiven Webinar-Lösungen.']
        ],
        itemsMobile: ['Collaboration-Pläne.', 'Webinar-Pläne.'],
        seeAll: 'Alle Pläne ansehen',
        footerText: 'Einfache, transparente Preise für Ihr Team.',
        footerBtnPrimary: 'Kontaktieren Sie uns'
      },
      navWords: { produits: 'produkte', ressources: 'ressourcen', tarifs: 'preise' }
    }
  };

  var C = COPY[LANG] || COPY.fr;

  // ── CMS overrides ──────────────────────────────────────────────────────────
  // The navigation is managed in the CMS and handed to the page as
  // window.__CMS__.nav. Anything it supplies wins; anything it omits keeps the
  // value shipped above, so the menu renders the same with or without the API.
  var CMS_NAV = (window.__CMS__ && window.__CMS__.nav) || null;
  function cmsMenu(key) { return (CMS_NAV && CMS_NAV.menus && CMS_NAV.menus[key]) || null; }
  function merge(target, source) {
    if (!source) return target;
    var out = {};
    for (var k in target) out[k] = target[k];
    for (var k2 in source) {
      var v = source[k2];
      var empty = v === '' || v === null || v === undefined ||
        (Array.isArray(v) && (v.length === 0 || v.every(function (x) {
          return x === '' || (Array.isArray(x) && x.every(function (y) { return !y; }));
        })));
      if (!empty) out[k2] = v;
    }
    return out;
  }
  function orDefault(value, fallback) {
    if (Array.isArray(value)) return value.length ? value : fallback;
    return value || fallback;
  }

  var CMS_PRODUCTS = cmsMenu('products');
  var CMS_RESSOURCES = cmsMenu('ressources');
  var CMS_TARIFS = cmsMenu('tarifs');

  C = {
    products: merge(C.products, CMS_PRODUCTS && CMS_PRODUCTS.copy),
    ressources: merge(C.ressources, CMS_RESSOURCES && CMS_RESSOURCES.copy),
    tarifs: merge(C.tarifs, CMS_TARIFS && CMS_TARIFS.copy),
    navWords: merge(C.navWords, CMS_NAV && CMS_NAV.navWords)
  };

  // Fixed links inside the menus, overridable one by one.
  function menuHref(menu, name, fallback) {
    return (menu && menu.hrefs && menu.hrefs[name]) || fallback;
  }
  var L = {
    productsAll: menuHref(CMS_PRODUCTS, 'seeAll', '/products'),
    productsShowcase: menuHref(CMS_PRODUCTS, 'showcase', '/products/collaboration'),
    productsCta: menuHref(CMS_PRODUCTS, 'cta', '/integrations'),
    productsFooterSecondary: menuHref(CMS_PRODUCTS, 'footerSecondary', '/form-al'),
    productsFooterPrimary: menuHref(CMS_PRODUCTS, 'footerPrimary', '/form-al'),
    ressourcesShowcase: menuHref(CMS_RESSOURCES, 'showcase', '/tutorials'),
    ressourcesCta: menuHref(CMS_RESSOURCES, 'cta', '/centre-aide-rainbow'),
    ressourcesFooterSecondary: menuHref(CMS_RESSOURCES, 'footerSecondary', '/blog'),
    ressourcesFooterPrimary: menuHref(CMS_RESSOURCES, 'footerPrimary', '/centre-aide-rainbow'),
    tarifsAll: menuHref(CMS_TARIFS, 'seeAll', '/tarifs'),
    tarifsFooterPrimary: menuHref(CMS_TARIFS, 'footerPrimary', '/form-al')
  };

  function makeItem(href, icon, title, desc) {
    return [
      '<a href="' + href + '" class="mega-menu-item" role="menuitem">',
        '<span class="mega-menu-item-icon">' + svgIcon(icon) + '</span>',
        '<span class="mega-menu-item-text">',
          '<p class="mega-menu-item-title">' + title + '</p>',
          '<p class="mega-menu-item-desc">' + desc + '</p>',
        '</span>',
      '</a>'
    ].join('');
  }

  function makeMobileItem(href, icon, title, desc) {
    return [
      '<a href="' + href + '" class="mega-menu-mobile-item">',
        '<span class="mega-menu-mobile-item-icon">' + svgIcon(icon) + '</span>',
        '<span class="mega-menu-mobile-item-text"><p class="mega-menu-mobile-item-title">' + title + '</p><p class="mega-menu-mobile-item-desc">' + desc + '</p></span>',
      '</a>'
    ].join('');
  }

  var PRODUCT_HREFS = orDefault(CMS_PRODUCTS && CMS_PRODUCTS.hrefs.main, ['/products/collaboration', '/products/webinar', '/products/smart-hotel', '/products/analytics', '/products/voice', '/products/security']);
  var PRODUCT_ICONS = orDefault(CMS_PRODUCTS && CMS_PRODUCTS.icons.main, ['chat', 'video-camera', 'calendar', 'chart-bar', 'phone', 'lock-closed']);

  var productsItems = C.products.items.map(function (item, i) {
    return makeItem(url(PRODUCT_HREFS[i]), PRODUCT_ICONS[i], item[0], item[1]);
  }).join('');

  var productsHTML = [
    '<div class="mega-menu" role="menu">',
      '<div class="mega-menu-inner">',
        '<div class="mega-menu-main">',
          '<p class="mega-menu-section-title">' + C.products.sectionTitle + '</p>',
          '<div class="mega-menu-grid">' + productsItems + '</div>',
          '<a href="' + url(L.productsAll) + '" class="mega-menu-see-all">' + C.products.seeAll + ' <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg></a>',
        '</div>',
        '<div class="mega-menu-side">',
          '<p class="mega-menu-section-title">' + C.products.sideTitle + '</p>',
          '<a href="' + url(L.productsShowcase) + '" class="mega-menu-showcase">',
            '<div class="mega-menu-showcase-img">' + svgIcon('chat') + '</div>',
            '<div class="mega-menu-showcase-body">',
              '<p class="mega-menu-showcase-title">' + C.products.showcaseTitle + '</p>',
              '<p class="mega-menu-showcase-desc">' + C.products.showcaseDesc + '</p>',
              '<span class="mega-menu-showcase-tag">' + C.products.showcaseTag + '</span>',
            '</div>',
          '</a>',
          '<p class="mega-menu-section-title">' + C.products.integrationsTitle + '</p>',
          '<a href="' + url(L.productsCta) + '" class="mega-menu-side-cta">',
            '<span class="mega-menu-side-cta-icon">' + svgIcon('calendar') + '</span>',
            '<span><p class="mega-menu-side-cta-text">' + C.products.integrationsCtaTitle + '</p><p class="mega-menu-side-cta-desc">' + C.products.integrationsCtaDesc + '</p></span>',
          '</a>',
        '</div>',
      '</div>',
      '<div class="mega-menu-footer">',
        '<p class="mega-menu-footer-text">' + C.products.footerText + '</p>',
        '<div class="mega-menu-footer-actions">',
          '<a href="' + url(L.productsFooterSecondary) + '" class="mega-menu-btn mega-menu-btn-secondary">' + svgIcon('question-mark-circle') + C.products.footerBtnSecondary + '</a>',
          '<a href="' + url(L.productsFooterPrimary) + '" class="mega-menu-btn mega-menu-btn-primary">' + svgIcon('lifebuoy') + C.products.footerBtnPrimary + '</a>',
        '</div>',
      '</div>',
    '</div>'
  ].join('');

  var RESSOURCES_LEFT_HREFS = orDefault(CMS_RESSOURCES && CMS_RESSOURCES.hrefs.main, ['/a-propos-de-rainbow', '/rainbow-donnees-hebergees-en-france', '/faq']);
  var RESSOURCES_LEFT_ICONS = orDefault(CMS_RESSOURCES && CMS_RESSOURCES.icons.main, ['information-circle', 'lock-closed', 'question-mark-circle']);
  var RESSOURCES_RIGHT_HREFS = orDefault(CMS_RESSOURCES && CMS_RESSOURCES.hrefs.second, ['/blog', '/partenaires']);
  var RESSOURCES_RIGHT_ICONS = orDefault(CMS_RESSOURCES && CMS_RESSOURCES.icons.second, ['newspaper', 'users']);

  var ressourcesLeftItems = C.ressources.leftItems.map(function (item, i) {
    return makeItem(url(RESSOURCES_LEFT_HREFS[i]), RESSOURCES_LEFT_ICONS[i], item[0], item[1]);
  }).join('');

  var ressourcesRightItems = C.ressources.rightItems.map(function (item, i) {
    return makeItem(url(RESSOURCES_RIGHT_HREFS[i]), RESSOURCES_RIGHT_ICONS[i], item[0], item[1]);
  }).join('');

  var ressourcesHTML = [
    '<div class="mega-menu" role="menu">',
      '<div class="mega-menu-inner">',
        '<div class="mega-menu-main">',
          '<p class="mega-menu-section-title">' + C.ressources.sectionTitle + '</p>',
          '<div class="mega-menu-cols">',
            '<div class="mega-menu-col">' + ressourcesLeftItems + '</div>',
            '<div class="mega-menu-col">' + ressourcesRightItems + '</div>',
          '</div>',
        '</div>',
        '<div class="mega-menu-side">',
          '<p class="mega-menu-section-title">' + C.ressources.sideTitle + '</p>',
          '<a href="' + url(L.ressourcesShowcase) + '" class="mega-menu-showcase">',
            '<div class="mega-menu-showcase-img">' + svgIcon('light-bulb') + '</div>',
            '<div class="mega-menu-showcase-body">',
              '<p class="mega-menu-showcase-title">' + C.ressources.showcaseTitle + '</p>',
              '<p class="mega-menu-showcase-desc">' + C.ressources.showcaseDesc + '</p>',
              '<span class="mega-menu-showcase-tag">' + C.ressources.showcaseTag + '</span>',
            '</div>',
          '</a>',
          '<p class="mega-menu-section-title">' + C.ressources.helpTitle + '</p>',
          '<a href="' + url(L.ressourcesCta) + '" class="mega-menu-side-cta">',
            '<span class="mega-menu-side-cta-icon">' + svgIcon('lifebuoy') + '</span>',
            '<span><p class="mega-menu-side-cta-text">' + C.ressources.helpCtaTitle + '</p><p class="mega-menu-side-cta-desc">' + C.ressources.helpCtaDesc + '</p></span>',
          '</a>',
        '</div>',
      '</div>',
      '<div class="mega-menu-footer">',
        '<p class="mega-menu-footer-text">' + C.ressources.footerText + '</p>',
        '<div class="mega-menu-footer-actions">',
          '<a href="' + url(L.ressourcesFooterSecondary) + '" class="mega-menu-btn mega-menu-btn-secondary">' + svgIcon('newspaper') + C.ressources.footerBtnSecondary + '</a>',
          '<a href="' + url(L.ressourcesFooterPrimary) + '" class="mega-menu-btn mega-menu-btn-primary">' + svgIcon('lifebuoy') + C.ressources.footerBtnPrimary + '</a>',
        '</div>',
      '</div>',
    '</div>'
  ].join('');

  var productsMobileItems = C.products.itemsMobile.map(function (desc, i) {
    return makeMobileItem(url(PRODUCT_HREFS[i]), PRODUCT_ICONS[i], C.products.items[i][0], desc);
  }).join('');

  var productsMobileHTML = [
    '<div class="mega-menu-mobile-content">',
      '<div class="mega-menu-mobile-section">',
        '<p class="mega-menu-mobile-section-title">' + C.products.sectionTitle + '</p>',
        productsMobileItems,
        '<a href="' + url(L.productsAll) + '" class="mega-menu-mobile-see-all">' + C.products.seeAll + ' <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg></a>',
      '</div>',
    '</div>'
  ].join('');

  var RESSOURCES_MOBILE_HREFS = orDefault(RESSOURCES_LEFT_HREFS.concat(RESSOURCES_RIGHT_HREFS), ['/a-propos-de-rainbow', '/rainbow-donnees-hebergees-en-france', '/faq', '/blog', '/partenaires']);
  var RESSOURCES_MOBILE_ICONS = orDefault(RESSOURCES_LEFT_ICONS.concat(RESSOURCES_RIGHT_ICONS), ['information-circle', 'lock-closed', 'question-mark-circle', 'newspaper', 'users']);

  var ressourcesMobileItems = C.ressources.mobileItems.map(function (item, i) {
    return makeMobileItem(url(RESSOURCES_MOBILE_HREFS[i]), RESSOURCES_MOBILE_ICONS[i], item[0], item[1]);
  }).join('');

  var ressourcesMobileHTML = [
    '<div class="mega-menu-mobile-content">',
      '<div class="mega-menu-mobile-section">',
        '<p class="mega-menu-mobile-section-title">' + C.ressources.sectionTitle + '</p>',
        ressourcesMobileItems,
      '</div>',
    '</div>'
  ].join('');

  var TARIFS_HREFS = orDefault(CMS_TARIFS && CMS_TARIFS.hrefs.main, ['/products/collaboration/pricing', '/products/webinar/pricing']);
  var TARIFS_ICONS = orDefault(CMS_TARIFS && CMS_TARIFS.icons.main, ['chat', 'video-camera']);

  var tarifsItems = C.tarifs.items.map(function (item, i) {
    return makeItem(url(TARIFS_HREFS[i]), TARIFS_ICONS[i], item[0], item[1]);
  }).join('');

  var tarifsHTML = [
    '<div class="mega-menu mega-menu-tarifs" role="menu">',
      '<div class="mega-menu-inner">',
        '<div class="mega-menu-main">',
          '<p class="mega-menu-section-title">' + C.tarifs.sectionTitle + '</p>',
          '<div class="mega-menu-grid">' + tarifsItems + '</div>',
          '<a href="' + url(L.tarifsAll) + '" class="mega-menu-see-all">' + C.tarifs.seeAll + ' <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg></a>',
        '</div>',
      '</div>',
      '<div class="mega-menu-footer">',
        '<p class="mega-menu-footer-text">' + C.tarifs.footerText + '</p>',
        '<div class="mega-menu-footer-actions">',
          '<a href="' + url(L.tarifsFooterPrimary) + '" class="mega-menu-btn mega-menu-btn-primary">' + svgIcon('lifebuoy') + C.tarifs.footerBtnPrimary + '</a>',
        '</div>',
      '</div>',
    '</div>'
  ].join('');

  var tarifsMobileItems = C.tarifs.itemsMobile.map(function (desc, i) {
    return makeMobileItem(url(TARIFS_HREFS[i]), TARIFS_ICONS[i], C.tarifs.items[i][0], desc);
  }).join('');

  var tarifsMobileHTML = [
    '<div class="mega-menu-mobile-content">',
      '<div class="mega-menu-mobile-section">',
        '<p class="mega-menu-mobile-section-title">' + C.tarifs.sectionTitle + '</p>',
        tarifsMobileItems,
        '<a href="' + url(L.tarifsAll) + '" class="mega-menu-mobile-see-all">' + C.tarifs.seeAll + ' <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg></a>',
      '</div>',
    '</div>'
  ].join('');

  function setupDropdown(dd, trigger, megaHTML, mobileHTML) {
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');

    trigger.insertAdjacentHTML('afterend', megaHTML);

    var mega = dd.querySelector('.mega-menu');
    if (!mega) return;

    var isOpen = false;
    var hoverTimeout = null;

    function openMenu() {
      if (hoverTimeout) { clearTimeout(hoverTimeout); hoverTimeout = null; }
      dd.classList.add('mega-open');
      trigger.setAttribute('aria-expanded', 'true');
      isOpen = true;
    }

    function closeMenu() {
      if (hoverTimeout) { clearTimeout(hoverTimeout); hoverTimeout = null; }
      dd.classList.remove('mega-open');
      trigger.setAttribute('aria-expanded', 'false');
      isOpen = false;
    }

    dd.addEventListener('mouseenter', function () {
      if (window.innerWidth < 821) return;
      if (hoverTimeout) clearTimeout(hoverTimeout);
      hoverTimeout = setTimeout(openMenu, 30);
    });

    dd.addEventListener('mouseleave', function () {
      if (window.innerWidth < 821) return;
      if (hoverTimeout) clearTimeout(hoverTimeout);
      hoverTimeout = setTimeout(closeMenu, 150);
    });

    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      if (window.innerWidth >= 821) return;
      if (isOpen) { closeMenu(); } else { openMenu(); }
    });

    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        openMenu();
        var firstItem = mega.querySelector('[role="menuitem"]');
        if (firstItem) firstItem.focus();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen) {
        closeMenu();
        trigger.focus();
      }
    });

    mega.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeMenu();
        trigger.focus();
        return;
      }
      if (e.key === 'Tab') {
        var items = mega.querySelectorAll('[role="menuitem"], a, button');
        if (!items.length) return;
        var first = items[0];
        var lastItem = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          closeMenu();
          trigger.focus();
        } else if (!e.shiftKey && document.activeElement === lastItem) {
          e.preventDefault();
          closeMenu();
          trigger.focus();
        }
      }
    });

  }

  function initMegaMenu() {
    var dropdowns = document.querySelectorAll('.nav-dropdown');
    if (!dropdowns.length) return;

    for (var i = 0; i < dropdowns.length; i++) {
      var dd = dropdowns[i];
      var trigger = dd.querySelector('a');
      if (!trigger) continue;

      // Detect by the trigger's own label in the active language, with the
      // dropdown's hrefs as a fallback. This used to key off a data-i18n
      // attribute, but translation markers are consumed at build time and are
      // not present in served HTML.
      var triggerText = trigger.textContent.trim().toLowerCase();
      var isProducts = triggerText === C.navWords.produits ||
        dd.querySelector('a[href*="/products/"]') !== null;
      var isRessources = triggerText === C.navWords.ressources;
      var isTarifs = triggerText === C.navWords.tarifs;
      if (!isProducts && !isRessources && !isTarifs) continue;

      var megaHTML, mobileHTML;
      if (isProducts) {
        megaHTML = productsHTML;
        mobileHTML = productsMobileHTML;
      } else if (isRessources) {
        megaHTML = ressourcesHTML;
        mobileHTML = ressourcesMobileHTML;
      } else {
        megaHTML = tarifsHTML;
        mobileHTML = tarifsMobileHTML;
      }

      setupDropdown(dd, trigger, megaHTML, mobileHTML);
    }

    var submenus = document.querySelectorAll('.mobile-submenu');
    for (var j = 0; j < submenus.length; j++) {
      var sm = submenus[j];
      if (!sm.querySelector('a')) continue;

      // Detect section type from the header label in the active language, with
      // the submenu's own link hrefs as the fallback. (Translation markers are
      // consumed at build time, so they are not available to match on here.)
      var headerEl = sm.previousElementSibling;
      var headerText = headerEl ? headerEl.textContent.trim().toLowerCase() : '';

      var mobileContent;
      if (headerText.indexOf('produit') !== -1 || headerText.indexOf('product') !== -1 ||
          headerText.indexOf('produkte') !== -1 || sm.querySelector('a[href*="/products/"]')) {
        mobileContent = productsMobileHTML;
      } else if (headerText.indexOf('tarif') !== -1 || headerText.indexOf('pricing') !== -1 ||
          headerText.indexOf('preise') !== -1 || sm.querySelector('a[href*="/tarif"]')) {
        mobileContent = tarifsMobileHTML;
      } else if (headerText.indexOf('ressource') !== -1 || headerText.indexOf('resource') !== -1 ||
          headerText.indexOf('ressourcen') !== -1 ||
          sm.querySelector('a[href*="/blog"], a[href*="/support"]')) {
        mobileContent = ressourcesMobileHTML;
      } else {
        continue;
      }

      sm.style.display = 'none';
      var wrapper = document.createElement('div');
      wrapper.innerHTML = mobileContent;
      var mobileEl = wrapper.firstElementChild;
      if (!mobileEl) continue;
      sm.parentNode.insertBefore(mobileEl, sm.nextSibling);

      // Accordion toggle  uses CSS classes (mob-section-hdr / is-open / mob-chev)
      if (headerEl && headerEl.tagName === 'A') {
        (function (content, header) {
          var SVGNS = 'http://www.w3.org/2000/svg';
          var chevron = document.createElementNS(SVGNS, 'svg');
          chevron.setAttribute('fill', 'none');
          chevron.setAttribute('viewBox', '0 0 24 24');
          chevron.setAttribute('stroke', 'currentColor');
          chevron.setAttribute('stroke-width', '2');
          chevron.setAttribute('aria-hidden', 'true');
          chevron.setAttribute('class', 'mob-chev');
          var chevPath = document.createElementNS(SVGNS, 'path');
          chevPath.setAttribute('stroke-linecap', 'round');
          chevPath.setAttribute('stroke-linejoin', 'round');
          chevPath.setAttribute('d', 'M19 9l-7 7-7-7');
          chevron.appendChild(chevPath);
          header.classList.add('mob-section-hdr');
          header.appendChild(chevron);

          header.addEventListener('click', function (e) {
            e.preventDefault();
            var opening = !content.classList.contains('open');
            document.querySelectorAll('#mobile-menu .mega-menu-mobile-content').forEach(function (c) {
              c.classList.remove('open');
            });
            document.querySelectorAll('#mobile-menu .mob-section-hdr').forEach(function (h) {
              h.classList.remove('is-open');
            });
            if (opening) {
              content.classList.add('open');
              header.classList.add('is-open');
            }
          });
        })(mobileEl, headerEl);
      }
    }

    // Hamburger ↔ X icon  reacts to #mobile-menu hidden class changes
    var mobileBtn   = document.getElementById('mobile-menu-btn');
    var mobilePanel = document.getElementById('mobile-menu');
    var hamSVG   = '<svg class="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/></svg>';
    var closeSVG = '<svg class="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';

    if (mobileBtn && mobilePanel) {
      mobileBtn.addEventListener('click', function () {
        mobilePanel.classList.toggle('hidden');
      });

      new MutationObserver(function () {
        var isHidden = mobilePanel.classList.contains('hidden');
        mobileBtn.innerHTML = isHidden ? hamSVG : closeSVG;
        if (isHidden) {
          mobilePanel.querySelectorAll('.mega-menu-mobile-content').forEach(function (c) { c.classList.remove('open'); });
          mobilePanel.querySelectorAll('.mob-section-hdr').forEach(function (h) { h.classList.remove('is-open'); });
        }
      }).observe(mobilePanel, { attributes: true, attributeFilter: ['class'] });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMegaMenu);
  } else {
    initMegaMenu();
  }
})();
