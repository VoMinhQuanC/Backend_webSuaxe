const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('./authRoutes');
const bcrypt = require('bcrypt');

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

// Middleware kiểm tra quyền kỹ thuật viên
const checkMechanicAccess = (req, res, next) => {
    if (req.user.role !== 3) {
        return res.status(403).json({
            success: false,
            message: 'Không có quyền truy cập. Yêu cầu quyền kỹ thuật viên.'
        });
    }
    next();
};

/**
 * @api {get} /api/mechanics Lấy danh sách kỹ thuật viên
 * @apiDescription Lấy danh sách tất cả kỹ thuật viên (admin only)
 * @apiName GetMechanics
 * @apiGroup Mechanics
 * 
 * @apiHeader {String} Authorization Bearer token
 * 
 * @apiSuccess {Boolean} success Trạng thái thành công
 * @apiSuccess {Array} mechanics Danh sách kỹ thuật viên
 */
router.get('/', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        // Lấy danh sách kỹ thuật viên với thông tin bổ sung
        const [mechanics] = await pool.query(`
            SELECT u.*, 
                   (SELECT COUNT(*) FROM Appointments WHERE MechanicID = u.UserID AND Status = 'Completed') as CompletedAppointments,
                   (SELECT COUNT(*) FROM Reviews WHERE MechanicID = u.UserID) as ReviewCount,
                   (SELECT AVG(Rating) FROM Reviews WHERE MechanicID = u.UserID) as Rating
            FROM Users u
            LEFT JOIN MechanicInfo mi ON u.UserID = mi.UserID
            WHERE u.RoleID = 3
            ORDER BY u.FullName
        `);
        
        res.json({
            success: true,
            mechanics
        });
    } catch (err) {
        console.error('Lỗi khi lấy danh sách kỹ thuật viên:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

/**
 * @api {get} /api/mechanics/stats Lấy thống kê kỹ thuật viên
 * @apiDescription Lấy thống kê tổng quan về kỹ thuật viên (admin only)
 * @apiName GetMechanicsStats
 * @apiGroup Mechanics
 * 
 * @apiHeader {String} Authorization Bearer token
 * 
 * @apiSuccess {Boolean} success Trạng thái thành công
 * @apiSuccess {Object} stats Thống kê tổng quan
 */
router.get('/stats', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        // Đếm tổng số kỹ thuật viên
        const [totalMechanicsResult] = await pool.query(`
            SELECT COUNT(*) as count FROM Users WHERE RoleID = 3
        `);
        
        // Đếm tổng số lịch hẹn hoàn thành
        const [completedAppointmentsResult] = await pool.query(`
            SELECT COUNT(*) as count 
            FROM Appointments 
            WHERE Status = 'Completed' AND MechanicID IS NOT NULL
        `);
        
        // Tính đánh giá trung bình
        const [averageRatingResult] = await pool.query(`
            SELECT AVG(Rating) as avgRating FROM Reviews
        `);
        
        res.json({
            success: true,
            stats: {
                totalMechanics: totalMechanicsResult[0].count,
                completedAppointments: completedAppointmentsResult[0].count,
                averageRating: averageRatingResult[0].avgRating || 0
            }
        });
    } catch (err) {
        console.error('Lỗi khi lấy thống kê kỹ thuật viên:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

/**
 * @api {get} /api/mechanics/:id Lấy thông tin chi tiết kỹ thuật viên
 * @apiDescription Lấy thông tin chi tiết của một kỹ thuật viên (admin only)
 * @apiName GetMechanicDetail
 * @apiGroup Mechanics
 * 
 * @apiParam {Number} id ID kỹ thuật viên
 * 
 * @apiHeader {String} Authorization Bearer token
 * 
 * @apiSuccess {Boolean} success Trạng thái thành công
 * @apiSuccess {Object} mechanic Thông tin chi tiết kỹ thuật viên
 */
router.get('/:id', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        const mechanicId = req.params.id;
        
        // Lấy thông tin chi tiết kỹ thuật viên
        const [mechanicRows] = await pool.query(`
            SELECT u.*, mi.Specialization, mi.Experience, mi.Certifications, mi.Notes,
                   (SELECT COUNT(*) FROM Appointments WHERE MechanicID = u.UserID AND Status = 'Completed') as CompletedAppointments,
                   (SELECT COUNT(*) FROM Appointments WHERE MechanicID = u.UserID AND Status = 'Pending') as PendingAppointments,
                   (SELECT COUNT(*) FROM Reviews WHERE MechanicID = u.UserID) as ReviewCount,
                   (SELECT AVG(Rating) FROM Reviews WHERE MechanicID = u.UserID) as Rating
            FROM Users u
            LEFT JOIN MechanicInfo mi ON u.UserID = mi.UserID
            WHERE u.UserID = ? AND u.RoleID = 3
        `, [mechanicId]);
        
        if (mechanicRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy kỹ thuật viên'
            });
        }
        
        const mechanic = mechanicRows[0];
        
        // Chuyển đổi Certifications từ chuỗi sang mảng
        if (mechanic.Certifications) {
            try {
                mechanic.Certifications = JSON.parse(mechanic.Certifications);
            } catch (e) {
                // Nếu không phải JSON, chuyển thành mảng
                mechanic.Certifications = mechanic.Certifications.split(',')
                    .map(cert => cert.trim())
                    .filter(cert => cert);
            }
        } else {
            mechanic.Certifications = [];
        }
        
        res.json({
            success: true,
            mechanic
        });
    } catch (err) {
        console.error('Lỗi khi lấy thông tin kỹ thuật viên:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

/**
 * @api {post} /api/mechanics Thêm kỹ thuật viên mới
 * @apiDescription Thêm một kỹ thuật viên mới (admin only)
 * @apiName AddMechanic
 * @apiGroup Mechanics
 * 
 * @apiHeader {String} Authorization Bearer token
 * 
 * @apiBody {String} fullName Tên kỹ thuật viên
 * @apiBody {String} email Email
 * @apiBody {String} phone Số điện thoại
 * @apiBody {String} password Mật khẩu
 * @apiBody {Number} status Trạng thái (1: Hoạt động, 0: Không hoạt động)
 * @apiBody {String} [specialization] Chuyên môn
 * @apiBody {Number} [experience] Số năm kinh nghiệm
 * @apiBody {Array} [certifications] Danh sách chứng chỉ
 * @apiBody {String} [notes] Ghi chú
 * @apiBody {String} [profilePicture] Ảnh đại diện (Base64)
 * 
 * @apiSuccess {Boolean} success Trạng thái thành công
 * @apiSuccess {Number} mechanicId ID của kỹ thuật viên mới
 * @apiSuccess {String} message Thông báo kết quả
 */
router.post('/', authenticateToken, checkAdminAccess, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const { 
            fullName, email, phone, password, status, 
            specialization, experience, certifications, notes, profilePicture 
        } = req.body;
        
        // Kiểm tra dữ liệu đầu vào
        if (!fullName || !email || !phone || !password) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp đầy đủ thông tin cơ bản'
            });
        }
        
        // Kiểm tra email đã tồn tại chưa
        const [existingUsers] = await connection.query(
            'SELECT UserID FROM Users WHERE Email = ?', 
            [email]
        );
        
        if (existingUsers.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Email đã được sử dụng bởi tài khoản khác'
            });
        }
        
        // Mã hóa mật khẩu
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        
        // Chuyển đổi certifications thành chuỗi JSON
        const certificationsJson = certifications ? JSON.stringify(certifications) : null;
        
        // Lưu ảnh đại diện (nếu có)
        let profilePicPath = null;
        if (profilePicture && profilePicture.startsWith('data:image')) {
            // Xử lý lưu ảnh Base64 vào thư mục và trả về đường dẫn
            // Trong môi trường thực tế, cần sử dụng một hàm riêng để xử lý việc lưu ảnh
            // Dưới đây chỉ là giả định
            profilePicPath = await saveProfileImage(profilePicture, email);
        }
        
        // Thêm người dùng mới với role là kỹ thuật viên (RoleID = 3)
        const [userResult] = await connection.query(
            'INSERT INTO Users (FullName, Email, PhoneNumber, PasswordHash, RoleID, Status, ProfilePicture) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [fullName, email, phone, hashedPassword, 3, status || 1, profilePicPath]
        );
        
        const userId = userResult.insertId;
        
        // Thêm thông tin kỹ thuật viên
        await connection.query(
            'INSERT INTO MechanicInfo (UserID, MechanicName, Specialization, Experience, Certifications, Notes) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, fullName, specialization || null, experience || null, certificationsJson, notes || null]
        );
        
        await connection.commit();
        
        res.status(201).json({
            success: true,
            mechanicId: userId,
            message: 'Thêm kỹ thuật viên mới thành công'
        });
    } catch (err) {
        await connection.rollback();
        console.error('Lỗi khi thêm kỹ thuật viên:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    } finally {
        connection.release();
    }
});

/**
 * @api {put} /api/mechanics/:id Cập nhật thông tin kỹ thuật viên
 * @apiDescription Cập nhật thông tin của một kỹ thuật viên (admin only)
 * @apiName UpdateMechanic
 * @apiGroup Mechanics
 * 
 * @apiParam {Number} id ID kỹ thuật viên
 * 
 * @apiHeader {String} Authorization Bearer token
 * 
 * @apiBody {String} fullName Tên kỹ thuật viên
 * @apiBody {String} email Email
 * @apiBody {String} phone Số điện thoại
 * @apiBody {String} [password] Mật khẩu mới (nếu muốn thay đổi)
 * @apiBody {Number} status Trạng thái (1: Hoạt động, 0: Không hoạt động)
 * @apiBody {String} [specialization] Chuyên môn
 * @apiBody {Number} [experience] Số năm kinh nghiệm
 * @apiBody {Array} [certifications] Danh sách chứng chỉ
 * @apiBody {String} [notes] Ghi chú
 * @apiBody {String} [profilePicture] Ảnh đại diện (Base64)
 * 
 * @apiSuccess {Boolean} success Trạng thái thành công
 * @apiSuccess {String} message Thông báo kết quả
 */
router.put('/:id', authenticateToken, checkAdminAccess, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const mechanicId = req.params.id;
        const { 
            fullName, email, phone, password, status, 
            specialization, experience, certifications, notes, profilePicture 
        } = req.body;
        
        // Kiểm tra dữ liệu đầu vào
        if (!fullName || !email || !phone) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp đầy đủ thông tin cơ bản'
            });
        }
        
        // Kiểm tra kỹ thuật viên có tồn tại không
        const [mechanicCheck] = await connection.query(
            'SELECT UserID FROM Users WHERE UserID = ? AND RoleID = 3', 
            [mechanicId]
        );
        
        if (mechanicCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy kỹ thuật viên'
            });
        }
        
        // Kiểm tra email đã tồn tại với tài khoản khác chưa
        const [emailCheck] = await connection.query(
            'SELECT UserID FROM Users WHERE Email = ? AND UserID != ?', 
            [email, mechanicId]
        );
        
        if (emailCheck.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Email đã được sử dụng bởi tài khoản khác'
            });
        }
        
        // Chuyển đổi certifications thành chuỗi JSON
        const certificationsJson = certifications ? JSON.stringify(certifications) : null;
        
        // Lưu ảnh đại diện mới (nếu có)
        let profilePicPath = null;
        if (profilePicture && profilePicture.startsWith('data:image')) {
            // Xử lý lưu ảnh Base64 vào thư mục và trả về đường dẫn
            profilePicPath = await saveProfileImage(profilePicture, email);
        }
        
        // Cập nhật thông tin người dùng
        let query = 'UPDATE Users SET FullName = ?, Email = ?, PhoneNumber = ?, Status = ?';
        let params = [fullName, email, phone, status];
        
        // Nếu có mật khẩu mới, cập nhật mật khẩu
        if (password) {
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(password, saltRounds);
            query += ', PasswordHash = ?';
            params.push(hashedPassword);
        }
        
        // Nếu có ảnh mới, cập nhật ảnh
        if (profilePicPath) {
            query += ', ProfilePicture = ?';
            params.push(profilePicPath);
        }
        
        query += ' WHERE UserID = ?';
        params.push(mechanicId);
        
        await connection.query(query, params);
        
        // Kiểm tra xem đã có thông tin kỹ thuật viên chưa
        const [mechanicInfoCheck] = await connection.query(
            'SELECT MechanicInfoID FROM MechanicInfo WHERE UserID = ?', 
            [mechanicId]
        );
        
        if (mechanicInfoCheck.length > 0) {
            // Cập nhật thông tin kỹ thuật viên
            await connection.query(
                'UPDATE MechanicInfo SET MechanicName = ?, Specialization = ?, Experience = ?, Certifications = ?, Notes = ? WHERE UserID = ?',
                [fullName, specialization || null, experience || null, certificationsJson, notes || null, mechanicId]
            );
        } else {
            // Thêm mới thông tin kỹ thuật viên
            await connection.query(
                'INSERT INTO MechanicInfo (UserID, MechanicName, Specialization, Experience, Certifications, Notes) VALUES (?, ?, ?, ?, ?, ?)',
                [mechanicId, fullName, specialization || null, experience || null, certificationsJson, notes || null]
            );
        }
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Cập nhật thông tin kỹ thuật viên thành công'
        });
    } catch (err) {
        await connection.rollback();
        console.error('Lỗi khi cập nhật thông tin kỹ thuật viên:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    } finally {
        connection.release();
    }
});

/**
 * @api {delete} /api/mechanics/:id Xóa kỹ thuật viên
 * @apiDescription Xóa một kỹ thuật viên (admin only)
 * @apiName DeleteMechanic
 * @apiGroup Mechanics
 * 
 * @apiParam {Number} id ID kỹ thuật viên
 * 
 * @apiHeader {String} Authorization Bearer token
 * 
 * @apiSuccess {Boolean} success Trạng thái thành công
 * @apiSuccess {String} message Thông báo kết quả
 */
router.delete('/:id', authenticateToken, checkAdminAccess, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const mechanicId = req.params.id;
        
        // Kiểm tra kỹ thuật viên có tồn tại không
        const [mechanicCheck] = await connection.query(
            'SELECT UserID FROM Users WHERE UserID = ? AND RoleID = 3', 
            [mechanicId]
        );
        
        if (mechanicCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy kỹ thuật viên'
            });
        }
        
        // Kiểm tra xem kỹ thuật viên có đang được gán cho lịch hẹn nào không
        const [appointmentsCheck] = await connection.query(
            'SELECT COUNT(*) as count FROM Appointments WHERE MechanicID = ? AND Status IN ("Pending", "Confirmed")', 
            [mechanicId]
        );
        
        if (appointmentsCheck[0].count > 0) {
            return res.status(400).json({
                success: false,
                message: 'Không thể xóa kỹ thuật viên đang có lịch hẹn chưa hoàn thành'
            });
        }
        
        // Xóa thông tin kỹ thuật viên
        await connection.query(
            'DELETE FROM MechanicInfo WHERE UserID = ?', 
            [mechanicId]
        );
        
        // Xóa lịch làm việc của kỹ thuật viên
        await connection.query(
            'DELETE FROM StaffSchedule WHERE MechanicID = ?', 
            [mechanicId]
        );
        
        // Xóa người dùng
        await connection.query(
            'DELETE FROM Users WHERE UserID = ?', 
            [mechanicId]
        );
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Xóa kỹ thuật viên thành công'
        });
    } catch (err) {
        await connection.rollback();
        console.error('Lỗi khi xóa kỹ thuật viên:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    } finally {
        connection.release();
    }
});

/**
 * @api {get} /api/mechanics/:id/appointments Lấy lịch hẹn của kỹ thuật viên
 * @apiDescription Lấy danh sách lịch hẹn của một kỹ thuật viên (admin only)
 * @apiName GetMechanicAppointments
 * @apiGroup Mechanics
 * 
 * @apiParam {Number} id ID kỹ thuật viên
 * @apiParam {String} [status] Lọc theo trạng thái
 * 
 * @apiHeader {String} Authorization Bearer token
 * 
 * @apiSuccess {Boolean} success Trạng thái thành công
 * @apiSuccess {Array} appointments Danh sách lịch hẹn
 */
router.get('/:id/appointments', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        const mechanicId = req.params.id;
        const status = req.query.status;
        
        // Tạo điều kiện lọc theo trạng thái
        let statusCondition = '';
        let params = [mechanicId];
        
        if (status) {
            statusCondition = 'AND a.Status = ?';
            params.push(status);
        }
        
        // Lấy danh sách lịch hẹn
        const [appointments] = await pool.query(`
            SELECT a.*, 
                   u.FullName, u.PhoneNumber, u.Email,
                   v.LicensePlate, v.Brand, v.Model,
                   (SELECT GROUP_CONCAT(s.ServiceName SEPARATOR ', ') 
                    FROM AppointmentServices aps 
                    JOIN Services s ON aps.ServiceID = s.ServiceID 
                    WHERE aps.AppointmentID = a.AppointmentID) AS Services
            FROM Appointments a
            LEFT JOIN Users u ON a.UserID = u.UserID
            LEFT JOIN Vehicles v ON a.VehicleID = v.VehicleID
            WHERE a.MechanicID = ? ${statusCondition}
            ORDER BY a.AppointmentDate DESC
        `, params);
        
        res.json({
            success: true,
            appointments
        });
    } catch (err) {
        console.error('Lỗi khi lấy lịch hẹn của kỹ thuật viên:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

/**
 * @api {get} /api/mechanics/:id/reviews Lấy đánh giá của kỹ thuật viên
 * @apiDescription Lấy danh sách đánh giá về một kỹ thuật viên
 * @apiName GetMechanicReviews
 * @apiGroup Mechanics
 * 
 * @apiParam {Number} id ID kỹ thuật viên
 * 
 * @apiSuccess {Boolean} success Trạng thái thành công
 * @apiSuccess {Array} reviews Danh sách đánh giá
 */
router.get('/:id/reviews', async (req, res) => {
    try {
        const mechanicId = req.params.id;
        
        // Lấy danh sách đánh giá
        const [reviews] = await pool.query(`
            SELECT r.*, u.FullName, u.ProfilePicture
            FROM Reviews r
            JOIN Users u ON r.UserID = u.UserID
            WHERE r.MechanicID = ?
            ORDER BY r.CreatedAt DESC
        `, [mechanicId]);
        
        res.json({
            success: true,
            reviews
        });
    } catch (err) {
        console.error('Lỗi khi lấy đánh giá của kỹ thuật viên:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

/**
 * API: Lấy thông tin của kỹ thuật viên
 * GET /api/mechanics/me
 */
router.get('/me', authenticateToken, checkMechanicAccess, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        
        // Lấy thông tin cơ bản và thông tin chi tiết kỹ thuật viên
        const [mechanicInfo] = await pool.query(`
            SELECT u.*, mi.Specialization, mi.Experience, mi.Certifications,
                  (SELECT COUNT(*) FROM Appointments WHERE MechanicID = u.UserID AND Status = 'Completed') as CompletedAppointments,
                  (SELECT COUNT(*) FROM Appointments WHERE MechanicID = u.UserID AND Status IN ('Pending', 'Confirmed', 'InProgress')) as PendingAppointments,
                  (SELECT AVG(Rating) FROM Reviews WHERE MechanicID = u.UserID) as AverageRating,
                  (SELECT COUNT(*) FROM Reviews WHERE MechanicID = u.UserID) as ReviewCount
            FROM Users u
            LEFT JOIN MechanicInfo mi ON u.UserID = mi.UserID
            WHERE u.UserID = ?
        `, [mechanicId]);
        
        if (mechanicInfo.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy thông tin kỹ thuật viên'
            });
        }
        
        const mechanic = mechanicInfo[0];
        
        // Chuyển đổi Certifications từ chuỗi sang mảng
        if (mechanic.Certifications) {
            try {
                mechanic.Certifications = JSON.parse(mechanic.Certifications);
            } catch (e) {
                // Nếu không phải JSON, chuyển thành mảng
                mechanic.Certifications = mechanic.Certifications.split(',')
                    .map(cert => cert.trim())
                    .filter(cert => cert);
            }
        } else {
            mechanic.Certifications = [];
        }
        
        // Loại bỏ thông tin nhạy cảm như mật khẩu
        delete mechanic.PasswordHash;
        
        res.json({
            success: true,
            mechanic
        });
    } catch (err) {
        console.error('Lỗi khi lấy thông tin kỹ thuật viên:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

/**
 * API: Cập nhật thông tin cá nhân kỹ thuật viên
 * PUT /api/mechanics/me/profile
 */
router.put('/me/profile', authenticateToken, checkMechanicAccess, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const mechanicId = req.user.userId;
        const { fullName, phoneNumber, specialization, experience, certifications } = req.body;
        
        // Kiểm tra dữ liệu đầu vào
        if (!fullName) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp họ tên'
            });
        }
        
        // Chuyển đổi certifications thành chuỗi JSON
        const certificationsJson = certifications ? JSON.stringify(certifications) : null;
        
        // Cập nhật thông tin người dùng
        await connection.query(
            'UPDATE Users SET FullName = ?, PhoneNumber = ? WHERE UserID = ?',
            [fullName, phoneNumber || null, mechanicId]
        );
        
        // Kiểm tra xem có thông tin kỹ thuật viên chưa
        const [mechanicInfoCheck] = await connection.query(
            'SELECT * FROM MechanicInfo WHERE UserID = ?',
            [mechanicId]
        );
        
        if (mechanicInfoCheck.length > 0) {
            // Cập nhật thông tin kỹ thuật viên
            await connection.query(
                'UPDATE MechanicInfo SET MechanicName = ?, Specialization = ?, Experience = ?, Certifications = ? WHERE UserID = ?',
                [fullName, specialization || null, experience || null, certificationsJson, mechanicId]
            );
        } else {
            // Thêm mới thông tin kỹ thuật viên
            await connection.query(
                'INSERT INTO MechanicInfo (UserID, MechanicName, Specialization, Experience, Certifications) VALUES (?, ?, ?, ?, ?)',
                [mechanicId, fullName, specialization || null, experience || null, certificationsJson]
            );
        }
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Cập nhật thông tin cá nhân thành công'
        });
    } catch (err) {
        await connection.rollback();
        console.error('Lỗi khi cập nhật thông tin cá nhân:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    } finally {
        connection.release();
    }
});

/**
 * API: Đổi mật khẩu kỹ thuật viên
 * PUT /api/mechanics/me/change-password
 */
router.put('/me/change-password', authenticateToken, checkMechanicAccess, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        const { currentPassword, newPassword } = req.body;
        
        // Kiểm tra dữ liệu đầu vào
        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp mật khẩu hiện tại và mật khẩu mới'
            });
        }
        
        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Mật khẩu mới phải có ít nhất 6 ký tự'
            });
        }
        
        // Lấy thông tin người dùng
        const [userRows] = await pool.query(
            'SELECT PasswordHash FROM Users WHERE UserID = ?',
            [mechanicId]
        );
        
        if (userRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy thông tin người dùng'
            });
        }
        
        // Kiểm tra mật khẩu hiện tại
        const isPasswordValid = await bcrypt.compare(currentPassword, userRows[0].PasswordHash);
        
        if (!isPasswordValid) {
            return res.status(400).json({
                success: false,
                message: 'Mật khẩu hiện tại không đúng'
            });
        }
        
        // Mã hóa mật khẩu mới
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        
        // Cập nhật mật khẩu mới
        await pool.query(
            'UPDATE Users SET PasswordHash = ? WHERE UserID = ?',
            [hashedPassword, mechanicId]
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

/**
 * API: Cập nhật ảnh đại diện kỹ thuật viên
 * POST /api/mechanics/me/profile-picture
 */
router.post('/me/profile-picture', authenticateToken, checkMechanicAccess, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        const { profilePicture } = req.body;
        
        // Kiểm tra dữ liệu đầu vào
        if (!profilePicture || !profilePicture.startsWith('data:image')) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp ảnh đại diện hợp lệ (Base64)'
            });
        }
        
        // Lưu ảnh đại diện
        const [userInfo] = await pool.query(
            'SELECT Email FROM Users WHERE UserID = ?',
            [mechanicId]
        );
        
        if (userInfo.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy thông tin người dùng'
            });
        }
        
        // Lưu ảnh đại diện
        const profilePicPath = await saveProfileImage(profilePicture, userInfo[0].Email);
        
        // Cập nhật đường dẫn ảnh đại diện
        await pool.query(
            'UPDATE Users SET ProfilePicture = ? WHERE UserID = ?',
            [profilePicPath, mechanicId]
        );
        
        res.json({
            success: true,
            message: 'Cập nhật ảnh đại diện thành công',
            profilePicture: profilePicPath
        });
    } catch (err) {
        console.error('Lỗi khi cập nhật ảnh đại diện:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

// ADMIN ROUTES - Phê duyệt lịch làm việc kỹ thuật viên

/**
 * API: Lấy danh sách lịch làm việc chờ phê duyệt
 * GET /api/mechanics/schedules/pending
 */
router.get('/schedules/pending', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        // Lấy danh sách lịch làm việc chờ phê duyệt
        const [pendingSchedules] = await pool.query(`
            SELECT ms.*, u.FullName as MechanicName, u.Email, u.PhoneNumber
            FROM MechanicSchedules ms
            JOIN Users u ON ms.MechanicID = u.UserID
            WHERE ms.Status = 'Pending'
            ORDER BY ms.StartTime ASC
        `);
        
        res.json({
            success: true,
            schedules: pendingSchedules
        });
    } catch (err) {
        console.error('Lỗi khi lấy danh sách lịch làm việc chờ phê duyệt:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

/**
 * API: Phê duyệt lịch làm việc
 * PUT /api/mechanics/schedules/:id/approve
 */
router.put('/schedules/:id/approve', authenticateToken, checkAdminAccess, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const scheduleId = req.params.id;
        
        // Kiểm tra lịch làm việc có tồn tại không
        const [scheduleCheck] = await connection.query(
            'SELECT * FROM MechanicSchedules WHERE ScheduleID = ?',
            [scheduleId]
        );
        
        if (scheduleCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy lịch làm việc'
            });
        }
        
        const schedule = scheduleCheck[0];
        
        // Kiểm tra trạng thái lịch
        if (schedule.Status !== 'Pending') {
            return res.status(400).json({
                success: false,
                message: 'Lịch làm việc không ở trạng thái chờ phê duyệt'
            });
        }
        
        // Cập nhật trạng thái lịch làm việc
        await connection.query(
            'UPDATE MechanicSchedules SET Status = ? WHERE ScheduleID = ?',
            ['Approved', scheduleId]
        );
        
        // Thêm thông báo cho kỹ thuật viên
        await connection.query(
            'INSERT INTO Notifications (UserID, Title, Message, Type, ReferenceID) VALUES (?, ?, ?, ?, ?)',
            [
                schedule.MechanicID,
                'Lịch làm việc đã được phê duyệt',
                `Lịch làm việc của bạn từ ${new Date(schedule.StartTime).toLocaleString('vi-VN')} đến ${new Date(schedule.EndTime).toLocaleString('vi-VN')} đã được phê duyệt.`,
                'schedule',
                scheduleId
            ]
        );
        
        // Gửi email thông báo cho kỹ thuật viên
        try {
            const [mechanicInfo] = await connection.query(
                'SELECT Email, FullName FROM Users WHERE UserID = ?',
                [schedule.MechanicID]
            );
            
            if (mechanicInfo.length > 0 && mechanicInfo[0].Email) {
                const mechanicEmail = mechanicInfo[0].Email;
                const mechanicName = mechanicInfo[0].FullName;
                
                const startTimeFormatted = new Date(schedule.StartTime).toLocaleString('vi-VN');
                const endTimeFormatted = new Date(schedule.EndTime).toLocaleString('vi-VN');
                
                const mailOptions = {
                    from: process.env.EMAIL_USER || 'your-email@gmail.com',
                    to: mechanicEmail,
                    subject: 'Lịch làm việc đã được phê duyệt',
                    html: `
                        <h2>Thông báo phê duyệt lịch làm việc</h2>
                        <p>Xin chào ${mechanicName},</p>
                        <p>Lịch làm việc của bạn đã được phê duyệt.</p>
                        <p><strong>Thời gian bắt đầu:</strong> ${startTimeFormatted}</p>
                        <p><strong>Thời gian kết thúc:</strong> ${endTimeFormatted}</p>
                        <p><strong>Loại lịch:</strong> ${schedule.Type === 'available' ? 'Có thể làm việc' : 'Không thể làm việc'}</p>
                        <p><strong>Ghi chú:</strong> ${schedule.Notes || 'Không có'}</p>
                        <p>Vui lòng đăng nhập vào hệ thống để xem chi tiết.</p>
                    `
                };
                
                transporter.sendMail(mailOptions);
            }
        } catch (emailError) {
            console.error('Lỗi khi gửi email thông báo:', emailError);
            // Không cần trả về lỗi nếu chỉ là lỗi gửi mail
        }
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Phê duyệt lịch làm việc thành công'
        });
    } catch (err) {
        await connection.rollback();
        console.error('Lỗi khi phê duyệt lịch làm việc:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    } finally {
        connection.release();
    }
});

/**
 * API: Từ chối lịch làm việc
 * PUT /api/mechanics/schedules/:id/reject
 */
router.put('/schedules/:id/reject', authenticateToken, checkAdminAccess, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const scheduleId = req.params.id;
        const { reason } = req.body;
        
        // Kiểm tra lịch làm việc có tồn tại không
        const [scheduleCheck] = await connection.query(
            'SELECT * FROM MechanicSchedules WHERE ScheduleID = ?',
            [scheduleId]
        );
        
        if (scheduleCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy lịch làm việc'
            });
        }
        
        const schedule = scheduleCheck[0];
        
        // Kiểm tra trạng thái lịch
        if (schedule.Status !== 'Pending') {
            return res.status(400).json({
                success: false,
                message: 'Lịch làm việc không ở trạng thái chờ phê duyệt'
            });
        }
        
        // Cập nhật trạng thái lịch làm việc
        await connection.query(
            'UPDATE MechanicSchedules SET Status = ? WHERE ScheduleID = ?',
            ['Rejected', scheduleId]
        );
        
        // Thêm thông báo cho kỹ thuật viên
        await connection.query(
            'INSERT INTO Notifications (UserID, Title, Message, Type, ReferenceID) VALUES (?, ?, ?, ?, ?)',
            [
                schedule.MechanicID,
                'Lịch làm việc bị từ chối',
                `Lịch làm việc của bạn từ ${new Date(schedule.StartTime).toLocaleString('vi-VN')} đến ${new Date(schedule.EndTime).toLocaleString('vi-VN')} đã bị từ chối. Lý do: ${reason || 'Không có lý do cụ thể.'}`,
                'schedule',
                scheduleId
            ]
        );
        
        // Gửi email thông báo cho kỹ thuật viên
        try {
            const [mechanicInfo] = await connection.query(
                'SELECT Email, FullName FROM Users WHERE UserID = ?',
                [schedule.MechanicID]
            );
            
            if (mechanicInfo.length > 0 && mechanicInfo[0].Email) {
                const mechanicEmail = mechanicInfo[0].Email;
                const mechanicName = mechanicInfo[0].FullName;
                
                const startTimeFormatted = new Date(schedule.StartTime).toLocaleString('vi-VN');
                const endTimeFormatted = new Date(schedule.EndTime).toLocaleString('vi-VN');
                
                const mailOptions = {
                    from: process.env.EMAIL_USER || 'your-email@gmail.com',
                    to: mechanicEmail,
                    subject: 'Lịch làm việc bị từ chối',
                    html: `
                        <h2>Thông báo từ chối lịch làm việc</h2>
                        <p>Xin chào ${mechanicName},</p>
                        <p>Lịch làm việc của bạn đã bị từ chối.</p>
                        <p><strong>Thời gian bắt đầu:</strong> ${startTimeFormatted}</p>
                        <p><strong>Thời gian kết thúc:</strong> ${endTimeFormatted}</p>
                        <p><strong>Loại lịch:</strong> ${schedule.Type === 'available' ? 'Có thể làm việc' : 'Không thể làm việc'}</p>
                        <p><strong>Lý do từ chối:</strong> ${reason || 'Không có lý do cụ thể.'}</p>
                        <p>Vui lòng đăng nhập vào hệ thống để xem chi tiết hoặc đăng ký lịch làm việc khác.</p>
                    `
                };
                
                transporter.sendMail(mailOptions);
            }
        } catch (emailError) {
            console.error('Lỗi khi gửi email thông báo:', emailError);
            // Không cần trả về lỗi nếu chỉ là lỗi gửi mail
        }
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Từ chối lịch làm việc thành công'
        });
    } catch (err) {
        await connection.rollback();
        console.error('Lỗi khi từ chối lịch làm việc:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    } finally {
        connection.release();
    }
});

/**
 * API: Lấy danh sách lịch hẹn được gán cho kỹ thuật viên
 * GET /api/mechanics/appointments
 */
router.get('/appointments', authenticateToken, checkMechanicAccess, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        const { status, dateFrom, dateTo, date } = req.query;
        
        console.log(`Mechanic ${mechanicId} requesting appointments with filters:`, { status, dateFrom, dateTo, date });
        
        // Xây dựng câu query với các điều kiện lọc
        let queryConditions = ['a.MechanicID = ?'];
        let queryParams = [mechanicId];
        
        if (status) {
            queryConditions.push('a.Status = ?');
            queryParams.push(status);
        }
        
        if (date) {
            queryConditions.push('DATE(a.AppointmentDate) = ?');
            queryParams.push(date);
        } else {
            if (dateFrom) {
                queryConditions.push('DATE(a.AppointmentDate) >= ?');
                queryParams.push(dateFrom);
            }
            
            if (dateTo) {
                queryConditions.push('DATE(a.AppointmentDate) <= ?');
                queryParams.push(dateTo);
            }
        }
        
        // Xây dựng câu query
        const query = `
            SELECT a.*, 
                   u.FullName, u.PhoneNumber, u.Email,
                   v.LicensePlate, v.Brand, v.Model,
                   (SELECT GROUP_CONCAT(s.ServiceName SEPARATOR ', ') 
                    FROM AppointmentServices aps 
                    JOIN Services s ON aps.ServiceID = s.ServiceID 
                    WHERE aps.AppointmentID = a.AppointmentID) AS Services
            FROM Appointments a
            LEFT JOIN Users u ON a.UserID = u.UserID
            LEFT JOIN Vehicles v ON a.VehicleID = v.VehicleID
            WHERE ${queryConditions.join(' AND ')}
            ORDER BY a.AppointmentDate DESC
        `;
        
        console.log("Running query with params:", queryParams);
        const [appointments] = await pool.query(query, queryParams);
        
        console.log(`Found ${appointments.length} appointments for mechanic ${mechanicId}`);
        
        res.json({
            success: true,
            appointments
        });
    } catch (err) {
        console.error('Lỗi khi lấy danh sách lịch hẹn của kỹ thuật viên:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

/**
 * API: Lấy chi tiết lịch hẹn của kỹ thuật viên
 * GET /api/mechanics/appointments/:id
 */
router.get('/appointments/:id', authenticateToken, checkMechanicAccess, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        const appointmentId = req.params.id;
        
        console.log(`Mechanic ${mechanicId} requesting appointment detail for ID ${appointmentId}`);
        
        // Kiểm tra quyền và lấy thông tin chi tiết lịch hẹn
        const [appointments] = await pool.query(`
            SELECT a.*, 
                   u.FullName, u.PhoneNumber, u.Email,
                   v.LicensePlate, v.Brand, v.Model
            FROM Appointments a
            LEFT JOIN Users u ON a.UserID = u.UserID
            LEFT JOIN Vehicles v ON a.VehicleID = v.VehicleID
            WHERE a.AppointmentID = ? AND a.MechanicID = ?
        `, [appointmentId, mechanicId]);
        
        if (appointments.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy lịch hẹn hoặc không có quyền truy cập'
            });
        }
        
        const appointment = appointments[0];
        
        // Lấy thông tin dịch vụ của lịch hẹn
        const [services] = await pool.query(`
            SELECT as2.*, s.ServiceName, s.Price, s.EstimatedTime 
            FROM AppointmentServices as2
            JOIN Services s ON as2.ServiceID = s.ServiceID
            WHERE as2.AppointmentID = ?
        `, [appointmentId]);
        
        appointment.services = services;
        
        console.log(`Successfully fetched appointment details for ID ${appointmentId}`);
        
        res.json({
            success: true,
            appointment
        });
    } catch (err) {
        console.error('Lỗi khi lấy chi tiết lịch hẹn của kỹ thuật viên:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

/**
 * API: Cập nhật trạng thái lịch hẹn
 * PUT /api/mechanics/appointments/:id/status
 */
router.put('/appointments/:id/status', authenticateToken, checkMechanicAccess, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const mechanicId = req.user.userId;
        const appointmentId = req.params.id;
        const { status, notes } = req.body;
        
        console.log(`Mechanic ${mechanicId} updating appointment ${appointmentId} to status ${status}`);
        
        // Kiểm tra lịch hẹn có tồn tại không
        const [appointmentCheck] = await connection.query(
            'SELECT * FROM Appointments WHERE AppointmentID = ? AND MechanicID = ?',
            [appointmentId, mechanicId]
        );
        
        if (appointmentCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy lịch hẹn hoặc không có quyền truy cập'
            });
        }
        
        const appointment = appointmentCheck[0];
        
        // Kiểm tra trạng thái hợp lệ
        const validStatuses = ['Pending', 'Confirmed', 'InProgress', 'Completed', 'Canceled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Trạng thái không hợp lệ'
            });
        }
        
        // Kiểm tra chuyển trạng thái hợp lệ
        if (appointment.Status === 'Canceled' && status !== 'Canceled') {
            return res.status(400).json({
                success: false,
                message: 'Không thể thay đổi trạng thái của lịch hẹn đã hủy'
            });
        }
        
        if (appointment.Status === 'Completed' && status !== 'Completed') {
            return res.status(400).json({
                success: false,
                message: 'Không thể thay đổi trạng thái của lịch hẹn đã hoàn thành'
            });
        }
        
        // Cập nhật trạng thái lịch hẹn
        await connection.query(
            'UPDATE Appointments SET Status = ?, Notes = ? WHERE AppointmentID = ?',
            [status, notes || appointment.Notes, appointmentId]
        );
        
        // Thêm thông báo cho khách hàng (nếu có bảng Notifications)
        try {
            await connection.query(
                'INSERT INTO Notifications (UserID, Title, Message, Type, ReferenceID) VALUES (?, ?, ?, ?, ?)',
                [
                    appointment.UserID,
                    `Lịch hẹn đã được cập nhật`,
                    `Lịch hẹn #${appointmentId} của bạn đã được cập nhật trạng thái thành "${status}".`,
                    'appointment',
                    appointmentId
                ]
            );
        } catch (notifyError) {
            console.warn('Không thể tạo thông báo (có thể bảng Notifications không tồn tại):', notifyError);
            // Không ảnh hưởng đến việc cập nhật trạng thái
        }
        
        await connection.commit();
        
        console.log(`Successfully updated appointment ${appointmentId} to status ${status}`);
        
        res.json({
            success: true,
            message: 'Cập nhật trạng thái lịch hẹn thành công'
        });
    } catch (err) {
        await connection.rollback();
        console.error('Lỗi khi cập nhật trạng thái lịch hẹn:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    } finally {
        connection.release();
    }
});

/**
 * Hàm xử lý lưu ảnh đại diện
 * @param {String} base64Image Chuỗi ảnh Base64
 * @param {String} email Email để tạo tên file
 * @returns {Promise<String>} Đường dẫn ảnh sau khi lưu
 */
async function saveProfileImage(base64Image, email) {
    // Đây là phần mã giả định cho việc lưu ảnh
    // Trong ứng dụng thực tế, bạn cần có code thực sự để lưu ảnh vào thư mục trên server
    
    // Tạo tên file dựa trên email và thời gian
    const timestamp = Date.now();
    const filename = `${email.split('@')[0]}_${timestamp}.jpg`;
    const imagePath = `images/avatars/${filename}`;
    
    // Giả định lưu thành công và trả về đường dẫn
    return imagePath;
}

module.exports = router;