const { Router } = require('express');
const bcrypt = require('bcrypt');
const { dbGet, dbAll, dbRun, dbLastInsertId } = require('../db');
const { signToken, authenticate, requireAdmin } = require('../middleware/auth');
const { sendEmail } = require('../email');

const router = Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check duplicate email
    const existing = dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const hash = bcrypt.hashSync(password, 10);
    dbRun('INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)',
          [name, email, phone || '', hash, 'customer']);

    const userId = dbLastInsertId();
    const user = { id: userId, name, email, phone: phone || '', role: 'customer' };
    const token = signToken(user);

    // Send welcome email (non-blocking)
    sendEmail({
      to: email,
      subject: 'Welcome to DuGuud, ' + name + '!',
      html: '<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;border:1px solid rgba(34,30,28,0.12);padding:40px;">' +
        '<div style="text-align:center;margin-bottom:24px;">' +
          '<svg viewBox="0 0 24 24" width="40" height="40" fill="none"><rect x="2" y="2" width="20" height="20" rx="5" transform="rotate(45,12,12)" fill="#f4a98c"/><circle cx="12" cy="12" r="4.5" fill="#221e1c"/></svg>' +
          '<h1 style="font-family:\'Space Grotesk\',sans-serif;color:#221e1c;font-size:24px;margin:12px 0 4px;">Welcome to DuGuud</h1>' +
          '<p style="color:#4a423e;font-size:14px;margin:0;">Last stock, honestly priced.</p>' +
        '</div>' +
        '<p style="color:#221e1c;font-size:15px;line-height:1.6;">Hi <strong>' + name + '</strong>,</p>' +
        '<p style="color:#4a423e;font-size:14px;line-height:1.6;">You\'re all set! Your account has been created and you can now browse our collection of premium last-stock clothing at honest prices.</p>' +
        '<div style="text-align:center;margin:28px 0;">' +
          '<a href="https://www.duguud.co.za/" style="display:inline-block;background:#f4a98c;color:#221e1c;padding:14px 32px;border-radius:30px;font-weight:600;font-size:14px;text-decoration:none;">Start Shopping</a>' +
        '</div>' +
        '<p style="color:#4a423e;font-size:13px;line-height:1.6;">If you have any questions, just reply to this email — we\'re here to help.</p>' +
        '<hr style="border:none;border-top:1px solid rgba(34,30,28,0.1);margin:24px 0;">' +
        '<p style="color:#8a8480;font-size:12px;text-align:center;margin:0;">DuGuud — South Africa</p>' +
      '</div>'
    });

    res.status(201).json({ token, user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = dbGet('SELECT * FROM users WHERE email = ?', [email]);

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const payload = { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role };
    const token = signToken(payload);

    res.json({ token, user: payload });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  try {
    const user = dbGet('SELECT id, name, email, phone, role, created_at FROM users WHERE id = ?', [req.user.userId]);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (err) {
    console.error('Get me error:', err);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// PUT /api/auth/change-password — user changes their own password (authenticated)
router.put('/change-password', authenticate, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = dbGet('SELECT * FROM users WHERE id = ?', [req.user.userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!bcrypt.compareSync(currentPassword, user.password)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hash = bcrypt.hashSync(newPassword, 10);
    dbRun('UPDATE users SET password = ? WHERE id = ?', [hash, req.user.userId]);

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// PUT /api/auth/reset-password — admin resets any user's password
router.put('/reset-password', authenticate, requireAdmin, (req, res) => {
  try {
    const { userId, newPassword } = req.body;

    if (!userId || !newPassword) {
      return res.status(400).json({ error: 'User ID and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = dbGet('SELECT id, name, email FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const hash = bcrypt.hashSync(newPassword, 10);
    dbRun('UPDATE users SET password = ? WHERE id = ?', [hash, userId]);

    res.json({ message: `Password reset for ${user.name} (${user.email})` });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// GET /api/auth/users — admin lists all users
router.get('/users', authenticate, requireAdmin, (req, res) => {
  try {
    const users = dbAll('SELECT id, name, email, phone, role, created_at FROM users ORDER BY created_at DESC');
    res.json({ users });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

module.exports = router;
