// bookingRoutes.js - Routes cho chức năng đặt lịch
const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Service = require('../models/Service');
const { pool } = require('../db');
const { authenticateToken } = require('./authRoutes');

// API: Lấy tất cả lịch hẹn (cần quyền admin)
router.get('/appointments', authenticateToken, async (req, res) => {
    try {
        // Kiểm tra quyền admin (RoleID = 1)
        if (req.user.role !== 1) {
            return res.status(403).json({ 
                success: false, 
                message: 'Không có quyền truy cập' 
            });
        }
        
        // Lấy các tham số filter từ query
        const { dateFrom, dateTo, status } = req.query;
        
        // Validate date format (Y-m-d)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        
        const filters = {};
        if (dateFrom && dateRegex.test(dateFrom)) {
            filters.dateFrom = dateFrom;
        }
        if (dateTo && dateRegex.test(dateTo)) {
            filters.dateTo = dateTo;
        }
        if (status) {
            filters.status = status;
        }
        
        // console.log('Validated filters:', filters);
        
        // Gọi hàm với filter đã validate
        const appointments = await Booking.getAllAppointments(filters);
        
        res.json({
            success: true,
            appointments,
            totalFiltered: appointments.length
        });
    } catch (err) {
        console.error('Lỗi khi lấy danh sách lịch hẹn:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Lỗi server: ' + err.message 
        });
    }
});

// API: Lấy lịch hẹn theo ID
router.get('/appointments/:id', authenticateToken, async (req, res) => {
    try {
        const appointmentId = req.params.id;
        const appointment = await Booking.getAppointmentById(appointmentId);
        
        if (!appointment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Không tìm thấy lịch hẹn' 
            });
        }
        
        // Kiểm tra quyền truy cập: chỉ admin hoặc chủ lịch hẹn mới được xem
        if (req.user.role !== 1 && req.user.userId !== appointment.UserID) {
            return res.status(403).json({ 
                success: false, 
                message: 'Không có quyền truy cập lịch hẹn này' 
            });
        }
        
        res.json({
            success: true,
            appointment
        });
    } catch (err) {
        console.error('Lỗi khi lấy thông tin lịch hẹn:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Lỗi server: ' + err.message 
        });
    }
});

// API: Lấy lịch hẹn của người dùng hiện tại
router.get('/my-appointments', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const appointments = await Booking.getAppointmentsByUserId(userId);
        
        res.json({
            success: true,
            appointments
        });
    } catch (err) {
        console.error('Lỗi khi lấy lịch hẹn của người dùng:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Lỗi server: ' + err.message 
        });
    }
});

// API: Lấy danh sách lịch hẹn đã xóa (chỉ dành cho admin)
router.get('/admin/deleted-appointments', authenticateToken, async (req, res) => {
    try {
        // Kiểm tra quyền admin (RoleID = 1)
        if (req.user.role !== 1) {
            return res.status(403).json({ 
                success: false, 
                message: 'Không có quyền truy cập' 
            });
        }
        
        // Lấy danh sách lịch hẹn đã xóa
        const [rows] = await pool.query(`
            SELECT 
                a.AppointmentID,
                a.UserID,
                a.VehicleID, 
                a.AppointmentDate,
                a.Status,
                a.Notes,
                a.MechanicID,
                a.ServiceDuration,
                a.EstimatedEndTime,
                u.FullName,
                u.Email,
                u.PhoneNumber,
                v.LicensePlate,
                v.Brand,
                v.Model,
                v.Year,
                m.FullName as MechanicName,
                GROUP_CONCAT(s.ServiceName SEPARATOR ', ') as Services
            FROM Appointments a
            LEFT JOIN Users u ON a.UserID = u.UserID
            LEFT JOIN Vehicles v ON a.VehicleID = v.VehicleID
            LEFT JOIN Users m ON a.MechanicID = m.UserID
            LEFT JOIN AppointmentServices aps ON a.AppointmentID = aps.AppointmentID
            LEFT JOIN Services s ON aps.ServiceID = s.ServiceID
            WHERE a.IsDeleted = 1
            GROUP BY a.AppointmentID 
            ORDER BY a.AppointmentDate DESC
        `);
        
        res.json({
            success: true,
            appointments: rows,
            total: rows.length
        });
    } catch (err) {
        console.error('Lỗi khi lấy danh sách lịch hẹn đã xóa:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Lỗi server: ' + err.message 
        });
    }
});

// API: Khôi phục lịch hẹn đã xóa (chỉ dành cho admin)
router.post('/admin/appointments/:id/restore', authenticateToken, async (req, res) => {
    try {
        const appointmentId = req.params.id;
        
        // Kiểm tra quyền admin (RoleID = 1)
        if (req.user.role !== 1) {
            return res.status(403).json({ 
                success: false, 
                message: 'Không có quyền truy cập' 
            });
        }
        
        // Kiểm tra lịch hẹn có tồn tại không
        const [appointment] = await pool.query(
            'SELECT AppointmentID FROM Appointments WHERE AppointmentID = ? AND IsDeleted = 1',
            [appointmentId]
        );
        
        if (appointment.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Không tìm thấy lịch hẹn đã xóa' 
            });
        }
        
        // Khôi phục lịch hẹn
        const [result] = await pool.query(
            'UPDATE Appointments SET IsDeleted = 0 WHERE AppointmentID = ?',
            [appointmentId]
        );
        
        if (result.affectedRows === 0) {
            return res.status(400).json({
                success: false,
                message: 'Không thể khôi phục lịch hẹn'
            });
        }
        
        res.json({
            success: true,
            message: 'Khôi phục lịch hẹn thành công'
        });
    } catch (err) {
        console.error('Lỗi khi khôi phục lịch hẹn:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Lỗi server: ' + err.message 
        });
    }
});

// API cho trang dashboard admin
router.get('/admin/dashboard', authenticateToken, async (req, res) => {
    try {
        // Kiểm tra quyền admin
        if (req.user.role !== 1) {
            return res.status(403).json({ 
                success: false, 
                message: 'Không có quyền truy cập' 
            });
        }
        
        const stats = await Booking.getDashboardStats();
        const recentBookings = await Booking.getRecentBookings(5);
        
        res.json({
            success: true,
            stats: stats,
            recentBookings: recentBookings
        });
    } catch (error) {
        console.error('Lỗi khi lấy dữ liệu dashboard:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Lỗi server: ' + error.message 
        });
    }
});

// API: Tạo lịch hẹn mới
router.post('/appointments', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const {
            vehicleId,
            licensePlate,
            brand,
            model,
            year,
            appointmentDate,
            mechanicId,
            services,
            notes,
            totalServiceTime,
            endTime,
            paymentMethod
        } = req.body;
        
        // console.log("Received booking data:", req.body);
        
        // Validate dữ liệu
        if (!appointmentDate || !services || services.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Thiếu thông tin cần thiết để đặt lịch' 
            });
        }
        
        // Nếu không có vehicleId thì cần có thông tin xe
        if (!vehicleId && !licensePlate) {
            return res.status(400).json({ 
                success: false, 
                message: 'Vui lòng cung cấp thông tin xe' 
            });
        }
        
        // Kiểm tra xem kỹ thuật viên còn khả dụng không
        if (mechanicId) {
            // Parse appointmentDate để lấy ngày
            const appointmentDateTime = new Date(appointmentDate);
            const formattedDate = appointmentDateTime.toISOString().split('T')[0]; // lấy YYYY-MM-DD
            
            // Kiểm tra xem kỹ thuật viên có lịch trình làm việc trong ngày này không
            const [schedulesResult] = await pool.query(`
                SELECT * FROM StaffSchedule 
                WHERE MechanicID = ? AND WorkDate = ?
            `, [mechanicId, formattedDate]);
            
            if (schedulesResult.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Kỹ thuật viên không có lịch làm việc trong ngày này'
                });
            }
            
            // Kiểm tra xem kỹ thuật viên đã có lịch hẹn trùng thời gian không
            const [appointmentsResult] = await pool.query(`
                SELECT * FROM Appointments 
                WHERE MechanicID = ? 
                AND DATE(AppointmentDate) = ? 
                AND Status NOT IN ('Canceled')
                AND (
                    (TIME(AppointmentDate) <= TIME(?) AND TIME(EstimatedEndTime) > TIME(?))
                    OR (TIME(AppointmentDate) < TIME(?) AND TIME(EstimatedEndTime) >= TIME(?))
                    OR (TIME(AppointmentDate) >= TIME(?) AND TIME(EstimatedEndTime) <= TIME(?))
                )
            `, [
                mechanicId, 
                formattedDate, 
                appointmentDate, appointmentDate, 
                endTime, endTime, 
                appointmentDate, endTime
            ]);
            
            if (appointmentsResult.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Kỹ thuật viên đã có lịch hẹn trùng thời gian này'
                });
            }
        }
        
        // Tạo dữ liệu đặt lịch
        const bookingData = {
            userId,
            vehicleId,
            licensePlate,
            brand,
            model,
            year,
            appointmentDate,
            mechanicId,
            services,
            notes,
            totalServiceTime,
            endTime,
            paymentMethod: paymentMethod && (
                paymentMethod.toLowerCase().includes('chuyển khoản') || 
                paymentMethod.toLowerCase().includes('bank') ||
                paymentMethod.toLowerCase().includes('transfer')
            ) ? 'Chuyển khoản ngân hàng' : 'Thanh toán tại tiệm'
        };
        
        // Log thêm thông tin để debug
        // console.log("Processed booking data for DB:", bookingData);
        
        const result = await Booking.createAppointment(bookingData);
        
        res.status(201).json({
            success: true,
            message: 'Đặt lịch thành công',
            appointmentId: result.appointmentId,
            vehicleId: result.vehicleId
        });
    } catch (err) {
        console.error('Lỗi khi tạo lịch hẹn:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Lỗi server: ' + err.message 
        });
    }
});

// API: Lấy slot thời gian khả dụng
router.get('/available-slots', async (req, res) => {
    try {
        const { date } = req.query;
        
        if (!date) {
            return res.status(400).json({ 
                success: false, 
                message: 'Vui lòng cung cấp ngày muốn đặt lịch' 
            });
        }
        
        // Lấy lịch làm việc của kỹ thuật viên trong ngày
        const [mechanicSchedules] = await pool.query(`
            SELECT ss.MechanicID, ss.StartTime, ss.EndTime, u.FullName as MechanicName
            FROM StaffSchedule ss
            JOIN Users u ON ss.MechanicID = u.UserID
            WHERE ss.WorkDate = ?
            ORDER BY ss.StartTime
        `, [date]);
        
        if (mechanicSchedules.length === 0) {
            return res.json({
                success: true,
                availableSlots: [],
                message: 'Không có kỹ thuật viên làm việc trong ngày này'
            });
        }
        
        // Lấy lịch hẹn đã có trong ngày
        const [existingAppointments] = await pool.query(`
            SELECT AppointmentID, MechanicID, AppointmentDate, EstimatedEndTime, ServiceDuration
            FROM Appointments
            WHERE DATE(AppointmentDate) = ? AND Status NOT IN ('Canceled')
        `, [date]);
        
        // Tạo danh sách các slot thời gian có sẵn
        const availableSlots = [];
        
        // Với mỗi kỹ thuật viên
        for (const schedule of mechanicSchedules) {
            // Lấy thời gian bắt đầu và kết thúc ca làm việc
            const startTime = new Date(`${date}T${schedule.StartTime}`);
            const endTime = new Date(`${date}T${schedule.EndTime}`);
            
            // Tạo các slot thời gian cách nhau 1 giờ
            let currentSlot = new Date(startTime);
            
            while (currentSlot < endTime) {
                const slotHour = currentSlot.getHours();
                const slotMinute = currentSlot.getMinutes();
                const slotTimeString = `${String(slotHour).padStart(2, '0')}:${String(slotMinute).padStart(2, '0')}`;
                
                // Kiểm tra xem slot này có bị đặt chưa
                let isBooked = false;
                
                // Kiểm tra tất cả lịch hẹn
                for (const appointment of existingAppointments) {
                    if (appointment.MechanicID === schedule.MechanicID) {
                        const appointmentTime = new Date(appointment.AppointmentDate);
                        const appointmentHour = appointmentTime.getHours();
                        const appointmentMinute = appointmentTime.getMinutes();
                        const appointmentTimeString = `${String(appointmentHour).padStart(2, '0')}:${String(appointmentMinute).padStart(2, '0')}`;
                        
                        // Nếu slot này là thời gian bắt đầu của lịch hẹn, đánh dấu là đã đặt
                        if (slotTimeString === appointmentTimeString) {
                            isBooked = true;
                            break;
                        }
                        
                        // Kiểm tra các slot đã bị khóa vì nằm trong khoảng thời gian làm dịch vụ
                        const [blockedSlots] = await pool.query(`
                            SELECT * FROM BlockedTimeSlots 
                            WHERE MechanicID = ? 
                            AND DATE(SlotTime) = ? 
                            AND TIME(SlotTime) = ?
                            AND IsBlocked = true
                        `, [
                            schedule.MechanicID,
                            date,
                            slotTimeString
                        ]);
                        
                        if (blockedSlots.length > 0) {
                            isBooked = true;
                            break;
                        }
                    }
                }
                
                // Thêm slot vào danh sách
                availableSlots.push({
                    time: slotTimeString,
                    label: slotTimeString,
                    mechanicId: schedule.MechanicID,
                    mechanicName: schedule.MechanicName,
                    status: isBooked ? 'booked' : 'available'
                });
                
                // Tăng slot lên 1 giờ
                currentSlot.setHours(currentSlot.getHours() + 1);
            }
        }
        
        // Sắp xếp các slot theo thời gian
        availableSlots.sort((a, b) => {
            if (a.time < b.time) return -1;
            if (a.time > b.time) return 1;
            return 0;
        });
        
        res.json({
            success: true,
            availableSlots
        });
    } catch (err) {
        console.error('Lỗi khi lấy slot thời gian:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Lỗi server: ' + err.message 
        });
    }
});




// API: Tạo thanh toán khi đặt lịch
router.post('/payments/create', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const {
            appointmentId,
            userId,
            totalAmount,
            paymentMethod,
            status,
            paymentDetails
        } = req.body;
        
        // Validate dữ liệu
        if (!appointmentId || !userId || !totalAmount) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu thông tin thanh toán'
            });
        }
        
        // Lấy thông tin chi tiết từ lịch hẹn
        const [appointmentDetails] = await connection.query(`
            SELECT 
                a.MechanicID, 
                u.FullName as CustomerName,
                (SELECT GROUP_CONCAT(s.ServiceName SEPARATOR ', ') 
                 FROM AppointmentServices aps 
                 JOIN Services s ON aps.ServiceID = s.ServiceID 
                 WHERE aps.AppointmentID = a.AppointmentID) AS Services,
                (SELECT FullName FROM Users WHERE UserID = a.MechanicID) AS MechanicName
            FROM Appointments a
            JOIN Users u ON a.UserID = u.UserID
            WHERE a.AppointmentID = ?
        `, [appointmentId.replace('BK', '')]);
        
        // Tạo bản ghi thanh toán
        const [paymentResult] = await connection.query(
            `INSERT INTO Payments (
                UserID, 
                AppointmentID, 
                Amount, 
                PaymentMethod, 
                Status, 
                PaymentDetails,
                CustomerName,
                Services,
                MechanicName
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId, 
                appointmentId.replace('BK', ''), 
                totalAmount, 
                paymentMethod,
                status || 'Pending',
                paymentDetails || '',
                appointmentDetails[0]?.CustomerName || 'Không xác định',
                appointmentDetails[0]?.Services || 'Không xác định',
                appointmentDetails[0]?.MechanicName || 'Không xác định'
            ]
        );
        
        // Commit transaction
        await connection.commit();
        
        res.status(201).json({
            success: true,
            message: 'Tạo thanh toán thành công',
            paymentId: paymentResult.insertId
        });
        
    } catch (error) {
        // Rollback transaction nếu có lỗi
        await connection.rollback();
        
        console.error('Lỗi khi tạo thanh toán:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    } finally {
        connection.release();
    }
});

    // API: Xóa mềm lịch hẹn (Soft Delete)
    router.delete('/appointments/:id/delete', authenticateToken, async (req, res) => {
        try {
            const appointmentId = req.params.id;
            const appointment = await Booking.getAppointmentById(appointmentId);
            
            if (!appointment) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'Không tìm thấy lịch hẹn' 
                });
            }
            
            // Kiểm tra quyền: chỉ admin hoặc chủ lịch hẹn mới được xóa
            if (req.user.role !== 1 && req.user.userId !== appointment.UserID) {
                return res.status(403).json({ 
                    success: false, 
                    message: 'Không có quyền xóa lịch hẹn này' 
                });
            }
            
            // Thực hiện xóa mềm (soft delete)
            const [result] = await pool.query(
                'UPDATE Appointments SET IsDeleted = 1 WHERE AppointmentID = ?',
                [appointmentId]
            );
            
            if (result.affectedRows === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Không thể xóa lịch hẹn'
                });
            }
            
            res.json({
                success: true,
                message: 'Xóa lịch hẹn thành công'
            });
        } catch (err) {
            console.error('Lỗi khi xóa lịch hẹn:', err);
            res.status(500).json({ 
                success: false, 
                message: 'Lỗi server: ' + err.message 
            });
        }
    });


// API: Tạo thanh toán cho lịch hẹn
router.post('/appointments/:id/payment', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const appointmentId = req.params.id;
        const {
            userId,
            totalAmount,
            paymentMethod,
            status,
            paymentDetails
        } = req.body;
        
        // Validate dữ liệu
        if (!appointmentId || !userId || !totalAmount) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu thông tin thanh toán'
            });
        }
        
        // Lấy thông tin chi tiết từ lịch hẹn
        const [appointmentDetails] = await connection.query(`
            SELECT 
                a.MechanicID, 
                a.AppointmentDate,
                u.FullName as CustomerName,
                (SELECT GROUP_CONCAT(s.ServiceName SEPARATOR ', ') 
                 FROM AppointmentServices aps 
                 JOIN Services s ON aps.ServiceID = s.ServiceID 
                 WHERE aps.AppointmentID = a.AppointmentID) AS Services,
                (SELECT FullName FROM Users WHERE UserID = a.MechanicID) AS MechanicName
            FROM Appointments a
            JOIN Users u ON a.UserID = u.UserID
            WHERE a.AppointmentID = ?
        `, [appointmentId]);
        
        if (appointmentDetails.length === 0) {
            throw new Error('Không tìm thấy thông tin lịch hẹn');
        }
        
        // Chuẩn hóa phương thức thanh toán
        let normalizedPaymentMethod = 'Thanh toán tại tiệm';
        if (paymentMethod && (
            paymentMethod.toLowerCase().includes('chuyển khoản') || 
            paymentMethod.toLowerCase().includes('bank') ||
            paymentMethod.toLowerCase().includes('transfer')
        )) {
            normalizedPaymentMethod = 'Chuyển khoản ngân hàng';
        }

        // Sử dụng trạng thái từ client hoặc mặc định dựa vào phương thức
        // Thanh toán tại tiệm sẽ có trạng thái là 'Pending' cho đến khi khách đến
        const paymentStatus = status || (normalizedPaymentMethod === 'Chuyển khoản ngân hàng' ? 'Completed' : 'Pending');

        // Lưu thông tin thanh toán
        const [paymentResult] = await connection.query(
            `INSERT INTO Payments (
                UserID, 
                AppointmentID, 
                Amount, 
                PaymentMethod, 
                Status, 
                PaymentDetails,
                CustomerName,
                Services,
                MechanicName,
                PaymentDate
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                userId, 
                appointmentId, 
                totalAmount, 
                normalizedPaymentMethod,
                paymentStatus,
                paymentDetails || '',
                appointmentDetails[0]?.CustomerName || 'Không xác định',
                appointmentDetails[0]?.Services || 'Không xác định',
                appointmentDetails[0]?.MechanicName || 'Không xác định'
            ]
        );
        
        // Nếu phương thức thanh toán là "Thanh toán tại tiệm", lên lịch cập nhật trạng thái
        if (normalizedPaymentMethod === 'Thanh toán tại tiệm' && appointmentDetails[0]?.AppointmentDate) {
            try {
                await connection.query(
                    'CALL SchedulePaymentUpdate(?, ?, ?)',
                    [paymentResult.insertId, appointmentId, appointmentDetails[0].AppointmentDate]
                );
                console.log(`Đã lên lịch cập nhật thanh toán ID ${paymentResult.insertId} vào lúc ${appointmentDetails[0].AppointmentDate}`);
            } catch (scheduleError) {
                console.error('Lỗi khi lên lịch cập nhật thanh toán:', scheduleError);
                // Tiếp tục thực hiện mà không ném lỗi, để đảm bảo thanh toán vẫn được tạo
            }
        }
        
        // Commit transaction
        await connection.commit();
        
        res.status(201).json({
            success: true,
            message: 'Tạo thanh toán thành công',
            paymentId: paymentResult.insertId,
            status: paymentStatus
        });
        
    } catch (error) {
        // Rollback transaction nếu có lỗi
        await connection.rollback();
        
        console.error('Lỗi khi tạo thanh toán:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    } finally {
        connection.release();
    }
});

// API: Hủy lịch hẹn
router.post('/appointments/:id/cancel', authenticateToken, async (req, res) => {
    try {
        const appointmentId = req.params.id;
        const appointment = await Booking.getAppointmentById(appointmentId);
        
        if (!appointment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Không tìm thấy lịch hẹn' 
            });
        }
        
        // Kiểm tra quyền: chỉ admin hoặc chủ lịch hẹn mới được hủy
        if (req.user.role !== 1 && req.user.userId !== appointment.UserID) {
            return res.status(403).json({ 
                success: false, 
                message: 'Không có quyền hủy lịch hẹn này' 
            });
        }
        
        // Kiểm tra trạng thái hiện tại
        if (appointment.Status === 'Completed') {
            return res.status(400).json({
                success: false,
                message: 'Không thể hủy lịch hẹn đã hoàn thành'
            });
        }
        
        await Booking.cancelAppointment(appointmentId);
        
        res.json({
            success: true,
            message: 'Hủy lịch hẹn thành công'
        });
    } catch (err) {
        console.error('Lỗi khi hủy lịch hẹn:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Lỗi server: ' + err.message 
        });
    }
});

// API: Lấy danh sách thợ sửa xe
router.get('/mechanics', authenticateToken, async (req, res) => {
    try {
        const mechanics = await Booking.getMechanics();
        
        res.json({
            success: true,
            mechanics
        });
    } catch (err) {
        console.error('Lỗi khi lấy danh sách thợ:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Lỗi server: ' + err.message 
        });
    }
});

// API: Lấy xe của người dùng
router.get('/my-vehicles', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const vehicles = await Booking.getUserVehicles(userId);
        
        res.json({
            success: true,
            vehicles
        });
    } catch (err) {
        console.error('Lỗi khi lấy danh sách xe:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Lỗi server: ' + err.message 
        });
    }
});

// API: Lấy danh sách dịch vụ cho đặt lịch
router.get('/services', async (req, res) => {
    try {
        // Gọi trực tiếp từ database thay vì qua model nếu có vấn đề
        const [services] = await pool.query('SELECT * FROM Services');
        
        // console.log('Services from database:', services); // Debug log
        
        // Sửa đường dẫn hình ảnh
        /*
        services.forEach(service => {
            if (service.ServiceImage && !service.ServiceImage.startsWith('http') && !service.ServiceImage.startsWith('/')) {
                service.ServiceImage = `images/services/${service.ServiceImage}`;
            }
        });
        */

        services.forEach(service => {
            if (service.ServiceImage && !service.ServiceImage.startsWith('http')) {
                service.ServiceImage = `https://storage.googleapis.com/suaxe-api-web/services/${service.ServiceImage}`;
            }
        });

        res.json({
            success: true,
            services: services
        });
    } catch (err) {
        console.error('Lỗi khi lấy danh sách dịch vụ:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Lỗi server: ' + err.message 
        });
    }
});

// Đoạn code cập nhật trong bookingRoutes.js - hàm xử lý PUT request
router.put('/appointments/:id', authenticateToken, async (req, res) => {
    try {
        const appointmentId = req.params.id;
        const appointment = await Booking.getAppointmentById(appointmentId);
        
        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy lịch hẹn'
            });
        }
        
        // Kiểm tra quyền: chỉ admin hoặc chủ lịch hẹn mới được cập nhật
        if (req.user.role !== 1 && req.user.userId !== appointment.UserID) {
            return res.status(403).json({
                success: false,
                message: 'Không có quyền cập nhật lịch hẹn này'
            });
        }
        
        // Lấy dữ liệu từ request
        const {
            status,
            notes,
            mechanicId,
            appointmentDate,
            services,
            vehicleId,
            licensePlate,
            brand,
            model,
            year
        } = req.body;
        
        // Xử lý định dạng ngày tháng nếu cần
        let formattedAppointmentDate = appointmentDate;
        
        // Log để debug
        console.log('Ngày giờ nhận được từ client:', appointmentDate);
        
        // Chuẩn bị dữ liệu cập nhật
        const updateData = {
            status,
            notes,
            mechanicId,
            appointmentDate: formattedAppointmentDate,
            services,
            vehicleId,
            licensePlate,
            brand,
            model,
            year
        };
        
        // Cập nhật lịch hẹn
        await Booking.updateAppointment(appointmentId, updateData);
        
        res.json({
            success: true,
            message: 'Cập nhật lịch hẹn thành công'
        });
    } catch (err) {
        console.error('Lỗi khi cập nhật lịch hẹn:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

module.exports = router;