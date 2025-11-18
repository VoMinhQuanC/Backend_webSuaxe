// revenueRoutes.js - API routes cho phần quản lý doanh thu

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('./authRoutes');

// Import kết nối database
const { pool } = require('../db');

// Middleware kiểm tra quyền admin (sử dụng trực tiếp trong file này thay vì import)
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
 * @route GET /api/revenue/summary
 * @desc Lấy thông tin tổng quan doanh thu
 * @access Private (Admin only)
 */
router.get('/summary', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        // Lấy tổng số lịch hẹn đã hoàn thành
        const [appointmentsResult] = await pool.query(
            'SELECT COUNT(*) as totalAppointments FROM Appointments WHERE Status = "Completed"'
        );
        
        // Lấy tổng doanh thu
        const [revenueResult] = await pool.query(
            'SELECT SUM(Amount) as totalRevenue FROM Payments WHERE Status = "Completed" OR Status = "Hoàn thành"'
        );
        
        // Lấy tổng số khách hàng
        const [customersResult] = await pool.query(
            'SELECT COUNT(DISTINCT UserID) as totalCustomers FROM Appointments'
        );
        
        // Lấy dịch vụ phổ biến nhất (dịch vụ được sử dụng nhiều nhất)
        const [popularServiceResult] = await pool.query(`
            SELECT s.ServiceName, COUNT(a.ServiceID) as serviceCount
            FROM AppointmentServices a
            JOIN Services s ON a.ServiceID = s.ServiceID
            JOIN Appointments ap ON a.AppointmentID = ap.AppointmentID
            WHERE ap.Status = "Completed" OR ap.Status = "Hoàn thành"
            GROUP BY a.ServiceID
            ORDER BY serviceCount DESC
            LIMIT 1
        `);
        
        // Tạo dữ liệu tổng quan
        const summary = {
            totalAppointments: appointmentsResult[0].totalAppointments || 0,
            totalRevenue: revenueResult[0].totalRevenue || 0,
            totalCustomers: customersResult[0].totalCustomers || 0,
            popularService: popularServiceResult[0]?.ServiceName || 'Không có dữ liệu'
        };
        
        res.json({
            success: true,
            summary
        });
        
    } catch (error) {
        console.error('Lỗi khi lấy thông tin tổng quan doanh thu:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

// API: Kiểm tra và cập nhật trạng thái thanh toán
router.post('/update-payments', authenticateToken, async (req, res) => {
    try {
        // Kiểm tra quyền admin (RoleID = 1)
        if (req.user.role !== 1) {
            return res.status(403).json({ 
                success: false, 
                message: 'Không có quyền truy cập' 
            });
        }
        
        // Lấy danh sách các thanh toán đã lên lịch và đến thời gian cập nhật
        const [scheduledPayments] = await pool.query(`
            SELECT psu.PaymentID, psu.AppointmentID
            FROM PaymentScheduledUpdates psu
            WHERE psu.ScheduledTime <= NOW()
            AND psu.IsProcessed = 0
        `);
        
        let updatedCount = 0;
        
        if (scheduledPayments.length > 0) {
            // Cập nhật trạng thái thanh toán cho các bản ghi đã lên lịch
            const [updateResult] = await pool.query(`
                UPDATE Payments p
                JOIN PaymentScheduledUpdates psu ON p.PaymentID = psu.PaymentID
                SET p.Status = 'Completed'
                WHERE psu.ScheduledTime <= NOW()
                AND psu.IsProcessed = 0
                AND p.Status = 'Pending'
            `);
            
            updatedCount += updateResult.affectedRows;
            
            // Đánh dấu các bản ghi đã xử lý
            await pool.query(`
                UPDATE PaymentScheduledUpdates
                SET IsProcessed = 1
                WHERE ScheduledTime <= NOW()
                AND IsProcessed = 0
            `);
        }
        
        res.json({
            success: true,
            updated: updatedCount,
            message: updatedCount > 0 ? `Đã cập nhật ${updatedCount} thanh toán` : 'Không có thanh toán nào cần cập nhật'
        });
    } catch (err) {
        console.error('Lỗi khi cập nhật trạng thái thanh toán:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Lỗi server: ' + err.message 
        });
    }
});

/**
 * @route GET /api/revenue
 * @desc Lấy dữ liệu doanh thu theo khoảng thời gian
 * @access Private (Admin only)
 */
router.get('/', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        // Lấy các tham số filter
        const { startDate, endDate, reportType } = req.query;
        
        // Log để debug
        console.log('Nhận được tham số:', { startDate, endDate, reportType });
        
        // Validate các tham số
        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu thông tin ngày bắt đầu hoặc ngày kết thúc'
            });
        }
        
        // Xây dựng truy vấn SQL với xử lý dữ liệu NULL tốt hơn
        let query = `
            SELECT 
                p.PaymentID,
                p.AppointmentID,
                p.UserID,
                p.Amount,
                p.PaymentMethod,
                p.PaymentDate,
                p.Status,
                COALESCE(p.CustomerName, '') as CustomerName,
                COALESCE(p.Services, '') as Services,
                COALESCE(p.MechanicName, '') as MechanicName
            FROM 
                Payments p
            WHERE 
                p.PaymentDate BETWEEN ? AND ?
                AND (p.Status = 'Completed' OR p.Status = 'Hoàn thành'`;
                
        // Bao gồm cả thanh toán đang chờ xử lý nếu người dùng yêu cầu
        const includeAll = req.query.includeAll === 'true';
        if (includeAll) {
            query += ` OR p.Status = 'Pending' OR p.Status = 'Chờ thanh toán')`;
        } else {
            query += `)`;
        }
        
        query += ` ORDER BY p.PaymentDate DESC`;
        
        // Định dạng thời gian query
        const startDateTime = `${startDate} 00:00:00`;
        const endDateTime = `${endDate} 23:59:59`;
        
        console.log('SQL query params:', [startDateTime, endDateTime]);
        
        // Thực hiện truy vấn
        const [payments] = await pool.query(query, [
            startDateTime,
            endDateTime
        ]);
        
        console.log(`Tìm thấy ${payments.length} bản ghi thanh toán`);
        
        // Kiểm tra và xử lý giá trị null/undefined
        const processedPayments = payments.map(payment => {
            // Tạo một bản sao để tránh thay đổi đối tượng gốc
            const processed = { ...payment };
            
            // Đảm bảo các trường không bị null/undefined
            processed.AppointmentID = processed.AppointmentID || '';
            processed.CustomerName = processed.CustomerName || '';
            processed.Services = processed.Services || '';
            processed.MechanicName = processed.MechanicName || '';
            processed.Amount = parseFloat(processed.Amount || 0);
            processed.PaymentMethod = processed.PaymentMethod || '';
            processed.Status = processed.Status || '';
            
            return processed;
        });
        
        // Truy vấn doanh thu theo dịch vụ
        const [serviceRevenue] = await pool.query(`
            SELECT 
                s.ServiceName,
                COUNT(aps.ServiceID) AS ServiceCount,
                SUM(s.Price * aps.Quantity) AS TotalRevenue
            FROM 
                Payments p
                JOIN Appointments a ON p.AppointmentID = a.AppointmentID
                JOIN AppointmentServices aps ON a.AppointmentID = aps.AppointmentID
                JOIN Services s ON aps.ServiceID = s.ServiceID
            WHERE 
                p.PaymentDate BETWEEN ? AND ?
                AND (p.Status = 'Completed' OR p.Status = 'Hoàn thành')
            GROUP BY 
                s.ServiceID
            ORDER BY 
                TotalRevenue DESC
        `, [
            startDateTime,
            endDateTime
        ]);
        
        // Truy vấn doanh thu theo kỹ thuật viên
        const [mechanicRevenue] = await pool.query(`
            SELECT 
                COALESCE(p.MechanicName, '') AS mechanicName,
                COUNT(DISTINCT p.AppointmentID) AS appointmentCount,
                SUM(p.Amount) AS totalRevenue,
                AVG(COALESCE(r.Rating, 0)) AS rating
            FROM 
                Payments p
                LEFT JOIN Appointments a ON p.AppointmentID = a.AppointmentID
                LEFT JOIN Reviews r ON a.AppointmentID = r.AppointmentID
            WHERE 
                p.PaymentDate BETWEEN ? AND ?
                AND (p.Status = 'Completed' OR p.Status = 'Hoàn thành')
            GROUP BY 
                p.MechanicName
            ORDER BY 
                totalRevenue DESC
        `, [
            startDateTime,
            endDateTime
        ]);
        
        res.json({
            success: true,
            revenueData: payments,
            serviceRevenueData: serviceRevenue,
            mechanicRevenueData: mechanicRevenue
        });
        
    } catch (error) {
        console.error('Lỗi khi lấy dữ liệu doanh thu:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

/**
 * @route GET /api/revenue/monthly
 * @desc Lấy dữ liệu doanh thu theo tháng
 * @access Private (Admin only)
 */
router.get('/monthly', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        const { year = new Date().getFullYear() } = req.query;
        
        // Lấy doanh thu theo từng tháng trong năm
        const [monthlyData] = await pool.query(`
            SELECT 
                MONTH(p.PaymentDate) as month,
                SUM(p.Amount) as revenue
            FROM Payments p
            WHERE (p.Status = "Completed" OR p.Status = "Hoàn thành")
            AND YEAR(p.PaymentDate) = ?
            GROUP BY MONTH(p.PaymentDate)
            ORDER BY month
        `, [year]);
        
        // Tạo dữ liệu cho 12 tháng, điền 0 cho tháng không có doanh thu
        const revenueByMonth = Array(12).fill(0);
        
        monthlyData.forEach(item => {
            if (item.month >= 1 && item.month <= 12) {
                revenueByMonth[item.month - 1] = parseFloat(item.revenue || 0);
            }
        });
        
        res.json({
            success: true,
            year: parseInt(year),
            data: revenueByMonth
        });
        
    } catch (error) {
        console.error('Lỗi khi lấy dữ liệu doanh thu theo tháng:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

/**
 * @route GET /api/revenue/services
 * @desc Lấy dữ liệu doanh thu theo từng dịch vụ
 * @access Private (Admin only)
 */
router.get('/services', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        // Tạo điều kiện truy vấn
        let dateCondition = '';
        let params = [];
        
        if (startDate && endDate) {
            dateCondition = 'AND p.PaymentDate BETWEEN ? AND ?';
            params = [`${startDate} 00:00:00`, `${endDate} 23:59:59`];
        } else if (startDate) {
            dateCondition = 'AND p.PaymentDate >= ?';
            params = [`${startDate} 00:00:00`];
        } else if (endDate) {
            dateCondition = 'AND p.PaymentDate <= ?';
            params = [`${endDate} 23:59:59`];
        }
        
        // Lấy doanh thu theo từng dịch vụ
        const [servicesData] = await pool.query(`
            SELECT 
                s.ServiceID,
                s.ServiceName,
                s.Price,
                COUNT(aps.AppointmentServiceID) as count,
                SUM(s.Price * aps.Quantity) as TotalRevenue
            FROM Services s
            LEFT JOIN AppointmentServices aps ON s.ServiceID = aps.ServiceID
            LEFT JOIN Appointments a ON aps.AppointmentID = a.AppointmentID
            LEFT JOIN Payments p ON a.AppointmentID = p.AppointmentID
            WHERE (p.Status = "Completed" OR p.Status = "Hoàn thành") ${dateCondition}
            GROUP BY s.ServiceID
            ORDER BY TotalRevenue DESC
        `, params);
        
        res.json({
            success: true,
            services: servicesData
        });
        
    } catch (error) {
        console.error('Lỗi khi lấy dữ liệu doanh thu theo dịch vụ:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

/**
 * @route GET /api/revenue/mechanics
 * @desc Lấy dữ liệu doanh thu theo từng kỹ thuật viên
 * @access Private (Admin only)
 */
router.get('/mechanics', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        // Tạo điều kiện truy vấn
        let dateCondition = '';
        let params = [];
        
        if (startDate && endDate) {
            dateCondition = 'AND p.PaymentDate BETWEEN ? AND ?';
            params = [`${startDate} 00:00:00`, `${endDate} 23:59:59`];
        } else if (startDate) {
            dateCondition = 'AND p.PaymentDate >= ?';
            params = [`${startDate} 00:00:00`];
        } else if (endDate) {
            dateCondition = 'AND p.PaymentDate <= ?';
            params = [`${endDate} 23:59:59`];
        }
        
        // Lấy doanh thu theo từng kỹ thuật viên
        const [mechanicsData] = await pool.query(`
            SELECT 
                u.UserID,
                u.FullName as mechanicName,
                COUNT(a.AppointmentID) as appointmentCount,
                SUM(p.Amount) as totalRevenue,
                AVG(COALESCE(r.Rating, 0)) as rating,
                COUNT(DISTINCT r.ReviewID) as reviewCount
            FROM Users u
            LEFT JOIN Appointments a ON u.UserID = a.MechanicID
            LEFT JOIN Payments p ON a.AppointmentID = p.AppointmentID
            LEFT JOIN Reviews r ON a.AppointmentID = r.AppointmentID
            WHERE u.RoleID = 3
            AND (p.Status IS NULL OR p.Status = "Completed" OR p.Status = "Hoàn thành") ${dateCondition}
            GROUP BY u.UserID
            ORDER BY totalRevenue DESC
        `, params);
        
        res.json({
            success: true,
            mechanics: mechanicsData
        });
        
    } catch (error) {
        console.error('Lỗi khi lấy dữ liệu doanh thu theo kỹ thuật viên:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

/**
 * @route GET /api/revenue/export/excel
 * @desc Xuất dữ liệu doanh thu ra file Excel
 * @access Private (Admin only)
 */
router.get('/export/excel', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        // Thực tế, để xuất file Excel, bạn cần sử dụng thư viện như 'exceljs' hoặc 'xlsx'
        // Ở đây chỉ là ví dụ cơ bản
        
        const { startDate, endDate } = req.query;
        
        // Tạo điều kiện truy vấn
        let dateCondition = '';
        let params = [];
        
        if (startDate && endDate) {
            dateCondition = 'WHERE p.PaymentDate BETWEEN ? AND ?';
            params = [`${startDate} 00:00:00`, `${endDate} 23:59:59`];
        } else if (startDate) {
            dateCondition = 'WHERE p.PaymentDate >= ?';
            params = [`${startDate} 00:00:00`];
        } else if (endDate) {
            dateCondition = 'WHERE p.PaymentDate <= ?';
            params = [`${endDate} 23:59:59`];
        }
        
        // Thêm điều kiện trạng thái thanh toán
        if (dateCondition) {
            dateCondition += ' AND (p.Status = "Completed" OR p.Status = "Hoàn thành")';
        } else {
            dateCondition = 'WHERE (p.Status = "Completed" OR p.Status = "Hoàn thành")';
        }
        
        // Lấy dữ liệu doanh thu chi tiết
        const [payments] = await pool.query(`
            SELECT 
                p.PaymentID, 
                p.AppointmentID, 
                p.Amount, 
                p.PaymentDate, 
                p.PaymentMethod,
                u.FullName as customerName,
                (SELECT GROUP_CONCAT(s.ServiceName SEPARATOR ', ') 
                 FROM AppointmentServices aps 
                 JOIN Services s ON aps.ServiceID = s.ServiceID 
                 WHERE aps.AppointmentID = a.AppointmentID) AS services,
                (SELECT um.FullName FROM Users um WHERE um.UserID = a.MechanicID) AS mechanicName
            FROM Payments p
            JOIN Appointments a ON p.AppointmentID = a.AppointmentID
            JOIN Users u ON a.UserID = u.UserID
            ${dateCondition}
            ORDER BY p.PaymentDate DESC
        `, params);
        
        // Trong thực tế, ở đây bạn sẽ tạo file Excel và trả về client
        // Ví dụ: sử dụng thư viện 'exceljs' để tạo file Excel
        
        // Trả về dữ liệu JSON thay vì file Excel (chỉ để demo)
        res.json({
            success: true,
            message: 'Yêu cầu xuất Excel đã được xử lý',
            data: payments
        });
        
    } catch (error) {
        console.error('Lỗi khi xuất dữ liệu doanh thu ra Excel:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});
// Export router
module.exports = router;