const { Router } = require('express');
const { dbAll, dbGet, dbRun, dbBatch } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { SEED_PRODUCTS } = require('../seed');
const { sendEmail } = require('../email');

const router = Router();

// GET /api/admin/products — list all products WITH cost (admin only)
router.get('/products', authenticate, requireAdmin, (req, res) => {
  try {
    const rows = dbAll('SELECT * FROM products ORDER BY id');
    const products = rows.map(row => {
      const sizes = dbAll('SELECT size, stock FROM product_sizes WHERE product_id = ? ORDER BY id', [row.id]);
      const images = dbAll('SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order', [row.id]);
      const sizeStock = {};
      const sizeList = [];
      for (const s of sizes) {
        sizeList.push(s.size);
        sizeStock[s.size] = s.stock;
      }
      return {
        id: row.id, name: row.name, cat: row.cat, icon: row.icon,
        tag: row.tag, subtag: row.subtag,
        price: row.price, cost: row.cost || 0, stock: row.stock,
        sizes: sizeList, sizeStock,
        images: images.map(i => i.url),
        desc: row.desc || ''
      };
    });
    res.json({ products });
  } catch (err) {
    console.error('Admin products error:', err);
    res.status(500).json({ error: 'Failed to load products' });
  }
});

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

// GET /api/admin/test-email — send a test email (admin only)
router.get('/test-email', authenticate, requireAdmin, (req, res) => {
  const to = req.user && req.user.email ? req.user.email : process.env.ADMIN_EMAIL;
  sendEmail({
    to,
    subject: 'DuGuud — Test email from your store',
    html: '<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;"><h2 style="color:#221e1c;">✅ Email working!</h2><p style="font-size:14px;color:#4a423e;">This is a test email from your DuGuud store at <strong>' + process.env.SMTP_HOST + '</strong>.</p><hr style="border:none;border-top:1px solid #eee;margin:20px 0;"><p style="font-size:12px;color:#4a423e;">You\'ll now receive order notifications and can send shipping updates to customers.</p></div>'
  }).then(sent => {
    res.json({ success: sent, message: sent ? 'Test email sent successfully' : 'Email failed — check SMTP settings' });
  });
});

module.exports = router;
