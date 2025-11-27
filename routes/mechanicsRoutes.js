// mechanicsRoutes.js - Routes cho chức năng quản lý kỹ thuật viên
// ĐÃ SỬA: Dùng bảng StaffSchedule thay vì MechanicSchedules

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('./authRoutes');
const nodemailer = require('nodemailer');

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

// Cấu hình nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'your-email@gmail.com',
        pass: process.env.EMAIL_PASS || 'your-password'
    }
});

// ============================================
// DASHBOARD APIs
// ============================================

/**
 * API: Thống kê dashboard kỹ thuật viên
 * GET /api/mechanics/dashboard/stats
 */
router.get('/dashboard/stats', authenticateToken, checkMechanicAccess, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        
        // Lấy số lịch hẹn hôm nay
        const today = new Date().toISOString().split('T')[0];
        const [todayAppointments] = await pool.query(
            'SELECT COUNT(*) as count FROM Appointments WHERE MechanicID = ? AND DATE(AppointmentDate) = ? AND IsDeleted = 0',
            [mechanicId, today]
        );
        
        // Lấy số lịch hẹn đang chờ xử lý
        const [pendingAppointments] = await pool.query(
            'SELECT COUNT(*) as count FROM Appointments WHERE MechanicID = ? AND Status IN ("Pending", "Confirmed") AND IsDeleted = 0',
            [mechanicId]
        );
        
        // Lấy số lịch hẹn đã hoàn thành trong tuần này
        const [weeklyCompleted] = await pool.query(
            `SELECT COUNT(*) as count FROM Appointments 
             WHERE MechanicID = ? AND Status = "Completed" AND IsDeleted = 0
             AND YEARWEEK(AppointmentDate, 1) = YEARWEEK(CURDATE(), 1)`,
            [mechanicId]
        );
        
        // Lấy điểm đánh giá trung bình
        const [averageRating] = await pool.query(
            'SELECT AVG(Rating) as avgRating FROM MechanicReviews WHERE MechanicID = ?',
            [mechanicId]
        );
        
        res.json({
            success: true,
            stats: {
                todayAppointments: todayAppointments[0].count,
                pendingAppointments: pendingAppointments[0].count,
                weeklyCompleted: weeklyCompleted[0].count,
                averageRating: averageRating[0].avgRating ? parseFloat(averageRating[0].avgRating).toFixed(1) : 0
            }
        });
    } catch (err) {
        console.error('Lỗi khi lấy thống kê dashboard kỹ thuật viên:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

/**
 * API: Lấy danh sách lịch hẹn sắp tới của kỹ thuật viên
 * GET /api/mechanics/appointments/upcoming
 */
router.get('/appointments/upcoming', authenticateToken, checkMechanicAccess, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        
        const [appointments] = await pool.query(
            `SELECT a.*, u.FullName as CustomerName, u.PhoneNumber as CustomerPhone,
             v.LicensePlate, v.Brand, v.Model,
             (SELECT GROUP_CONCAT(s.ServiceName SEPARATOR ', ') 
              FROM AppointmentServices ap 
              JOIN Services s ON ap.ServiceID = s.ServiceID 
              WHERE ap.AppointmentID = a.AppointmentID) AS Services
             FROM Appointments a
             LEFT JOIN Users u ON a.UserID = u.UserID
             LEFT JOIN Vehicles v ON a.VehicleID = v.VehicleID
             WHERE a.MechanicID = ? AND a.Status IN ('Pending', 'Confirmed')
             AND a.AppointmentDate >= CURDATE() AND a.IsDeleted = 0
             ORDER BY a.AppointmentDate ASC
             LIMIT 10`,
            [mechanicId]
        );
        
        res.json({
            success: true,
            appointments
        });
    } catch (err) {
        console.error('Lỗi khi lấy danh sách lịch hẹn sắp tới:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

// ============================================
// NOTIFICATION APIs
// ============================================

/**
 * API: Lấy thông báo của kỹ thuật viên
 * GET /api/mechanics/notifications
 */
router.get('/notifications', authenticateToken, checkMechanicAccess, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        const limit = parseInt(req.query.limit) || 10;
        
        const [notifications] = await pool.query(
            `SELECT * FROM Notifications 
             WHERE UserID = ? 
             ORDER BY CreatedAt DESC 
             LIMIT ?`,
            [mechanicId, limit]
        );
        
        res.json({
            success: true,
            notifications
        });
    } catch (err) {
        console.error('Lỗi khi lấy thông báo kỹ thuật viên:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

/**
 * API: Đánh dấu thông báo đã đọc
 * PUT /api/mechanics/notifications/:id/read
 */
router.put('/notifications/:id/read', authenticateToken, checkMechanicAccess, async (req, res) => {
    try {
        const notificationId = req.params.id;
        const mechanicId = req.user.userId;
        
        const [notificationCheck] = await pool.query(
            'SELECT * FROM Notifications WHERE NotificationID = ? AND UserID = ?',
            [notificationId, mechanicId]
        );
        
        if (notificationCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy thông báo'
            });
        }
        
        await pool.query(
            'UPDATE Notifications SET IsRead = 1 WHERE NotificationID = ?',
            [notificationId]
        );
        
        res.json({
            success: true,
            message: 'Đã đánh dấu thông báo là đã đọc'
        });
    } catch (err) {
        console.error('Lỗi khi cập nhật trạng thái thông báo:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

// ============================================
// SCHEDULE APIs - DÙNG BẢNG StaffSchedule
// ============================================

/**
 * API: Lấy danh sách lịch làm việc của kỹ thuật viên
 * GET /api/mechanics/schedules
 * ĐÃ SỬA: Dùng StaffSchedule thay vì MechanicSchedules
 */
router.get('/schedules', authenticateToken, checkMechanicAccess, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        const { from, to } = req.query;
        
        let query = `
            SELECT 
                ScheduleID,
                MechanicID,
                WorkDate,
                StartTime,
                EndTime,
                Type,
                Status,
                Notes,
                IsAvailable,
                CreatedAt
            FROM StaffSchedule 
            WHERE MechanicID = ?
        `;
        const queryParams = [mechanicId];
        
        // Lọc theo khoảng thời gian
        if (from && to) {
            query += ' AND WorkDate BETWEEN ? AND ?';
            queryParams.push(from, to);
        } else if (from) {
            query += ' AND WorkDate >= ?';
            queryParams.push(from);
        } else if (to) {
            query += ' AND WorkDate <= ?';
            queryParams.push(to);
        }
        
        query += ' ORDER BY WorkDate DESC, StartTime ASC';
        
        const [schedules] = await pool.query(query, queryParams);
        
        // Format lại dữ liệu để tương thích với frontend
        const formattedSchedules = schedules.map(s => ({
            ScheduleID: s.ScheduleID,
            MechanicID: s.MechanicID,
            StartTime: `${s.WorkDate}T${s.StartTime}`, // Combine date + time
            EndTime: `${s.WorkDate}T${s.EndTime}`,
            WorkDate: s.WorkDate,
            StartTimeOnly: s.StartTime,
            EndTimeOnly: s.EndTime,
            Type: s.Type || 'available',
            Status: s.Status || 'Approved',
            Notes: s.Notes,
            IsAvailable: s.IsAvailable,
            CreatedAt: s.CreatedAt
        }));
        
        res.json({
            success: true,
            schedules: formattedSchedules
        });
    } catch (err) {
        console.error('Lỗi khi lấy lịch làm việc kỹ thuật viên:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

/**
 * API: Thêm lịch làm việc mới
 * POST /api/mechanics/schedules
 * ĐÃ SỬA: Dùng StaffSchedule thay vì MechanicSchedules
 */
router.post('/schedules', authenticateToken, checkMechanicAccess, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const { startTime, endTime, type, notes } = req.body;
        const mechanicId = req.user.userId;
        
        // Kiểm tra dữ liệu đầu vào
        if (!startTime || !endTime) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp đầy đủ thời gian bắt đầu và kết thúc'
            });
        }
        
        // Parse datetime để lấy WorkDate, StartTime, EndTime
        const startDate = new Date(startTime);
        const endDate = new Date(endTime);
        
        const workDate = startDate.toISOString().split('T')[0]; // YYYY-MM-DD
        const startTimeOnly = startDate.toTimeString().split(' ')[0]; // HH:MM:SS
        const endTimeOnly = endDate.toTimeString().split(' ')[0];
        
        // Kiểm tra thời gian hợp lệ
        if (startDate >= endDate) {
            return res.status(400).json({
                success: false,
                message: 'Thời gian kết thúc phải sau thời gian bắt đầu'
            });
        }
        
        // Kiểm tra trùng lịch
        const [overlappingSchedules] = await connection.query(
            `SELECT * FROM StaffSchedule 
             WHERE MechanicID = ? AND WorkDate = ?
             AND ((StartTime <= ? AND EndTime > ?) OR (StartTime < ? AND EndTime >= ?) OR (StartTime >= ? AND EndTime <= ?))`,
            [mechanicId, workDate, startTimeOnly, startTimeOnly, endTimeOnly, endTimeOnly, startTimeOnly, endTimeOnly]
        );
        
        if (overlappingSchedules.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Thời gian bị trùng với lịch làm việc khác',
                conflictingSchedules: overlappingSchedules
            });
        }
        
        // Thêm lịch làm việc mới vào StaffSchedule
        const [result] = await connection.query(
            `INSERT INTO StaffSchedule (MechanicID, WorkDate, StartTime, EndTime, Type, Status, Notes, IsAvailable) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [mechanicId, workDate, startTimeOnly, endTimeOnly, type || 'available', 'Pending', notes || null, 1]
        );
        
        const scheduleId = result.insertId;
        
        // Thông báo cho admin về lịch mới cần phê duyệt
        const [adminUsers] = await connection.query(
            'SELECT UserID FROM Users WHERE RoleID = 1'
        );
        
        for (const admin of adminUsers) {
            await connection.query(
                'INSERT INTO Notifications (UserID, Title, Message, Type, ReferenceID) VALUES (?, ?, ?, ?, ?)',
                [
                    admin.UserID,
                    'Lịch làm việc mới cần phê duyệt',
                    `Kỹ thuật viên ID ${mechanicId} đã đăng ký lịch làm việc mới vào ngày ${workDate}`,
                    'schedule',
                    scheduleId
                ]
            );
        }
        
        await connection.commit();
        
        res.status(201).json({
            success: true,
            message: 'Đăng ký lịch làm việc thành công, đang chờ phê duyệt',
            scheduleId
        });
    } catch (err) {
        await connection.rollback();
        console.error('Lỗi khi đăng ký lịch làm việc:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    } finally {
        connection.release();
    }
});

/**
 * API: Cập nhật lịch làm việc
 * PUT /api/mechanics/schedules/:id
 * ĐÃ SỬA: Dùng StaffSchedule thay vì MechanicSchedules
 */
router.put('/schedules/:id', authenticateToken, checkMechanicAccess, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const scheduleId = req.params.id;
        const { startTime, endTime, type, notes } = req.body;
        const mechanicId = req.user.userId;
        
        // Kiểm tra lịch làm việc có tồn tại không
        const [scheduleCheck] = await connection.query(
            'SELECT * FROM StaffSchedule WHERE ScheduleID = ? AND MechanicID = ?',
            [scheduleId, mechanicId]
        );
        
        if (scheduleCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy lịch làm việc của bạn'
            });
        }
        
        // Parse datetime
        const startDate = new Date(startTime);
        const endDate = new Date(endTime);
        
        const workDate = startDate.toISOString().split('T')[0];
        const startTimeOnly = startDate.toTimeString().split(' ')[0];
        const endTimeOnly = endDate.toTimeString().split(' ')[0];
        
        // Kiểm tra thời gian hợp lệ
        if (startDate >= endDate) {
            return res.status(400).json({
                success: false,
                message: 'Thời gian kết thúc phải sau thời gian bắt đầu'
            });
        }
        
        // Kiểm tra trùng lịch (trừ lịch hiện tại)
        const [overlappingSchedules] = await connection.query(
            `SELECT * FROM StaffSchedule 
             WHERE MechanicID = ? AND WorkDate = ? AND ScheduleID != ?
             AND ((StartTime <= ? AND EndTime > ?) OR (StartTime < ? AND EndTime >= ?) OR (StartTime >= ? AND EndTime <= ?))`,
            [mechanicId, workDate, scheduleId, startTimeOnly, startTimeOnly, endTimeOnly, endTimeOnly, startTimeOnly, endTimeOnly]
        );
        
        if (overlappingSchedules.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Thời gian bị trùng với lịch làm việc khác'
            });
        }
        
        // Cập nhật lịch làm việc
        await connection.query(
            `UPDATE StaffSchedule 
             SET WorkDate = ?, StartTime = ?, EndTime = ?, Type = ?, Notes = ?, Status = 'Pending'
             WHERE ScheduleID = ?`,
            [workDate, startTimeOnly, endTimeOnly, type || 'available', notes || null, scheduleId]
        );
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Cập nhật lịch làm việc thành công, đang chờ phê duyệt'
        });
    } catch (err) {
        await connection.rollback();
        console.error('Lỗi khi cập nhật lịch làm việc:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    } finally {
        connection.release();
    }
});

/**
 * API: Xóa lịch làm việc
 * DELETE /api/mechanics/schedules/:id
 * ĐÃ SỬA: Dùng StaffSchedule thay vì MechanicSchedules
 */
router.delete('/schedules/:id', authenticateToken, checkMechanicAccess, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const scheduleId = req.params.id;
        const mechanicId = req.user.userId;
        
        // Kiểm tra lịch làm việc có tồn tại không
        const [scheduleCheck] = await connection.query(
            'SELECT * FROM StaffSchedule WHERE ScheduleID = ? AND MechanicID = ?',
            [scheduleId, mechanicId]
        );
        
        if (scheduleCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy lịch làm việc của bạn'
            });
        }
        
        const schedule = scheduleCheck[0];
        
        // Kiểm tra lịch hẹn liên quan
        const [relatedAppointments] = await connection.query(
            `SELECT * FROM Appointments 
             WHERE MechanicID = ? 
             AND DATE(AppointmentDate) = ?
             AND Status NOT IN ('Canceled', 'Completed')`,
            [mechanicId, schedule.WorkDate]
        );
        
        if (relatedAppointments.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Không thể xóa lịch làm việc đã có lịch hẹn',
                relatedAppointments
            });
        }
        
        // Xóa lịch làm việc
        await connection.query(
            'DELETE FROM StaffSchedule WHERE ScheduleID = ?',
            [scheduleId]
        );
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Xóa lịch làm việc thành công'
        });
    } catch (err) {
        await connection.rollback();
        console.error('Lỗi khi xóa lịch làm việc:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    } finally {
        connection.release();
    }
});

// ============================================
// ADMIN SCHEDULE APPROVAL APIs
// ============================================

/**
 * API: Lấy danh sách lịch làm việc chờ phê duyệt
 * GET /api/mechanics/schedules/pending
 */
router.get('/schedules/pending', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        const [pendingSchedules] = await pool.query(`
            SELECT s.*, u.FullName as MechanicName, u.Email, u.PhoneNumber
            FROM StaffSchedule s
            JOIN Users u ON s.MechanicID = u.UserID
            WHERE s.Status = 'Pending'
            ORDER BY s.WorkDate ASC, s.StartTime ASC
        `);
        
        res.json({
            success: true,
            schedules: pendingSchedules
        });
    } catch (err) {
        console.error('Lỗi khi lấy danh sách lịch chờ phê duyệt:', err);
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
        
        const [scheduleCheck] = await connection.query(
            'SELECT * FROM StaffSchedule WHERE ScheduleID = ?',
            [scheduleId]
        );
        
        if (scheduleCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy lịch làm việc'
            });
        }
        
        const schedule = scheduleCheck[0];
        
        if (schedule.Status !== 'Pending') {
            return res.status(400).json({
                success: false,
                message: 'Lịch làm việc không ở trạng thái chờ phê duyệt'
            });
        }
        
        // Cập nhật trạng thái
        await connection.query(
            'UPDATE StaffSchedule SET Status = ? WHERE ScheduleID = ?',
            ['Approved', scheduleId]
        );
        
        // Thông báo cho kỹ thuật viên
        await connection.query(
            'INSERT INTO Notifications (UserID, Title, Message, Type, ReferenceID) VALUES (?, ?, ?, ?, ?)',
            [
                schedule.MechanicID,
                'Lịch làm việc đã được phê duyệt',
                `Lịch làm việc ngày ${schedule.WorkDate} từ ${schedule.StartTime} đến ${schedule.EndTime} đã được phê duyệt.`,
                'schedule',
                scheduleId
            ]
        );
        
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
        
        const [scheduleCheck] = await connection.query(
            'SELECT * FROM StaffSchedule WHERE ScheduleID = ?',
            [scheduleId]
        );
        
        if (scheduleCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy lịch làm việc'
            });
        }
        
        const schedule = scheduleCheck[0];
        
        if (schedule.Status !== 'Pending') {
            return res.status(400).json({
                success: false,
                message: 'Lịch làm việc không ở trạng thái chờ phê duyệt'
            });
        }
        
        // Cập nhật trạng thái
        await connection.query(
            'UPDATE StaffSchedule SET Status = ? WHERE ScheduleID = ?',
            ['Rejected', scheduleId]
        );
        
        // Thông báo cho kỹ thuật viên
        await connection.query(
            'INSERT INTO Notifications (UserID, Title, Message, Type, ReferenceID) VALUES (?, ?, ?, ?, ?)',
            [
                schedule.MechanicID,
                'Lịch làm việc bị từ chối',
                `Lịch làm việc ngày ${schedule.WorkDate} đã bị từ chối. Lý do: ${reason || 'Không có lý do cụ thể.'}`,
                'schedule',
                scheduleId
            ]
        );
        
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

// ============================================
// APPOINTMENT APIs
// ============================================

/**
 * API: Lấy danh sách lịch hẹn của kỹ thuật viên
 * GET /api/mechanics/appointments
 */
router.get('/appointments', authenticateToken, checkMechanicAccess, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        const { status, date } = req.query;
        
        let query = `
            SELECT a.*, u.FullName as CustomerName, u.PhoneNumber as CustomerPhone,
                   v.LicensePlate, v.Brand, v.Model,
                   (SELECT GROUP_CONCAT(s.ServiceName SEPARATOR ', ') 
                    FROM AppointmentServices ap 
                    JOIN Services s ON ap.ServiceID = s.ServiceID 
                    WHERE ap.AppointmentID = a.AppointmentID) AS Services
            FROM Appointments a
            LEFT JOIN Users u ON a.UserID = u.UserID
            LEFT JOIN Vehicles v ON a.VehicleID = v.VehicleID
            WHERE a.MechanicID = ? AND a.IsDeleted = 0
        `;
        
        const queryParams = [mechanicId];
        
        if (status) {
            query += ' AND a.Status = ?';
            queryParams.push(status);
        }
        
        if (date) {
            query += ' AND DATE(a.AppointmentDate) = ?';
            queryParams.push(date);
        }
        
        query += ' ORDER BY a.AppointmentDate DESC';
        
        const [appointments] = await pool.query(query, queryParams);
        
        res.json({
            success: true,
            appointments
        });
    } catch (err) {
        console.error('Lỗi khi lấy danh sách lịch hẹn kỹ thuật viên:', err);
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
        
        const appointmentId = req.params.id;
        const { status, notes } = req.body;
        const mechanicId = req.user.userId;
        
        // Kiểm tra lịch hẹn có tồn tại không
        const [appointmentCheck] = await connection.query(
            'SELECT * FROM Appointments WHERE AppointmentID = ? AND MechanicID = ?',
            [appointmentId, mechanicId]
        );
        
        if (appointmentCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy lịch hẹn của bạn'
            });
        }
        
        const appointment = appointmentCheck[0];
        
        // Kiểm tra trạng thái hợp lệ
        const validStatuses = ['Pending', 'Confirmed', 'Completed', 'Canceled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Trạng thái không hợp lệ'
            });
        }
        
        // Kiểm tra chuyển trạng thái hợp lệ
        if (appointment.Status === 'Canceled' || appointment.Status === 'Completed') {
            return res.status(400).json({
                success: false,
                message: `Không thể thay đổi trạng thái của lịch hẹn đã ${appointment.Status === 'Canceled' ? 'hủy' : 'hoàn thành'}`
            });
        }
        
        // Cập nhật trạng thái lịch hẹn
        await connection.query(
            'UPDATE Appointments SET Status = ?, Notes = ? WHERE AppointmentID = ?',
            [status, notes || appointment.Notes, appointmentId]
        );
        
        // Thông báo cho khách hàng
        const statusText = {
            'Confirmed': 'đã được xác nhận',
            'Completed': 'đã hoàn thành',
            'Canceled': 'đã bị hủy'
        };
        
        if (statusText[status]) {
            await connection.query(
                'INSERT INTO Notifications (UserID, Title, Message, Type, ReferenceID) VALUES (?, ?, ?, ?, ?)',
                [
                    appointment.UserID,
                    `Lịch hẹn ${statusText[status]}`,
                    `Lịch hẹn của bạn vào ngày ${new Date(appointment.AppointmentDate).toLocaleDateString('vi-VN')} ${statusText[status]}.`,
                    'appointment',
                    appointmentId
                ]
            );
        }
        
        await connection.commit();
        
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

module.exports = router;