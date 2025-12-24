// routes/attendanceRoutes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('./authRoutes');
const crypto = require('crypto');

// =============================================
// QR CODE GENERATION
// =============================================

/**
 * Tạo QR code mới (tự động refresh mỗi 30s)
 * GET /api/attendance/qr/generate
 */
router.get('/qr/generate', async (req, res) => {
    try {
        const now = new Date();
        const timestamp = now.getTime();
        const randomStr = crypto.randomBytes(16).toString('hex');
        
        const token = `${timestamp}_${crypto.createHash('sha256')
            .update(`${timestamp}_${randomStr}_SECRET`)
            .digest('hex')
            .substring(0, 20)}`;
        
        const expiresAt = new Date(now.getTime() + 30000); // +30s
        
        await pool.query(
            'INSERT INTO AttendanceQRCodes (QRToken, GeneratedAt, ExpiresAt) VALUES (?, ?, ?)',
            [token, now, expiresAt]
        );
        
        await pool.query('DELETE FROM AttendanceQRCodes WHERE ExpiresAt < NOW()');
        
        res.json({
            success: true,
            token: token,
            expiresAt: expiresAt.toISOString(),
            validFor: 30
        });
    } catch (err) {
        console.error('❌ QR generate error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// =============================================
// MECHANIC - CHẤM CÔNG
// =============================================

/**
 * Check-in
 * POST /api/attendance/check-in
 */
router.post('/check-in', authenticateToken, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        const { qrToken, latitude, longitude, address } = req.body;
        
        if (!qrToken || !latitude || !longitude) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin' });
        }
        
        const [qrRows] = await pool.query(
            'SELECT * FROM AttendanceQRCodes WHERE QRToken = ? AND ExpiresAt > NOW() AND IsUsed = FALSE',
            [qrToken]
        );
        
        if (qrRows.length === 0) {
            return res.status(400).json({ success: false, message: 'Mã QR không hợp lệ' });
        }
        
        const today = new Date().toISOString().split('T')[0];
        
        const [existing] = await pool.query(
            'SELECT * FROM Attendance WHERE MechanicID = ? AND AttendanceDate = ?',
            [mechanicId, today]
        );
        
        if (existing.length > 0 && existing[0].CheckInTime) {
            return res.status(400).json({ success: false, message: 'Đã chấm công vào rồi' });
        }
        
        const checkInTime = new Date();
        const hour = checkInTime.getHours();
        const minute = checkInTime.getMinutes();
        const isLate = (hour > 8) || (hour === 8 && minute > 30);
        const status = isLate ? 'Late' : 'Present';
        
        if (existing.length > 0) {
            await pool.query(
                `UPDATE Attendance SET CheckInTime = ?, CheckInLatitude = ?, CheckInLongitude = ?, 
                 CheckInAddress = ?, Status = ? WHERE AttendanceID = ?`,
                [checkInTime, latitude, longitude, address, status, existing[0].AttendanceID]
            );
        } else {
            await pool.query(
                `INSERT INTO Attendance (MechanicID, AttendanceDate, CheckInTime, CheckInLatitude, 
                  CheckInLongitude, CheckInAddress, Status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [mechanicId, today, checkInTime, latitude, longitude, address, status]
            );
        }
        
        await pool.query('UPDATE AttendanceQRCodes SET IsUsed = TRUE WHERE QRToken = ?', [qrToken]);
        
        res.json({
            success: true,
            message: isLate ? 'Chấm công vào (Đi muộn)' : 'Chấm công vào thành công',
            checkInTime: checkInTime.toISOString(),
            status: status
        });
    } catch (err) {
        console.error('❌ Check-in error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Check-out
 * POST /api/attendance/check-out
 */
router.post('/check-out', authenticateToken, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        const { qrToken, latitude, longitude, address } = req.body;
        
        if (!qrToken || !latitude || !longitude) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin' });
        }
        
        const [qrRows] = await pool.query(
            'SELECT * FROM AttendanceQRCodes WHERE QRToken = ? AND ExpiresAt > NOW() AND IsUsed = FALSE',
            [qrToken]
        );
        
        if (qrRows.length === 0) {
            return res.status(400).json({ success: false, message: 'Mã QR không hợp lệ' });
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
        
        await pool.query(
            `UPDATE Attendance SET CheckOutTime = ?, CheckOutLatitude = ?, CheckOutLongitude = ?, 
             CheckOutAddress = ? WHERE AttendanceID = ?`,
            [checkOutTime, latitude, longitude, address, attendance[0].AttendanceID]
        );
        
        await pool.query('UPDATE AttendanceQRCodes SET IsUsed = TRUE WHERE QRToken = ?', [qrToken]);
        
        const checkInTime = new Date(attendance[0].CheckInTime);
        const hours = ((checkOutTime - checkInTime) / (1000 * 60 * 60)).toFixed(2);
        
        res.json({
            success: true,
            message: 'Chấm công ra thành công',
            checkOutTime: checkOutTime.toISOString(),
            workHours: hours
        });
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
            attendance: rows[0] || null,
            hasCheckedIn: rows.length > 0 && rows[0].CheckInTime !== null,
            hasCheckedOut: rows.length > 0 && rows[0].CheckOutTime !== null
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Lịch sử
 * GET /api/attendance/history?month=2025-01
 */
router.get('/history', authenticateToken, async (req, res) => {
    try {
        const mechanicId = req.user.userId;
        const { month } = req.query;
        
        let query = `SELECT * FROM Attendance WHERE MechanicID = ?`;
        const params = [mechanicId];
        
        if (month) {
            query += ` AND DATE_FORMAT(AttendanceDate, '%Y-%m') = ?`;
            params.push(month);
        }
        
        query += ` ORDER BY AttendanceDate DESC LIMIT 31`;
        
        const [rows] = await pool.query(query, params);
        res.json({ success: true, attendance: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// =============================================
// ADMIN
// =============================================

/**
 * Danh sách hôm nay
 * GET /api/attendance/admin/today
 */
router.get('/admin/today', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 1) {
            return res.status(403).json({ success: false, message: 'Chỉ admin' });
        }
        
        const today = new Date().toISOString().split('T')[0];
        
        const [rows] = await pool.query(
            `SELECT a.*, u.FullName, u.PhoneNumber FROM Attendance a
             JOIN Users u ON a.MechanicID = u.UserID
             WHERE a.AttendanceDate = ? ORDER BY a.CheckInTime ASC`,
            [today]
        );
        
        res.json({ success: true, attendance: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Thống kê
 * GET /api/attendance/admin/stats?date=2025-01-15
 */
router.get('/admin/stats', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 1) {
            return res.status(403).json({ success: false, message: 'Chỉ admin' });
        }
        
        const date = req.query.date || new Date().toISOString().split('T')[0];
        
        const [total] = await pool.query('SELECT COUNT(*) as count FROM Users WHERE RoleID = 3');
        const [checkedIn] = await pool.query(
            'SELECT COUNT(*) as count FROM Attendance WHERE AttendanceDate = ? AND CheckInTime IS NOT NULL',
            [date]
        );
        const [late] = await pool.query(
            'SELECT COUNT(*) as count FROM Attendance WHERE AttendanceDate = ? AND Status = "Late"',
            [date]
        );
        const [checkedOut] = await pool.query(
            'SELECT COUNT(*) as count FROM Attendance WHERE AttendanceDate = ? AND CheckOutTime IS NOT NULL',
            [date]
        );
        
        res.json({
            success: true,
            stats: {
                total: total[0].count,
                checkedIn: checkedIn[0].count,
                late: late[0].count,
                checkedOut: checkedOut[0].count,
                absent: total[0].count - checkedIn[0].count
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Lịch sử tất cả
 * GET /api/attendance/admin/all?month=2025-01
 */
router.get('/admin/all', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 1) {
            return res.status(403).json({ success: false, message: 'Chỉ admin' });
        }
        
        const { month } = req.query;
        
        let query = `SELECT a.*, u.FullName, u.PhoneNumber FROM Attendance a
                     JOIN Users u ON a.MechanicID = u.UserID`;
        const params = [];
        
        if (month) {
            query += ` WHERE DATE_FORMAT(a.AttendanceDate, '%Y-%m') = ?`;
            params.push(month);
        }
        
        query += ` ORDER BY a.AttendanceDate DESC, a.CheckInTime ASC LIMIT 100`;
        
        const [rows] = await pool.query(query, params);
        res.json({ success: true, attendance: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;