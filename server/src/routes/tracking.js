const { Router } = require('express');
const { dbGet, dbAll } = require('../db');

const router = Router();

// POST /api/tracking/lookup — look up order by ID + email
router.post('/lookup', (req, res) => {
  try {
    const { orderId, email } = req.body;

    if (!orderId || !email) {
      return res.status(400).json({ error: 'Order ID and email are required' });
    }

    const order = dbGet('SELECT * FROM orders WHERE id = ? AND customer_email = ?', [orderId, email]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found. Check your order ID and email address.' });
    }

    const items = dbAll('SELECT * FROM order_items WHERE order_id = ?', [orderId]);

    res.json({
      order: {
        id: order.id,
        status: order.status,
        total: order.total,
        customer_name: order.customer_name,
        customer_address: order.customer_address,
        created_at: order.created_at,
        items: items.map(i => ({
          name: i.product_name,
          size: i.size,
          qty: i.qty,
          price: i.price
        }))
      }
    });
  } catch (err) {
    console.error('Tracking lookup error:', err);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

// GET /track — serve tracking page
router.get('/track', (req, res) => {
  res.send('<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">' +
    '<title>Track Your Order — DuGuud</title>' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">' +
    '<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">' +
    '<style>' +
      ':root{--peach:#f4a98c;--peach-dark:#e8875f;--peach-pale:#fbe4d5;--peach-tint:#fdf1ea;--ink:#221e1c;--ink-soft:#4a423e;--paper:#faf8f6;--line:rgba(34,30,28,0.12);--ok:#4c7a5d;--font-display:"Space Grotesk",sans-serif;--font-body:"Inter",sans-serif;}' +
      '*{box-sizing:border-box;}body{margin:0;padding:0;background:var(--paper);color:var(--ink);font-family:var(--font-body);-webkit-font-smoothing:antialiased;}' +
      'header{background:var(--ink);color:var(--paper);border-bottom:3px solid var(--peach);padding:14px 24px;text-align:center;}' +
      'header .logo{font-family:var(--font-display);font-weight:700;font-size:22px;color:var(--paper);text-decoration:none;}' +
      'main{max-width:560px;margin:0 auto;padding:40px 24px;}' +
      'h2{font-family:var(--font-display);margin:0 0 6px;}' +
      '.sub{font-size:14px;color:var(--ink-soft);margin-bottom:24px;}' +
      '.field{display:flex;flex-direction:column;gap:5px;margin-bottom:16px;}' +
      '.field label{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--ink-soft);}' +
      '.field input{border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-size:14px;font-family:var(--font-body);background:#fff;}' +
      '.field input:focus{outline:none;border-color:var(--peach-dark);box-shadow:0 0 0 3px var(--peach-pale);}' +
      '.btn{width:100%;background:var(--ink);color:var(--peach-pale);border:none;border-radius:14px;padding:15px;font-weight:700;font-size:15px;cursor:pointer;font-family:var(--font-body);}' +
      '.btn:hover{background:var(--peach-dark);color:#fff;}' +
      '.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:24px;margin-top:20px;}' +
      '.status-badge{display:inline-block;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:600;text-transform:capitalize;}' +
      '.badge-pending{background:#e0dcd9;color:var(--ink-soft);}' +
      '.badge-paid{background:var(--peach-pale);color:var(--peach-dark);}' +
      '.badge-shipped{background:#d4e4d4;color:var(--ok);}' +
      '.badge-delivered{background:var(--ink);color:var(--peach-pale);}' +
      '.badge-cancelled{background:rgba(204,68,68,0.1);color:#c44;}' +
      '.items-table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px;}' +
      '.items-table th{text-align:left;padding:8px 0;border-bottom:1px solid var(--line);font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--ink-soft);}' +
      '.items-table td{padding:8px 0;border-bottom:1px solid var(--line);}' +
      '.error{color:#c44;font-size:13px;margin-top:8px;display:none;}' +
      '.hidden{display:none;}' +
      'footer{text-align:center;padding:24px;font-size:12px;color:var(--ink-soft);}' +
    '</style></head><body>' +
    '<header><a href="/" class="logo">DuGuud</a></header>' +
    '<main>' +
      '<h2>Track your order</h2>' +
      '<p class="sub">Enter your order ID and email to see the status of your delivery.</p>' +
      '<div class="field"><label>Order ID</label><input type="text" id="trackId" placeholder="e.g. ord-1712345678901"></div>' +
      '<div class="field"><label>Email address</label><input type="email" id="trackEmail" placeholder="you@email.com"></div>' +
      '<button class="btn" onclick="lookup()">Look up</button>' +
      '<div class="error" id="trackErr"></div>' +
      '<div id="trackResult" class="hidden"></div>' +
    '</main>' +
    '<footer>DuGuud &mdash; Last Stock, Honestly Priced</footer>' +
    '<script>' +
      'async function lookup(){var oi=document.getElementById("trackId").value.trim();var em=document.getElementById("trackEmail").value.trim();var er=document.getElementById("trackErr");var rs=document.getElementById("trackResult");er.style.display="none";rs.classList.add("hidden");if(!oi||!em){er.textContent="Please enter both order ID and email.";er.style.display="block";return;}try{' +
        'var r=await fetch("/api/tracking/lookup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderId:oi,email:em})});var d=await r.json();if(!r.ok){er.textContent=d.error;er.style.display="block";return;}' +
        'var o=d.order;var badges={pending:"badge-pending",paid:"badge-paid",shipped:"badge-shipped",delivered:"badge-delivered",cancelled:"badge-cancelled"};' +
        'rs.innerHTML="<div class=\'card\'><h3 style=\'margin:0 0 4px;\'>"+o.customer_name+"</h3>"+' +
          '"<p style=\'font-size:13px;color:var(--ink-soft);margin:0 0 16px;\'>Order #"+o.id+"</p>"+' +
          '"<div style=\'margin-bottom:16px;\'><span class=\'status-badge "+(badges[o.status]||"badge-pending")+"\'>"+o.status+"</span></div>"+' +
          '"<table class=\'items-table\'><thead><tr><th>Item</th><th>Size</th><th>Qty</th><th>Price</th></tr></thead><tbody>"+' +
          'o.items.map(function(i){return "<tr><td>"+i.name+"</td><td>"+i.size+"</td><td>"+i.qty+"</td><td>R "+i.price+"</td></tr>";}).join("")+' +
          '</tbody></table>' +
          '<p style=\'font-size:12px;color:var(--ink-soft);margin-top:12px;\'>Shipping to: "+o.customer_address+"</p></div>";' +
        'rs.classList.remove("hidden");' +
      '}catch(e){er.textContent="Lookup failed. Please try again.";er.style.display="block";}}' +
    '</script></body></html>');
});

module.exports = router;
