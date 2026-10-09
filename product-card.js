/**
 * The single definition of a product card and the storefront grid.
 *
 * Why this file exists: the storefront is a client-rendered app, so the HTML
 * Google's crawler downloads for the homepage contained an empty
 * <div id="productGrid"> — no products, no prices, nothing. Merchant Center's
 * "add your website" flow therefore found almost nothing. The grid is now
 * rendered on the server as well, and this module is what both sides call, so
 * the crawlable HTML and the hydrated HTML cannot disagree.
 *
 * (Same arrangement as product-jsonld.js, for the same reason — the last time
 * two copies of a renderer existed they drifted.)
 *
 * Loads as a plain <script> in the browser (window.ProductCard) and as a
 * CommonJS module on the server.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ProductCard = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Thresholds shared by the card flag and the size dropdown so they can't
  // contradict each other.
  var LOW_STOCK = 5;        // product-level "Only N left"
  var LOW_SIZE_STOCK = 3;   // per-size hint inside the dropdown

  var ARROW_L = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
  var ARROW_R = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

  var ICONS = {
    hoodie: '<svg viewBox="0 0 64 64" fill="none" stroke-width="2"><path d="M20 10 L12 18 L16 24 L20 20 V54 H44 V20 L48 24 L52 18 L44 10 C40 14 24 14 20 10Z" stroke-linejoin="round"/><circle cx="32" cy="18" r="3"/></svg>',
    tee: '<svg viewBox="0 0 64 64" fill="none" stroke-width="2"><path d="M22 8 L10 16 L16 26 L22 22 V56 H42 V22 L48 26 L54 16 L42 8 C40 12 24 12 22 8Z" stroke-linejoin="round"/></svg>',
    dress: '<svg viewBox="0 0 64 64" fill="none" stroke-width="2"><path d="M26 8 H38 L40 20 L52 54 H12 L24 20 Z" stroke-linejoin="round"/><path d="M26 8 C26 14 38 14 38 8"/></svg>',
    jeans: '<svg viewBox="0 0 64 64" fill="none" stroke-width="2"><path d="M18 8 H46 L48 56 L34 56 L32 30 L30 56 L16 56 Z" stroke-linejoin="round"/></svg>',
    jacket: '<svg viewBox="0 0 64 64" fill="none" stroke-width="2"><path d="M20 10 L8 18 L14 28 L20 22 V54 H44 V22 L50 28 L56 18 L44 10 H36 L32 16 L28 10 Z" stroke-linejoin="round"/></svg>',
    sneaker: '<svg viewBox="0 0 64 64" fill="none" stroke-width="2"><path d="M6 42 C10 34 16 30 22 30 L30 22 C34 18 40 18 42 22 L46 30 H54 C58 30 58 38 54 40 L48 44 H8 Z" stroke-linejoin="round"/></svg>',
    flipflop: '<svg viewBox="0 0 64 64" fill="none" stroke-width="2"><ellipse cx="32" cy="44" rx="22" ry="10" stroke-linejoin="round"/><path d="M14 44 C16 36 18 22 30 14 C30 14 34 14 34 14 C46 22 48 36 50 44" stroke-linejoin="round"/><path d="M26 14 L28 42" stroke-linejoin="round"/><path d="M38 14 L36 42" stroke-linejoin="round"/><path d="M20 30 L22 46" stroke-linejoin="round"/><path d="M44 30 L42 46" stroke-linejoin="round"/></svg>',
  };

  function fmt(n) { return 'R ' + Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2 }); }

  // Names and descriptions come from scraped retailer pages, so they must be
  // escaped everywhere they land in markup — including inside attributes.
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function stockFlag(stock) {
    if (stock === 0) return '<span class="stock-flag out">Sold out</span>';
    if (stock <= LOW_STOCK) return '<span class="stock-flag low">Only ' + stock + ' left</span>';
    return '';
  }

  // Stock for one size. Tests !== undefined rather than truthiness: a size with
  // 0 left is falsy, and a truthiness check falls through to the product total,
  // which would offer a sold-out size as available.
  function sizeAvail(p, size) {
    if (p && p.sizeStock && p.sizeStock[size] !== undefined) return p.sizeStock[size];
    return p ? p.stock : 0;
  }

  function sizeOptionsHtml(p) {
    return (p.sizes || []).map(function (s) {
      var q = sizeAvail(p, s);
      var label = q <= LOW_SIZE_STOCK ? s + ' (' + q + ' left)' : s;
      return '<option value="' + esc(s) + '"' + (q === 0 ? ' disabled' : '') + '>' + esc(label) + '</option>';
    }).join('');
  }

  function renderCard(p) {
    var cardImgs = (p.images && p.images.length) ? p.images : [];
    var href = 'product.html?id=' + encodeURIComponent(p.id);
    var soldOut = p.stock === 0;

    return '<div class="card" onclick="location.href=\'' + href + '\'" style="cursor:pointer">' +
      '<div class="card-media">' +
        stockFlag(p.stock) +
        '<a class="card-link" href="' + href + '" aria-label="Open ' + esc(p.name) + '">' +
          (cardImgs.length
            ? '<img src="' + esc(cardImgs[0]) + '" alt="' + esc(p.name) + '" class="card-img" id="cardimg-' + esc(p.id) + '" data-idx="0">'
            : (ICONS[p.icon] || '')) +
        '</a>' +
        (cardImgs.length > 1
          ? '<button class="card-arrow prev" onclick="cycleCardImage(event,\'' + esc(p.id) + '\',-1)" aria-label="Previous photo">' + ARROW_L + '</button>' +
            '<button class="card-arrow next" onclick="cycleCardImage(event,\'' + esc(p.id) + '\',1)" aria-label="Next photo">' + ARROW_R + '</button>'
          : '') +
      '</div>' +
      '<div class="card-body">' +
        '<span class="card-cat">' + (p.brand ? esc(p.brand) + ' · ' : '') + esc(p.cat) + '</span>' +
        '<a class="card-name" href="' + href + '">' + esc(p.name) + '</a>' +
        (p.desc ? '<span class="card-desc">' + esc(p.desc) + '</span>' : '') +
        '<span class="price-tag">' + fmt(p.price) + '</span>' +
        '<div class="option-row" onclick="event.stopPropagation()">' +
          '<select id="size-' + esc(p.id) + '"' + (soldOut ? ' disabled' : '') + '>' + sizeOptionsHtml(p) + '</select>' +
          '<input type="number" class="qty-input" id="qty-' + esc(p.id) + '" value="1" min="1" max="' + p.stock + '"' +
            (soldOut ? ' disabled' : '') + ' onclick="event.stopPropagation()">' +
        '</div>' +
        '<button class="add-btn"' + (soldOut ? ' disabled' : '') +
          ' onclick="event.stopPropagation();addToCart(\'' + esc(p.id) + '\')">' +
          (soldOut ? 'Sold Out' : 'Add to Basket') +
        '</button>' +
      '</div>' +
    '</div>';
  }

  var TAG_ORDER = ['Tops', 'Bottoms', 'Shoes', 'Accessories'];

  // Same ordering the storefront has always used: by tag, then Summer first.
  function sortProducts(items) {
    return items.slice().sort(function (a, b) {
      var ta = TAG_ORDER.indexOf(a.tag || 'Tops');
      var tb = TAG_ORDER.indexOf(b.tag || 'Tops');
      if (ta !== tb) return ta - tb;
      if (a.subtag === 'Summer' && b.subtag !== 'Summer') return -1;
      if (a.subtag !== 'Summer' && b.subtag === 'Summer') return 1;
      return 0;
    });
  }

  function groupByTag(items) {
    var sections = {};
    items.forEach(function (p) {
      var sec = p.tag || 'Tops';
      (sections[sec] = sections[sec] || []).push(p);
    });
    return sections;
  }

  // The full grid: section headings plus cards, or an empty state.
  function renderGrid(products, emptyHtml) {
    var items = sortProducts(products || []);
    var sections = groupByTag(items);

    var html = TAG_ORDER.map(function (sec) {
      var prods = sections[sec];
      if (!prods || !prods.length) return '';
      return '<div class="section-group"><h3 class="section-label">' + esc(sec) + '</h3><div class="grid">' +
        prods.map(renderCard).join('') +
      '</div></div>';
    }).join('');

    if (!items.length) {
      return emptyHtml || '<div class="filter-empty">Nothing in stock matches that combination.</div>';
    }
    return html;
  }

  // Products as schema.org ItemList — lets a crawler see the catalogue as data
  // rather than having to parse card markup.
  function buildItemList(products, opts) {
    opts = opts || {};
    var base = String(opts.baseUrl || '').replace(/\/+$/, '');
    return {
      '@context': 'https://schema.org/',
      '@type': 'ItemList',
      name: opts.name || 'DuGuud products',
      numberOfItems: (products || []).length,
      itemListElement: (products || []).map(function (p, i) {
        return {
          '@type': 'ListItem',
          position: i + 1,
          url: base + '/product.html?id=' + encodeURIComponent(p.id),
          name: p.name,
        };
      }),
    };
  }

  return {
    LOW_STOCK: LOW_STOCK,
    LOW_SIZE_STOCK: LOW_SIZE_STOCK,
    ARROW_L: ARROW_L,
    ARROW_R: ARROW_R,
    ICONS: ICONS,
    fmt: fmt,
    esc: esc,
    stockFlag: stockFlag,
    sizeAvail: sizeAvail,
    renderCard: renderCard,
    renderGrid: renderGrid,
    sortProducts: sortProducts,
    buildItemList: buildItemList,
  };
});
