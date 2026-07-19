const { Router } = require('express');
const { dbGet, dbRun } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = Router();

// GET /api/stats/track — increment page view counter (called from frontend)
router.get('/track', (req, res) => {
  dbRun('UPDATE stats SET value = value + 1 WHERE key = ?', ['page_views']);
  res.json({ ok: true });
});

// GET /api/stats — get all stats (admin only)
router.get('/', authenticate, requireAdmin, (req, res) => {
  const views = dbGet("SELECT value FROM stats WHERE key = 'page_views'");
  const orders = dbGet("SELECT COUNT(*) AS count FROM orders");
  const users = dbGet("SELECT COUNT(*) AS count FROM users");
  const products = dbGet("SELECT COUNT(*) AS count FROM products WHERE stock > 0");
  const revenue = dbGet("SELECT COALESCE(SUM(total), 0) AS total FROM orders WHERE status != 'cancelled'");
  const totalStock = dbGet("SELECT COALESCE(SUM(stock), 0) AS total FROM products");
  const potentialRevenue = dbGet("SELECT COALESCE(SUM(price * stock), 0) AS total FROM products");
  const totalCost = dbGet("SELECT COALESCE(SUM(cost * stock), 0) AS total FROM products WHERE cost > 0");

  const potRev = potentialRevenue ? potentialRevenue.total : 0;
  const totCost = totalCost ? totalCost.total : 0;

  res.json({
    page_views: views ? views.value : 0,
    total_orders: orders ? orders.count : 0,
    total_users: users ? users.count : 0,
    active_products: products ? products.count : 0,
    revenue: revenue ? revenue.total : 0,
    total_stock: totalStock ? totalStock.total : 0,
    potential_revenue: potRev,
    total_cost: totCost,
    potential_profit: potRev - totCost
  });
});

module.exports = router;
