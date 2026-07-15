const { Router } = require('express');
const { dbAll, dbGet, dbRun, dbTransaction } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = Router();

// ─── Helpers: assemble / disassemble product JSON ───

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
    desc: row.desc || ''
  };
}

function deleteProductSizesAndImages(productId) {
  dbRun('DELETE FROM product_images WHERE product_id = ?', [productId]);
  dbRun('DELETE FROM product_sizes WHERE product_id = ?', [productId]);
}

function insertSizes(productId, sizes, sizeStock) {
  const list = sizes || ['One Size'];
  for (const size of list) {
    const qty = (sizeStock && sizeStock[size] !== undefined) ? sizeStock[size] : 1;
    dbRun('INSERT INTO product_sizes (product_id, size, stock) VALUES (?, ?, ?)', [productId, size, qty]);
  }
}

function insertImages(productId, images) {
  if (!images || !images.length) return;
  images.forEach((url, i) => {
    dbRun('INSERT INTO product_images (product_id, url, sort_order) VALUES (?, ?, ?)', [productId, url, i]);
  });
}

function computeTotalStock(sizes, sizeStock) {
  let total = 0;
  const list = sizes || ['One Size'];
  for (const size of list) {
    total += (sizeStock && sizeStock[size] !== undefined) ? sizeStock[size] : 1;
  }
  return total;
}

// ─── Routes ───

// GET /api/products — public list
router.get('/', (req, res) => {
  try {
    const rows = dbAll('SELECT * FROM products ORDER BY id');
    const products = rows.map(assembleProduct);
    res.json({ products });
  } catch (err) {
    console.error('Get products error:', err);
    res.status(500).json({ error: 'Failed to load products' });
  }
});

// GET /api/products/:id — public single
router.get('/:id', (req, res) => {
  try {
    const row = dbGet('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Product not found' });
    res.json({ product: assembleProduct(row) });
  } catch (err) {
    console.error('Get product error:', err);
    res.status(500).json({ error: 'Failed to load product' });
  }
});

// POST /api/products — admin create
router.post('/', authenticate, requireAdmin, (req, res) => {
  try {
    const p = req.body;
    const productId = p.id || 'p' + Date.now();
    const totalStock = computeTotalStock(p.sizes, p.sizeStock);

    dbRun(
      'INSERT INTO products (id, name, cat, icon, tag, subtag, price, stock, desc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [productId, p.name, p.cat || 'men', p.icon || 'tee', p.tag || 'Tops',
       p.subtag || '', p.price, totalStock, p.desc || '']
    );

    insertSizes(productId, p.sizes, p.sizeStock);
    insertImages(productId, p.images);

    const row = dbGet('SELECT * FROM products WHERE id = ?', [productId]);
    res.status(201).json({ product: assembleProduct(row) });
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// PUT /api/products/:id — admin update
router.put('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const p = req.body;
    const productId = req.params.id;

    const existing = dbGet('SELECT * FROM products WHERE id = ?', [productId]);
    if (!existing) return res.status(404).json({ error: 'Product not found' });

    const totalStock = computeTotalStock(p.sizes, p.sizeStock);

    dbRun(
      "UPDATE products SET name=?, cat=?, icon=?, tag=?, subtag=?, price=?, stock=?, desc=?, updated_at=datetime('now') WHERE id=?",
      [p.name, p.cat || 'men', p.icon || 'tee', p.tag || 'Tops',
       p.subtag || '', p.price, totalStock, p.desc || '', productId]
    );

    // Replace sizes and images
    deleteProductSizesAndImages(productId);
    insertSizes(productId, p.sizes, p.sizeStock);
    insertImages(productId, p.images);

    const row = dbGet('SELECT * FROM products WHERE id = ?', [productId]);
    res.json({ product: assembleProduct(row) });
  } catch (err) {
    console.error('Update product error:', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// DELETE /api/products/:id — admin delete (cascade via FK)
router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const existing = dbGet('SELECT id FROM products WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Product not found' });

    dbRun('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete product error:', err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

module.exports = router;
