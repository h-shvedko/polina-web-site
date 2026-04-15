/**
 * Custom GA4 event tracking for polina-shvedko.art
 *
 * Tracks:
 *  - contact_click  : visitor clicks the mailto: email link
 *  - artwork_view   : visitor opens an artwork popup (card image or MORE button)
 *  - cart_order     : visitor submits the cart inquiry form
 */

(function () {
    function trackEvent(eventName, params) {
        if (typeof gtag === 'function') {
            gtag('event', eventName, params || {});
        }
    }

    document.addEventListener('DOMContentLoaded', function () {

        // ── 1. Contact email click ────────────────────────────────────────────
        document.querySelectorAll('a[href^="mailto:"]').forEach(function (el) {
            el.addEventListener('click', function () {
                trackEvent('contact_click', {
                    event_category: 'engagement',
                    event_label: el.getAttribute('href').replace('mailto:', '')
                });
            });
        });

        // ── 2. Artwork popup open ─────────────────────────────────────────────
        // Tilda catalog opens popups when any [href="#prodpopup"] is clicked.
        // Both the card image link and the MORE button use this href pattern.
        // We delegate from document to catch dynamically initialised elements.
        document.addEventListener('click', function (e) {
            var link = e.target.closest('a[href="#prodpopup"]');
            if (!link) return;

            var product = link.closest('.js-product[data-product-lid]');
            if (!product) return;

            var lid   = product.getAttribute('data-product-lid') || '';
            var title = (product.querySelector('.js-product-name') || {}).textContent || lid;
            var price = (product.querySelector('.js-product-price') || {}).textContent || '';

            trackEvent('artwork_view', {
                event_category: 'gallery',
                artwork_lid:    lid,
                artwork_title:  title.trim(),
                artwork_price:  price.trim()
            });
        });

        // ── 3. Cart / inquiry form submit ─────────────────────────────────────
        // The Tilda cart form fires its own AJAX submit; we listen on the
        // submit button click so we capture the intent even if the form
        // validation later fails. For a confirmed order track the Tilda
        // success callback (t706_onSuccessCallback) if it exists.
        var cartForm = document.getElementById('form500073028');
        if (cartForm) {
            cartForm.addEventListener('submit', function () {
                // Collect the first product title from the cart DOM if available
                var firstProduct = document.querySelector('.t706__cartwin-products .t706__product-title');
                trackEvent('cart_order', {
                    event_category: 'conversion',
                    event_label: firstProduct ? firstProduct.textContent.trim() : 'unknown'
                });
            });
        }

        // Patch Tilda's order-success callback to fire a confirmed conversion
        var _origSuccess = window.t706_onSuccessCallback;
        window.t706_onSuccessCallback = function () {
            trackEvent('purchase_inquiry', { event_category: 'conversion' });
            if (typeof _origSuccess === 'function') _origSuccess.apply(this, arguments);
        };

    });
})();
