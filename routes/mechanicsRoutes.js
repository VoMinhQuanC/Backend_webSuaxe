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
 * 
 * API: Lấy danh sách lịch của TẤT CẢ kỹ thuật viên (để hiển thị trên calendar)
 * GET /api/mechanics/schedules/all
 * Query params: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
router.get('/schedules/all', authenticateToken, checkMechanicAccess, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        let query = `
            SELECT 
                ss.ScheduleID,
                ss.MechanicID,
                ss.WorkDate,
                ss.StartTime,
                ss.EndTime,
                ss.Type,
                ss.IsAvailable,
                ss.Notes,
                ss.Status,
                u.FullName as MechanicName,
                u.PhoneNumber  as MechanicPhone
            FROM StaffSchedule ss
            JOIN Users u ON ss.MechanicID = u.UserID
            WHERE 1=1
        `;
        
        const params = [];
        
        // Filter theo ngày nếu có
        if (startDate) {
            query += ' AND ss.WorkDate >= ?';
            params.push(startDate);
        }
        
        if (endDate) {
            query += ' AND ss.WorkDate <= ?';
            params.push(endDate);
        }
        
        // Chỉ lấy lịch available (không lấy lịch nghỉ)
        query += ' AND ss.Type = "available" AND ss.IsAvailable = 1';
        
        query += ' ORDER BY ss.WorkDate, ss.StartTime';
        
        const [allSchedules] = await pool.query(query, params);
        
        res.json({
            success: true,
            data: allSchedules,
            total: allSchedules.length
        });
        
    } catch (error) {
        console.error('Lỗi khi lấy tất cả lịch kỹ thuật viên:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

/**
 * API: Lấy lịch làm việc của kỹ thuật viên hiện tại theo khoảng thời gian
 * GET /api/mechanics/schedules
 * Query params: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
router.get('/schedules', authenticateToken, checkMechanicAccess, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const mechanicId = req.user.userId; // Lấy từ JWT token
        
        console.log('📅 Fetching schedules for mechanic:', mechanicId, 'from', startDate, 'to', endDate);
        
        // Validate params
        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu tham số startDate hoặc endDate'
            });
        }
        
        // Call model method
        const StaffSchedule = require('../models/StaffSchedule');
        const schedules = await StaffSchedule.getSchedulesByMechanicAndDateRange(
            mechanicId,
            startDate,
            endDate
        );
        
        console.log('✅ Found schedules:', schedules.length);
        
        res.json({
            success: true,
            schedules: schedules
        });
    } catch (err) {
        console.error('Lỗi khi lấy lịch làm việc của kỹ thuật viên:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

/**
 * API: Đếm số KTV đã đăng ký theo ngày
 * GET /api/mechanics/schedules/count-by-date
 * Query params: ?date=YYYY-MM-DD
*/
router.get('/schedules/count-by-date', authenticateToken, checkMechanicAccess, async (req, res) => {
    try {
        const { date } = req.query;
        
        if (!date) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp ngày'
            });
        }
        
        const [result] = await pool.query(
            `SELECT COUNT(DISTINCT MechanicID) as mechanicCount
             FROM StaffSchedule
             WHERE WorkDate = ? 
             AND Type = 'available' 
             AND IsAvailable = 1`,
            [date]
        );
        
        res.json({
            success: true,
            date: date,
            mechanicCount: result[0].mechanicCount,
            maxMechanics: 6,
            available: 6 - result[0].mechanicCount
        });
        
    } catch (error) {
        console.error('Lỗi khi đếm kỹ thuật viên:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

/**
 * API: Kiểm tra lịch có thể sửa được không
 * GET /api/mechanics/schedules/check-can-edit/:id
 * Trả về: canEdit, canLeave, hasBooking, daysUntil, lockReason
 */
router.get('/schedules/check-can-edit/:id', authenticateToken, checkMechanicAccess, async (req, res) => {
    try {
        const scheduleId = req.params.id;
        const mechanicId = req.user.userId;
        
        // Lấy thông tin schedule
        const [scheduleCheck] = await pool.query(
            'SELECT * FROM StaffSchedule WHERE ScheduleID = ? AND MechanicID = ?',
            [scheduleId, mechanicId]
        );
        
        if (scheduleCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy lịch làm việc'
            });
        }
        
        const schedule = scheduleCheck[0];
        const workDate = new Date(schedule.WorkDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        workDate.setHours(0, 0, 0, 0);
        
        // Tính số ngày còn lại
        const diffTime = workDate - today;
        const daysUntil = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        // Kiểm tra booking trong ngày đó
        const [relatedAppointments] = await pool.query(
            `SELECT AppointmentID, AppointmentDate, Status, Notes 
             FROM Appointments 
             WHERE MechanicID = ? 
             AND DATE(AppointmentDate) = ?
             AND Status NOT IN ('Canceled', 'Completed')
             AND IsDeleted = 0`,
            [mechanicId, schedule.WorkDate]
        );
        
        const hasBooking = relatedAppointments.length > 0;
        const bookingCount = relatedAppointments.length;
        
        // Xác định trạng thái
        let canEdit = true;
        let canLeave = true;
        let lockReason = null;
        
        // Ràng buộc 1: Dưới 2 ngày → Không được sửa, chỉ được nghỉ
        if (daysUntil < 2) {
            canEdit = false;
            lockReason = `Chỉ có thể sửa lịch trước 2 ngày. Còn ${daysUntil} ngày nữa đến ngày làm việc.`;
        }
        
        // Ràng buộc 2: Có booking → Không được sửa, chỉ được nghỉ
        if (hasBooking) {
            canEdit = false;
            lockReason = `Lịch này đã có ${bookingCount} khách đặt. Bạn không thể sửa, chỉ có thể xin nghỉ.`;
        }
        
        // Ràng buộc 3: Đã qua ngày làm → Không được làm gì
        if (daysUntil < 0) {
            canEdit = false;
            canLeave = false;
            lockReason = 'Lịch này đã qua, không thể thay đổi.';
        }
        
        // Ràng buộc 4: Đang chờ duyệt → Không được sửa
        if (schedule.Status === 'PendingEdit' || schedule.Status === 'PendingLeave') {
            canEdit = false;
            canLeave = false;
            lockReason = 'Lịch này đang chờ Admin duyệt, vui lòng đợi.';
        }
        
        res.json({
            success: true,
            scheduleId: parseInt(scheduleId),
            workDate: schedule.WorkDate,
            daysUntil: daysUntil,
            hasBooking: hasBooking,
            bookingCount: bookingCount,
            canEdit: canEdit,
            canLeave: canLeave,
            lockReason: lockReason,
            status: schedule.Status
        });
        
    } catch (error) {
        console.error('Lỗi khi kiểm tra can-edit:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

/**
 * API: Gửi đơn xin sửa lịch
 * POST /api/mechanics/schedules/:id/request-edit
 * Body: { newWorkDate, newStartTime, newEndTime, reason }
 */
router.post('/schedules/:id/request-edit', authenticateToken, checkMechanicAccess, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const scheduleId = req.params.id;
        const mechanicId = req.user.userId;
        const { newWorkDate, newStartTime, newEndTime, reason } = req.body;
        
        // Validate input
        if (!newWorkDate || !newStartTime || !newEndTime) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng điền đầy đủ thông tin ngày giờ mới'
            });
        }
        
        if (!reason || reason.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng nhập lý do xin sửa lịch'
            });
        }
        
        // Lấy thông tin schedule
        const [scheduleCheck] = await connection.query(
            'SELECT * FROM StaffSchedule WHERE ScheduleID = ? AND MechanicID = ?',
            [scheduleId, mechanicId]
        );
        
        if (scheduleCheck.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy lịch làm việc'
            });
        }
        
        const schedule = scheduleCheck[0];
        
        // Kiểm tra 2 ngày
        const workDate = new Date(schedule.WorkDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        workDate.setHours(0, 0, 0, 0);
        const daysUntil = Math.ceil((workDate - today) / (1000 * 60 * 60 * 24));
        
        if (daysUntil < 2) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: `Chỉ có thể xin sửa lịch trước 2 ngày. Còn ${daysUntil} ngày nữa đến ngày làm việc.`
            });
        }
        
        // Kiểm tra booking
        const [relatedAppointments] = await connection.query(
            `SELECT AppointmentID FROM Appointments 
             WHERE MechanicID = ? AND DATE(AppointmentDate) = ?
             AND Status NOT IN ('Canceled', 'Completed') AND IsDeleted = 0`,
            [mechanicId, schedule.WorkDate]
        );
        
        if (relatedAppointments.length > 0) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Lịch này đã có khách đặt, không thể xin sửa. Nếu cần, bạn chỉ có thể xin nghỉ.'
            });
        }
        
        // Tạo JSON lưu thông tin xin sửa
        const editRequestData = {
            editRequest: {
                newWorkDate: newWorkDate,
                newStartTime: newStartTime,
                newEndTime: newEndTime,
                reason: reason.trim(),
                requestedAt: new Date().toISOString(),
                originalWorkDate: schedule.WorkDate,
                originalStartTime: schedule.StartTime,
                originalEndTime: schedule.EndTime
            }
        };
        
        // Cập nhật schedule
        await connection.query(
            `UPDATE StaffSchedule 
             SET Status = 'PendingEdit', Notes = ?
             WHERE ScheduleID = ?`,
            [JSON.stringify(editRequestData), scheduleId]
        );
        
        // Gửi notification cho Admin
        const [mechanicInfo] = await connection.query(
            'SELECT FullName, PhoneNumber FROM Users WHERE UserID = ?',
            [mechanicId]
        );
        
        const oldDateStr = new Date(schedule.WorkDate).toLocaleDateString('vi-VN');
        const newDateStr = new Date(newWorkDate).toLocaleDateString('vi-VN');
        
        const [admins] = await connection.query(
            'SELECT UserID FROM Users WHERE RoleID = 1 AND Status = 1'
        );
        
        for (const admin of admins) {
            await connection.query(
                `INSERT INTO Notifications (UserID, Title, Message, Type, IsRead, CreatedAt)
                 VALUES (?, ?, ?, 'schedule_edit_request', 0, NOW())`,
                [
                    admin.UserID,
                    'Đơn xin sửa lịch',
                    `${mechanicInfo[0]?.FullName || 'KTV'} xin sửa lịch từ ${oldDateStr} sang ${newDateStr}.\n\nLý do: ${reason.trim()}`
                ]
            );
        }
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Đã gửi đơn xin sửa lịch. Vui lòng đợi Admin duyệt.'
        });
        
    } catch (error) {
        await connection.rollback();
        console.error('Lỗi khi gửi đơn xin sửa:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    } finally {
        connection.release();
    }
});

/**
 * API: Kiểm tra lịch có booking (khách đặt) chưa
 * GET /api/mechanics/schedules/check-booking/:id
 */
router.get('/schedules/check-booking/:id', authenticateToken, checkMechanicAccess, async (req, res) => {
    try {
        const scheduleId = req.params.id;
        const mechanicId = req.user.userId;
        
        // Lấy thông tin schedule
        const [scheduleCheck] = await pool.query(
            'SELECT * FROM StaffSchedule WHERE ScheduleID = ? AND MechanicID = ?',
            [scheduleId, mechanicId]
        );
        
        if (scheduleCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy lịch làm việc'
            });
        }
        
        const schedule = scheduleCheck[0];
        
        // Kiểm tra booking trong ngày đó
        const [relatedAppointments] = await pool.query(
            `SELECT AppointmentID, AppointmentDate, Status, Notes 
             FROM Appointments 
             WHERE MechanicID = ? 
             AND DATE(AppointmentDate) = ?
             AND Status NOT IN ('Canceled', 'Completed')
             AND IsDeleted = 0`,
            [mechanicId, schedule.WorkDate]
        );
        
        res.json({
            success: true,
            scheduleId: scheduleId,
            hasBooking: relatedAppointments.length > 0,
            bookingCount: relatedAppointments.length,
            message: relatedAppointments.length > 0 
                ? `Lịch này đã có ${relatedAppointments.length} khách đặt. Không thể sửa.`
                : 'Lịch chưa có khách đặt'
        });
        
    } catch (error) {
        console.error('Lỗi khi kiểm tra booking:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

/**
 * API: Kiểm tra overlap 4 tiếng
 * POST /api/mechanics/schedules/check-overlap
 * Body: { date, startTime, endTime, excludeScheduleId }
*/
router.post('/schedules/check-overlap', authenticateToken, checkMechanicAccess, async (req, res) => {
    try {
        const { date, startTime, endTime, excludeScheduleId } = req.body;
        const mechanicId = req.user.userId;
        
        if (!date || !startTime || !endTime) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu thông tin ngày giờ'
            });
        }
        
        // Tạo datetime
        const requestStart = new Date(`${date}T${startTime}`);
        const requestEnd = new Date(`${date}T${endTime}`);
        
        // Tính 4 tiếng trước và sau
        const fourHoursBefore = new Date(requestStart.getTime() - 4 * 60 * 60 * 1000);
        const fourHoursAfter = new Date(requestStart.getTime() + 4 * 60 * 60 * 1000);
        
        // Query kiểm tra overlap
        let query = `
            SELECT 
                ss.*,
                u.FullName as MechanicName
            FROM StaffSchedule ss
            JOIN Users u ON ss.MechanicID = u.UserID
            WHERE ss.MechanicID = ?
            AND ss.WorkDate = ?
            AND ss.Type = 'available'
            AND ss.IsAvailable = 1
            AND (
                (ss.StartTime < ? AND ss.EndTime > ?)
                OR (ss.StartTime >= ? AND ss.StartTime < ?)
            )
        `;
        
        const params = [
            mechanicId,
            date,
            fourHoursAfter.toISOString(),
            fourHoursBefore.toISOString(),
            fourHoursBefore.toISOString(),
            fourHoursAfter.toISOString()
        ];
        
        // Loại trừ schedule hiện tại nếu đang edit
        if (excludeScheduleId) {
            query += ' AND ss.ScheduleID != ?';
            params.push(excludeScheduleId);
        }
        
        const [overlaps] = await pool.query(query, params);
        
        res.json({
            success: true,
            hasOverlap: overlaps.length > 0,
            overlaps: overlaps
        });
        
    } catch (error) {
        console.error('Lỗi khi kiểm tra overlap:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

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
 * API: Đăng ký lịch làm việc mới
 * POST /api/mechanics/schedules
 */
router.post('/schedules', authenticateToken, checkMechanicAccess, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const { validationStartTime, validationEndTime, type, notes, WorkDate, StartTime, EndTime, Type, IsAvailable } = req.body;
        const mechanicId = req.user.userId;
        
        // Parse dữ liệu
        const isUnavailable = type === 'unavailable' || Type === 'unavailable' || IsAvailable === 0;
        
        // ===== THÊM VALIDATION 1: Thời gian tối thiểu 4 tiếng =====
        if (!isUnavailable && validationStartTime && validationEndTime) {
            const startDateTime = new Date(validationStartTime);
            const endDateTime = new Date(validationEndTime);
            const hoursDiff = (endDateTime - startDateTime) / (1000 * 60 * 60);
            
            if (hoursDiff < 4) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Thời gian làm việc tối thiểu phải 4 tiếng'
                });
            }
        }
        
        // ===== THÊM VALIDATION 2: Số lượng KTV (max 6) =====
        const workDate = WorkDate || (startTime ? new Date(startTime).toISOString().split('T')[0] : null);
        if (workDate && !isUnavailable) {
            const [countResult] = await connection.query(
                `SELECT COUNT(DISTINCT MechanicID) as mechanicCount
                 FROM StaffSchedule
                 WHERE WorkDate = ? 
                 AND Type = 'available' 
                 AND IsAvailable = 1`,
                [workDate]
            );
            
            if (countResult[0].mechanicCount >= 6) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Đã đủ 6 kỹ thuật viên đăng ký ngày này. Vui lòng chọn ngày khác.'
                });
            }
        }
        
        // ===== THÊM VALIDATION 3: Overlap 4 tiếng =====
        if (!isUnavailable && startTime && endTime && workDate) {
            const requestStart = new Date(startTime);
            const fourHoursBefore = new Date(requestStart.getTime() - 4 * 60 * 60 * 1000);
            const fourHoursAfter = new Date(requestStart.getTime() + 4 * 60 * 60 * 1000);
            
            const [overlaps] = await connection.query(
                `SELECT ss.*, u.FullName as MechanicName
                 FROM StaffSchedule ss
                 JOIN Users u ON ss.MechanicID = u.UserID
                 WHERE ss.MechanicID = ?
                 AND ss.WorkDate = ?
                 AND ss.Type = 'available'
                 AND ss.IsAvailable = 1
                 AND (
                     (ss.StartTime < ? AND ss.EndTime > ?)
                     OR (ss.StartTime >= ? AND ss.StartTime < ?)
                 )`,
                [
                    mechanicId,
                    workDate,
                    fourHoursAfter.toISOString(),
                    fourHoursBefore.toISOString(),
                    fourHoursBefore.toISOString(),
                    fourHoursAfter.toISOString()
                ]
            );
            
            if (overlaps.length > 0) {
                await connection.rollback();
                const existingTime = new Date(overlaps[0].StartTime).toLocaleTimeString('vi-VN', {
                    hour: '2-digit',
                    minute: '2-digit'
                });
                return res.status(400).json({
                    success: false,
                    message: `Bạn đã có lịch lúc ${existingTime}. Phải cách nhau tối thiểu 4 tiếng.`
                });
            }
        }
        // ===== KẾT THÚC VALIDATION MỚI =====
        
        // Kiểm tra dữ liệu đầu vào (code gốc)
        if (!startTime || !endTime) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp đầy đủ thời gian bắt đầu và kết thúc'
            });
        }
        
        // Parse datetime để lấy WorkDate, StartTime, EndTime
        const startDate = new Date(startTime);
        const endDate = new Date(endTime);
        
        const scheduleWorkDate = startDate.toISOString().split('T')[0];
        const startTimeOnly = startDate.toTimeString().split(' ')[0];
        const endTimeOnly = endDate.toTimeString().split(' ')[0];
        
        // Kiểm tra thời gian hợp lệ
        if (startDate >= endDate) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Thời gian kết thúc phải sau thời gian bắt đầu'
            });
        }
        
        // Kiểm tra trùng lịch (code gốc - giữ lại để double check)
        const [overlappingSchedules] = await connection.query(
            `SELECT * FROM StaffSchedule 
             WHERE MechanicID = ? AND WorkDate = ?
             AND ((StartTime <= ? AND EndTime > ?) OR (StartTime < ? AND EndTime >= ?) OR (StartTime >= ? AND EndTime <= ?))`,
            [mechanicId, scheduleWorkDate, startTimeOnly, startTimeOnly, endTimeOnly, endTimeOnly, startTimeOnly, endTimeOnly]
        );
        
        if (overlappingSchedules.length > 0) {
            await connection.rollback();
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
            [mechanicId, scheduleWorkDate, startTimeOnly, endTimeOnly, type || 'available', 'Pending', notes || null, 1]
        );
        
        const scheduleId = result.insertId;
        
        // Thông báo cho admin
        const [adminUsers] = await connection.query(
            'SELECT UserID FROM Users WHERE RoleID = 1'
        );
        
        for (const admin of adminUsers) {
            await connection.query(
                'INSERT INTO Notifications (UserID, Title, Message, Type, ReferenceID) VALUES (?, ?, ?, ?, ?)',
                [
                    admin.UserID,
                    'Lịch làm việc mới cần phê duyệt',
                    `Kỹ thuật viên ID ${mechanicId} đã đăng ký lịch làm việc mới vào ngày ${scheduleWorkDate}`,
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


// ========== ROUTE SỬA: PUT /schedules/:id - THÊM VALIDATION ==========
/**
 * API: Cập nhật lịch làm việc
 * PUT /api/mechanics/schedules/:id
 */
router.put('/schedules/:id', authenticateToken, checkMechanicAccess, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const scheduleId = req.params.id;
        const { startTime, endTime, type, notes, Notes: notesUppercase, WorkDate, StartTime, EndTime, Type, IsAvailable, Status } = req.body;
        const mechanicId = req.user.userId;
        
        // Support cả notes và Notes (lowercase và uppercase)
        const finalNotes = notesUppercase || notes;
        
        // Parse dữ liệu
        const isUnavailable = type === 'unavailable' || Type === 'unavailable' || IsAvailable === 0;
        const workDate = WorkDate || (startTime ? new Date(startTime).toISOString().split('T')[0] : null);
        
        // ===== THÊM VALIDATION 1: Thời gian tối thiểu 4 tiếng =====
        if (!isUnavailable && startTime && endTime) {
            const startDateTime = new Date(startTime);
            const endDateTime = new Date(endTime);
            const hoursDiff = (endDateTime - startDateTime) / (1000 * 60 * 60);
            
            if (hoursDiff < 4) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Thời gian làm việc tối thiểu phải 4 tiếng'
                });
            }
        }
        
        // ===== THÊM VALIDATION 2: Số lượng KTV (chỉ khi đổi ngày) =====
        if (workDate && !isUnavailable) {
            const [oldSchedule] = await connection.query(
                'SELECT WorkDate FROM StaffSchedule WHERE ScheduleID = ?',
                [scheduleId]
            );
            
            if (oldSchedule.length > 0 && oldSchedule[0].WorkDate !== workDate) {
                const [countResult] = await connection.query(
                    `SELECT COUNT(DISTINCT MechanicID) as mechanicCount
                     FROM StaffSchedule
                     WHERE WorkDate = ? 
                     AND Type = 'available' 
                     AND IsAvailable = 1
                     AND ScheduleID != ?`,
                    [workDate, scheduleId]
                );
                
                if (countResult[0].mechanicCount >= 6) {
                    await connection.rollback();
                    return res.status(400).json({
                        success: false,
                        message: 'Đã đủ 6 kỹ thuật viên đăng ký ngày này.'
                    });
                }
            }
        }
        
        // ===== THÊM VALIDATION 3: Overlap 4 tiếng =====
        if (!isUnavailable && startTime && endTime && workDate) {
            const requestStart = new Date(startTime);
            const fourHoursBefore = new Date(requestStart.getTime() - 4 * 60 * 60 * 1000);
            const fourHoursAfter = new Date(requestStart.getTime() + 4 * 60 * 60 * 1000);
            
            const [overlaps] = await connection.query(
                `SELECT ss.*, u.FullName as MechanicName
                 FROM StaffSchedule ss
                 JOIN Users u ON ss.MechanicID = u.UserID
                 WHERE ss.MechanicID = ?
                 AND ss.WorkDate = ?
                 AND ss.Type = 'available'
                 AND ss.IsAvailable = 1
                 AND ss.ScheduleID != ?
                 AND (
                     (ss.StartTime < ? AND ss.EndTime > ?)
                     OR (ss.StartTime >= ? AND ss.StartTime < ?)
                 )`,
                [
                    mechanicId,
                    workDate,
                    scheduleId,
                    fourHoursAfter.toISOString(),
                    fourHoursBefore.toISOString(),
                    fourHoursBefore.toISOString(),
                    fourHoursAfter.toISOString()
                ]
            );
            
            if (overlaps.length > 0) {
                await connection.rollback();
                const existingTime = new Date(overlaps[0].StartTime).toLocaleTimeString('vi-VN', {
                    hour: '2-digit',
                    minute: '2-digit'
                });
                return res.status(400).json({
                    success: false,
                    message: `Bạn đã có lịch lúc ${existingTime}. Phải cách nhau tối thiểu 4 tiếng.`
                });
            }
        }
        // ===== KẾT THÚC VALIDATION MỚI =====
        
        // Verify schedule belongs to this mechanic
        const [scheduleCheck] = await connection.query(
            'SELECT * FROM StaffSchedule WHERE ScheduleID = ? AND MechanicID = ?',
            [scheduleId, mechanicId]
        );
        
        if (scheduleCheck.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy lịch làm việc hoặc bạn không có quyền chỉnh sửa'
            });
        }
        
        // ===== CHECK BOOKING: Không cho sửa lịch đã có khách đặt =====
        const schedule = scheduleCheck[0];
        const [relatedAppointments] = await connection.query(
            `SELECT AppointmentID, AppointmentDate, Status, Notes 
             FROM Appointments 
             WHERE MechanicID = ? 
             AND DATE(AppointmentDate) = ?
             AND Status NOT IN ('Canceled', 'Completed')
             AND IsDeleted = 0`,
            [mechanicId, schedule.WorkDate]
        );

        if (relatedAppointments.length > 0) {
            // Nếu là đơn xin nghỉ (Type = unavailable) thì vẫn cho phép
            if (Type !== 'unavailable' && IsAvailable !== 0) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Không thể sửa lịch đã có khách đặt. Bạn chỉ có thể xin nghỉ nếu cần.',
                    hasBooking: true,
                    bookingCount: relatedAppointments.length
                });
            }
        }
        // ===== KẾT THÚC CHECK BOOKING =====
        
        // Chuẩn bị dữ liệu update
        let updateData = {};
        
        // ✅ Chỉ thêm Notes nếu có giá trị + Kiểm tra editRequest
        if (finalNotes !== undefined) {
            updateData.Notes = finalNotes;
            
            // Parse JSON để kiểm tra có editRequest/leave request
            try {
                const notesJson = JSON.parse(finalNotes);
                
                // Nếu có editRequest hoặc type = 'edit' → Set Pending
                if (notesJson.type === 'edit' || notesJson.editRequest) {
                    updateData.Status = 'PendingEdit';
                    console.log('✅ Phát hiện editRequest → Set Status = PendingEdit');
                }
                // Nếu type = 'leave' → Set Pending
                else if (notesJson.type === 'leave') {
                    updateData.Status = 'PendingLeave';
                    console.log('✅ Phát hiện leave request → Set Status = PendingLeave');
                }
            } catch (e) {
                // Không phải JSON, bỏ qua
            }
        }
        
        // Xử lý 2 formats: ISO datetime hoặc HH:MM
        if (startTime && endTime) {
            // Format 1: ISO datetime (startTime/endTime)
            if (startTime.includes('T')) {
                updateData.StartTime = startTime;
                updateData.EndTime = endTime;
                updateData.WorkDate = new Date(startTime).toISOString().split('T')[0];
            } 
            // Format 2: HH:MM (StartTime/EndTime)
            else {
                updateData.WorkDate = WorkDate;
                updateData.StartTime = new Date(`${WorkDate}T${startTime}`).toISOString();
                updateData.EndTime = new Date(`${WorkDate}T${endTime}`).toISOString();
            }
        }
        
        // Cập nhật Type và IsAvailable
        if (Type !== undefined) {
            updateData.Type = Type;
        }
        if (IsAvailable !== undefined) {
            updateData.IsAvailable = IsAvailable;
        }
        if (Status !== undefined) {
            updateData.Status = Status;
        }
        
        // Build UPDATE query
        const updateFields = Object.keys(updateData).map(key => `${key} = ?`).join(', ');
        const updateValues = [...Object.values(updateData), scheduleId];
        
        await connection.query(
            `UPDATE StaffSchedule SET ${updateFields} WHERE ScheduleID = ?`,
            updateValues
        );
        
        // Gửi notification cho admin
        // Kiểm tra xem có editRequest hay leave request không
        let hasRequest = false;
        let requestType = '';
        
        try {
            if (finalNotes) {
                const notesJson = JSON.parse(finalNotes);
                if (notesJson.type === 'edit' || notesJson.editRequest) {
                    hasRequest = true;
                    requestType = 'edit';
                } else if (notesJson.type === 'leave') {
                    hasRequest = true;
                    requestType = 'leave';
                }
            }
        } catch (e) {}
        
        // Nếu có request (edit hoặc leave) → Gửi notification
        if (hasRequest || Type === 'unavailable' || IsAvailable === 0) {
            const [mechanicInfo] = await connection.query(
                'SELECT FullName, PhoneNumber FROM Users WHERE UserID = ?',
                [mechanicId]
            );
            
            if (mechanicInfo.length > 0) {
                const scheduleWorkDate = updateData.WorkDate || scheduleCheck[0].WorkDate;
                const dateStr = new Date(scheduleWorkDate).toLocaleDateString('vi-VN', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
                
                const [adminUsers] = await connection.query(
                    'SELECT UserID FROM Users WHERE RoleID = 1'
                );
                
                let notifTitle, notifMessage, notifType;
                
                if (requestType === 'edit') {
                    // Đơn xin sửa lịch
                    try {
                        const notesJson = JSON.parse(finalNotes);
                        const editReq = notesJson.editRequest;
                        if (editReq) {
                            const newDate = new Date(editReq.newWorkDate).toLocaleDateString('vi-VN');
                            notifTitle = '🔵 Đơn xin sửa lịch từ kỹ thuật viên';
                            notifMessage = `${mechanicInfo[0].FullName} (${mechanicInfo[0].PhoneNumber || 'N/A'}) xin đổi lịch:\n\n` +
                                `Từ: ${dateStr} (${scheduleCheck[0].StartTime} - ${scheduleCheck[0].EndTime})\n` +
                                `Sang: ${newDate} (${editReq.newStartTime} - ${editReq.newEndTime})\n\n` +
                                `Lý do: ${editReq.reason || 'Không có'}`;
                            notifType = 'schedule_edit_request';
                        }
                    } catch (e) {
                        notifTitle = '🔵 Đơn xin sửa lịch từ kỹ thuật viên';
                        notifMessage = `${mechanicInfo[0].FullName} đã gửi đơn xin sửa lịch.`;
                        notifType = 'schedule_edit_request';
                    }
                } else {
                    // Đơn xin nghỉ
                    notifTitle = '🔴 Đơn xin nghỉ từ kỹ thuật viên';
                    notifMessage = `${mechanicInfo[0].FullName} (${mechanicInfo[0].PhoneNumber || 'N/A'}) đã đăng ký nghỉ vào ${dateStr}.\n\nLý do: ${finalNotes || 'Không có lý do'}`;
                    notifType = 'leave_request';
                }
                
                for (const admin of adminUsers) {
                    await connection.query(
                        'INSERT INTO Notifications (UserID, Title, Message, Type, ReferenceID, IsRead) VALUES (?, ?, ?, ?, ?, ?)',
                        [
                            admin.UserID,
                            notifTitle,
                            notifMessage,
                            notifType,
                            scheduleId,
                            0
                        ]
                    );
                }
                
                console.log(`✅ Đã gửi thông báo ${requestType === 'edit' ? 'xin sửa lịch' : 'xin nghỉ'} từ ${mechanicInfo[0].FullName} cho ${adminUsers.length} admin(s)`);
            }
        }
        
        await connection.commit();
        
        const successMessage = (Type === 'unavailable' || IsAvailable === 0)
            ? 'Đơn xin nghỉ đã được gửi đến admin. Vui lòng chờ phê duyệt.'
            : 'Cập nhật lịch làm việc thành công!';
        
        res.json({
            success: true,
            message: successMessage
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
        
        // Kiểm tra trạng thái hợp lệ (Pending, PendingLeave, hoặc PendingEdit)
        if (!['Pending', 'PendingLeave', 'PendingEdit'].includes(schedule.Status)) {
            return res.status(400).json({
                success: false,
                message: 'Lịch làm việc không ở trạng thái chờ phê duyệt'
            });
        }
        
        // Xác định loại request
        const isLeaveRequest = schedule.Status === 'PendingLeave';
        const isEditRequest = schedule.Status === 'PendingEdit';
        
        let newStatus = 'Approved';
        let notificationTitle = 'Lịch làm việc đã được phê duyệt';
        let notificationMessage = `Lịch làm việc ngày ${schedule.WorkDate} từ ${schedule.StartTime} đến ${schedule.EndTime} đã được phê duyệt.`;
        
        if (isLeaveRequest) {
            newStatus = 'ApprovedLeave';
            notificationTitle = 'Đơn xin nghỉ đã được duyệt';
            notificationMessage = `Đơn xin nghỉ ngày ${schedule.WorkDate} đã được Admin duyệt. Bạn được phép nghỉ ca này.`;
        } else if (isEditRequest) {
            // Parse edit request từ Notes
            let editData = null;
            try {
                const notesData = JSON.parse(schedule.Notes || '{}');
                editData = notesData.editRequest;
            } catch (e) {
                console.error('Lỗi parse edit request:', e);
            }
            
            if (editData) {
                // Giữ lại Notes với flag approved để frontend nhận diện
                const approvedNotes = JSON.stringify({
                    editRequest: editData,
                    approved: true,
                    approvedAt: new Date().toISOString()
                });
                
                // Cập nhật lịch với thông tin mới và Status = ApprovedEdit
                await connection.query(
                    `UPDATE StaffSchedule 
                     SET WorkDate = ?, StartTime = ?, EndTime = ?, 
                         Status = 'ApprovedEdit', Notes = ?, UpdatedAt = NOW()
                     WHERE ScheduleID = ?`,
                    [editData.newWorkDate, editData.newStartTime, editData.newEndTime, approvedNotes, scheduleId]
                );
                
                const oldDateStr = new Date(editData.originalWorkDate).toLocaleDateString('vi-VN');
                const newDateStr = new Date(editData.newWorkDate).toLocaleDateString('vi-VN');
                
                notificationTitle = 'Đơn xin sửa lịch đã được duyệt';
                notificationMessage = `Đơn xin sửa lịch từ ${oldDateStr} sang ${newDateStr} (${editData.newStartTime} - ${editData.newEndTime}) đã được Admin duyệt.`;
                
                // Thông báo cho kỹ thuật viên
                await connection.query(
                    'INSERT INTO Notifications (UserID, Title, Message, Type, ReferenceID) VALUES (?, ?, ?, ?, ?)',
                    [schedule.MechanicID, notificationTitle, notificationMessage, 'schedule', scheduleId]
                );
                
                await connection.commit();
                
                return res.json({
                    success: true,
                    message: 'Duyệt đơn xin sửa lịch thành công'
                });
            } else {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Không tìm thấy thông tin xin sửa lịch'
                });
            }
        }
        
        // Cập nhật trạng thái (cho Pending và PendingLeave)
        await connection.query(
            'UPDATE StaffSchedule SET Status = ?, UpdatedAt = NOW() WHERE ScheduleID = ?',
            [newStatus, scheduleId]
        );
        
        // Thông báo cho kỹ thuật viên
        await connection.query(
            'INSERT INTO Notifications (UserID, Title, Message, Type, ReferenceID) VALUES (?, ?, ?, ?, ?)',
            [
                schedule.MechanicID,
                notificationTitle,
                notificationMessage,
                'schedule',
                scheduleId
            ]
        );
        
        await connection.commit();
        
        res.json({
            success: true,
            message: isLeaveRequest ? 'Duyệt đơn xin nghỉ thành công' : 'Phê duyệt lịch làm việc thành công'
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
        
        // Kiểm tra trạng thái hợp lệ (Pending, PendingLeave, hoặc PendingEdit)
        if (!['Pending', 'PendingLeave', 'PendingEdit'].includes(schedule.Status)) {
            return res.status(400).json({
                success: false,
                message: 'Lịch làm việc không ở trạng thái chờ phê duyệt'
            });
        }
        
        // Xác định loại request
        const isLeaveRequest = schedule.Status === 'PendingLeave';
        const isEditRequest = schedule.Status === 'PendingEdit';
        
        let newStatus = 'Rejected';
        let notificationTitle = 'Lịch làm việc bị từ chối';
        let notificationMessage = `Lịch làm việc ngày ${schedule.WorkDate} đã bị từ chối. Lý do: ${reason || 'Không có lý do cụ thể.'}`;
        
        if (isLeaveRequest) {
            newStatus = 'RejectedLeave';
            notificationTitle = 'Đơn xin nghỉ bị từ chối';
            notificationMessage = `Đơn xin nghỉ ngày ${schedule.WorkDate} đã bị Admin từ chối. ${reason ? 'Lý do: ' + reason : 'Vui lòng liên hệ Admin để biết thêm chi tiết.'}`;
            
            // Đổi lại Type thành available
            await connection.query(
                'UPDATE StaffSchedule SET Status = ?, Type = ?, IsAvailable = 1, UpdatedAt = NOW() WHERE ScheduleID = ?',
                [newStatus, 'available', scheduleId]
            );
        } else if (isEditRequest) {
            // Parse edit request để lấy thông tin hiển thị
            let editData = null;
            try {
                const notesData = JSON.parse(schedule.Notes || '{}');
                editData = notesData.editRequest;
            } catch (e) {}
            
            notificationTitle = 'Đơn xin sửa lịch bị từ chối';
            notificationMessage = `Đơn xin sửa lịch ngày ${schedule.WorkDate} đã bị Admin từ chối. ${reason ? 'Lý do: ' + reason : 'Vui lòng liên hệ Admin để biết thêm chi tiết.'}`;
            
            // Giữ lại Notes với flag rejected
            const rejectedNotes = JSON.stringify({
                editRequest: editData,
                rejected: true,
                rejectedAt: new Date().toISOString(),
                rejectedReason: reason || null
            });
            
            // Đổi status thành RejectedEdit và giữ Notes
            await connection.query(
                'UPDATE StaffSchedule SET Status = ?, Notes = ?, UpdatedAt = NOW() WHERE ScheduleID = ?',
                ['RejectedEdit', rejectedNotes, scheduleId]
            );
        } else {
            await connection.query(
                'UPDATE StaffSchedule SET Status = ?, UpdatedAt = NOW() WHERE ScheduleID = ?',
                [newStatus, scheduleId]
            );
        }
        
        // Thông báo cho kỹ thuật viên
        await connection.query(
            'INSERT INTO Notifications (UserID, Title, Message, Type, ReferenceID) VALUES (?, ?, ?, ?, ?)',
            [
                schedule.MechanicID,
                notificationTitle,
                notificationMessage,
                'schedule',
                scheduleId
            ]
        );
        
        await connection.commit();
        
        let successMessage = 'Từ chối lịch làm việc thành công';
        if (isLeaveRequest) successMessage = 'Từ chối đơn xin nghỉ thành công';
        if (isEditRequest) successMessage = 'Từ chối đơn xin sửa lịch thành công';
        
        res.json({
            success: true,
            message: successMessage
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
// LEAVE REQUEST APIs (Quản lý đơn xin nghỉ)
// ============================================

/**
 * API: Lấy thống kê đơn xin nghỉ (Admin)
 * GET /api/mechanics/leave-requests/stats
 */
router.get('/leave-requests/stats', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        // Đếm số đơn xin nghỉ chờ duyệt
        const [pendingLeaveResult] = await pool.query(`
            SELECT COUNT(*) as count 
            FROM StaffSchedule 
            WHERE Status = 'PendingLeave'
        `);
        
        // Đếm số đơn xin sửa chờ duyệt
        const [pendingEditResult] = await pool.query(`
            SELECT COUNT(*) as count 
            FROM StaffSchedule 
            WHERE Status = 'PendingEdit'
        `);
        
        // Đếm số KTV nghỉ hôm nay
        const today = new Date().toISOString().split('T')[0];
        const [todayLeaveResult] = await pool.query(`
            SELECT COUNT(DISTINCT MechanicID) as count 
            FROM StaffSchedule 
            WHERE DATE(WorkDate) = ? 
            AND Type = 'unavailable' 
            AND Status IN ('Approved', 'ApprovedLeave')
        `, [today]);
        
        res.json({
            success: true,
            stats: {
                pending: pendingLeaveResult[0].count + pendingEditResult[0].count,
                pendingLeave: pendingLeaveResult[0].count,
                pendingEdit: pendingEditResult[0].count,
                todayLeave: todayLeaveResult[0].count
            }
        });
    } catch (err) {
        console.error('Error getting leave request stats:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

/**
 * API: Lấy danh sách đơn xin nghỉ + đơn xin sửa (Admin)
 * GET /api/mechanics/leave-requests
 */
router.get('/leave-requests', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        const { from, to } = req.query;
        
        let dateCondition = '';
        const params = [];
        
        if (from && to) {
            dateCondition = 'AND DATE(ss.WorkDate) BETWEEN ? AND ?';
            params.push(from, to);
        }
        
        // Lấy đơn xin nghỉ chờ duyệt
        const [pendingLeave] = await pool.query(`
            SELECT ss.*, u.FullName as MechanicName, u.PhoneNumber as Phone, 'leave' as RequestType
            FROM StaffSchedule ss
            JOIN Users u ON ss.MechanicID = u.UserID
            WHERE ss.Status = 'PendingLeave' ${dateCondition}
            ORDER BY ss.WorkDate ASC
        `, params);
        
        // Lấy đơn xin sửa chờ duyệt
        const [pendingEdit] = await pool.query(`
            SELECT ss.*, u.FullName as MechanicName, u.PhoneNumber as Phone, 'edit' as RequestType
            FROM StaffSchedule ss
            JOIN Users u ON ss.MechanicID = u.UserID
            WHERE ss.Status = 'PendingEdit' ${dateCondition}
            ORDER BY ss.WorkDate ASC
        `, params);
        
        // Gộp tất cả đơn chờ duyệt
        const pending = [...pendingLeave, ...pendingEdit];
        
        // Lấy đơn xin nghỉ đã duyệt
        const [approvedLeave] = await pool.query(`
            SELECT ss.*, u.FullName as MechanicName, u.PhoneNumber as Phone, 'leave' as RequestType
            FROM StaffSchedule ss
            JOIN Users u ON ss.MechanicID = u.UserID
            WHERE ss.Type = 'unavailable' 
            AND ss.Status IN ('Approved', 'ApprovedLeave')
            ${dateCondition}
            ORDER BY ss.WorkDate DESC
        `, params);
        
        // Lấy đơn xin sửa đã duyệt
        const [approvedEdit] = await pool.query(`
            SELECT ss.*, u.FullName as MechanicName, u.PhoneNumber as Phone, 'edit' as RequestType
            FROM StaffSchedule ss
            JOIN Users u ON ss.MechanicID = u.UserID
            WHERE ss.Status = 'ApprovedEdit'
            ${dateCondition}
            ORDER BY ss.WorkDate DESC
        `, params);
        
        // Gộp tất cả đơn đã duyệt
        const approved = [...approvedLeave, ...approvedEdit];
        
        // Lấy đơn xin nghỉ đã từ chối
        const [rejectedLeave] = await pool.query(`
            SELECT ss.*, u.FullName as MechanicName, u.PhoneNumber as Phone, 'leave' as RequestType
            FROM StaffSchedule ss
            JOIN Users u ON ss.MechanicID = u.UserID
            WHERE ss.Status = 'RejectedLeave'
            ${dateCondition}
            ORDER BY ss.WorkDate DESC
        `, params);
        
        // Lấy đơn xin sửa đã từ chối
        const [rejectedEdit] = await pool.query(`
            SELECT ss.*, u.FullName as MechanicName, u.PhoneNumber as Phone, 'edit' as RequestType
            FROM StaffSchedule ss
            JOIN Users u ON ss.MechanicID = u.UserID
            WHERE ss.Status = 'RejectedEdit'
            ${dateCondition}
            ORDER BY ss.WorkDate DESC
        `, params);
        
        // Gộp tất cả đơn đã từ chối
        const rejected = [...rejectedLeave, ...rejectedEdit];
        
        res.json({
            success: true,
            leaveRequests: {
                pending,
                approved,
                rejected
            }
        });
    } catch (err) {
        console.error('Error getting leave requests:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
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
 * API: Lấy chi tiết một lịch hẹn theo ID
 * GET /api/mechanics/appointments/:id
 */
router.get('/appointments/:id', authenticateToken, checkMechanicAccess, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        const appointmentId = req.params.id;
        
        // Lấy chi tiết lịch hẹn
        const [appointments] = await pool.query(`
            SELECT a.*, 
                   u.FullName, u.Email, u.PhoneNumber,
                   v.LicensePlate, v.Brand, v.Model, v.Year
            FROM Appointments a
            LEFT JOIN Users u ON a.UserID = u.UserID
            LEFT JOIN Vehicles v ON a.VehicleID = v.VehicleID
            WHERE a.AppointmentID = ? AND a.MechanicID = ? AND a.IsDeleted = 0
        `, [appointmentId, mechanicId]);
        
        if (appointments.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy lịch hẹn hoặc bạn không có quyền xem'
            });
        }
        
        const appointment = appointments[0];
        
        // Lấy danh sách dịch vụ của lịch hẹn
        const [services] = await pool.query(`
            SELECT s.ServiceID, s.ServiceName, s.Description, aps.Price, aps.Quantity
            FROM AppointmentServices aps
            JOIN Services s ON aps.ServiceID = s.ServiceID
            WHERE aps.AppointmentID = ?
        `, [appointmentId]);
        
        appointment.services = services;
        
        // Tính tổng tiền
        appointment.totalAmount = services.reduce((sum, s) => sum + (s.Price * (s.Quantity || 1)), 0);
        
        res.json({
            success: true,
            appointment
        });
    } catch (err) {
        console.error('Lỗi khi lấy chi tiết lịch hẹn:', err);
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


// ========== BONUS ROUTES: ADMIN QUẢN LÝ ĐơN XIN NGHỈ ==========

/**
 * API: Admin xem danh sách đơn xin nghỉ
 * GET /api/mechanics/leave-requests
 */
router.get('/leave-requests', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        const { status } = req.query; // pending, approved, rejected
        
        let query = `
            SELECT 
                ss.ScheduleID,
                ss.WorkDate,
                ss.Notes,
                ss.Status,
                ss.CreatedAt,
                u.UserID as MechanicID,
                u.FullName as MechanicName,
                u.Phone as MechanicPhone,
                u.Email as MechanicEmail
            FROM StaffSchedule ss
            JOIN Users u ON ss.MechanicID = u.UserID
            WHERE ss.Type = 'unavailable' AND ss.IsAvailable = 0
        `;
        
        const params = [];
        
        if (status) {
            query += ' AND ss.Status = ?';
            params.push(status);
        }
        
        query += ' ORDER BY ss.CreatedAt DESC';
        
        const [leaveRequests] = await pool.query(query, params);
        
        res.json({ 
            success: true, 
            data: leaveRequests,
            total: leaveRequests.length
        });
        
    } catch (error) {
        console.error('Lỗi khi lấy danh sách đơn xin nghỉ:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Lỗi server: ' + error.message 
        });
    }
});

/**
 * API: Admin duyệt/từ chối đơn xin nghỉ
 * PUT /api/mechanics/leave-requests/:id/approve
 */
router.put('/leave-requests/:id/approve', authenticateToken, checkAdminAccess, async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const scheduleId = req.params.id;
        const { approved, adminNotes } = req.body; // approved: true/false
        
        const newStatus = approved ? 'Approved' : 'Rejected';
        
        // Update status
        await connection.query(
            'UPDATE StaffSchedule SET Status = ?, AdminNotes = ? WHERE ScheduleID = ?',
            [newStatus, adminNotes || null, scheduleId]
        );
        
        // Lấy thông tin để gửi notification lại cho mechanic
        const [schedule] = await connection.query(
            `SELECT ss.*, u.FullName as MechanicName 
             FROM StaffSchedule ss 
             JOIN Users u ON ss.MechanicID = u.UserID 
             WHERE ss.ScheduleID = ?`,
            [scheduleId]
        );
        
        if (schedule.length > 0) {
            const mechanicId = schedule[0].MechanicID;
            const formattedDate = new Date(schedule[0].WorkDate).toLocaleDateString('vi-VN');
            
            const notificationTitle = approved ? 
                '✅ Đơn xin nghỉ đã được duyệt' : 
                '❌ Đơn xin nghỉ bị từ chối';
            
            const notificationMessage = approved ?
                `Đơn xin nghỉ của bạn vào ngày ${formattedDate} đã được duyệt.${adminNotes ? `\n\nGhi chú từ admin: ${adminNotes}` : ''}` :
                `Đơn xin nghỉ của bạn vào ngày ${formattedDate} đã bị từ chối.${adminNotes ? `\n\nLý do: ${adminNotes}` : ''}`;
            
            await connection.query(
                `INSERT INTO Notifications (UserID, Title, Message, Type, ReferenceID, IsRead, CreatedAt) 
                 VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                [
                    mechanicId,
                    notificationTitle,
                    notificationMessage,
                    'leave_response',
                    scheduleId,
                    0
                ]
            );
        }
        
        await connection.commit();
        
        res.json({ 
            success: true, 
            message: approved ? 'Đã duyệt đơn xin nghỉ' : 'Đã từ chối đơn xin nghỉ' 
        });
        
    } catch (error) {
        await connection.rollback();
        console.error('Lỗi khi xử lý đơn xin nghỉ:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Lỗi server: ' + error.message 
        });
    } finally {
        connection.release();
    }
});

/**
 * API: Lấy lịch của TẤT CẢ mechanics theo date range
 * GET /api/mechanics/schedules/team/by-date-range/:startDate/:endDate
 */
router.get('/schedules/team/by-date-range/:startDate/:endDate', authenticateToken, async (req, res) => {
    try {
        const { startDate, endDate } = req.params;
        
        console.log('📅 Loading team schedules:', { startDate, endDate });
        
        // ✅ FIX: Đổi từ Mechanic → Users (vì không có bảng Mechanic)
        const query = `
            SELECT 
                s.ScheduleID,
                s.MechanicID,
                s.WorkDate,
                s.StartTime,
                s.EndTime,
                s.Type,
                s.Status,
                s.IsAvailable,
                s.Notes,
                s.CreatedAt,
                s.UpdatedAt,
                u.FullName as MechanicName,
                u.PhoneNumber as MechanicPhone
            FROM StaffSchedule s
            INNER JOIN Users u ON s.MechanicID = u.UserID
            WHERE s.WorkDate BETWEEN ? AND ?
            AND u.RoleID = 3
            ORDER BY s.WorkDate ASC, s.StartTime ASC, u.FullName ASC
        `;
        
        const [schedules] = await pool.query(query, [startDate, endDate]);
        
        console.log(`✅ Found ${schedules.length} team schedules`);
        
        res.json({
            success: true,
            schedules: schedules,
            dateRange: { startDate, endDate },
            totalSchedules: schedules.length
        });
        
    } catch (err) {
        console.error('❌ Error loading team schedules:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi tải lịch nhóm: ' + err.message
        });
    }
});

/**
 * API: Đếm số mechanics làm việc mỗi ngày trong tuần
 * GET /api/mechanics/schedules/team/count-by-week/:startDate
 * Helper cho Weekly Timeline header
 */
router.get('/schedules/team/count-by-week/:startDate', authenticateToken, async (req, res) => {
    try {
        const { startDate } = req.params;
        
        // Tính endDate = startDate + 6 days (CN)
        const start = new Date(startDate);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        const endDate = end.toISOString().split('T')[0];
        
        console.log('📊 Counting mechanics by week:', { startDate, endDate });
        
        // Query đếm số mechanics mỗi ngày
        const query = `
            SELECT 
                s.WorkDate,
                COUNT(DISTINCT s.MechanicID) as MechanicCount,
                SUM(CASE WHEN s.IsAvailable = 1 THEN 1 ELSE 0 END) as WorkingCount,
                SUM(CASE WHEN s.IsAvailable = 0 THEN 1 ELSE 0 END) as LeaveCount
            FROM StaffSchedule s
            INNER JOIN Mechanic m ON s.MechanicID = m.MechanicID
            WHERE s.WorkDate BETWEEN ? AND ?
            AND m.IsDeleted = 0
            GROUP BY s.WorkDate
            ORDER BY s.WorkDate ASC
        `;
        
        const [counts] = await pool.query(query, [startDate, endDate]);
        
        console.log(`✅ Week stats: ${counts.length} days with schedules`);
        
        res.json({
            success: true,
            weekStats: counts,
            dateRange: { startDate, endDate }
        });
        
    } catch (err) {
        console.error('❌ Error counting team schedules:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi đếm lịch nhóm: ' + err.message
        });
    }
});

/**
 * API: Lấy danh sách tất cả mechanics (cho filter/dropdown)
 * GET /api/mechanics/schedules/team/mechanics-list
 */
router.get('/schedules/team/mechanics-list', authenticateToken, async (req, res) => {
    try {
        console.log('👥 Loading mechanics list');
        
        const query = `
            SELECT 
                MechanicID,
                FullName,
                Phone,
                Email
            FROM Mechanic
            WHERE IsDeleted = 0
            ORDER BY FullName ASC
        `;
        
        const [mechanics] = await pool.query(query);
        
        console.log(`✅ Found ${mechanics.length} mechanics`);
        
        res.json({
            success: true,
            mechanics: mechanics,
            totalMechanics: mechanics.length
        });
        
    } catch (err) {
        console.error('❌ Error loading mechanics list:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi tải danh sách mechanics: ' + err.message
        });
    }
});

/**
 * API: Lấy danh sách lịch hẹn của kỹ thuật viên
 * Method: GET
 * Endpoint: /api/mechanics/appointments
 */
router.get('/appointments', authenticateToken, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        const roleId = req.user.role;
        
        console.log('📋 Getting appointments for mechanicId:', mechanicId);
        
        // Chỉ cho phép mechanic (RoleID = 3) xem lịch hẹn của mình
        if (roleId !== 3) {
            return res.status(403).json({
                success: false,
                message: 'Chỉ kỹ thuật viên mới có thể xem lịch hẹn'
            });
        }
        
        // Lấy filter từ query
        const { status, dateFrom, dateTo } = req.query;
        
        // Build query
        let query = `
            SELECT 
                a.AppointmentID,
                a.UserID,
                a.VehicleID,
                a.MechanicID,
                a.AppointmentDate,
                a.EstimatedEndTime,
                a.ServiceDuration,
                a.Status,
                a.PaymentStatus,
                a.TotalAmount,
                a.PaymentMethod,
                a.Notes,
                a.CreatedAt,
                a.UpdatedAt,
                u.FullName as CustomerName,
                u.PhoneNumber as CustomerPhone,
                v.LicensePlate,
                v.Brand,
                v.Model,
                v.Year
            FROM Appointments a
            INNER JOIN Users u ON a.UserID = u.UserID
            LEFT JOIN Vehicles v ON a.VehicleID = v.VehicleID
            WHERE a.MechanicID = ?
        `;
        
        const params = [mechanicId];
        
        // Thêm filter status
        if (status) {
            query += ` AND a.Status = ?`;
            params.push(status);
        }
        
        // Thêm filter date range
        if (dateFrom) {
            query += ` AND DATE(a.AppointmentDate) >= ?`;
            params.push(dateFrom);
        }
        
        if (dateTo) {
            query += ` AND DATE(a.AppointmentDate) <= ?`;
            params.push(dateTo);
        }
        
        query += ` ORDER BY a.AppointmentDate DESC`;
        
        const [appointments] = await pool.query(query, params);
        
        // Lấy services cho mỗi appointment
        for (let appointment of appointments) {
            const [services] = await pool.query(
                `SELECT 
                    s.ServiceID,
                    s.ServiceName,
                    s.Price,
                    s.EstimatedTime,
                    aps.Quantity
                FROM AppointmentServices aps
                INNER JOIN Services s ON aps.ServiceID = s.ServiceID
                WHERE aps.AppointmentID = ?`,
                [appointment.AppointmentID]
            );
            
            appointment.Services = services;
        }
        
        console.log(`✅ Found ${appointments.length} appointments`);
        
        res.json({
            success: true,
            appointments: appointments
        });
    } catch (err) {
        console.error('❌ Error getting appointments:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

/**
 * API: Lấy chi tiết lịch hẹn
 * Method: GET
 * Endpoint: /api/mechanics/appointments/:id
 */
router.get('/appointments/:id', authenticateToken, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        const roleId = req.user.role;
        const appointmentId = req.params.id;
        
        console.log('📋 Getting appointment detail:', appointmentId);
        
        // Chỉ cho phép mechanic xem lịch hẹn của mình
        if (roleId !== 3) {
            return res.status(403).json({
                success: false,
                message: 'Không có quyền xem lịch hẹn này'
            });
        }
        
        // Lấy thông tin appointment
        const [appointments] = await pool.query(
            `SELECT 
                a.*,
                u.FullName as CustomerName,
                u.PhoneNumber as CustomerPhone,
                u.Email as CustomerEmail,
                v.LicensePlate,
                v.Brand,
                v.Model,
                v.Year
            FROM Appointments a
            INNER JOIN Users u ON a.UserID = u.UserID
            LEFT JOIN Vehicles v ON a.VehicleID = v.VehicleID
            WHERE a.AppointmentID = ? AND a.MechanicID = ?`,
            [appointmentId, mechanicId]
        );
        
        if (appointments.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy lịch hẹn'
            });
        }
        
        const appointment = appointments[0];
        
        // Lấy danh sách dịch vụ
        const [services] = await pool.query(
            `SELECT 
                s.ServiceID,
                s.ServiceName,
                s.Description,
                s.Price,
                s.EstimatedTime,
                aps.Quantity
            FROM AppointmentServices aps
            INNER JOIN Services s ON aps.ServiceID = s.ServiceID
            WHERE aps.AppointmentID = ?`,
            [appointmentId]
        );
        
        appointment.Services = services;
        
        console.log('✅ Appointment detail loaded');
        
        res.json({
            success: true,
            appointment: appointment
        });
    } catch (err) {
        console.error('❌ Error getting appointment detail:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

/**
 * API: Xác nhận lịch hẹn
 * Method: PUT
 * Endpoint: /api/mechanics/appointments/:id/confirm
 */
router.put('/appointments/:id/confirm', authenticateToken, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        const roleId = req.user.role;
        const appointmentId = req.params.id;
        
        console.log('✅ Confirming appointment:', appointmentId);
        
        // Chỉ cho phép mechanic
        if (roleId !== 3) {
            return res.status(403).json({
                success: false,
                message: 'Không có quyền xác nhận lịch hẹn'
            });
        }
        
        // Kiểm tra appointment thuộc về mechanic này
        const [appointments] = await pool.query(
            'SELECT * FROM Appointments WHERE AppointmentID = ? AND MechanicID = ?',
            [appointmentId, mechanicId]
        );
        
        if (appointments.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy lịch hẹn'
            });
        }
        
        const appointment = appointments[0];
        
        // Kiểm tra status hiện tại
        if (appointment.Status !== 'Pending') {
            return res.status(400).json({
                success: false,
                message: `Không thể xác nhận lịch hẹn có trạng thái ${appointment.Status}`
            });
        }
        
        // Cập nhật status
        await pool.query(
            'UPDATE Appointments SET Status = ?, UpdatedAt = NOW() WHERE AppointmentID = ?',
            ['Confirmed', appointmentId]
        );
        
        console.log('✅ Appointment confirmed');
        
        res.json({
            success: true,
            message: 'Đã xác nhận lịch hẹn thành công'
        });
    } catch (err) {
        console.error('❌ Error confirming appointment:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

/**
 * API: Hoàn thành công việc
 * Method: PUT
 * Endpoint: /api/mechanics/appointments/:id/complete
 */
router.put('/appointments/:id/complete', authenticateToken, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        const roleId = req.user.role;
        const appointmentId = req.params.id;
        const { notes } = req.body; // Optional completion notes
        
        console.log('✅ Completing appointment:', appointmentId);
        
        // Chỉ cho phép mechanic
        if (roleId !== 3) {
            return res.status(403).json({
                success: false,
                message: 'Không có quyền hoàn thành lịch hẹn'
            });
        }
        
        // Kiểm tra appointment thuộc về mechanic này
        const [appointments] = await pool.query(
            'SELECT * FROM Appointments WHERE AppointmentID = ? AND MechanicID = ?',
            [appointmentId, mechanicId]
        );
        
        if (appointments.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy lịch hẹn'
            });
        }
        
        const appointment = appointments[0];
        
        // Kiểm tra status hiện tại
        if (appointment.Status !== 'Confirmed') {
            return res.status(400).json({
                success: false,
                message: `Chỉ có thể hoàn thành lịch hẹn đã xác nhận. Trạng thái hiện tại: ${appointment.Status}`
            });
        }
        
        // Cập nhật status và notes nếu có
        let query = 'UPDATE Appointments SET Status = ?, UpdatedAt = NOW()';
        const params = ['Completed'];
        
        if (notes) {
            query += ', Notes = ?';
            params.push(notes);
        }
        
        query += ' WHERE AppointmentID = ?';
        params.push(appointmentId);
        
        await pool.query(query, params);
        
        console.log('✅ Appointment completed');
        
        res.json({
            success: true,
            message: 'Đã hoàn thành công việc thành công'
        });
    } catch (err) {
        console.error('❌ Error completing appointment:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

/**
 * API: Thống kê lịch hẹn của mechanic
 * Method: GET
 * Endpoint: /api/mechanics/appointments/stats
 */
router.get('/appointments-stats', authenticateToken, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        const roleId = req.user.role;
        
        console.log('📊 Getting appointment stats for mechanic:', mechanicId);
        
        // Chỉ cho phép mechanic
        if (roleId !== 3) {
            return res.status(403).json({
                success: false,
                message: 'Chỉ kỹ thuật viên mới có thể xem thống kê'
            });
        }
        
        // Thống kê theo status
        const [stats] = await pool.query(
            `SELECT 
                Status,
                COUNT(*) as count
            FROM Appointments
            WHERE MechanicID = ?
            GROUP BY Status`,
            [mechanicId]
        );
        
        // Convert to object
        const statsObj = {
            pending: 0,
            confirmed: 0,
            completed: 0,
            canceled: 0
        };
        
        stats.forEach(stat => {
            const status = stat.Status.toLowerCase();
            if (status === 'pending') statsObj.pending = stat.count;
            else if (status === 'confirmed') statsObj.confirmed = stat.count;
            else if (status === 'completed') statsObj.completed = stat.count;
            else if (status === 'canceled') statsObj.canceled = stat.count;
        });
        
        // Lịch hẹn hôm nay
        const [todayAppointments] = await pool.query(
            `SELECT COUNT(*) as count
            FROM Appointments
            WHERE MechanicID = ?
            AND DATE(AppointmentDate) = CURDATE()
            AND Status IN ('Pending', 'Confirmed')`,
            [mechanicId]
        );
        
        statsObj.today = todayAppointments[0].count;
        
        console.log('✅ Stats loaded:', statsObj);
        
        res.json({
            success: true,
            stats: statsObj
        });
    } catch (err) {
        console.error('❌ Error getting stats:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});


// ========== KẾT THÚC BONUS ROUTES ==========

module.exports = router;