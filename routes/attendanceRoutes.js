// routes/attendanceRoutes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('./authRoutes');
const crypto = require('crypto');
const QRCode = require('qrcode');

// =============================================
// QR CODE GENERATION
// =============================================

/**
 * ✅ Tạo QR code và trả về ảnh PNG (Base64)
 * GET /api/attendance/qr/image
 */
router.get('/qr/image', async (req, res) => {
    try {
        const now = new Date();
        const timestamp = now.getTime();
        const randomStr = crypto.randomBytes(16).toString('hex');
        
        const token = `${timestamp}_${crypto.createHash('sha256')
            .update(`${timestamp}_${randomStr}_SECRET`)
            .digest('hex')
            .substring(0, 20)}`;
        
        const expiresAt = new Date(now.getTime() + 30000);
        
        await pool.query(
            'INSERT INTO AttendanceQRCodes (QRToken, GeneratedAt, ExpiresAt) VALUES (?, ?, ?)',
            [token, now, expiresAt]
        );
        
        await pool.query('DELETE FROM AttendanceQRCodes WHERE ExpiresAt < NOW()');
        
        const qrImage = await QRCode.toDataURL(token, {
            width: 300,
            margin: 2,
            color: { dark: '#000000', light: '#FFFFFF' }
        });
        
        res.json({
            success: true,
            token: token,
            image: qrImage,
            expiresAt: expiresAt.toISOString(),
            validFor: 30
        });
    } catch (err) {
        console.error('❌ QR image error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// =============================================
// HELPER FUNCTIONS
// =============================================

/**
 * Tìm lịch làm việc của kỹ thuật viên trong ngày
 */
async function findTodaySchedule(mechanicId, date) {
    try {
        const dayOfWeek = new Date(date).getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
        
        const [schedules] = await pool.query(
            `SELECT * FROM Schedules 
             WHERE MechanicID = ? 
             AND DayOfWeek = ? 
             AND (
                 (StartDate <= ? AND EndDate >= ?) OR
                 (StartDate <= ? AND EndDate IS NULL)
             )
             ORDER BY CreatedAt DESC
             LIMIT 1`,
            [mechanicId, dayOfWeek, date, date, date]
        );
        
        if (schedules.length > 0) {
            return schedules[0];
        }
        
        return null;
    } catch (err) {
        console.error('❌ Find schedule error:', err);
        return null;
    }
}

/**
 * Tính số giờ giữa 2 thời gian
 */
function calculateHours(startTime, endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    return parseFloat(((end - start) / (1000 * 60 * 60)).toFixed(2));
}

/**
 * Tính số giờ từ TIME values
 */
function calculateScheduledHours(startTime, endTime) {
    // startTime và endTime là TIME type từ MySQL (HH:MM:SS)
    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);
    
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    
    return parseFloat(((endMinutes - startMinutes) / 60).toFixed(2));
}

// =============================================
// MECHANIC - CHẤM CÔNG
// =============================================

/**
 * ✅ UPDATED: Check-in với schedule info
 * POST /api/attendance/check-in
 */
router.post('/check-in', authenticateToken, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        const { qrToken, latitude, longitude, address } = req.body;
        
        if (!qrToken || !latitude || !longitude) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin' });
        }
        
        // Verify QR
        const [qrRows] = await pool.query(
            'SELECT * FROM AttendanceQRCodes WHERE QRToken = ? AND ExpiresAt > NOW() AND IsUsed = FALSE',
            [qrToken]
        );
        
        if (qrRows.length === 0) {
            return res.status(400).json({ success: false, message: 'Mã QR không hợp lệ hoặc đã hết hạn' });
        }
        
        const today = new Date().toISOString().split('T')[0];
        
        // Check existing
        const [existing] = await pool.query(
            'SELECT * FROM Attendance WHERE MechanicID = ? AND AttendanceDate = ?',
            [mechanicId, today]
        );
        
        if (existing.length > 0 && existing[0].CheckInTime) {
            return res.status(400).json({ success: false, message: 'Đã chấm công vào rồi' });
        }
        
        // ✅ TÌM LỊCH LÀM VIỆC HÔM NAY
        const schedule = await findTodaySchedule(mechanicId, today);
        
        const checkInTime = new Date();
        const hour = checkInTime.getHours();
        const minute = checkInTime.getMinutes();
        
        let status = 'Present';
        let scheduledStart = null;
        let scheduledEnd = null;
        let scheduledHours = null;
        let scheduleId = null;
        let message = 'Chấm công vào thành công';
        
        if (schedule) {
            scheduleId = schedule.ScheduleID;
            scheduledStart = schedule.StartTime;
            scheduledEnd = schedule.EndTime;
            scheduledHours = calculateScheduledHours(scheduledStart, scheduledEnd);
            
            // Check late dựa trên lịch
            const [schedStartHour, schedStartMin] = scheduledStart.split(':').map(Number);
            const isLate = (hour > schedStartHour) || (hour === schedStartHour && minute > schedStartMin + 15);
            
            status = isLate ? 'Late' : 'Present';
            message = isLate 
                ? `Đi muộn! Ca làm việc: ${scheduledStart.substring(0,5)}-${scheduledEnd.substring(0,5)}`
                : `Chấm công thành công! Ca làm việc: ${scheduledStart.substring(0,5)}-${scheduledEnd.substring(0,5)}`;
        } else {
            // Không có lịch → Dùng logic cũ (8:30 AM)
            const isLate = (hour > 8) || (hour === 8 && minute > 30);
            status = isLate ? 'Late' : 'Present';
            message = isLate ? 'Chấm công vào (Đi muộn)' : 'Chấm công vào thành công (Không có lịch đăng ký)';
        }
        
        // Save to database
        if (existing.length > 0) {
            await pool.query(
                `UPDATE Attendance SET 
                 CheckInTime = ?, CheckInLatitude = ?, CheckInLongitude = ?, 
                 CheckInAddress = ?, Status = ?, ScheduleID = ?, 
                 ScheduledStartTime = ?, ScheduledEndTime = ?, ScheduledWorkHours = ?
                 WHERE AttendanceID = ?`,
                [checkInTime, latitude, longitude, address, status, scheduleId, 
                 scheduledStart, scheduledEnd, scheduledHours, existing[0].AttendanceID]
            );
        } else {
            await pool.query(
                `INSERT INTO Attendance (MechanicID, AttendanceDate, CheckInTime, CheckInLatitude, 
                  CheckInLongitude, CheckInAddress, Status, ScheduleID, ScheduledStartTime, 
                  ScheduledEndTime, ScheduledWorkHours) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [mechanicId, today, checkInTime, latitude, longitude, address, status, 
                 scheduleId, scheduledStart, scheduledEnd, scheduledHours]
            );
        }
        
        await pool.query('UPDATE AttendanceQRCodes SET IsUsed = TRUE WHERE QRToken = ?', [qrToken]);
        
        res.json({
            success: true,
            message: message,
            checkInTime: checkInTime.toISOString(),
            status: status,
            schedule: schedule ? {
                startTime: scheduledStart.substring(0,5),
                endTime: scheduledEnd.substring(0,5),
                workHours: scheduledHours
            } : null
        });
        
        console.log(`✅ Check-in: Mechanic ${mechanicId}, Schedule: ${scheduleId || 'None'}`);
    } catch (err) {
        console.error('❌ Check-in error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * ✅ UPDATED: Check-out với tính toán giờ làm
 * POST /api/attendance/check-out
 */
router.post('/check-out', authenticateToken, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        const { qrToken, latitude, longitude, address } = req.body;
        
        if (!qrToken || !latitude || !longitude) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin' });
        }
        
        // Verify QR
        const [qrRows] = await pool.query(
            'SELECT * FROM AttendanceQRCodes WHERE QRToken = ? AND ExpiresAt > NOW() AND IsUsed = FALSE',
            [qrToken]
        );
        
        if (qrRows.length === 0) {
            return res.status(400).json({ success: false, message: 'Mã QR không hợp lệ hoặc đã hết hạn' });
        }
        
        const today = new Date().toISOString().split('T')[0];
        
        const [attendance] = await pool.query(
            'SELECT * FROM Attendance WHERE MechanicID = ? AND AttendanceDate = ?',
            [mechanicId, today]
        );
        
        if (attendance.length === 0 || !attendance[0].CheckInTime) {
            return res.status(400).json({ success: false, message: 'Chưa chấm công vào' });
        }
        
        if (attendance[0].CheckOutTime) {
            return res.status(400).json({ success: false, message: 'Đã chấm công ra rồi' });
        }
        
        const checkOutTime = new Date();
        const checkInTime = new Date(attendance[0].CheckInTime);
        
        // ✅ TÍNH GIỜ LÀM THỰC TẾ
        const actualWorkHours = calculateHours(checkInTime, checkOutTime);
        
        // ✅ TÍNH TĂNG CA (nếu có lịch)
        let overtimeHours = 0;
        const scheduledHours = attendance[0].ScheduledWorkHours;
        
        if (scheduledHours && actualWorkHours > scheduledHours) {
            overtimeHours = parseFloat((actualWorkHours - scheduledHours).toFixed(2));
        }
        
        // ✅ UPDATE DATABASE
        await pool.query(
            `UPDATE Attendance SET 
             CheckOutTime = ?, CheckOutLatitude = ?, CheckOutLongitude = ?, 
             CheckOutAddress = ?, ActualWorkHours = ?, OvertimeHours = ?
             WHERE AttendanceID = ?`,
            [checkOutTime, latitude, longitude, address, actualWorkHours, overtimeHours, 
             attendance[0].AttendanceID]
        );
        
        await pool.query('UPDATE AttendanceQRCodes SET IsUsed = TRUE WHERE QRToken = ?', [qrToken]);
        
        let message = `Chấm công ra thành công! Làm ${actualWorkHours}h`;
        
        if (scheduledHours) {
            message = `Chấm công ra thành công! Làm ${actualWorkHours}h (Lịch: ${scheduledHours}h`;
            if (overtimeHours > 0) {
                message += `, Tăng ca: ${overtimeHours}h`;
            }
            message += ')';
        }
        
        res.json({
            success: true,
            message: message,
            checkOutTime: checkOutTime.toISOString(),
            actualWorkHours: actualWorkHours,
            scheduledWorkHours: scheduledHours,
            overtimeHours: overtimeHours
        });
        
        console.log(`✅ Check-out: Mechanic ${mechanicId}, Hours: ${actualWorkHours}, Overtime: ${overtimeHours}`);
    } catch (err) {
        console.error('❌ Check-out error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Trạng thái hôm nay
 * GET /api/attendance/today
 */
router.get('/today', authenticateToken, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        const today = new Date().toISOString().split('T')[0];
        
        const [rows] = await pool.query(
            `SELECT a.*, u.FullName FROM Attendance a
             JOIN Users u ON a.MechanicID = u.UserID
             WHERE a.MechanicID = ? AND a.AttendanceDate = ?`,
            [mechanicId, today]
        );
        
        res.json({
            success: true,
            attendance: rows.length > 0 ? rows[0] : null
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * ✅ NEW: Lịch sử chấm công
 * GET /api/attendance/history
 * GET /api/attendance/history?month=2025-12
 */
router.get('/history', authenticateToken, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        const { month } = req.query;
        
        console.log('📅 Getting history for mechanic:', mechanicId);
        console.log('📅 Month filter:', month);
        
        let query = `
            SELECT 
                a.AttendanceID,
                a.MechanicID,
                a.AttendanceDate,
                a.CheckInTime,
                a.CheckOutTime,
                a.Status,
                a.ScheduleID,
                a.ScheduledStartTime,
                a.ScheduledEndTime,
                a.ScheduledWorkHours,
                a.ActualWorkHours,
                a.OvertimeHours,
                a.CheckInLatitude,
                a.CheckInLongitude,
                a.CheckInAddress,
                a.CheckOutLatitude,
                a.CheckOutLongitude,
                a.CheckOutAddress,
                a.Notes
            FROM Attendance a
            WHERE a.MechanicID = ?
        `;
        
        const params = [mechanicId];
        
        // ✅ Filter by month if provided (format: YYYY-MM)
        if (month) {
            // Extract year and month from YYYY-MM
            const [year, monthNum] = month.split('-');
            query += ` AND YEAR(a.AttendanceDate) = ? AND MONTH(a.AttendanceDate) = ?`;
            params.push(parseInt(year), parseInt(monthNum));
        }
        
        query += ` ORDER BY a.AttendanceDate DESC`;
        
        console.log('📅 Query params:', params);
        
        const [attendance] = await pool.query(query, params);
        
        console.log(`✅ Found ${attendance.length} records`);
        
        res.json({
            success: true,
            attendance: attendance,
            count: attendance.length
        });
        
    } catch (error) {
        console.error('❌ Error getting attendance history:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy lịch sử chấm công: ' + error.message
        });
    }
});

// =============================================
// ADMIN - XEM CHẤM CÔNG
// =============================================

/**
 * ✅ UPDATED: Danh sách chấm công theo ngày (hỗ trợ filter)
 * GET /api/attendance/admin/today
 * GET /api/attendance/admin/today?date=2025-12-20
 */
router.get('/admin/today', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 1) {
            return res.status(403).json({ success: false, message: 'Chỉ admin' });
        }
        
        const date = req.query.date || new Date().toISOString().split('T')[0];
        
        const [rows] = await pool.query(
            `SELECT a.*, u.FullName, u.PhoneNumber FROM Attendance a
             JOIN Users u ON a.MechanicID = u.UserID
             WHERE a.AttendanceDate = ? ORDER BY a.CheckInTime ASC`,
            [date]
        );
        
        console.log(`✅ Admin view attendance for date: ${date}, found ${rows.length} records`);
        
        res.json({ 
            success: true, 
            attendance: rows,
            date: date
        });
    } catch (err) {
        console.error('❌ Admin today error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Stats
 * GET /api/attendance/admin/stats
 */
router.get('/admin/stats', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 1) {
            return res.status(403).json({ success: false, message: 'Chỉ admin' });
        }
        
        const date = req.query.date || new Date().toISOString().split('T')[0];
        
        const [rows] = await pool.query(
            'SELECT * FROM Attendance WHERE AttendanceDate = ?',
            [date]
        );
        
        const stats = {
            total: rows.length,
            checkedIn: rows.filter(r => r.CheckInTime).length,
            checkedOut: rows.filter(r => r.CheckOutTime).length,
            late: rows.filter(r => r.Status === 'Late').length,
            absent: 0
        };
        
        res.json({ success: true, stats });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;