// Google Merchant Center product feed.
//
// Why one <item> per (product, size): sizes carry independent stock, so a single
// row per product would advertise sizes that don't exist. Google needs
// per-variant availability, hence g:item_group_id to tie the variants back
// together as one product with options.
//
// Two things here are easy to get wrong and both cause silent disapprovals:
//   - g:identifier_exists must be "no" when there is no GTIN/MPN, otherwise
//     Google assumes you're withholding one and rejects the item.
//   - g:description must not be empty.
//
// Deliberately NOT served from /api/products: that endpoint filters out
// zero-stock products, and a feed has to include them so listings go
// out_of_stock rather than vanishing and losing their history.

const BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://www.duguud.co.za').replace(/\/+$/, '');

function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function absoluteImage(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return BASE_URL + '/' + String(url).replace(/^\/+/, '');
}

// Google rejects an empty description, and about a third of the catalogue has
// none. This keeps items eligible; it does not make them sell — real
// descriptions are still worth writing.
function feedDescription(product) {
  const text = String(product.desc || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 5000);
  return (product.name + ' — last stock, honestly priced, from DuGuud. ' +
    'Genuine ' + (product.brand || 'branded') + ' stock, limited sizes available.').slice(0, 5000);
}

// Merchant Center's own category taxonomy, keyed off our tag.
const CATEGORY_BY_TAG = {
  Shoes:       'Apparel & Accessories > Shoes',
  Tops:        'Apparel & Accessories > Clothing > Shirts & Tops',
  Bottoms:     'Apparel & Accessories > Clothing > Pants',
  Accessories: 'Apparel & Accessories > Clothing Accessories',
};

function priceString(rands) {
  return Number(rands).toFixed(2) + ' ZAR';
}

// products: rows straight from the products table. sizes: [{product_id, size, stock}].
function buildFeed(products, sizesByProduct) {
  const items = [];

  for (const p of products) {
    const images = (p.images || []).map(absoluteImage).filter(Boolean);
    const sizeRows = sizesByProduct[p.id] || [];
    const link = BASE_URL + '/product.html?id=' + encodeURIComponent(p.id);

    for (const row of sizeRows) {
      const inStock = Number(row.stock) > 0;
      const item = [
        '<g:id>' + xmlEsc(p.id + '-' + row.size) + '</g:id>',
        '<g:item_group_id>' + xmlEsc(p.id) + '</g:item_group_id>',
        '<g:title>' + xmlEsc(String(p.name).slice(0, 150)) + '</g:title>',
        '<g:description>' + xmlEsc(feedDescription(p)) + '</g:description>',
        '<g:link>' + xmlEsc(link) + '</g:link>',
        images[0] ? '<g:image_link>' + xmlEsc(images[0]) + '</g:image_link>' : '',
        images[1] ? '<g:additional_image_link>' + xmlEsc(images[1]) + '</g:additional_image_link>' : '',
        '<g:availability>' + (inStock ? 'in_stock' : 'out_of_stock') + '</g:availability>',
        '<g:price>' + priceString(p.price) + '</g:price>',
        '<g:condition>new</g:condition>',
        p.brand ? '<g:brand>' + xmlEsc(p.brand) + '</g:brand>' : '',
        '<g:size>' + xmlEsc(row.size) + '</g:size>',
        p.tag === 'Shoes' ? '<g:size_system>UK</g:size_system>' : '',
        '<g:size_type>regular</g:size_type>',
        CATEGORY_BY_TAG[p.tag] ? '<g:google_product_category>' + xmlEsc(CATEGORY_BY_TAG[p.tag]) + '</g:google_product_category>' : '',
        // No GTINs or MPNs in this catalogue — declaring that is mandatory,
        // otherwise Google treats the omission as withholding.
        '<g:identifier_exists>no</g:identifier_exists>',
      ].filter(Boolean);

      // A variant with no image can't be listed; skip rather than submit a
      // guaranteed disapproval.
      if (!images.length) continue;

      items.push('    <item>\n      ' + item.join('\n      ') + '\n    </item>');
    }
  }

  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n' +
    '  <channel>\n' +
    '    <title>DuGuud</title>\n' +
    '    <link>' + xmlEsc(BASE_URL) + '</link>\n' +
    '    <description>Last stock from South Africa\'s biggest brands, honestly priced.</description>\n' +
    items.join('\n') + '\n' +
    '  </channel>\n</rss>\n';
}

module.exports = { buildFeed, BASE_URL, absoluteImage, xmlEsc };
