'use strict';
const mongoose = require('mongoose');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');
const CashAccount = require('../models/CashAccount');

/* ══════════════════════════════════════════════════════════════════
   موتور حسابداری دوطرفه — تنها دروازه نوشتن به دفتر روزنامه
   هر تابع post* یک رویداد مالی واقعی را به سند دوطرفه تبدیل می‌کند.
   هیچ بخش دیگری از سیستم نباید مستقیماً JournalEntry.create بزند.
══════════════════════════════════════════════════════════════════ */

function L(type, id, debit, credit, projectId, memo) {
  return { accountType: type, accountId: id, debit: debit || 0, credit: credit || 0, projectId: projectId || null, memo: memo || '' };
}
const coaLine = (id, debit, credit, projectId, memo) => L('coa', id, debit, credit, projectId, memo);
const cashLine = (id, debit, credit, projectId, memo) => L('cash', id, debit, credit, projectId, memo);

async function postEntry({ date, ref, description, sourceType, sourceId, lines, postedBy, session }) {
  const opts = session ? { session } : {};
  const [doc] = await JournalEntry.create([{ date, ref, description, sourceType, sourceId, lines, postedBy }], opts);
  return doc;
}

async function voidEntry(journalEntryId, { postedBy, session } = {}) {
  const original = await JournalEntry.findById(journalEntryId).session(session || null);
  if (!original) throw new Error('سند یافت نشد');
  if (original.isVoid) throw new Error('این سند قبلاً باطل شده است');
  const reversedLines = original.lines.map(l => ({
    accountType: l.accountType, accountId: l.accountId,
    debit: l.credit, credit: l.debit, projectId: l.projectId, memo: 'برگشت: ' + (l.memo || '')
  }));
  const opts = session ? { session } : {};
  const [reversal] = await JournalEntry.create([{
    date: new Date().toISOString().slice(0, 10),
    ref: 'VOID-' + original.ref,
    description: 'برگشت سند: ' + original.description,
    sourceType: 'void', sourceId: original._id,
    lines: reversedLines, postedBy
  }], opts);
  original.isVoid = true;
  await original.save({ session });
  return reversal;
}

/* ── کمک‌کننده‌ها برای یافتن حساب‌های پیش‌فرض چارت اکونت ── */
async function findAcc(query) { return ChartOfAccount.findOne(query); }
async function expenseAccOrFallback(coaAccountId) {
  if (coaAccountId) return coaAccountId;
  const a = await findAcc({ code: '5800' }) || await findAcc({ type: 'Expense', parentId: { $ne: null } });
  return a ? a._id : null;
}
async function incomeAccOrFallback(coaAccountId) {
  if (coaAccountId) return coaAccountId;
  const a = await findAcc({ code: '4300' }) || await findAcc({ type: 'Income', parentId: { $ne: null } });
  return a ? a._id : null;
}

/* ══════════════════════════════════════════════════════════════════
   عملیات تجاری سطح بالا — هرکدام یک سند متراز می‌سازند
══════════════════════════════════════════════════════════════════ */

// مصرف ساده: بدهکار حساب مصرف (COA) ، بستانکار اکونت نقدی
async function postExpense({ date, ref, description, amount, coaAccountId, cashAccountId, projectId, sourceType, sourceId, postedBy, session }) {
  const accId = await expenseAccOrFallback(coaAccountId);
  return postEntry({
    date, ref, description, sourceType: sourceType || 'expense', sourceId, postedBy, session,
    lines: [
      coaLine(accId, amount, 0, projectId, description),
      cashLine(cashAccountId, 0, amount, projectId, description)
    ]
  });
}

// عاید ساده: بدهکار اکونت نقدی ، بستانکار حساب عاید (COA)
async function postIncome({ date, ref, description, amount, coaAccountId, cashAccountId, projectId, sourceType, sourceId, postedBy, session }) {
  const accId = await incomeAccOrFallback(coaAccountId);
  return postEntry({
    date, ref, description, sourceType: sourceType || 'income', sourceId, postedBy, session,
    lines: [
      cashLine(cashAccountId, amount, 0, projectId, description),
      coaLine(accId, 0, amount, projectId, description)
    ]
  });
}

// انتقال بین دو اکونت نقدی (با کارمزد اختیاری که از مبلغ مبدأ کسر می‌شود)
// منطق: مبلغ کامل از مبدأ خارج می‌شود. (مبلغ - کارمزد) به مقصد می‌رسد. کارمزد به‌عنوان مصرف اداری ثبت می‌شود.
async function postTransfer({ date, ref, description, amount, fee = 0, fromCashAccountId, toCashAccountId, postedBy, session }) {
  const lines = [
    cashLine(toCashAccountId, amount - fee, 0, null, 'دریافت انتقال'),
    cashLine(fromCashAccountId, 0, amount, null, 'ارسال انتقال')
  ];
  if (fee > 0) {
    const feeExpAcc = await expenseAccOrFallback(null);
    lines.push(coaLine(feeExpAcc, fee, 0, null, 'هزینه اداری انتقال'));
  }
  return postEntry({
    date, ref, description, sourceType: 'transfer', sourceId: null, postedBy, session, lines
  });
}

// واریز مستقیم کمک مالی به اکونت: بدهکار کش، بستانکار عاید کمک‌های مالی (مبلغ خالص)؛
// کارمزد/هزینه اداری (در صورت وجود) به‌صورت یک خط مصرف اضافه می‌شود تا سند هم خودش متراز بماند
async function postDonation({ date, ref, description, grossAmount, commission = 0, cashAccountId, projectId, coaIncomeAccountId, postedBy, sourceId, session }) {
  const net = grossAmount - commission;
  const incAcc = await incomeAccOrFallback(coaIncomeAccountId);
  const lines = [
    cashLine(cashAccountId, grossAmount, 0, projectId, description),
    coaLine(incAcc, 0, grossAmount, projectId, description)
  ];
  if (commission > 0) {
    const feeExpAcc = await expenseAccOrFallback(null);
    lines.push(coaLine(feeExpAcc, commission, 0, projectId, 'هزینه اداری کسرشده از کمک'));
    lines.push(cashLine(cashAccountId, 0, commission, projectId, 'هزینه اداری کسرشده از کمک'));
  }
  return postEntry({ date, ref, description, sourceType: 'donation', sourceId, postedBy, session, lines });
}

// پرداخت کفیل: مشابه کمک مالی اما حساب عاید کفالت
async function postSponsorPayment({ date, ref, description, grossAmount, adminFee = 0, cashAccountId, coaIncomeAccountId, postedBy, sourceId, session }) {
  const incAcc = await incomeAccOrFallback(coaIncomeAccountId);
  const lines = [
    cashLine(cashAccountId, grossAmount, 0, null, description),
    coaLine(incAcc, 0, grossAmount, null, description)
  ];
  if (adminFee > 0) {
    const feeExpAcc = await expenseAccOrFallback(null);
    lines.push(coaLine(feeExpAcc, adminFee, 0, null, 'هزینه اداری از کفالت'));
    lines.push(cashLine(cashAccountId, 0, adminFee, null, 'هزینه اداری از کفالت'));
  }
  return postEntry({ date, ref, description, sourceType: 'sponsor-payment', sourceId, postedBy, session, lines });
}

// معاش: بدهکار حساب معاشات (COA)، بستانکار اکونت نقدی (مبلغ خالص پس از کسر پیشکی)
async function postSalary({ date, ref, description, netSalary, cashAccountId, coaSalaryAccountId, postedBy, sourceId, session }) {
  const accId = await expenseAccOrFallback(coaSalaryAccountId);
  return postEntry({
    date, ref, description, sourceType: 'salary', sourceId, postedBy, session,
    lines: [
      coaLine(accId, netSalary, 0, null, description),
      cashLine(cashAccountId, 0, netSalary, null, description)
    ]
  });
}

// پیشکی به کارمند: بدهکار «دریافتنی از کارمندان» (دارایی)، بستانکار اکونت نقدی
async function postAdvance({ date, ref, description, amount, cashAccountId, coaReceivableAccountId, postedBy, sourceId, session }) {
  let accId = coaReceivableAccountId;
  if (!accId) {
    const a = await findAcc({ code: '1300' }) || await findAcc({ type: 'Asset', name: /دریافتنی/ });
    accId = a ? a._id : null;
  }
  return postEntry({
    date, ref, description, sourceType: 'advance', sourceId, postedBy, session,
    lines: [
      coaLine(accId, amount, 0, null, description),
      cashLine(cashAccountId, 0, amount, null, description)
    ]
  });
}

// قرض دادن (given): بدهکار «دریافتنی‌ها»، بستانکار اکونت نقدی
async function postLoanGiven({ date, ref, description, amount, cashAccountId, postedBy, sourceId, session }) {
  const a = await findAcc({ code: '1300' }) || await findAcc({ type: 'Asset', name: /دریافتنی/ });
  const accId = a ? a._id : null;
  return postEntry({
    date, ref, description, sourceType: 'loan-given', sourceId, postedBy, session,
    lines: [coaLine(accId, amount, 0, null, description), cashLine(cashAccountId, 0, amount, null, description)]
  });
}

// قرض گرفتن (received): بدهکار اکونت نقدی، بستانکار «قرض حسنه دریافتی» (بدهی)
async function postLoanReceived({ date, ref, description, amount, cashAccountId, postedBy, sourceId, session }) {
  const a = await findAcc({ code: '2100' }) || await findAcc({ type: 'Liability', name: /قرض/ });
  const accId = a ? a._id : null;
  return postEntry({
    date, ref, description, sourceType: 'loan-received', sourceId, postedBy, session,
    lines: [cashLine(cashAccountId, amount, 0, null, description), coaLine(accId, 0, amount, null, description)]
  });
}

// پرداخت/برگشت قرض داده‌شده: بدهکار اکونت نقدی، بستانکار «دریافتنی‌ها»
async function postLoanRepaymentReceived({ date, ref, description, amount, cashAccountId, postedBy, sourceId, session }) {
  const a = await findAcc({ code: '1300' }) || await findAcc({ type: 'Asset', name: /دریافتنی/ });
  const accId = a ? a._id : null;
  return postEntry({
    date, ref, description, sourceType: 'loan-repayment-received', sourceId, postedBy, session,
    lines: [cashLine(cashAccountId, amount, 0, null, description), coaLine(accId, 0, amount, null, description)]
  });
}

// پرداخت قرض گرفته‌شده (ما به طلبکار می‌دهیم): بدهکار «قرض حسنه دریافتی» (کاهش بدهی)، بستانکار اکونت نقدی
async function postLoanRepaymentPaid({ date, ref, description, amount, cashAccountId, postedBy, sourceId, session }) {
  const a = await findAcc({ code: '2100' }) || await findAcc({ type: 'Liability', name: /قرض/ });
  const accId = a ? a._id : null;
  return postEntry({
    date, ref, description, sourceType: 'loan-repayment-paid', sourceId, postedBy, session,
    lines: [coaLine(accId, amount, 0, null, description), cashLine(cashAccountId, 0, amount, null, description)]
  });
}

// سرمایه افتتاحیه: بدهکار اکونت نقدی انتخاب‌شده، بستانکار «سرمایه موسسه»
async function postOpeningCapital({ date, ref, description, amount, capitalCashAccountId, postedBy, session }) {
  const a = await findAcc({ code: '3100' }) || await findAcc({ type: 'Equity', name: /سرمایه/ });
  const accId = a ? a._id : null;
  return postEntry({
    date, ref, description, sourceType: 'opening-capital', sourceId: null, postedBy, session,
    lines: [cashLine(capitalCashAccountId, amount, 0, null, description), coaLine(accId, 0, amount, null, description)]
  });
}

module.exports = {
  postEntry, voidEntry,
  postExpense, postIncome, postTransfer,
  postDonation, postSponsorPayment, postSalary, postAdvance,
  postLoanGiven, postLoanReceived, postLoanRepaymentReceived, postLoanRepaymentPaid,
  postOpeningCapital
};
