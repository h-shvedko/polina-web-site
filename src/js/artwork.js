/*
 * artwork.js: image switcher and full-screen view of the artwork page (ADR-0003, SPEC section 9), like the old
 * popup slider and its zoom.
 *
 * Switcher (more than one image): one picture at a time in #artwork-images (the others carry hidden);
 * thumbnails, the previous/next buttons, the Left/Right arrow keys and a horizontal swipe change it. No
 * wrap-around, as before: "previous" is hidden on the first image and "next" on the last. The current thumbnail
 * has aria-current="true"; with focus on a thumbnail, the arrow keys move focus along. Lazy images start loading
 * when a neighbour is shown or the gallery is hovered, focused or touched, so switching does not wait.
 *
 * Full-screen view (every artwork page): button.artwork__zoom covers the main image (this script shows it) and
 * opens dialog#artwork-zoom with the current image as large as the window allows (the image's srcset, sizes
 * 100vw: the 1920 px variant on desktop). Previous/next buttons, Left/Right keys and swipe switch the image;
 * the cross, Escape or a click beside the image close it; the page then shows the image viewed last and focus
 * returns to the image.
 *
 * Switching fades the new image in (here and in the full-screen view; Web Animations, opacity only, so nothing
 * moves), except with prefers-reduced-motion: reduce.
 *
 * Without JS this does nothing: a <noscript> style shows every image, and the zoom button stays hidden.
 */
(function () {
  'use strict';

  var gallery = document.querySelector('.artwork__gallery');
  var main = gallery && gallery.querySelector('.artwork__main');
  if (!main) return;
  var slides = [].slice.call(main.querySelectorAll('picture[data-index]'));
  var count = slides.length;
  if (!count) return;
  var multiple = count > 1 && gallery.classList.contains('artwork__gallery--multiple');
  var thumbs = [].slice.call(gallery.querySelectorAll('.artwork__thumb[data-index]'));
  var prev = gallery.querySelector('.artwork__prev');
  var next = gallery.querySelector('.artwork__next');
  var stage = gallery.querySelector('.artwork__stage') || main;
  var page = gallery.closest('main') || document.body;
  var current = 0;
  for (var k = 0; k < count; k++) {
    if (!slides[k].hidden) { current = k; break; }
  }

  var reduced = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  /* fade an image in that has just been shown */
  function fadeIn(el) {
    if (reduced || !el || typeof el.animate !== 'function') return;
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: 'ease-out' });
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
    if (!multiple || i < 0 || i >= count || i === current) return;
    current = i;
    render(focusThumb);
    fadeIn(slides[i]);
    preloadAround(i);
  }

  /* A horizontal swipe on `el` calls step(+1 | -1); a pinch or a zoomed-in page (the finger pans) does not. */
  function onSwipe(el, step, before) {
    var startX = null;
    var startY = 0;
    el.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { startX = null; return; } // pinch
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      if (before) before();
    }, { passive: true });
    el.addEventListener('touchend', function (e) {
      if (startX === null || !e.changedTouches.length) return;
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;
      startX = null;
      if (window.visualViewport && window.visualViewport.scale > 1.01) return;
      if (Math.abs(dx) >= 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
    }, { passive: true });
    el.addEventListener('touchcancel', function () { startX = null; }, { passive: true });
  }

  /* ---------------------------------------------------------------- full-screen view */
  var opener = stage.querySelector('.artwork__zoom');
  var dialog = document.getElementById('artwork-zoom');
  var zoomable = Boolean(opener && dialog && typeof dialog.showModal === 'function');
  var shown = 0; // image index in the full-screen view

  function show(i) {
    shown = i;
    var box = dialog.querySelector('.zoom__stage');
    var pic = slides[i].cloneNode(true);
    pic.hidden = false;
    pic.removeAttribute('data-index');
    pic.className = 'zoom__picture';
    [].forEach.call(pic.querySelectorAll('source, img'), function (el) { el.setAttribute('sizes', '100vw'); });
    var img = pic.querySelector('img');
    if (img) {
      img.removeAttribute('loading');
      img.removeAttribute('fetchpriority');
    }
    box.textContent = '';
    box.appendChild(pic);
    var zp = dialog.querySelector('.zoom__prev');
    var zn = dialog.querySelector('.zoom__next');
    var active = document.activeElement;
    if (zp) zp.hidden = i === 0;
    if (zn) zn.hidden = i === count - 1;
    var other = active && active.hidden && (active === zp ? zn : zp); // the arrow the user was on is gone
    if (other) other.focus();
  }

  function step(delta) {
    var to = shown + delta;
    if (multiple && to >= 0 && to < count) {
      show(to);
      fadeIn(dialog.querySelector('.zoom__picture'));
    }
  }

  if (zoomable) {
    opener.hidden = false;
    opener.addEventListener('click', function () {
      show(current);
      document.documentElement.classList.add('zoom-open');
      dialog.showModal();
      // showModal() focuses the first button (the cross), and an arrow key press then draws its focus ring for a
      // mouse user: the dialog (tabindex="-1") takes the focus instead; its label is announced, Tab reaches the
      // cross and the arrows, and the arrow keys switch the image as before
      dialog.focus();
    });
    dialog.addEventListener('close', function () {
      document.documentElement.classList.remove('zoom-open');
      dialog.querySelector('.zoom__stage').textContent = '';
      go(shown);
      opener.focus();
    });
    dialog.addEventListener('click', function (e) {
      var button = e.target.closest('button');
      if (button && button.classList.contains('zoom__close')) dialog.close();
      else if (button && button.classList.contains('zoom__prev')) step(-1);
      else if (button && button.classList.contains('zoom__next')) step(1);
      else if (e.target === dialog || e.target.classList.contains('zoom__stage')) dialog.close(); // beside the image
    });
    onSwipe(dialog, step);
  }

  /* ---------------------------------------------------------------- switcher */
  gallery.addEventListener('click', function (e) {
    var button = e.target.closest('button');
    if (!button) return;
    if (button.classList.contains('artwork__thumb')) go(indexOf(button));
    else if (button === prev) go(current - 1);
    else if (button === next) go(current + 1);
  });

  document.addEventListener('keydown', function (e) {
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    var delta = e.key === 'ArrowRight' ? 1 : -1;
    if (zoomable && dialog.open) {
      e.preventDefault();
      step(delta);
      return;
    }
    if (!multiple) return;
    var el = document.activeElement;
    if (el && el !== document.body && el !== document.documentElement && !page.contains(el)) return; // nav, footer, banner
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    var to = current + delta;
    if (to < 0 || to >= count) return;
    e.preventDefault();
    go(to, thumbs.indexOf(el) !== -1);
  });

  if (!multiple) return;

  onSwipe(stage, function (delta) { go(current + delta); }, function () { preloadAround(current); });

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
