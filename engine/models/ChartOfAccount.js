'use strict';
const mongoose = require('mongoose');

const TYPES = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'];

const ChartOfAccountSchema = new mongoose.Schema({
  code:        { type: String, required: true, unique: true, trim: true, index: true },
  name:        { type: String, required: true, trim: true },
  type:        { type: String, enum: TYPES, required: true },
  parentId:    { type: mongoose.Schema.Types.ObjectId, ref: 'ChartOfAccount', default: null, index: true },
  // مانده طبیعی: Asset/Expense = بدهکار (debit) | Liability/Equity/Income = بستانکار (credit)
  normalBalance: { type: String, enum: ['debit', 'credit'], required: true },
  isActive:    { type: Boolean, default: true },
  notes:       { type: String, default: '' }
}, { timestamps: true });

ChartOfAccountSchema.pre('validate', function (next) {
  if (!this.normalBalance) {
    this.normalBalance = (this.type === 'Asset' || this.type === 'Expense') ? 'debit' : 'credit';
  }
  next();
});

ChartOfAccountSchema.statics.TYPES = TYPES;

module.exports = mongoose.model('ChartOfAccount', ChartOfAccountSchema);
