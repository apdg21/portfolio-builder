/*
 * Portfolio colour overrides — shared by the section editor, the live preview,
 * the download and the published site.
 *
 * The user picks a text colour (and optionally a heading colour) for each
 * scope: the six content sections plus the three page-frame parts
 * (header, hero, footer). The choices live in the canonical data under
 * `ui.colors`, travel into data.json, and are turned into one CSS block that
 * is injected into the editor canvas, the live preview and the published
 * site — so what the user sees is what gets published.
 *
 * Loaded as a plain script in the browser (window.RPUserColors) and required
 * in Node for the test harnesses.
 */
(function (global) {
  'use strict';

  // Content sections shown in the portfolio editor rail.
  var SECTION_SCOPES = ['Basics', 'Contact', 'Skills', 'Projects', 'Testimonials', 'Social'];

  // The page frame: the parts a theme paints.
  var FRAME_SCOPES = ['header', 'hero', 'footer'];

  var SCOPE_META = {
    Basics:       { icon: '👤', label: 'About' },
    Contact:      { icon: '📬', label: 'Contact' },
    Skills:       { icon: '🧠', label: 'Skills' },
    Projects:     { icon: '🗂️', label: 'Projects' },
    Testimonials: { icon: '💬', label: 'Testimonials' },
    Social:       { icon: '🔗', label: 'Social links' },
    header:       { icon: '🧭', label: 'Header / nav' },
    hero:         { icon: '⭐', label: 'Hero' },
    footer:       { icon: '🔻', label: 'Footer' }
  };

  /*
   * CSS selectors that address each scope in a rendered template. Derived
   * from the real markup of all 10 designs (#hero, #work, #about, ...).
   *
   * The frame scopes come first in the output order so a content section
   * always wins where the two overlap.
   */
  var SCOPE_SELECTORS = {
    Basics: [
      '#about', '#about-section', 'section#about', '.about', '.about-section',
      '.about-content', '.about-text', '.bio', '.bio-text'
    ],
    Contact: [
      '#contact', '#contact-section', 'section#contact', '.contact',
      '.contact-section', '.contact-form', '.contact-info'
    ],
    Skills: [
      '#skills', '#skills-list', '.skills', '.skills-list', '.skills-section',
      '#skillsList'
    ],
    Projects: [
      '#work', '#projects', '#samples', '#collections', 'section#work',
      'section#projects', '.work', '.work-section', '.projects-grid',
      '.samples-grid', '.gallery-grid'
    ],
    Testimonials: [
      '#testimonials', '#testimonials-section', 'section#testimonials',
      '.testimonials', '.testimonials-section', '.testimonials-grid',
      '#testimonial-container'
    ],
    Social: [
      '#social-links', '#socialLinks', '.social-links', '.socialLinks',
      '.social-link', '.footer-social', '.header-social'
    ],
    header: [
      'header:not(.hero)', '.header', '.site-header', '.navbar', '.nav',
      '#mainNav', '#main-nav', '.main-nav', '#navbar', '.mobile-nav',
      '.mobile-menu', '.top-nav'
    ],
    hero: [
      '.hero', '.hero-section', '#hero', 'section.hero', '.hero-content',
      '.hero-text', 'main > section:first-of-type'
    ],
    footer: [
      'footer', '.footer', '.site-footer', '.resume-footer', '#footer',
      '#footerText'
    ]
  };

  /*
   * Elements that carry text. Their colour is forced to the chosen text
   * colour so a design's own hard-coded colour can no longer make text
   * unreadable. Headings are left out: they keep the design's heading
   * colour unless the user picks one.
   */
  var TEXT_TAGS = 'p, span, li, a, strong, em, small, blockquote, figcaption, time, div, i, dt, dd, caption';
  var HEADING_TAGS = 'h1, h2, h3, h4, h5, h6';

  /*
   * `:root body` rather than `html body`: the extra pseudo-class raises the
   * specificity above the page-frame theme rules (`[data-rp-frame-themed] p`
   * injected at preview time), so an explicit colour the user picked still
   * wins over the theme's own text colour.
   */
  var PREFIX = ':root body';

  function prefixAll(selectors, prefix) {
    return selectors.map(function (sel) { return prefix + ' ' + sel; }).join(', ');
  }

  /*
   * Descendant selectors have to be built per selector: joining the
   * pre-prefixed list and appending ` p, span, …` only attaches the tags to
   * the last selector and leaves the others as page-wide rules.
   */
  function withTags(selectors, prefix, tags) {
    var tagList = tags.split(',').map(function (tag) { return tag.trim(); });
    var out = [];
    selectors.forEach(function (sel) {
      tagList.forEach(function (tag) {
        out.push(prefix + ' ' + sel + ' ' + tag);
      });
    });
    return out.join(', ');
  }

  /** A #rrggbb value, or '' when it is not a usable colour. */
  function safeColor(value) {
    if (typeof value !== 'string') return '';
    var v = value.trim();
    if (!v) return '';
    if (/^#[0-9a-fA-F]{3}$/.test(v)) {
      return '#' + v.charAt(1) + v.charAt(1) + v.charAt(2) + v.charAt(2) + v.charAt(3) + v.charAt(3);
    }
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
    return '';
  }

  /**
   * Build the CSS for a colour map.
   *
   * @param {object} colors  scope id -> { text, heading }
   * @returns {string} CSS text (empty when nothing is customised)
   */
  function buildCss(colors) {
    if (!colors || typeof colors !== 'object') return '';
    var css = '';
    // Frame first, content sections after: a section wins where they overlap.
    var order = FRAME_SCOPES.concat(SECTION_SCOPES);
    order.forEach(function (scope) {
      var entry = colors[scope];
      if (!entry || typeof entry !== 'object') return;
      var text = safeColor(entry.text);
      var heading = safeColor(entry.heading);
      if (!text && !heading) return;

      var selectors = SCOPE_SELECTORS[scope] || [];
      if (!selectors.length) return;

      var root = prefixAll(selectors, PREFIX);
      if (text) {
        css += root + ' { color: ' + text + ' !important; }\n';
        css += withTags(selectors, PREFIX, TEXT_TAGS) +
               ' { color: ' + text + ' !important; }\n';
      }
      if (heading) {
        css += withTags(selectors, PREFIX, HEADING_TAGS) +
               ' { color: ' + heading + ' !important; }\n';
      }
    });
    return css;
  }

  /** True when the colour map holds nothing worth publishing. */
  function isEmpty(colors) {
    if (!colors || typeof colors !== 'object') return true;
    return Object.keys(colors).every(function (scope) {
      var entry = colors[scope];
      if (!entry || typeof entry !== 'object') return true;
      return !safeColor(entry.text) && !safeColor(entry.heading);
    });
  }

  /** A fresh, empty colour map. */
  function emptyColors() {
    return {};
  }

  var api = {
    SECTION_SCOPES: SECTION_SCOPES,
    FRAME_SCOPES: FRAME_SCOPES,
    SCOPE_META: SCOPE_META,
    SCOPE_SELECTORS: SCOPE_SELECTORS,
    TEXT_TAGS: TEXT_TAGS,
    HEADING_TAGS: HEADING_TAGS,
    buildCss: buildCss,
    isEmpty: isEmpty,
    emptyColors: emptyColors,
    safeColor: safeColor
  };

  global.RPUserColors = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
