// ================================
// NOTIFICATION HELPER - COMPLETE WORKFLOW
// Tất cả các bước: Booking → Confirmed → InProgress → Completed
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
// BOOKING WORKFLOW NOTIFICATIONS
// ================================

/**
 * STEP 1: User Created Booking
 * Status: PendingApproval (ẨN)
 * Gửi cho: USER (confirm) + ADMIN (alert)
 */
async function notifyBookingCreated({ userId, customerName, appointmentId, appointmentDate, services }) {
    try {
        // Notification cho USER
        await notifyUser({
            userId,
            title: '📝 Đặt lịch thành công',
            message: `Yêu cầu đặt lịch #${appointmentId} của bạn đã được gửi. Chúng tôi sẽ xác nhận trong 24h.`,
            type: 'booking',
            priority: 'normal',
            iconType: 'info',
            relatedId: appointmentId,
            relatedType: 'appointment'
        });
        
        // Notification cho ADMIN
        await notifyAdmin({
            title: '🔔 Đặt lịch mới',
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
 * STEP 2: Admin Confirmed Booking
 * Status: PendingApproval → Confirmed (HIỆN)
 * Gửi cho: USER
 */
async function notifyBookingConfirmed({ userId, appointmentId, appointmentDate, garage, mechanicName }) {
    return await notifyUser({
        userId,
        title: '✅ Lịch hẹn đã được xác nhận',
        message: `Lịch hẹn #${appointmentId} đã được xác nhận!${appointmentDate ? ` 📅 Thời gian: ${appointmentDate}.` : ''}${mechanicName ? ` 👨‍🔧 Kỹ thuật viên: ${mechanicName}.` : ''} Vui lòng đến đúng giờ nhé!`,
        type: 'booking',
        priority: 'high',
        iconType: 'success',
        relatedId: appointmentId,
        relatedType: 'appointment'
    });
}

/**
 * STEP 3: Service Started (InProgress)
 * Status: Confirmed → InProgress
 * Gửi cho: USER
 */
async function notifyServiceInProgress({ userId, appointmentId, mechanicName }) {
    return await notifyUser({
        userId,
        title: '🔧 Đang sửa xe',
        message: `Xe của bạn đang được xử lý (Lịch hẹn #${appointmentId}).${mechanicName ? ` Kỹ thuật viên ${mechanicName} đang làm việc.` : ''} Chúng tôi sẽ thông báo khi hoàn thành.`,
        type: 'booking',
        priority: 'normal',
        iconType: 'info',
        relatedId: appointmentId,
        relatedType: 'appointment'
    });
}

/**
 * STEP 4: Service Completed
 * Status: InProgress → Completed
 * Gửi cho: USER
 */
async function notifyServiceCompleted({ userId, appointmentId, totalAmount, paymentMethod }) {
    const paymentInfo = paymentMethod === 'Chuyển khoản ngân hàng' 
        ? 'Vui lòng kiểm tra thông tin thanh toán.' 
        : totalAmount 
            ? `💰 Tổng tiền: ${totalAmount.toLocaleString('vi-VN')}đ. Vui lòng thanh toán tại quầy.`
            : 'Vui lòng thanh toán tại quầy.';
    
    return await notifyUser({
        userId,
        title: '🎉 Dịch vụ hoàn thành',
        message: `Xe của bạn đã được sửa xong (Lịch hẹn #${appointmentId}). ${paymentInfo} Cảm ơn bạn đã sử dụng dịch vụ!`,
        type: 'booking',
        priority: 'high',
        iconType: 'success',
        relatedId: appointmentId,
        relatedType: 'appointment'
    });
}

/**
 * STEP 5: Booking Rejected/Canceled
 * Status: Any → Rejected/Canceled
 * Gửi cho: USER
 */
async function notifyBookingRejected({ userId, appointmentId, reason, status }) {
    const titleMap = {
        'Rejected': '❌ Lịch hẹn bị từ chối',
        'Canceled': '⚠️ Lịch hẹn đã bị hủy'
    };
    
    return await notifyUser({
        userId,
        title: titleMap[status] || '⚠️ Lịch hẹn đã bị hủy',
        message: `Lịch hẹn #${appointmentId} đã bị ${status === 'Rejected' ? 'từ chối' : 'hủy'}${reason ? `: ${reason}` : ''}. Vui lòng đặt lịch khác hoặc liên hệ chúng tôi để được hỗ trợ.`,
        type: 'booking',
        priority: 'high',
        iconType: 'warning',
        relatedId: appointmentId,
        relatedType: 'appointment'
    });
}

// ================================
// PAYMENT WORKFLOW NOTIFICATIONS
// ================================

/**
 * PAYMENT 1: User Upload Payment Proof
 * Gửi cho: USER (confirm) + ADMIN (alert)
 */
async function notifyPaymentProofUploaded({ userId, customerName, appointmentId, amount }) {
    try {
        // Notification cho USER
        await notifyUser({
            userId,
            title: '📤 Đã gửi chứng từ thanh toán',
            message: `Chứng từ thanh toán cho lịch hẹn #${appointmentId} đã được gửi. Admin sẽ xét duyệt trong 24h.`,
            type: 'payment',
            priority: 'normal',
            iconType: 'info',
            relatedId: appointmentId,
            relatedType: 'appointment'
        });
        
        // Notification cho ADMIN
        await notifyAdmin({
            title: '💰 Chứng từ thanh toán mới',
            message: `Khách hàng ${customerName} đã upload chứng từ thanh toán ${amount?.toLocaleString('vi-VN')}đ (Lịch hẹn #${appointmentId})`,
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
 * PAYMENT 2: Admin Approved Payment
 */
async function notifyPaymentApproved({ userId, appointmentId, amount }) {
    return await notifyUser({
        userId,
        title: '✅ Thanh toán đã được xác nhận',
        message: `Thanh toán ${amount?.toLocaleString('vi-VN')}đ cho lịch hẹn #${appointmentId} đã được xác nhận. Cảm ơn bạn!`,
        type: 'payment',
        priority: 'high',
        iconType: 'success',
        relatedId: appointmentId,
        relatedType: 'appointment'
    });
}

/**
 * PAYMENT 3: Admin Rejected Payment
 */
async function notifyPaymentRejected({ userId, appointmentId, reason }) {
    return await notifyUser({
        userId,
        title: '❌ Thanh toán bị từ chối',
        message: `Chứng từ thanh toán cho lịch hẹn #${appointmentId} bị từ chối${reason ? `: ${reason}` : ''}. Vui lòng upload lại chứng từ chính xác.`,
        type: 'payment',
        priority: 'high',
        iconType: 'error',
        relatedId: appointmentId,
        relatedType: 'appointment'
    });
}

// ================================
// ADDITIONAL NOTIFICATIONS
// ================================

/**
 * Appointment Reminder (24h trước)
 */
async function notifyAppointmentReminder({ userId, appointmentId, appointmentTime }) {
    return await notifyUser({
        userId,
        title: '⏰ Nhắc lịch hẹn',
        message: `Bạn có lịch hẹn vào ${appointmentTime}. Vui lòng đến đúng giờ!`,
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
    
    // Booking workflow (5 steps)
    notifyBookingCreated,        // Step 1: Đặt lịch
    notifyBookingConfirmed,      // Step 2: Xác nhận
    notifyServiceInProgress,     // Step 3: Đang sửa
    notifyServiceCompleted,      // Step 4: Hoàn thành
    notifyBookingRejected,       // Step 5: Từ chối/Hủy
    
    // Payment workflow (3 steps)
    notifyPaymentProofUploaded,  // Payment 1: Upload proof
    notifyPaymentApproved,       // Payment 2: Duyệt
    notifyPaymentRejected,       // Payment 3: Từ chối
    
    // Additional
    notifyAppointmentReminder    // Reminder
};