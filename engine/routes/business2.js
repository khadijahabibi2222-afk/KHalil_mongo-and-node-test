'use strict';
const router = require('express').Router();
const mongoose = require('mongoose');
const { Employee, Salary, Advance, Loan, LoanPayment, OpeningBalance } = require('../models/index');
const accounting = require('../lib/accounting');

/* ── کارمندان ── */
router.get('/employees', async (req, res) => {
  try { res.json({ ok: true, data: await Employee.find().lean() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
router.post('/employees', async (req, res) => {
  try { res.json({ ok: true, data: await Employee.create(req.body) }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

/* ── پیشکی — مانده فعال هر کارمند ── */
router.get('/advances/balance/:employeeId', async (req, res) => {
  try {
    const advances = await Advance.find({ employeeId: req.params.employeeId, balance: { $gt: 0 } }).lean();
    const totalBalance = advances.reduce((s, a) => s + a.balance, 0);
    res.json({ ok: true, balance: totalBalance, advances });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/advances', async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const { employeeId, date, amount, cashAccountId, notes } = req.body;
    const employee = await Employee.findById(employeeId).session(session);
    const [adv] = await Advance.create([{ employeeId, date, amount, balance: amount, cashAccountId, notes }], { session });
    const je = await accounting.postAdvance({
      date, ref: 'ADV-' + adv._id, description: 'پیشکی به کارمند: ' + (employee?.name || ''),
      amount, cashAccountId, sourceId: adv._id, session
    });
    adv.journalEntryId = je._id;
    await adv.save({ session });
    await session.commitTransaction();
    res.json({ ok: true, data: adv });
  } catch (e) { await session.abortTransaction(); res.status(400).json({ ok: false, error: e.message }); }
  finally { session.endSession(); }
});

/* ── معاش — کسر خودکار پیشکی از مبلغ قابل پرداخت ── */
router.post('/salaries', async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const { employeeId, month, date, workDays, leaveDays, sickDays, absentDays, grossSalary, cashAccountId } = req.body;
    const employee = await Employee.findById(employeeId).session(session);

    // ── کسر خودکار پیشکی فعال (مانده‌های باز) ──
    const openAdvances = await Advance.find({ employeeId, balance: { $gt: 0 } }).session(session);
    let remainingGross = grossSalary;
    let advanceDeduct = 0;
    for (const adv of openAdvances) {
      if (remainingGross <= 0) break;
      const deduct = Math.min(adv.balance, remainingGross);
      adv.balance -= deduct;
      await adv.save({ session });
      advanceDeduct += deduct;
      remainingGross -= deduct;
    }
    const netSalary = grossSalary - advanceDeduct;

    const [salary] = await Salary.create([{
      employeeId, month, date, workDays, leaveDays, sickDays, absentDays,
      grossSalary, advanceDeduct, netSalary, cashAccountId
    }], { session });

    const je = await accounting.postSalary({
      date, ref: 'SAL-' + salary._id,
      description: `معاش ${month} — ${employee?.name || ''} (پیشکی کسرشده: ${advanceDeduct})`,
      netSalary, cashAccountId, sourceId: salary._id, session
    });
    salary.journalEntryId = je._id;
    await salary.save({ session });

    await session.commitTransaction();
    res.json({ ok: true, data: salary, advanceDeducted: advanceDeduct });
  } catch (e) { await session.abortTransaction(); res.status(400).json({ ok: false, error: e.message }); }
  finally { session.endSession(); }
});

router.get('/salaries', async (req, res) => {
  try {
    const q = req.query.employeeId ? { employeeId: req.query.employeeId } : {};
    res.json({ ok: true, data: await Salary.find(q).sort({ date: -1 }).lean() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ── قرض حسنه ── */
router.get('/loans', async (req, res) => {
  try { res.json({ ok: true, data: await Loan.find().lean() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/loans', async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const { name, type, amount, date, dueDate, description, cashAccountId } = req.body;
    const [loan] = await Loan.create([{ name, type, amount, date, dueDate, description, cashAccountId }], { session });
    const postFn = type === 'given' ? accounting.postLoanGiven : accounting.postLoanReceived;
    const je = await postFn({
      date, ref: 'LOAN-' + loan._id, description: (type === 'given' ? 'قرض داده‌شده به: ' : 'قرض گرفته‌شده از: ') + name,
      amount, cashAccountId, sourceId: loan._id, session
    });
    loan.journalEntryId = je._id;
    await loan.save({ session });
    await session.commitTransaction();
    res.json({ ok: true, data: loan });
  } catch (e) { await session.abortTransaction(); res.status(400).json({ ok: false, error: e.message }); }
  finally { session.endSession(); }
});

router.post('/loan-payments', async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const { loanId, date, amount, cashAccountId, note } = req.body;
    const loan = await Loan.findById(loanId).session(session);
    if (!loan) throw new Error('قرض پیدا نشد');
    const [payment] = await LoanPayment.create([{ loanId, date, amount, cashAccountId, note }], { session });
    const postFn = loan.type === 'given' ? accounting.postLoanRepaymentReceived : accounting.postLoanRepaymentPaid;
    const je = await postFn({
      date, ref: 'LPAY-' + payment._id, description: 'پرداخت قرض — ' + loan.name,
      amount, cashAccountId, sourceId: payment._id, session
    });
    payment.journalEntryId = je._id;
    await payment.save({ session });

    const paidTotal = (await LoanPayment.find({ loanId }).session(session)).reduce((s, p) => s + p.amount, 0);
    if (Math.abs(paidTotal - loan.amount) < 1) { loan.status = 'paid'; await loan.save({ session }); }

    await session.commitTransaction();
    res.json({ ok: true, data: payment, loanSettled: loan.status === 'paid' });
  } catch (e) { await session.abortTransaction(); res.status(400).json({ ok: false, error: e.message }); }
  finally { session.endSession(); }
});

/* ── بیلانس افتتاحیه — سرمایه به اکونت نقدی انتخابی متصل می‌شود ── */
router.get('/opening-balance', async (req, res) => {
  try {
    const ob = await OpeningBalance.findOne().sort({ createdAt: -1 }).lean();
    res.json({ ok: true, data: ob || null });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/opening-balance', async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const body = req.body;
    const totalEquity = (body.capital || 0) + (body.retainedEarnings || 0);

    // سند قبلی (در صورت وجود) باطل می‌شود تا دوباره‌نویسی تمیز انجام شود
    const prev = await OpeningBalance.findOne().sort({ createdAt: -1 }).session(session);
    if (prev && prev.journalEntryId) {
      await accounting.voidEntry(prev.journalEntryId, { session });
    }

    const [ob] = await OpeningBalance.create([body], { session });

    if (totalEquity > 0 && body.capitalCashAccountId) {
      const je = await accounting.postOpeningCapital({
        date: body.date || new Date().toISOString().slice(0, 10),
        ref: 'OB-CAPITAL-' + ob._id,
        description: 'سرمایه افتتاحیه موسسه',
        amount: totalEquity, capitalCashAccountId: body.capitalCashAccountId, session
      });
      ob.journalEntryId = je._id;
      await ob.save({ session });
    }
    await session.commitTransaction();
    res.json({ ok: true, data: ob });
  } catch (e) { await session.abortTransaction(); res.status(400).json({ ok: false, error: e.message }); }
  finally { session.endSession(); }
});

module.exports = router;
