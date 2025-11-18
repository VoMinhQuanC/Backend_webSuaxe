// auth0Routes.js - Xử lý các route liên quan đến Auth0 và đăng nhập bằng Google
const express = require('express');
const router = express.Router();
const passport = require('passport');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const auth0Config = require('../auth0Config');

// Kết nối database
const pool = require('../db').pool;

// JWT Secret key
const JWT_SECRET = process.env.JWT_SECRET || 'sua_xe_secret_key';

// Đăng nhập với Auth0/Google
router.get('/login', (req, res, next) => {
  const connection = req.query.connection;
  
  const authOptions = {
    scope: 'openid email profile'
  };
  
  // Nếu có connection được chỉ định (ví dụ: google-oauth2)
  if (connection) {
    authOptions.connection = connection;
  }
  
  passport.authenticate('auth0', authOptions)(req, res, next);
});

// Callback route sau khi xác thực Auth0/Google
router.get('/callback', passport.authenticate('auth0', { 
  failureRedirect: '/login.html?error=auth0_failed' 
}), async (req, res) => {
  try {
    if (!req.user) {
      return res.redirect('/login.html?error=no_user');
    }

    // Log thông tin user để debug
    console.log('Auth0 user profile:', JSON.stringify(req.user, null, 2));

    // Lấy thông tin từ Auth0/Google user profile
    const auth0Id = req.user.id;
    
    // Lấy email từ user profile - xử lý cả trường hợp Google và Auth0
    let email = null;
    if (req.user.emails && req.user.emails.length > 0) {
      email = req.user.emails[0].value;
    } else if (req.user._json && req.user._json.email) {
      email = req.user._json.email;
    }

    // Lấy tên từ user profile - ưu tiên displayName
    const name = req.user.displayName || 
                (req.user.name ? `${req.user.name.givenName} ${req.user.name.familyName}` : 'Người dùng mới');
    
    // Lấy avatar - từ Google hoặc Auth0
    let picture = null;
    if (req.user.photos && req.user.photos.length > 0) {
      picture = req.user.photos[0].value;
    } else if (req.user._json && req.user._json.picture) {
      picture = req.user._json.picture;
    }
    
    if (!email) {
      console.error('Auth0/Google không trả về email');
      return res.redirect('/login.html?error=no_email');
    }

    // Kiểm tra provider (Google hoặc Auth0)
    const provider = req.user.provider || 
                    (req.user._json && req.user._json.sub && req.user._json.sub.includes('google') ? 'google' : 'auth0');
    
    console.log(`Người dùng đăng nhập qua ${provider} với email: ${email}`);

    // Kiểm tra nếu người dùng đã tồn tại trong DB (dựa trên email)
    const [users] = await pool.query('SELECT * FROM Users WHERE Email = ?', [email]);
    let userId, userRole, userName, userPhone;

    if (users.length === 0) {
      // Người dùng chưa tồn tại, tạo người dùng mới
      console.log('Đang tạo người dùng mới với email:', email);
      
      // Tạo mật khẩu ngẫu nhiên cho tài khoản mới
      const randomPassword = Math.random().toString(36).substring(2, 15);
      const hashedPassword = await bcrypt.hash(randomPassword, 10);
      
      // Thêm người dùng vào DB với RoleID = 2 (Khách hàng)
      const [result] = await pool.query(
        'INSERT INTO Users (FullName, Email, PhoneNumber, PasswordHash, RoleID, Auth0ID, AvatarUrl, Provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [name, email, '', hashedPassword, 2, auth0Id, picture, provider]
      );
      
      userId = result.insertId;
      userRole = 2;
      userName = name;
      userPhone = '';
    } else {
      // Người dùng đã tồn tại
      userId = users[0].UserID;
      userRole = users[0].RoleID;
      userName = users[0].FullName;
      userPhone = users[0].PhoneNumber || '';
      
      // Cập nhật Auth0ID và Provider nếu chưa có
      if (!users[0].Auth0ID || !users[0].Provider) {
        await pool.query(
          'UPDATE Users SET Auth0ID = ?, Provider = ?, AvatarUrl = ? WHERE UserID = ?',
          [auth0Id, provider, picture || users[0].AvatarUrl, userId]
        );
      }
    }

    // Tạo JWT token
    const token = jwt.sign(
      {
        userId: userId,
        email: email,
        role: userRole
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Tạo đối tượng user
    const userInfo = {
      id: userId,
      fullName: userName,
      email: email,
      phoneNumber: userPhone,
      role: userRole,
      avatarUrl: picture
    };

    // Chuyển hướng đến trang xử lý đăng nhập thành công
    res.redirect(`/auth-success.html?token=${token}&user=${encodeURIComponent(JSON.stringify(userInfo))}`);
  } catch (error) {
    console.error('Auth0/Google callback error:', error);
    res.redirect('/login.html?error=auth_error&message=' + encodeURIComponent(error.message));
  }
});

// Đăng xuất
router.get('/logout', (req, res) => {
  req.logout(function(err) {
    if (err) { 
      console.error('Lỗi đăng xuất:', err);
      return res.redirect('/'); 
    }
    
    // Xóa session
    req.session.destroy();
    
    // Redirect về Auth0 logout URL để đăng xuất hoàn toàn
    const returnTo = encodeURIComponent(`${auth0Config.baseURL}/login.html`);
    res.redirect(`https://${auth0Config.issuerBaseURL.replace('https://', '')}/v2/logout?client_id=${auth0Config.clientID}&returnTo=${returnTo}`);
  });
});

// Test route để kiểm tra thông tin user từ Auth0/Google
router.get('/profile', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      success: true,
      user: req.user
    });
  } else {
    res.status(401).json({
      success: false,
      message: 'Không có thông tin xác thực'
    });
  }
});

module.exports = router;