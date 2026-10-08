/**
 * The single definition of a product's JSON-LD.
 *
 * Why this file exists: product structured data used to be built twice — once
 * server-side in server/src/render.js for crawlers that don't run JS, and again
 * client-side in product.html after hydration. The two copies had already
 * drifted in spirit if not yet in output, and anything added to one silently
 * vanished from the other the moment the page hydrated. Now there is one
 * builder and both call it. The only genuine difference between the two call
 * sites was always the base URL, which is a parameter here.
 *
 * Loads as a plain <script> in the browser (exposes window.ProductJsonLd) and
 * as a CommonJS module on the server.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ProductJsonLd = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  function absolute(url, baseUrl) {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    return String(baseUrl || '').replace(/\/+$/, '') + '/' + String(url).replace(/^\/+/, '');
  }

  /**
   * @param {object} product   { name, description, images[], price, stock, brand, id }
   * @param {object} opts      { baseUrl, url, rating }
   *   rating: { ratingValue, reviewCount } — omit or pass null when there are none.
   * @returns {object} schema.org Product
   */
  function build(product, opts) {
    opts = opts || {};
    const baseUrl = opts.baseUrl || '';
    const images = (product.images || []).map(function (u) { return absolute(u, baseUrl); }).filter(Boolean);

    const ld = {
      '@context': 'https://schema.org/',
      '@type': 'Product',
      name: product.name,
      description: opts.description || product.description || product.name,
      image: images,
      offers: {
        '@type': 'Offer',
        price: product.price,
        priceCurrency: 'ZAR',
        availability: product.stock > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
        // This is unsold retail stock, never used or refurbished.
        itemCondition: 'https://schema.org/NewCondition',
        url: opts.url,
      },
    };

    if (product.brand) ld.brand = { '@type': 'Brand', name: product.brand };
    if (product.id) ld.sku = String(product.id);

    // Only when there is at least one real approved review. An empty or
    // self-serving aggregate is a guidelines violation, and a 0-count rating
    // block is worse than no block at all.
    if (opts.rating && opts.rating.reviewCount > 0) {
      ld.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: String(opts.rating.ratingValue),
        reviewCount: String(opts.rating.reviewCount),
        bestRating: '5',
        worstRating: '1',
      };
    }

    return ld;
  }

  // Shared so both call sites emit byte-identical markup. '<' is escaped so a
  // product name containing "</script>" can't break out of the tag.
  function toScriptTag(ld, id) {
    return '<script type="application/ld+json"' + (id ? ' id="' + id + '"' : '') + '>' +
      JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>';
  }

  return { build: build, toScriptTag: toScriptTag, absolute: absolute };
});
