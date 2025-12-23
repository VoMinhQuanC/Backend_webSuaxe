// File: routes/mechanicNotificationHelper.js
// Helper functions để gửi notifications cho mechanics

const { pool } = require('../db');
const { sendPushNotification } = require('./fcmRoutes');

/**
 * Gửi notification khi mechanic được phân công appointment mới
 */
async function notifyMechanicNewAppointment(mechanicId, appointmentId, appointmentDetails) {
    try {
        console.log(`📱 Sending new appointment notification to mechanic ${mechanicId}`);
        
        // 1. Tạo in-app notification
        await pool.query(
            `INSERT INTO Notifications (UserID, Title, Message, Type, ReferenceID, CreatedAt)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [
                mechanicId,
                'Lịch hẹn mới',
                `Bạn được phân công lịch hẹn #${appointmentId}. Khách hàng: ${appointmentDetails.customerName || 'N/A'}`,
                'appointment_assigned',
                appointmentId
            ]
        );
        
        // 2. Gửi push notification
        await sendPushNotification(mechanicId, {
            title: '🔧 Lịch hẹn mới',
            body: `Lịch hẹn #${appointmentId} - ${appointmentDetails.customerName || 'Khách hàng'}`,
            type: 'appointment_assigned',
            referenceId: appointmentId,
            data: {
                appointmentDate: appointmentDetails.appointmentDate,
                services: appointmentDetails.services,
            }
        });
        
        console.log('✅ Notification sent to mechanic');
        return { success: true };
    } catch (err) {
        console.error('❌ Error sending mechanic notification:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Gửi notification khi lịch làm việc được cập nhật
 */
async function notifyMechanicScheduleUpdate(mechanicId, scheduleDetails) {
    try {
        console.log(`📱 Sending schedule update to mechanic ${mechanicId}`);
        
        const message = scheduleDetails.isApproved 
            ? `Lịch làm việc ngày ${scheduleDetails.workDate} đã được phê duyệt`
            : scheduleDetails.isRejected
            ? `Lịch làm việc ngày ${scheduleDetails.workDate} bị từ chối. Lý do: ${scheduleDetails.reason || 'N/A'}`
            : `Lịch làm việc của bạn đã được cập nhật`;
        
        // 1. In-app notification
        await pool.query(
            `INSERT INTO Notifications (UserID, Title, Message, Type, ReferenceID, CreatedAt)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [
                mechanicId,
                'Cập nhật lịch làm việc',
                message,
                'schedule_update',
                scheduleDetails.scheduleId
            ]
        );
        
        // 2. Push notification
        await sendPushNotification(mechanicId, {
            title: '📅 Cập nhật lịch làm việc',
            body: message,
            type: 'schedule_update',
            referenceId: scheduleDetails.scheduleId,
        });
        
        console.log('✅ Schedule notification sent');
        return { success: true };
    } catch (err) {
        console.error('❌ Error sending schedule notification:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Gửi notification khi đơn xin nghỉ được duyệt/từ chối
 */
async function notifyMechanicLeaveResponse(mechanicId, leaveDetails) {
    try {
        console.log(`📱 Sending leave response to mechanic ${mechanicId}`);
        
        const isApproved = leaveDetails.status === 'Approved' || leaveDetails.status === 'ApprovedLeave';
        const title = isApproved ? 'Đơn xin nghỉ đã được duyệt' : 'Đơn xin nghỉ bị từ chối';
        const message = isApproved
            ? `Đơn xin nghỉ ngày ${leaveDetails.workDate} đã được phê duyệt`
            : `Đơn xin nghỉ ngày ${leaveDetails.workDate} bị từ chối. ${leaveDetails.adminNotes || ''}`;
        
        // 1. In-app notification
        await pool.query(
            `INSERT INTO Notifications (UserID, Title, Message, Type, ReferenceID, CreatedAt)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [
                mechanicId,
                title,
                message,
                isApproved ? 'leave_approved' : 'leave_rejected',
                leaveDetails.scheduleId
            ]
        );
        
        // 2. Push notification
        await sendPushNotification(mechanicId, {
            title: isApproved ? '✅ Đơn nghỉ được duyệt' : '❌ Đơn nghỉ bị từ chối',
            body: message,
            type: isApproved ? 'leave_approved' : 'leave_rejected',
            referenceId: leaveDetails.scheduleId,
        });
        
        console.log('✅ Leave response notification sent');
        return { success: true };
    } catch (err) {
        console.error('❌ Error sending leave notification:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Gửi reminder cho mechanic trước giờ làm việc
 */
async function sendMechanicWorkReminder(mechanicId, workDetails) {
    try {
        console.log(`📱 Sending work reminder to mechanic ${mechanicId}`);
        
        const message = `Bạn có lịch làm việc vào ${workDetails.startTime} hôm nay. Nhớ check-in đúng giờ nhé!`;
        
        // 1. In-app notification
        await pool.query(
            `INSERT INTO Notifications (UserID, Title, Message, Type, ReferenceID, CreatedAt)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [
                mechanicId,
                'Nhắc nhở làm việc',
                message,
                'work_reminder',
                workDetails.scheduleId
            ]
        );
        
        // 2. Push notification
        await sendPushNotification(mechanicId, {
            title: '⏰ Nhắc nhở làm việc',
            body: message,
            type: 'work_reminder',
            referenceId: workDetails.scheduleId,
        });
        
        console.log('✅ Work reminder sent');
        return { success: true };
    } catch (err) {
        console.error('❌ Error sending work reminder:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Gửi notification cho tất cả mechanics online
 */
async function notifyAllMechanics(title, message, type = 'general') {
    try {
        console.log('📱 Sending notification to all mechanics');
        
        // Lấy danh sách mechanics (RoleID = 3)
        const [mechanics] = await pool.query(
            `SELECT UserID FROM Users WHERE RoleID = 3 AND IsActive = 1`
        );
        
        for (const mechanic of mechanics) {
            // In-app notification
            await pool.query(
                `INSERT INTO Notifications (UserID, Title, Message, Type, CreatedAt)
                 VALUES (?, ?, ?, ?, NOW())`,
                [mechanic.UserID, title, message, type]
            );
            
            // Push notification
            await sendPushNotification(mechanic.UserID, {
                title,
                body: message,
                type,
            });
        }
        
        console.log(`✅ Notification sent to ${mechanics.length} mechanics`);
        return { success: true, count: mechanics.length };
    } catch (err) {
        console.error('❌ Error sending broadcast notification:', err);
        return { success: false, error: err.message };
    }
}

/**
 * VÍ DỤ SỬ DỤNG TRONG ROUTES
 */

// ========================================
// TRONG bookingRoutes.js
// ========================================
/*
const { notifyMechanicNewAppointment } = require('./mechanicNotificationHelper');

// Khi admin phân công mechanic cho appointment
router.put('/appointments/:id/assign-mechanic', authenticateToken, async (req, res) => {
    try {
        const { mechanicId } = req.body;
        const appointmentId = req.params.id;
        
        // ... update appointment với MechanicID ...
        
        // ✅ Gửi notification cho mechanic
        await notifyMechanicNewAppointment(mechanicId, appointmentId, {
            customerName: appointment.CustomerName,
            appointmentDate: appointment.AppointmentDate,
            services: appointment.Services,
        });
        
        res.json({ success: true, message: 'Đã phân công thành công' });
    } catch (err) {
        // ...
    }
});
*/

// ========================================
// TRONG scheduleRoutes.js
// ========================================
/*
const { notifyMechanicScheduleUpdate, notifyMechanicLeaveResponse } = require('./mechanicNotificationHelper');

// Khi admin duyệt/từ chối lịch làm việc
router.put('/schedules/:id/approve', authenticateToken, async (req, res) => {
    try {
        const scheduleId = req.params.id;
        const { status, adminNotes } = req.body; // 'Approved' hoặc 'Rejected'
        
        // ... update schedule status ...
        
        const [schedule] = await pool.query(
            'SELECT * FROM MechanicSchedules WHERE ScheduleID = ?',
            [scheduleId]
        );
        
        const isLeaveRequest = schedule[0].Type === 'unavailable';
        
        if (isLeaveRequest) {
            // ✅ Đơn xin nghỉ
            await notifyMechanicLeaveResponse(schedule[0].MechanicID, {
                scheduleId,
                workDate: schedule[0].WorkDate,
                status,
                adminNotes,
            });
        } else {
            // ✅ Lịch làm việc bình thường
            await notifyMechanicScheduleUpdate(schedule[0].MechanicID, {
                scheduleId,
                workDate: schedule[0].WorkDate,
                isApproved: status === 'Approved',
                isRejected: status === 'Rejected',
                reason: adminNotes,
            });
        }
        
        res.json({ success: true });
    } catch (err) {
        // ...
    }
});
*/

// Export functions
module.exports = {
    notifyMechanicNewAppointment,
    notifyMechanicScheduleUpdate,
    notifyMechanicLeaveResponse,
    sendMechanicWorkReminder,
    notifyAllMechanics,
};