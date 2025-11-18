// Phiên bản gộp và hỗ trợ upload ảnh lên Google Cloud Storage.
// Tối ưu cho deploy trên App Engine / Cloud Run trong cùng project (suaxe-api).

const express = require('express');
require('dotenv').config();
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const passport = require('passport');
const Auth0Strategy = require('passport-auth0');
const { Storage } = require('@google-cloud/storage');
const multer = require('multer');

const app = express();

// --- Config GCS ---
const GCS_BUCKET = process.env.GCS_BUCKET || 'suaxe-api-2-web';
const storage = new Storage(); // App Engine / Cloud Run sẽ dùng default credentials
const bucket = storage.bucket(GCS_BUCKET);

// --- Multer (memory) để upload file lên GCS ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// --- Logging env ---
console.log('NODE_ENV =', process.env.NODE_ENV);
console.log('Using GCS bucket =', GCS_BUCKET);

// --- Middleware logging request/response ---
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - START`);
  const originalEnd = res.end;
  res.end = function (chunk, encoding) {
    const responseTime = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - END - Status: ${res.statusCode} - ${responseTime}ms`);
    return originalEnd.call(this, chunk, encoding);
  };
  next();
});

// --- CORS ---
const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? ['https://suaxe-web-73744.web.app', 'https://suaxe-web-73744.firebaseapp.com', '*']
    : ['http://localhost:3000', 'http://127.0.0.1:5501', 'http://localhost:3001'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};
app.use(cors(corsOptions));

// --- Session & Passport (Auth0 ready) ---
app.use(session({
  secret: process.env.SESSION_SECRET || 'session_secret_fallback',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.use(new Auth0Strategy(
  {
    domain: process.env.AUTH0_DOMAIN || '',
    clientID: process.env.AUTH0_CLIENT_ID || '',
    clientSecret: process.env.AUTH0_CLIENT_SECRET || '',
    callbackURL: process.env.AUTH0_CALLBACK_URL || 'http://localhost:8080/api/auth0/callback'
  },
  function (accessToken, refreshToken, extraParams, profile, done) {
    return done(null, profile);
  }
));

passport.serializeUser(function (user, done) { done(null, user); });
passport.deserializeUser(function (user, done) { done(null, user); });

// --- Cloud storage URL middleware ---
app.use((req, res, next) => {
  res.locals.cloudStorageUrl = process.env.STATIC_URL || `https://storage.googleapis.com/${GCS_BUCKET}`;
  next();
});

// --- Parser ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- MySQL Pool (port 3306 theo config bạn xác nhận) ---
const pool = mysql.createPool({
  host: process.env.DB_HOST || '34.124.218.251',
  user: process.env.DB_USER || 'websuaxe',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'websuaxe',
  port: parseInt(process.env.DB_PORT || '3306'),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test DB connection at startup (non-fatal)
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log('✅ MySQL connected');
    conn.release();
  } catch (err) {
    console.error('❌ MySQL connect error:', err.message || err);
  }
})();

// --- Auth middlewares ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Không tìm thấy token' });
  jwt.verify(token, process.env.JWT_SECRET || 'sua_xe_secret_key', (err, user) => {
    if (err) return res.status(403).json({ success: false, message: 'Token không hợp lệ hoặc đã hết hạn' });
    req.user = user;
    next();
  });
};

const checkAdminAccess = (req, res, next) => {
  if (req.user && req.user.role === 1) return next();
  return res.status(403).json({ success: false, message: 'Không có quyền truy cập. Yêu cầu quyền admin.' });
};

// --- Mount modular routes if exist (non-blocking) ---
try { const authRoutes = require('./routes/authRoutes'); if (authRoutes.router) app.use('/api/auth', authRoutes.router); } catch (e) {}
try { const auth0Routes = require('./routes/auth0Routes'); app.use('/api/auth0', auth0Routes); } catch (e) {}
try { const serviceRoutes = require('./routes/serviceRoutes'); app.use('/api/services', serviceRoutes); } catch (e) {}
try { const bookingRoutes = require('./routes/bookingRoutes'); app.use('/api/booking', bookingRoutes); } catch (e) {}
try { const scheduleRoutes = require('./routes/schedulesRoutes'); app.use('/api/schedules', scheduleRoutes); } catch (e) { console.error('Không load được schedulesRoutes:', e.message);}
try { const userRoutes = require('./routes/userRoutes'); app.use('/api/users', userRoutes); } catch (e) {}
try { const revenueRoutes = require('./routes/revenueRoutes'); app.use('/api/revenue', revenueRoutes); } catch (e) {}
try { const mechanicsRoutes = require('./routes/mechanicsRoutes'); app.use('/api/mechanics', mechanicsRoutes); } catch (e) {}
try { const imageRoutes = require('./routes/imageRoutes'); app.use('/api/images', imageRoutes); } catch (e) {}
try { const profileRoutes = require('./routes/profileRoutes'); app.use('/api/users', profileRoutes); } catch (e) {}

// ---------------- Core endpoints (copied/merged) ----------------

// API test
app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'API đang hoạt động!', env: process.env.NODE_ENV, time: new Date().toISOString() });
});

// DB test
app.get('/api/db-test', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 as test');
    res.json({ success: true, message: 'Kết nối DB OK', data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Lỗi DB: ' + err.message });
  }
});

// ================= Image upload -> Google Cloud Storage =================
// POST /api/images/upload
// form-data: image (file), folder (optional: avatars|services|service-carousel)
app.post('/api/images/upload', authenticateToken, checkAdminAccess, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Thiếu file image' });

    const folder = req.body.folder || 'services';
    const allowedFolders = ['avatars', 'services', 'service-carousel'];
    const useFolder = allowedFolders.includes(folder) ? folder : 'services';

    // Tạo tên file an toàn
    const timestamp = Date.now();
    const originalName = path.basename(req.file.originalname).replace(/\s+/g, '_');
    const fileName = `${timestamp}_${originalName}`;
    const destination = `images/${useFolder}/${fileName}`;

    const file = bucket.file(destination);

    // Upload buffer
    const stream = file.createWriteStream({
      metadata: { contentType: req.file.mimetype },
      resumable: false
    });

    stream.on('error', (err) => {
      console.error('Upload error:', err);
      return res.status(500).json({ success: false, message: 'Lỗi upload: ' + err.message });
    });

    stream.on('finish', async () => {
      try {
        // Make public
        await file.makePublic();

        const publicUrl = `https://storage.googleapis.com/${GCS_BUCKET}/${destination}`;

        // Nếu muốn lưu vào DB, bạn có thể insert vào bảng tương ứng ở đây (ví dụ Services, Users)

        return res.status(201).json({ success: true, message: 'Upload thành công', imageUrl: publicUrl, path: destination });
      } catch (err) {
        console.error('Post-upload error:', err);
        return res.status(500).json({ success: false, message: 'Lỗi khi xử lý file: ' + err.message });
      }
    });

    stream.end(req.file.buffer);
  } catch (err) {
    console.error('Upload exception:', err);
    res.status(500).json({ success: false, message: 'Lỗi server: ' + (err.message || err) });
  }
});

// If you want to support delete image
app.delete('/api/images', authenticateToken, checkAdminAccess, async (req, res) => {
  try {
    const { path: objectPath } = req.body;
    if (!objectPath) return res.status(400).json({ success: false, message: 'Thiếu path của object' });

    const file = bucket.file(objectPath);
    await file.delete();
    res.json({ success: true, message: 'Xóa file thành công' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ success: false, message: 'Lỗi xóa file: ' + err.message });
  }
});

// ================= Services (example kept) =================
app.get('/api/services', async (req, res) => {
  try {
    const [services] = await pool.query('SELECT * FROM Services');
    res.json({ success: true, services });
  } catch (err) {
    console.error('Lỗi lấy services:', err);
    res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
  }
});

// ================= Firebase Auth endpoint (kept) =================
app.post('/api/auth/firebase', async (req, res) => {
  try {
    const { email, name, photoURL, uid } = req.body;
    if (!email || !uid) return res.status(400).json({ success: false, message: 'Thiếu thông tin xác thực Firebase' });

    const [existingUsers] = await pool.query('SELECT * FROM Users WHERE Email = ?', [email]);

    let userId, userRole, fullName, phoneNumber, avatarUrl;
    if (existingUsers.length === 0) {
      const randomPassword = Math.random().toString(36).substring(2, 15);
      const hashedPassword = await bcrypt.hash(randomPassword, 10);
      const [result] = await pool.query(
        'INSERT INTO Users (FullName, Email, PasswordHash, PhoneNumber, RoleID, AvatarUrl, FirebaseUID, Provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [name || 'User', email, hashedPassword, '', 2, photoURL || null, uid, 'firebase']
      );
      userId = result.insertId; userRole = 2; fullName = name || 'User'; phoneNumber = ''; avatarUrl = photoURL;
    } else {
      const user = existingUsers[0];
      userId = user.UserID; userRole = user.RoleID; fullName = user.FullName; phoneNumber = user.PhoneNumber || ''; avatarUrl = user.AvatarUrl || photoURL;
      if (!user.FirebaseUID || !user.Provider) {
        await pool.query('UPDATE Users SET FirebaseUID = ?, Provider = ?, AvatarUrl = ? WHERE UserID = ?', [uid, 'firebase', photoURL || user.AvatarUrl, userId]);
      }
    }

    const token = jwt.sign({ userId, email, role: userRole }, process.env.JWT_SECRET || 'sua_xe_secret_key', { expiresIn: '7d' });
    res.json({ success: true, message: 'Đăng nhập Firebase thành công', token, user: { userId, email, fullName, phoneNumber, role: userRole, avatar: avatarUrl } });
  } catch (err) {
    console.error('Firebase auth error:', err);
    res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
  }
});

// ================= Admin dashboard endpoints (examples) =================
app.get('/api/admin/dashboard/summary', authenticateToken, checkAdminAccess, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();

    const [todayAppointments] = await pool.query('SELECT COUNT(*) as count FROM Appointments WHERE DATE(AppointmentDate) = ?', [today]);
    const [monthlyRevenue] = await pool.query('SELECT SUM(Amount) as total FROM Payments WHERE MONTH(PaymentDate) = ? AND YEAR(PaymentDate) = ? AND Status = "Completed"', [currentMonth, currentYear]);
    const [customersCount] = await pool.query('SELECT COUNT(*) as count FROM Users WHERE RoleID = 2');
    const [pendingAppointments] = await pool.query('SELECT COUNT(*) as count FROM Appointments WHERE Status = "Pending"');

    const [revenueData] = await pool.query(`
      SELECT MONTH(p.PaymentDate) as month, SUM(p.Amount) as revenue
      FROM Payments p
      WHERE p.Status = "Completed" AND YEAR(p.PaymentDate) = ?
      GROUP BY MONTH(p.PaymentDate)
      ORDER BY month
    `, [currentYear]);

    const monthlyRevenueData = Array(12).fill(0);
    revenueData.forEach(item => {
      if (item.month >= 1 && item.month <= 12) monthlyRevenueData[item.month - 1] = parseFloat(item.revenue || 0);
    });

    const [servicesData] = await pool.query(`
      SELECT s.ServiceName, COUNT(aps.AppointmentServiceID) as serviceCount
      FROM Services s
      JOIN AppointmentServices aps ON s.ServiceID = aps.ServiceID
      JOIN Appointments a ON aps.AppointmentID = a.AppointmentID
      WHERE a.Status = 'Completed'
      GROUP BY s.ServiceID
      ORDER BY serviceCount DESC
      LIMIT 5
    `);

    const serviceLabels = servicesData.map(i => i.ServiceName);
    const serviceValues = servicesData.map(i => i.serviceCount);

    res.json({
      success: true,
      data: {
        todayAppointments: todayAppointments[0].count,
        monthlyRevenue: monthlyRevenue[0].total || 0,
        totalCustomers: customersCount[0].count,
        pendingAppointments: pendingAppointments[0].count,
        revenueData: { values: monthlyRevenueData },
        serviceData: { labels: serviceLabels, values: serviceValues }
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
  }
});

// ================= Booking endpoints (examples) =================
app.get('/api/booking/appointments', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const isAdmin = req.user.role === 1;

    let query = `
      SELECT a.*, u.FullName, u.PhoneNumber, v.LicensePlate, v.Brand, v.Model,
        (SELECT GROUP_CONCAT(s.ServiceName SEPARATOR ', ')
         FROM AppointmentServices ap
         JOIN Services s ON ap.ServiceID = s.ServiceID
         WHERE ap.AppointmentID = a.AppointmentID) AS Services
      FROM Appointments a
      LEFT JOIN Users u ON a.UserID = u.UserID
      LEFT JOIN Vehicles v ON a.VehicleID = v.VehicleID
    `;
    if (!isAdmin) query += ' WHERE a.UserID = ?';
    query += ' ORDER BY a.AppointmentDate DESC';

    const [appointments] = isAdmin ? await pool.query(query) : await pool.query(query, [userId]);
    res.json({ success: true, appointments });
  } catch (err) {
    console.error('Error get appointments:', err);
    res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
  }
});


// Add more booking/detail/update routes as needed (copied from server.js earlier)...

// Root info
app.get('/', (req, res) => {
  res.json({
    name: 'SuaXe API',
    version: '1.0.0',
    frontend: 'https://suaxe-web-73744.web.app',
    endpoints: {
      auth: ['/api/auth/login', '/api/auth/register', '/api/auth/firebase'],
      services: ['/api/services'],
      booking: ['/api/booking/appointments'],
      images: ['/api/images/upload']
    }
  });
});

// Catch-all 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'API endpoint không tồn tại' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, message: 'Lỗi server: ' + (err.message || 'Unknown error') });
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});

module.exports = app;
