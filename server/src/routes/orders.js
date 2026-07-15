const { Router } = require('express');
const { dbAll, dbGet, dbRun, dbBatch } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { sendShippingNotification } = require('../email');


const router = Router();

// POST /api/orders — place an order (authenticated users only)
router.post('/', authenticate, (req, res) => {
  try {
    const { items, customer } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ error: 'Order must have at least one item' });
    }
    if (!customer || !customer.name || !customer.email) {
      return res.status(400).json({ error: 'Customer name and email are required' });
    }

    const orderId = 'ord-' + Date.now();
    const total = items.reduce((sum, item) => sum + (item.price * item.qty), 0);

    dbTransaction(() => {
      dbRun(
        'INSERT INTO orders (id, user_id, customer_name, customer_email, customer_phone, customer_address, customer_city, customer_postal, total, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [orderId, req.user.userId, customer.name, customer.email,
         customer.phone || '', customer.address || '', customer.city || '',
         customer.postal || '', total, 'pending']
      );

      for (const item of items) {
        dbRun(
          'INSERT INTO order_items (order_id, product_id, product_name, product_icon, product_image, size, qty, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [orderId, item.id, item.name, item.icon || '',
           (item.images && item.images[0]) || '', item.size, item.qty, item.price]
        );

        // Deduct stock
        const result = dbRun('UPDATE product_sizes SET stock = stock - ? WHERE product_id = ? AND size = ?',
                             [item.qty, item.id, item.size]);
        // sql.js doesn't return changes count, so we check if stock went negative and fix
        const check = dbGet('SELECT stock FROM product_sizes WHERE product_id = ? AND size = ?', [item.id, item.size]);
        if (!check || check.stock < 0) {
          throw new Error(`Insufficient stock for "${item.name}" size ${item.size}`);
        }

        dbRun('UPDATE products SET stock = (SELECT COALESCE(SUM(stock), 0) FROM product_sizes WHERE product_id = ?), updated_at = datetime(\'now\') WHERE id = ?',
              [item.id, item.id]);
      }
    });

    res.status(201).json({ order: { id: orderId, total, status: 'pending' } });
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: err.message || 'Failed to create order' });
  }
});

// GET /api/orders — list orders (admin only)
router.get('/', authenticate, requireAdmin, (req, res) => {
  try {
    const orders = dbAll('SELECT * FROM orders ORDER BY created_at DESC');

    const result = orders.map(o => {
      const items = dbAll('SELECT * FROM order_items WHERE order_id = ?', [o.id]);
      return { ...o, items };
    });

    res.json({ orders: result });
  } catch (err) {
    console.error('Get orders error:', err);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

// PUT /api/orders/:id/status — update order status (admin only)
router.put('/:id/status', authenticate, requireAdmin, (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Valid: ' + validStatuses.join(', ') });
    }

    const existing = dbGet('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Order not found' });

    dbRun("UPDATE orders SET status = ? WHERE id = ?", [status, req.params.id]);

    // Send shipping notification when marked as shipped
    if (status === 'shipped') {
      const items = dbAll('SELECT * FROM order_items WHERE order_id = ?', [req.params.id]);
      sendShippingNotification({ ...existing, items }, existing.customer_email);
    }

    res.json({ message: 'Order status updated to ' + status, orderId: req.params.id, status });
  } catch (err) {
    console.error('Update order status error:', err);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

module.exports = router;
