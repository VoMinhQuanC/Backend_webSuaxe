// authRoutes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');

// Khóa bí mật cho JWT
const JWT_SECRET = process.env.JWT_SECRET || 'sua_xe_secret_key';

// Khóa bí mật để xác thực mã Admin - Không nên hard-code trong production
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || "admin123456"; 

// API Đăng ký
router.post('/register', async (req, res) => {
    try {
        const { fullName, email, phone, password, role, adminKey } = req.body;

        // Kiểm tra dữ liệu nhập vào
        if (!fullName || !email || !password || !phone) {
            return res.status(400).json({ 
                success: false, 
                message: 'Vui lòng nhập đầy đủ thông tin' 
            });
        }

        // Kiểm tra email đã tồn tại chưa
        const [existingUsers] = await pool.query('SELECT * FROM Users WHERE Email = ?', [email]);
        if (existingUsers.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email đã được sử dụng' 
            });
        }

        // Xác định role (mặc định là khách hàng - role 2)
        let userRole = 2; // Customer by default
        
        // Nếu đăng ký là Admin, phải kiểm tra mã xác thực Admin
        if (role === 1) {
            // Kiểm tra mã admin
            if (!adminKey || adminKey !== ADMIN_SECRET_KEY) {
                return res.status(403).json({
                    success: false,
                    message: 'Mã xác thực Admin không hợp lệ'
                });
            }
            userRole = 1; // Admin role
        }

        // Mã hóa mật khẩu
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Lưu người dùng mới vào cơ sở dữ liệu - phải dùng PhoneNumber và PasswordHash
        const [result] = await pool.query(
            'INSERT INTO Users (FullName, Email, PhoneNumber, PasswordHash, RoleID) VALUES (?, ?, ?, ?, ?)',
            [fullName, email, phone, hashedPassword, userRole]
        );

        res.status(201).json({ 
            success: true, 
            message: userRole === 1 ? 'Đăng ký tài khoản Admin thành công' : 'Đăng ký thành công' 
        });
    } catch (error) {
        console.error('Lỗi khi đăng ký:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Lỗi server: ' + error.message 
        });
    }
});

// API Đăng nhập
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Kiểm tra dữ liệu nhập vào
        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Vui lòng nhập email và mật khẩu' 
            });
        }

        // Tìm người dùng theo email
        const [users] = await pool.query('SELECT * FROM Users WHERE Email = ?', [email]);
        if (users.length === 0) {
            return res.status(401).json({ 
                success: false, 
                message: 'Email hoặc mật khẩu không đúng' 
            });
        }

        const user = users[0];

        // Kiểm tra mật khẩu với PasswordHash
        const passwordMatch = await bcrypt.compare(password, user.PasswordHash);
        if (!passwordMatch) {
            return res.status(401).json({ 
                success: false, 
                message: 'Email hoặc mật khẩu không đúng' 
            });
        }
        
        // Tạo token JWT
        const token = jwt.sign(
            { 
                userId: user.UserID, 
                email: user.Email,
                role: user.RoleID 
            }, 
            JWT_SECRET, 
            { expiresIn: '24h' }
        );

        // Tạo phản hồi người dùng cơ bản
        const userResponse = {
            id: user.UserID,
            fullName: user.FullName,      // ✅ Thêm fullName (camelCase)
            name: user.FullName,          // ✅ Thêm name (Flutter tìm field này)
            FullName: user.FullName,
            email: user.Email,
            phone: user.PhoneNumber,
            role: user.RoleID
        };

        // Xử lý khi người dùng là kỹ thuật viên (thêm thông tin kỹ thuật viên)
        if (user.RoleID === 3) {
            try {
                // Lấy thông tin kỹ thuật viên
                const [mechanicInfoRows] = await pool.query(
                    'SELECT * FROM MechanicInfo WHERE UserID = ?', 
                    [user.UserID]
                );
                
                if (mechanicInfoRows.length > 0) {
                    // Thêm thông tin kỹ thuật viên vào đối tượng user
                    userResponse.mechanicInfo = {
                        mechanicId: mechanicInfoRows[0].MechanicID,
                        specialization: mechanicInfoRows[0].Specialization,
                        experience: mechanicInfoRows[0].Experience
                    };
                }
                
                // Lấy thống kê của kỹ thuật viên
                const [reviewStats] = await pool.query(
                    'SELECT AVG(Rating) as averageRating, COUNT(*) as reviewCount FROM MechanicReviews WHERE MechanicID = ?',
                    [user.UserID]
                );
                
                const [appointmentStats] = await pool.query(
                    'SELECT COUNT(*) as total, SUM(CASE WHEN Status = "Completed" THEN 1 ELSE 0 END) as completed FROM Appointments WHERE MechanicID = ?',
                    [user.UserID]
                );
                
                // Thêm thống kê vào đối tượng user
                userResponse.stats = {
                    averageRating: reviewStats[0].averageRating || 0,
                    reviewCount: reviewStats[0].reviewCount || 0,
                    totalAppointments: appointmentStats[0].total || 0,
                    completedAppointments: appointmentStats[0].completed || 0
                };
            } catch (error) {
                console.error('Lỗi khi lấy thông tin kỹ thuật viên:', error);
                // Không cần throw lỗi, vẫn tiếp tục đăng nhập bình thường
            }
        }

        // Trả về thông tin người dùng và token
        res.json({
            success: true,
            message: 'Đăng nhập thành công',
            token,
            user: userResponse
        });
    } catch (error) {
        console.error('Lỗi khi đăng nhập:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Lỗi server: ' + error.message 
        });
    }
});

// Middleware xác thực JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ 
            success: false, 
            message: 'Không có token xác thực' 
        });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ 
                success: false, 
                message: 'Token không hợp lệ hoặc đã hết hạn' 
            });
        }
        req.user = user;
        next();
    });
};

// API Kiểm tra xác thực
router.get('/check-auth', authenticateToken, (req, res) => {
    try {
        // Nếu middleware authenticateToken đã pass, tức là token hợp lệ
        res.json({
            success: true,
            user: {
                userId: req.user.userId,
                email: req.user.email,
                role: req.user.role
            }
        });
    } catch (error) {
        console.error('Lỗi khi kiểm tra xác thực:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Lỗi server: ' + error.message 
        });
    }
});


// API Lấy thông tin người dùng hiện tại
router.get('/me', authenticateToken, async (req, res) => {
    try {
        // Chỉnh sửa câu truy vấn để bổ sung thêm các trường cần thiết
        const [users] = await pool.query(
            'SELECT UserID, FullName, Email, PhoneNumber, RoleID, ProfilePicture, AvatarUrl, Status, CreatedAt FROM Users WHERE UserID = ?', 
            [req.user.userId]
        );
        
        if (users.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Không tìm thấy thông tin người dùng' 
            });
        }

        const userData = users[0];

        // Nếu là kỹ thuật viên, lấy thêm thông tin
        if (userData.RoleID === 3) {
            try {
                // Lấy thông tin kỹ thuật viên
                const [mechanicInfoRows] = await pool.query(
                    'SELECT * FROM MechanicInfo WHERE UserID = ?',
                    [userData.UserID]
                );
                
                if (mechanicInfoRows.length > 0) {
                    // Thêm thông tin kỹ thuật viên vào đối tượng user
                    userData.mechanicInfo = {
                        mechanicId: mechanicInfoRows[0].MechanicID,
                        specialization: mechanicInfoRows[0].Specialization,
                        experience: mechanicInfoRows[0].Experience
                    };
                }
                
                // Lấy thống kê của kỹ thuật viên
                const [reviewStats] = await pool.query(
                    'SELECT AVG(Rating) as averageRating, COUNT(*) as reviewCount FROM MechanicReviews WHERE MechanicID = ?',
                    [userData.UserID]
                );
                
                const [appointmentStats] = await pool.query(
                    'SELECT COUNT(*) as total, SUM(CASE WHEN Status = "Completed" THEN 1 ELSE 0 END) as completed FROM Appointments WHERE MechanicID = ?',
                    [userData.UserID]
                );
                
                // Thêm thống kê vào đối tượng user
                userData.stats = {
                    averageRating: reviewStats[0].averageRating || 0,
                    reviewCount: reviewStats[0].reviewCount || 0,
                    totalAppointments: appointmentStats[0].total || 0,
                    completedAppointments: appointmentStats[0].completed || 0
                };
            } catch (error) {
                console.error('Lỗi khi lấy thông tin kỹ thuật viên:', error);
                // Không cần throw lỗi, vẫn tiếp tục
            }
        }

        res.json({
            success: true,
            user: userData
        });
    } catch (error) {
        console.error('Lỗi khi lấy thông tin người dùng:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Lỗi server: ' + error.message 
        });
    }
});

module.exports = { router, authenticateToken };