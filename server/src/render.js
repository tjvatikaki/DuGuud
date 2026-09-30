// Server-side injection of product SEO tags.
//
// Why this exists: product.html ships as an empty shell that fills itself in with
// JavaScript. Googlebot executes JS, but the scrapers behind Instagram, TikTok,
// WhatsApp, Facebook, LinkedIn, Slack and X do not — so every shared product link
// previewed as a bare "DuGuud — Product" with no image. That is the single biggest
// leak for a store whose traffic comes from social.
//
// This rewrites the <head> before the page leaves the server. The page still
// hydrates exactly as before, and injectProductSEO() in product.html updates the
// same tags in place, so users see no difference.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://www.duguud.co.za').replace(/\/+$/, '');

let template = null;
let templateOk = false;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Product names/descriptions can originate from scraped retailer pages, so they
// are escaped everywhere they land in markup.
function loadTemplate() {
  if (template) return templateOk ? template : null;
  try {
    const html = fs.readFileSync(path.join(ROOT, 'product.html'), 'utf8');
    // The <title> is our injection anchor. If it ever disappears, fail loudly at
    // request time but still serve the page — degraded SEO beats a broken page.
    templateOk = /<title>[\s\S]*?<\/title>/i.test(html);
    if (!templateOk) {
      console.error('! render.js: product.html has no <title> to anchor SEO injection on');
    }
    template = html;
  } catch (e) {
    console.error('! render.js: could not read product.html —', e.message);
    templateOk = false;
    template = null;
  }
  return templateOk ? template : null;
}

function absoluteImage(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return BASE_URL + '/' + String(url).replace(/^\/+/, '');
}

function metaDescription(product) {
  const text = stripTags(product.desc) ||
    (product.name + ' — last stock, honestly priced, from DuGuud.');
  if (text.length <= 155) return text;
  // Trim on a word boundary so the snippet doesn't end mid-word
  return text.slice(0, 152).replace(/\s+\S*$/, '') + '…';
}

// Returns the full HTML for a product page, or null if injection isn't possible
// (caller should fall through to the static file).
function renderProductPage(product) {
  const tpl = loadTemplate();
  if (!tpl) return null;

  const url = BASE_URL + '/product.html?id=' + encodeURIComponent(product.id);
  const desc = metaDescription(product);
  const images = (product.images || []).map(absoluteImage).filter(Boolean);
  const hero = images[0] || '';
  const inStock = product.stock > 0;

  const jsonLd = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: product.name,
    description: stripTags(product.desc) || product.name,
    image: images,
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: 'ZAR',
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url
    }
  };

  const tags = [
    '<title>' + esc(product.name) + ' — DuGuud</title>',
    '<meta name="description" content="' + esc(desc) + '">',
    '<link rel="canonical" href="' + esc(url) + '">',
    '<meta property="og:type" content="product">',
    '<meta property="og:site_name" content="DuGuud">',
    '<meta property="og:title" content="' + esc(product.name) + '">',
    '<meta property="og:description" content="' + esc(desc) + '">',
    '<meta property="og:url" content="' + esc(url) + '">',
    hero ? '<meta property="og:image" content="' + esc(hero) + '">' : '',
    hero ? '<meta property="og:image:alt" content="' + esc(product.name) + '">' : '',
    '<meta name="twitter:card" content="' + (hero ? 'summary_large_image' : 'summary') + '">',
    '<meta name="twitter:title" content="' + esc(product.name) + '">',
    '<meta name="twitter:description" content="' + esc(desc) + '">',
    hero ? '<meta name="twitter:image" content="' + esc(hero) + '">' : '',
    '<meta property="product:price:amount" content="' + esc(product.price) + '">',
    '<meta property="product:price:currency" content="ZAR">',
    '<meta property="product:availability" content="' + (inStock ? 'in stock' : 'out of stock') + '">',
    // '<' escaped so a product name containing "</script>" can't break out
    '<script type="application/ld+json" id="productLd">' +
      JSON.stringify(jsonLd).replace(/</g, '\\u003c') + '</script>'
  ].filter(Boolean).join('\n');

  return tpl.replace(/<title>[\s\S]*?<\/title>/i, tags);
}

module.exports = { renderProductPage, BASE_URL };
