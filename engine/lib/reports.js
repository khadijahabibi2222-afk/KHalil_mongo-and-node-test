'use strict';
const mongoose = require('mongoose');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');
const CashAccount = require('../models/CashAccount');

/* ══════════════════════════════════════════════════════════════════
   موتور گزارش‌گیری — همه گزارش‌ها مستقیماً از JournalEntry (دفتر کل)
   با aggregation محاسبه می‌شوند؛ منبع واحد حقیقت (Single Source of Truth)
══════════════════════════════════════════════════════════════════ */

function dateFilter(asOfDate) {
  return asOfDate ? { date: { $lte: asOfDate }, isVoid: { $ne: true } } : { isVoid: { $ne: true } };
}

// ── تراز آزمایشی: مجموع بدهکار/بستانکار هر حساب (COA + Cash) ──
async function trialBalance(asOfDate) {
  const match = dateFilter(asOfDate);
  const rows = await JournalEntry.aggregate([
    { $match: match },
    { $unwind: '$lines' },
    { $group: {
        _id: { accountType: '$lines.accountType', accountId: '$lines.accountId' },
        debit: { $sum: '$lines.debit' },
        credit: { $sum: '$lines.credit' }
    }}
  ]);

  const coaIds = rows.filter(r => r._id.accountType === 'coa').map(r => r._id.accountId);
  const cashIds = rows.filter(r => r._id.accountType === 'cash').map(r => r._id.accountId);
  const [coaAccs, cashAccs] = await Promise.all([
    ChartOfAccount.find({ _id: { $in: coaIds } }).lean(),
    CashAccount.find({ _id: { $in: cashIds } }).lean()
  ]);
  const coaMap = Object.fromEntries(coaAccs.map(a => [String(a._id), a]));
  const cashMap = Object.fromEntries(cashAccs.map(a => [String(a._id), a]));

  const result = rows.map(r => {
    const idStr = String(r._id.accountId);
    let label, path, nature;
    if (r._id.accountType === 'coa') {
      const a = coaMap[idStr];
      label = a ? `${a.code} — ${a.name}` : 'حساب حذف‌شده';
      nature = a ? a.normalBalance : 'debit';
      path = a ? a.name : '';
    } else {
      const c = cashMap[idStr];
      label = c ? c.name : 'اکونت حذف‌شده';
      nature = 'debit';
      path = c ? c.name : '';
    }
    const balance = nature === 'debit' ? (r.debit - r.credit) : (r.credit - r.debit);
    return { accountType: r._id.accountType, accountId: idStr, label, path, debit: r.debit, credit: r.credit, balance, nature };
  }).sort((a, b) => a.label.localeCompare(b.label));

  const totalDebit = result.reduce((s, r) => s + r.debit, 0);
  const totalCredit = result.reduce((s, r) => s + r.credit, 0);
  return { rows: result, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
}

// ── دفتر کل یک حساب مشخص با مانده تدریجی (running balance) ──
async function ledger(accountType, accountId, { from, to } = {}) {
  const match = { isVoid: { $ne: true }, 'lines.accountType': accountType, 'lines.accountId': new mongoose.Types.ObjectId(accountId) };
  if (from) match.date = { ...(match.date || {}), $gte: from };
  if (to) match.date = { ...(match.date || {}), $lte: to };

  const entries = await JournalEntry.find(match).sort({ date: 1, createdAt: 1 }).lean();
  let nature = 'debit';
  if (accountType === 'coa') {
    const acc = await ChartOfAccount.findById(accountId).lean();
    if (acc) nature = acc.normalBalance;
  }
  let running = 0;
  const rows = entries.map(e => {
    const line = e.lines.find(l => l.accountType === accountType && String(l.accountId) === String(accountId));
    if (!line) return null;
    running += nature === 'debit' ? (line.debit - line.credit) : (line.credit - line.debit);
    return { date: e.date, ref: e.ref, description: e.description, debit: line.debit, credit: line.credit, running, entryId: e._id };
  }).filter(Boolean);

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  return { rows, totalDebit, totalCredit, balance: running, nature };
}

// ── موجودی یک اکونت نقدی (shortcut) ──
async function cashAccountBalance(cashAccountId) {
  const { balance } = await ledger('cash', cashAccountId);
  return balance;
}

// ── بیلانس شیت (Balance Sheet) — گروه‌بندی Asset/Liability/Equity از تراز آزمایشی ──
async function balanceSheet(asOfDate) {
  const tb = await trialBalance(asOfDate);
  const coaIds = tb.rows.filter(r => r.accountType === 'coa').map(r => r.accountId);
  const coaAccs = await ChartOfAccount.find({ _id: { $in: coaIds } }).lean();
  const typeMap = Object.fromEntries(coaAccs.map(a => [String(a._id), a.type]));

  const assets = [], liabilities = [], equity = [];
  let cashTotal = 0;
  tb.rows.forEach(r => {
    if (r.accountType === 'cash') { assets.push(r); cashTotal += r.balance; return; }
    const t = typeMap[r.accountId];
    if (t === 'Asset') assets.push(r);
    else if (t === 'Liability') liabilities.push(r);
    else if (t === 'Equity') equity.push(r);
    // Income/Expense از طریق سود/زیان دوره به Equity منتقل می‌شوند (پایین)
  });

  // سود/زیان جاری = مجموع Income (credit) - مجموع Expense (debit)
  const incomeIds = coaAccs.filter(a => a.type === 'Income').map(a => String(a._id));
  const expenseIds = coaAccs.filter(a => a.type === 'Expense').map(a => String(a._id));
  const totalIncome = tb.rows.filter(r => incomeIds.includes(r.accountId)).reduce((s, r) => s + r.balance, 0);
  const totalExpense = tb.rows.filter(r => expenseIds.includes(r.accountId)).reduce((s, r) => s + r.balance, 0);
  const netResult = totalIncome - totalExpense;

  const totalAssets = assets.reduce((s, r) => s + r.balance, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.balance, 0);
  const totalEquityBase = equity.reduce((s, r) => s + r.balance, 0);
  const totalEquity = totalEquityBase + netResult;
  const totalLiabEquity = totalLiabilities + totalEquity;

  return {
    assets, liabilities, equity, netResult,
    totalAssets, totalLiabilities, totalEquity, totalLiabEquity,
    balanced: Math.abs(totalAssets - totalLiabEquity) < 1,
    asOfDate: asOfDate || new Date().toISOString().slice(0, 10)
  };
}

// ── صورت عواید و مصارف (Income Statement) برای یک بازه ──
async function incomeStatement(from, to) {
  const match = { isVoid: { $ne: true } };
  if (from || to) match.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const rows = await JournalEntry.aggregate([
    { $match: match }, { $unwind: '$lines' },
    { $match: { 'lines.accountType': 'coa' } },
    { $group: { _id: '$lines.accountId', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } }
  ]);
  const ids = rows.map(r => r._id);
  const accs = await ChartOfAccount.find({ _id: { $in: ids } }).lean();
  const accMap = Object.fromEntries(accs.map(a => [String(a._id), a]));

  const income = [], expense = [];
  rows.forEach(r => {
    const a = accMap[String(r._id)]; if (!a) return;
    if (a.type === 'Income') income.push({ code: a.code, name: a.name, amount: r.credit - r.debit });
    else if (a.type === 'Expense') expense.push({ code: a.code, name: a.name, amount: r.debit - r.credit });
  });
  const totalIncome = income.reduce((s, r) => s + r.amount, 0);
  const totalExpense = expense.reduce((s, r) => s + r.amount, 0);
  return { income, expense, totalIncome, totalExpense, net: totalIncome - totalExpense, from, to };
}

// ── گزارش مالی یک پروژه مشخص (بر اساس projectId در خطوط سند) ──
async function projectStatement(projectId) {
  const pid = new mongoose.Types.ObjectId(projectId);
  const rows = await JournalEntry.aggregate([
    { $match: { isVoid: { $ne: true } } },
    { $unwind: '$lines' },
    { $match: { 'lines.projectId': pid } },
    { $group: {
        _id: { accountType: '$lines.accountType', accountId: '$lines.accountId' },
        debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' }
    }}
  ]);
  const cashRows = rows.filter(r => r._id.accountType === 'cash');
  const coaRows = rows.filter(r => r._id.accountType === 'coa');
  const cashIn = cashRows.reduce((s, r) => s + r.debit, 0);
  const cashOut = cashRows.reduce((s, r) => s + r.credit, 0);
  const expenseCoaIds = (await ChartOfAccount.find({ type: 'Expense' }).select('_id').lean()).map(a => String(a._id));
  const totalExpense = coaRows.filter(r => expenseCoaIds.includes(String(r._id.accountId))).reduce((s, r) => s + r.debit, 0);
  return { cashIn, cashOut, netCash: cashIn - cashOut, totalExpense, raw: rows };
}

module.exports = { trialBalance, ledger, cashAccountBalance, balanceSheet, incomeStatement, projectStatement };
