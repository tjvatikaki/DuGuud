const { Router } = require('express');
const crypto = require('crypto');
const { dbGet, dbAll, dbRun, dbBatch } = require('../db');
const { authenticate } = require('../middleware/auth');
const { sendOrderConfirmation, sendAdminNotification } = require('../email');

const router = Router();

// PayFast config from .env
const PF_MERCHANT_ID   = process.env.PAYFAST_MERCHANT_ID   || '10000100';
const PF_MERCHANT_KEY   = process.env.PAYFAST_MERCHANT_KEY   || '46f0cd694581a';
const PF_PASSPHRASE     = process.env.PAYFAST_PASSPHRASE;
const PF_MODE           = process.env.PAYFAST_MODE           || 'sandbox';
const PF_BASE          = PF_MODE === 'live'
  ? 'https://www.payfast.co.za/eng'
  : 'https://sandbox.payfast.co.za/eng';

// ─── Helper: generate PayFast signature ───
function pfSignature(data) {
  // Build field=value string sorted by key
  const keys = Object.keys(data).sort();
  let str = keys.map(k => k + '=' + encodeURIComponent(String(data[k]).trim()).replace(/%20/g, '+')).join('&');
  // Only append passphrase if one is set in env
  if (PF_PASSPHRASE) {
    str += '&passphrase=' + PF_PASSPHRASE;
  }
  return crypto.createHash('md5').update(str).digest('hex');
}

// ─── POST /api/checkout — create order + return PayFast redirect data ───
router.post('/api/checkout', authenticate, (req, res) => {
  try {
    const { items, customer, shipping } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ error: 'Order must have at least one item' });
    }
    if (!customer || !customer.name || !customer.email) {
      return res.status(400).json({ error: 'Customer name and email are required' });
    }

    const orderId = 'ord-' + Date.now();
    const itemsTotal = items.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const shippingFee = Math.min(Math.max(shipping || 0, 0), 200); // R0–R200, validate server-side
    const total = itemsTotal + shippingFee;

    // Create order in DB
    dbBatch(() => {
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
        const check = dbGet('SELECT stock FROM product_sizes WHERE product_id = ? AND size = ?', [item.id, item.size]);
        if (!check || check.stock < item.qty) {
          throw new Error('Insufficient stock for "' + item.name + '" size ' + item.size);
        }
        dbRun('UPDATE product_sizes SET stock = stock - ? WHERE product_id = ? AND size = ?',
              [item.qty, item.id, item.size]);
        dbRun("UPDATE products SET stock = (SELECT COALESCE(SUM(stock), 0) FROM product_sizes WHERE product_id = ?), updated_at = datetime('now') WHERE id = ?",
              [item.id, item.id]);
      }
    });

    // Build PayFast form data
    const baseUrl = req.protocol + '://' + req.get('host');
    const nameParts = customer.name.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName  = nameParts.slice(1).join(' ') || 'Customer';

    const pfData = {
      merchant_id:   PF_MERCHANT_ID,
      merchant_key:  PF_MERCHANT_KEY,
      return_url:    baseUrl + '/payment/success?order=' + orderId,
      cancel_url:    baseUrl + '/payment/cancel?order=' + orderId,
      notify_url:    baseUrl + '/api/payments/itn',
      m_payment_id:  orderId,
      amount:        total.toFixed(2),
      item_name:     items.length === 1 ? items[0].name : items.length + ' items from DuGuud',
      name_first:    firstName,
      name_last:     lastName,
      email_address: customer.email,
      custom_str1:   orderId
    };

    pfData.signature = pfSignature(pfData);

    // Send email notifications (non-blocking — don't wait for them)
    const orderSummary = {
      id: orderId,
      total,
      status: 'pending',
      customer_name: customer.name,
      customer_email: customer.email,
      customer_address: customer.address
    };
    sendOrderConfirmation(orderSummary, customer.email);
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) sendAdminNotification(orderSummary, adminEmail);

    res.json({
      orderId,
      total,
      actionUrl: PF_BASE + '/process',
      fields: pfData
    });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: err.message || 'Checkout failed' });
  }
});

// ─── POST /api/payments/itn — PayFast Instant Transaction Notification ───
router.post('/api/payments/itn', (req, res) => {
  // PayFast expects a 200 OK response quickly
  res.status(200).send('OK');

  // Verify the ITN in background
  setImmediate(async () => {
    try {
      const data = req.body;
      const orderId = data.custom_str1 || data.m_payment_id;

      if (!orderId) return;

      // Debug: log ITN data keys for troubleshooting
      console.log('ITN received for order ' + orderId);
      console.log('ITN keys: ' + Object.keys(data).join(','));

      // Debug: log all values
      const debugFields = {};
      for (const k of Object.keys(data).sort()) {
        if (k !== 'signature') debugFields[k] = data[k];
      }
      console.log('ITN data for signature: ' + JSON.stringify(debugFields));

      // Verify signature
      const receivedSig = data.signature;
      delete data.signature;
      const calculatedSig = pfSignature(data);
      if (receivedSig !== calculatedSig) {
        console.warn('PayFast ITN signature MISMATCH for order ' + orderId);
        console.warn('  received sig: ' + receivedSig);
        console.warn('  calculated sig: ' + calculatedSig);
        return;
      }
      console.log('ITN signature OK for ' + orderId);

      // Verify payment was successful
      const paymentStatus = data.payment_status;
      if (paymentStatus !== 'COMPLETE') {
        console.log('PayFast ITN: payment not complete for ' + orderId + ' — status: ' + paymentStatus);
        return;
      }
      console.log('ITN payment_status COMPLETE for ' + orderId);

      // Verify amount matches
      const order = dbGet('SELECT total FROM orders WHERE id = ?', [orderId]);
      if (!order) {
        console.warn('PayFast ITN: order not found ' + orderId);
        return;
      }
      console.log('ITN order found for ' + orderId + ', total=' + order.total);

      const paidAmount = parseFloat(data.amount_gross);
      console.log('ITN amount_gross=' + data.amount_gross + ', order total=' + order.total);
      if (Math.abs(paidAmount - order.total) > 0.01) {
        console.warn('PayFast ITN: amount mismatch for ' + orderId + ' — paid=' + paidAmount + ' expected=' + order.total);
        return;
      }

      // All checks passed — mark order as paid
      dbRun("UPDATE orders SET status = 'paid' WHERE id = ?", [orderId]);
      console.log('✓ PayFast payment confirmed for order ' + orderId);
    } catch (err) {
      console.error('PayFast ITN error:', err);
    }
  });
});

// ─── GET /payment/success — show success page ───
router.get('/payment/success', (req, res) => {
  const orderId = req.query.order || '';
  res.send(paymentPage(true, orderId));
});

// ─── GET /payment/cancel — show cancelled page ───
router.get('/payment/cancel', (req, res) => {
  const orderId = req.query.order || '';
  res.send(paymentPage(false, orderId));
});

function paymentPage(success, orderId) {
  const title = success ? 'Payment Successful' : 'Payment Cancelled';
  const icon = success ? '✓' : '✕';
  const heading = success ? 'Payment received!' : 'Payment cancelled';
  const message = success
    ? 'Your order <strong>' + orderId + '</strong> is being processed. You\'ll receive a confirmation email shortly.'
    : 'You cancelled the payment. Your order is still pending — you can try again or contact us.';
  const btnClass = success ? '' : 'style="background:var(--ink);color:var(--peach-pale);"';

  return '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">' +
    '<title>' + title + ' — DuGuud</title>' +
    '<style>' +
      'body{font-family:Inter,sans-serif;background:#faf8f6;color:#221e1c;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;}' +
      '.card{background:#fff;border:1px solid rgba(34,30,28,0.12);border-radius:20px;padding:48px;max-width:480px;text-align:center;box-shadow:0 14px 40px rgba(34,30,28,0.06);}' +
      '.icon{width:72px;height:72px;border-radius:50%;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:36px;}' +
      '.icon.ok{background:#fbe4d5;color:#e8875f;}' +
      '.icon.fail{background:rgba(204,68,68,0.1);color:#c44;}' +
      'h2{font-family:Space Grotesk,sans-serif;margin:0 0 8px;}' +
      'p{font-size:14px;color:#4a423e;line-height:1.6;margin:0 0 24px;}' +
      '.btn{display:inline-block;padding:12px 28px;border-radius:14px;font-weight:600;font-size:14px;text-decoration:none;background:#f4a98c;color:#221e1c;}' +
      '.btn:hover{background:#e8875f;color:#fff;}' +
    '</style></head><body>' +
    '<div class="card">' +
      '<div class="icon ' + (success ? 'ok' : 'fail') + '">' + icon + '</div>' +
      '<h2>' + heading + '</h2>' +
      '<p>' + message + '</p>' +
      '<a href="/" class="btn">Back to store</a>' +
    '</div></body></html>';
}

module.exports = router;
