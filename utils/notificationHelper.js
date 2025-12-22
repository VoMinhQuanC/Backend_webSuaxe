// ================================
// NOTIFICATION HELPER - COMPLETE
// All Payment + Booking Workflows
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
 */
async function createNotification({
    userId = null,
    senderId = null,
    title,
    message,
    type = 'system',
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

// ================================
// PAYMENT WORKFLOW NOTIFICATIONS
// ================================

/**
 * A1. User Upload Payment Proof
 * Gửi cho: USER (confirm) + ADMIN (alert)
 */
async function notifyPaymentProofUploaded({ userId, customerName, appointmentId, amount }) {
    try {
        // Notification cho USER
        await notifyUser({
            userId,
            title: 'Đã gửi chứng từ thanh toán',
            message: `Chứng từ thanh toán của bạn đang được admin xét duyệt. Vui lòng đợi trong 24h.`,
            type: 'payment',
            priority: 'normal',
            iconType: 'info',
            relatedId: appointmentId,
            relatedType: 'appointment'
        });
        
        // Notification cho ADMIN
        await notifyAdmin({
            title: 'Chứng từ thanh toán mới',
            message: `Khách hàng ${customerName} đã upload chứng từ thanh toán ${amount?.toLocaleString('vi-VN')} đ`,
            type: 'payment',
            priority: 'normal',
            iconType: 'info',
            actionUrl: '/admin-booking.html',
            relatedId: appointmentId,
            relatedType: 'appointment'
        });
        
        console.log(`✅ Payment proof upload notifications sent for appointment #${appointmentId}`);
        
    } catch (error) {
        console.error('❌ Error sending payment proof upload notifications:', error);
        throw error;
    }
}

/**
 * A2. Admin Approved Payment
 */
async function notifyPaymentApproved({ userId, appointmentId, amount }) {
    return await notifyUser({
        userId,
        title: 'Thanh toán đã được xác nhận',
        message: `Thanh toán ${amount?.toLocaleString('vi-VN')} đ cho lịch hẹn #${appointmentId} đã được xác nhận. Cảm ơn bạn!`,
        type: 'payment',
        priority: 'high',
        iconType: 'success',
        relatedId: appointmentId,
        relatedType: 'appointment'
    });
}

/**
 * A3. Admin Rejected Payment
 */
async function notifyPaymentRejected({ userId, appointmentId, reason }) {
    return await notifyUser({
        userId,
        title: 'Thanh toán bị từ chối',
        message: `Thanh toán cho lịch hẹn #${appointmentId} bị từ chối${reason ? `: ${reason}` : ''}`,
        type: 'payment',
        priority: 'high',
        iconType: 'error',
        relatedId: appointmentId,
        relatedType: 'appointment'
    });
}

// ================================
// BOOKING WORKFLOW NOTIFICATIONS
// ================================

/**
 * B1. User Created Booking
 * Gửi cho: USER (confirm) + ADMIN (alert)
 */
async function notifyBookingCreated({ userId, customerName, appointmentId, appointmentDate, services }) {
    try {
        // Notification cho USER
        await notifyUser({
            userId,
            title: 'Đã gửi yêu cầu đặt lịch',
            message: `Yêu cầu đặt lịch #${appointmentId} của bạn đang được admin xem xét. Chúng tôi sẽ phản hồi trong 24h.`,
            type: 'booking',
            priority: 'normal',
            iconType: 'info',
            relatedId: appointmentId,
            relatedType: 'appointment'
        });
        
        // Notification cho ADMIN
        await notifyAdmin({
            title: 'Đặt lịch mới',
            message: `Khách hàng ${customerName} đã đặt lịch sửa xe #${appointmentId}${appointmentDate ? ` - ${appointmentDate}` : ''}${services ? ` - ${services}` : ''}`,
            type: 'booking',
            priority: 'normal',
            iconType: 'info',
            actionUrl: '/admin-booking.html',
            relatedId: appointmentId,
            relatedType: 'appointment'
        });
        
        console.log(`✅ Booking creation notifications sent for appointment #${appointmentId}`);
        
    } catch (error) {
        console.error('❌ Error sending booking creation notifications:', error);
        throw error;
    }
}

/**
 * B2. Admin Approved Booking
 */
async function notifyBookingApproved({ userId, appointmentId, appointmentDate, garage }) {
    return await notifyUser({
        userId,
        title: 'Lịch hẹn đã được xác nhận',
        message: `Lịch hẹn #${appointmentId} của bạn đã được xác nhận.${appointmentDate ? ` Thời gian: ${appointmentDate}` : ''}${garage ? ` - Địa điểm: ${garage}` : ''}`,
        type: 'booking',
        priority: 'normal',
        iconType: 'success',
        relatedId: appointmentId,
        relatedType: 'appointment'
    });
}

/**
 * B3. Admin Rejected Booking
 */
async function notifyBookingRejected({ userId, appointmentId, reason }) {
    return await notifyUser({
        userId,
        title: 'Lịch hẹn bị từ chối',
        message: `Lịch hẹn #${appointmentId} bị từ chối${reason ? `: ${reason}` : ''}. Vui lòng chọn thời gian khác.`,
        type: 'booking',
        priority: 'high',
        iconType: 'warning',
        relatedId: appointmentId,
        relatedType: 'appointment'
    });
}

// ================================
// ADDITIONAL NOTIFICATIONS
// ================================

/**
 * Service Completed
 */
async function notifyServiceCompleted({ userId, appointmentId }) {
    return await notifyUser({
        userId,
        title: 'Dịch vụ hoàn thành',
        message: `Xe của bạn đã được sửa xong. Vui lòng đến nhận xe.`,
        type: 'system',
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
        type: 'reminder',
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
    // Core functions
    createNotification,
    notifyAdmin,
    notifyUser,
    
    // Payment workflow
    notifyPaymentProofUploaded,
    notifyPaymentApproved,
    notifyPaymentRejected,
    
    // Booking workflow
    notifyBookingCreated,
    notifyBookingApproved,
    notifyBookingRejected,
    
    // Additional
    notifyServiceCompleted,
    notifyAppointmentReminder
};