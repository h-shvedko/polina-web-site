/* ── Sticky nav — show after hero leaves viewport ─────────────────────────── */
(function () {
  var nav = document.getElementById('site-nav');
  if (!nav) return;

  var hero = document.querySelector('.t-cover');
  if (!hero) {
    nav.classList.add('site-nav--visible');
    return;
  }

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        nav.classList.remove('site-nav--visible');
      } else {
        nav.classList.add('site-nav--visible');
      }
    });
  }, { threshold: 0.1 });

  observer.observe(hero);

  /* Smooth scroll for anchor links */
  nav.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var target = document.getElementById(link.getAttribute('href').slice(1));
      if (!target) return;
      e.preventDefault();
      var offset = nav.offsetHeight + 8;
      var top = target.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top: top, behavior: 'smooth' });
    });
  });
})();
