/*
 * article.js — render a database article through the authored article page.
 *
 * The one article that shipped with the site defines what a Rainbow article
 * looks like: breadcrumb, header with category, dates and author, hero figure,
 * prose column, related cards, footer. Rather than rebuild that in components
 * (and drift from it), a new post is poured into the same markup — the schema
 * attributes, classes and spacing are the authored ones, only the content is
 * the editor's.
 *
 * Substitutions are anchored on the microdata attributes the template already
 * carries (itemprop="headline", itemprop="articleBody", ...), which are stable
 * because they are what search engines read.
 */
import { apiGet } from './api.js';
import { stripMarkers } from '@rainbow/core/units';

const ARTICLE_TEMPLATE_KEY = 'blog-the-power-of-rainbow';

function replaceInner(html, openTagPattern, value) {
  const re = new RegExp(`(<([a-zA-Z0-9-]+)[^>]*${openTagPattern}[^>]*>)([\\s\\S]*?)(</\\2>)`, 'i');
  return html.replace(re, (_m, open, _tag, _inner, close) => `${open}${value}${close}`);
}

function replaceAttr(html, tagPattern, attrName, value) {
  const re = new RegExp(`(<[a-zA-Z0-9-]+[^>]*${tagPattern}[^>]*?\\s${attrName}=")[^"]*(")`, 'i');
  return html.replace(re, `$1${String(value).replace(/"/g, '&quot;')}$2`);
}

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const initials = (name) => String(name || '')
  .split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

/**
 * Pour one post into the authored article markup.
 * Returns { page, extra } ready for renderPage().
 */
export async function renderArticle(article, locale) {
  const post = article.post;
  const template = await apiGet(
    `/api/v1/site/page?key=${ARTICLE_TEMPLATE_KEY}&locale=${locale}`,
    { ttl: 300 },
  ).then(r => r?.page || null);

  if (!template) return { page: null, extra: {} };

  const dateFormat = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' });
  const published = post.publishedAt ? new Date(post.publishedAt) : new Date();
  const modified = post.updatedAt ? new Date(post.updatedAt) : published;

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
    if (post.readingMinutes) {
      html = html.replace(
        /(<strong class="text-navy-900">)[\s\S]*?(<\/strong>)/i,
        `$1${post.readingMinutes} min$2`,
      );
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

    // Body
    html = replaceInner(html, 'itemprop="articleBody"', post.bodyHtml || '');
    return { ...section, html, keys: [] };
  });

  const componentBlocks = (post.blocks || [])
    .filter(b => b.visible !== false)
    .map((b, i) => ({
      key: b.key || `post-block-${i}`,
      type: 'component',
      visible: true,
      componentKey: b.componentKey,
      data: b.data || {},
      layout: b.layout || {},
      anchorId: null,
    }));

  const page = {
    ...template,
    key: `post:${post.slug}`,
    route: `blog/${post.slug}`,
    title: post.title,
    pageKind: 'blogPost',
    locales: (article.translations || []).map(t => t.locale),
    noindex: post.status !== 'published',
    sections: insertAfterArticle(sections, componentBlocks),
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
    snippets: post.snippets || template.snippets,
  };

  return { page, extra: { post } };
}

function insertAfterArticle(sections, blocks) {
  if (!blocks.length) return sections;
  const at = sections.findIndex(s => s.type === 'html' && s.html.includes('itemprop="articleBody"'));
  if (at < 0) return [...sections, ...blocks];
  return [...sections.slice(0, at + 1), ...blocks, ...sections.slice(at + 1)];
}
