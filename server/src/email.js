const nodemailer = require('nodemailer');

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

// Order confirmation for customer
async function sendOrderConfirmation(order, customerEmail) {
  return sendEmail({
    to: customerEmail,
    subject: 'Order Confirmed - DuGuud #' + order.id,
    html: '<div style="font-family:Archivo,sans-serif;max-width:560px;margin:0 auto;">' +
      '<h2 style="color:#16130f;">Order Confirmed</h2>' +
      '<p style="font-size:14px;color:#5c564e;">Thanks for your order! We\'ll notify you when it ships.</p>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
        '<tr><td style="padding:8px 0;color:#5c564e;">Order</td><td style="font-weight:600;">' + order.id + '</td></tr>' +
        '<tr><td style="padding:8px 0;color:#5c564e;">Total</td><td style="font-weight:600;">R ' + order.total + '</td></tr>' +
        '<tr><td style="padding:8px 0;color:#5c564e;">Status</td><td style="font-weight:600;">' + order.status + '</td></tr>' +
      '</table>' +
      '<hr style="border:none;border-top:1px solid rgba(22,19,15,0.14);margin:20px 0;">' +
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

module.exports = { sendEmail, sendOrderConfirmation, sendShippingNotification, sendAdminNotification };
