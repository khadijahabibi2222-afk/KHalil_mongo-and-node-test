'use strict';
const router = require('express').Router();
const ChartOfAccount = require('../models/ChartOfAccount');

// لیست همه حساب‌ها (مسطح) — فرانت می‌تواند خودش درخت بسازد
router.get('/', async (req, res) => {
  try {
    const accounts = await ChartOfAccount.find({ isActive: true }).sort({ code: 1 }).lean();
    res.json({ ok: true, data: accounts });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// درخت کامل (nested)
router.get('/tree', async (req, res) => {
  try {
    const all = await ChartOfAccount.find({ isActive: true }).sort({ code: 1 }).lean();
    const byId = {}; all.forEach(a => byId[String(a._id)] = { ...a, children: [] });
    const roots = [];
    all.forEach(a => {
      const node = byId[String(a._id)];
      if (a.parentId) (byId[String(a.parentId)]?.children || roots).push(node);
      else roots.push(node);
    });
    res.json({ ok: true, data: roots });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const acc = await ChartOfAccount.create(req.body);
    res.json({ ok: true, data: acc });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const acc = await ChartOfAccount.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!acc) return res.status(404).json({ ok: false, error: 'حساب پیدا نشد' });
    res.json({ ok: true, data: acc });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// حذف نرم (soft delete) — حسابی که در آن تراکنش ثبت شده هرگز نباید فیزیکی حذف شود
router.delete('/:id', async (req, res) => {
  try {
    const JournalEntry = require('../models/JournalEntry');
    const used = await JournalEntry.exists({ 'lines.accountType': 'coa', 'lines.accountId': req.params.id });
    if (used) {
      await ChartOfAccount.findByIdAndUpdate(req.params.id, { isActive: false });
      return res.json({ ok: true, softDeleted: true, message: 'این حساب دارای تراکنش است؛ غیرفعال شد (حذف کامل ممکن نیست)' });
    }
    await ChartOfAccount.findByIdAndDelete(req.params.id);
    res.json({ ok: true, softDeleted: false });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
