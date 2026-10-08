const { Router } = require('express');
const { dbGet } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rate-limit');
const {
  listApprovedReviews, getProductRating, findByToken, submitReview, moderate, listForAdmin,
} = require('../review-model');

const router = Router();

// Attempts are cheap to make and expensive to absorb; 256-bit tokens make
// guessing infeasible, but there's no reason to serve unlimited attempts.
const inviteLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 60, message: 'Too many requests' });
const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: 'Too many submissions — try again later' });

// GET /api/reviews/product/:id — approved reviews plus the aggregate
router.get('/product/:id', (req, res) => {
  try {
    const id = String(req.params.id);
    res.json({
      reviews: listApprovedReviews(id),
      rating: getProductRating(id),
    });
  } catch (err) {
    console.error('List reviews error:', err);
    res.status(500).json({ error: 'Failed to load reviews' });
  }
});

// GET /api/reviews/invite/:token — what the emailed link resolves to.
//
// Unauthenticated and keyed by a URL secret, so it returns the minimum needed to
// render the form: the product, and whether this link is still usable. It must
// never leak the customer's email, address, order total, or other items.
router.get('/invite/:token', inviteLimiter, (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const row = findByToken(req.params.token);
    if (!row) {
      return res.status(404).json({ valid: false, reason: 'This review link is no longer valid.' });
    }
    // images live in product_images, not on the products row
    const product = dbGet('SELECT id, name FROM products WHERE id = ?', [row.product_id]);
    let image = '';
    if (product) {
      const img = dbGet('SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order LIMIT 1', [product.id]);
      image = img ? img.url : '';
    }
    res.json({
      valid: true,
      alreadySubmitted: row.status !== 'invited',
      product: product ? { id: product.id, name: product.name, image } : null,
      invitedName: row.customer_name || '',
    });
  } catch (err) {
    console.error('Review invite error:', err);
    res.status(500).json({ error: 'Failed to load invitation' });
  }
});

// POST /api/reviews/submit — the reviewer's own words.
//
// The body carries the token and the review text and NOTHING else. product_id,
// order_id and the customer's identity all come from the token row, so a
// tampered request cannot review a product the caller never bought. This is the
// property the whole design rests on.
router.post('/submit', submitLimiter, (req, res) => {
  try {
    const { token, rating, title, body, name } = req.body || {};
    const row = findByToken(token);
    if (!row) {
      return res.status(404).json({ error: 'This review link is no longer valid.' });
    }
    if (row.status !== 'invited') {
      return res.status(409).json({ error: 'This review has already been submitted.' });
    }

    const n = parseInt(rating, 10);
    if (!(n >= 1 && n <= 5)) {
      return res.status(400).json({ error: 'Please choose a rating from 1 to 5.' });
    }
    const text = String(body || '').trim();
    if (text.length < 10) {
      return res.status(400).json({ error: 'Please write at least a sentence.' });
    }
    if (text.length > 4000) {
      return res.status(400).json({ error: 'That review is too long.' });
    }

    submitReview(row.id, {
      rating: n,
      title: String(title || '').trim().slice(0, 120),
      body: text,
      name: String(name || row.customer_name || 'DuGuud customer').trim().slice(0, 80),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Submit review error:', err);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

// ─── Admin moderation ───

router.get('/admin', authenticate, requireAdmin, (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : '';
    res.json({ reviews: listForAdmin(status) });
  } catch (err) {
    console.error('Admin reviews error:', err);
    res.status(500).json({ error: 'Failed to load reviews' });
  }
});

router.put('/admin/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const status = String((req.body || {}).status || '');
    if (['approved', 'rejected', 'pending'].indexOf(status) === -1) {
      return res.status(400).json({ error: 'status must be approved, rejected or pending' });
    }
    const row = dbGet('SELECT id FROM reviews WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Review not found' });
    moderate(row.id, status, (req.body || {}).note || '');
    res.json({ ok: true });
  } catch (err) {
    console.error('Moderate review error:', err);
    res.status(500).json({ error: 'Failed to update review' });
  }
});

module.exports = router;
