'use strict';
const mongoose = require('mongoose');

/* ══════════════════════════════════════════════════════════════════
   JournalEntry — قلب موتور حسابداری دوطرفه (Double-Entry Engine)
   هر سند مالی (مصرف، عاید، معاش، انتقال، قرض، کمک مالی، کفالت،
   سرمایه افتتاحیه...) یک JournalEntry است که حتماً:
        مجموع خط‌های بدهکار (debit) = مجموع خط‌های بستانکار (credit)
   هر خط یا به یک حساب از Chart of Accounts اشاره می‌کند (accountType:'coa')
   یا به یک اکونت نقدی (accountType:'cash').
══════════════════════════════════════════════════════════════════ */

const LineSchema = new mongoose.Schema({
  accountType: { type: String, enum: ['coa', 'cash'], required: true },
  accountId:   { type: mongoose.Schema.Types.ObjectId, required: true },
  debit:       { type: Number, default: 0, min: 0 },
  credit:      { type: Number, default: 0, min: 0 },
  projectId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
  memo:        { type: String, default: '' }
}, { _id: false });

LineSchema.pre('validate', function (next) {
  if ((this.debit > 0 && this.credit > 0) || (this.debit === 0 && this.credit === 0)) {
    return next(new Error('هر خط سند باید یا بدهکار باشد یا بستانکار، نه هر دو و نه هیچ‌کدام'));
  }
  next();
});

const JournalEntrySchema = new mongoose.Schema({
  date:        { type: String, required: true }, // YYYY-MM-DD (شمسی یا میلادی به انتخاب فرانت)
  ref:         { type: String, required: true, index: true }, // مرجع/شماره سند یکتا
  description: { type: String, default: '' },
  // منبع رویداد — برای ردیابی این‌که سند از کجا آمده (expense/income/salary/donation/...)
  sourceType:  { type: String, default: 'manual', index: true },
  sourceId:    { type: mongoose.Schema.Types.Mixed, default: null },
  lines:       { type: [LineSchema], required: true, validate: v => v.length >= 2 },
  isVoid:      { type: Boolean, default: false },
  voidOfId:    { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
  postedBy:    { type: String, default: '' }
}, { timestamps: true });

// ── راستی‌آزمایی تراز قبل از ذخیره: بدهکار = بستانکار ──
JournalEntrySchema.pre('validate', function (next) {
  const td = this.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const tc = this.lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (Math.abs(td - tc) > 0.01) {
    return next(new Error(`سند نامتراز: بدهکار=${td} بستانکار=${tc} (مرجع: ${this.ref})`));
  }
  next();
});

JournalEntrySchema.index({ date: 1 });
JournalEntrySchema.index({ 'lines.accountType': 1, 'lines.accountId': 1 });

module.exports = mongoose.model('JournalEntry', JournalEntrySchema);
