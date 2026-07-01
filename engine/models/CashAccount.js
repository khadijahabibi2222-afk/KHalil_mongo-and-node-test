'use strict';
const mongoose = require('mongoose');

const CashAccountSchema = new mongoose.Schema({
  name:             { type: String, required: true, trim: true },
  type:             { type: String, enum: ['cash', 'bank', 'mobile', 'other'], default: 'cash' },
  accountCategory:  { type: String, enum: ['primary', 'secondary'], default: 'primary' },
  coaAccountId:     { type: mongoose.Schema.Types.ObjectId, ref: 'ChartOfAccount', default: null },
  accountNumber:    { type: String, default: '' },
  notes:            { type: String, default: '' },
  // موجودی اولیه — فقط از طریق سند افتتاحیه (Opening Balance) قابل تنظیم است
  openingBalance:   { type: Number, default: 0 },
  openingDate:      { type: String, default: '' },
  openingSource:    { type: String, default: '' }, // 'opening_entry' وقتی از سند افتتاحیه آمده
  isActive:         { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('CashAccount', CashAccountSchema);
