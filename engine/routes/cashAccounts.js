'use strict';
const router = require('express').Router();
const CashAccount = require('../models/CashAccount');
const { cashAccountBalance } = require('../lib/reports');

router.get('/', async (req, res) => {
  try {
    const accounts = await CashAccount.find({ isActive: true }).lean();
    const withBalance = await Promise.all(accounts.map(async a => ({
      ...a, balance: await cashAccountBalance(a._id)
    })));
    res.json({ ok: true, data: withBalance });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/:id/balance', async (req, res) => {
  try {
    const balance = await cashAccountBalance(req.params.id);
    res.json({ ok: true, balance });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ساخت/ویرایش — موجودی اولیه عمداً پذیرفته نمی‌شود (فقط از طریق opening-balance route)
router.post('/', async (req, res) => {
  try {
    const { openingBalance, openingDate, openingSource, ...rest } = req.body; // نادیده گرفته می‌شوند
    const ca = await CashAccount.create({ ...rest, openingBalance: 0 });
    res.json({ ok: true, data: ca });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { openingBalance, openingDate, openingSource, ...rest } = req.body; // محافظت‌شده
    const ca = await CashAccount.findByIdAndUpdate(req.params.id, rest, { new: true, runValidators: true });
    if (!ca) return res.status(404).json({ ok: false, error: 'اکونت پیدا نشد' });
    res.json({ ok: true, data: ca });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const JournalEntry = require('../models/JournalEntry');
    const used = await JournalEntry.exists({ 'lines.accountType': 'cash', 'lines.accountId': req.params.id });
    if (used) {
      await CashAccount.findByIdAndUpdate(req.params.id, { isActive: false });
      return res.json({ ok: true, softDeleted: true, message: 'این اکونت دارای تراکنش است؛ غیرفعال شد' });
    }
    await CashAccount.findByIdAndDelete(req.params.id);
    res.json({ ok: true, softDeleted: false });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
