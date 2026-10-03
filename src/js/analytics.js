/*
 * analytics.js: GA4 events (ADR-0003, SPEC section 9). Sends nothing unless consent.js reports "granted" and
 * has defined gtag. Events:
 *   contact_click    any click on a [data-track="contact"] link (the mailto: links). Parameters: link_location =
 *                    its data-location (hero | intro | artwork | contact | footer); artwork_slug = its
 *                    data-artwork-slug (artwork CTA only, left out elsewhere).
 *   hero_video_play  sent by hero.js through window.siteAnalytics.track(). Parameter: video_id.
 * window.siteAnalytics = { track(name, params) }; it returns true when the event went to gtag.
 */
(function () {
  'use strict';

  function track(name, params) {
    var consent = window.siteConsent;
    if (!consent || consent.status() !== 'granted' || typeof window.gtag !== 'function') return false;
    window.gtag('event', name, params || {});
    return true;
  }

  window.siteAnalytics = { track: track };

  document.addEventListener('click', function (e) {
    var link = e.target && e.target.closest ? e.target.closest('[data-track="contact"]') : null;
    if (!link) return;
    var params = { link_location: link.getAttribute('data-location') || 'other' };
    var slug = link.getAttribute('data-artwork-slug');
    if (slug) params.artwork_slug = slug;
    track('contact_click', params);
  });
})();
