/**
 * DuGuud analytics loader.
 *
 * One place to configure Google Analytics. Until GA4_ID is filled in below,
 * every function here is a no-op, so the pages can ship this file before the
 * measurement ID exists and nothing breaks or fires junk.
 *
 * ─── To turn it on ───────────────────────────────────────────────────────────
 *  1. Create a GA4 property at https://analytics.google.com
 *  2. Copy the Measurement ID (looks like G-XXXXXXXXXX)
 *  3. Paste it into GA4_ID below
 *  4. Add the same ID to the GA4 data stream's "excluded URL query parameters":
 *     brand, type, size  — otherwise every filtered storefront view is counted
 *     as its own page and your reports fragment.
 *
 * ─── About purchase tracking ─────────────────────────────────────────────────
 * There is deliberately no `purchase` event here. Checkout hands the browser
 * off to PayFast and the customer returns on a different page, so the GA
 * session (and its client id) does not survive the round trip — a client-side
 * purchase event would be counted but attributed to nothing, which is worse
 * than not having it.
 *
 * Doing it properly means:
 *   1. Pass the GA client id through checkout in PayFast's free `custom_str2`
 *      field (custom_str1 already carries the order id).
 *   2. On the ITN callback — which is the only place that knows the order was
 *      really paid — POST a Measurement Protocol event server-side to
 *      https://www.google-analytics.com/mp/collect with that client id.
 *
 * The ITN handler already guards against replays (payments.js checks whether
 * the order is already paid before doing anything), so a purchase recorded
 * there fires exactly once even though PayFast retries.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  // ←←← Paste the GA4 Measurement ID here to switch analytics on.
  var GA4_ID = '';

  if (!GA4_ID || GA4_ID.indexOf('G-') !== 0) return;

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA4_ID);
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  // send_page_view false + an explicit page_view keeps the URL we report free
  // of filter params, so /?brand=Puma&size=9 doesn't count as a distinct page.
  gtag('config', GA4_ID, { send_page_view: false });
  gtag('event', 'page_view', {
    page_location: location.origin + location.pathname,
    page_title: document.title,
  });
})();

/**
 * Fire a GA4 event. Safe to call anywhere — does nothing when analytics is off.
 */
function trackEvent(name, params) {
  if (typeof window.gtag !== 'function') return;
  window.gtag('event', name, params || {});
}
