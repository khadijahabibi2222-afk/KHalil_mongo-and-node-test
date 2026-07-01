'use strict';
const ChartOfAccount = require('../models/ChartOfAccount');

/* چارت اکونت پیش‌فرض — استاندارد برای موسسات خیریه/غیرانتفاعی افغانستان */
const DEFAULT_COA = [
  { code: '1000', name: 'دارایی‌ها', type: 'Asset', parent: null },
  { code: '1100', name: 'پول نقد', type: 'Asset', parent: '1000' },
  { code: '1110', name: 'صندوق نقدی اصلی', type: 'Asset', parent: '1100' },
  { code: '1200', name: 'حسابات بانکی', type: 'Asset', parent: '1000' },
  { code: '1300', name: 'دریافتنی‌ها', type: 'Asset', parent: '1000' },
  { code: '1400', name: 'دارایی‌های ثابت', type: 'Asset', parent: '1000' },
  { code: '1900', name: 'سایر دارایی‌ها', type: 'Asset', parent: '1000' },

  { code: '2000', name: 'بدهی‌ها', type: 'Liability', parent: null },
  { code: '2100', name: 'قرض حسنه دریافتی', type: 'Liability', parent: '2000' },
  { code: '2200', name: 'پرداختنی‌ها', type: 'Liability', parent: '2000' },
  { code: '2900', name: 'سایر بدهی‌ها', type: 'Liability', parent: '2000' },

  { code: '3000', name: 'حقوق مالی', type: 'Equity', parent: null },
  { code: '3100', name: 'سرمایه موسسه', type: 'Equity', parent: '3000' },
  { code: '3200', name: 'مانده سال‌های قبل', type: 'Equity', parent: '3000' },

  { code: '4000', name: 'عواید', type: 'Income', parent: null },
  { code: '4100', name: 'کمک‌های مالی', type: 'Income', parent: '4000' },
  { code: '4200', name: 'کمک‌های پروژه‌ای', type: 'Income', parent: '4000' },
  { code: '4250', name: 'عواید کفالت اطفال', type: 'Income', parent: '4000' },
  { code: '4300', name: 'سایر عواید', type: 'Income', parent: '4000' },

  { code: '5000', name: 'مصارف', type: 'Expense', parent: null },
  { code: '5100', name: 'مصارف اداری', type: 'Expense', parent: '5000' },
  { code: '5200', name: 'معاشات و مزایا', type: 'Expense', parent: '5000' },
  { code: '5300', name: 'مصارف پروژه‌ها', type: 'Expense', parent: '5000' },
  { code: '5400', name: 'کرایه و خدمات', type: 'Expense', parent: '5000' },
  { code: '5500', name: 'ترانسپورت', type: 'Expense', parent: '5000' },
  { code: '5800', name: 'سایر مصارف', type: 'Expense', parent: '5000' }
];

async function seedChartOfAccounts() {
  const count = await ChartOfAccount.countDocuments();
  if (count > 0) return { seeded: false, count };

  const codeToId = {};
  for (const item of DEFAULT_COA) {
    const parentId = item.parent ? codeToId[item.parent] : null;
    const doc = await ChartOfAccount.create({ code: item.code, name: item.name, type: item.type, parentId });
    codeToId[item.code] = doc._id;
  }
  return { seeded: true, count: DEFAULT_COA.length };
}

module.exports = { seedChartOfAccounts, DEFAULT_COA };
