const { Router } = require('express');
const { dbRun, dbAll, dbGet } = require('../db');
const { sendEmail } = require('../email');
const { authenticate, requireAdmin } = require('../middleware/auth');

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
      html: '<div style="font-family:Archivo,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:3px;border:1px solid rgba(22,19,15,0.14);padding:40px;">' +
        '<div style="text-align:center;margin-bottom:24px;">' +
          '<svg viewBox="0 0 24 24" width="40" height="40" fill="none"><rect x="2" y="2" width="20" height="20" rx="5" transform="rotate(45,12,12)" fill="#f4a98c"/><circle cx="12" cy="12" r="4.5" fill="#16130f"/></svg>' +
          '<h1 style="font-family:\'Saira Condensed\',sans-serif;color:#16130f;font-size:24px;margin:12px 0 4px;">New Contact Message</h1>' +
          '<p style="color:#5c564e;font-size:14px;margin:0;">From your DuGuud store contact form</p>' +
        '</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">' +
          '<tr><td style="padding:8px 0;color:#5c564e;font-weight:600;">Name</td><td>' + name.trim() + '</td></tr>' +
          '<tr><td style="padding:8px 0;color:#5c564e;font-weight:600;">Email</td><td><a href="mailto:' + email + '" style="color:#e8875f;">' + email + '</a></td></tr>' +
        '</table>' +
        '<div style="background:#f2eee6;border-radius:3px;padding:20px;border:1px solid rgba(22,19,15,0.14);">' +
          '<p style="margin:0;font-size:14px;line-height:1.6;color:#16130f;white-space:pre-wrap;">' + message.trim() + '</p>' +
        '</div>' +
        '<hr style="border:none;border-top:1px solid rgba(22,19,15,0.14);margin:24px 0;">' +
        '<p style="font-size:12px;color:#8a8480;text-align:center;margin:0;">Reply to this email to respond to ' + name.trim() + '</p>' +
      '</div>'
    });

    res.status(201).json({ message: 'Thanks, ' + name.trim() + '! We\'ll get back to you soon.' });
  } catch (err) {
    console.error('Contact form error:', err);
    res.status(500).json({ error: 'Failed to send your message. Please try again.' });
  }
});

// ─── Admin: manage contact messages ───

function escHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// GET /api/contact/messages — admin: list all messages (newest first)
router.get('/messages', authenticate, requireAdmin, (req, res) => {
  try {
    const rows = dbAll('SELECT id, name, email, message, read, reply, replied_at, created_at FROM contact_messages ORDER BY id DESC');
    res.json({ messages: rows });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// PUT /api/contact/messages/:id/read — admin: mark message read
router.put('/messages/:id/read', authenticate, requireAdmin, (req, res) => {
  try {
    const existing = dbGet('SELECT id FROM contact_messages WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Message not found' });
    dbRun('UPDATE contact_messages SET read = 1 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Mark message read error:', err);
    res.status(500).json({ error: 'Failed to update message' });
  }
});

// PUT /api/contact/messages/:id/reply — admin: email the client a reply + record it
router.put('/messages/:id/reply', authenticate, requireAdmin, async (req, res) => {
  try {
    const msg = dbGet('SELECT * FROM contact_messages WHERE id = ?', [req.params.id]);
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const reply = (req.body.reply || '').trim();
    if (!reply) return res.status(400).json({ error: 'Write a reply first' });
    if (reply.length > 5000) return res.status(400).json({ error: 'Reply is too long (max 5000 characters)' });

    const emailSent = await sendEmail({
      to: msg.email,
      subject: 'Re: your message to DuGuud',
      html: buildReplyEmail(msg, reply)
    });

    dbRun("UPDATE contact_messages SET reply = ?, replied_at = datetime('now'), read = 1 WHERE id = ?", [reply, msg.id]);

    const updated = dbGet('SELECT id, name, email, message, read, reply, replied_at, created_at FROM contact_messages WHERE id = ?', [msg.id]);
    res.json({ message: updated, emailSent });
  } catch (err) {
    console.error('Reply to message error:', err);
    res.status(500).json({ error: 'Failed to send reply' });
  }
});

// DELETE /api/contact/messages/:id — admin: delete a message
router.delete('/messages/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const existing = dbGet('SELECT id FROM contact_messages WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Message not found' });
    dbRun('DELETE FROM contact_messages WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete message error:', err);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

function buildReplyEmail(msg, reply){
  const name = escHtml(msg.name || 'there');
  const original = escHtml(msg.message || '');
  const replyText = escHtml(reply).replace(/\n/g, '<br>');
  return '<div style="font-family:Archivo,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:3px;border:1px solid rgba(22,19,15,0.14);padding:40px;">' +
    '<div style="text-align:center;margin-bottom:24px;">' +
      '<svg viewBox="0 0 24 24" width="40" height="40" fill="none"><rect x="2" y="2" width="20" height="20" rx="5" transform="rotate(45,12,12)" fill="#f4a98c"/><circle cx="12" cy="12" r="4.5" fill="#16130f"/></svg>' +
      '<h1 style="font-family:\'Saira Condensed\',sans-serif;color:#16130f;font-size:24px;margin:12px 0 4px;">DuGuud</h1>' +
      '<p style="color:#5c564e;font-size:14px;margin:0;">Thanks for reaching out</p>' +
    '</div>' +
    '<p style="font-size:14px;line-height:1.6;color:#16130f;margin-top:0;">Hi ' + name + ',</p>' +
    '<div style="background:#f2eee6;border-radius:3px;padding:20px;border:1px solid rgba(22,19,15,0.14);">' +
      '<p style="margin:0;font-size:14px;line-height:1.6;color:#16130f;">' + replyText + '</p>' +
    '</div>' +
    '<div style="margin-top:20px;padding:14px;background:#fdf1ea;border-radius:3px;border-left:3px solid #f4a98c;font-size:12px;color:#5c564e;">' +
      '<strong>Your original message:</strong><br><span style="white-space:pre-wrap;">' + original + '</span>' +
    '</div>' +
    '<hr style="border:none;border-top:1px solid rgba(22,19,15,0.14);margin:24px 0;">' +
    '<p style="font-size:12px;color:#8a8480;text-align:center;margin:0;">DuGuud — Last Stock, Honestly Priced</p>' +
  '</div>';
}

module.exports = router;
