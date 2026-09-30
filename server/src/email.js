const nodemailer = require('nodemailer');

// Single source of truth for links in emails. Guests have no account to browse
// back through, so every order email needs a working absolute URL.
const BASE_URL = process.env.PUBLIC_BASE_URL || 'https://www.duguud.co.za';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  if (!host) return null; // Email not configured

  transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  return transporter;
}

async function sendEmail({ to, subject, html }) {
  try {
    const t = getTransporter();
    if (!t) {
      console.log('Email not sent - SMTP not configured. Set SMTP_HOST in .env');
      return false;
    }

    const from = process.env.SMTP_FROM || 'DuGuud <noreply@duguud.co.za>';
    await t.sendMail({ from, to, subject, html });
    console.log('Email sent to ' + to);
    return true;
  } catch (err) {
    console.error('Email send failed:', err.message);
    return false;
  }
}

// Sent at order creation, BEFORE PayFast confirms payment — so it must not claim
// the order is paid. The receipt below is the one that confirms money arrived.
async function sendOrderConfirmation(order, customerEmail) {
  return sendEmail({
    to: customerEmail,
    subject: 'Order received - DuGuud #' + order.id,
    html: '<div style="font-family:Archivo,sans-serif;max-width:560px;margin:0 auto;">' +
      '<h2 style="color:#16130f;">Order received</h2>' +
      '<p style="font-size:14px;color:#5c564e;">Thanks! We\'re waiting for PayFast to confirm your payment — ' +
        'you\'ll get a receipt as soon as it clears. If you didn\'t complete the payment, this order will expire ' +
        'and no stock will be held.</p>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
        '<tr><td style="padding:8px 0;color:#5c564e;">Order</td><td style="font-weight:600;">' + order.id + '</td></tr>' +
        '<tr><td style="padding:8px 0;color:#5c564e;">Total</td><td style="font-weight:600;">R ' + order.total + '</td></tr>' +
        '<tr><td style="padding:8px 0;color:#5c564e;">Status</td><td style="font-weight:600;">Awaiting payment</td></tr>' +
      '</table>' +
      '<hr style="border:none;border-top:1px solid rgba(22,19,15,0.14);margin:20px 0;">' +
      '<p style="font-size:12px;color:#5c564e;">Keep this reference — you can track your order any time at ' +
        '<a href="' + BASE_URL + '/track?order=' + encodeURIComponent(order.id) + '" style="color:#e8875f;">' +
        BASE_URL.replace(/^https?:\/\//, '') + '/track</a> using this order number and your email address.</p>' +
      '<p style="font-size:12px;color:#5c564e;">DuGuud - Last Stock, Honestly Priced</p>' +
    '</div>'
  });
}

// Receipt sent from the PayFast ITN once payment actually clears.
async function sendOrderPaidReceipt(order, customerEmail) {
  const items = order.items || [];
  const rows = items.map(function(i){
    return '<tr><td style="padding:6px 0;">' + i.qty + '&times; ' + i.product_name +
           (i.size ? ' <span style="color:#5c564e;">(' + i.size + ')</span>' : '') + '</td>' +
           '<td style="padding:6px 0;text-align:right;">R ' + (i.price * i.qty) + '</td></tr>';
  }).join('');

  return sendEmail({
    to: customerEmail,
    subject: 'Payment received - DuGuud #' + order.id,
    html: '<div style="font-family:Archivo,sans-serif;max-width:560px;margin:0 auto;">' +
      '<h2 style="color:#16130f;">Payment received</h2>' +
      '<p style="font-size:14px;color:#5c564e;">We\'ve got your payment for order <strong>' + order.id +
        '</strong>. We dispatch within 48 working hours and you\'ll get a tracking number by email as soon as it ships.</p>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px;">' + rows +
        '<tr><td style="padding:10px 0;border-top:1px solid rgba(22,19,15,0.14);font-weight:700;">Total paid</td>' +
        '<td style="padding:10px 0;border-top:1px solid rgba(22,19,15,0.14);font-weight:700;text-align:right;">R ' + order.total + '</td></tr>' +
      '</table>' +
      '<p style="font-size:13px;margin-top:20px;"><a href="' + BASE_URL + '/track?order=' + encodeURIComponent(order.id) +
        '" style="color:#e8875f;font-weight:600;">Track your order &rarr;</a></p>' +
      '<hr style="border:none;border-top:1px solid rgba(22,19,15,0.14);margin:20px 0;">' +
      '<p style="font-size:12px;color:#5c564e;">Questions? Just reply to this email.</p>' +
      '<p style="font-size:12px;color:#5c564e;">DuGuud - Last Stock, Honestly Priced</p>' +
    '</div>'
  });
}

// Shipment notification for customer (with Courier Guy tracking link)
async function sendShippingNotification(order, customerEmail) {
  const trackingHtml = order.tracking_number
    ? '<tr><td style="padding:8px 0;color:#5c564e;">Tracking</td><td style="font-weight:600;"><a href="https://www.courierguy.co.za/track/' + order.tracking_number + '" style="color:#e8875f;">' + order.tracking_number + ' (Courier Guy)</a></td></tr>'
    : '';
  return sendEmail({
    to: customerEmail,
    subject: 'Your DuGuud Order Has Shipped!',
    html: '<div style="font-family:Archivo,sans-serif;max-width:560px;margin:0 auto;">' +
      '<h2 style="color:#16130f;">On Its Way!</h2>' +
      '<p style="font-size:14px;color:#5c564e;">Your order <strong>' + order.id + '</strong> is on its way to you.</p>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
        '<tr><td style="padding:8px 0;color:#5c564e;">Items</td><td style="font-weight:600;">' + (order.items || []).map(function(i){ return i.qty + 'x ' + i.product_name; }).join(', ') + '</td></tr>' +
        '<tr><td style="padding:8px 0;color:#5c564e;">Shipping to</td><td style="font-weight:600;">' + order.customer_address + '</td></tr>' +
        trackingHtml +
      '</table>' +
      '<hr style="border:none;border-top:1px solid rgba(22,19,15,0.14);margin:20px 0;">' +
      '<p style="font-size:12px;color:#5c564e;">DuGuud - Last Stock, Honestly Priced</p>' +
    '</div>'
  });
}

// New order notification for admin
async function sendAdminNotification(order, adminEmail) {
  return sendEmail({
    to: adminEmail,
    subject: 'New Order - DuGuud #' + order.id,
    html: '<div style="font-family:Archivo,sans-serif;max-width:560px;margin:0 auto;">' +
      '<h2 style="color:#16130f;">New Order Received!</h2>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
        '<tr><td style="padding:8px 0;color:#5c564e;">Order</td><td style="font-weight:600;">' + order.id + '</td></tr>' +
        '<tr><td style="padding:8px 0;color:#5c564e;">Customer</td><td style="font-weight:600;">' + order.customer_name + '</td></tr>' +
        '<tr><td style="padding:8px 0;color:#5c564e;">Email</td><td style="font-weight:600;">' + order.customer_email + '</td></tr>' +
        '<tr><td style="padding:8px 0;color:#5c564e;">Total</td><td style="font-weight:600;">R ' + order.total + '</td></tr>' +
      '</table>' +
      '<hr style="border:none;border-top:1px solid rgba(22,19,15,0.14);margin:20px 0;">' +
      '<p style="font-size:12px;color:#5c564e;">Log in to the admin panel to manage this order.</p>' +
    '</div>'
  });
}

module.exports = { sendEmail, sendOrderConfirmation, sendOrderPaidReceipt, sendShippingNotification, sendAdminNotification };
