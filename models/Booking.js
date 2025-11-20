// models/Booking.js - Mô hình xử lý dữ liệu đặt lịch

const { pool } = require('../db');

class Booking {
    // Lấy danh sách tất cả lịch hẹn
    static async getAllAppointments(filters = {}) {
        try {
            let query = `
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
                WHERE a.IsDeleted = 0
            `;
            
            const params = [];
            
            // Log để debug
            // console.log('Filters received in model:', filters);
            
            // Kiểm tra và thêm điều kiện lọc
            if (filters.dateFrom && filters.dateFrom !== 'undefined') {
                query += ' AND DATE(a.AppointmentDate) >= ?';
                params.push(filters.dateFrom);
                //console.log('Added dateFrom filter:', filters.dateFrom);
            }
            
            if (filters.dateTo && filters.dateTo !== 'undefined') {
                query += ' AND DATE(a.AppointmentDate) <= ?';
                params.push(filters.dateTo);
                //console.log('Added dateTo filter:', filters.dateTo);
            }
            
            if (filters.status && filters.status !== 'undefined') {
                query += ' AND a.Status = ?';
                params.push(filters.status);
                //console.log('Added status filter:', filters.status);
            }
            
            query += ' GROUP BY a.AppointmentID ORDER BY a.AppointmentDate DESC';
            
            //console.log('Final SQL Query:', query);
            //console.log('Query Parameters:', params);
            
            const [rows] = await pool.query(query, params);
            
            // console.log(`Found ${rows.length} appointments with filters`);
            
            return rows;
        } catch (error) {
            console.error('Lỗi khi lấy danh sách lịch hẹn:', error);
            throw error;
        }
    }

    // Cập nhật phương thức getAppointmentsByUserId trong models/Booking.js
    static async getAppointmentsByUserId(userId) {
        try {
            const [rows] = await pool.query(`
                SELECT a.*, v.LicensePlate, v.Brand, v.Model,
                    (SELECT GROUP_CONCAT(s.ServiceName SEPARATOR ', ') 
                    FROM AppointmentServices ap 
                    JOIN Services s ON ap.ServiceID = s.ServiceID 
                    WHERE ap.AppointmentID = a.AppointmentID) AS Services
                FROM Appointments a
                LEFT JOIN Vehicles v ON a.VehicleID = v.VehicleID
                WHERE a.UserID = ? AND a.IsDeleted = 0
                ORDER BY a.AppointmentDate DESC
            `, [userId]);
            
            return rows;
        } catch (err) {
            console.error('Lỗi trong getAppointmentsByUserId:', err);
            throw err;
        }
    }

    /**
     * Lấy các slot thời gian có sẵn cho đặt lịch dựa trên lịch làm việc của kỹ thuật viên
     */
    static async getAvailableTimeSlots(date) {
        try {
            // Lấy danh sách kỹ thuật viên đang làm việc trong ngày được chọn
            const [mechanics] = await pool.query(`
                SELECT ss.MechanicID, ss.StartTime, ss.EndTime, u.FullName as MechanicName
                FROM StaffSchedule ss
                JOIN Users u ON ss.MechanicID = u.UserID
                WHERE ss.WorkDate = ?
                ORDER BY ss.StartTime
            `, [date]);
            
            if (mechanics.length === 0) {
                // Không có kỹ thuật viên làm việc trong ngày này
                return [];
            }
            
            // Tạo các khung giờ dựa trên lịch làm việc của kỹ thuật viên
            // Mỗi lượt đặt lịch kéo dài 1 giờ
            const slotDurationMinutes = 60;
            let availableSlots = [];
            
            // Duyệt qua từng kỹ thuật viên
            for (const mechanic of mechanics) {
                // Chuyển đổi giờ làm việc thành đối tượng Date
                const startTime = new Date(`${date} ${mechanic.StartTime}`);
                const endTime = new Date(`${date} ${mechanic.EndTime}`);
                
                // Tính số slot có thể có trong khoảng thời gian làm việc
                const slots = [];
                let currentTime = new Date(startTime);
                
                while (currentTime < endTime) {
                    const hours = currentTime.getHours().toString().padStart(2, '0');
                    const minutes = currentTime.getMinutes().toString().padStart(2, '0');
                    const timeString = `${hours}:${minutes}`;
                    
                    slots.push({
                        time: timeString,
                        label: timeString,
                        mechanicId: mechanic.MechanicID,
                        mechanicName: mechanic.MechanicName,
                        status: 'available'
                    });
                    
                    // Tăng thêm thời gian của slot
                    currentTime.setMinutes(currentTime.getMinutes() + slotDurationMinutes);
                }
                
                availableSlots = [...availableSlots, ...slots];
            }
            
            // Lấy danh sách các lịch hẹn đã tồn tại trong ngày
            const [appointments] = await pool.query(`
                SELECT AppointmentDate, MechanicID
                FROM Appointments 
                WHERE DATE(AppointmentDate) = ? AND Status NOT IN ('Canceled')
            `, [date]);
            
            // Đánh dấu các slot đã được đặt
            appointments.forEach(appointment => {
                const appointmentTime = new Date(appointment.AppointmentDate);
                const hours = appointmentTime.getHours().toString().padStart(2, '0');
                const minutes = appointmentTime.getMinutes().toString().padStart(2, '0');
                const timeString = `${hours}:${minutes}`;
                
                // Tìm các slot trùng thời gian và kỹ thuật viên
                const matchingSlots = availableSlots.filter(slot => 
                    slot.time === timeString && 
                    (appointment.MechanicID === null || String(slot.mechanicId) === String(appointment.MechanicID))
                );
                
                // Đánh dấu slot đã được đặt
                matchingSlots.forEach(slot => {
                    slot.status = 'booked';
                });
            });
            
            // Sắp xếp các slot theo thời gian
            availableSlots.sort((a, b) => {
                if (a.time < b.time) return -1;
                if (a.time > b.time) return 1;
                return 0;
            });
            
            return availableSlots;
        } catch (err) {
            console.error('Lỗi trong getAvailableTimeSlots:', err);
            throw err;
        }
    }

    // Lấy lịch hẹn theo ID
    static async getAppointmentById(appointmentId) {
        try {
            const [rows] = await pool.query(`
                SELECT a.*, u.FullName, u.PhoneNumber, u.Email, v.LicensePlate, v.Brand, v.Model
                FROM Appointments a
                LEFT JOIN Users u ON a.UserID = u.UserID
                LEFT JOIN Vehicles v ON a.VehicleID = v.VehicleID
                WHERE a.AppointmentID = ?
            `, [appointmentId]);
            
            if (rows.length === 0) return null;
            
            // Lấy thêm thông tin dịch vụ của lịch hẹn
            const [services] = await pool.query(`
                SELECT as2.*, s.ServiceName, s.Price, s.EstimatedTime 
                FROM AppointmentServices as2
                JOIN Services s ON as2.ServiceID = s.ServiceID
                WHERE as2.AppointmentID = ?
            `, [appointmentId]);
            
            // Gán thông tin dịch vụ vào kết quả
            rows[0].services = services;
            return rows[0];
        } catch (err) {
            console.error('Lỗi trong getAppointmentById:', err);
            throw err;
        }
    }

    // Lấy lịch hẹn theo UserID
    static async getAppointmentsByUserId(userId) {
        try {
            const [rows] = await pool.query(`
                SELECT a.*, v.LicensePlate, v.Brand, v.Model,
                    (SELECT GROUP_CONCAT(s.ServiceName SEPARATOR ', ') 
                    FROM AppointmentServices ap 
                    JOIN Services s ON ap.ServiceID = s.ServiceID 
                    WHERE ap.AppointmentID = a.AppointmentID) AS Services
                FROM Appointments a
                LEFT JOIN Vehicles v ON a.VehicleID = v.VehicleID
                WHERE a.UserID = ?
                ORDER BY a.AppointmentDate DESC
            `, [userId]);
            
            return rows;
        } catch (err) {
            console.error('Lỗi trong getAppointmentsByUserId:', err);
            throw err;
        }
    }

    // Tạo lịch hẹn mới
    static async createAppointment(bookingData) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            
            // Kiểm tra hoặc tạo thông tin xe
            let vehicleId = bookingData.vehicleId;
            
            if (!vehicleId && bookingData.licensePlate) {
                // Kiểm tra xem biển số xe đã tồn tại chưa
                const [existingVehicles] = await connection.query(
                    'SELECT VehicleID FROM Vehicles WHERE LicensePlate = ?',
                    [bookingData.licensePlate]
                );
                
                if (existingVehicles.length > 0) {
                    vehicleId = existingVehicles[0].VehicleID;
                } else {
                    // Tạo xe mới
                    const [insertVehicle] = await connection.query(
                        'INSERT INTO Vehicles (UserID, LicensePlate, Brand, Model, Year) VALUES (?, ?, ?, ?, ?)',
                        [
                            bookingData.userId,
                            bookingData.licensePlate,
                            bookingData.brand,
                            bookingData.model,
                            bookingData.year || new Date().getFullYear()
                        ]
                    );
                    vehicleId = insertVehicle.insertId;
                }
            }
            
            // Lấy thời gian kết thúc từ endTime
            let estimatedEndTime = null;
            if (bookingData.endTime) {
                // Nếu có sẵn endTime trong định dạng datetime
                estimatedEndTime = bookingData.endTime;
            } else {
                // Tính toán từ appointmentDate và totalServiceTime
                const appointmentDate = new Date(bookingData.appointmentDate);
                const totalMinutes = bookingData.totalServiceTime || 0;
                const endDate = new Date(appointmentDate.getTime() + totalMinutes * 60000);
                estimatedEndTime = endDate.toISOString().slice(0, 19).replace('T', ' ');
            }
            
            // console.log('Creating appointment with end time:', estimatedEndTime);
            
           // Tạo lịch hẹn - ĐẢM BẢO TRẠNG THÁI MẶC ĐỊNH LÀ 'Pending'
            const [appointmentResult] = await connection.query(
                'INSERT INTO Appointments (UserID, VehicleID, MechanicID, AppointmentDate, Status, Notes, EstimatedEndTime, ServiceDuration, PaymentMethod) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    bookingData.userId,
                    vehicleId,
                    bookingData.mechanicId || null,
                    bookingData.appointmentDate,
                    'Pending',  // Trạng thái mặc định khi tạo luôn là Pending
                    bookingData.notes || null,
                    estimatedEndTime, 
                    bookingData.totalServiceTime || 0,
                    bookingData.paymentMethod || 'Thanh toán tại tiệm'  // Thêm dòng này
                ]
            );
            
            const appointmentId = appointmentResult.insertId;
            
            if (bookingData.services && bookingData.services.length > 0) {
                for (const serviceId of bookingData.services) {
                    await connection.query(
                        'INSERT INTO AppointmentServices (AppointmentID, ServiceID, Quantity) VALUES (?, ?, ?)',
                        [appointmentId, serviceId, 1]  // Mặc định số lượng là 1
                    );
                }
            }
            
            // Phần còn lại của phương thức không thay đổi...
            
            await connection.commit();
            return { appointmentId, vehicleId };
            
        } catch (err) {
            await connection.rollback();
            console.error('Lỗi trong createAppointment:', err);
            throw err;
        } finally {
            connection.release();
        }
    }

    // Cập nhật lịch hẹn
    static async updateAppointment(appointmentId, bookingData) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            
            // Lấy thông tin hiện tại của lịch hẹn
            const [currentAppointment] = await connection.query(
                'SELECT * FROM Appointments WHERE AppointmentID = ?',
                [appointmentId]
            );
            
            if (currentAppointment.length === 0) {
                throw new Error('Không tìm thấy lịch hẹn');
            }
            
            // Sử dụng giá trị hiện tại nếu không có giá trị mới
            let appointmentDate = currentAppointment[0].AppointmentDate;
            
            // Xử lý appointmentDate nếu có giá trị mới
            if (bookingData.appointmentDate) {
                // Kiểm tra nếu appointmentDate có định dạng DD-MM-YYYY HH:MM:SS
                if (bookingData.appointmentDate.match(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/)) {
                    // Chuyển đổi từ DD-MM-YYYY HH:MM:SS sang YYYY-MM-DD HH:MM:SS
                    const parts = bookingData.appointmentDate.split(' ');
                    const dateParts = parts[0].split('-');
                    const timePart = parts[1];
                    appointmentDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]} ${timePart}`;
                } 
                // Kiểm tra nếu appointmentDate có định dạng DD-MM-YYYY HH:MM
                else if (bookingData.appointmentDate.match(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/)) {
                    // Chuyển đổi từ DD-MM-YYYY HH:MM sang YYYY-MM-DD HH:MM:00
                    const parts = bookingData.appointmentDate.split(' ');
                    const dateParts = parts[0].split('-');
                    const timePart = parts[1];
                    appointmentDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]} ${timePart}:00`;
                }
                // Nếu đã đúng định dạng YYYY-MM-DD HH:MM:SS thì dùng trực tiếp
                else if (bookingData.appointmentDate.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
                    appointmentDate = bookingData.appointmentDate;
                }
                // Nếu đã đúng định dạng YYYY-MM-DD HH:MM thì thêm :00
                else if (bookingData.appointmentDate.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)) {
                    appointmentDate = `${bookingData.appointmentDate}:00`;
                }
                else {
                    console.warn('Định dạng ngày không được hỗ trợ:', bookingData.appointmentDate);
                    // Giữ nguyên giá trị cũ
                }
            }
            
            const status = bookingData.status || currentAppointment[0].Status;
            const notes = bookingData.notes !== undefined ? bookingData.notes : currentAppointment[0].Notes;
            const mechanicId = bookingData.mechanicId !== undefined ? bookingData.mechanicId : currentAppointment[0].MechanicID;
            
            console.log('Cập nhật lịch hẹn với ngày giờ:', appointmentDate);
            
            // Cập nhật thông tin lịch hẹn
            await connection.query(
                'UPDATE Appointments SET AppointmentDate = ?, Status = ?, Notes = ?, MechanicID = ? WHERE AppointmentID = ?',
                [
                    appointmentDate,
                    status,
                    notes,
                    mechanicId,
                    appointmentId
                ]
            );
            
            // Tiếp tục xử lý cập nhật thông tin xe nếu cần
            if (bookingData.vehicleId && bookingData.licensePlate) {
                await connection.query(
                    'UPDATE Vehicles SET LicensePlate = ?, Brand = ?, Model = ?, Year = ? WHERE VehicleID = ?',
                    [
                        bookingData.licensePlate,
                        bookingData.brand,
                        bookingData.model,
                        bookingData.year,
                        bookingData.vehicleId
                    ]
                );
            }
            
            // Xử lý cập nhật dịch vụ nếu có
            if (bookingData.services && bookingData.services.length > 0) {
                // Xóa dịch vụ cũ
                await connection.query('DELETE FROM AppointmentServices WHERE AppointmentID = ?', [appointmentId]);
                
                // Thêm dịch vụ mới
                for (const serviceInfo of bookingData.services) {
                    const serviceId = typeof serviceInfo === 'object' ? serviceInfo.serviceId : serviceInfo;
                    const quantity = typeof serviceInfo === 'object' ? serviceInfo.quantity : 1;
                    
                    await connection.query(
                        'INSERT INTO AppointmentServices (AppointmentID, ServiceID, Quantity) VALUES (?, ?, ?)',
                        [appointmentId, serviceId, quantity]
                    );
                }
            }
            
            await connection.commit();
            return true;
            
        } catch (err) {
            await connection.rollback();
            console.error('Lỗi trong updateAppointment:', err);
            throw err;
        } finally {
            connection.release();
        }
    }
    
    // Hủy lịch hẹn
    static async cancelAppointment(appointmentId) {
        try {
            const [result] = await pool.query(
                'UPDATE Appointments SET Status = ? WHERE AppointmentID = ?',
                ['Canceled', appointmentId]
            );
            return result.affectedRows > 0;
        } catch (err) {
            console.error('Lỗi trong cancelAppointment:', err);
            throw err;
        }
    }

    // Lấy danh sách thợ sửa xe
    static async getMechanics() {
        try {
            const [rows] = await pool.query(`
                SELECT UserID, FullName, Email, PhoneNumber
                FROM Users
                WHERE RoleID = 3
                ORDER BY FullName
            `);
            return rows;
        } catch (err) {
            console.error('Lỗi trong getMechanics:', err);
            throw err;
        }
    }

    /**
     * Lấy thống kê dashboard
     */
    static async getDashboardStats() {
        try {
            // Lấy tổng số lịch hẹn
            const [totalRow] = await pool.query(
                'SELECT COUNT(*) as count FROM Appointments'
            );
            
            // Lấy số lịch hẹn đang chờ xác nhận
            const [pendingRow] = await pool.query(
                'SELECT COUNT(*) as count FROM Appointments WHERE Status = "Pending"'
            );
            
            // Lấy số lịch hẹn đã xác nhận
            const [confirmedRow] = await pool.query(
                'SELECT COUNT(*) as count FROM Appointments WHERE Status = "Confirmed"'
            );
            
            // Lấy số lịch hẹn đã hoàn thành
            const [completedRow] = await pool.query(
                'SELECT COUNT(*) as count FROM Appointments WHERE Status = "Completed"'
            );
            
            return {
                total: totalRow[0].count,
                pending: pendingRow[0].count,
                confirmed: confirmedRow[0].count,
                completed: completedRow[0].count
            };
        } catch (err) {
            console.error('Lỗi trong getDashboardStats:', err);
            throw err;
        }
    }

    /**
     * Lấy lịch hẹn gần đây
     */
    static async getRecentBookings(limit = 10) {
        try {
            const [rows] = await pool.query(`
                SELECT a.*, u.FullName, u.PhoneNumber, v.LicensePlate, v.Brand, v.Model,
                       (SELECT GROUP_CONCAT(s.ServiceName SEPARATOR ', ') 
                        FROM AppointmentServices ap 
                        JOIN Services s ON ap.ServiceID = s.ServiceID 
                        WHERE ap.AppointmentID = a.AppointmentID) AS Services
                FROM Appointments a
                LEFT JOIN Users u ON a.UserID = u.UserID
                LEFT JOIN Vehicles v ON a.VehicleID = v.VehicleID
                ORDER BY a.AppointmentDate DESC
                LIMIT ?
            `, [limit]);
            
            return rows;
        } catch (err) {
            console.error('Lỗi trong getRecentBookings:', err);
            throw err;
        }
    }

    // Lấy xe của một người dùng
    static async getUserVehicles(userId) {
        try {
            const [rows] = await pool.query(`
                SELECT * FROM Vehicles 
                WHERE UserID = ?
                ORDER BY CreatedAt DESC
            `, [userId]);
            return rows;
        } catch (err) {
            console.error('Lỗi trong getUserVehicles:', err);
            throw err;
        }
    }
}

/**
 * Kiểm tra xem khung giờ có nằm trong khoảng thời gian làm dịch vụ không
 * @param {string} slotTime Thời gian slot (định dạng "HH:MM")
 * @param {string} startTime Thời gian bắt đầu (định dạng "HH:MM")
 * @param {string} endTime Thời gian kết thúc (định dạng "HH:MM")
 * @returns {boolean} True nếu slot nằm trong khoảng thời gian làm dịch vụ
 */
function isTimeSlotInServicePeriod(slotTime, startTime, endTime) {
    // Chuyển các thời gian thành phút để dễ so sánh
    const [slotHours, slotMinutes] = slotTime.split(':').map(Number);
    const slotTotalMinutes = slotHours * 60 + slotMinutes;
    
    const [startHours, startMinutes] = startTime.split(':').map(Number);
    const startTotalMinutes = startHours * 60 + startMinutes;
    
    const [endHours, endMinutes] = endTime.split(':').map(Number);
    const endTotalMinutes = endHours * 60 + endMinutes;
    
    // Kiểm tra xem slot có nằm trong khoảng thời gian làm dịch vụ không
    // Bao gồm cả slot bắt đầu từ trong khoảng thời gian làm dịch vụ
    return (slotTotalMinutes > startTotalMinutes && slotTotalMinutes < endTotalMinutes);
}

module.exports = Booking;