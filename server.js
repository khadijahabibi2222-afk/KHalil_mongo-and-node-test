'use strict';
const express     = require('express');
const path        = require('path');
const fs          = require('fs');
const mongoose    = require('mongoose');
const multer      = require('multer');
const sharp       = require('sharp');
const compression = require('compression');

const app = express();
app.use(compression({ level: 6 }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d', etag: true }));
app.use(express.json({ limit: '10mb' }));

// ── مسیرها ──
const uploadsDir  = path.join(__dirname, 'uploads');
const dataDir     = path.join(__dirname, 'data');
const dataFile    = path.join(dataDir, 'mainDB.json');
const logoFile    = path.join(dataDir, 'logo.json');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(dataDir))    fs.mkdirSync(dataDir,    { recursive: true });

// ══════════════════════════════════════════════════
//  لایه ذخیره‌سازی: MongoDB اولویت، فایل fallback
// ══════════════════════════════════════════════════
let mongoReady = false;
let Store, FileRef;

// ── فایل‌های JSON (همیشه در دسترس) ──
function fileRead(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function fileWrite(file, data) {
  try {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (e) { console.error('❌ fileWrite:', e.message); return false; }
}

// ── MongoDB (اختیاری) ──
const dbUrl = process.env.MONGODB_URI;
if (dbUrl) {
  const MONGO_OPTS = {
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 30000,
    connectTimeoutMS: 8000,
    maxPoolSize: 5,
    retryWrites: true,
    retryReads: true,
    heartbeatFrequencyMS: 15000,
  };

  const storeSchema = new mongoose.Schema({
    key:       { type: String, required: true, unique: true, index: true },
    valueStr:  { type: String, required: true },
    updatedAt: { type: Date, default: Date.now }
  });
  const fileSchema = new mongoose.Schema({
    fileId:    { type: String, required: true, unique: true, index: true },
    filename:  String, mimetype: String, size: Number,
    refType:   String, refId: String,
    createdAt: { type: Date, default: Date.now }
  });
  Store   = mongoose.model('Store',   storeSchema);
  FileRef = mongoose.model('FileRef', fileSchema);

  async function connectMongo(attempt) {
    attempt = attempt || 1;
    try {
      await mongoose.connect(dbUrl, MONGO_OPTS);
      mongoReady = true;
      console.log('✅ MongoDB وصل شد (تلاش ' + attempt + ')');
      // ── sync فایل محلی به MongoDB اگر داده‌های pending داریم ──
      syncFileToMongo();
    } catch (err) {
      mongoReady = false;
      console.error('❌ MongoDB (تلاش ' + attempt + '):', err.message);
      const delay = Math.min(5000 * attempt, 60000);
      setTimeout(() => connectMongo(attempt + 1), delay);
    }
  }

  mongoose.connection.on('disconnected', () => {
    mongoReady = false;
    console.warn('⚠️ MongoDB قطع شد — به فایل fallback می‌شود');
    setTimeout(() => connectMongo(1), 5000);
  });
  mongoose.connection.on('reconnected', () => {
    mongoReady = true;
    console.log('🔄 MongoDB وصل شد');
    syncFileToMongo();
  });
  mongoose.connection.on('error', err => console.error('❌ MongoDB error:', err.message));

  connectMongo(1);
} else {
  console.warn('⚠️ MONGODB_URI تنظیم نشده — حالت فایلی فعال است');
}

// ══════════════════════════════════════════════════
//  موتور حسابداری واقعی (Engine) — دیتابیس واقعی + دفتر کل دوطرفه
//  از همان اتصال MongoDB بالا استفاده می‌کند (بدون اتصال جداگانه)
//  در کنار /api/db قدیمی (blob) فعال است — جایگزینی تدریجی، بدون شکستن چیزی
// ══════════════════════════════════════════════════
let engineReady = false;
if (dbUrl) {
  try {
    const { seedChartOfAccounts } = require('./engine/lib/seedCoa');
    const engineRouter = express.Router();
    engineRouter.use('/accounts',        require('./engine/routes/chartOfAccounts'));
    engineRouter.use('/cash-accounts',   require('./engine/routes/cashAccounts'));
    engineRouter.use('/journal',         require('./engine/routes/journal'));
    engineRouter.use('/reports',         require('./engine/routes/reports'));
    engineRouter.use('/tx',              require('./engine/routes/transactions'));
    engineRouter.use('/',                require('./engine/routes/business1'));
    engineRouter.use('/',                require('./engine/routes/business2'));
    const { router: authRouter } = require('./engine/routes/auth');
    engineRouter.use('/auth', authRouter);
    app.use('/api/v2', engineRouter);

    mongoose.connection.on('connected', async () => {
      try {
        const r = await seedChartOfAccounts();
        engineReady = true;
        console.log(r.seeded ? `✅ چارت اکونت پیش‌فرض ساخته شد (${r.count} حساب)` : `ℹ️ چارت اکونت موجود است (${r.count} حساب)`);
      } catch (e) { console.error('❌ seedChartOfAccounts:', e.message); }
    });
    console.log('✅ موتور حسابداری واقعی (engine) روی /api/v2 فعال شد');
  } catch (e) {
    console.error('❌ بارگذاری engine ناموفق:', e.message);
  }
}

// ── sync: وقتی MongoDB وصل می‌شود، داده فایل را push کن ──
async function syncFileToMongo() {
  if (!mongoReady || !Store) return;
  try {
    // mainDB
    const fd = fileRead(dataFile);
    if (fd && Object.keys(fd).length > 0) {
      await Store.findOneAndUpdate(
        { key: 'mainDB' },
        { $set: { valueStr: JSON.stringify(fd), updatedAt: new Date() } },
        { upsert: true, new: true }
      );
      console.log('🔄 mainDB از فایل به MongoDB sync شد');
    }
    // logo
    const fl = fileRead(logoFile);
    if (fl !== null) {
      await Store.findOneAndUpdate(
        { key: 'logo' },
        { $set: { valueStr: JSON.stringify(fl), updatedAt: new Date() } },
        { upsert: true, new: true }
      );
    }
  } catch (e) { console.error('❌ syncFileToMongo:', e.message); }
}

// ── dbGet: MongoDB اول، فایل دوم ──
async function dbGet(key) {
  // اول MongoDB
  if (mongoReady && Store) {
    try {
      const doc = await Store.findOne({ key }).lean();
      if (doc) {
        const val = JSON.parse(doc.valueStr);
        // به‌روزرسانی فایل محلی برای sync
        fileWrite(key === 'mainDB' ? dataFile : logoFile, val);
        return val;
      }
    } catch (e) { console.warn('dbGet mongo fallback:', e.message); }
  }
  // fallback: فایل
  return fileRead(key === 'mainDB' ? dataFile : logoFile);
}

// ── dbSave: هر دو جا (فایل + MongoDB) ──
async function dbSave(key, value) {
  const filePath = key === 'mainDB' ? dataFile : logoFile;
  // ۱. همیشه فایل را ذخیره کن
  fileWrite(filePath, value);
  const now = new Date();
  // ۲. اگر MongoDB وصل است، آنجا هم ذخیره کن
  if (mongoReady && Store) {
    try {
      await Store.findOneAndUpdate(
        { key },
        { $set: { valueStr: JSON.stringify(value), updatedAt: now } },
        { upsert: true, new: true }
      );
    } catch (e) {
      console.warn('dbSave mongo error (فایل ذخیره شد):', e.message);
    }
  }
  return now.toISOString();
}

// ── آپلود ──
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('فقط تصاویر مجاز است'));
  }
});

// ══════════════════════════════════════════════════
//  API Routes
// ══════════════════════════════════════════════════

// ── Health ──
app.get('/api/health', (req, res) => {
  const state = mongoose.connection ? mongoose.connection.readyState : -1;
  const names = ['disconnected','connected','connecting','disconnecting'];
  const fileOk = fs.existsSync(dataDir);
  res.json({
    ok: true,  // سرور همیشه ok است
    mongoConnected: mongoReady,
    mongoState: dbUrl ? (names[state] || 'unknown') : 'disabled',
    fileStorage: fileOk,
    storageMode: mongoReady ? 'mongodb+file' : (dbUrl ? 'file (mongo قطع)' : 'file only'),
    engineReady, // موتور حسابداری واقعی (double-entry) — /api/v2/*
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// ── Main DB GET ──
app.get('/api/db', async (req, res) => {
  try {
    const data = await dbGet('mainDB');
    res.json({ ok: true, data, source: mongoReady ? 'mongodb' : 'file' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Main DB POST ──
app.post('/api/db', async (req, res) => {
  try {
    if (!req.body?.data) return res.status(400).json({ ok: false, error: 'no data' });
    const data = req.body.data;
    const savedAt = await dbSave('mainDB', data);
    res.json({ ok: true, lastSaved: savedAt, storage: mongoReady ? 'mongodb+file' : 'file' });
  } catch (e) {
    console.error('❌ POST /api/db:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Logo GET ──
app.get('/api/logo', async (req, res) => {
  try {
    const logo = await dbGet('logo');
    res.json({ ok: true, logo: logo || '' });
  } catch (e) {
    res.json({ ok: true, logo: '' });
  }
});

// ── Logo POST ──
app.post('/api/logo', async (req, res) => {
  try {
    await dbSave('logo', req.body.logo || '');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── آپلود تصویر ──
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'فایل ارسال نشد' });
    const fileId   = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const filename = fileId + '.webp';
    const filePath = path.join(uploadsDir, filename);

    await sharp(req.file.buffer)
      .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toFile(filePath);

    const stat = fs.statSync(filePath);

    // metadata ── فایل JSON محلی
    const metaPath = path.join(dataDir, 'files.json');
    const files    = fileRead(metaPath) || [];
    files.push({ fileId, filename, mimetype: 'image/webp', size: stat.size,
                 refType: req.body.refType || 'general', refId: req.body.refId || '',
                 createdAt: new Date().toISOString() });
    fileWrite(metaPath, files);

    // اگر MongoDB وصل است، آنجا هم ثبت کن
    if (mongoReady && FileRef) {
      FileRef.create({ fileId, filename, mimetype: 'image/webp', size: stat.size,
                       refType: req.body.refType || 'general', refId: req.body.refId || '' })
             .catch(e => console.warn('FileRef mongo:', e.message));
    }

    res.json({ ok: true, fileId, url: '/api/file/' + fileId });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── دریافت فایل ──
app.get('/api/file/:fileId', async (req, res) => {
  try {
    const fid = req.params.fileId;
    // جستجو در فایل‌های آپلودشده
    let filename = null;
    const metaPath = path.join(dataDir, 'files.json');
    const files    = fileRead(metaPath) || [];
    const meta     = files.find(f => f.fileId === fid);
    if (meta) filename = meta.filename;

    // fallback: MongoDB
    if (!filename && mongoReady && FileRef) {
      try {
        const doc = await FileRef.findOne({ fileId: fid }).lean();
        if (doc) filename = doc.filename;
      } catch {}
    }

    if (!filename) return res.status(404).json({ error: 'فایل پیدا نشد' });
    const filePath = path.join(uploadsDir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'فایل حذف شده' });
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Content-Type', 'image/webp');
    res.sendFile(filePath);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Error handler ──
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ ok: false, error: 'حجم فایل بیش از ۲۰۰KB است' });
  next(err);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🚀 سرور در پورت ' + PORT);
  console.log('💾 حالت ذخیره:', dbUrl ? 'MongoDB + فایل' : 'فایل محلی');
  console.log('📁 data dir:', dataDir);
});
