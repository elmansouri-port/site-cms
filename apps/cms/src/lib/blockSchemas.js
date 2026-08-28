/*
 * blockSchemas.js — what each component block asks the editor for.
 *
 * The Astro components are the renderers; these are the forms that fill them.
 * Keeping the two in step is a small manual contract, and a deliberate one:
 * the alternative (deriving forms from the components) would make every field
 * label a code change.
 *
 * Each schema also carries the metadata the insert palette needs — a category,
 * a one-line description of what the block is for, and a wireframe that shows
 * its shape. An editor choosing a block should be looking at pictures, not
 * reading a dropdown of identifiers.
 *
 * `i18n: true` on a field makes it one value per language rather than one value
 * for the site. Component blocks held a single string, so a block on a
 * trilingual site said the same thing in all three; the blog index is the first
 * block that could not live with that. See packages/core/src/i18nData.js.
 *
 * type: text | textarea | html | code | number | boolean | select | media | list | lines
 *     | link       — a destination chosen from the pages, articles and anchors that
 *                    exist, stored as a reference so it survives a rename (LinkPicker)
 *     | formTarget — where a form's submissions go: a lead type, or an integration
 */

export const BLOCK_CATEGORIES = [
  { key: 'hero', label: 'Openers' },
  { key: 'content', label: 'Content' },
  { key: 'proof', label: 'Proof & numbers' },
  { key: 'convert', label: 'Conversion' },
  { key: 'advanced', label: 'Advanced' },
];

export const BLOCK_SCHEMAS = {
  hero: {
    label: 'Hero',
    category: 'hero',
    description: 'Full-width opener: headline, subtitle, two buttons and an image.',
    wireframe: ['title-lg', 'text', 'buttons', 'image'],
    fields: [
      { name: 'eyebrow', label: 'Eyebrow', type: 'text' },
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'highlight', label: 'Highlighted word', type: 'text', hint: 'Rendered in brand purple after the title.' },
      { name: 'subtitle', label: 'Subtitle', type: 'textarea' },
      { name: 'primaryLabel', label: 'Primary button', type: 'text' },
      { name: 'primaryHref', label: 'Primary button goes to', type: 'link' },
      { name: 'primaryNewTab', label: 'Open in a new tab', type: 'boolean' },
      { name: 'secondaryLabel', label: 'Secondary button', type: 'text' },
      { name: 'secondaryHref', label: 'Secondary button goes to', type: 'link' },
      { name: 'secondaryNewTab', label: 'Open in a new tab', type: 'boolean' },
      { name: 'image', label: 'Image', type: 'media' },
      { name: 'imageAlt', label: 'Image alt text', type: 'text', hint: 'Describe the image. Required for accessibility and read by image search.' },
      { name: 'align', label: 'Alignment', type: 'select', options: ['center', 'left'] },
    ],
  },
  cta_banner: {
    label: 'CTA banner',
    category: 'convert',
    description: 'A band that asks for the click. Use one per page, near the end.',
    wireframe: ['title', 'text', 'buttons'],
    fields: [
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'subtitle', label: 'Subtitle', type: 'textarea' },
      { name: 'primaryLabel', label: 'Primary button', type: 'text' },
      { name: 'primaryHref', label: 'Primary button goes to', type: 'link' },
      { name: 'primaryNewTab', label: 'Open in a new tab', type: 'boolean' },
      { name: 'secondaryLabel', label: 'Secondary button', type: 'text' },
      { name: 'secondaryHref', label: 'Secondary button goes to', type: 'link' },
      { name: 'secondaryNewTab', label: 'Open in a new tab', type: 'boolean' },
      { name: 'background', label: 'Background image', type: 'media' },
    ],
  },
  faq_accordion: {
    label: 'FAQ accordion',
    category: 'content',
    description: 'Questions and answers. Emits FAQ structured data for search results.',
    wireframe: ['title', 'rows'],
    fields: [
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'subtitle', label: 'Subtitle', type: 'textarea' },
      {
        name: 'items',
        label: 'Questions',
        type: 'list',
        itemLabel: 'question',
        fields: [
          { name: 'question', label: 'Question', type: 'text' },
          { name: 'answer', label: 'Answer', type: 'html' },
        ],
      },
    ],
  },
  feature_grid: {
    label: 'Feature grid',
    category: 'content',
    description: 'Two to four columns of icon, title and a line of copy.',
    wireframe: ['title', 'grid-3'],
    fields: [
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'subtitle', label: 'Subtitle', type: 'textarea' },
      { name: 'columns', label: 'Columns', type: 'select', options: [2, 3, 4] },
      {
        name: 'items',
        label: 'Features',
        type: 'list',
        itemLabel: 'title',
        fields: [
          { name: 'icon', label: 'Icon', type: 'media' },
          { name: 'title', label: 'Title', type: 'text' },
          { name: 'description', label: 'Description', type: 'textarea' },
          { name: 'linkLabel', label: 'Link label', type: 'text' },
          { name: 'linkHref', label: 'Link goes to', type: 'link' },
          { name: 'linkNewTab', label: 'Open in a new tab', type: 'boolean' },
        ],
      },
    ],
  },
  stats_band: {
    label: 'Stats band',
    category: 'proof',
    description: 'Big numbers that count up as they scroll into view.',
    wireframe: ['stats'],
    fields: [
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'animate', label: 'Animate the numbers on scroll', type: 'boolean' },
      {
        name: 'items',
        label: 'Metrics',
        type: 'list',
        itemLabel: 'label',
        fields: [
          { name: 'value', label: 'Value', type: 'number' },
          { name: 'suffix', label: 'Suffix', type: 'text', hint: 'e.g. % or +' },
          { name: 'label', label: 'Label', type: 'text' },
          { name: 'duration', label: 'Animation (ms)', type: 'number' },
        ],
      },
    ],
  },
  logo_marquee: {
    label: 'Logo marquee',
    category: 'proof',
    description: 'A scrolling row of customer logos.',
    wireframe: ['logos'],
    fields: [
      { name: 'title', label: 'Title', type: 'text' },
      {
        name: 'logos',
        label: 'Logos',
        type: 'list',
        itemLabel: 'alt',
        fields: [
          { name: 'src', label: 'Image', type: 'media' },
          { name: 'alt', label: 'Company name', type: 'text' },
        ],
      },
    ],
  },
  rich_text: {
    label: 'Rich text',
    category: 'content',
    description: 'A column of prose. The workhorse for long-form copy.',
    wireframe: ['title', 'text', 'text'],
    fields: [
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'html', label: 'Content', type: 'html', rows: 14 },
      { name: 'width', label: 'Width', type: 'select', options: ['prose', 'wide'] },
    ],
  },
  image_text: {
    label: 'Image + text',
    category: 'content',
    description: 'Half image, half copy. Alternate the side down a page.',
    wireframe: ['split'],
    fields: [
      { name: 'eyebrow', label: 'Eyebrow', type: 'text' },
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'html', label: 'Body', type: 'html' },
      { name: 'image', label: 'Image', type: 'media' },
      { name: 'imageAlt', label: 'Image alt text', type: 'text', hint: 'Describe the image. Required for accessibility and read by image search.' },
      { name: 'reverse', label: 'Image on the left', type: 'boolean' },
      { name: 'linkLabel', label: 'Link label', type: 'text' },
      { name: 'linkHref', label: 'Link goes to', type: 'link' },
      { name: 'linkNewTab', label: 'Open in a new tab', type: 'boolean' },
    ],
  },
  pricing_cards: {
    label: 'Pricing cards',
    category: 'convert',
    description: 'Plan cards with an optional monthly/yearly toggle.',
    wireframe: ['cards-3'],
    fields: [
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'subtitle', label: 'Subtitle', type: 'textarea' },
      { name: 'showToggle', label: 'Show the monthly/yearly toggle', type: 'boolean' },
      { name: 'monthlyLabel', label: 'Monthly label', type: 'text' },
      { name: 'yearlyLabel', label: 'Yearly label', type: 'text' },
      {
        name: 'plans',
        label: 'Plans',
        type: 'list',
        itemLabel: 'name',
        fields: [
          { name: 'name', label: 'Plan name', type: 'text' },
          { name: 'badge', label: 'Badge', type: 'text' },
          { name: 'description', label: 'Description', type: 'textarea' },
          { name: 'priceMonthly', label: 'Monthly price', type: 'text' },
          { name: 'priceYearly', label: 'Yearly price', type: 'text' },
          { name: 'period', label: 'Period suffix', type: 'text' },
          { name: 'features', label: 'Features (one per line)', type: 'lines' },
          { name: 'ctaLabel', label: 'Button label', type: 'text' },
          { name: 'ctaHref', label: 'Button goes to', type: 'link' },
          { name: 'ctaNewTab', label: 'Open in a new tab', type: 'boolean' },
          { name: 'highlighted', label: 'Highlight this plan', type: 'boolean' },
        ],
      },
      {
        name: 'footnotes',
        label: 'Footnotes',
        type: 'list',
        itemLabel: 'title',
        fields: [
          { name: 'title', label: 'Title', type: 'text' },
          { name: 'text', label: 'Text', type: 'textarea' },
        ],
      },
    ],
  },
  video: {
    label: 'Video',
    category: 'content',
    description: 'A hosted file or a YouTube embed, with a poster frame.',
    wireframe: ['video'],
    fields: [
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'src', label: 'Video file', type: 'media' },
      { name: 'youtubeId', label: 'YouTube id', type: 'text', hint: 'Used instead of a file when set.' },
      { name: 'thumbnail', label: 'Thumbnail', type: 'media', hint: 'Shown until the video is ready. Falls back to the default behaviour when empty.' },
      { name: 'caption', label: 'Caption', type: 'text' },
      { name: 'autoplay', label: 'Autoplay', type: 'boolean' },
      { name: 'loop', label: 'Loop', type: 'boolean' },
      { name: 'muted', label: 'Muted', type: 'boolean' },
    ],
  },
  article_list: {
    label: 'Article list',
    category: 'content',
    description: 'The latest blog posts, pulled live. No editing needed after setup.',
    wireframe: ['cards-3'],
    fields: [
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'subtitle', label: 'Subtitle', type: 'textarea' },
      { name: 'limit', label: 'How many', type: 'number' },
      { name: 'category', label: 'Category filter', type: 'text' },
      { name: 'ctaLabel', label: 'Link to the blog', type: 'text' },
    ],
  },
  /*
   * The blog's own front page.
   *
   * Not the same thing as `article_list`, which is three cards dropped onto any
   * page. This is the index: search, category pills, a lead article and real
   * pagination, all of it reading the URL — so a filtered blog is a page rather
   * than a DOM state. One per site, on the page whose route is the blog segment.
   */
  blog_index: {
    label: 'Blog index',
    category: 'content',
    description: 'The blog front page: search, categories, a lead article and pagination. Reads the articles that exist.',
    wireframe: ['title-lg', 'buttons', 'split', 'cards-3'],
    fields: [
      { name: 'title', label: 'Page title', type: 'text', i18n: true, hint: 'The H1 above the search box.' },
      { name: 'searchPlaceholder', label: 'Search box placeholder', type: 'text', i18n: true },
      { name: 'allLabel', label: '"All categories" pill', type: 'text', i18n: true },
      { name: 'recentTitle', label: 'Heading above the grid', type: 'text', i18n: true },
      { name: 'recentIntro', label: 'Intro under that heading', type: 'textarea', i18n: true },
      { name: 'readMoreLabel', label: '"Read more" on the lead article', type: 'text', i18n: true },
      { name: 'moreLabel', label: 'Next page button', type: 'text', i18n: true },
      {
        name: 'perPage',
        label: 'Articles per page',
        type: 'number',
        hint: 'The lead article is shown above the grid and not repeated in it.',
      },
      { name: 'emptyTitle', label: 'When nothing matches — title', type: 'text', i18n: true },
      { name: 'emptyHint', label: 'When nothing matches — explanation', type: 'text', i18n: true },
      /*
       * The promo card beside the lead article.
       *
       * A slot, not an article: a guide, an ebook, whatever is being pushed this
       * month. Left empty, the lead article takes the full width rather than
       * leaving a gap where a card used to be.
       */
      { name: 'promo.badge', label: 'Promo — badge', type: 'text', i18n: true, hint: 'Leave the promo title empty and the lead article takes the full width.' },
      { name: 'promo.title', label: 'Promo — title', type: 'text', i18n: true },
      { name: 'promo.text', label: 'Promo — text', type: 'textarea', i18n: true },
      { name: 'promo.image', label: 'Promo — image', type: 'media' },
      { name: 'promo.imageAlt', label: 'Promo — image alt text', type: 'text', i18n: true },
      { name: 'promo.overlay', label: 'Promo — text over the image', type: 'text', i18n: true },
      { name: 'promo.ctaLabel', label: 'Promo — button', type: 'text', i18n: true },
      { name: 'promo.href', label: 'Promo — button goes to', type: 'link' },
    ],
  },
  form: {
    label: 'Form',
    category: 'convert',
    description: 'Capture an enquiry. Stored here first, then forwarded — so nothing is lost.',
    wireframe: ['title', 'text', 'rows', 'buttons'],
    fields: [
      {
        name: 'formKey',
        label: 'Form',
        type: 'form',
        hint: 'Built under Forms, and shareable: the same form on four pages is one thing to change.',
      },
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'subtitle', label: 'Subtitle', type: 'textarea' },
      /*
       * Everything below defines a form inside this block, for a one-off that is
       * not worth naming. It is hidden once a saved form is chosen, because the
       * two are alternatives — the block renders the saved one and would ignore
       * whatever was typed here.
       */
      {
        name: 'submitTo',
        label: 'Where submissions go',
        type: 'formTarget',
        hideWhen: 'formKey',
        hint: 'Every submission is stored under Leads either way. An integration also forwards it, server-side.',
      },
      {
        name: 'fields',
        label: 'Fields',
        hideWhen: 'formKey',
        type: 'list',
        itemLabel: 'label',
        fields: [
          { name: 'label', label: 'Label', type: 'text' },
          {
            name: 'name',
            label: 'Field name',
            type: 'text',
            hint: 'What the submission calls this value. Use email, name, company or phone for those, so they fill the matching columns under Leads.',
          },
          {
            name: 'type',
            label: 'Kind',
            type: 'select',
            options: ['text', 'email', 'tel', 'textarea', 'select', 'checkbox', 'number', 'url', 'date'],
          },
          { name: 'placeholder', label: 'Placeholder', type: 'text' },
          { name: 'options', label: 'Choices (one per line)', type: 'textarea', hint: 'For a dropdown.' },
          { name: 'required', label: 'Required', type: 'boolean' },
          { name: 'width', label: 'Full width', type: 'select', options: ['auto', 'full'] },
          { name: 'hint', label: 'Hint under the field', type: 'text' },
        ],
      },
      { name: 'columns', label: 'Columns', type: 'select', options: [1, 2], hideWhen: 'formKey' },
      { name: 'submitLabel', label: 'Button label', type: 'text', hideWhen: 'formKey' },
      {
        name: 'consentText',
        label: 'Small print',
        type: 'html',
        rows: 3,
        hideWhen: 'formKey',
        hint: 'Consent and privacy wording, shown under the fields. HTML, so it can carry a link to the policy.',
      },
      { name: 'successTitle', label: 'Thank-you title', type: 'text', hideWhen: 'formKey' },
      {
        name: 'successMessage',
        label: 'Thank-you message',
        type: 'textarea',
        hideWhen: 'formKey',
        hint: 'Shown in place of the form. Say what happens next and when.',
      },
      {
        name: 'redirectTo',
        label: 'Or send them to a page',
        type: 'link',
        hint: 'Leave empty to show the thank-you message in place. A separate page is worth it when you need a conversion URL for ads.',
      },
      { name: 'align', label: 'Alignment', type: 'select', options: ['left', 'center'] },
    ],
  },
  custom_html: {
    label: 'Custom block',
    category: 'advanced',
    description: 'Your own HTML with Tailwind classes. Full control, scoped CSS.',
    wireframe: ['code'],
    advanced: true,
    fields: [
      {
        name: 'html',
        label: 'HTML',
        type: 'code',
        language: 'html',
        rows: 20,
        hint: 'Tailwind utility classes work here — the site compiles them in the browser, so there is no build step to wait for.',
      },
      {
        name: 'css',
        label: 'CSS',
        type: 'code',
        language: 'css',
        rows: 8,
        hint: 'Scoped to this block automatically: `.card { … }` becomes `.cms-block-<key> .card { … }`, so it cannot leak into the rest of the page.',
      },
      { name: 'containerClass', label: 'Wrapper classes', type: 'text', hint: 'Applied to the block\'s own outer div.' },
      { name: 'contained', label: 'Constrain to the page width', type: 'boolean', hint: 'Adds the site\'s standard max-width and gutters. Leave off for a full-bleed band.' },
    ],
  },
  raw_html: {
    label: 'Embed / raw HTML',
    category: 'advanced',
    description: 'An unstyled escape hatch for a third-party embed or widget.',
    wireframe: ['code'],
    advanced: true,
    fields: [
      { name: 'html', label: 'HTML', type: 'code', language: 'html', rows: 16 },
    ],
  },
};

/**
 * What a block starts as when it is dropped onto a page.
 *
 * Only the blocks that are useless empty need one. A hero with no headline still
 * shows an editor a hero; a form with no fields cannot be submitted, renders as
 * a lone button, and gives nobody anything to react to.
 */
export const BLOCK_DEFAULTS = {
  form: {
    title: 'Talk to us',
    subtitle: 'Tell us what you need and we will come back to you within one working day.',
    submitTo: 'lead:contact',
    columns: 2,
    submitLabel: 'Send',
    successTitle: 'Thank you',
    successMessage: 'We have your details and will be in touch within one working day.',
    consentText: 'By sending this form you agree to us contacting you about your enquiry. '
      + 'We do not share your details with anyone else.',
    fields: [
      { label: 'First name', name: 'firstName', type: 'text', required: true, autocomplete: 'given-name' },
      { label: 'Last name', name: 'lastName', type: 'text', required: true, autocomplete: 'family-name' },
      { label: 'Work email', name: 'email', type: 'email', required: true, autocomplete: 'email' },
      { label: 'Company', name: 'company', type: 'text', autocomplete: 'organization' },
      { label: 'Phone', name: 'phone', type: 'tel', autocomplete: 'tel' },
      { label: 'How many people work with you?', name: 'size', type: 'select', options: '1–20\n21–100\n101–500\n500+' },
      { label: 'What can we help with?', name: 'message', type: 'textarea', width: 'full' },
    ],
  },
};

/**
 * Starting points for the custom block.
 *
 * A blank code box is the least useful thing to hand somebody. These are the
 * layouts people actually reach for, written in the site's own Tailwind theme
 * (brand purple, Google Sans, the 10px button radius) so a pasted starter looks
 * like a Rainbow section from the first render rather than a bootstrap demo.
 */
export const CUSTOM_PRESETS = [
  {
    key: 'blank',
    label: 'Blank',
    description: 'An empty section with the page gutters.',
    data: {
      contained: true,
      html: '<div class="py-20">\n  <h2 class="text-3xl font-bold text-gray-900">Section title</h2>\n  <p class="mt-3 text-lg text-gray-600">Say something worth reading.</p>\n</div>\n',
    },
  },
  {
    key: 'two-column',
    label: 'Two columns',
    description: 'Copy beside an image, stacking on mobile.',
    data: {
      contained: true,
      html: `<div class="py-20 grid gap-12 lg:grid-cols-2 lg:items-center">
  <div>
    <p class="text-sm font-semibold uppercase tracking-wider text-brand-500">Eyebrow</p>
    <h2 class="mt-2 text-3xl font-bold text-gray-900 sm:text-4xl">A claim worth making</h2>
    <p class="mt-4 text-lg text-gray-600">One paragraph that earns the next click. Keep it to two sentences.</p>
    <a href="#" class="mt-6 inline-flex rounded-btn bg-brand-500 px-6 py-3 font-semibold text-white transition hover:bg-brand-600">Get started</a>
  </div>
  <img src="/images/rainbow-ui.jpg" alt="Describe this image" class="w-full rounded-2xl shadow-xl" />
</div>
`,
    },
  },
  {
    key: 'three-cards',
    label: 'Three cards',
    description: 'A row of cards that lifts on hover.',
    data: {
      contained: true,
      html: `<div class="py-20">
  <h2 class="text-center text-3xl font-bold text-gray-900">Three reasons</h2>
  <div class="mt-12 grid gap-6 md:grid-cols-3">
    <div class="group rounded-2xl border border-gray-200 bg-white p-8 transition hover:-translate-y-1 hover:shadow-xl">
      <h3 class="text-lg font-semibold text-gray-900">First reason</h3>
      <p class="mt-2 text-gray-600">A sentence of support. Concrete beats clever.</p>
    </div>
    <div class="group rounded-2xl border border-gray-200 bg-white p-8 transition hover:-translate-y-1 hover:shadow-xl">
      <h3 class="text-lg font-semibold text-gray-900">Second reason</h3>
      <p class="mt-2 text-gray-600">A sentence of support. Concrete beats clever.</p>
    </div>
    <div class="group rounded-2xl border border-gray-200 bg-white p-8 transition hover:-translate-y-1 hover:shadow-xl">
      <h3 class="text-lg font-semibold text-gray-900">Third reason</h3>
      <p class="mt-2 text-gray-600">A sentence of support. Concrete beats clever.</p>
    </div>
  </div>
</div>
`,
    },
  },
  {
    key: 'banner',
    label: 'Gradient banner',
    description: 'A full-bleed brand band with one call to action.',
    data: {
      contained: false,
      html: `<div class="bg-gradient-to-br from-brand-500 to-navy-900 px-6 py-20 text-center">
  <h2 class="mx-auto max-w-2xl text-3xl font-bold text-white sm:text-4xl">Ready when you are</h2>
  <p class="mx-auto mt-4 max-w-xl text-lg text-white/80">One line that removes the last objection.</p>
  <a href="#" class="mt-8 inline-flex rounded-btn bg-white px-7 py-3 font-semibold text-brand-500 transition hover:bg-gray-100">Start free</a>
</div>
`,
    },
  },
  {
    key: 'quote',
    label: 'Testimonial',
    description: 'One quote, attributed. Emits Review structured data.',
    data: {
      contained: true,
      html: `<figure class="py-20 text-center" itemscope itemtype="https://schema.org/Review">
  <blockquote class="mx-auto max-w-3xl text-2xl font-medium leading-relaxed text-gray-900" itemprop="reviewBody">
    “The sentence a customer actually said, not the one marketing wishes they had.”
  </blockquote>
  <figcaption class="mt-6 text-gray-600" itemprop="author" itemscope itemtype="https://schema.org/Person">
    <span class="font-semibold text-gray-900" itemprop="name">Full Name</span>
    <span class="mx-2 text-gray-300">·</span>
    <span itemprop="jobTitle">Role, Company</span>
  </figcaption>
</figure>
`,
    },
  },
];

/** Blocks grouped for the insert palette, in category order. */
export function paletteGroups() {
  return BLOCK_CATEGORIES.map(category => ({
    ...category,
    blocks: Object.entries(BLOCK_SCHEMAS)
      .filter(([, schema]) => (schema.category || 'content') === category.key)
      .map(([key, schema]) => ({ key, ...schema })),
  })).filter(group => group.blocks.length);
}
