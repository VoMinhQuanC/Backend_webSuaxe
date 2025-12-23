// ================================
// NOTIFICATION HELPER - WITH MECHANIC SUPPORT
// Complete workflow for Admin, User, và Mechanic
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

/**
 * Gửi notification cho Mechanic cụ thể
 */
async function notifyMechanic({
    mechanicId,
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
        userId: mechanicId,
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
 * Gửi cho: USER (confirm) + ADMIN (alert) + MECHANIC (nếu đã assign)
 */
async function notifyBookingCreated({ userId, customerName, appointmentId, appointmentDate, services, mechanicId }) {
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
        
        // Notification cho MECHANIC (nếu đã assign)
        if (mechanicId) {
            await notifyMechanic({
                mechanicId,
                title: '🔧 Lịch hẹn mới được phân công',
                message: `Bạn được phân công sửa xe cho khách hàng ${customerName} (Lịch hẹn #${appointmentId})${appointmentDate ? ` - ${appointmentDate}` : ''}${services ? ` - ${services}` : ''}`,
                type: 'booking',
                priority: 'normal',
                iconType: 'info',
                actionUrl: '/mechanic-appointments.html',
                relatedId: appointmentId,
                relatedType: 'appointment'
            });
            console.log(`✅ Mechanic notification sent to mechanic #${mechanicId}`);
        }
        
        console.log(`✅ Booking creation notifications sent for appointment #${appointmentId}`);
        
    } catch (error) {
        console.error('❌ Error sending booking creation notifications:', error);
        throw error;
    }
}

/**
 * STEP 2: Admin Confirmed Booking  
 * Gửi cho: USER + MECHANIC (nếu có)
 */
async function notifyBookingConfirmed({ userId, appointmentId, appointmentDate, garage, mechanicId, mechanicName }) {
    try {
        // Notification cho USER
        await notifyUser({
            userId,
            title: '✅ Lịch hẹn đã được xác nhận',
            message: `Lịch hẹn #${appointmentId} đã được xác nhận!${appointmentDate ? ` 📅 Thời gian: ${appointmentDate}.` : ''}${mechanicName ? ` 👨‍🔧 Kỹ thuật viên: ${mechanicName}.` : ''} Vui lòng đến đúng giờ nhé!`,
            type: 'booking',
            priority: 'high',
            iconType: 'success',
            relatedId: appointmentId,
            relatedType: 'appointment'
        });
        
        // Notification cho MECHANIC (nếu có)
        if (mechanicId) {
            await notifyMechanic({
                mechanicId,
                title: '✅ Lịch hẹn đã xác nhận',
                message: `Lịch hẹn #${appointmentId} đã được xác nhận. Vui lòng chuẩn bị tiếp nhận xe.${appointmentDate ? ` 📅 Thời gian: ${appointmentDate}.` : ''}`,
                type: 'booking',
                priority: 'high',
                iconType: 'success',
                actionUrl: '/mechanic-appointments.html',
                relatedId: appointmentId,
                relatedType: 'appointment'
            });
            console.log(`✅ Mechanic notification sent to mechanic #${mechanicId}`);
        }
        
        console.log(`✅ Booking confirmation notifications sent for appointment #${appointmentId}`);
        
    } catch (error) {
        console.error('❌ Error sending booking confirmation notifications:', error);
        throw error;
    }
}

/**
 * STEP 3: Service Started (InProgress)
 * Gửi cho: USER + MECHANIC
 */
async function notifyServiceInProgress({ userId, appointmentId, mechanicId, mechanicName }) {
    try {
        // Notification cho USER
        await notifyUser({
            userId,
            title: '🔧 Đang sửa xe',
            message: `Xe của bạn đang được xử lý (Lịch hẹn #${appointmentId}).${mechanicName ? ` Kỹ thuật viên ${mechanicName} đang làm việc.` : ''} Chúng tôi sẽ thông báo khi hoàn thành.`,
            type: 'booking',
            priority: 'normal',
            iconType: 'info',
            relatedId: appointmentId,
            relatedType: 'appointment'
        });
        
        // Notification cho MECHANIC
        if (mechanicId) {
            await notifyMechanic({
                mechanicId,
                title: '🔧 Bắt đầu sửa xe',
                message: `Lịch hẹn #${appointmentId} đã chuyển sang trạng thái "Đang sửa". Vui lòng cập nhật tiến độ thường xuyên.`,
                type: 'booking',
                priority: 'normal',
                iconType: 'info',
                actionUrl: '/mechanic-appointments.html',
                relatedId: appointmentId,
                relatedType: 'appointment'
            });
            console.log(`✅ Mechanic notification sent to mechanic #${mechanicId}`);
        }
        
        console.log(`✅ Service in-progress notifications sent for appointment #${appointmentId}`);
        
    } catch (error) {
        console.error('❌ Error sending in-progress notifications:', error);
        throw error;
    }
}

/**
 * STEP 4: Service Completed
 * Gửi cho: USER + MECHANIC
 */
async function notifyServiceCompleted({ userId, appointmentId, mechanicId, totalAmount, paymentMethod }) {
    try {
        const paymentInfo = paymentMethod === 'Chuyển khoản ngân hàng' 
            ? 'Vui lòng kiểm tra thông tin thanh toán.' 
            : totalAmount 
                ? `💰 Tổng tiền: ${totalAmount.toLocaleString('vi-VN')}đ. Vui lòng thanh toán tại quầy.`
                : 'Vui lòng thanh toán tại quầy.';
        
        // Notification cho USER
        await notifyUser({
            userId,
            title: '🎉 Dịch vụ hoàn thành',
            message: `Xe của bạn đã được sửa xong (Lịch hẹn #${appointmentId}). ${paymentInfo} Cảm ơn bạn đã sử dụng dịch vụ!`,
            type: 'booking',
            priority: 'high',
            iconType: 'success',
            relatedId: appointmentId,
            relatedType: 'appointment'
        });
        
        // Notification cho MECHANIC
        if (mechanicId) {
            await notifyMechanic({
                mechanicId,
                title: '🎉 Hoàn thành lịch hẹn',
                message: `Lịch hẹn #${appointmentId} đã hoàn thành. Cảm ơn bạn đã hoàn thành tốt công việc!`,
                type: 'booking',
                priority: 'normal',
                iconType: 'success',
                actionUrl: '/mechanic-appointments.html',
                relatedId: appointmentId,
                relatedType: 'appointment'
            });
            console.log(`✅ Mechanic completion notification sent to mechanic #${mechanicId}`);
        }
        
        console.log(`✅ Service completion notifications sent for appointment #${appointmentId}`);
        
    } catch (error) {
        console.error('❌ Error sending completion notifications:', error);
        throw error;
    }
}

/**
 * STEP 5: Booking Rejected/Canceled
 */
async function notifyBookingRejected({ userId, appointmentId, mechanicId, reason, status }) {
    try {
        const titleMap = {
            'Rejected': '❌ Lịch hẹn bị từ chối',
            'Canceled': '⚠️ Lịch hẹn đã bị hủy'
        };
        
        // Notification cho USER
        await notifyUser({
            userId,
            title: titleMap[status] || '⚠️ Lịch hẹn đã bị hủy',
            message: `Lịch hẹn #${appointmentId} đã bị ${status === 'Rejected' ? 'từ chối' : 'hủy'}${reason ? `: ${reason}` : ''}. Vui lòng đặt lịch khác hoặc liên hệ chúng tôi để được hỗ trợ.`,
            type: 'booking',
            priority: 'high',
            iconType: 'warning',
            relatedId: appointmentId,
            relatedType: 'appointment'
        });
        
        // Notification cho MECHANIC (nếu có)
        if (mechanicId) {
            await notifyMechanic({
                mechanicId,
                title: titleMap[status] || '⚠️ Lịch hẹn đã bị hủy',
                message: `Lịch hẹn #${appointmentId} đã bị ${status === 'Rejected' ? 'từ chối' : 'hủy'}${reason ? `: ${reason}` : ''}.`,
                type: 'booking',
                priority: 'normal',
                iconType: 'warning',
                actionUrl: '/mechanic-appointments.html',
                relatedId: appointmentId,
                relatedType: 'appointment'
            });
            console.log(`✅ Mechanic rejection notification sent to mechanic #${mechanicId}`);
        }
        
        console.log(`✅ Booking rejection notifications sent for appointment #${appointmentId}`);
        
    } catch (error) {
        console.error('❌ Error sending rejection notifications:', error);
        throw error;
    }
}

/**
 * MECHANIC ASSIGNED: Admin assigns mechanic to appointment
 * Gửi cho: MECHANIC
 */
async function notifyMechanicAssigned({ mechanicId, mechanicName, appointmentId, customerName, appointmentDate, services }) {
    return await notifyMechanic({
        mechanicId,
        title: '👨‍🔧 Phân công lịch hẹn mới',
        message: `Bạn được phân công sửa xe cho khách hàng ${customerName} (Lịch hẹn #${appointmentId})${appointmentDate ? ` - ${appointmentDate}` : ''}${services ? ` - ${services}` : ''}. Vui lòng chuẩn bị tiếp nhận xe.`,
        type: 'booking',
        priority: 'high',
        iconType: 'info',
        actionUrl: '/mechanic-appointments.html',
        relatedId: appointmentId,
        relatedType: 'appointment'
    });
}

// ================================
// PAYMENT WORKFLOW NOTIFICATIONS
// ================================

/**
 * PAYMENT 1: User Upload Payment Proof
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
async function notifyAppointmentReminder({ userId, mechanicId, appointmentId, appointmentTime }) {
    try {
        // Notification cho USER
        await notifyUser({
            userId,
            title: '⏰ Nhắc lịch hẹn',
            message: `Bạn có lịch hẹn vào ${appointmentTime}. Vui lòng đến đúng giờ!`,
            type: 'reminder',
            priority: 'high',
            iconType: 'warning',
            relatedId: appointmentId,
            relatedType: 'appointment'
        });
        
        // Notification cho MECHANIC (nếu có)
        if (mechanicId) {
            await notifyMechanic({
                mechanicId,
                title: '⏰ Nhắc lịch làm việc',
                message: `Bạn có lịch sửa xe vào ${appointmentTime} (Lịch hẹn #${appointmentId}). Vui lòng chuẩn bị sẵn sàng!`,
                type: 'reminder',
                priority: 'high',
                iconType: 'warning',
                actionUrl: '/mechanic-appointments.html',
                relatedId: appointmentId,
                relatedType: 'appointment'
            });
        }
        
        console.log(`✅ Appointment reminder sent for #${appointmentId}`);
        
    } catch (error) {
        console.error('❌ Error sending reminder:', error);
        throw error;
    }
}

// ================================
// EXPORT
// ================================
module.exports = {
    // Core functions
    createNotification,
    notifyAdmin,
    notifyUser,
    notifyMechanic,        // NEW! For mechanics
    
    // Booking workflow (5 steps) - Updated with mechanic support
    notifyBookingCreated,        // Step 1: Đặt lịch (+ mechanic if assigned)
    notifyBookingConfirmed,      // Step 2: Xác nhận (+ mechanic)
    notifyServiceInProgress,     // Step 3: Đang sửa (+ mechanic)
    notifyServiceCompleted,      // Step 4: Hoàn thành (+ mechanic)
    notifyBookingRejected,       // Step 5: Từ chối/Hủy (+ mechanic if assigned)
    
    // Mechanic specific
    notifyMechanicAssigned,      // NEW! Admin assigns mechanic
    
    // Payment workflow (3 steps)
    notifyPaymentProofUploaded,  // Payment 1: Upload proof
    notifyPaymentApproved,       // Payment 2: Duyệt
    notifyPaymentRejected,       // Payment 3: Từ chối
    
    // Additional
    notifyAppointmentReminder    // Reminder (+ mechanic)
};