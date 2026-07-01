'use strict';
const router = require('express').Router();
const JournalEntry = require('../models/JournalEntry');
const accounting = require('../lib/accounting');
const reports = require('../lib/reports');

// لیست اسناد روزنامه (با صفحه‌بندی ساده)
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 100, sourceType, from, to } = req.query;
    const q = {};
    if (sourceType) q.sourceType = sourceType;
    if (from || to) q.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    const entries = await JournalEntry.find(q).sort({ date: -1, createdAt: -1 })
      .skip((page - 1) * limit).limit(Number(limit)).lean();
    const total = await JournalEntry.countDocuments(q);
    res.json({ ok: true, data: entries, total, page: Number(page) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ثبت سند دستی (manual journal entry) — برای کاربرانی که حسابداری مستقیم می‌خواهند
router.post('/', async (req, res) => {
  try {
    const { date, ref, description, lines, postedBy } = req.body;
    if (!Array.isArray(lines) || lines.length < 2) {
      return res.status(400).json({ ok: false, error: 'سند باید حداقل ۲ خط داشته باشد' });
    }
    const doc = await accounting.postEntry({ date, ref, description, sourceType: 'manual', sourceId: null, lines, postedBy });
    res.json({ ok: true, data: doc });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

router.post('/:id/void', async (req, res) => {
  try {
    const reversal = await accounting.voidEntry(req.params.id, { postedBy: req.body.postedBy });
    res.json({ ok: true, data: reversal });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

module.exports = router;
