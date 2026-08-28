/*
 * article.js — render a database article through the authored article page.
 *
 * The one article that shipped with the site defines what a Rainbow article
 * looks like: breadcrumb, header with category, dates and author, contents list,
 * prose column, related cards, footer. Rather than rebuild that in components
 * (and drift from it), a new post is poured into the same markup — the schema
 * attributes, classes and spacing are the authored ones, only the content is
 * the editor's.
 *
 * Substitutions are anchored on the microdata attributes the template already
 * carries (itemprop="headline", itemprop="articleBody", ...), which are stable
 * because they are what search engines read.
 *
 * Four things in the template were written for the article it shipped with and
 * are now driven by the post: the breadcrumb's category and title, the contents
 * list, the related cards, and the reading time. Left alone they were a
 * convincing lie — the same six chapter links and the same three "similar
 * articles" on every post, two of which pointed at slugs that do not exist.
 */
import { apiGet } from './api.js';
import { stripMarkers } from '@rainbow/core/units';
import { replaceElementInner as replaceInner } from '@rainbow/core/html';
import { renderArticleBody } from '@rainbow/core/article';

const ARTICLE_TEMPLATE_KEY = 'blog-the-power-of-rainbow';

function replaceAttr(html, tagPattern, attrName, value) {
  const re = new RegExp(`(<[a-zA-Z0-9-]+[^>]*${tagPattern}[^>]*?\\s${attrName}=")[^"]*(")`, 'i');
  return html.replace(re, `$1${String(value).replace(/"/g, '&quot;')}$2`);
}

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const initials = (name) => String(name || '')
  .split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

/** `Travail hybride` → `travail-hybride`, for the category filter link. */
/*
 * A form in an article body needs the same submit handler a page block loads.
 *
 * The block can load it with a `<script>` of its own; an article body is a
 * string spliced into the template, and a script tag inside `articleBody` would
 * sit inside the prose. It goes in the page's footer snippet instead — and only
 * when the body actually contains a form, so an article without one ships no
 * extra request.
 */
function withFormScript(snippets, bodyHtml) {
  if (!String(bodyHtml || '').includes('data-cms-form')) return snippets;
  const base = snippets || {};
  const tag = '<script src="/js/cms-form.js" defer></script>';
  const footer = base.footer || '';
  if (footer.includes('/js/cms-form.js')) return base;
  return { ...base, footer: `${footer}
${tag}` };
}

const slug = (s) => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Pour one post into the authored article markup.
 * Returns { page, extra } ready for renderPage().
 */
export async function renderArticle(article, locale, {
  blogSegment = 'blog',
  baseUrl = '',
  /*
   * Tag each body section with the key it came from.
   *
   * Only ever set by the editor's canvas, which uses it to scroll to the section
   * being edited. A published article carries no such attribute, the same way a
   * published page carries no block annotations.
   */
  annotate = false,
} = {}) {
  const post = article.post;
  const template = await apiGet(
    `/api/v1/site/page?key=${ARTICLE_TEMPLATE_KEY}&locale=${locale}`,
    { ttl: 300 },
  ).then(r => r?.page || null);

  if (!template) return { page: null, extra: {} };

  const dateFormat = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' });
  const published = post.publishedAt ? new Date(post.publishedAt) : new Date();
  const modified = post.updatedAt ? new Date(post.updatedAt) : published;
  const blogHref = `/${locale}/${blogSegment}`;

  // The body and its contents come out of one pass, so the anchors the contents
  // links point at are by construction the anchors the body emits.
  // The forms this article references, resolved by the API. A form section
  // renders through the same `renderForm` a page block uses, so a form in an
  // article is the same form — see packages/core/src/article.js.
  const body = renderArticleBody(post, { locale, forms: article.forms || {}, annotate });

  // The breadcrumb, the contents list, the article and the related cards all
  // live in one authored block (`main-content`), so every substitution happens
  // in one pass over it rather than being dispatched per block.
  const sections = template.sections.map((section) => {
    if (section.type !== 'html' || !section.html.includes('itemprop="articleBody"')) return section;

    // The template's own copy is marked up for translation; that copy belongs
    // to the article it shipped with, so the markers come off before the post's
    // content goes in — otherwise the catalogue would overwrite it at render.
    let html = stripMarkers(section.html);

    // Header
    html = replaceInner(html, 'itemprop="headline"', escapeHtml(post.title));
    if (post.category) {
      html = replaceInner(html, 'itemprop="articleSection"', escapeHtml(post.category));
    }
    html = replaceAttr(html, 'itemprop="datePublished"', 'content', published.toISOString());
    html = replaceAttr(html, 'itemprop="dateModified"', 'content', modified.toISOString());
    html = replaceAttr(html, 'itemprop="inLanguage"', 'content', locale);

    // Dates + reading time line
    html = html.replace(
      /(<time datetime=")[^"]*("[^>]*itemprop="datePublished"[^>]*>)[\s\S]*?(<\/time>)/i,
      `$1${published.toISOString().slice(0, 10)}$2${dateFormat.format(published)}$3`,
    );
    html = html.replace(
      /(<time datetime=")[^"]*("[^>]*itemprop="dateModified"[^>]*>)[\s\S]*?(<\/time>)/i,
      `$1${modified.toISOString().slice(0, 10)}$2${dateFormat.format(modified)}$3`,
    );
    // Reading time: the author's figure, or one derived from the word count at
    // 200 words a minute, which is closer than the template's fixed number.
    const minutes = post.readingMinutes || estimateMinutes(body.html);
    if (minutes) {
      html = html.replace(/(<strong class="text-navy-900">)[\s\S]*?(<\/strong>)/i, `$1${minutes} min$2`);
    }

    // Author
    if (post.authorName) {
      html = replaceInner(html, 'itemprop="name"', escapeHtml(post.authorName));
      html = html.replace(
        /(<span class="avatar"[^>]*>)[\s\S]*?(<\/span>)/i,
        `$1${escapeHtml(initials(post.authorName))}$2`,
      );
    }
    if (post.authorRole) {
      html = replaceAttr(html, 'itemprop="jobTitle"', 'content', post.authorRole);
    }

    // Hero image
    if (post.coverImage) {
      html = html.replace(
        /(<img\s[^>]*itemprop="url"[^>]*)/i,
        (m) => m
          .replace(/\ssrc="[^"]*"/i, ` src="${post.coverImage}"`)
          .replace(/\salt="[^"]*"/i, ` alt="${escapeHtml(post.coverAlt || post.title)}"`),
      );
    }

    html = withBreadcrumb(html, post, locale, blogHref);
    html = withContents(html, body.contents);
    html = replaceInner(html, 'itemprop="articleBody"', body.html);
    html = withRelated(html, article.related || [], blogHref, dateFormat);
    html = withShareLinks(html, post, locale, blogSegment, baseUrl);
    return { ...section, html, keys: [] };
  });

  const page = {
    ...template,
    key: `post:${post.slug}`,
    route: `${blogSegment}/${post.slug}`,
    title: post.title,
    pageKind: 'blogPost',
    locales: (article.translations || []).map(t => t.locale),
    noindex: post.status !== 'published',
    sections,
    seo: {
      ...(template.seo || {}),
      title: post.seo?.title || post.title,
      description: post.seo?.description || post.excerpt,
      keywords: post.seo?.keywords || (post.tags || []).join(', '),
      robots: post.seo?.robots,
      canonical: post.seo?.canonical,
      ogTitle: post.seo?.ogTitle || post.title,
      ogDescription: post.seo?.ogDescription || post.excerpt,
      ogImage: post.seo?.ogImage || post.coverImage,
      jsonLdOverride: post.seo?.jsonLdOverride || '',
      replaceAutoLd: !!post.seo?.replaceAutoLd,
    },
    // The template's own structured data describes the article it shipped with.
    jsonLd: [],
    snippets: withFormScript(post.snippets || template.snippets, body.html),
  };

  return { page, extra: { post, contents: body.contents } };
}

/**
 * Home › Blog › Category › Title.
 *
 * The template's third crumb said "Collaboration" on every article and linked to
 * `/fr/blog#collaboration`, an anchor that exists on no page. A post with no
 * category gets three crumbs rather than an empty one.
 */
function withBreadcrumb(html, post, locale, blogHref) {
  const crumbs = [
    `<li><a href="/${locale}">${escapeHtml(labelFor(locale, 'home'))}</a><span class="breadcrumb-sep" aria-hidden="true">›</span></li>`,
    `<li><a href="${blogHref}">${escapeHtml(labelFor(locale, 'blog'))}</a><span class="breadcrumb-sep" aria-hidden="true">›</span></li>`,
  ];
  if (post.category) {
    crumbs.push(
      `<li><a href="${blogHref}?category=${encodeURIComponent(slug(post.category))}">`
      + `${escapeHtml(post.category)}</a><span class="breadcrumb-sep" aria-hidden="true">›</span></li>`,
    );
  }
  crumbs.push(`<li aria-current="page"><span>${escapeHtml(post.title)}</span></li>`);

  return html.replace(/(<ol>)[\s\S]*?(<\/ol>)/i, `$1${crumbs.join('')}$2`);
}

/**
 * The contents list, from the article's own sections.
 *
 * When an article has no headings there is nothing to list, and a "Sommaire"
 * box containing one link to the top of the page is worse than no box — so the
 * whole control is removed.
 */
function withContents(html, contents) {
  if (!contents?.length) {
    return html.replace(/<nav\b[^>]*class="toc-container[^"]*"[\s\S]*?<\/nav>/i, '');
  }
  const items = contents.map(entry => (
    `<li${entry.level === 3 ? ' style="padding-left:12px"' : ''}>`
    + `<a href="#${entry.id}">${escapeHtml(entry.label)}</a></li>`
  )).join('');
  return html.replace(
    /(<ol class="toc-list" id="toc-list">)[\s\S]*?(<\/ol>)/i,
    `$1${items}$2`,
  );
}

/**
 * The related cards, from what the API actually returned.
 *
 * The template carried three hand-written cards; two pointed at articles that
 * were never written, which `verify-assets` has been reporting as broken links
 * since the migration. With nothing to relate to, the section is dropped rather
 * than left showing empty boxes.
 */
function withRelated(html, related, blogHref, dateFormat) {
  if (!related.length) {
    return html.replace(/<section\b[^>]*aria-labelledby="related-articles-heading"[\s\S]*?<\/section>/i, '');
  }

  const cards = related.map((post) => {
    const cover = post.coverImage
      ? `<img src="${escapeHtml(post.coverImage)}" alt="${escapeHtml(post.coverAlt || '')}" loading="lazy" decoding="async" class="h-44 w-full object-cover">`
      : '<div class="h-44 bg-gradient-to-br from-brand-100 to-indigo-100" aria-hidden="true"></div>';
    const date = post.publishedAt ? new Date(post.publishedAt) : null;
    const meta = [
      date ? `<time datetime="${date.toISOString().slice(0, 10)}">${dateFormat.format(date)}</time>` : '',
      post.readingMinutes ? `${post.readingMinutes} min` : '',
    ].filter(Boolean).join(' · ');

    return '<article class="group bg-white rounded-2xl border border-brand-100/60 overflow-hidden hover:shadow-lg transition-all duration-300 flex flex-col">'
      + `<a href="${blogHref}/${escapeHtml(post.slug)}" class="flex flex-col flex-1">`
      + cover
      + '<div class="p-5 flex flex-col flex-1">'
      + (post.category
        ? `<span class="text-xs font-semibold text-brand-500 uppercase tracking-wide mb-2">${escapeHtml(post.category)}</span>`
        : '')
      + `<h3 class="font-bold text-navy-900 text-sm leading-snug mb-3 group-hover:text-brand-600 transition-colors">${escapeHtml(post.title)}</h3>`
      + (post.excerpt
        ? `<p class="text-gray-500 text-xs leading-relaxed flex-1">${escapeHtml(post.excerpt)}</p>`
        : '<p class="flex-1"></p>')
      + (meta ? `<div class="mt-4 text-xs text-gray-400">${meta}</div>` : '')
      + '</div></a></article>';
  }).join('');

  return html.replace(
    /(<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">)[\s\S]*?(<\/div>\s*<\/div>\s*<\/div>\s*<\/section>)/i,
    `$1${cards}$2`,
  );
}

/**
 * Fill in the share buttons on the server.
 *
 * The authored template sets them from an inline script, but that script starts
 * by writing to `#meta-canonical` — a tag the CMS now owns and emits without an
 * id, because the script's version of it was `location.href`, which is wrong for
 * any URL with a query string. So the script throws on its first line and
 * everything after it, including these two links, never runs.
 *
 * Restoring the id would fix the throw and reintroduce two worse bugs: a
 * client-side canonical, and an `og:image` hardcoded to one article's hero photo
 * for every article on the site. Setting the hrefs here fixes the symptom
 * without giving that script authority over the page's metadata again.
 */
function withShareLinks(html, post, locale, blogSegment, baseUrl) {
  const url = `${String(baseUrl || '').replace(/\/+$/, '')}/${locale}/${blogSegment}/${post.slug}`;
  const encoded = encodeURIComponent(url);
  const links = {
    'share-linkedin': `https://www.linkedin.com/sharing/share-offsite/?url=${encoded}`,
    'share-x': `https://twitter.com/intent/tweet?url=${encoded}&text=${encodeURIComponent(post.title)}`,
  };
  let out = html;
  for (const [id, href] of Object.entries(links)) {
    out = out.replace(
      new RegExp(`(<a\\s[^>]*id="${id}"[^>]*)`, 'i'),
      (m) => (/\shref="/.test(m) ? m.replace(/\shref="[^"]*"/, ` href="${href}"`) : `${m} href="${href}"`),
    );
  }
  return out;
}

/** 200 words a minute, rounded up, never zero for an article with words in it. */
function estimateMinutes(html) {
  const words = String(html || '').replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  return words ? Math.max(1, Math.round(words / 200)) : 0;
}

/**
 * The two breadcrumb words, per locale.
 *
 * Small enough to keep here: they are structural navigation labels, not
 * marketing copy, and routing them through the catalogue would mean an article
 * breadcrumb that says nothing until somebody remembers to translate two keys.
 */
const LABELS = {
  fr: { home: 'Accueil', blog: 'Blog' },
  en: { home: 'Home', blog: 'Blog' },
  de: { home: 'Startseite', blog: 'Blog' },
};
const labelFor = (locale, key) => LABELS[locale]?.[key] || LABELS.en[key];

