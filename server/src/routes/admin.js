const { Router } = require('express');
const { dbRun, dbBatch } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { SEED_PRODUCTS } = require('../seed');

const router = Router();

// POST /api/admin/seed — re-seed the database with all default products
router.post('/seed', authenticate, requireAdmin, (req, res) => {
  try {
    dbBatch(() => {
      // Clear existing products (FK cascade handles sizes and images)
      dbRun('DELETE FROM product_images');
      dbRun('DELETE FROM product_sizes');
      dbRun('DELETE FROM products');

      for (const p of SEED_PRODUCTS) {
        dbRun(
          'INSERT INTO products (id, name, cat, icon, tag, subtag, price, stock, desc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [p.id, p.name, p.cat, p.icon || 'tee', p.tag || 'Tops',
           p.subtag || '', p.price, p.stock, p.desc || '']
        );

        const sizes = p.sizes || ['One Size'];
        for (const size of sizes) {
          const qty = (p.sizeStock && p.sizeStock[size] !== undefined) ? p.sizeStock[size] : 1;
          dbRun('INSERT INTO product_sizes (product_id, size, stock) VALUES (?, ?, ?)', [p.id, size, qty]);
        }

        if (p.images && p.images.length) {
          p.images.forEach((url, i) => {
            dbRun('INSERT INTO product_images (product_id, url, sort_order) VALUES (?, ?, ?)', [p.id, url, i]);
          });
        }
      }
    });

    res.json({ count: SEED_PRODUCTS.length, message: `Seeded ${SEED_PRODUCTS.length} products` });
  } catch (err) {
    console.error('Seed error:', err);
    res.status(500).json({ error: 'Seed failed: ' + err.message });
  }
});

module.exports = router;
