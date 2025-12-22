// ================================
// NOTIFICATION HELPER
// Tạo notifications dễ dàng
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
 * Tạo notification chung
 * @param {Object} params - Notification parameters
 * @returns {Promise<number>} NotificationID
 */
async function createNotification({
    userId = null,  // null = broadcast
    senderId = null,
    title,
    message,
    type = 'system',
    priority = 'normal',
    iconType = 'info',
    actionUrl = null,
    relatedId = null,
    relatedType = null,
    expiresAt = null,
    io = null  // Socket.io instance (optional)
}) {
    try {
        const [result] = await pool.query(`
            INSERT INTO Notifications 
            (UserID, SenderID, Title, Message, Type, Priority, IconType, ActionUrl, RelatedID, RelatedType, ExpiresAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [userId, senderId, title, message, type, priority, iconType, actionUrl, relatedId, relatedType, expiresAt]);
        
        const notificationId = result.insertId;
        
        // Emit socket event if io provided
        if (io) {
            const notification = {
                NotificationID: notificationId,
                Title: title,
                Message: message,
                Type: type,
                Priority: priority,
                IconType: iconType,
                CreatedAt: new Date(),
                IsRead: false
            };
            
            if (userId) {
                io.to(`user_${userId}`).emit('new_notification', notification);
                console.log(`✅ Sent notification to user_${userId}`);
            } else {
                io.emit('new_notification', notification);
                console.log('✅ Broadcast notification to all users');
            }
        }
        
        return notificationId;
        
    } catch (error) {
        console.error('❌ Error creating notification:', error);
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
    senderId = null,
    io = null
}) {
    try {
        // Lấy UserID của admin (RoleID = 1)
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
                relatedType,
                io
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
    senderId = null,
    io = null
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
        relatedType,
        io
    });
}

/**
 * Gửi notification cho Mechanic cụ thể
 */
async function notifyMechanic({
    mechanicId,
    title,
    message,
    type = 'assignment',
    priority = 'normal',
    iconType = 'info',
    actionUrl = null,
    relatedId = null,
    relatedType = null,
    senderId = null,
    io = null
}) {
    return await createNotification({
        userId: mechanicId,
        senderId,
        title,
        message,
        type,
        priority,
        iconType,
        actionUrl,
        relatedId,
        relatedType,
        io
    });
}

/**
 * Broadcast notification cho tất cả users
 */
async function broadcastNotification({
    title,
    message,
    type = 'system',
    priority = 'normal',
    iconType = 'info',
    actionUrl = null,
    expiresAt = null,
    senderId = null,
    io = null
}) {
    return await createNotification({
        userId: null,  // NULL = broadcast
        senderId,
        title,
        message,
        type,
        priority,
        iconType,
        actionUrl,
        expiresAt,
        io
    });
}

// ================================
// SPECIFIC NOTIFICATION FUNCTIONS
// ================================

/**
 * Payment Approved
 */
async function notifyPaymentApproved({ userId, appointmentId, amount, io }) {
    return await notifyUser({
        userId,
        title: 'Thanh toán đã được xác nhận',
        message: `Thanh toán ${amount?.toLocaleString('vi-VN')} đ cho lịch hẹn #${appointmentId} đã được xác nhận`,
        type: 'success',
        priority: 'high',
        iconType: 'success',
        relatedId: appointmentId,
        relatedType: 'appointment',
        io
    });
}

/**
 * Payment Rejected
 */
async function notifyPaymentRejected({ userId, appointmentId, reason, io }) {
    return await notifyUser({
        userId,
        title: 'Thanh toán bị từ chối',
        message: `Thanh toán cho lịch hẹn #${appointmentId} bị từ chối${reason ? `: ${reason}` : ''}`,
        type: 'error',
        priority: 'high',
        iconType: 'error',
        relatedId: appointmentId,
        relatedType: 'appointment',
        io
    });
}

/**
 * New Booking (to Admin)
 */
async function notifyNewBooking({ customerName, appointmentId, io }) {
    return await notifyAdmin({
        title: 'Đặt lịch mới',
        message: `Khách hàng ${customerName} đã đặt lịch sửa xe #${appointmentId}`,
        type: 'appointment',
        priority: 'normal',
        iconType: 'info',
        actionUrl: '/admin-booking.html',
        relatedId: appointmentId,
        relatedType: 'appointment',
        io
    });
}

/**
 * Booking Approved
 */
async function notifyBookingApproved({ userId, appointmentId, io }) {
    return await notifyUser({
        userId,
        title: 'Lịch đã được xác nhận',
        message: `Lịch hẹn #${appointmentId} của bạn đã được xác nhận`,
        type: 'success',
        priority: 'normal',
        iconType: 'success',
        relatedId: appointmentId,
        relatedType: 'appointment',
        io
    });
}

/**
 * Booking Rejected
 */
async function notifyBookingRejected({ userId, appointmentId, reason, io }) {
    return await notifyUser({
        userId,
        title: 'Lịch bị từ chối',
        message: `Lịch hẹn #${appointmentId} bị từ chối${reason ? `: ${reason}` : ''}`,
        type: 'warning',
        priority: 'high',
        iconType: 'warning',
        relatedId: appointmentId,
        relatedType: 'appointment',
        io
    });
}

/**
 * Payment Proof Uploaded (to Admin)
 */
async function notifyPaymentProofUploaded({ customerName, appointmentId, amount, io }) {
    return await notifyAdmin({
        title: 'Chứng từ thanh toán mới',
        message: `Khách hàng ${customerName} đã upload chứng từ thanh toán ${amount?.toLocaleString('vi-VN')} đ`,
        type: 'payment',
        priority: 'normal',
        iconType: 'info',
        actionUrl: '/admin-booking.html',
        relatedId: appointmentId,
        relatedType: 'appointment',
        io
    });
}

/**
 * Service Completed
 */
async function notifyServiceCompleted({ userId, appointmentId, io }) {
    return await notifyUser({
        userId,
        title: 'Dịch vụ hoàn thành',
        message: `Xe của bạn đã được sửa xong. Vui lòng đến nhận xe.`,
        type: 'success',
        priority: 'high',
        iconType: 'success',
        relatedId: appointmentId,
        relatedType: 'appointment',
        io
    });
}

/**
 * Appointment Reminder
 */
async function notifyAppointmentReminder({ userId, appointmentId, appointmentTime, io }) {
    return await notifyUser({
        userId,
        title: 'Nhắc lịch hẹn',
        message: `Bạn có lịch hẹn vào ${appointmentTime}`,
        type: 'reminder',
        priority: 'high',
        iconType: 'warning',
        relatedId: appointmentId,
        relatedType: 'appointment',
        io
    });
}

// ================================
// EXPORT
// ================================
module.exports = {
    createNotification,
    notifyAdmin,
    notifyUser,
    notifyMechanic,
    broadcastNotification,
    
    // Specific functions
    notifyPaymentApproved,
    notifyPaymentRejected,
    notifyNewBooking,
    notifyBookingApproved,
    notifyBookingRejected,
    notifyPaymentProofUploaded,
    notifyServiceCompleted,
    notifyAppointmentReminder
};