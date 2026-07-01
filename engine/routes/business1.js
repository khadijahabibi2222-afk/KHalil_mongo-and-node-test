'use strict';
const router = require('express').Router();
const mongoose = require('mongoose');
const { Project, Donor, Donation, Sponsor, SponsorPayment } = require('../models/index');
const accounting = require('../lib/accounting');

/* ── پروژه‌ها ── */
router.get('/projects', async (req, res) => {
  try { res.json({ ok: true, data: await Project.find().lean() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
router.post('/projects', async (req, res) => {
  try { res.json({ ok: true, data: await Project.create(req.body) }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.put('/projects/:id', async (req, res) => {
  try { res.json({ ok: true, data: await Project.findByIdAndUpdate(req.params.id, req.body, { new: true }) }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

/* ── تمویل‌کنندگان ── */
router.get('/donors', async (req, res) => {
  try { res.json({ ok: true, data: await Donor.find().lean() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
router.post('/donors', async (req, res) => {
  try { res.json({ ok: true, data: await Donor.create(req.body) }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

/* ── کمک‌های مالی — هر کدام یک سند روزنامه می‌سازد ── */
router.get('/donations', async (req, res) => {
  try { res.json({ ok: true, data: await Donation.find().sort({ date: -1 }).lean() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/donations', async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const { date, donorId, donorName, grossAmount, commission = 0, projectId, cashAccountId, notes } = req.body;
    const amount = grossAmount - commission;
    const [donation] = await Donation.create([{
      date, donorId, donorName, grossAmount, commission, amount, projectId, cashAccountId, notes
    }], { session });
    const je = await accounting.postDonation({
      date, ref: 'DON-' + donation._id, description: 'کمک مالی از: ' + (donorName || ''),
      grossAmount, commission, cashAccountId, projectId, sourceId: donation._id, session
    });
    donation.journalEntryId = je._id;
    await donation.save({ session });
    await session.commitTransaction();
    res.json({ ok: true, data: donation });
  } catch (e) {
    await session.abortTransaction();
    res.status(400).json({ ok: false, error: e.message });
  } finally { session.endSession(); }
});

router.delete('/donations/:id', async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const donation = await Donation.findById(req.params.id).session(session);
    if (!donation) throw new Error('کمک مالی پیدا نشد');
    if (donation.journalEntryId) await accounting.voidEntry(donation.journalEntryId, { session });
    await Donation.findByIdAndDelete(req.params.id, { session });
    await session.commitTransaction();
    res.json({ ok: true });
  } catch (e) {
    await session.abortTransaction();
    res.status(400).json({ ok: false, error: e.message });
  } finally { session.endSession(); }
});

/* ── کفیلان اطفال ── */
router.get('/sponsors', async (req, res) => {
  try { res.json({ ok: true, data: await Sponsor.find().lean() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
router.post('/sponsors', async (req, res) => {
  try { res.json({ ok: true, data: await Sponsor.create(req.body) }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

router.get('/sponsor-payments', async (req, res) => {
  try {
    const q = req.query.sponsorId ? { sponsorId: req.query.sponsorId } : {};
    res.json({ ok: true, data: await SponsorPayment.find(q).sort({ date: -1 }).lean() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/sponsor-payments', async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const { sponsorId, date, month, grossAmount, adminFee = 0, adminFeeRate = 0, cashAccountId, note } = req.body;
    const amount = grossAmount - adminFee;
    const sponsor = await Sponsor.findById(sponsorId).session(session);
    const [payment] = await SponsorPayment.create([{
      sponsorId, date, month, grossAmount, adminFee, adminFeeRate, amount, cashAccountId, note
    }], { session });
    const je = await accounting.postSponsorPayment({
      date, ref: 'SP-' + payment._id,
      description: 'پرداخت کفالت — ' + (sponsor?.childName || ''),
      grossAmount, adminFee, cashAccountId, sourceId: payment._id, session
    });
    payment.journalEntryId = je._id;
    await payment.save({ session });
    await session.commitTransaction();
    res.json({ ok: true, data: payment });
  } catch (e) {
    await session.abortTransaction();
    res.status(400).json({ ok: false, error: e.message });
  } finally { session.endSession(); }
});

module.exports = router;
