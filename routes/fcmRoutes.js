// File: routes/fcmRoutes.js
// Routes xử lý FCM tokens và push notifications
// ✅ Support cả local (file) và Railway (environment variables)

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('./authRoutes');

// Firebase Admin SDK
const admin = require('firebase-admin');

// ========================================
// ✅ FIREBASE ADMIN INITIALIZATION
// Support cả local (file) và Railway (env vars)
// ========================================

let firebaseInitialized = false;

try {
    let credential;
    
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        // ✅ RAILWAY: Đọc từ environment variable
        console.log('📱 Initializing Firebase Admin from environment variable...');
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        credential = admin.credential.cert(serviceAccount);
        console.log('✅ Firebase Admin credential loaded from env var');
    } else {
        // ✅ LOCAL: Đọc từ file
        console.log('📱 Initializing Firebase Admin from file...');
        const serviceAccount = require('../config/firebase-service-account.json');
        credential = admin.credential.cert(serviceAccount);
        console.log('✅ Firebase Admin credential loaded from file');
    }
    
    // Initialize Firebase Admin
    admin.initializeApp({
        credential: credential,
    });
    
    firebaseInitialized = true;
    console.log('✅ Firebase Admin SDK initialized successfully');
    
} catch (err) {
    console.error('❌ Firebase Admin initialization failed:', err.message);
    console.warn('⚠️  Push notifications will NOT work');
    console.warn('   For Railway: Set FIREBASE_SERVICE_ACCOUNT environment variable');
    console.warn('   For Local: Place firebase-service-account.json in config/ folder');
}

/**
 * API: Lưu FCM token của user
 * POST /api/fcm/fcm-token (hoặc /api/notifications/fcm-token)
 */
router.post('/fcm-token', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { fcmToken } = req.body;
        
        if (!fcmToken) {
            return res.status(400).json({
                success: false,
                message: 'FCM token is required',
            });
        }
        
        console.log(`📱 Saving FCM token for user ${userId}`);
        
        // Lưu hoặc update FCM token
        await pool.query(
            `INSERT INTO FCMTokens (UserID, FCMToken, UpdatedAt) 
             VALUES (?, ?, NOW()) 
             ON DUPLICATE KEY UPDATE FCMToken = ?, UpdatedAt = NOW()`,
            [userId, fcmToken, fcmToken]
        );
        
        console.log('✅ FCM token saved successfully');
        
        res.json({
            success: true,
            message: 'FCM token saved successfully',
        });
    } catch (err) {
        console.error('❌ Error saving FCM token:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message,
        });
    }
});

/**
 * Helper: Gửi push notification cho 1 user
 */
async function sendPushNotification(userId, notification) {
    // Check Firebase initialized
    if (!firebaseInitialized) {
        console.warn('⚠️  Cannot send push notification: Firebase not initialized');
        return { success: false, message: 'Firebase not initialized' };
    }
    
    try {
        // Lấy FCM token của user
        const [tokens] = await pool.query(
            'SELECT FCMToken FROM FCMTokens WHERE UserID = ? AND IsActive = 1',
            [userId]
        );
        
        if (tokens.length === 0) {
            console.log(`⚠️  No FCM token found for user ${userId}`);
            return { success: false, message: 'No FCM token' };
        }
        
        const fcmToken = tokens[0].FCMToken;
        
        // Tạo message payload
        const message = {
            notification: {
                title: notification.title || 'VQT Bike Service',
                body: notification.body || '',
            },
            data: {
                type: notification.type || 'general',
                referenceId: notification.referenceId?.toString() || '',
                ...notification.data,
            },
            token: fcmToken,
        };
        
        // Gửi qua Firebase Admin SDK
        const response = await admin.messaging().send(message);
        
        console.log(`✅ Push notification sent to user ${userId}`);
        
        return { success: true, messageId: response };
    } catch (err) {
        console.error(`❌ Error sending push notification to user ${userId}:`, err.message);
        
        // Nếu token invalid, xóa khỏi DB
        if (err.code === 'messaging/invalid-registration-token' || 
            err.code === 'messaging/registration-token-not-registered') {
            await pool.query(
                'UPDATE FCMTokens SET IsActive = 0 WHERE UserID = ?',
                [userId]
            );
            console.log(`🗑️  Removed invalid FCM token for user ${userId}`);
        }
        
        return { success: false, error: err.message };
    }
}

/**
 * Helper: Gửi push notification cho nhiều users
 */
async function sendPushNotificationToMultipleUsers(userIds, notification) {
    if (!firebaseInitialized) {
        console.warn('⚠️  Cannot send push notifications: Firebase not initialized');
        return [];
    }
    
    const results = [];
    
    for (const userId of userIds) {
        const result = await sendPushNotification(userId, notification);
        results.push({ userId, ...result });
    }
    
    return results;
}

/**
 * API: Test gửi push notification (chỉ cho admin)
 * POST /api/fcm/test-push
 */
router.post('/test-push', authenticateToken, async (req, res) => {
    try {
        // Chỉ admin mới được test
        if (req.user.role !== 1) {
            return res.status(403).json({
                success: false,
                message: 'Không có quyền',
            });
        }
        
        if (!firebaseInitialized) {
            return res.status(503).json({
                success: false,
                message: 'Firebase Admin not initialized',
            });
        }
        
        const { userId, title, body } = req.body;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'userId is required',
            });
        }
        
        const result = await sendPushNotification(userId, {
            title: title || 'Test Notification',
            body: body || 'This is a test notification from VQT Bike',
            type: 'test',
        });
        
        res.json({
            success: result.success,
            message: result.success ? 'Notification sent successfully' : result.error,
            data: result,
        });
    } catch (err) {
        console.error('❌ Error sending test notification:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message,
        });
    }
});

/**
 * API: Gửi notification cho 1 user (Admin only)
 * POST /api/fcm/send-notification
 */
router.post('/send-notification', authenticateToken, async (req, res) => {
    try {
        // Check admin
        if (req.user.role !== 1) {
            return res.status(403).json({
                success: false,
                message: 'Chỉ admin mới có quyền gửi notification'
            });
        }
        
        const { userId, notification } = req.body;
        
        // Validation
        if (!userId || !notification || !notification.title) {
            return res.status(400).json({
                success: false,
                message: 'userId và notification.title là bắt buộc'
            });
        }
        
        // Lưu notification vào database
        const [result] = await pool.query(
            `INSERT INTO Notifications 
            (UserID, Title, Message, Type, Priority, IconType, IsRead, CreatedAt)
            VALUES (?, ?, ?, ?, ?, ?, 0, NOW())`,
            [
                userId,
                notification.title,
                notification.body || notification.message || '',
                notification.type || 'general',
                notification.priority || 'normal',
                notification.iconType || 'info'
            ]
        );
        
        const notificationId = result.insertId;
        
        // Gửi push notification
        const pushResult = await sendPushNotification(userId, {
            title: notification.title,
            body: notification.body || notification.message || '',
            type: notification.type || 'general',
            referenceId: notification.referenceId || notificationId,
            data: notification.data || {}
        });
        
        res.json({
            success: true,
            message: 'Notification sent successfully',
            notificationId: notificationId,
            pushSent: pushResult.success
        });
        
    } catch (err) {
        console.error('❌ Error sending notification:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});


/**
 * API: Check Firebase status
 * GET /api/fcm/status
 */
router.get('/status', authenticateToken, async (req, res) => {
    res.json({
        success: true,
        firebaseInitialized,
        message: firebaseInitialized 
            ? 'Firebase Admin SDK is running' 
            : 'Firebase Admin SDK not initialized',
    });
});

// Export router và helpers
module.exports = router;
module.exports.sendPushNotification = sendPushNotification;
module.exports.sendPushNotificationToMultipleUsers = sendPushNotificationToMultipleUsers;
module.exports.firebaseInitialized = firebaseInitialized;