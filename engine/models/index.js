'use strict';
const mongoose = require('mongoose');
const { Schema } = mongoose;

const ProjectSchema = new Schema({
  name:          { type: String, required: true },
  donor:         { type: String, default: '' },
  budget:        { type: Number, default: 0 },
  status:        { type: String, enum: ['active', 'closed'], default: 'active' },
  cashAccountId: { type: Schema.Types.ObjectId, ref: 'CashAccount', default: null },
  startDate:     { type: String, default: '' },
  notes:         { type: String, default: '' }
}, { timestamps: true });

const DonorSchema = new Schema({
  name:  { type: String, required: true },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  notes: { type: String, default: '' }
}, { timestamps: true });

const DonationSchema = new Schema({
  date:           { type: String, required: true },
  donorId:        { type: Schema.Types.ObjectId, ref: 'Donor', default: null },
  donorName:      { type: String, default: '' },
  grossAmount:    { type: Number, required: true },
  commission:     { type: Number, default: 0 }, // هزینه اداری کسرشده
  amount:         { type: Number, required: true }, // مبلغ خالص = grossAmount - commission
  projectId:      { type: Schema.Types.ObjectId, ref: 'Project', default: null },
  cashAccountId:  { type: Schema.Types.ObjectId, ref: 'CashAccount', required: true },
  journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
  notes:          { type: String, default: '' }
}, { timestamps: true });

const SponsorSchema = new Schema({
  sponsorName: { type: String, required: true },
  childName:   { type: String, required: true },
  father:      { type: String, default: '' },
  grandfather: { type: String, default: '' },
  age:         { type: Number, default: null },
  location:    { type: String, default: '' },
  phone:       { type: String, default: '' },
  amount:      { type: Number, required: true }, // مبلغ کفالت دوره‌ای
  cycle:       { type: String, enum: ['monthly', 'quarterly', 'yearly'], default: 'monthly' },
  startDate:   { type: String, default: '' },
  status:      { type: String, enum: ['active', 'inactive'], default: 'active' }
}, { timestamps: true });

const SponsorPaymentSchema = new Schema({
  sponsorId:      { type: Schema.Types.ObjectId, ref: 'Sponsor', required: true },
  date:           { type: String, required: true },
  month:          { type: String, default: '' }, // YYYY-MM
  grossAmount:    { type: Number, required: true },
  adminFee:       { type: Number, default: 0 },
  adminFeeRate:   { type: Number, default: 0 },
  amount:         { type: Number, required: true }, // خالص برای طفل
  cashAccountId:  { type: Schema.Types.ObjectId, ref: 'CashAccount', required: true },
  journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
  note:           { type: String, default: '' }
}, { timestamps: true });

const EmployeeSchema = new Schema({
  name:       { type: String, required: true },
  position:   { type: String, default: '' },
  baseSalary: { type: Number, default: 0 },
  phone:      { type: String, default: '' },
  startDate:  { type: String, default: '' },
  status:     { type: String, enum: ['active', 'inactive'], default: 'active' }
}, { timestamps: true });

const SalarySchema = new Schema({
  employeeId:     { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
  month:          { type: String, required: true }, // YYYY-MM
  date:           { type: String, required: true },
  workDays:       { type: Number, default: 0 },
  leaveDays:      { type: Number, default: 0 },
  sickDays:       { type: Number, default: 0 },
  absentDays:     { type: Number, default: 0 },
  grossSalary:    { type: Number, required: true },
  advanceDeduct:  { type: Number, default: 0 }, // پیشکی کسرشده — خودکار محاسبه می‌شود
  netSalary:      { type: Number, required: true },
  cashAccountId:  { type: Schema.Types.ObjectId, ref: 'CashAccount', required: true },
  journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null }
}, { timestamps: true });

const AdvanceSchema = new Schema({
  employeeId:     { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
  date:           { type: String, required: true },
  amount:         { type: Number, required: true },
  balance:        { type: Number, required: true }, // مانده باقیمانده تا کسر کامل از معاش
  cashAccountId:  { type: Schema.Types.ObjectId, ref: 'CashAccount', required: true },
  journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
  notes:          { type: String, default: '' }
}, { timestamps: true });

const LoanSchema = new Schema({
  name:          { type: String, required: true }, // طرف قرض (داده‌شده یا گرفته‌شده)
  type:          { type: String, enum: ['given', 'received'], required: true },
  amount:        { type: Number, required: true },
  date:          { type: String, required: true },
  dueDate:       { type: String, default: '' },
  description:   { type: String, default: '' },
  cashAccountId: { type: Schema.Types.ObjectId, ref: 'CashAccount', required: true },
  status:        { type: String, enum: ['active', 'paid'], default: 'active' },
  journalEntryId:{ type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null }
}, { timestamps: true });

const LoanPaymentSchema = new Schema({
  loanId:         { type: Schema.Types.ObjectId, ref: 'Loan', required: true },
  date:           { type: String, required: true },
  amount:         { type: Number, required: true },
  cashAccountId:  { type: Schema.Types.ObjectId, ref: 'CashAccount', required: true },
  journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
  note:           { type: String, default: '' }
}, { timestamps: true });

const OpeningBalanceSchema = new Schema({
  date:                  { type: String, default: '' },
  receivables:           { type: Number, default: 0 },
  fixedAssets:           { type: Number, default: 0 },
  otherAssets:           { type: Number, default: 0 },
  loans:                 { type: Number, default: 0 },     // بدهی‌های قرض حسنه
  payables:              { type: Number, default: 0 },
  otherLiabilities:      { type: Number, default: 0 },
  capital:               { type: Number, default: 0 },
  retainedEarnings:      { type: Number, default: 0 },
  capitalCashAccountId:  { type: Schema.Types.ObjectId, ref: 'CashAccount', default: null },
  journalEntryId:        { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
  notes:                 { type: String, default: '' }
}, { timestamps: true });
// تک‌سندی: همیشه یک رکورد فعال
OpeningBalanceSchema.index({}, { unique: false });

const UserSchema = new Schema({
  username:     { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role:         { type: String, enum: ['admin', 'editor', 'viewer'], default: 'editor' },
  isActive:     { type: Boolean, default: true }
}, { timestamps: true });

const SettingsSchema = new Schema({
  key:   { type: String, required: true, unique: true },
  value: { type: Schema.Types.Mixed }
}, { timestamps: true });

module.exports = {
  Project:        mongoose.model('Project', ProjectSchema),
  Donor:          mongoose.model('Donor', DonorSchema),
  Donation:       mongoose.model('Donation', DonationSchema),
  Sponsor:        mongoose.model('Sponsor', SponsorSchema),
  SponsorPayment: mongoose.model('SponsorPayment', SponsorPaymentSchema),
  Employee:       mongoose.model('Employee', EmployeeSchema),
  Salary:         mongoose.model('Salary', SalarySchema),
  Advance:        mongoose.model('Advance', AdvanceSchema),
  Loan:           mongoose.model('Loan', LoanSchema),
  LoanPayment:    mongoose.model('LoanPayment', LoanPaymentSchema),
  OpeningBalance: mongoose.model('OpeningBalance', OpeningBalanceSchema),
  User:           mongoose.model('User', UserSchema),
  Settings:       mongoose.model('Settings', SettingsSchema)
};
