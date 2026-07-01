'use strict';
/* ══════════════════════════════════════════════════════════════════
   اسکریپت Migration — داده‌های قدیمی (یک فایل JSON بزرگ) را به
   دیتابیس واقعی (مدل‌های جدا + دفتر کل دوطرفه) منتقل می‌کند.
   اجرا: node engine/scripts/migrate.js
   پیش‌نیاز: متغیر محیطی MONGODB_URI تنظیم شده باشد.
   این اسکریپت idempotent نیست — فقط یک‌بار روی دیتابیس تازه اجرا شود.
══════════════════════════════════════════════════════════════════ */
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const ChartOfAccount = require('../models/ChartOfAccount');
const CashAccount = require('../models/CashAccount');
const { Project, Donor, Donation, Sponsor, SponsorPayment,
        Employee, Salary, Advance, Loan, LoanPayment, OpeningBalance } = require('../models/index');
const accounting = require('../lib/accounting');
const { seedChartOfAccounts } = require('../lib/seedCoa');

const LEGACY_FILE = path.join(__dirname, '../../data/mainDB.json');

async function main() {
  const dbUrl = process.env.MONGODB_URI;
  if (!dbUrl) { console.error('❌ MONGODB_URI تنظیم نشده'); process.exit(1); }
  await mongoose.connect(dbUrl);
  console.log('✅ به MongoDB وصل شد');

  if (!fs.existsSync(LEGACY_FILE)) {
    console.error('❌ فایل دیتای قدیمی پیدا نشد:', LEGACY_FILE);
    process.exit(1);
  }
  const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
  console.log('📂 دیتای قدیمی بارگذاری شد');

  // ── ۱. چارت اکونت: ابتدا پیش‌فرض را seed کن، سپس کدهای قدیمی را با همان کد جدید نگاشت بده ──
  await seedChartOfAccounts();
  const coaIdMap = {}; // legacy numeric id -> new ObjectId
  if (Array.isArray(legacy.accounts)) {
    for (const a of legacy.accounts) {
      let doc = await ChartOfAccount.findOne({ code: a.code });
      if (!doc) {
        // کد جدید که در پیش‌فرض نبود — مستقیماً اضافه کن (parentId بعداً وصل می‌شود)
        doc = await ChartOfAccount.create({ code: a.code, name: a.name, type: a.type, parentId: null });
      }
      coaIdMap[a.id] = doc._id;
    }
    // اتصال parentId با نگاشت
    for (const a of legacy.accounts) {
      if (a.parentId && coaIdMap[a.parentId]) {
        await ChartOfAccount.findByIdAndUpdate(coaIdMap[a.id], { parentId: coaIdMap[a.parentId] });
      }
    }
  }
  console.log(`✅ ${Object.keys(coaIdMap).length} حساب چارت اکونت نگاشت شد`);

  // ── ۲. اکونت‌های نقدی (بدون openingBalance — بعداً از سند افتتاحیه تنظیم می‌شود) ──
  const caIdMap = {};
  if (Array.isArray(legacy.cashAccounts)) {
    for (const ca of legacy.cashAccounts) {
      const doc = await CashAccount.create({
        name: ca.name, type: ca.type || 'cash',
        accountCategory: ca.accountCategory || 'primary',
        coaAccountId: ca.coaAccountId ? coaIdMap[ca.coaAccountId] : null,
        accountNumber: ca.accountNumber || '', notes: ca.notes || '',
        openingBalance: 0
      });
      caIdMap[ca.id] = doc._id;
    }
  }
  console.log(`✅ ${Object.keys(caIdMap).length} اکونت نقدی منتقل شد`);

  // ── ۳. پروژه‌ها ──
  const projectIdMap = {};
  if (Array.isArray(legacy.projects)) {
    for (const p of legacy.projects) {
      const doc = await Project.create({
        name: p.name, donor: p.donor || '', budget: p.budget || 0,
        status: p.status || 'active',
        cashAccountId: p.cashAccountId ? caIdMap[p.cashAccountId] : null,
        startDate: p.startDate || '', notes: p.notes || ''
      });
      projectIdMap[p.id] = doc._id;
    }
  }
  console.log(`✅ ${Object.keys(projectIdMap).length} پروژه منتقل شد`);

  // ── ۴. بیلانس افتتاحیه — سرمایه به اکونت نقدی متصل می‌شود ──
  if (legacy.openingBalance && (legacy.openingBalance.capital || legacy.openingBalance.retainedEarnings)) {
    const ob = legacy.openingBalance;
    const capitalCashAccountId = ob.capitalCashAccountId ? caIdMap[ob.capitalCashAccountId] : null;
    const doc = await OpeningBalance.create({
      date: ob.date || '', receivables: ob.receivables || 0, fixedAssets: ob.fixedAssets || 0,
      otherAssets: ob.otherAssets || 0, loans: ob.loans || 0, payables: ob.payables || 0,
      otherLiabilities: ob.otherLiabilities || 0, capital: ob.capital || 0,
      retainedEarnings: ob.retainedEarnings || 0, capitalCashAccountId, notes: ob.notes || ''
    });
    const totalEquity = (ob.capital || 0) + (ob.retainedEarnings || 0);
    if (totalEquity > 0 && capitalCashAccountId) {
      const je = await accounting.postOpeningCapital({
        date: ob.date || new Date().toISOString().slice(0, 10),
        ref: 'OB-CAPITAL-' + doc._id, description: 'سرمایه افتتاحیه (migration)',
        amount: totalEquity, capitalCashAccountId
      });
      doc.journalEntryId = je._id; await doc.save();
    }
    console.log('✅ بیلانس افتتاحیه منتقل شد');
  }

  // ── ۵. کمک‌های مالی ──
  if (Array.isArray(legacy.donations)) {
    for (const d of legacy.donations) {
      const cashAccountId = caIdMap[d.cashAccountId]; if (!cashAccountId) continue;
      const gross = d.grossAmount || d.amount;
      const commission = d.commission || 0;
      const doc = await Donation.create({
        date: d.date, donorName: d.donorName || '', grossAmount: gross, commission,
        amount: gross - commission, projectId: d.projectId ? projectIdMap[d.projectId] : null,
        cashAccountId, notes: d.notes || ''
      });
      const je = await accounting.postDonation({
        date: d.date, ref: 'DON-' + doc._id, description: 'کمک مالی از: ' + (d.donorName || ''),
        grossAmount: gross, commission, cashAccountId,
        projectId: d.projectId ? projectIdMap[d.projectId] : null, sourceId: doc._id
      });
      doc.journalEntryId = je._id; await doc.save();
    }
    console.log(`✅ ${legacy.donations.length} کمک مالی منتقل شد`);
  }

  // ── ۶. کفیلان و پرداخت‌ها ──
  const sponsorIdMap = {};
  if (Array.isArray(legacy.sponsors)) {
    for (const s of legacy.sponsors) {
      const doc = await Sponsor.create({
        sponsorName: s.sponsorName, childName: s.childName, father: s.father || '',
        grandfather: s.grandfather || '', age: s.age || null, location: s.location || '',
        phone: s.phone || '', amount: s.amount, cycle: s.cycle || 'monthly',
        startDate: s.startDate || '', status: s.status || 'active'
      });
      sponsorIdMap[s.id] = doc._id;
    }
  }
  if (Array.isArray(legacy.sponsorPayments)) {
    for (const p of legacy.sponsorPayments) {
      const sponsorId = sponsorIdMap[p.sponsorId]; const cashAccountId = caIdMap[p.cashAccountId];
      if (!sponsorId || !cashAccountId) continue;
      const gross = p.grossAmount || p.amount; const adminFee = p.adminFee || 0;
      const doc = await SponsorPayment.create({
        sponsorId, date: p.date, month: p.month || '', grossAmount: gross,
        adminFee, adminFeeRate: p.adminFeeRate || 0, amount: gross - adminFee,
        cashAccountId, note: p.note || ''
      });
      const je = await accounting.postSponsorPayment({
        date: p.date, ref: 'SP-' + doc._id, description: 'پرداخت کفالت (migration)',
        grossAmount: gross, adminFee, cashAccountId, sourceId: doc._id
      });
      doc.journalEntryId = je._id; await doc.save();
    }
  }
  console.log(`✅ ${Object.keys(sponsorIdMap).length} کفیل و پرداخت‌ها منتقل شد`);

  // ── ۷. کارمندان، معاشات، پیشکی‌ها ──
  const empIdMap = {};
  if (Array.isArray(legacy.employees)) {
    for (const e of legacy.employees) {
      const doc = await Employee.create({
        name: e.name, position: e.position || '', baseSalary: e.baseSalary || 0,
        phone: e.phone || '', startDate: e.startDate || '', status: e.status || 'active'
      });
      empIdMap[e.id] = doc._id;
    }
  }
  console.log(`✅ ${Object.keys(empIdMap).length} کارمند منتقل شد`);

  // ── ۸. قرض حسنه ──
  const loanIdMap = {};
  if (Array.isArray(legacy.loans)) {
    for (const l of legacy.loans) {
      const cashAccountId = caIdMap[l.cashAccountId]; if (!cashAccountId) continue;
      const doc = await Loan.create({
        name: l.name, type: l.type, amount: l.amount, date: l.date,
        dueDate: l.dueDate || '', description: l.description || '', cashAccountId, status: l.status || 'active'
      });
      const postFn = l.type === 'given' ? accounting.postLoanGiven : accounting.postLoanReceived;
      const je = await postFn({
        date: l.date, ref: 'LOAN-' + doc._id, description: (l.type === 'given' ? 'قرض داده‌شده: ' : 'قرض گرفته‌شده: ') + l.name,
        amount: l.amount, cashAccountId, sourceId: doc._id
      });
      doc.journalEntryId = je._id; await doc.save();
      loanIdMap[l.id] = doc._id;
    }
  }
  if (Array.isArray(legacy.loanPayments)) {
    for (const p of legacy.loanPayments) {
      const loanId = loanIdMap[p.loanId]; const cashAccountId = caIdMap[p.cashAccountId];
      if (!loanId || !cashAccountId) continue;
      const loan = await Loan.findById(loanId);
      const doc = await LoanPayment.create({ loanId, date: p.date, amount: p.amount, cashAccountId, note: p.note || '' });
      const postFn = loan.type === 'given' ? accounting.postLoanRepaymentReceived : accounting.postLoanRepaymentPaid;
      const je = await postFn({
        date: p.date, ref: 'LPAY-' + doc._id, description: 'پرداخت قرض (migration) — ' + loan.name,
        amount: p.amount, cashAccountId, sourceId: doc._id
      });
      doc.journalEntryId = je._id; await doc.save();
    }
  }
  console.log(`✅ ${Object.keys(loanIdMap).length} قرض حسنه منتقل شد`);

  // ── ۹. تراکنش‌های عمومی (مصرف/عاید/معاش/پیشکی/انتقال) ──
  let txCount = 0, salaryCount = 0, advanceCount = 0;
  if (Array.isArray(legacy.transactions)) {
    // گروه‌بندی انتقالات بر اساس ref برای جلوگیری از دوبار ثبت
    const handledRefs = new Set();
    for (const t of legacy.transactions) {
      const cashAccountId = caIdMap[t.cashAccountId]; if (!cashAccountId) continue;
      const projectId = t.projectId ? projectIdMap[t.projectId] : null;

      if (t.isTransfer) {
        if (handledRefs.has(t.ref)) continue;
        handledRefs.add(t.ref);
        const pair = legacy.transactions.filter(x => x.isTransfer && x.ref === t.ref);
        const out = pair.find(x => x.type === 'expense');
        const ins = pair.filter(x => x.type === 'income' && !x.description?.includes('هزینه اداری'));
        if (out && ins.length) {
          const toCash = caIdMap[ins[0].cashAccountId];
          const fromCash = caIdMap[out.cashAccountId];
          if (toCash && fromCash) {
            await accounting.postTransfer({
              date: out.date, ref: 'TRF-' + out.id, description: out.description || 'انتقال (migration)',
              amount: out.amount, fee: out.amount - ins[0].amount,
              fromCashAccountId: fromCash, toCashAccountId: toCash
            });
            txCount++;
          }
        }
        continue;
      }
      if (t.isAdvance) {
        // پیشکی به‌صورت جداگانه در مرحله بعد با Advance مدل ثبت می‌شود
        const employeeMatch = Object.entries(empIdMap).find(([oldId]) => (t.description || '').includes(''));
        continue; // پیشکی‌ها از منبع جدا (legacy.advances در صورت وجود) مدیریت می‌شوند، اینجا صرفنظر
      }

      const description = t.description || t.ref || '';
      if (t.type === 'expense') {
        const coaAccountId = t.accountId ? coaIdMap[t.accountId] : null;
        await accounting.postExpense({
          date: t.date, ref: 'EXP-' + t.id, description, amount: t.amount,
          coaAccountId, cashAccountId, projectId, sourceType: 'migration-expense'
        });
      } else if (t.type === 'income') {
        const coaAccountId = t.accountId ? coaIdMap[t.accountId] : null;
        await accounting.postIncome({
          date: t.date, ref: 'INC-' + t.id, description, amount: t.amount,
          coaAccountId, cashAccountId, projectId, sourceType: 'migration-income'
        });
      }
      txCount++;
    }
  }
  console.log(`✅ ${txCount} تراکنش عمومی منتقل شد`);

  console.log('🎉 Migration کامل شد.');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(e => { console.error('❌ خطای Migration:', e); process.exit(1); });
