# Rainbow by ALE  CMS Page Sections Reference

> **Purpose:** This document maps every page in the Rainbow marketing site to its constituent sections, with precise references to the source HTML files. It is intended for the CMS developer to model the correct content fields in the Zendesk → CMS Manager → Astro pipeline.
>
> **Stack reminder:** Content is authored in Zendesk (Markdown) → Zendesk formats to HTML and pushes via API → the mini-CMS manager controls positioning/layout → Astro frontend renders the cloned page templates.
>
> **Convention:** Each section entry shows `File : line` so the developer can jump directly to the template HTML.

> ⚠️ **IMPORTANT  Navbar & Footer canonical source:**
> The HTML files for individual pages (`pages/collaboration.html`, `pages/webinar.html`, etc.) each contain their own copy of the navbar and footer, but these copies are not all identical. **The navbar and footer that must be used as the single source of truth for the Astro implementation are the ones in `index.html`** (the homepage). When building the Astro shared layout, take the `nav#navbar.glass-nav` from `index.html : 229–295` and the `footer.footer-premium` from `index.html : 1383–1468`. Ignore the navbar/footer markup in all other page files  they are duplicates that may be slightly out of date.

---

## 0. CMS Architecture  Block-Based Pages & Universal Spacing

### How pages are built

Every page in the Astro frontend is composed by stacking an ordered list of **section blocks**. A block is a reusable template (Hero, Pricing, FAQ, CTA Banner, etc.) paired with a content record. The same block template can be placed on any page  there is no "this block belongs to this page" restriction.

```
Page
 └── blocks[]          ← ordered list, drag-to-reorder in the CMS manager
      ├── block_type   ← which template to render ("hero_rotator", "pricing_bento", …)
      ├── block_data   ← the content fields for this instance (title, images, links…)
      └── block_layout ← universal display settings (spacing, visibility)
```

A page is saved as an ordered array of block instances. Adding a new page means choosing a title/slug and composing it from blocks. The same "FAQ" block or "CTA Banner" block can appear on the homepage, the collaboration page, and a future landing page  each with its own content and spacing settings.

---

### Universal Block Fields

These fields are present on **every block instance**, regardless of block type. They are managed in the CMS manager's block wrapper and do not need to be repeated in each block's own content schema.

| Field | Type | Options / Notes |
|---|---|---|
| `spacing_top` | Select | Vertical space **above** the block. Values: `none` (0), `xs` (16 px), `sm` (40 px), `md` (64 px), `lg` (80 px  default for most sections), `xl` (112 px  hero/pricing), `2xl` (128 px) |
| `spacing_bottom` | Select | Vertical space **below** the block. Same values as `spacing_top` |
| `block_id` | Text (auto) | Auto-generated slug used as the HTML `id` attribute  enables the floating section nav pills to link to this block by anchor |
| `block_visible` | Boolean | Show/hide the block without deleting it. Default: `true` |

**Spacing presets map to Tailwind padding classes:**

| Preset | Value | Tailwind class |
|---|---|---|
| `none` | 0 px | `pt-0` / `pb-0` |
| `xs` | 16 px | `pt-4` / `pb-4` |
| `sm` | 40 px | `pt-10` / `pb-10` |
| `md` | 64 px | `pt-16` / `pb-16` |
| `lg` | 80 px | `pt-20` / `pb-20` |
| `xl` | 112 px | `pt-28` / `pb-28` |
| `2xl` | 128 px | `pt-32` / `pb-32` |

The Astro block wrapper component reads `spacing_top` and `spacing_bottom` and applies the corresponding classes to the outer `<section>` element. The block template itself does not need to handle padding.

> **Default spacing:** When no value is set, the CMS should default to `lg` (80 px) for both top and bottom  this matches the most common `py-20` value used in the current HTML templates.

---

## Table of Contents

0. [CMS Architecture  Block-Based Pages & Universal Spacing](#0-cms-architecture--block-based-pages--universal-spacing)
1. [Homepage](#1-homepage)
2. [Rainbow Collaboration Product Page](#2-rainbow-collaboration-product-page)
3. [Rainbow Webinar Product Page](#3-rainbow-webinar-product-page)
4. [Combined Pricing Page (Tarifs)](#4-combined-pricing-page-tarifs)
5. [Collaboration Pricing Page](#5-collaboration-pricing-page)
6. [Webinar Pricing Page](#6-webinar-pricing-page)
7. [Products Overview Page](#7-products-overview-page)
9. [Partners Page (Partenaires)](#9-partners-page-partenaires)
10. [Blog Listing Page](#10-blog-listing-page)
11. [Blog Article Page](#11-blog-article-page)
12. [404 Error Page](#12-404-error-page)
13. [Shared Components (used across all pages)](#13-shared-components-used-across-all-pages)
14. [Master Section Index](#14-master-section-index)

---

## 1. Homepage

**Source file:** `index.html`  
**Build output:** `docs/index.html`  
**Route:** `/`

---

### 1.1 Navigation Bar

**Selector:** `nav#navbar.glass-nav`  
**File:** `index.html : 229`

Fixed top navigation bar shared by all pages. See [Shared Components → Navigation Bar](#131-navigation-bar).

---

### 1.2 Floating Section Nav (Scroll-Spy Pill Bar)

**Selector:** `nav#section-nav > .section-nav-inner`  
**File:** `index.html : 298–307`

A fixed pill bar that appears when the user scrolls past the hero. Links highlight the active section automatically. On the homepage it links to: Fonctionnalités, Cibles, Certifications, Solutions, Actualités, FAQ.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `pill_links` | Repeatable item | Each item: `label` (text) + `anchor` (hash, e.g. `#fonctionnalites`) |

---

### 1.3 Hero Section

**Selector:** `section.relative.flex.flex-col` (first `<section>` after `#section-nav`)  
**File:** `index.html : 310–363`

Full-width hero with background glows, animated word rotator in the headline, subtitle, two CTA buttons, and a product demo video.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `hero_badge_text` | Text | e.g. "Simple. Moderne. Européenne"  displays as gradient uppercase label |
| `hero_title_static` | Rich text / HTML | Static portion of the `<h1>` before the rotating words |
| `hero_rotating_words` | Repeatable text | Each word in the CSS word rotator (réunions, webinaires, présentations, formations) |
| `hero_description` | Text | Short paragraph below the title |
| `hero_cta_primary_label` | Text | e.g. "Découvrez nos plans" |
| `hero_cta_primary_url` | URL | e.g. `/tarifs` |
| `hero_cta_secondary_label` | Text | e.g. "Contacter un agent" |
| `hero_cta_secondary_url` | URL | External link |
| `hero_video_src` | Media / URL | Path to `.mp4` demo video (e.g. `/images/rainbow_homepage_05_FR.mp4`) |
| `hero_video_poster` | Image | Optional fallback poster frame |

---

### 1.4 Trust Logos Band

**Selector:** `section.relative.w-full.overflow-hidden` (white/transparent background after hero)  
**File:** `index.html : 366–419`

A scrolling marquee of customer/partner logos with an overline label.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `trust_band_overline` | Text | e.g. "Ils nous font confiance" |
| `trust_logos` | Repeatable item | Each item: `logo_image` (image), `logo_alt` (text). The marquee duplicates them automatically |

---

### 1.5 Features Section (Unified Platform)

**Selector:** `section#fonctionnalites.section-anchor`  
**File:** `index.html : 422–577`

Tabbed feature showcase with an animated progress bar on desktop and an image carousel on mobile. Each tab has a title, description, "learn more" link, and an associated screenshot. Below the tabs, a rotating customer quote is shown.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `features_section_title` | Rich text | Main `<h2>` |
| `features_section_description` | Text | Paragraph below the title |
| `feature_tabs` | Repeatable item (3 tabs) | Each tab: `tab_title`, `tab_description`, `tab_link_label`, `tab_link_url`, `tab_accent_color` (hex), `tab_image` (image), `tab_image_alt` |
| `feature_quotes` | Repeatable item (1 per tab) | Each quote: `quote_text`, `quote_author`, `quote_company`, `quote_link_label`, `quote_link_url`. Order must match `feature_tabs` |

---

### 1.6 Target Audience Section (Cibles)

**Selector:** `section#cibles.section-anchor`  
**File:** `index.html : 580–757`

Sliding pill tab selector with 4 audience personas, each revealing a title, description, two CTA buttons, and a photo. Tabs auto-rotate on desktop.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `audience_section_title` | Text | `<h2>` |
| `audience_section_description` | Text | Paragraph |
| `audience_tabs` | Repeatable item (4 tabs) | Each tab: `tab_label` (short, for pill), `tab_icon_path` (SVG name/ID), `tab_badge_label` (text inside badge), `tab_badge_color` (hex), `tab_title`, `tab_description`, `tab_image` (image), `tab_image_alt`, `tab_cta_primary_label`, `tab_cta_primary_url`, `tab_cta_secondary_label`, `tab_cta_secondary_url` |

---

### 1.7 Stats Badges Section (Dark Gradient Band)

**Selector:** `section.relative.py-20.bg-brand-500` (dark gradient, after `#cibles`)  
**File:** `index.html : 760–793`

Dark purple gradient band with 4 large animated counter stats (e.g. "700M messages envoyés"). Not animated via JS counter; these are static display numbers with a dark theme.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `stats_band_title` | Text | `<h2>` ("Des millions de personnes aiment travailler dans Rainbow") |
| `stats_items` | Repeatable item (4 stats) | Each: `stat_number` (text, e.g. "700"), `stat_unit` (text, e.g. "M"), `stat_description` (text) |

---

### 1.8 Certifications Section

**Selector:** `section#certifications.section-anchor`  
**File:** `index.html : 799–1053`

Section with a header and a horizontal scrollable carousel of certification flip-cards (HIPAA, GDPR, ACN, ISO 27001, BSI C5, HDS, ANSSI). Each card has a front (logo + name) and a back (description + link). There is also a "learn more" link below the carousel.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `certifications_title` | Text | `<h2>` |
| `certifications_description` | Text | Lead paragraph |
| `certification_cards` | Repeatable item | Each card: `cert_name` (text), `cert_logo` (image), `cert_logo_alt` (text), `cert_description` (text, back of card), `cert_link_url` (URL, back arrow link) |
| `certifications_cta_label` | Text | Link label at the bottom ("En savoir plus sur notre engagement…") |
| `certifications_cta_url` | URL | Link target |

---

### 1.9 Product Range Section (Solutions)

**Selector:** `section#solutions.section-anchor`  
**File:** `index.html : 1056–1116`

White-background section with 2 product cards (Collaboration and Webinar), each with an image, gradient overlay, title, subtitle, primary CTA, and secondary CTA.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `solutions_section_title` | Text | `<h2>` |
| `solutions_section_description` | Text | Subheading paragraph |
| `product_cards` | Repeatable item (2 cards) | Each card: `product_name` (text), `product_color_accent` (hex, used for gradient overlay + CTAs), `product_image` (image), `product_image_alt` (text), `product_subtitle` (text), `product_cta_primary_label`, `product_cta_primary_url`, `product_cta_secondary_label`, `product_cta_secondary_url` |

---

### 1.10 Stats Section (Animated Counters, Dark Background)

**Selector:** `section.relative.stats-dark-bg`  
**File:** `index.html : 1119–1160`

Dark background section with 3 animated percentage counters that count up on scroll. Each stat has a large number (animated via JS `data-counter` attribute) and a description.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `stats_section_title` | Text | `<h2>` ("Nous sommes là pour faire grandir votre entreprise") |
| `stats_items` | Repeatable item (3 stats) | Each: `stat_target_number` (number, used in `data-counter`), `stat_suffix` (text, e.g. "%"), `stat_description` (text) |

> **Developer note:** The counter animation relies on the `data-counter` HTML attribute. The CMS must pass the numeric target so the frontend JS can read it and animate.

---

### 1.11 News / Actualités Section

**Selector:** `section#actualites.section-anchor`  
**File:** `index.html : 1163–1319`

Gray-50 background section with "expand on hover" cards. Each card has a full-bleed background image, category title displayed vertically when collapsed, and a short description + arrow when expanded. The last expanded card is shown by default. Includes a "See all" footer link.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `news_section_title` | Rich text | `<h2>` (includes `<span class="text-brand-500">Rainbow</span>`) |
| `news_section_description` | Text | Subparagraph |
| `news_cards` | Repeatable item (up to 6 cards) | Each card: `card_title` (text), `card_description` (text), `card_image_url` (image URL), `card_image_alt` (text), `card_link_url` (URL for the arrow button), `card_default_expanded` (boolean, true for 1 card) |
| `news_footer_link_label` | Text | e.g. "Voir toutes les actualités" |
| `news_footer_link_url` | URL | e.g. `/blog` |

---

### 1.12 FAQ Section

**Selector:** `section#questions-frequentes.section-anchor`  
**File:** `index.html : 1322–1361`

Accordion FAQ loaded dynamically from Zendesk Help Center API. Shows a loading spinner, error state, and the accordion items once loaded. Includes a contact CTA link below.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `faq_section_title` | Text | `<h2>` |
| `faq_section_description` | Text | Subparagraph ("Tout ce que vous devez savoir sur…") |
| `faq_zendesk_section_id` | Text / Number | Zendesk Help Center section ID used in the API URL |
| `faq_contact_label` | Text | e.g. "Vous avez d'autres questions ?" |
| `faq_contact_link_label` | Text | e.g. "Contactez notre équipe" |
| `faq_contact_link_url` | URL | mailto or page URL |

> **Developer note:** FAQ content is pulled from Zendesk API at `https://rainbow-market.zendesk.com/api/v2/help_center/sections/{id}/articles.json`. The section ID is the only CMS-controlled variable per page.

---

### 1.13 CTA Banner Section

**Selector:** `section.py-20 > .sp-preview > .sp-cta-banner`  
**File:** `index.html : 1364–1379`

Full-width CTA block with a heading, subtitle, and two buttons (primary + secondary). See [Shared Components → CTA Banner](#133-cta-banner).

---

### 1.14 Footer

**Selector:** `footer.footer-premium`  
**File:** `index.html : 1383–1468`

Dark gradient footer. See [Shared Components → Footer](#132-footer).

---

---

## 2. Rainbow Collaboration Product Page

**Source file:** `pages/collaboration.html`  
**Build output:** `docs/products/collaboration/index.html`  
**Route:** `/products/collaboration`

---

### 2.1 Navigation Bar

**File:** `pages/collaboration.html : 108`  
Shared component  see [Section 13.1](#131-navigation-bar).

---

### 2.2 Floating Section Nav

**Selector:** `nav#section-nav > .section-nav-inner`  
**File:** `pages/collaboration.html : 202–208`

Links: Fonctionnalités, Tarifs, FAQ.

**CMS Fields:** Same as [Section 1.2](#12-floating-section-nav-scroll-spy-pill-bar).

---

### 2.3 Hero Section

**Selector:** `header.pt-32.pb-20.px-6`  
**File:** `pages/collaboration.html : 211–240`

Two-column layout: left side has a badge, `<h1>`, description paragraph, and two CTA buttons; right side has a product screenshot.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `hero_badge_text` | Text | Small uppercase pill label (e.g. "Communication d'équipe souveraine") |
| `hero_title` | Rich text | `<h1>`  may include a `<span>` for brand-colored product name |
| `hero_description` | Text | Paragraph below the title |
| `hero_cta_primary_label` | Text | Primary button (e.g. "Essai gratuit") |
| `hero_cta_primary_url` | URL | |
| `hero_cta_secondary_label` | Text | Secondary button (e.g. "Découvrez nos plans") |
| `hero_cta_secondary_url` | URL | |
| `hero_image` | Image | Product screenshot (right column) |
| `hero_image_alt` | Text | Alt text |

---

### 2.4 Stats Banner

**Selector:** `section.py-20` (first section inside `.rounded-[32px]` padding box, dark gradient background)  
**File:** `pages/collaboration.html : 248–273`

Dark gradient banner with 4 key metrics displayed in a grid.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `stats_items` | Repeatable item (4 stats) | Each: `stat_number` (text, e.g. "50M+"), `stat_description` (text) |

---

### 2.5 Features / Bento Grid Section

**Selector:** `section#fonctionnalites.section-anchor`  
**File:** `pages/collaboration.html : 276–347`

A bento-grid feature layout with 2 rows. Row 1 has a large card (3/5 width) and a small card (2/5 width). Row 2 has 3 equal cards. Each card has a feature title, description, and a media element (video or image).

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `features_section_title` | Text | `<h2>` |
| `bento_cards` | Repeatable item (5 cards) | Each card: `card_title` (text, bold), `card_description` (text), `card_media_type` (`video` or `image`), `card_media_src` (URL), `card_media_alt` (text), `card_accent_color` (hex, used for gradient background), `card_size` (`large`, `medium`, `small`  controls grid span) |

---

### 2.6 Pricing Section

**Selector:** `section#tarifs.section-anchor`  
**File:** `pages/collaboration.html : 350–733`

Full pricing section with: heading + subheading, monthly/yearly billing toggle (saves ~20%), 3 pricing plan cards in a bento grid (Essentiel/Free, Enterprise/Popular, Premium/Coming Soon), 3 reassurance footnote boxes, an expandable feature comparison table.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `pricing_section_title` | Text | `<h2>` |
| `pricing_section_description` | Text | Subparagraph |
| `pricing_yearly_discount_label` | Text | e.g. "-20%" shown next to "Annuel" |
| `pricing_plans` | Repeatable item (3 plans) | See sub-fields below |
| `pricing_footnotes` | Repeatable item (3 items) | Each: `footnote_icon_name`, `footnote_title` (bold), `footnote_description` |
| `comparison_table_toggle_label` | Text | e.g. "Comparer toutes les fonctionnalités" |
| `comparison_table_hide_label` | Text | e.g. "Masquer le tableau comparatif" |
| `comparison_table` | Structured data | Groups of rows  see sub-fields below |

**Pricing Plan sub-fields (per plan):**

| Field | Type | Notes |
|---|---|---|
| `plan_name` | Text | e.g. "Essentiel", "Enterprise", "Premium" |
| `plan_badge_label` | Text | Optional badge (e.g. "Le plus populaire", "Bientôt disponible") |
| `plan_badge_style` | Select | `popular` (brand color) / `coming_soon` (gray) / `none` |
| `plan_price_monthly` | Text | e.g. "Gratuit" or "6€" |
| `plan_price_yearly` | Text | e.g. "4,80€" |
| `plan_price_unit` | Text | e.g. "/ utilisateur / mois" |
| `plan_features` | Repeatable text | Feature list items |
| `plan_cta_label` | Text | Button label |
| `plan_cta_url` | URL | Button target |
| `plan_is_highlighted` | Boolean | Centers highlighted plan visually |
| `plan_is_disabled` | Boolean | Grays out "coming soon" plans |

**Comparison Table sub-fields:**

| Field | Type | Notes |
|---|---|---|
| `comparison_groups` | Repeatable item | Each group: `group_label` (text, e.g. "Collaboration & Messagerie"), `group_rows` (repeatable) |
| `group_row` | Repeatable item | Each row: `feature_name`, `value_free`, `value_enterprise`, `value_premium`  values can be text or a checkmark/dash symbol |

---

### 2.7 FAQ Section

**Selector:** `section#questions-frequentes.section-anchor`  
**File:** `pages/collaboration.html : 736–766`

Zendesk-powered accordion FAQ. Same structure as [Section 1.12](#112-faq-section).

**CMS Fields:** Same as [Section 1.12](#112-faq-section)  only the `faq_zendesk_section_id` and copy differ per page.

---

### 2.8 CTA Banner Section

**Selector:** `section.py-20 > .sp-preview > .sp-cta-banner`  
**File:** `pages/collaboration.html : 769–784`

See [Shared Components → CTA Banner](#133-cta-banner).

---

### 2.9 Footer

**File:** `pages/collaboration.html : 789`  
See [Shared Components → Footer](#132-footer).

---

---

## 3. Rainbow Webinar Product Page

**Source file:** `pages/webinar.html`  
**Build output:** `docs/products/webinar/index.html`  
**Route:** `/products/webinar`

Structurally identical to the Collaboration page but for the Webinar product. Key differences: hero uses a video (`<video>` instead of `<img>`), features tab navigation uses a 3-step timeline ("Création → Animation → Rapport") instead of a bento grid, and the floating section nav has an extra "Usage" link.

---

### 3.1 Navigation Bar

**File:** `pages/webinar.html : 108`  
Shared  see [Section 13.1](#131-navigation-bar).

---

### 3.2 Floating Section Nav

**Selector:** `nav#section-nav > .section-nav-inner`  
**File:** `pages/webinar.html : 177–184`

Links: Fonctionnalités, Usage, Tarifs, FAQ.

---

### 3.3 Hero Section

**Selector:** `header.pt-32.pb-20.px-6`  
**File:** `pages/webinar.html : 187–216`

Same fields as [Section 2.3](#23-hero-section), except the right column is a `<video>` autoplay loop instead of a static image.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `hero_badge_text` | Text | e.g. "Plateforme webinaire" |
| `hero_title` | Rich text | `<h1>` |
| `hero_description` | Text | |
| `hero_cta_primary_label` | Text | |
| `hero_cta_primary_url` | URL | |
| `hero_cta_secondary_label` | Text | |
| `hero_cta_secondary_url` | URL | |
| `hero_video_src` | Media / URL | Autoplay loop video (e.g. `/images/webinar-page/interface_rainbow_webinar_EN.mp4`) |

---

### 3.4 Stats Banner

**File:** `pages/webinar.html : 224–245`  
Same structure as [Section 2.4](#24-stats-banner). Stats are specific to Webinar product.

---

### 3.5 Timeline Features Section

**Selector:** `section#features`  
**File:** `pages/webinar.html : 248–296`

Animated 3-step timeline with progress bar (Création → Animation → Rapport). Each step has a circle icon, label, and a content panel (text + image/video).

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `timeline_section_title` | Text | `<h2>` ("Le cycle de vie de votre événement") |
| `timeline_steps` | Repeatable item (3 steps) | Each step: `step_label` (short text for timeline label), `step_icon_name` (SVG icon identifier), `step_panel_content` (see below) |

**Timeline Panel sub-fields (per step):**

| Field | Type | Notes |
|---|---|---|
| `panel_title` | Text | |
| `panel_description` | Text / Rich text | |
| `panel_media_type` | Select | `image` or `video` |
| `panel_media_src` | URL | |
| `panel_media_alt` | Text | |
| `panel_feature_list` | Repeatable text | Bullet points |
| `panel_cta_label` | Text | Optional |
| `panel_cta_url` | URL | Optional |

---

### 3.6 Pricing Section

**File:** `pages/webinar.html : ~350`  
Same structure as [Section 2.6](#26-pricing-section) with Webinar-specific plan names, prices, and feature lists.

---

### 3.7 FAQ Section

**File:** `pages/webinar.html : ~736`  
Same as [Section 2.7](#27-faq-section)  different `faq_zendesk_section_id`.

---

### 3.8 CTA Banner + Footer

Same as [Section 2.8](#28-cta-banner-section) and [Section 2.9](#29-footer).

---

---

## 4. Combined Pricing Page (Tarifs)

**Source file:** `pages/tarifs.html`  
**Build output:** `docs/tarifs/index.html`  
**Route:** `/tarifs`

---

### 4.1 Navigation Bar

**File:** `pages/tarifs.html : ~108`  
Shared  see [Section 13.1](#131-navigation-bar).

---

### 4.2 Page Hero Header

**Selector:** `header.pt-32.pb-20.px-6`  
**File:** `pages/tarifs.html : ~210`

Simple centered hero with a heading and short description.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `hero_title` | Text | `<h1>` |
| `hero_description` | Text | Subparagraph |

---

### 4.3 Sticky Sidebar Navigation

**Selector:** `.page-sidebar` (hidden on mobile, visible at `md:` breakpoint)  
**File:** `pages/tarifs.html : 163–186`

Sticky sidebar on desktop that links to product pricing sections on the page. On mobile, replaced by a horizontal pill bar.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `sidebar_items` | Repeatable item | Each item: `item_label` (e.g. "Collaboration"), `item_description` (text, e.g. "Messagerie & réunions"), `item_icon` (image or icon name), `item_anchor` (e.g. `#collaboration`) |

---

### 4.4 Collaboration Pricing Section

**Selector:** `section#collaboration`  
**File:** `pages/tarifs.html : ~300`

Pricing tables for Rainbow Collaboration  same plan structure as [Section 2.6](#26-pricing-section).

**CMS Fields:** Same as [Section 2.6](#26-pricing-section)  pricing plans, billing toggle, footnotes, comparison table.

---

### 4.5 Webinar Pricing Section

**Selector:** `section#webinar`  
**File:** `pages/tarifs.html : ~400`

Pricing tables for Rainbow Webinar  same structure as [Section 3.6](#36-pricing-section).

---

### 4.6 FAQ Section

**Selector:** `section#questions-frequentes`  
**File:** `pages/tarifs.html : ~500`

Same as [Section 1.12](#112-faq-section).

---

### 4.7 CTA Banner + Footer

See [Section 13.3](#133-cta-banner) and [Section 13.2](#132-footer).

---

---

## 5. Collaboration Pricing Page

**Source file:** `pages/tarif-collaboration.html`  
**Build output:** `docs/products/collaboration/pricing/index.html`  
**Route:** `/products/collaboration/pricing`

A standalone page focused solely on Collaboration pricing. Structure mirrors the pricing section inside [Section 2.6](#26-pricing-section) but with its own hero.

**CMS Fields:**

| Section | Fields |
|---|---|
| Navigation Bar | Shared  [Section 13.1](#131-navigation-bar) |
| Page Hero | `hero_title`, `hero_description` |
| Pricing Plans | Same as [Section 2.6](#26-pricing-section) |
| Billing Toggle | `monthly_label`, `yearly_label`, `yearly_discount_label` |
| Feature Comparison Table | Same as [Section 2.6](#26-pricing-section) |
| CTA Banner | [Section 13.3](#133-cta-banner) |
| Footer | [Section 13.2](#132-footer) |

---

---

## 6. Webinar Pricing Page

**Source file:** `pages/tarif-webinar.html`  
**Build output:** `docs/products/webinar/pricing/index.html`  
**Route:** `/products/webinar/pricing`

Mirror of [Section 5](#5-collaboration-pricing-page) for the Webinar product.

---

---

## 7. Products Overview Page

**Source file:** `pages/products.html`  
**Build output:** `docs/products/index.html`  
**Route:** `/products`

---

### 7.1 Navigation Bar + Floating Section Nav

**File:** `pages/products.html : 108`  
Links: Aperçu, Solutions, Fonctionnalités, Tarifs.

---

### 7.2 Overview / Aperçu Section

**Selector:** `section` (dark purple gradient, first content section)  
**File:** `pages/products.html : ~210`

Dark gradient section with animated badge, main `<h1>`, description paragraph.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `overview_badge_text` | Text | Small pill label |
| `overview_title` | Text | `<h1>` |
| `overview_description` | Text | Paragraph |

---

### 7.3 Solutions Section

**Selector:** `section#solutions`  
**File:** `pages/products.html : ~250`

Product offering cards.

**CMS Fields:** Same as [Section 1.9](#19-product-range-section-solutions).

---

### 7.4 Features Section with Timeline

**Selector:** `section#features`  
**File:** `pages/products.html : ~300`

Timeline/tab navigation with 4 step panels (indexed `timeline-tab-0` to `timeline-tab-3`).

**CMS Fields:** Similar to [Section 3.5](#35-timeline-features-section) but with 4 steps.

---

### 7.5 Pricing Section

**Selector:** `section#tarifs`  
**File:** `pages/products.html : ~400`

Billing toggle, plan cards, comparison table. Same structure as [Section 2.6](#26-pricing-section).

---

### 7.6 FAQ + CTA Banner + Footer

Same as [Section 1.12](#112-faq-section), [Section 13.3](#133-cta-banner), [Section 13.2](#132-footer).

---

## 9. Partners Page (Partenaires)

**Source file:** `pages/partenaires.html`  
**Build output:** `docs/partenaires/index.html`  
**Route:** `/partenaires`

---

### 9.1 Navigation Bar

Shared  see [Section 13.1](#131-navigation-bar).

---

### 9.2 Hero Section (Two-Column)

**Selector:** `.page-wrap > .two-col`  
**File:** `pages/partenaires.html : ~100`

Left column: heading, body text, bullet list of partner benefits. Right column: decorative circular illustration with a floating badge.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `hero_title` | Rich text | `<h1>` (`.page-heading`) |
| `hero_description` | Text | Body paragraph |
| `partner_benefits` | Repeatable text | Bullet list items (displayed with check-circle icons) |
| `hero_badge_label` | Text | Floating badge text (`.pn-badge`) |

---

### 9.3 Partner Registration Form

**Selector:** `.form-card`  
**File:** `pages/partenaires.html : ~200`

A card with a form title, two-column input grid, and submit button.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `form_card_title` | Text | Title at the top of the form card |
| `form_fields` | Repeatable item | Each field: `field_label` (text), `field_type` (`text`, `email`, `tel`, `select`), `field_required` (boolean), `field_options` (for selects) |
| `form_submit_label` | Text | |
| `form_legal_text` | Rich text | Small print below the button |
| `form_success_title` | Text | |
| `form_success_description` | Text | |

---

### 9.4 Footer

Shared  see [Section 13.2](#132-footer).

---

---

## 10. Blog Listing Page

**Source file:** `pages/blog.html`  
**Build output:** `docs/blog/index.html`  
**Route:** `/blog`

---

### 10.1 Navigation Bar

Shared  see [Section 13.1](#131-navigation-bar).

---

### 10.2 Blog Hero Banner

**Selector:** `.blog-hero`  
**File:** `pages/blog.html : 40–52`

Full-width hero with a background image, page title, search bar, and category filter pills.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `hero_background_image` | Image | Background image for the hero banner |
| `hero_title` | Text | Main heading (`.blog-hero-title`) |
| `hero_subtitle` | Text | Optional subheading |
| `search_placeholder` | Text | Placeholder text inside search input |
| `category_pills` | Repeatable item | Each: `pill_label` (text), `pill_slug` (filter value), `pill_is_default_active` (boolean) |

---

### 10.3 Featured Article Card

**Selector:** `.featured-card`  
**File:** `pages/blog.html : ~107`

A large horizontal card featuring the lead article. Image on the left, content (badge, title, excerpt, read-more link) on the right.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `featured_image` | Image | `.featured-card-img` |
| `featured_image_alt` | Text | |
| `featured_category_badge` | Text | Small label |
| `featured_title` | Text | Article title |
| `featured_excerpt` | Text | Short description |
| `featured_read_more_label` | Text | e.g. "Lire l'article" |
| `featured_article_url` | URL | Link target |

---

### 10.4 Article Grid

**Selector:** `.articles-section` > grid of `.article-card`  
**File:** `pages/blog.html : ~167`

Responsive grid of article cards. Each card has a thumbnail image, category badge, title, excerpt, and read-more link. Cards are filtered by category pill selection.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `articles_section_title` | Text | Grid section heading |
| `articles` | Repeatable item | Each article: `article_image` (image), `article_image_alt` (text), `article_category` (text, matches pill slug), `article_title`, `article_excerpt`, `article_read_more_label`, `article_url` |

---

### 10.5 Footer

Shared  see [Section 13.2](#132-footer).

---

---

## 11. Blog Article Page

**Source file:** `pages/blog/the-power-of-rainbow.html`  
**Build output:** `docs/blog/the-power-of-rainbow/index.html`  
**Route:** `/blog/the-power-of-rainbow` (slug-based)

---

### 11.1 Navigation Bar

Shared  see [Section 13.1](#131-navigation-bar).

---

### 11.2 Breadcrumb Navigation

**Selector:** `.breadcrumb-nav`  
**File:** `pages/blog/the-power-of-rainbow.html : ~40`

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `breadcrumbs` | Repeatable item | Each crumb: `label` (text), `url` (URL). Last crumb has no URL |

---

### 11.3 Article Header

**Selector:** `.article-header`  
**File:** `pages/blog/the-power-of-rainbow.html : ~60`

Hero area with featured image, article title, and meta information.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `article_featured_image` | Image | Hero image |
| `article_featured_image_alt` | Text | |
| `article_title` | Text | `<h1>` |
| `article_author` | Text | Author name |
| `article_publish_date` | Date | |
| `article_reading_time` | Text | e.g. "5 min de lecture" |
| `article_category` | Text | Category label |

---

### 11.4 Article Body

**Selector:** `.prose-article`  
**File:** `pages/blog/the-power-of-rainbow.html : ~100`

The main article content. Written in Zendesk Markdown, converted to HTML. Supports `<h2>`, `<h3>`, `<p>`, `<ul>`, `<blockquote>`, key-points boxes.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `article_body` | Rich text / HTML (from Zendesk) | Full article content  this is the primary Zendesk-managed field |
| `key_points_box` | Rich text | Optional highlighted box (`.key-points-box`)  can be embedded within the body or managed separately |

---

### 11.5 Related Articles

**Selector:** `.related-articles`  
**File:** `pages/blog/the-power-of-rainbow.html : ~200`

Grid of related article cards.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `related_articles_title` | Text | Section heading |
| `related_articles` | Repeatable item (2–3 articles) | Each: `article_image`, `article_title`, `article_url`, `article_category` |

---

### 11.6 Share Buttons

**Selector:** `.share-buttons`  
**File:** `pages/blog/the-power-of-rainbow.html : ~250`

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `share_label` | Text | e.g. "Partager cet article" |
| `share_channels` | Repeatable item | Each: `channel_name` (`linkedin`, `twitter`, `facebook`), `channel_label` |

---

### 11.7 SEO Meta (Article-specific)

**File:** `pages/blog/the-power-of-rainbow.html : ~1` (injected by JS via `#json-ld-main`, `#meta-canonical`)

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `meta_title` | Text | `<title>` tag |
| `meta_description` | Text | `<meta name="description">` |
| `og_title` | Text | Open Graph title |
| `og_description` | Text | Open Graph description |
| `og_image` | Image | Social preview image |
| `canonical_url` | URL | |

---

### 11.8 Footer

Shared  see [Section 13.2](#132-footer).

---

---

## 12. 404 Error Page

**Source file:** `404.html`  
**Build output:** `docs/404.html`  
**Route:** `/404`

---

### 12.1 Navigation Bar

**File:** `404.html : 1`  
Shared  see [Section 13.1](#131-navigation-bar).

---

### 12.2 Error Content

**Selector:** `main` (centered flex container)  
**File:** `404.html : ~80`

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `error_image` | Image | Illustration (e.g. `/images/404.webp`) |
| `error_image_alt` | Text | |
| `error_title` | Text | Main heading |
| `error_description` | Text | Short message |
| `error_cta_label` | Text | Button label (e.g. "Retour à l'accueil") |
| `error_cta_url` | URL | e.g. `/` |

---

---

## 13. Shared Components (used across all pages)

These components appear identically (or near-identically) on every page. They should be managed as **global components** in the CMS, not duplicated per page.

---

### 13.1 Navigation Bar

**Selector:** `nav#navbar.glass-nav`  
**Reference:** `index.html : 229–295`

Fixed top bar with: logo, desktop nav links (dropdown-enabled), language switcher, sign-in button, free-trial CTA button, and mobile hamburger menu.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `nav_logo_image` | Image | Site logo |
| `nav_logo_alt` | Text | |
| `nav_logo_url` | URL | Link to home (`/`) |
| `nav_links` | Repeatable item | Top-level nav items: `label` (text), `url` (URL or `#`), `has_dropdown` (boolean) |
| `nav_dropdown_products` | Repeatable item | Product dropdown links: `label`, `url` |
| `nav_dropdown_pricing` | Repeatable item | Pricing dropdown links |
| `nav_dropdown_resources` | Repeatable item | Resources dropdown links |
| `nav_signin_label` | Text | e.g. "Se connecter" |
| `nav_signin_url` | URL | e.g. `https://web.openrainbow.net/rb/2.176.0/login` |
| `nav_cta_label` | Text | e.g. "Essai gratuit" |
| `nav_cta_url` | URL | e.g. `/tarifs` |
| `nav_languages` | Repeatable item | Each language: `code` (e.g. `FR`), `label` (e.g. "Français"), `url` |

---

### 13.2 Footer

**Selector:** `footer.footer-premium`  
**Reference:** `index.html : 1383–1468`

Dark gradient footer with 4 columns (Brand/address, Solutions links, Developers links, Company links) and a bottom bar with social icons, legal links, and copyright.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `footer_logo_image` | Image | White version of the logo |
| `footer_logo_alt` | Text | |
| `footer_address` | Text / HTML | Company address block |
| `footer_columns` | Repeatable item (3 link columns) | Each column: `column_title` (text), `column_links` (repeatable: `label` + `url`) |
| `footer_social_links` | Repeatable item | Each: `platform` (text, e.g. `linkedin`), `url` (URL), `aria_label` |
| `footer_legal_links` | Repeatable item | Each: `label` (text), `url` |
| `footer_copyright_text` | Rich text | Copyright statement |

---

### 13.3 CTA Banner

**Selector:** `.sp-preview > .sp-cta-banner > .sp-cta-content`  
**Reference:** `index.html : 1366–1378`

A prominent call-to-action block used at the bottom of most pages, before the footer. Contains a heading, subtitle, and two buttons (primary + secondary).

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `cta_title` | Text | `<h2>` (`.sp-cta-h2`) |
| `cta_subtitle` | Text | Subparagraph (`.sp-cta-sub`) |
| `cta_primary_label` | Text | Primary button |
| `cta_primary_url` | URL | |
| `cta_secondary_label` | Text | Secondary button |
| `cta_secondary_url` | URL | |

---

### 13.4 FAQ Accordion (Zendesk-Powered)

**Selector:** `#faq-items-container` (rendered by JS from Zendesk API)  
**Reference:** `index.html : 1335–1360`

The accordion is rendered client-side. Items are not directly managed in the CMS  they are fetched from Zendesk Help Center at runtime. The only CMS-editable fields are the section chrome.

**CMS Fields:**

| Field | Type | Notes |
|---|---|---|
| `faq_title` | Text | Section `<h2>` |
| `faq_description` | Text | Subparagraph |
| `faq_zendesk_section_id` | Text | Zendesk section ID for API call |
| `faq_contact_prompt` | Text | e.g. "Vous avez d'autres questions ?" |
| `faq_contact_link_label` | Text | e.g. "Contactez notre équipe" |
| `faq_contact_link_url` | URL | mailto or external URL (e.g. `https://giantlink.ma/form-ale`) |

---

---

## 14. Master Section Index

Complete flat list of every distinct section across all pages, ordered by page.

| # | Section Name | Page | Source File | Approx. Line | Anchor / Selector |
|---|---|---|---|---|---|
| 1 | Navigation Bar | All pages | `index.html` | 229 | `nav#navbar.glass-nav` |
| 2 | Mobile Menu | All pages | `index.html` | 271 | `div#mobile-menu` |
| 3 | Language Switcher | All pages | `index.html` | 256 | `.lang-switcher#lang-switcher` |
| 4 | Floating Section Nav | Homepage, Products, Blog | `index.html` | 298 | `nav#section-nav` |
| 5 | Hero  Word Rotator | Homepage | `index.html` | 310 | `section.relative.flex.flex-col` |
| 6 | Trust Logos Band / Marquee | Homepage | `index.html` | 366 | `section.marquee-container` |
| 7 | Features Tabs (Platform) | Homepage | `index.html` | 422 | `section#fonctionnalites` |
| 8 | Customer Quote (per feature tab) | Homepage | `index.html` | 523 | `#platform-quote` |
| 9 | Target Audience Tabs (Cibles) | Homepage | `index.html` | 580 | `section#cibles` |
| 10 | Stats Badges Band (dark gradient) | Homepage | `index.html` | 760 | `section.bg-brand-500` |
| 11 | Certifications Carousel | Homepage | `index.html` | 799 | `section#certifications` |
| 12 | Certification Flip Card | Homepage | `index.html` | 820 | `.compliance-card` |
| 13 | Product Range Cards (Solutions) | Homepage | `index.html` | 1056 | `section#solutions` |
| 14 | Animated Counter Stats | Homepage | `index.html` | 1119 | `section.stats-dark-bg` |
| 15 | News / Actualités Expand Cards | Homepage | `index.html` | 1163 | `section#actualites` |
| 16 | FAQ Accordion (Zendesk) | Homepage, Product pages, Tarifs | `index.html` | 1322 | `section#questions-frequentes` |
| 17 | CTA Banner | All pages | `index.html` | 1364 | `.sp-cta-banner` |
| 18 | Footer | All pages | `index.html` | 1383 | `footer.footer-premium` |
| 19 | Hero  Two Column (product) | Collaboration, Webinar | `pages/collaboration.html` | 211 | `header.pt-32.pb-20` |
| 20 | Stats Banner (4 metrics, dark) | Collaboration, Webinar | `pages/collaboration.html` | 248 | `section.py-20` (dark gradient) |
| 21 | Features Bento Grid | Collaboration | `pages/collaboration.html` | 276 | `section#fonctionnalites` |
| 22 | Pricing Section  Bento Plans | Collaboration, Webinar, Tarifs | `pages/collaboration.html` | 350 | `section#tarifs` |
| 23 | Billing Toggle (Monthly/Yearly) | Pricing pages | `pages/collaboration.html` | 358 | `#billing-toggle` |
| 24 | Pricing Plan Cards | Pricing pages | `pages/collaboration.html` | 373 | `.pricing-card` grid |
| 25 | Pricing Footnotes (3 boxes) | Pricing pages | `pages/collaboration.html` | 463 | Grid below plan cards |
| 26 | Feature Comparison Table (toggle) | Pricing pages | `pages/collaboration.html` | 488 | `#comparison-table` |
| 27 | Timeline Features (3-step) | Webinar | `pages/webinar.html` | 248 | `section#features` |
| 28 | Timeline Progress Bar | Webinar | `pages/webinar.html` | 255 | `#timeline-progress` |
| 29 | Timeline Step Panels | Webinar | `pages/webinar.html` | 298 | `.timeline-panel` |
| 30 | Tarifs Sticky Sidebar | Tarifs | `pages/tarifs.html` | 163 | `.page-sidebar` |
| 31 | Tarifs Mobile Pill Bar | Tarifs | `pages/tarifs.html` | 188 | `.mobile-pill-bar` |
| 32 | Page Hero  Simple Centered | Tarifs | `pages/tarifs.html` | ~210 | `header.pt-32` |
| 34 | Form Success State | Partenaires | `pages/partenaires.html` | 378 | `#success-msg` |
| 35 | Partners Hero (Two-Column) | Partenaires | `pages/partenaires.html` | ~100 | `.two-col` |
| 36 | Partner Registration Form | Partenaires | `pages/partenaires.html` | ~200 | `.form-card` |
| 37 | Partners Decorative Circle | Partenaires | `pages/partenaires.html` | ~130 | `.visual-wrap > .circle-outer` |
| 38 | Blog Hero Banner | Blog | `pages/blog.html` | 40 | `.blog-hero` |
| 39 | Blog Category Pills | Blog | `pages/blog.html` | 56 | `.cat-pill` |
| 40 | Blog Search Bar | Blog | `pages/blog.html` | 74 | `.search-bar-wrap` |
| 41 | Blog Featured Article Card | Blog | `pages/blog.html` | 107 | `.featured-card` |
| 42 | Blog Article Grid | Blog | `pages/blog.html` | 167 | `.articles-section` |
| 43 | Article Breadcrumbs | Blog Article | `pages/blog/the-power-of-rainbow.html` | ~40 | `.breadcrumb-nav` |
| 44 | Article Hero Header | Blog Article | `pages/blog/the-power-of-rainbow.html` | ~60 | `.article-header` |
| 45 | Article Meta (author/date/time) | Blog Article | `pages/blog/the-power-of-rainbow.html` | ~80 | `.article-meta` |
| 46 | Article Body (Zendesk Markdown) | Blog Article | `pages/blog/the-power-of-rainbow.html` | ~100 | `.prose-article` |
| 47 | Article Key Points Box | Blog Article | `pages/blog/the-power-of-rainbow.html` | ~150 | `.key-points-box` |
| 48 | Article Related Articles | Blog Article | `pages/blog/the-power-of-rainbow.html` | ~200 | `.related-articles` |
| 49 | Article Share Buttons | Blog Article | `pages/blog/the-power-of-rainbow.html` | ~250 | `.share-buttons` |
| 50 | 404 Error Content | 404 | `404.html` | ~80 | `main` |

---

## Notes for the CMS Developer

1. **All section templates are reusable across any page.** No section is locked to a specific page. The CMS page model is a slug + an ordered list of block instances. Any block type (Hero, Pricing, CTA Banner, FAQ, etc.) can be dropped onto any page. This means the developer must implement each section as a self-contained Astro component that reads only from its own `block_data`  never from a page-level context.

2. **Spacing is controlled by universal `spacing_top` / `spacing_bottom` fields.** These two fields exist on every block instance (defined in Section 0). The Astro block wrapper applies the correct Tailwind padding class. Individual block templates must NOT include hardcoded `py-*`, `pt-*`, or `pb-*` classes on their outermost element  those classes are injected by the wrapper. Inner content padding (e.g. between the heading and the cards) is still the block's own responsibility.

3. **Navbar and footer canonical source is `index.html`.** Each page file (`pages/*.html`) carries its own embedded copy of the navbar and footer, but they are not kept in sync with each other. The homepage (`index.html`) has the most complete and up-to-date version. Always use `index.html : 229–295` for the navbar and `index.html : 1383–1468` for the footer when implementing the Astro shared layout component. Discard the copies in the other page files.

2. **Zendesk as source of truth for FAQ and Article content.** FAQ accordions are fetched directly from the Zendesk Help Center API at runtime. The CMS only needs to store the `faq_zendesk_section_id` per page. Blog article body (`article_body`) is also authored in Zendesk Markdown and pushed as HTML via API  the CMS receives it and injects it into `.prose-article`.

2. **Billing toggle is purely client-side.** The monthly/yearly switch (`#billing-toggle`) is a JS-driven toggle that shows/hides `.price-monthly` / `.price-yearly` elements. The CMS must store **both** price values per plan; the toggle itself needs no CMS field.

3. **Animated counters use `data-counter`.** The `counter-number` elements use `data-counter="90"` and `data-duration="2000"` attributes for the scroll-triggered animation. The CMS must emit these as HTML attributes (not just text content) for the JS to pick up.

4. **Compliance flip cards are hover-interactive.** The `.compliance-card` 3D flip is CSS-only (`transform: rotateY(180deg)` on hover). No JS required  the CMS just needs to supply front/back content per card.

5. **Expand cards (Actualités) have one card defaulting to expanded.** The `.expand-card.expanded` class marks the default open card. The CMS field `card_default_expanded: true` should apply this class.

6. **The padding box wrapping product pages.** On collaboration.html and webinar.html, all sections after the hero are wrapped in a `div.rounded-[32px]` box that creates a card-like effect. This is structural HTML  no CMS field needed.

7. **Language switcher is JavaScript-driven.** Languages are populated via `js/i18n.js`. The CMS should manage the language list in a global setting, not per-page.

8. **Build output mirrors source with `index.html` routing.** Every `pages/foo.html` compiles to `docs/foo/index.html` for clean URL routing. The Astro frontend will follow this same convention.
