require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const { getDb, dbGet, dbAll, dbRun, dbBatch } = require('./db');
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');
const paymentRoutes = require('./routes/payments');
const trackingRoutes = require('./routes/tracking');
const statsRoutes = require('./routes/stats');
const newsletterRoutes = require('./routes/newsletter');
const contactRoutes = require('./routes/contact');
const { authenticate, requireAdmin } = require('./middleware/auth');
const { getVisibleProduct } = require('./product-model');
const { renderProductPage } = require('./render');

const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@duguud.co.za';
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
app.set('trust proxy', true); // Render sits behind a proxy — this gives us real protocol
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true })); // Needed for PayFast ITN (form POST)

// Static files — serve the project root so HTML/JS/CSS/images all work
const STATIC_ROOT = path.join(__dirname, '..', '..');

// Anything that isn't a web asset must not be reachable over HTTP. Serving the repo
// root otherwise exposes the SQLite database (customer PII + password hashes) at
// /server/data/duguud.db, the API source under /server/src/, and README.md.
// Note: express.static skips dotfiles by default, which is what protects server/.env —
// this deny-list is what protects everything else.
const BLOCKED_PATH = /^\/(server|node_modules|\.git|\.claude)(\/|$)/i;
const BLOCKED_ROOT = /^\/(README\.md|fetch-product\.ps1|wfpstate\.xml|package(-lock)?\.json|\.gitignore)$/i;
app.use((req, res, next) => {
  if (BLOCKED_PATH.test(req.path) || BLOCKED_ROOT.test(req.path)) {
    return res.status(404).type('text/plain').send('Not found');
  }
  next();
});

// Product pages get their SEO tags injected server-side. This MUST stay above the
// static mount below — express matches in order, so once static claims
// /product.html this never runs and shared links go back to previewing as a bare
// "DuGuud — Product".
// Every failure path calls next(), which serves the normal shell: worst case the
// page loses its rich preview, it never breaks.
app.get(['/product.html', '/product'], (req, res, next) => {
  const id = req.query.id;
  if (!id) return next(); // no id — the shell handles it and shows "No product selected"
  try {
    const product = getVisibleProduct(String(id));
    if (!product) return next(); // unknown or hidden — shell shows "Product not found"
    const html = renderProductPage(product);
    if (!html) return next();
    // Short TTL: Cloudflare sits in front, and a long one would serve stale prices.
    res.set('Cache-Control', 'public, max-age=60');
    res.type('html').send(html);
  } catch (err) {
    console.error('Product SEO render failed:', err);
    next();
  }
});

app.use(express.static(STATIC_ROOT, { dotfiles: 'ignore', index: 'index.html' }));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use(paymentRoutes); // mounts /api/checkout, /api/payments/itn, /payment/success, /payment/cancel
app.use(trackingRoutes); // mounts /api/tracking/lookup, /track
app.use('/api/stats', statsRoutes); // mounts /api/stats
app.use('/api/newsletter', newsletterRoutes); // mounts /api/newsletter/subscribe
app.use('/api/contact', contactRoutes); // mounts /api/contact

// ─── Image upload (admin only) ───
// Uploaded photos are written to server/data/uploads/ — the same gitignored,
// deploy-durable directory that holds the SQLite DB — so they survive Render
// redeploys (runtime files in git-tracked folders like images/ get cleaned on
// every deploy). They're served back to the browser at /uploads/<file>.
const multer = require('multer');
const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads'); // server/data/uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
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
  const urls = req.files.map(f => 'uploads/' + f.filename);
  res.json({ files: urls });
});

// Serve uploaded images back at /uploads/<file>
app.use('/uploads', express.static(UPLOAD_DIR));

// POST /api/fetch-images — download images from external URLs to the server (admin only)
const https = require('https');
const http = require('http');
app.post('/api/fetch-images', authenticate, requireAdmin, async (req, res) => {
  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls) || !urls.length) {
      return res.status(400).json({ error: 'Provide an array of image URLs' });
    }

    const results = [];
    const destDir = UPLOAD_DIR;
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    for (const url of urls.slice(0, 10)) { // max 10 images per request
      try {
        const filename = Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.jpg';
        const dest = path.join(destDir, filename);

        const imgData = await new Promise((resolve, reject) => {
          const client = url.startsWith('https') ? https : http;
          client.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (resp) => {
            // Follow redirects
            if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
              const redirectClient = resp.headers.location.startsWith('https') ? https : http;
              redirectClient.get(resp.headers.location, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (r2) => {
                const chunks = [];
                r2.on('data', (c) => chunks.push(c));
                r2.on('end', () => resolve(Buffer.concat(chunks)));
                r2.on('error', reject);
              }).on('error', reject);
              return;
            }
            if (resp.statusCode !== 200) {
              reject(new Error(`HTTP ${resp.statusCode}`));
              return;
            }
            const chunks = [];
            resp.on('data', (c) => chunks.push(c));
            resp.on('end', () => resolve(Buffer.concat(chunks)));
            resp.on('error', reject);
          }).on('error', reject);
        });

        fs.writeFileSync(dest, imgData);
        results.push({ url, file: 'uploads/' + filename, ok: true });
      } catch (e) {
        results.push({ url, error: e.message, ok: false });
      }
    }

    const files = results.filter(r => r.ok).map(r => r.file);
    res.json({ files, results });
  } catch (err) {
    console.error('Fetch images error:', err);
    res.status(500).json({ error: 'Failed to download images: ' + err.message });
  }
});

// ─── Product page fetching (server-side, no CORS proxy) ───
const zlib = require('zlib');

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1'
};

function fetchPage(url, redirectsLeft) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 20000, headers: BROWSER_HEADERS }, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        resp.resume();
        if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
        let next;
        try { next = new URL(resp.headers.location, url).href; }
        catch (e) { return reject(new Error('Bad redirect: ' + resp.headers.location)); }
        return resolve(fetchPage(next, redirectsLeft - 1));
      }
      if (resp.statusCode !== 200) {
        resp.resume();
        return reject(new Error('HTTP ' + resp.statusCode));
      }
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = (resp.headers['content-encoding'] || '').toLowerCase();
        try {
          if (enc === 'gzip') buf = zlib.gunzipSync(buf);
          else if (enc === 'deflate') buf = zlib.inflateSync(buf);
          else if (enc === 'br') buf = zlib.brotliDecompressSync(buf);
        } catch (e) { /* serve whatever we got */ }
        resolve(buf.toString('utf8'));
      });
      resp.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Timed out after 20s')));
  });
}

// Pull name/price/description/images out of a product page's HTML.
function parseProductHtml(html, baseUrl) {
  const out = { name: '', price: '', description: '', images: [] };
  const seen = new Set();

  // strict=true only accepts URLs that look like real images (used when scraping <img>)
  const addImg = (u, strict) => {
    if (!u || typeof u !== 'string') return;
    u = u.trim();
    if (!u) return;
    if (strict && !/\.(jpg|jpeg|png|webp|avif)(\?|#|$)/i.test(u)) return;
    if (u.startsWith('//')) u = 'https:' + u;
    else if (!/^https?:/i.test(u)) {
      try { u = new URL(u, baseUrl).href; } catch (e) { return; }
    }
    const key = u.replace(/[?#].*$/, '');
    if (seen.has(key)) return;
    seen.add(key);
    out.images.push(u);
  };

  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of scripts) {
    const body = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '').trim();
    let json;
    try { json = JSON.parse(body); } catch (e) { continue; }

    const queue = Array.isArray(json) ? json.slice() : [json];
    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node['@graph'])) queue.push(...node['@graph']);

      const type = node['@type'];
      const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
      if (!isProduct) continue;

      if (!out.name && node.name) out.name = String(node.name).trim();
      if (!out.description && node.description) out.description = String(node.description).trim();
      if (!out.price && node.offers) {
        const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
        if (offer) {
          const p = offer.price != null
            ? offer.price
            : (offer.priceSpecification && offer.priceSpecification.price);
          if (p != null) out.price = String(p);
        }
      }
      const imgs = node.image ? (Array.isArray(node.image) ? node.image : [node.image]) : [];
      for (const im of imgs) {
        if (typeof im === 'string') addImg(im, false);
        else if (im && typeof im === 'object') addImg(im.url || im.contentUrl || '', false);
      }
    }
  }

  const meta = (prop) => {
    const m = html.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]*>', 'i'));
    if (!m) return '';
    const c = m[0].match(/content=["']([^"']*)["']/i);
    return c ? c[1].trim() : '';
  };

  if (!out.name) out.name = meta('og:title');
  if (!out.name) {
    const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (t) out.name = t[1].replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  }
  if (!out.description) out.description = meta('og:description');

  const ogImgs = html.match(/<meta[^>]+(?:property|name)=["']og:image(?::url)?["'][^>]*>/gi) || [];
  for (const tag of ogImgs) {
    const c = tag.match(/content=["']([^"']*)["']/i);
    if (c) addImg(c[1], false);
  }

  // Last resort: scrape <img> tags, but only when the page gave us no product images
  if (out.images.length === 0) {
    const imgTags = html.match(/<img[^>]+src=["']([^"']+)["']/gi) || [];
    for (const tag of imgTags) {
      const c = tag.match(/src=["']([^"']+)["']/i);
      if (c && !/logo|icon|banner|pixel|sprite|placeholder/i.test(c[1])) addImg(c[1], true);
    }
  }

  out.images = out.images.slice(0, 12);
  return out;
}

// POST /api/fetch-product — fetch + parse a product page server-side (admin only)
app.post('/api/fetch-product', authenticate, requireAdmin, async (req, res) => {
  const { url } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Provide a product URL starting with http:// or https://' });
  }

  try {
    const html = await fetchPage(url, 5);
    const data = parseProductHtml(html, url);
    if (!data.name && !data.images.length) {
      return res.status(422).json({
        error: 'Could not read that page. It may be bot-protected — use the "Send to DuGuud" bookmarklet instead.'
      });
    }
    res.json(data);
  } catch (err) {
    const blocked = /HTTP (401|403|429)/.test(err.message);
    res.status(blocked ? 403 : 502).json({
      error: blocked
        ? 'That site blocks server-side requests (Adidas does this). Use the "Send to DuGuud" bookmarklet instead.'
        : 'Failed to fetch page: ' + err.message
    });
  }
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
