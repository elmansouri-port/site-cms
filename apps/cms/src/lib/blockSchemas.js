/*
 * blockSchemas.js — what each component block asks the editor for.
 *
 * The Astro components are the renderers; these are the forms that fill them.
 * Keeping the two in step is a small manual contract, and a deliberate one:
 * the alternative (deriving forms from the components) would make every field
 * label a code change.
 *
 * type: text | textarea | html | number | boolean | select | media | list
 */
export const BLOCK_SCHEMAS = {
  hero: {
    label: 'Hero',
    fields: [
      { name: 'eyebrow', label: 'Eyebrow', type: 'text' },
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'highlight', label: 'Highlighted word', type: 'text', hint: 'Rendered in brand purple after the title.' },
      { name: 'subtitle', label: 'Subtitle', type: 'textarea' },
      { name: 'primaryLabel', label: 'Primary button', type: 'text' },
      { name: 'primaryHref', label: 'Primary link', type: 'text' },
      { name: 'secondaryLabel', label: 'Secondary button', type: 'text' },
      { name: 'secondaryHref', label: 'Secondary link', type: 'text' },
      { name: 'image', label: 'Image', type: 'media' },
      { name: 'imageAlt', label: 'Image alt text', type: 'text' },
      { name: 'align', label: 'Alignment', type: 'select', options: ['center', 'left'] },
    ],
  },
  cta_banner: {
    label: 'CTA banner',
    fields: [
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'subtitle', label: 'Subtitle', type: 'textarea' },
      { name: 'primaryLabel', label: 'Primary button', type: 'text' },
      { name: 'primaryHref', label: 'Primary link', type: 'text' },
      { name: 'secondaryLabel', label: 'Secondary button', type: 'text' },
      { name: 'secondaryHref', label: 'Secondary link', type: 'text' },
      { name: 'background', label: 'Background image', type: 'media' },
    ],
  },
  faq_accordion: {
    label: 'FAQ accordion',
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
          { name: 'linkHref', label: 'Link URL', type: 'text' },
        ],
      },
    ],
  },
  stats_band: {
    label: 'Stats band',
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
    fields: [
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'html', label: 'Content', type: 'html', rows: 14 },
      { name: 'width', label: 'Width', type: 'select', options: ['prose', 'wide'] },
    ],
  },
  image_text: {
    label: 'Image + text',
    fields: [
      { name: 'eyebrow', label: 'Eyebrow', type: 'text' },
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'html', label: 'Body', type: 'html' },
      { name: 'image', label: 'Image', type: 'media' },
      { name: 'imageAlt', label: 'Image alt text', type: 'text' },
      { name: 'reverse', label: 'Image on the left', type: 'boolean' },
      { name: 'linkLabel', label: 'Link label', type: 'text' },
      { name: 'linkHref', label: 'Link URL', type: 'text' },
    ],
  },
  pricing_cards: {
    label: 'Pricing cards',
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
          { name: 'ctaHref', label: 'Button link', type: 'text' },
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
    fields: [
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'subtitle', label: 'Subtitle', type: 'textarea' },
      { name: 'limit', label: 'How many', type: 'number' },
      { name: 'category', label: 'Category filter', type: 'text' },
      { name: 'ctaLabel', label: 'Link to the blog', type: 'text' },
    ],
  },
  raw_html: {
    label: 'Raw HTML',
    fields: [
      { name: 'html', label: 'HTML', type: 'html', rows: 16 },
    ],
  },
};
