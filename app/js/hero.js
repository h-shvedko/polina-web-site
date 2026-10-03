/*
 * hero.js: video facade of the home hero (ADR-0003, SPEC section 9). Nothing is requested from YouTube before
 * the click. Activating button.hero__play (mouse, touch, Enter or Space) inserts the youtube-nocookie.com
 * player (autoplay, muted, loop, no controls) as iframe.hero__video into .hero__media, removes the button,
 * removes the poster once the player has loaded, and sends hero_video_play (analytics.js, only with consent).
 * After keyboard activation focus moves to the player (the removed button would leave focus nowhere).
 */
(function () {
  'use strict';

  var button = document.querySelector('.hero__play[data-youtube-id]');
  if (!button) return;

  button.addEventListener('click', function (e) {
    var id = button.getAttribute('data-youtube-id');
    var media = button.parentNode;
    if (!id || !media) return;
    var vid = encodeURIComponent(id);
    var poster = media.querySelector('.hero__poster');
    var frame = document.createElement('iframe');
    frame.className = 'hero__video';
    frame.title = 'Polina Shvedko Art video';
    frame.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    frame.src = 'https://www.youtube-nocookie.com/embed/' + vid + '?autoplay=1&mute=1&loop=1&playlist=' + vid + '&controls=0&playsinline=1&rel=0';
    frame.addEventListener('load', function () {
      if (poster && poster.parentNode) poster.parentNode.removeChild(poster);
    });
    media.insertBefore(frame, button);
    media.removeChild(button);
    if (e.detail === 0) frame.focus(); // keyboard click
    if (window.siteAnalytics) window.siteAnalytics.track('hero_video_play', { video_id: id });
  });
})();
