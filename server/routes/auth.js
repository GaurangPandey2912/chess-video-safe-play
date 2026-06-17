const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

router.post('/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be 6+ characters' });
    if (username.length < 2) return res.status(400).json({ error: 'Username must be 2+ characters' });

    const user = new User({ username, email, passwordHash: password, peerId: 'cv-' + username });
    await user.save();

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });

    const redirect = req.query.redirect === 'extension' && req.query.extensionId
      ? `chrome-extension://${req.query.extensionId}/auth-callback.html?token=${token}`
      : null;

    res.status(201).json({ token, user: user.toPublicJSON(), redirect });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Username or email already taken' });
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });

    const redirect = req.query.redirect === 'extension' && req.query.extensionId
      ? `chrome-extension://${req.query.extensionId}/auth-callback.html?token=${token}`
      : null;

    res.json({ token, user: user.toPublicJSON(), redirect });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', auth, (req, res) => {
  res.json({ user: req.user.toPublicJSON() });
});

module.exports = router;
