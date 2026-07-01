'use strict';
const router = require('express').Router();
const mongoose = require('mongoose');
const accounting = require('../lib/accounting');
const reports = require('../lib/reports');
const JournalEntry = require('../models/JournalEntry');

/* ── مصرف ساده — بدهکار حساب COA، بستانکار اکونت نقدی ── */
router.post('/expense', async (req, res) => {
  try {
    const { date, description, amount, coaAccountId, cashAccountId, projectId } = req.body;
    const je = await accounting.postExpense({
      date, ref: 'EXP-' + new mongoose.Types.ObjectId(), description, amount,
      coaAccountId, cashAccountId, projectId, sourceType: 'manual-expense'
    });
    res.json({ ok: true, data: je });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

/* ── عاید ساده ── */
router.post('/income', async (req, res) => {
  try {
    const { date, description, amount, coaAccountId, cashAccountId, projectId } = req.body;
    const je = await accounting.postIncome({
      date, ref: 'INC-' + new mongoose.Types.ObjectId(), description, amount,
      coaAccountId, cashAccountId, projectId, sourceType: 'manual-income'
    });
    res.json({ ok: true, data: je });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

/* ── انتقال بین دو اکونت نقدی ── */
router.post('/transfer', async (req, res) => {
  try {
    const { date, description, amount, fee, fromCashAccountId, toCashAccountId } = req.body;
    const je = await accounting.postTransfer({
      date, ref: 'TRF-' + new mongoose.Types.ObjectId(), description, amount, fee,
      fromCashAccountId, toCashAccountId
    });
    res.json({ ok: true, data: je });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

/* ── لیست تراکنش‌ها بر اساس قلم COA یا اکونت نقدی (برای فیلتر/جستجوی صفحه مصارف) ── */
router.get('/by-account', async (req, res) => {
  try {
    const { accountType, accountId, from, to, search } = req.query;
    const match = { isVoid: { $ne: true } };
    if (from || to) match.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    if (search) match.description = { $regex: search, $options: 'i' };
    if (accountType && accountId) {
      match['lines.accountType'] = accountType;
      match['lines.accountId'] = new mongoose.Types.ObjectId(accountId);
    }
    const entries = await JournalEntry.find(match).sort({ date: -1 }).limit(500).lean();
    res.json({ ok: true, data: entries });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
