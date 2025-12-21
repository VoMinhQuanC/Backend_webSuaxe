// routes/dashboardRoutes.js
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('./authRoutes');

// Import kết nối database
const { pool } = require('../db');

// Middleware kiểm tra quyền admin
const checkAdminAccess = (req, res, next) => {
    if (req.user && req.user.role === 1) {
        next();
    } else {
        return res.status(403).json({
            success: false,
            message: 'Không có quyền truy cập. Yêu cầu quyền admin.'    
        });
    }
};

/**
 * @route GET /api/admin/dashboard/summary
 * @desc Lấy thống kê tổng quan dashboard
 * @access Private (Admin only)
 */
router.get('/summary', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        const today = new Date();
        const startOfDay = new Date(today.setHours(0, 0, 0, 0));
        const endOfDay = new Date(today.setHours(23, 59, 59, 999));
        
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
        
        // 1. Lịch hẹn hôm nay
        const [todayAppointments] = await pool.query(`
            SELECT COUNT(*) as count
            FROM Appointments
            WHERE AppointmentDate BETWEEN ? AND ?
            AND IsDeleted = 0
        `, [startOfDay, endOfDay]);
        
        // 2. Doanh thu tháng này
        const [monthlyRevenue] = await pool.query(`
            SELECT SUM(Amount) as total
            FROM Payments
            WHERE PaymentDate BETWEEN ? AND ?
            AND (Status = 'Completed' OR Status = 'Hoàn thành')
        `, [startOfMonth, endOfMonth]);
        
        // 3. Tổng số khách hàng (role = 3)
        const [totalCustomers] = await pool.query(`
            SELECT COUNT(*) as count
            FROM Users
            WHERE RoleID = 2
            AND Status = 1
        `);
        
        // 4. Lịch hẹn chờ xử lý (Pending)
        const [pendingAppointments] = await pool.query(`
            SELECT COUNT(*) as count
            FROM Appointments
            WHERE Status = 'Pending'
            AND IsDeleted = 0
        `);
        
        res.json({
            success: true,
            data: {
                todayAppointments: todayAppointments[0].count || 0,
                monthlyRevenue: monthlyRevenue[0].total || 0,
                totalCustomers: totalCustomers[0].count || 0,
                pendingAppointments: pendingAppointments[0].count || 0
            }
        });
        
    } catch (error) {
        console.error('Lỗi khi lấy thống kê dashboard:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

/**
 * @route GET /api/admin/dashboard/recent-booking
 * @desc Lấy danh sách lịch hẹn gần đây (10 lịch gần nhất)
 * @access Private (Admin only)
 */
router.get('/recent-booking', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        const limit = req.query.limit || 10;
        
        const [bookings] = await pool.query(`
            SELECT 
                a.AppointmentID,
                a.AppointmentDate,
                a.Status,
                u.FullName as CustomerName,
                u.PhoneNumber,
                COALESCE(
                    (SELECT GROUP_CONCAT(s.ServiceName SEPARATOR ', ')
                     FROM AppointmentServices aps
                     JOIN Services s ON aps.ServiceID = s.ServiceID
                     WHERE aps.AppointmentID = a.AppointmentID),
                    'N/A'
                ) as Services
            FROM 
                Appointments a
                LEFT JOIN Users u ON a.UserID = u.UserID
            WHERE 
                a.IsDeleted = 0
            ORDER BY 
                a.AppointmentDate DESC
            LIMIT ?
        `, [parseInt(limit)]);
        
        res.json({
            success: true,
            bookings: bookings
        });
        
    } catch (error) {
        console.error('Lỗi khi lấy lịch hẹn gần đây:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

/**
 * @route GET /api/admin/dashboard/stats
 * @desc Lấy thống kê chi tiết (appointments, services, mechanics)
 * @access Private (Admin only)
 */
router.get('/stats', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        // Thống kê theo trạng thái
        const [statusStats] = await pool.query(`
            SELECT 
                Status,
                COUNT(*) as count
            FROM Appointments
            WHERE IsDeleted = 0
            GROUP BY Status
        `);
        
        // Dịch vụ phổ biến nhất
        const [popularServices] = await pool.query(`
            SELECT 
                s.ServiceName,
                COUNT(aps.ServiceID) as count,
                SUM(s.Price * aps.Quantity) as revenue
            FROM AppointmentServices aps
            JOIN Services s ON aps.ServiceID = s.ServiceID
            JOIN Appointments a ON aps.AppointmentID = a.AppointmentID
            WHERE a.Status = 'Completed' OR a.Status = 'Hoàn thành'
            GROUP BY s.ServiceID
            ORDER BY count DESC
            LIMIT 5
        `);
        
        // Kỹ thuật viên bận nhất
        const [busiestMechanics] = await pool.query(`
            SELECT 
                u.FullName as MechanicName,
                COUNT(a.AppointmentID) as appointmentCount
            FROM Appointments a
            JOIN Users u ON a.MechanicID = u.UserID
            WHERE a.IsDeleted = 0
            AND u.RoleID = 2
            GROUP BY a.MechanicID
            ORDER BY appointmentCount DESC
            LIMIT 5
        `);
        
        res.json({
            success: true,
            data: {
                statusStats,
                popularServices,
                busiestMechanics
            }
        });
        
    } catch (error) {
        console.error('Lỗi khi lấy thống kê chi tiết:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

module.exports = router;