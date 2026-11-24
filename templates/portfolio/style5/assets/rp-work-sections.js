/* ResumePro: extra, user-titled work sections.
   data.json may carry rpWorkTitle (the heading for the design's own work
   section) and rpWorkSections = [{ title, description, projects: [...] }].
   Each entry repeats the design's own work section once, so one portfolio can
   show e.g. "Email design", "Copywriting samples" and "Brand work" while
   keeping the design's styling. With no rpWorkSections the page keeps its
   single work section. */
(function () {
  'use strict';

  var cfg = window.RP_WORK_SECTIONS;
  if (!cfg || !cfg.section || !cfg.grid) return;

  var HEADING_DEFAULT = 'data-rp-default-label';
  var SECTION_MARK = 'data-rp-work-section';
  var NAV_MARK = 'data-rp-work-nav';
  var CARD_SKIP = ['active', 'current', 'is-active', 'selected'];
  var PLACEHOLDER_IMAGE = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect width="800" height="600" fill="#e5e7eb"/></svg>'
  );

  function findWorkSection() {
    return document.querySelector(cfg.workSection);
  }

  function applyHeading(el, title) {
    if (!el || !title) return;
    if (!el.getAttribute(HEADING_DEFAULT)) el.setAttribute(HEADING_DEFAULT, el.textContent.trim());
    if (el.textContent.trim() !== title.trim()) el.textContent = title;
  }


  function stripListMarkup(node) {
    var junk = node.querySelectorAll('.pagination, .filter-buttons, [id*="pagination"], [class*="pagination"], [class*="filter-btn"]');
    for (var i = 0; i < junk.length; i++) junk[i].parentNode.removeChild(junk[i]);
  }

  function sameText(tag, want) {
    return tag && tag.textContent.trim() === want.trim();
  }

  // Designs that paginate hide the cards beyond the first page; the last
  // child is often one of those, so prefer the last card that is on screen.
  function sampleCard(grid) {
    if (!grid) return null;
    var kids = grid.children;
    for (var i = kids.length - 1; i >= 0; i--) {
      if (!kids[i].style || kids[i].style.display !== 'none') return kids[i];
    }
    return kids.length ? kids[kids.length - 1] : null;
  }

  function cardFor(project, grid) {
    var sample = sampleCard(grid);
    var card = sample ? sample.cloneNode(true) : document.createElement('div');
    if (!sample) card.className = cfg.cardClass || '';
    CARD_SKIP.forEach(function (c) { card.classList.remove(c); });
    card.style.display = '';
    card.style.cursor = '';
    card.removeAttribute('id');
    card.removeAttribute('data-index');
    card.removeAttribute('data-categories');
    // The sample card may already carry the action wiring; the clone gets its
    // own from RPProjectCard.wire below.
    card.removeAttribute('data-rp-card');
    card.removeAttribute('role');
    card.removeAttribute('tabindex');
    card.removeAttribute('aria-label');
    card.classList.add('rp-work-card');

    var links = card.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      if (project.link) {
        links[i].setAttribute('href', project.link);
        continue;
      }
      // Without a link the sample's href points at someone else's project.
      // Anchors that wrap the card's own content stay (they carry layout and
      // styling) but go inert; small standalone CTAs are dropped.
      var structural = links[i].querySelector('img, h1, h2, h3, h4, p');
      if (structural) {
        links[i].removeAttribute('href');
        links[i].removeAttribute('target');
      } else if (links[i].parentNode) {
        links[i].parentNode.removeChild(links[i]);
      }
    }
    var rest = card.querySelectorAll('a[href]');
    for (var r = 0; r < rest.length; r++) {
      rest[r].setAttribute('target', '_blank');
      rest[r].setAttribute('rel', 'noopener');
    }

    var img = card.querySelector('img');
    if (img) {
      // No image: a neutral block keeps the card's layout without passing off
      // another project's artwork as the user's.
      img.setAttribute('src', project.image || PLACEHOLDER_IMAGE);
      img.setAttribute('alt', project.title || '');
      img.style.display = '';
    }

    var headings = card.querySelectorAll('h1, h2, h3, h4');
    var titleEl = headings.length ? headings[headings.length - 1] : card.querySelector('[class*="title"]');
    if (titleEl) titleEl.textContent = project.title || '';
    else if (project.title) card.appendChild(document.createElement('h3')).textContent = project.title;

    var paragraphs = card.querySelectorAll('p, [class*="desc"], [class*="excerpt"]');
    var textEl = null;
    for (var k = 0; k < paragraphs.length; k++) {
      if (titleEl && (paragraphs[k] === titleEl || titleEl.contains(paragraphs[k]))) continue;
      textEl = paragraphs[k];
      break;
    }
    if (textEl) {
      if (project.description) textEl.textContent = project.description;
      else if (textEl.parentNode) textEl.parentNode.removeChild(textEl);
    }

    // Category rows, tags and dates carry the sample project's values.
    var meta = card.querySelectorAll('[class*="tag"] span, [class*="categor"], [class*="meta"], .project-category');
    for (var m = 0; m < meta.length; m++) meta[m].textContent = '';

    RPProjectCard.wire(card, {
      link: project.link || project.highResUrl,
      title: project.title
    });

    return card;
  }

  function buildSection(entry, index, source, sourceGrid) {
    var clone = source.cloneNode(true);
    var heading = findHeading(clone);
    var grid = clone.querySelector(cfg.grid);
    if (!grid) return null;
    var intro = findIntro(clone, heading, grid);

    clone.removeAttribute('id');
    clone.className = source.className;
    clone.style.scrollMarginTop = '90px';
    clone.setAttribute(SECTION_MARK, String(index + 2));

    if (heading) {
      if (entry.title) heading.textContent = entry.title;
      else if (heading.parentNode) heading.parentNode.removeChild(heading);
    }
    if (intro) {
      if (entry.description) intro.textContent = entry.description;
      else if (intro.parentNode) intro.parentNode.removeChild(intro);
    } else if (entry.description && heading) {
      var note = document.createElement('p');
      note.className = 'rp-work-intro';
      note.textContent = entry.description;
      heading.parentNode.insertBefore(note, heading.nextSibling);
    }

    stripListMarkup(clone);

    while (grid.firstChild) grid.removeChild(grid.firstChild);

    (entry.projects || []).forEach(function (project) {
      if (project) grid.appendChild(cardFor(project, sourceGrid));
    });

    clone.id = 'rp-work-' + (index + 2);
    return clone;
  }

  function addNav(id, label) {
    if (!id || !label) return;
    var selector = cfg.navLink || ('a[href="' + cfg.workSection + '"]');
    var samples = document.querySelectorAll(selector);
    for (var i = 0; i < samples.length; i++) {
      var sample = samples[i];
      // Only site navigation gets the extra links. The same selector often
      // matches a hero call-to-action button, which must not be duplicated.
      var host = sample.closest ? sample.closest('nav, header, ul, [class*="nav"], [id*="nav"]') : null;
      if (!host || (host.closest && host.closest('footer'))) continue;
      var item = sample.parentElement && sample.parentElement.tagName === 'LI' ? sample.parentElement : sample;
      var scope = item.parentNode;
      if (!scope || scope.querySelector('a[href="#' + id + '"]')) continue;
      var clone = item.cloneNode(true);
      var a = clone.tagName === 'A' ? clone : clone.querySelector('a');
      if (!a) continue;
      a.setAttribute('href', '#' + id);
      a.textContent = label;
      a.setAttribute(NAV_MARK, '');
      CARD_SKIP.forEach(function (c) { clone.classList.remove(c); });
      // Keep the design's nav order: after the last link we added, not directly
      // after the original (which would reverse the list).
      var at = item;
      while (isAddedNav(at.nextSibling)) at = at.nextSibling;
      scope.insertBefore(clone, at.nextSibling);
    }
  }

  function isAddedNav(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.hasAttribute(NAV_MARK)) return true;
    return !!(node.querySelector && node.querySelector('a[' + NAV_MARK + ']'));
  }

  function removeAddedNavs() {
    var marks = document.querySelectorAll('[' + NAV_MARK + ']');
    for (var i = 0; i < marks.length; i++) {
      var node = marks[i];
      var li = node.closest ? node.closest('li') : null;
      if (li && li.querySelectorAll('a').length === 1) node = li;
      if (node.parentNode) node.parentNode.removeChild(node);
    }
  }

  function sectionList(data) {
    if (!data || !Array.isArray(data.rpWorkSections)) return [];
    return data.rpWorkSections.filter(function (s) {
      return s && ((s.title && String(s.title).trim()) || (Array.isArray(s.projects) && s.projects.length));
    });
  }

  function findHeading(section) {
    if (cfg.heading) {
      try {
        var hit = section.matches(cfg.heading) ? section : section.querySelector(cfg.heading);
        if (hit) return hit;
      } catch (_) {}
    }
    return section.querySelector('h1, h2, h3');
  }

  // The design's own "a few recent projects" line under the heading. Extra
  // sections must not inherit it: it would describe the sample work.
  function findIntro(section, heading, grid) {
    var nodes = section.querySelectorAll('p, [class*="subtitle"], [class*="sub-title"], [class*="description"], [class*="intro"]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (heading && (node === heading || heading.contains(node))) continue;
      if (grid && (node === grid || grid.contains(node))) continue;
      return node;
    }
    return null;
  }

  function renameMainHeading(source, data) {
    var title = data && typeof data.rpWorkTitle === 'string' ? data.rpWorkTitle.trim() : '';
    if (!title) return;
    var heading = findHeading(source);
    if (heading) applyHeading(heading, title);
  }

  var lastSig = null;

  function apply() {
    var data = window.__rpData || {};
    var source = findWorkSection();
    if (!source) return;

    // Cheap and idempotent: designs that render their heading from data may
    // overwrite it after we run, so this runs on every pass.
    renameMainHeading(source, data);

    var sections = sectionList(data);
    var sourceGrid = source.querySelector(cfg.grid);
    var mainCards = sourceGrid ? sourceGrid.children.length : 0;
    // Extra sections copy the last real card as their skeleton; with no cards
    // at all there is nothing to copy.
    var extras = mainCards > 0 ? sections : [];
    var sig = JSON.stringify([sections, mainCards]);
    var present = document.querySelectorAll('[' + SECTION_MARK + ']').length;

    if (sig !== lastSig || present !== extras.length) {
      lastSig = sig;

      var marked = document.querySelectorAll('[' + SECTION_MARK + ']');
      for (var i = 0; i < marked.length; i++) marked[i].parentNode.removeChild(marked[i]);
      removeAddedNavs();

      var anchor = source;
      extras.forEach(function (entry, idx) {
        var built = buildSection(entry, idx, source, sourceGrid);
        if (!built) return;
        anchor.parentNode.insertBefore(built, anchor.nextSibling);
        anchor = built;
      });
    }

    // Re-added every pass: the design rebuilds its nav from data on its own
    // schedule and would otherwise drop these links.
    extras.forEach(function (entry, idx) {
      addNav('rp-work-' + (idx + 2), entry.title);
    });
  }

  var pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () { pending = null; apply(); }, 120);
  }

  function hookData(data) {
    window.__rpData = data;
    if (sectionList(data).length) schedule();
  }

  // Some designs load data.json with a plain fetch that starts before this
  // deferred script runs, so the wrapper below never sees it. Read the same
  // file once ourselves; the editor's __rpRender path still wins when it
  // delivers data without a file behind it.
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

  // Published pages load data.json themselves; the editor calls the render
  // hook with data directly. Track both.
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
    if (typeof fn !== 'function' || fn.__rpWorkSections) return;
    var wrapped = function (data) {
      fn.apply(this, arguments);
      if (data) hookData(data);
    };
    wrapped.__rpWorkSections = true;
    window.__rpRender = wrapped;
  }
  hookRender();

  function start() {
    var source = findWorkSection();
    if (!source) return;
    hookRender();
    new MutationObserver(schedule).observe(source, { childList: true, subtree: false });
    apply();
    loadDataOnce();
    // Designs render their grid after fetching data; keep checking briefly.
    var tries = 0;
    var timer = setInterval(function () {
      hookRender();
      if (sectionList(window.__rpData).length) apply();
      if (++tries > 40) clearInterval(timer);
    }, 250);
  }

  window.addEventListener('load', hookRender);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
