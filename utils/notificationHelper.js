// ================================
// NOTIFICATION HELPER - TYPE FIXED
// Fixed Type ENUM to match database
// ================================

const mysql = require('mysql2/promise');

// Database pool
const pool = mysql.createPool({
    host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
    user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
    password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
    database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'websuaxe',
    port: parseInt(process.env.MYSQLPORT || process.env.DB_PORT || '3306'),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

/**
 * Tạo notification
 * Type ENUM: booking, payment, system, promotion, reminder, announcement, general
 */
async function createNotification({
    userId = null,
    senderId = null,
    title,
    message,
    type = 'system',  // ✅ Must be: booking, payment, system, promotion, reminder, announcement, general
    priority = 'normal',
    iconType = 'info',
    actionUrl = null,
    relatedId = null,
    relatedType = null,
    expiresAt = null
}) {
    try {
        const [result] = await pool.query(`
            INSERT INTO Notifications 
            (UserID, SenderID, Title, Message, Type, Priority, IconType, ActionUrl, RelatedID, RelatedType, ExpiresAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [userId, senderId, title, message, type, priority, iconType, actionUrl, relatedId, relatedType, expiresAt]);
        
        const notificationId = result.insertId;
        
        console.log(`✅ Notification created: ID=${notificationId}, UserID=${userId}, Type="${type}", Title="${title}"`);
        
        return notificationId;
        
    } catch (error) {
        console.error('❌ Error creating notification:', error);
        console.error(`   Failed params: userId=${userId}, type=${type}, title=${title}`);
        throw error;
    }
}

/**
 * Gửi notification cho Admin (RoleID = 1)
 */
async function notifyAdmin({
    title,
    message,
    type = 'system',
    priority = 'normal',
    iconType = 'info',
    actionUrl = null,
    relatedId = null,
    relatedType = null,
    senderId = null
}) {
    try {
        const [admins] = await pool.query('SELECT UserID FROM Users WHERE RoleID = 1');
        
        if (admins.length === 0) {
            console.warn('⚠️ No admin found');
            return [];
        }
        
        const notificationIds = [];
        
        for (const admin of admins) {
            const notificationId = await createNotification({
                userId: admin.UserID,
                senderId,
                title,
                message,
                type,
                priority,
                iconType,
                actionUrl,
                relatedId,
                relatedType
            });
            
            notificationIds.push(notificationId);
        }
        
        console.log(`✅ Notified ${admins.length} admins`);
        return notificationIds;
        
    } catch (error) {
        console.error('❌ Error notifying admin:', error);
        throw error;
    }
}

/**
 * Gửi notification cho User cụ thể
 */
async function notifyUser({
    userId,
    title,
    message,
    type = 'system',
    priority = 'normal',
    iconType = 'info',
    actionUrl = null,
    relatedId = null,
    relatedType = null,
    senderId = null
}) {
    return await createNotification({
        userId,
        senderId,
        title,
        message,
        type,
        priority,
        iconType,
        actionUrl,
        relatedId,
        relatedType
    });
}

/**
 * Payment Approved
 * ✅ FIXED: type = 'payment' (was 'success')
 */
async function notifyPaymentApproved({ userId, appointmentId, amount }) {
    return await notifyUser({
        userId,
        title: 'Thanh toán đã được xác nhận',
        message: `Thanh toán ${amount?.toLocaleString('vi-VN')} đ cho lịch hẹn #${appointmentId} đã được xác nhận`,
        type: 'payment',      // ✅ FIXED: payment (not success)
        priority: 'high',
        iconType: 'success',  // IconType vẫn là success để hiển thị màu xanh
        relatedId: appointmentId,
        relatedType: 'appointment'
    });
}

/**
 * Payment Rejected
 * ✅ FIXED: type = 'payment' (was 'error')
 */
async function notifyPaymentRejected({ userId, appointmentId, reason }) {
    return await notifyUser({
        userId,
        title: 'Thanh toán bị từ chối',
        message: `Thanh toán cho lịch hẹn #${appointmentId} bị từ chối${reason ? `: ${reason}` : ''}`,
        type: 'payment',      // ✅ FIXED: payment (not error)
        priority: 'high',
        iconType: 'error',    // IconType vẫn là error để hiển thị màu đỏ
        relatedId: appointmentId,
        relatedType: 'appointment'
    });
}

/**
 * New Booking (to Admin)
 * ✅ FIXED: type = 'booking' (was 'appointment')
 */
async function notifyNewBooking({ customerName, appointmentId }) {
    return await notifyAdmin({
        title: 'Đặt lịch mới',
        message: `Khách hàng ${customerName} đã đặt lịch sửa xe #${appointmentId}`,
        type: 'booking',      // ✅ FIXED: booking (not appointment)
        priority: 'normal',
        iconType: 'info',
        actionUrl: '/admin-booking.html',
        relatedId: appointmentId,
        relatedType: 'appointment'
    });
}

/**
 * Payment Proof Uploaded (to Admin)
 */
async function notifyPaymentProofUploaded({ customerName, appointmentId, amount }) {
    return await notifyAdmin({
        title: 'Chứng từ thanh toán mới',
        message: `Khách hàng ${customerName} đã upload chứng từ thanh toán ${amount?.toLocaleString('vi-VN')} đ`,
        type: 'payment',      // ✅ Already correct
        priority: 'normal',
        iconType: 'info',
        actionUrl: '/admin-booking.html',
        relatedId: appointmentId,
        relatedType: 'appointment'
    });
}

/**
 * Booking Approved (to User)
 * ✅ FIXED: type = 'booking' (was 'success')
 */
async function notifyBookingApproved({ userId, appointmentId }) {
    return await notifyUser({
        userId,
        title: 'Lịch đã được xác nhận',
        message: `Lịch hẹn #${appointmentId} của bạn đã được xác nhận`,
        type: 'booking',      // ✅ FIXED: booking (not success)
        priority: 'normal',
        iconType: 'success',
        relatedId: appointmentId,
        relatedType: 'appointment'
    });
}

/**
 * Booking Rejected (to User)
 * ✅ FIXED: type = 'booking' (was 'warning')
 */
async function notifyBookingRejected({ userId, appointmentId, reason }) {
    return await notifyUser({
        userId,
        title: 'Lịch bị từ chối',
        message: `Lịch hẹn #${appointmentId} bị từ chối${reason ? `: ${reason}` : ''}`,
        type: 'booking',      // ✅ FIXED: booking (not warning)
        priority: 'high',
        iconType: 'warning',
        relatedId: appointmentId,
        relatedType: 'appointment'
    });
}

/**
 * Service Completed
 * ✅ FIXED: type = 'system' (was 'success')
 */
async function notifyServiceCompleted({ userId, appointmentId }) {
    return await notifyUser({
        userId,
        title: 'Dịch vụ hoàn thành',
        message: `Xe của bạn đã được sửa xong. Vui lòng đến nhận xe.`,
        type: 'system',       // ✅ FIXED: system (not success)
        priority: 'high',
        iconType: 'success',
        relatedId: appointmentId,
        relatedType: 'appointment'
    });
}

/**
 * Appointment Reminder
 */
async function notifyAppointmentReminder({ userId, appointmentId, appointmentTime }) {
    return await notifyUser({
        userId,
        title: 'Nhắc lịch hẹn',
        message: `Bạn có lịch hẹn vào ${appointmentTime}`,
        type: 'reminder',     // ✅ Already correct
        priority: 'high',
        iconType: 'warning',
        relatedId: appointmentId,
        relatedType: 'appointment'
    });
}

// ================================
// EXPORT
// ================================
module.exports = {
    createNotification,
    notifyAdmin,
    notifyUser,
    notifyPaymentApproved,
    notifyPaymentRejected,
    notifyNewBooking,
    notifyPaymentProofUploaded,
    notifyBookingApproved,
    notifyBookingRejected,
    notifyServiceCompleted,
    notifyAppointmentReminder
};

// ================================
// TYPE ENUM VALUES (Database):
// ================================
// booking, payment, system, promotion, reminder, announcement, general