/* ResumePro: project card actions.
   A project card opens the customer's own link in a new tab. When the project
   has no usable link (the design's demo anchors, template sample files or bare
   filenames) the card opens its image full view instead. Template renderers and
   rp-work-sections.js call RPProjectCard.wire(card, { link, title }) after
   building each card. */
(function () {
  'use strict';

  var LIGHTBOX_ID = 'rp-project-lightbox';
  var STYLE_ID = 'rp-project-card-style';

  // Cards whose image is the design's stock placeholder have nothing to show
  // full view, so they stay inert.
  var PLACEHOLDER = /(?:via\.placeholder\.com|placeholder\.(?:jpe?g|png|gif|webp|svg)|project-default\.|^data:image\/svg\+xml|(?:^|\/)undefined$)/i;

  // Scheme-less addresses only count when the last label is a real TLD:
  // "example.com/case-study" is a link, "sample1.html" is one of the design's
  // own files and must not navigate.
  var KNOWN_TLD = /^(?:com|net|org|io|co|dev|app|me|ai|design|studio|art|blog|cloud|site|online|xyz|info|biz|shop|store|tech|space|live|page|website|pro|link|us|uk|ca|au|de|fr|es|it|nl|se|no|dk|fi|ie|nz|in|jp|kr|cn|br|mx|za|ch|at|be|pl|pt|ru|tr|ae|sg|hk|tw|id|ph|my|th|vn|il|sa|eu)$/i;

  function liveLink(value) {
    var raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '';
    if (raw.charAt(0) === '#') return '';
    if (/^(?:javascript|data|file|mailto|tel):/i.test(raw)) return '';
    if (/[\s\\"'<>]/.test(raw)) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.indexOf('//') === 0) return 'https:' + raw;

    var bare = raw.replace(/^\/+/, '');
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#].*)?$/i.test(bare)) return '';
    var host = bare.split(/[/?#]/)[0];
    var labels = host.split('.');
    if (labels.length < 2 || !KNOWN_TLD.test(labels[labels.length - 1])) return '';
    return 'https://' + bare;
  }

  function imageSource(card) {
    var img = card.querySelector ? card.querySelector('img') : null;
    if (!img) return '';
    var attr = (img.getAttribute('src') || '').trim();
    var src = img.currentSrc || img.src || '';
    if (!attr || !src || PLACEHOLDER.test(src)) return '';
    return src;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '[data-rp-card]{cursor:pointer;}',
      '[data-rp-card]:focus-visible{outline:3px solid rgba(37,99,235,.55);outline-offset:3px;}',
      '#' + LIGHTBOX_ID + '{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(8,10,14,.92);}',
      '#' + LIGHTBOX_ID + '.rp-lb-open{display:flex;}',
      '#' + LIGHTBOX_ID + ' figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:12px;max-width:100%;max-height:100%;}',
      '#' + LIGHTBOX_ID + ' img{display:block;width:auto;height:auto;max-width:92vw;max-height:84vh;object-fit:contain;border-radius:6px;background:#fff;box-shadow:0 24px 60px rgba(0,0,0,.5);}',
      '#' + LIGHTBOX_ID + ' figcaption{margin:0;color:#f5f5f5;font:500 14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center;}',
      '#' + LIGHTBOX_ID + ' .rp-lb-close{position:absolute;top:14px;right:18px;width:42px;height:42px;padding:0;border:0;border-radius:50%;background:rgba(255,255,255,.14);color:#fff;font-size:26px;line-height:1;cursor:pointer;}',
      '#' + LIGHTBOX_ID + ' .rp-lb-close:hover{background:rgba(255,255,255,.28);}',
      '@media print{#' + LIGHTBOX_ID + '{display:none!important;}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  var scrollBefore = null;

  function ensureLightbox() {
    var box = document.getElementById(LIGHTBOX_ID);
    if (box) return box;
    injectStyles();
    box = document.createElement('div');
    box.id = LIGHTBOX_ID;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Project image');
    box.innerHTML =
      '<button type="button" class="rp-lb-close" aria-label="Close">&times;</button>' +
      '<figure><img alt=""><figcaption></figcaption></figure>';
    document.body.appendChild(box);
    box.addEventListener('click', function (e) {
      if (e.target === box || (e.target.closest && e.target.closest('.rp-lb-close'))) closeLightbox();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') closeLightbox();
    });
    return box;
  }

  function closeLightbox() {
    var box = document.getElementById(LIGHTBOX_ID);
    if (!box || !box.classList.contains('rp-lb-open')) return;
    box.classList.remove('rp-lb-open');
    if (scrollBefore !== null) {
      document.body.style.overflow = scrollBefore;
      scrollBefore = null;
    }
  }

  function showImage(card) {
    var info = card.__rpCard;
    if (!info || !info.image) return;
    var box = ensureLightbox();
    var img = box.querySelector('img');
    var caption = box.querySelector('figcaption');
    box.classList.remove('rp-lb-open');
    img.setAttribute('src', info.image);
    img.setAttribute('alt', info.title || '');
    caption.textContent = info.title || '';
    if (scrollBefore === null) scrollBefore = document.body.style.overflow || '';
    document.body.style.overflow = 'hidden';
    box.classList.add('rp-lb-open');
    var close = box.querySelector('.rp-lb-close');
    if (close && close.focus) close.focus();
  }

  function activate(card) {
    var info = card.__rpCard;
    if (!info) return;
    if (info.mode === 'link' && info.link) {
      window.open(info.link, '_blank', 'noopener');
      return;
    }
    showImage(card);
  }

  // Designs bind their own click handlers to the card (some open the sample
  // link, others open a template image). Taking the event during capture on
  // document wins over all of them, so a card never navigates to demo content.
  document.addEventListener('click', function (e) {
    var target = e.target;
    var card = target && target.closest ? target.closest('[data-rp-card]') : null;
    if (!card || !card.__rpCard) return;
    if (target.closest('a[href]')) return;
    e.preventDefault();
    e.stopPropagation();
    activate(card);
  }, true);

  function wire(card, project) {
    if (!card || card.nodeType !== 1 || card.__rpCard) return;
    project = project || {};

    var title = typeof project.title === 'string' ? project.title : '';
    var link = liveLink(project.link);
    var image = link ? '' : imageSource(card);
    if (!link && !image) return;

    card.__rpCard = { mode: link ? 'link' : 'image', link: link, image: image, title: title };
    card.setAttribute('data-rp-card', link ? 'link' : 'image');
    card.setAttribute('role', 'link');
    if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '0');
    if (title) {
      card.setAttribute('aria-label', title + ' — ' + (link ? 'open project link' : 'view image full size'));
    }

    card.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      if (e.target !== card) return;
      e.preventDefault();
      activate(card);
    });
  }

  window.RPProjectCard = { wire: wire, liveLink: liveLink };
})();
