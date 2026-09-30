// Shared product shape.
//
// Lives here rather than in routes/products.js so the SEO renderer can use the
// exact same shape as the public API — two definitions would drift, and the
// rendered page has to match what the client re-renders after hydration.
const { dbAll, dbGet } = require('./db');

function assembleProduct(row) {
  if (!row) return null;
  const sizes = dbAll('SELECT size, stock FROM product_sizes WHERE product_id = ? ORDER BY id', [row.id]);
  const images = dbAll('SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order', [row.id]);

  const sizeStock = {};
  const sizeList = [];
  for (const s of sizes) {
    sizeList.push(s.size);
    sizeStock[s.size] = s.stock;
  }

  return {
    id: row.id,
    name: row.name,
    cat: row.cat,
    icon: row.icon,
    tag: row.tag,
    subtag: row.subtag,
    price: row.price,
    stock: row.stock,
    sizes: sizeList,
    sizeStock,
    images: images.map(i => i.url),
    desc: row.desc || '',
    hidden: row.hidden || 0
  };
}

// Publicly visible products only — same filter the storefront API uses.
function listVisibleProducts() {
  return dbAll('SELECT * FROM products WHERE stock > 0 AND hidden = 0 ORDER BY id').map(assembleProduct);
}

function getVisibleProduct(id) {
  const row = dbGet('SELECT * FROM products WHERE id = ?', [id]);
  if (!row || row.hidden) return null;
  return assembleProduct(row);
}

module.exports = { assembleProduct, listVisibleProducts, getVisibleProduct };
