'use strict';
const router = require('express').Router();
const reports = require('../lib/reports');

router.get('/trial-balance', async (req, res) => {
  try { res.json({ ok: true, data: await reports.trialBalance(req.query.asOf) }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/ledger/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    if (!['coa', 'cash'].includes(type)) return res.status(400).json({ ok: false, error: 'نوع حساب نامعتبر' });
    res.json({ ok: true, data: await reports.ledger(type, id, { from: req.query.from, to: req.query.to }) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/balance-sheet', async (req, res) => {
  try { res.json({ ok: true, data: await reports.balanceSheet(req.query.asOf) }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/income-statement', async (req, res) => {
  try { res.json({ ok: true, data: await reports.incomeStatement(req.query.from, req.query.to) }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/project/:id', async (req, res) => {
  try { res.json({ ok: true, data: await reports.projectStatement(req.params.id) }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
