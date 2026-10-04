/*
 * consent.js: cookie consent banner and Google Analytics 4 (ADR-0003, SPEC section 9).
 *
 * - The choice is stored in localStorage "cookie_consent_v2" = "granted" | "denied". When storage is blocked,
 *   the choice holds for the current page only and the banner shows again on the next page.
 * - Nothing is requested from Google before "granted". On Accept, and on later pages with "granted": Consent
 *   Mode v2 defaults (all denied), update analytics_storage=granted, then gtag.js?id=<data-ga-id of this tag>.
 * - Decline: GA is never loaded. Switching from granted to denied also disables GA on the current page and
 *   deletes the Google Analytics cookies (_ga, _ga_<id>, _gid, _gat*, _gac_*).
 * - The footer button #cookie-settings and window.siteConsent.open() reopen the banner; Escape closes a
 *   reopened banner without changing the choice.
 * - While the banner is open, <html> has the class consent-open and --consent-h = the banner height (kept up
 *   to date by a ResizeObserver): site.css keeps that room at the end of the page and above the hero play
 *   button, so the banner never hides content or keyboard focus.
 * - window.siteConsent = { status(): "granted" | "denied" | null (no choice yet), open() }.
 */
(function () {
  'use strict';

  var KEY = 'cookie_consent_v2';
  var LEGACY_KEY = 'cookie_consent'; // flag of the old "by continuing to browse" bar: not valid consent
  var GA_COOKIE = /^(_ga|_gid|_gat|_gac)(_|$)/;

  var tag = document.currentScript || document.querySelector('script[data-ga-id]');
  var gaId = (tag && tag.getAttribute('data-ga-id')) || '';
  var banner = document.getElementById('cookie-consent');
  var memory = null; // the choice made on this page (the only copy when storage is blocked)
  var loaded = false; // gtag.js injected on this page
  var active = false; // loaded and allowed to measure
  var returnFocus = null; // where focus goes back when a reopened banner closes
  var watching = false; // ResizeObserver / resize listener installed

  function status() {
    try {
      var value = window.localStorage.getItem(KEY);
      if (value === 'granted' || value === 'denied') return value;
    } catch (e) { /* storage blocked */ }
    return memory;
  }

  function store(value) {
    memory = value;
    try { window.localStorage.setItem(KEY, value); } catch (e) { /* the choice lasts for this page only */ }
  }

  function gtag() { window.dataLayer.push(arguments); }

  function loadGa() {
    if (!gaId || active) return;
    active = true;
    window['ga-disable-' + gaId] = false;
    if (loaded) {
      gtag('consent', 'update', { analytics_storage: 'granted' });
      return;
    }
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = gtag;
    gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
    gtag('consent', 'update', { analytics_storage: 'granted' });
    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(gaId);
    document.head.appendChild(script);
    gtag('js', new Date());
    gtag('config', gaId);
  }

  /* Expire the GA cookies host-only and for every parent domain (GA sets them on the registrable domain). */
  function deleteGaCookies() {
    var names = document.cookie.split(';').map(function (c) { return c.split('=')[0].trim(); }).filter(function (n) { return GA_COOKIE.test(n); });
    if (!names.length) return;
    var labels = window.location.hostname.split('.');
    var domains = [''];
    for (var i = 0; i < labels.length - 1; i++) domains.push(';domain=' + labels.slice(i).join('.'));
    names.forEach(function (name) {
      domains.forEach(function (domain) {
        document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/' + domain;
      });
    });
  }

  function disableGa() {
    if (gaId) window['ga-disable-' + gaId] = true;
    if (active) gtag('consent', 'update', { analytics_storage: 'denied' });
    active = false;
    deleteGaCookies();
  }

  /* Room for the open banner: html.consent-open + --consent-h (see site.css), removed when it closes. */
  function reserve() {
    var root = document.documentElement;
    if (!banner || banner.hidden) {
      root.classList.remove('consent-open');
      root.style.removeProperty('--consent-h');
      return;
    }
    root.style.setProperty('--consent-h', banner.offsetHeight + 'px');
    root.classList.add('consent-open');
  }

  function show(focus) {
    if (!banner) return;
    banner.hidden = false;
    reserve();
    if (!watching) {
      watching = true;
      if (window.ResizeObserver) new window.ResizeObserver(reserve).observe(banner);
      else window.addEventListener('resize', reserve);
    }
    var first = focus && banner.querySelector('button');
    if (first) first.focus();
  }

  function hide() {
    if (!banner || banner.hidden) return;
    var hadFocus = banner.contains(document.activeElement);
    banner.hidden = true;
    reserve();
    if (hadFocus && returnFocus && document.body.contains(returnFocus)) returnFocus.focus();
    returnFocus = null;
  }

  function open(from) {
    returnFocus = from && from !== document.body && typeof from.focus === 'function' ? from : null;
    show(true);
  }

  function apply(value) {
    hide();
    if (value === 'granted') loadGa();
    else disableGa();
  }

  function choose(value) {
    store(value);
    apply(value);
  }

  var accept = document.getElementById('cookie-accept');
  var decline = document.getElementById('cookie-decline');
  var settings = document.getElementById('cookie-settings');
  if (accept) accept.addEventListener('click', function () { choose('granted'); });
  if (decline) decline.addEventListener('click', function () { choose('denied'); });
  if (settings) settings.addEventListener('click', function () { open(settings); });
  if (banner) {
    banner.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && status()) hide();
    });
  }
  /* A choice made in another tab, or on another page before Back/Forward restored this one from the cache,
     applies here too (a withdrawal must stop GA everywhere). */
  window.addEventListener('storage', function (e) {
    if (e.key === KEY && (e.newValue === 'granted' || e.newValue === 'denied')) {
      memory = e.newValue;
      apply(e.newValue);
    }
  });
  window.addEventListener('pageshow', function (e) {
    var value = e.persisted && status();
    if (value) apply(value);
  });

  window.siteConsent = {
    status: status,
    open: function () { open(document.activeElement); },
  };

  try { window.localStorage.removeItem(LEGACY_KEY); } catch (e) { /* storage blocked */ }

  var initial = status();
  if (initial === 'granted') loadGa();
  else if (initial === 'denied') deleteGaCookies();
  else show(false);
})();
