const { Router } = require('express');
const { dbGet, dbAll, dbRun } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { sendEmail } = require('../email');

const router = Router();

// POST /api/newsletter/subscribe — anyone can subscribe
router.post('/subscribe', (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address' });
    }

    // Check if already subscribed
    const existing = dbGet('SELECT id FROM newsletter_subscribers WHERE email = ?', [email]);
    if (existing) {
      return res.json({ message: 'You\'re already subscribed — stay tuned for new deals!' });
    }

    dbRun('INSERT INTO newsletter_subscribers (email) VALUES (?)', [email]);

    // Send a welcome/confirmation email (non-blocking)
    sendEmail({
      to: email,
      subject: 'You\'re subscribed — DuGuud Deals',
      html: '<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;border:1px solid rgba(34,30,28,0.12);padding:40px;">' +
        '<div style="text-align:center;margin-bottom:24px;">' +
          '<svg viewBox="0 0 24 24" width="40" height="40" fill="none"><rect x="2" y="2" width="20" height="20" rx="5" transform="rotate(45,12,12)" fill="#f4a98c"/><circle cx="12" cy="12" r="4.5" fill="#221e1c"/></svg>' +
          '<h1 style="font-family:\'Space Grotesk\',sans-serif;color:#221e1c;font-size:24px;margin:12px 0 4px;">You\'re in!</h1>' +
          '<p style="color:#4a423e;font-size:14px;margin:0;">Thanks for subscribing to DuGuud deals.</p>' +
        '</div>' +
        '<p style="color:#221e1c;font-size:15px;line-height:1.6;">You\'ll be the first to know when new stock lands, deals drop, and fresh arrivals hit the store.</p>' +
        '<p style="color:#4a423e;font-size:14px;line-height:1.6;">No spam — just the good stuff at honest prices.</p>' +
        '<hr style="border:none;border-top:1px solid rgba(34,30,28,0.1);margin:24px 0;">' +
        '<p style="color:#8a8480;font-size:12px;text-align:center;margin:0;">DuGuud — Last Stock, Honestly Priced</p>' +
      '</div>'
    });

    res.status(201).json({ message: 'Subscribed! We\'ll keep you posted on new deals and arrivals.' });
  } catch (err) {
    console.error('Newsletter subscribe error:', err);
    res.status(500).json({ error: 'Subscription failed. Please try again.' });
  }
});

// POST /api/newsletter/unsubscribe — anyone can unsubscribe
router.post('/unsubscribe', (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    dbRun('DELETE FROM newsletter_subscribers WHERE email = ?', [email]);
    res.json({ message: 'You\'ve been unsubscribed.' });
  } catch (err) {
    console.error('Newsletter unsubscribe error:', err);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// GET /api/newsletter/subscribers — admin only
router.get('/subscribers', authenticate, requireAdmin, (req, res) => {
  try {
    const subscribers = dbAll('SELECT id, email, subscribed_at FROM newsletter_subscribers ORDER BY subscribed_at DESC');
    res.json({ subscribers, total: subscribers.length });
  } catch (err) {
    console.error('List subscribers error:', err);
    res.status(500).json({ error: 'Failed to list subscribers' });
  }
});

module.exports = router;
