/*
 * hero.js: video facade of the home hero (ADR-0003, SPEC section 9). Nothing is requested from YouTube before
 * the click. Activating button.hero__play (mouse, touch, Enter or Space) inserts the youtube-nocookie.com player
 * (autoplay, muted, loop, no controls) as iframe.hero__video over the poster and sends hero_video_play
 * (analytics.js, only with consent).
 * The poster stays below the player, which is transparent until it reports that it plays (YouTube IFrame API
 * messages, enablejsapi=1): a blocked or failed player leaves the poster, not a black hero. A player that never
 * answers (blocked by a content blocker or a firewall, offline) is removed again after about 10 s, and one that
 * reports an error at once, so the button never says "Pause the video" over a still poster.
 * The same button then stops the motion: "Pause the video" (pauseVideo; before the player plays, the player is
 * removed again) and "Play the video" (playVideo). Focus stays on the button.
 */
(function () {
  'use strict';

  var ORIGIN = 'https://www.youtube-nocookie.com';
  var button = document.querySelector('.hero__play[data-youtube-id]');
  var media = document.querySelector('.hero__media');
  var id = button && button.getAttribute('data-youtube-id');
  if (!button || !media || !id) return;

  var frame = null;
  var state = 'idle'; // idle -> loading -> playing <-> paused; loading -> idle (stopped before it played)
  var asking = null; // interval that asks the player for its state until it answers

  function set(next) {
    state = next;
    var moving = next === 'loading' || next === 'playing';
    button.classList.toggle('hero__play--active', moving);
    button.setAttribute('aria-label', moving ? 'Pause the video' : 'Play the video');
    media.classList.toggle('hero__media--playing', next === 'playing' || next === 'paused');
  }

  function send(message) {
    if (frame && frame.contentWindow) frame.contentWindow.postMessage(JSON.stringify(message), ORIGIN);
  }

  function stopAsking() {
    if (asking) clearInterval(asking);
    asking = null;
  }

  /* The IFrame API protocol: after "listening", the player posts its state (infoDelivery / onStateChange). Any
     answer stops the asking; no answer after 40 tries (about 10 s): there is no player, so it is removed. */
  function listen() {
    var tries = 0;
    stopAsking();
    send({ event: 'listening', id: 1, channel: 'widget' });
    asking = setInterval(function () {
      if (++tries > 40) remove();
      else send({ event: 'listening', id: 1, channel: 'widget' });
    }, 250);
  }

  window.addEventListener('message', function (e) {
    if (!frame || e.origin !== ORIGIN || e.source !== frame.contentWindow) return;
    var data = e.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (err) { return; }
    }
    if (!data || typeof data !== 'object') return;
    stopAsking();
    if (data.event === 'onError') { // the video cannot play here (removed, not embeddable, player error)
      remove();
      return;
    }
    var playerState = data.event === 'onStateChange' ? data.info : data.info && data.info.playerState;
    if (playerState === 1 && state === 'loading') set('playing');
  });

  function start() {
    var vid = encodeURIComponent(id);
    frame = document.createElement('iframe');
    frame.className = 'hero__video';
    frame.title = 'Polina Shvedko Art video';
    frame.tabIndex = -1; // no controls inside (controls=0, no pointer events): not a Tab stop
    frame.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    frame.src = ORIGIN + '/embed/' + vid + '?autoplay=1&mute=1&loop=1&playlist=' + vid +
      '&controls=0&playsinline=1&rel=0&enablejsapi=1&origin=' + encodeURIComponent(window.location.origin);
    frame.addEventListener('load', listen);
    var poster = media.querySelector('.hero__poster');
    media.insertBefore(frame, poster ? poster.nextSibling : media.firstChild);
    set('loading');
    if (window.siteAnalytics) window.siteAnalytics.track('hero_video_play', { video_id: id });
  }

  function remove() {
    stopAsking();
    if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
    frame = null;
    set('idle');
  }

  button.addEventListener('click', function () {
    if (state === 'idle') start();
    else if (state === 'loading') remove();
    else if (state === 'playing') {
      send({ event: 'command', func: 'pauseVideo', args: [], id: 1, channel: 'widget' });
      set('paused');
    } else {
      send({ event: 'command', func: 'playVideo', args: [], id: 1, channel: 'widget' });
      set('playing');
    }
  });
})();
