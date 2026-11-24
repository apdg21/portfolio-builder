/* ResumePro: user photo behind the hero section.
   data.json may carry rpHeroImage (a data URI or URL). When it does, this
   script paints it over the design's own hero background under a scrim made
   from that design's background colour, so hero text stays readable. With no
   rpHeroImage the design is left exactly as it shipped. */
(function () {
  'use strict';

  var cfg = window.RP_HERO_BG;
  if (!cfg || !cfg.hero) return;

  var MARK = 'data-rp-hero-bg';
  var ALPHA = typeof cfg.alpha === 'number' ? cfg.alpha : 0.72;
  var saved = null;

  function heroEl() {
    try { return document.querySelector(cfg.hero); } catch (_) { return null; }
  }

  function channels(color) {
    var m = /^rgba?\(([^)]+)\)$/.exec(String(color || '').trim());
    if (!m) return null;
    var parts = m[1].split(',').map(function (s) { return parseFloat(s); });
    if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) return null;
    var a = parts.length > 3 ? parts[3] : 1;
    if (!(a > 0.05)) return null;
    return [Math.round(parts[0]), Math.round(parts[1]), Math.round(parts[2])];
  }

  function lum(rgb) {
    function ch(c) {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2]);
  }

  function contrast(a, b) {
    var la = lum(a), lb = lum(b);
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  // The scrim comes from the design's own page colour, but only when that
  // colour contrasts with the hero's text. A white hero with white headings
  // (styles 6 and 8) would otherwise vanish into a white wash.
  function scrim(hero) {
    var textEl = hero.querySelector('h1, h2, h3') || hero;
    var textRgb = channels(window.getComputedStyle(textEl).color) || [17, 24, 39];
    var light = lum(textRgb) > 0.5;

    var rgb = channels(window.getComputedStyle(hero).backgroundColor);
    if (!rgb && document.body) rgb = channels(window.getComputedStyle(document.body).backgroundColor);
    if (rgb && contrast(rgb, textRgb) < 4) rgb = null;
    if (!rgb) rgb = light ? [15, 23, 42] : [255, 255, 255];
    return 'rgba(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ', ' + ALPHA + ')';
  }

  function remember(hero) {
    if (saved) return;
    saved = {
      image: hero.style.backgroundImage,
      size: hero.style.backgroundSize,
      position: hero.style.backgroundPosition,
      repeat: hero.style.backgroundRepeat,
      color: hero.style.backgroundColor
    };
  }

  function restore(hero) {
    if (!saved) return;
    hero.style.backgroundImage = saved.image;
    hero.style.backgroundSize = saved.size;
    hero.style.backgroundPosition = saved.position;
    hero.style.backgroundRepeat = saved.repeat;
    hero.style.backgroundColor = saved.color;
    hero.removeAttribute(MARK);
    saved = null;
  }

  function apply() {
    var hero = heroEl();
    if (!hero) return;
    var data = window.__rpData || {};
    var image = typeof data.rpHeroImage === 'string' ? data.rpHeroImage.trim() : '';

    if (!image) {
      restore(hero);
      return;
    }

    remember(hero);
    var paint = 'linear-gradient(' + scrim(hero) + ', ' + scrim(hero) + '), url(' + JSON.stringify(image) + ')';
    if (hero.style.backgroundImage === paint && hero.getAttribute(MARK) === '1') return;
    hero.style.backgroundImage = paint;
    hero.style.backgroundSize = 'cover';
    hero.style.backgroundPosition = 'center';
    hero.style.backgroundRepeat = 'no-repeat';
    hero.setAttribute(MARK, '1');
  }

  var pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () { pending = null; apply(); }, 120);
  }

  function hookData(data) {
    window.__rpData = data;
    schedule();
  }

  var askedForData = false;
  function loadDataOnce() {
    if (askedForData || window.__rpData) return;
    askedForData = true;
    try {
      fetch('data.json')
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) { if (data) hookData(data); })
        .catch(function () {});
    } catch (_) {}
  }

  var originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (input) {
      var result = originalFetch.apply(this, arguments);
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (/data\.json(\?|$)/.test(url)) {
          return result.then(function (res) {
            if (res && res.ok) {
              res.clone().json().then(hookData).catch(function () {});
            }
            return res;
          });
        }
      } catch (_) {}
      return result;
    };
  }

  // Templates define their render hook inside a DOMContentLoaded listener,
  // which runs after deferred scripts — so wrapping once here would wrap
  // undefined and the design's later assignment would drop us. Install the
  // wrapper again whenever a fresh function shows up.
  function hookRender() {
    var fn = window.__rpRender;
    if (typeof fn !== 'function' || fn.__rpHeroBg) return;
    var wrapped = function (data) {
      fn.apply(this, arguments);
      if (data) hookData(data);
    };
    wrapped.__rpHeroBg = true;
    window.__rpRender = wrapped;
  }
  hookRender();

  function start() {
    var hero = heroEl();
    if (!hero) return;
    hookRender();
    // Designs re-render their hero from data; put the photo back when they do.
    new MutationObserver(schedule).observe(hero, { attributes: true, attributeFilter: ['style', 'class'] });
    apply();
    loadDataOnce();
    var tries = 0;
    var timer = setInterval(function () {
      hookRender();
      if (window.__rpData && window.__rpData.rpHeroImage) apply();
      if (++tries > 40) clearInterval(timer);
    }, 250);
  }

  window.addEventListener('load', hookRender);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
