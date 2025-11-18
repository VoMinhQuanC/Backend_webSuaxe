// userRoutes.js - Routes cho chức năng quản lý người dùng
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { authenticateToken } = require('./authRoutes');

// Middleware kiểm tra quyền admin
const checkAdminAccess = (req, res, next) => {
    if (req.user.role !== 1) {
        return res.status(403).json({
            success: false,
            message: 'Không có quyền truy cập. Yêu cầu quyền admin.'
        });
    }
    next();
};

// API: Thống kê người dùng (chỉ admin)
router.get('/stats', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        // Tổng số người dùng
        const [totalUsersRow] = await pool.query('SELECT COUNT(*) as count FROM Users');
        
        // Tổng số khách hàng (RoleID = 2)
        const [totalCustomersRow] = await pool.query('SELECT COUNT(*) as count FROM Users WHERE RoleID = 2');
        
        // Tổng số thợ sửa xe (RoleID = 3)
        const [totalMechanicsRow] = await pool.query('SELECT COUNT(*) as count FROM Users WHERE RoleID = 3');
        
        // Tổng số admin (RoleID = 1)
        const [totalAdminsRow] = await pool.query('SELECT COUNT(*) as count FROM Users WHERE RoleID = 1');
        
        res.json({
            success: true,
            stats: {
                totalUsers: totalUsersRow[0].count,
                totalCustomers: totalCustomersRow[0].count,
                totalMechanics: totalMechanicsRow[0].count,
                totalAdmins: totalAdminsRow[0].count
            }
        });
    } catch (err) {
        console.error('Lỗi khi lấy thống kê người dùng:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

// API: Lấy danh sách người dùng (chỉ admin)
router.get('/', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        const { role, status, search } = req.query;
        
        // Xây dựng câu truy vấn với điều kiện lọc
        let query = 'SELECT UserID, FullName, Email, PhoneNumber, RoleID, Status, CreatedAt FROM Users';
        let queryParams = [];
        let conditions = [];
        
        // Thêm điều kiện lọc theo vai trò
        if (role) {
            conditions.push('RoleID = ?');
            queryParams.push(role);
        }
        
        // Thêm điều kiện lọc theo trạng thái
        if (status) {
            conditions.push('Status = ?');
            queryParams.push(status);
        }
        
        // Thêm điều kiện tìm kiếm
        if (search) {
            conditions.push('(FullName LIKE ? OR Email LIKE ? OR PhoneNumber LIKE ?)');
            const searchTerm = `%${search}%`;
            queryParams.push(searchTerm, searchTerm, searchTerm);
        }
        
        // Thêm các điều kiện vào câu truy vấn
        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        
        // Thêm sắp xếp
        query += ' ORDER BY CreatedAt DESC';
        
        // Thực hiện truy vấn
        const [users] = await pool.query(query, queryParams);
        
        res.json({
            success: true,
            users
        });
    } catch (err) {
        console.error('Lỗi khi lấy danh sách người dùng:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

// API: Lấy thông tin chi tiết người dùng (admin hoặc chính người dùng đó)
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        
        // Kiểm tra quyền truy cập: chỉ admin hoặc chính người dùng đó mới được xem
        if (req.user.role !== 1 && req.user.userId !== parseInt(userId)) {
            return res.status(403).json({
                success: false,
                message: 'Không có quyền truy cập thông tin người dùng này'
            });
        }
        
        // Lấy thông tin cơ bản của người dùng
        const [users] = await pool.query(
            'SELECT UserID, FullName, Email, PhoneNumber, RoleID, Status, CreatedAt FROM Users WHERE UserID = ?',
            [userId]
        );
        
        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng'
            });
        }
        
        const user = users[0];
        
        // Nếu là thợ sửa xe, lấy thêm thông tin từ MechanicInfo
        if (user.RoleID === 3) {
            const [mechanicInfo] = await pool.query(
                'SELECT MechanicName FROM MechanicInfo WHERE UserID = ?',
                [userId]
            );
            
            if (mechanicInfo.length > 0) {
                user.MechanicName = mechanicInfo[0].MechanicName || '';
            }
        }
        
        res.json({
            success: true,
            user
        });
    } catch (err) {
        console.error('Lỗi khi lấy thông tin người dùng:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

// API: Thêm người dùng mới (chỉ admin)
router.post('/', authenticateToken, checkAdminAccess, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const { fullName, email, phone, password, role, status, adminKey } = req.body;
        
        // Kiểm tra dữ liệu đầu vào
        if (!fullName || !email || !phone || !password || !role) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp đầy đủ thông tin'
            });
        }
        
        // Kiểm tra email đã tồn tại chưa
        const [existingUsers] = await connection.query('SELECT * FROM Users WHERE Email = ?', [email]);
        if (existingUsers.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Email đã được sử dụng'
            });
        }
        
        // Kiểm tra mã xác thực Admin nếu đang tạo tài khoản Admin
        const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || "admin123456";
        if (role === 1 && (!adminKey || adminKey !== ADMIN_SECRET_KEY)) {
            return res.status(403).json({
                success: false,
                message: 'Mã xác thực Admin không hợp lệ'
            });
        }
        
        // Mã hóa mật khẩu
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        
        // Thêm người dùng mới
        const [result] = await connection.query(
            'INSERT INTO Users (FullName, Email, PhoneNumber, PasswordHash, RoleID, Status) VALUES (?, ?, ?, ?, ?, ?)',
            [fullName, email, phone, hashedPassword, role, status || 1]
        );
        
        const userId = result.insertId;
        
        // Nếu là thợ sửa xe, thêm thông tin vào bảng MechanicInfo
        if (role === 3) {
            await connection.query(
                'INSERT INTO MechanicInfo (UserID, MechanicName) VALUES (?, ?)',
                [userId, fullName]
            );
        }
        
        await connection.commit();
        
        res.status(201).json({
            success: true,
            message: 'Thêm người dùng thành công',
            userId
        });
    } catch (err) {
        await connection.rollback();
        console.error('Lỗi khi thêm người dùng:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    } finally {
        connection.release();
    }
});

// API: Cập nhật thông tin người dùng (chỉ admin)
router.put('/:id', authenticateToken, checkAdminAccess, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const userId = req.params.id;
        const { fullName, email, phone, password, role, status } = req.body;
        
        // Kiểm tra người dùng có tồn tại không
        const [existingUser] = await connection.query('SELECT * FROM Users WHERE UserID = ?', [userId]);
        if (existingUser.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng'
            });
        }
        
        // Kiểm tra email đã tồn tại với người dùng khác chưa
        if (email !== existingUser[0].Email) {
            const [emailCheck] = await connection.query('SELECT * FROM Users WHERE Email = ? AND UserID != ?', [email, userId]);
            if (emailCheck.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Email đã được sử dụng bởi người dùng khác'
                });
            }
        }
        
        // Cập nhật thông tin cơ bản của người dùng
        await connection.query(
            'UPDATE Users SET FullName = ?, Email = ?, PhoneNumber = ?, RoleID = ?, Status = ? WHERE UserID = ?',
            [fullName, email, phone, role, status || existingUser[0].Status, userId]
        );
        
        // Cập nhật mật khẩu nếu có
        if (password) {
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(password, saltRounds);
            
            await connection.query(
                'UPDATE Users SET PasswordHash = ? WHERE UserID = ?',
                [hashedPassword, userId]
            );
        }
        
        // Nếu là thợ sửa xe, cập nhật thông tin trong bảng MechanicInfo
        if (role === 3) {
            // Kiểm tra xem đã có thông tin trong bảng MechanicInfo chưa
            const [mechanicInfoCheck] = await connection.query(
                'SELECT * FROM MechanicInfo WHERE UserID = ?',
                [userId]
            );
            
            if (mechanicInfoCheck.length > 0) {
                // Cập nhật thông tin hiện có
                await connection.query(
                    'UPDATE MechanicInfo SET MechanicName = ? WHERE UserID = ?',
                    [fullName, userId]
                );
            } else {
                // Thêm mới thông tin
                await connection.query(
                    'INSERT INTO MechanicInfo (UserID, MechanicName) VALUES (?, ?)',
                    [userId, fullName]
                );
            }
        }
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Cập nhật thông tin người dùng thành công'
        });
    } catch (err) {
        await connection.rollback();
        console.error('Lỗi khi cập nhật thông tin người dùng:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    } finally {
        connection.release();
    }
});

// API: Đổi mật khẩu người dùng (chỉ admin)
router.post('/:id/change-password', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        const userId = req.params.id;
        const { newPassword } = req.body;
        
        // Kiểm tra dữ liệu đầu vào
        if (!newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp mật khẩu mới'
            });
        }
        
        // Kiểm tra người dùng có tồn tại không
        const [existingUser] = await pool.query('SELECT * FROM Users WHERE UserID = ?', [userId]);
        if (existingUser.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng'
            });
        }
        
        // Mã hóa mật khẩu mới
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        
        // Cập nhật mật khẩu
        await pool.query(
            'UPDATE Users SET PasswordHash = ? WHERE UserID = ?',
            [hashedPassword, userId]
        );
        
        res.json({
            success: true,
            message: 'Đổi mật khẩu thành công'
        });
    } catch (err) {
        console.error('Lỗi khi đổi mật khẩu:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

// API: Xóa người dùng (chỉ admin)
router.delete('/:id', authenticateToken, checkAdminAccess, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const userId = req.params.id;
        
        // Kiểm tra người dùng có tồn tại không
        const [existingUser] = await connection.query('SELECT * FROM Users WHERE UserID = ?', [userId]);
        if (existingUser.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng'
            });
        }
        
        // Kiểm tra không cho phép xóa tài khoản admin cuối cùng
        if (existingUser[0].RoleID === 1) {
            const [adminCount] = await connection.query('SELECT COUNT(*) as count FROM Users WHERE RoleID = 1');
            if (adminCount[0].count <= 1) {
                return res.status(400).json({
                    success: false,
                    message: 'Không thể xóa tài khoản admin cuối cùng trong hệ thống'
                });
            }
        }
        
        // Xóa thông tin liên quan trong các bảng khác trước
        // Xóa thông tin kỹ thuật viên nếu là thợ sửa xe
        if (existingUser[0].RoleID === 3) {
            await connection.query('DELETE FROM MechanicInfo WHERE UserID = ?', [userId]);
        }
        
        // Xóa thông tin xe của người dùng
        await connection.query('DELETE FROM Vehicles WHERE UserID = ?', [userId]);
        
        // Xóa lịch hẹn của người dùng (hoặc có thể đặt trạng thái hủy thay vì xóa)
        await connection.query('UPDATE Appointments SET Status = "Canceled" WHERE UserID = ?', [userId]);
        
        // Xóa người dùng
        await connection.query('DELETE FROM Users WHERE UserID = ?', [userId]);
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Xóa người dùng thành công'
        });
    } catch (err) {
        await connection.rollback();
        console.error('Lỗi khi xóa người dùng:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    } finally {
        connection.release();
    }
});

module.exports = router;