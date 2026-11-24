# Portfolio Builder

Standalone portfolio → website builder. It is deliberately separate from
`resume-builder/`: its own editor, schema, mappings, templates and license
product. There is no JSON upload and no AI — the customer types into the
section editor and gets exactly that content.

## Pages

| File | Purpose |
| --- | --- |
| `index.html` | The builder: template picker → section editor → generate → preview / download / publish. Accepts `?template=styleN` and Gumroad's `?license_key=…`. |
| `portfolio-form.html` | Redirect to `index.html` (query string kept) for older links. |
| `portfolio-editor.js` | Three-pane editor (sections rail, sandboxed preview, properties panel). Speaks the same postMessage protocol as the resume editor (`__rpToken`, `__rpEditorData`, `__rpEditorCss`, `__rpEditorHidden`, `__rpEditorSelect`). |
| `portfolio-master-schema.json` | Canonical fields shown in the panel (Basics, Contact, Skills, Projects, Testimonials, Social). |
| `portfolio-mappings.json` | Per-design path mapping into each template's `data.json` shape. |
| `all_template_schemas.json` | Path schema of every template's sample `data.json`. |
| `preview-and-download.js` | Shared preview modal, theme CSS injection, ZIP download, license gate and publishing. |
| `mapping-engine.js` | Deterministic `applyMapping(masterData, templateData, mapping)` — no AI. |
| `templates/portfolio/style1…style10/` | The designs themselves (HTML, CSS, JS, assets, sample `data.json`). |

## How data reaches a template

1. The editor commits panel values into a canonical object, prunes empty
   repeatable items, then maps it onto the selected template's sample schema.
2. The editor preview maps onto the template's own sample `data.json` with
   `keepSampleWhenBlank`, so a freshly selected design shows its sample name,
   projects and copy until the customer types their own. User values replace
   the sample field by field; demo URLs (`example.com`) are blanked so they
   cannot open from the canvas.
3. Generated/published data does not use that mode: `applyMapping` blanks
   unfilled fields and clears empty sample lists, so no sample content reaches
   a customer's site. In the preview, `fetch('data.json')` is patched to
   return the mapped data, and each template exposes a
   `window.__rpRender(data)` hook so edits apply without a reload.
4. Uploaded images are data URIs. Templates that prefix uploaded filenames with
   `assets/` (style2, style4, style10) resolve them through local helpers;
   style3/5/6/7/8 read the portrait from `about.profileImage` / `ui.profileImage`
   and fall back to the design's own `assets/profile.jpg`.

When adding a template:

- copy it under `templates/portfolio/styleN/`,
- add its schema to `all_template_schemas.json` and its mapping to
  `portfolio-mappings.json`,
- add the section map entry if its section ids are unusual (see
  `PORTFOLIO_SECTIONS` in `portfolio-editor.js`),
- expose `window.__rpRender = function (data) { … }` that re-renders from data,
- add a `thumbnails/portfolio-styleN.jpg` and an entry to
  `ALL_TEMPLATE_METADATA` and the template dropdown in `index.html`,
- keep its offline Edit / Load JSON controls covered by the
  `#rp-hide-offline-controls` style block in its `index.html` (builder sites
  never use them),
- include `assets/rp-site-link.js` (script tag + manifest entry),
- include `assets/rp-work-sections.js` plus a `window.RP_WORK_SECTIONS` config
  (script tags + manifest entry).

### Editable and repeated work sections

No design is tied to one discipline. Two fields make that work:

- **Main work heading** (`projectsTitle`) renames the design's own work
  heading. Where the heading is a real data field (style2, style10) the normal
  mapping writes it; everywhere else `applyMapping` also emits
  `rpWorkTitle` and the template runtime renames the hard-coded heading.
- **More work sections** (`workSections`) is a repeatable list of
  `{ title, description, projects[] }`. It travels as `rpWorkSections` and
  `assets/rp-work-sections.js` clones the design's own work section once per
  entry, cloning the last *visible* card as the skeleton for each project, so
  "Email design", "Copywriting samples" and "Brand work" keep the design's
  styling, get their own nav links, and never inherit the demo project's
  links, categories or high-resolution image.

If the main Projects list is empty and a work section has projects, the first
section is promoted into the design's own grid (its title becomes
`rpWorkTitle`); the rest still render as extra sections. Each template's
config (`section`, `workSection`, `heading`, `grid`, `navLink`) is the only
design-specific part:

```html
<script>window.RP_WORK_SECTIONS = {"section":"#work","workSection":"#work","heading":"#work > h2","grid":"#sample-grid","navLink":"nav a[href=\"#work\"]"};</script>
<script src="assets/rp-work-sections.js" defer></script>
```

### Project cards: links and image view

Every design's project cards behave the same way, provided by
`assets/rp-project-cards.js` (loaded before the design's `main.js`):

- A project with a real link (`https://…`, `//…` or a bare `example.com/path`)
  opens that page in a new tab — the designer's case study, article, shop page
  or PDF.
- A project with only an image opens the image full view in a lightbox (shared
  across designs, closes with the × button, backdrop click or Escape).
- Demo values are never navigable: `#` anchors, template sample files like
  `sample1.html`, and stock placeholders (`via.placeholder.com`,
  `project-default.jpg`) fall back to the image view or stay inert.

Renderers call `RPProjectCard.wire(card, { link, title })` after building each
card, and `rp-work-sections.js` wires cloned cards the same way. The runtime
takes the click during capture on `document`, so a design's own card listener
never opens a sample link.

### Second photo and hero background

- **Second photo** (`aboutImage`) exists in the two designs that show a second
  portrait — style2 ("Simple Profile", About section) and style10
  ("Minimalist & Adaptable", sidebar). Their mappings point it at
  `about.image` with `fallbackFrom: "profileImage"`, so leaving it empty reuses
  the main profile photo; uploading another image shows that instead. Both
  fields are hidden on designs that only have one portrait.
- **Hero background** (`heroImage`) is offered on every design. style6 and
  style8 already map it to `hero.backgroundImage` and style9 to
  `siteDetails.backgroundValue`; for all of them `applyMapping` also emits
  `rpHeroImage` and `assets/rp-hero-bg.js` paints the photo with a scrim
  derived from the design's page colour. The scrim is checked against the
  hero heading colour, so a white hero with white headings (styles 6 and 8)
  gets a dark scrim instead. The runtime re-applies after the design re-renders
  and restores the design's own background when the field is cleared. Per
  design, only the hero selector is needed:

```html
<script>window.RP_HERO_BG = {"hero":".hero"};</script>
<script src="assets/rp-hero-bg.js" defer></script>
```

Both runtimes re-install their `window.__rpRender` wrapper after load because
the designs define that hook inside `DOMContentLoaded`, after deferred scripts
have already run.

## Gumroad

Each of the 10 portfolio designs is its **own** Gumroad product, so a key
unlocks only the design it was bought for (same rule as the resume builder):

- Checkout URLs: one per design in `CHECKOUT_URL_BY_TEMPLATE`
  (`preview-and-download.js`); unknown styles fall back to
  `https://resumeprotemplate.gumroad.com/portfolio-collection`.
- Frontend license storage key: `rpPortfolioLicense`.
- Server product mapping: each `portfolio/style1…style10` key in
  `functions/api/_license.js` has its own `GUMROAD_PRODUCT_ID_*` secret.

The customer can preview for free and is asked for a key only when they
download the ZIP or publish. A Gumroad redirect carrying `?license_key=…` is
verified against the template selected at that moment.

## Server secrets (Cloudflare Pages)

| Secret | Used by | Notes |
| --- | --- | --- |
| `GUMROAD_PRODUCT_ID_MODERN_MINIMALIST` | `functions/api/verify-license.js`, `publish.js` | Product ID from that design's Content → License Key module. |
| `GUMROAD_PRODUCT_ID_SIMPLE_PROFILE` | same | |
| `GUMROAD_PRODUCT_ID_CLEAN_FOCUS` | same | |
| `GUMROAD_PRODUCT_ID_DYNAMIC_SHOWCASE` | same | |
| `GUMROAD_PRODUCT_ID_STRUCTURED_LAYOUT` | same | |
| `GUMROAD_PRODUCT_ID_PHOTOGRAPHY` | same | |
| `GUMROAD_PRODUCT_ID_MODERN_GRID` | same | |
| `GUMROAD_PRODUCT_ID_ELEGANT_GALLERY` | same | |
| `GUMROAD_PRODUCT_ID_PROFESSIONAL_INTERACTIVE` | same | |
| `GUMROAD_PRODUCT_ID_MINIMALIST_ADAPTABLE` | same | |
| `GITHUB_TOKEN` | `functions/api/publish.js` | Fine-grained token scoped to `apdg21/resumepro-builds` with Contents: Read and write. |
| `PUBLISH_OWNER_SECRET` | `functions/api/publish.js` | Any long random string; HMACs the license key into each branch's `.resumepro-owner`. Changing it orphans every published site. |

```
wrangler pages secret put GUMROAD_PRODUCT_ID_MODERN_MINIMALIST
wrangler pages secret put GUMROAD_PRODUCT_ID_SIMPLE_PROFILE
wrangler pages secret put GUMROAD_PRODUCT_ID_CLEAN_FOCUS
wrangler pages secret put GUMROAD_PRODUCT_ID_DYNAMIC_SHOWCASE
wrangler pages secret put GUMROAD_PRODUCT_ID_STRUCTURED_LAYOUT
wrangler pages secret put GUMROAD_PRODUCT_ID_PHOTOGRAPHY
wrangler pages secret put GUMROAD_PRODUCT_ID_MODERN_GRID
wrangler pages secret put GUMROAD_PRODUCT_ID_ELEGANT_GALLERY
wrangler pages secret put GUMROAD_PRODUCT_ID_PROFESSIONAL_INTERACTIVE
wrangler pages secret put GUMROAD_PRODUCT_ID_MINIMALIST_ADAPTABLE
wrangler pages secret put GITHUB_TOKEN
wrangler pages secret put PUBLISH_OWNER_SECRET
```

`GUMROAD_PRODUCT_ID_PORTFOLIO` is retired — no style references it any more,
so it can be deleted from the Pages project.

## Publishing

The customer's browser POSTs the site files to `/api/publish` with
`X-License-Key`, `X-License-Template` (`portfolio/styleN`) and
`X-Site-Type: portfolio`. The function:

- re-verifies the license (refunded / charged-back / disputed purchases are
  rejected everywhere),
- names branches `<name>-portfolio` (`sofia-reyes-portfolio.resumepro-builds.pages.dev`)
  so a portfolio and a resume for the same person (`sofia-reyes…`) coexist on
  `resumepro-builds`; old `portfolio-<name>` ids move to the new name on the
  next publish,
- writes/validates the HMAC branch ownership marker on updates,
- returns `{ url, resume_id, pair_token, linked }`; the frontend stores
  `resume_id` per template (`publishedPortfolioId_*`) so later publishes update
  the same branch instead of creating a new site.

### Resume ↔ portfolio link

Both builders keep `rpSites = { resume: {id, token}, portfolio: {id, token} }`
in localStorage (same origin). Publishing one sends the other as
`X-Sibling-Id` + `X-Sibling-Token` (or `X-Sibling-Key` for resumes published
before pairing existed). When the token checks out and both sites carry the
same person's name, the server writes `rpLinks` into this site's `data.json`
and backfills the sibling with the link back. `assets/rp-site-link.js` in every
template reads `rpLinks` and adds a Portfolio / Resume link to the site nav (or
a bottom-left button when the design has no nav). `rpLinks` is server-written
only, so the builder preview never shows the link.

### Manual linking fallback

If the sites were published on different devices, or browser data was cleared,
the automatic path has no local token to prove ownership.
`/portfolio-builder/link-sites.html` asks for both addresses and both license
keys and POSTs them to `/api/pair`. The endpoint applies the same rules:

- only our sites — a site id or a URL on `*.resumepro-builds.pages.dev`; the
  server rebuilds the URLs from the id, so a caller cannot point a link at a
  foreign site,
- the same person name (the resume id minus `-portfolio` / `-N`, with the same
  truncation rules as `siblingMatchesPerson`); a middle initial on only one
  side is a different name,
- proven ownership — both keys must hash to their branch's `.resumepro-owner`
  before anything is written (`not_owner` otherwise).

On success it writes `rpLinks` + `.resumepro-pair` on both branches and returns
fresh pair tokens, which the page stores in `rpSites` so later publishes keep
the pairing. Branches created before ownership tracking answer `site_unowned`;
publish them once from the builder, then link again. Both builder publish
dialogs show the manual page link when pairing did not happen.

No portfolio change runs client-side before the license check — download and
publish both go through `requireLicense()` and the server check above.

## Local check

Serve the repository root (not the builder folder) so `templates/`, `thumbnails/`
and `functions/` resolve:

```
python -m http.server 8765
# http://127.0.0.1:8765/portfolio-builder/?template=style1
```

`functions/api/*` only runs on Cloudflare Pages (or `wrangler pages dev`), so
publishing cannot be exercised from the plain static server.
