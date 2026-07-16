require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const { getDb, dbGet, dbAll, dbRun, dbBatch } = require('./db');
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');
const paymentRoutes = require('./routes/payments');
const trackingRoutes = require('./routes/tracking');
const { authenticate, requireAdmin } = require('./middleware/auth');

const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@duguud.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// ─── Bootstrap: seed admin + products on first start ───
function bootstrap() {
  // Seed admin user if none exists
  if (ADMIN_PASSWORD) {
    const existingAdmin = dbGet("SELECT id FROM users WHERE role = 'admin'");
    if (existingAdmin) {
      // Always reset admin password from env on startup (prevents lockouts)
      const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
      dbRun('UPDATE users SET password = ?, email = ? WHERE id = ?', [hash, ADMIN_EMAIL, existingAdmin.id]);
      console.log('✓ Admin password synced from .env');
    } else {
      const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
      dbRun("INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, 'admin')",
            ['Admin', ADMIN_EMAIL, '', hash]);
      console.log('✓ Admin user created: ' + ADMIN_EMAIL);
    }
  } else {
    console.warn('⚠ ADMIN_PASSWORD not set — admin user will not be auto-created');
  }

  // Auto-seed products if the table is empty
  const count = dbGet('SELECT COUNT(*) AS c FROM products');
  if (!count || count.c === 0) {
    const { SEED_PRODUCTS } = require('./seed');
    dbBatch(() => {
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
    console.log('✓ Seeded ' + SEED_PRODUCTS.length + ' products into database');
  }
}

// ─── Express App ───
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true })); // Needed for PayFast ITN (form POST)

// Static files — serve the project root so HTML/JS/CSS/images all work
app.use(express.static(path.join(__dirname, '..', '..')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use(paymentRoutes); // mounts /api/checkout, /api/payments/itn, /payment/success, /payment/cancel
app.use(trackingRoutes); // mounts /api/tracking/lookup, /track

// Image upload route (admin only)
const multer = require('multer');
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', '..', 'images'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 6) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
  fileFilter: (req, file, cb) => {
    const ok = /\.(jpg|jpeg|png|webp|gif)$/i.test(path.extname(file.originalname));
    cb(null, ok);
  }
});

app.post('/api/upload', authenticate, requireAdmin, upload.array('images', 20), (req, res) => {
  if (!req.files || !req.files.length) {
    return res.status(400).json({ error: 'No files uploaded' });
  }
  const urls = req.files.map(f => 'images/' + f.filename);
  res.json({ files: urls });
});

// ─── SEO routes ───
app.get('/robots.txt', (req, res) => {
  const base = req.protocol + '://' + req.get('host');
  res.type('text/plain').send(
    'User-agent: *\n' +
    'Allow: /\n' +
    'Sitemap: ' + base + '/sitemap.xml\n'
  );
});

app.get('/sitemap.xml', (req, res) => {
  const products = dbAll("SELECT id, updated_at FROM products ORDER BY id");
  const baseUrl = req.protocol + '://' + req.get('host');

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  xml += '  <url><loc>' + baseUrl + '/</loc><priority>1.0</priority></url>\n';
  xml += '  <url><loc>' + baseUrl + '/register.html</loc><priority>0.3</priority></url>\n';

  for (const p of products) {
    const updated = p.updated_at ? p.updated_at.split(' ')[0] : new Date().toISOString().split('T')[0];
    xml += '  <url>\n';
    xml += '    <loc>' + baseUrl + '/product.html?id=' + encodeURIComponent(p.id) + '</loc>\n';
    xml += '    <lastmod>' + updated + '</lastmod>\n';
    xml += '    <priority>0.8</priority>\n';
    xml += '  </url>\n';
  }

  xml += '</urlset>';
  res.header('Content-Type', 'application/xml').send(xml);
});

// 404 catch-all for unknown API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// ─── Start ───
async function start() {
  await getDb(); // Initialize sql.js database
  bootstrap();
  app.listen(PORT, () => {
    console.log(`\n  🏪 DuGuud server running on http://localhost:${PORT}\n`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
