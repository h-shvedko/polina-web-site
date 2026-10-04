/*
 * nav.js: sticky site navigation (ADR-0003, SPEC section 9), as on the old site.
 * Home: the nav starts with site-nav--hidden and switches to site-nav--visible once the hero (header.hero) has
 * left the viewport completely; back over the hero it hides again. While a nav link has keyboard focus the
 * nav stays visible, so focus is never on an off-screen link.
 * Other pages (no hero), or no IntersectionObserver: always site-nav--visible.
 * In-page links (Explore Artworks -> #gallery-oil) use native anchor scrolling; site.css sets the offset.
 * On narrow screens the link row scrolls sideways and snaps to the start of a link. An edge of the row that cuts
 * a label (its text, not only the link's padding) is marked: site-nav__links--more-start (labels before the left
 * edge, e.g. after a swipe to the end) and site-nav__links--more-end (labels after the right edge); site.css fades
 * a marked edge (--fade-start / --fade-end), so no label shows a hard cut, and the right fade is the cue that the
 * row goes on. A link that gets keyboard focus while it is cut off or under a fade moves to the start of the row,
 * just after the left fade (a snap position: site.css scroll-padding-left = --fade-start).
 */
(function () {
  'use strict';

  var nav = document.getElementById('site-nav');
  if (!nav) return;
  var hero = document.querySelector('header.hero');

  var row = nav.querySelector('.site-nav__links');
  if (row) {
    var px = function (el, prop) { return parseFloat(window.getComputedStyle(el)[prop]) || 0; };
    var fade = function (name) { return parseFloat(window.getComputedStyle(row).getPropertyValue(name)) || 0; };
    /* the text of a link: its box without the side padding */
    var textEdges = function (link) {
      var r = link.getBoundingClientRect();
      return { left: r.left + px(link, 'paddingLeft'), right: r.right - px(link, 'paddingRight'), boxLeft: r.left };
    };
    var edges = function () {
      var links = row.querySelectorAll('.site-nav__link');
      if (!links.length) return;
      var box = row.getBoundingClientRect();
      row.classList.toggle('site-nav__links--more-start', textEdges(links[0]).left < box.left - 0.5);
      row.classList.toggle('site-nav__links--more-end', textEdges(links[links.length - 1]).right > box.right + 0.5);
    };
    row.addEventListener('scroll', edges, { passive: true });
    window.addEventListener('resize', edges);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(edges);
    edges();
    row.addEventListener('focusin', function (e) {
      // keyboard focus only: a mouse or touch press focuses the link too, and scrolling then would move the
      // link away from under the pointer before the click
      try { if (!e.target.matches(':focus-visible')) return; } catch (err) { /* no :focus-visible support */ }
      var t = textEdges(e.target);
      var box = row.getBoundingClientRect();
      var start = row.classList.contains('site-nav__links--more-start') ? fade('--fade-start') : 0;
      var end = row.classList.contains('site-nav__links--more-end') ? fade('--fade-end') : 0;
      if (t.left < box.left + start - 0.5 || t.right > box.right - end + 0.5) {
        row.scrollLeft += t.boxLeft - box.left - fade('--fade-start');
        edges();
      }
    });
  }

  function set(visible) {
    nav.classList.toggle('site-nav--visible', visible);
    nav.classList.toggle('site-nav--hidden', !visible);
  }

  if (!hero || !('IntersectionObserver' in window)) {
    set(true);
    return;
  }

  var overHero = true;
  var focused = false;
  function update() { set(focused || !overHero); }

  new IntersectionObserver(function (entries) {
    overHero = entries[entries.length - 1].isIntersecting;
    update();
  }).observe(hero);

  nav.addEventListener('focusin', function () {
    focused = true;
    update();
  });
  nav.addEventListener('focusout', function (e) {
    if (nav.contains(e.relatedTarget)) return;
    focused = false;
    update();
  });
})();
