const { Router } = require('express');
const { dbRun } = require('../db');
const { sendEmail } = require('../email');

const router = Router();

// POST /api/contact — anyone can send a contact message
router.post('/', (req, res) => {
  try {
    const { name, email, message } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Please provide your name' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address' });
    }
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Please write a message' });
    }
    if (message.length > 5000) {
      return res.status(400).json({ error: 'Message is too long (max 5000 characters)' });
    }

    // Store the message in the database
    dbRun('INSERT INTO contact_messages (name, email, message) VALUES (?, ?, ?)',
          [name.trim(), email, message.trim()]);

    // Email the admin (non-blocking)
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@duguud.co.za';
    sendEmail({
      to: adminEmail,
      subject: 'Contact Form: ' + name.trim() + ' <' + email + '>',
      html: '<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;border:1px solid rgba(34,30,28,0.12);padding:40px;">' +
        '<div style="text-align:center;margin-bottom:24px;">' +
          '<svg viewBox="0 0 24 24" width="40" height="40" fill="none"><rect x="2" y="2" width="20" height="20" rx="5" transform="rotate(45,12,12)" fill="#f4a98c"/><circle cx="12" cy="12" r="4.5" fill="#221e1c"/></svg>' +
          '<h1 style="font-family:\'Space Grotesk\',sans-serif;color:#221e1c;font-size:24px;margin:12px 0 4px;">New Contact Message</h1>' +
          '<p style="color:#4a423e;font-size:14px;margin:0;">From your DuGuud store contact form</p>' +
        '</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">' +
          '<tr><td style="padding:8px 0;color:#4a423e;font-weight:600;">Name</td><td>' + name.trim() + '</td></tr>' +
          '<tr><td style="padding:8px 0;color:#4a423e;font-weight:600;">Email</td><td><a href="mailto:' + email + '" style="color:#e8875f;">' + email + '</a></td></tr>' +
        '</table>' +
        '<div style="background:#faf8f6;border-radius:12px;padding:20px;border:1px solid rgba(34,30,28,0.12);">' +
          '<p style="margin:0;font-size:14px;line-height:1.6;color:#221e1c;white-space:pre-wrap;">' + message.trim() + '</p>' +
        '</div>' +
        '<hr style="border:none;border-top:1px solid rgba(34,30,28,0.1);margin:24px 0;">' +
        '<p style="font-size:12px;color:#8a8480;text-align:center;margin:0;">Reply to this email to respond to ' + name.trim() + '</p>' +
      '</div>'
    });

    res.status(201).json({ message: 'Thanks, ' + name.trim() + '! We\'ll get back to you soon.' });
  } catch (err) {
    console.error('Contact form error:', err);
    res.status(500).json({ error: 'Failed to send your message. Please try again.' });
  }
});

module.exports = router;
