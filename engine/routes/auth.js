'use strict';
const router = require('express').Router();
const crypto = require('crypto');
const { User } = require('../models/index');

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(check));
}

router.post('/register', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ ok: false, error: 'نام کاربری و رمز الزامی است' });
    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ ok: false, error: 'این نام کاربری قبلاً ثبت شده' });
    const user = await User.create({ username, passwordHash: hashPassword(password), role: role || 'editor' });
    res.json({ ok: true, data: { id: user._id, username: user.username, role: user.role } });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username, isActive: true });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ ok: false, error: 'نام کاربری یا رمز عبور اشتباه است' });
    }
    res.json({ ok: true, data: { id: user._id, username: user.username, role: user.role } });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = { router, hashPassword, verifyPassword };
