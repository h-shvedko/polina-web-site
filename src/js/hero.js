/*
 * hero.js: video facade of the home hero (ADR-0003, SPEC section 9). Nothing is requested from YouTube before
 * the click. Activating button.hero__play (mouse, touch, Enter or Space) inserts the youtube-nocookie.com player
 * (autoplay, muted, loop, no controls) as iframe.hero__video in div.hero__player over the poster and sends
 * hero_video_play (analytics.js, only with consent). site.css sizes the player from div.hero__player (a size
 * container as large as the hero), so the video covers the hero and the player's own title bar and logo lie
 * outside it.
 * The poster stays below the player, which is transparent until it reports that it plays (YouTube IFrame API
 * messages, enablejsapi=1): a blocked or failed player leaves the poster, not a black hero. A player is removed
 * again, so the button never says "Pause the video" over a still poster, when
 *   - its page never loads, after 20 s: a content blocker, a firewall or no connection (Firefox and Safari fire
 *     no load event then, and a dropped connection keeps Chromium waiting for minutes); after 60 s on a
 *     connection the browser reports as 2G (Chromium reports "Slow 3G" so; the player page needs about 35 s there);
 *   - its page loaded but the player never answers, after about 10 s;
 *   - it reports an error, at once.
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

  var player = null; // div.hero__player around the iframe
  var frame = null;
  var state = 'idle'; // idle -> loading -> playing <-> paused; loading -> idle (stopped before it played)
  var asking = null; // interval that asks the player for its state until it answers
  var waiting = null; // timeout that removes a player whose page never loads

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

  /* ms for the player page to load before the player is removed (see above), read at each start because the
     connection can change while the page is open */
  function loadTimeout() {
    var connection = navigator.connection;
    return connection && /2g$/.test(connection.effectiveType || '') ? 60000 : 20000;
  }

  function stopWaiting() {
    if (waiting) clearTimeout(waiting);
    waiting = null;
  }

  /* The IFrame API protocol: after "listening", the player posts its state (infoDelivery / onStateChange). Any
     answer stops the asking; no answer after 40 tries (about 10 s): there is no player, so it is removed.
     Runs when the player page has loaded (the load event), which also ends the wait for the page. */
  function listen() {
    var tries = 0;
    stopWaiting();
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
    stopWaiting();
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
    player = document.createElement('div');
    player.className = 'hero__player';
    frame = document.createElement('iframe');
    frame.className = 'hero__video';
    frame.title = 'Polina Shvedko Art video';
    frame.tabIndex = -1; // no controls inside (controls=0, no pointer events): not a Tab stop
    frame.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    frame.src = ORIGIN + '/embed/' + vid + '?autoplay=1&mute=1&loop=1&playlist=' + vid +
      '&controls=0&playsinline=1&rel=0&enablejsapi=1&origin=' + encodeURIComponent(window.location.origin);
    frame.addEventListener('load', listen);
    player.appendChild(frame);
    var poster = media.querySelector('.hero__poster');
    media.insertBefore(player, poster ? poster.nextSibling : media.firstChild);
    set('loading');
    waiting = setTimeout(remove, loadTimeout()); // the page never loaded: no load event, no answer
    if (window.siteAnalytics) window.siteAnalytics.track('hero_video_play', { video_id: id });
  }

  function remove() {
    stopWaiting();
    stopAsking();
    if (player && player.parentNode) player.parentNode.removeChild(player);
    player = null;
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
