/* ── Gallery filter (Available / Sold / All) ──────────────────────────────── */
(function () {
  document.querySelectorAll('.gallery-filter').forEach(function (bar) {
    var targetId = bar.dataset.galleryTarget;
    var container = targetId ? document.getElementById(targetId) : null;
    if (!container) return;

    bar.querySelectorAll('.gallery-filter__btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var filter = btn.dataset.filter;

        /* Update active button */
        bar.querySelectorAll('.gallery-filter__btn').forEach(function (b) {
          b.classList.toggle('gallery-filter__btn--active', b === btn);
        });

        /* Show/hide product cards */
        container.querySelectorAll('.js-product').forEach(function (card) {
          var isSold = card.querySelector('.t754__markwrapper') !== null;
          var show = filter === 'all'
            || (filter === 'available' && !isSold)
            || (filter === 'sold' && isSold);
          card.style.display = show ? '' : 'none';
        });

        /* Fire GA4 event */
        if (typeof gtag === 'function') {
          gtag('event', 'gallery_filter', {
            event_category: 'gallery',
            filter_value: filter,
            gallery_id: targetId || 'unknown'
          });
        }
      });
    });
  });
})();
