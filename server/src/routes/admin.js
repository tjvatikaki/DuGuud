const { Router } = require('express');
const { dbAll, dbGet, dbRun, dbBatch } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { SEED_PRODUCTS } = require('../seed');
const { sendEmail } = require('../email');
const { assembleAdminProduct } = require('../product-model');
const { resolveBrand, normaliseBrand } = require('../brand-map');

const router = Router();

// GET /api/admin/products — list all products WITH cost (admin only).
// Unfiltered: includes hidden and zero-stock rows, unlike the public list.
router.get('/products', authenticate, requireAdmin, (req, res) => {
  try {
    const rows = dbAll('SELECT * FROM products ORDER BY id');
    res.json({ products: rows.map(assembleAdminProduct) });
  } catch (err) {
    console.error('Admin products error:', err);
    res.status(500).json({ error: 'Failed to load products' });
  }
});

// POST /api/admin/backfill-brands — fill in `products.brand` from product names.
//
// Runs against whatever database the server is pointed at, which for production
// is the only one that matters: the local dev copy is a stale snapshot. Defaults
// to a dry run — pass { "dryRun": false } to actually write. By default it only
// touches rows whose brand is currently empty, so re-running is safe and it will
// never clobber a brand you set by hand; pass { "overwrite": true } to force.
router.post('/backfill-brands', authenticate, requireAdmin, (req, res) => {
  try {
    const dryRun = req.body ? req.body.dryRun !== false : true;
    const overwrite = !!(req.body && req.body.overwrite);

    const rows = dbAll('SELECT id, name, brand FROM products ORDER BY id');
    const changes = [];
    const skipped = [];

    for (const row of rows) {
      const current = normaliseBrand(row.brand);
      const { brand: proposed, source } = resolveBrand(row);

      if (!proposed) {
        skipped.push({ id: row.id, name: row.name, reason: 'no brand could be inferred' });
        continue;
      }
      // Normalising "RCVA" -> "RVCA" counts as a change even when a value exists.
      if (current === proposed) continue;
      if (current && !overwrite) {
        skipped.push({ id: row.id, name: row.name, reason: 'already set to "' + current + '"', proposed });
        continue;
      }
      changes.push({ id: row.id, name: row.name, from: current, to: proposed, source });
    }

    if (!dryRun) {
      dbBatch(() => {
        for (const c of changes) {
          dbRun('UPDATE products SET brand = ? WHERE id = ?', [c.to, c.id]);
        }
      });
    }

    res.json({
      dryRun,
      scanned: rows.length,
      changed: changes.length,
      applied: dryRun ? 0 : changes.length,
      needsAttention: skipped.length,
      changes,
      skipped,
    });
  } catch (err) {
    console.error('Backfill brands error:', err);
    res.status(500).json({ error: 'Backfill failed' });
  }
});

// POST /api/admin/seed — re-seed the database with all default products
// NOTE: this DELETEs every product first. It is a first-run bootstrap, not a
// migration — never call it on a live catalogue.
router.post('/seed', authenticate, requireAdmin, (req, res) => {
  try {
    dbBatch(() => {
      // Clear existing products (FK cascade handles sizes and images)
      dbRun('DELETE FROM product_images');
      dbRun('DELETE FROM product_sizes');
      dbRun('DELETE FROM products');

      for (const p of SEED_PRODUCTS) {
        dbRun(
          'INSERT INTO products (id, name, cat, icon, tag, subtag, brand, price, stock, desc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [p.id, p.name, p.cat, p.icon || 'tee', p.tag || 'Tops',
           p.subtag || '', p.brand || '', p.price, p.stock, p.desc || '']
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
    html: '<div style="font-family:Archivo,sans-serif;max-width:560px;margin:0 auto;"><h2 style="color:#16130f;">Email working!</h2><p style="font-size:14px;color:#5c564e;">This is a test email from your DuGuud store at <strong>' + process.env.SMTP_HOST + '</strong>.</p><hr style="border:none;border-top:1px solid rgba(22,19,15,0.14);margin:20px 0;"><p style="font-size:12px;color:#5c564e;">You\'ll now receive order notifications and can send shipping updates to customers.</p></div>'
  }).then(sent => {
    res.json({ success: sent, message: sent ? 'Test email sent successfully' : 'Email failed — check SMTP settings' });
  });
});

module.exports = router;
