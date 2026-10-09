// Server-side rendering of the storefront homepage.
//
// Why: index.html ships as a shell whose product grid is filled in by
// JavaScript. Googlebot executes JS, but the crawler behind Merchant Center's
// "add your website" flow was finding almost nothing — the HTML it downloaded
// had an empty <div id="productGrid">, so a 46-product catalogue looked like a
// handful of items. Non-JS crawlers and social scrapers saw the same nothing.
//
// This injects the grid (and an ItemList) before the page leaves the server.
// The page still hydrates exactly as before, and because the browser renders
// from the SAME product-card.js, the swap is invisible.
//
// Same shape as render.js, which does this for product pages.

const fs = require('fs');
const path = require('path');
const ProductCard = require('../../product-card');
const { listVisibleProducts } = require('./product-model');

const ROOT = path.join(__dirname, '..', '..');
const BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://www.duguud.co.za').replace(/\/+$/, '');

const GRID_ANCHOR = '<div id="productGrid"></div>';

let template = null;
let templateOk = false;

function loadTemplate() {
  if (template) return templateOk ? template : null;
  try {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    // The empty grid div is our injection anchor. If it disappears the server
    // can't render anything into it, so fail loudly in the log but still serve
    // the page — a shell that hydrates is degraded, not broken.
    templateOk = html.includes(GRID_ANCHOR);
    if (!templateOk) {
      console.error('! render-index.js: index.html has no empty ' + GRID_ANCHOR + ' to inject into');
    }
    template = html;
  } catch (e) {
    console.error('! render-index.js: could not read index.html —', e.message);
    templateOk = false;
    template = null;
  }
  return templateOk ? template : null;
}

// Returns homepage HTML with the catalogue rendered in, or null to fall back to
// the static file.
function renderIndexPage() {
  const tpl = loadTemplate();
  if (!tpl) return null;

  let products;
  try {
    products = listVisibleProducts();
  } catch (e) {
    console.error('! render-index.js: could not load products —', e.message);
    return null;
  }
  if (!products.length) return null; // nothing to add; the shell is fine

  const gridHtml = ProductCard.renderGrid(products);
  const itemList = ProductCard.buildItemList(products, { baseUrl: BASE_URL });

  // '<' escaped so a product name containing "</script>" can't break out.
  const ldTag = '<script type="application/ld+json" id="catalogueLd">' +
    JSON.stringify(itemList).replace(/</g, '\\u003c') + '</script>';

  return tpl
    .replace(GRID_ANCHOR, '<div id="productGrid">' + gridHtml + '</div>')
    .replace('</head>', ldTag + '\n</head>');
}

module.exports = { renderIndexPage, BASE_URL };
