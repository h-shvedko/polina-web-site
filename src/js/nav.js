/*
 * nav.js: sticky site navigation (ADR-0003, SPEC section 9), as on the old site.
 * Home: the nav starts with site-nav--hidden and switches to site-nav--visible once the hero (header.hero) has
 * left the viewport completely; back over the hero it hides again. While a nav link has keyboard focus the
 * nav stays visible, so focus is never on an off-screen link.
 * Other pages (no hero), or no IntersectionObserver: always site-nav--visible.
 * In-page links (Explore Artworks -> #gallery-oil) use native anchor scrolling; site.css sets the offset.
 */
(function () {
  'use strict';

  var nav = document.getElementById('site-nav');
  if (!nav) return;
  var hero = document.querySelector('header.hero');

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
