// Review data access.
//
// Everything here is deliberately narrow. Invitations are only ever created
// from a real order's items, so a row that reaches 'approved' is by
// construction from a delivered purchase — `verified` is set once, at creation,
// and never needs to be trusted from a request.

const crypto = require('crypto');
const { dbAll, dbGet, dbRun, dbBatch } = require('./db');

const TOKEN_DAYS = 90;

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

// Statuses: invited -> pending -> approved | rejected
// 'invited' means we asked and they haven't written yet; 'pending' means it's
// waiting on moderation. Keeping them apart lets the admin queue mean one thing.
function createReviewInvites(order, items) {
  const created = [];
  for (const it of items) {
    if (!it.product_id) continue;
    const existing = dbGet('SELECT id FROM reviews WHERE order_id = ? AND product_id = ?', [order.id, it.product_id]);
    if (existing) continue;

    const raw = crypto.randomBytes(32).toString('hex');
    dbRun(
      "INSERT INTO reviews (product_id, order_id, user_id, customer_name, customer_email, status, token_hash, token_expires, verified) " +
      "VALUES (?, ?, ?, ?, ?, 'invited', ?, datetime('now', '+" + TOKEN_DAYS + " days'), 1)",
      [
        it.product_id,
        order.id,
        order.user_id || null,
        order.customer_name || '',
        order.customer_email || '',
        hashToken(raw),
      ]
    );
    const row = dbGet('SELECT id FROM reviews WHERE order_id = ? AND product_id = ?', [order.id, it.product_id]);
    created.push({ id: row && row.id, product_id: it.product_id, product_name: it.product_name, token: raw });
  }
  return created;
}

// Public shape — never expose customer_email, order_id, or the token hash.
function publicReview(row) {
  return {
    id: row.id,
    productId: row.product_id,
    name: row.customer_name || 'DuGuud customer',
    rating: row.rating,
    title: row.title || '',
    body: row.body || '',
    verified: !!row.verified,
    date: (row.submitted_at || row.created_at || '').split(' ')[0],
  };
}

function listApprovedReviews(productId) {
  return dbAll(
    "SELECT * FROM reviews WHERE product_id = ? AND status = 'approved' ORDER BY submitted_at DESC, id DESC",
    [productId]
  ).map(publicReview);
}

// { ratingValue, reviewCount } or null when there is nothing to show. Callers
// must emit aggregateRating ONLY when this is non-null: Google penalises an
// empty or self-serving rating block.
function getProductRating(productId) {
  const row = dbGet(
    "SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews WHERE product_id = ? AND status = 'approved' AND rating > 0",
    [productId]
  );
  if (!row || !row.n) return null;
  return {
    reviewCount: row.n,
    ratingValue: Math.round(Number(row.avg) * 10) / 10,
  };
}

// Batched variant for list pages, so we don't fire one query per product.
function getRatingsForProducts(productIds) {
  const out = {};
  if (!productIds.length) return out;
  const placeholders = productIds.map(() => '?').join(',');
  const rows = dbAll(
    "SELECT product_id, COUNT(*) AS n, AVG(rating) AS avg FROM reviews " +
    "WHERE status = 'approved' AND rating > 0 AND product_id IN (" + placeholders + ") GROUP BY product_id",
    productIds
  );
  for (const r of rows) {
    out[r.product_id] = { reviewCount: r.n, ratingValue: Math.round(Number(r.avg) * 10) / 10 };
  }
  return out;
}

function findByToken(rawToken) {
  if (!rawToken || String(rawToken).length < 32) return null;
  return dbGet(
    "SELECT * FROM reviews WHERE token_hash = ? AND token_expires > datetime('now')",
    [hashToken(rawToken)]
  );
}

// Single use: the hash is cleared on submit, so a second visit to the same link
// finds nothing.
function submitReview(reviewId, { rating, title, body, name }) {
  dbRun(
    "UPDATE reviews SET rating = ?, title = ?, body = ?, customer_name = ?, status = 'pending', " +
    "token_hash = NULL, submitted_at = datetime('now') WHERE id = ?",
    [rating, title || '', body, name, reviewId]
  );
}

function moderate(reviewId, status, note) {
  dbBatch(() => {
    dbRun(
      "UPDATE reviews SET status = ?, admin_note = ?, moderated_at = datetime('now') WHERE id = ?",
      [status, note || '', reviewId]
    );
  });
}

function listForAdmin(status) {
  const rows = status
    ? dbAll('SELECT * FROM reviews WHERE status = ? ORDER BY submitted_at DESC, id DESC', [status])
    : dbAll('SELECT * FROM reviews ORDER BY id DESC');
  return rows.map((r) => Object.assign(publicReview(r), {
    status: r.status,
    orderId: r.order_id,
    email: r.customer_email,
    adminNote: r.admin_note || '',
  }));
}

module.exports = {
  hashToken,
  createReviewInvites,
  publicReview,
  listApprovedReviews,
  getProductRating,
  getRatingsForProducts,
  findByToken,
  submitReview,
  moderate,
  listForAdmin,
};
