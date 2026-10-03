/*
 * artwork.js: image switcher of the artwork page (ADR-0003, SPEC section 9), like the old popup slider.
 * One picture at a time in #artwork-images (the others carry hidden); thumbnails, the previous/next buttons,
 * the Left/Right arrow keys and a horizontal swipe change it. No wrap-around, as before: "previous" is hidden
 * on the first image and "next" on the last. The current thumbnail has aria-current="true"; with focus on a
 * thumbnail, the arrow keys move focus along. Lazy images start loading when a neighbour is shown or the
 * gallery is hovered, focused or touched, so switching does not wait for the network.
 * Without JS (or with one image) this does nothing; a <noscript> style then shows every image.
 */
(function () {
  'use strict';

  var gallery = document.querySelector('.artwork__gallery--multiple');
  var main = gallery && gallery.querySelector('.artwork__main');
  if (!main) return;
  var slides = [].slice.call(main.querySelectorAll('picture[data-index]'));
  var thumbs = [].slice.call(gallery.querySelectorAll('.artwork__thumb[data-index]'));
  var prev = gallery.querySelector('.artwork__prev');
  var next = gallery.querySelector('.artwork__next');
  var stage = gallery.querySelector('.artwork__stage') || main;
  var page = gallery.closest('main') || document.body;
  var count = slides.length;
  if (count < 2) return;
  var current = 0;
  for (var k = 0; k < count; k++) {
    if (!slides[k].hidden) { current = k; break; }
  }

  function indexOf(el) { return Number(el.getAttribute('data-index')); }
  function thumb(i) { return thumbs.filter(function (t) { return indexOf(t) === i; })[0]; }

  function preload(i) {
    var img = slides[i] && slides[i].querySelector('img');
    if (img && img.loading === 'lazy') img.loading = 'eager';
  }
  function preloadAround(i) { preload(i); preload(i - 1); preload(i + 1); }

  function render(focusThumb) {
    var active = document.activeElement;
    slides.forEach(function (s, i) { s.hidden = i !== current; });
    thumbs.forEach(function (t) { t.setAttribute('aria-current', String(indexOf(t) === current)); });
    if (prev) prev.hidden = current === 0;
    if (next) next.hidden = current === count - 1;
    var lost = active && (active === prev || active === next) && active.hidden; // the button the user was on
    var target = (focusThumb || lost) && thumb(current);
    if (target) target.focus();
  }

  function go(i, focusThumb) {
    if (i < 0 || i >= count || i === current) return;
    current = i;
    render(focusThumb);
    preloadAround(i);
  }

  gallery.addEventListener('click', function (e) {
    var button = e.target.closest('button');
    if (!button) return;
    if (button.classList.contains('artwork__thumb')) go(indexOf(button));
    else if (button === prev) go(current - 1);
    else if (button === next) go(current + 1);
  });

  document.addEventListener('keydown', function (e) {
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    var el = document.activeElement;
    if (el && el !== document.body && el !== document.documentElement && !page.contains(el)) return; // nav, footer, banner
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    var to = current + (e.key === 'ArrowRight' ? 1 : -1);
    if (to < 0 || to >= count) return;
    e.preventDefault();
    go(to, thumbs.indexOf(el) !== -1);
  });

  var startX = null;
  var startY = 0;
  stage.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { startX = null; return; } // pinch
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    preloadAround(current);
  }, { passive: true });
  stage.addEventListener('touchend', function (e) {
    if (startX === null || !e.changedTouches.length) return;
    var dx = e.changedTouches[0].clientX - startX;
    var dy = e.changedTouches[0].clientY - startY;
    startX = null;
    if (window.visualViewport && window.visualViewport.scale > 1.01) return; // zoomed in: the finger pans
    if (Math.abs(dx) >= 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) go(current + (dx < 0 ? 1 : -1));
  }, { passive: true });
  stage.addEventListener('touchcancel', function () { startX = null; }, { passive: true });

  function warm(e) {
    var t = e.target.closest && e.target.closest('.artwork__thumb');
    if (t) preload(indexOf(t));
    else preloadAround(current);
  }
  gallery.addEventListener('pointerover', warm);
  gallery.addEventListener('focusin', warm);

  main.setAttribute('aria-live', 'polite'); // announce the alt text of the image that appears
  render(false);
})();
