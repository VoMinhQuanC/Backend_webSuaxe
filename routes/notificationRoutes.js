// ================================
// NOTIFICATION ROUTES - FIXED JWT FIELDS
// File: routes/notificationRoutes.js
// ================================

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');

// ================================
// DATABASE CONNECTION
// ================================
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

// ================================
// 1. GET NOTIFICATIONS
// Lấy danh sách thông báo của user
// ================================
router.get('/', async (req, res) => {
    try {
        // FIXED: Check userId field first (from JWT payload)
        const userId = req.user?.userId || req.user?.id || req.user?.UserID;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const unreadOnly = req.query.unread === 'true';
        
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Vui lòng đăng nhập'
            });
        }
        
        // Build query - Lấy notifications của user HOẶC broadcast (UserID = NULL)
        let query = `
            SELECT 
                n.*,
                u.FullName as SenderName
            FROM Notifications n
            LEFT JOIN Users u ON n.SenderID = u.UserID
            WHERE (n.UserID = ? OR n.UserID IS NULL)
              AND n.IsDeleted = FALSE
              AND (n.ExpiresAt IS NULL OR n.ExpiresAt > NOW())
        `;
        
        const params = [userId];
        
        if (unreadOnly) {
            query += ' AND n.IsRead = FALSE';
        }
        
        query += ' ORDER BY n.CreatedAt DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        
        const [notifications] = await pool.query(query, params);
        
        // Get total count
        let countQuery = `
            SELECT COUNT(*) as total
            FROM Notifications
            WHERE (UserID = ? OR UserID IS NULL)
              AND IsDeleted = FALSE
              AND (ExpiresAt IS NULL OR ExpiresAt > NOW())
        `;
        
        const countParams = [userId];
        
        if (unreadOnly) {
            countQuery += ' AND IsRead = FALSE';
        }
        
        const [countResult] = await pool.query(countQuery, countParams);
        const total = countResult[0].total;
        
        res.json({
            success: true,
            data: notifications,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
        
    } catch (error) {
        console.error('❌ Error getting notifications:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server khi lấy thông báo',
            error: error.message
        });
    }
});

// ================================
// 2. GET UNREAD COUNT
// Đếm số thông báo chưa đọc
// ================================
router.get('/unread-count', async (req, res) => {
    try {
        // FIXED: Check userId field first
        const userId = req.user?.userId || req.user?.id || req.user?.UserID;
        
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Vui lòng đăng nhập'
            });
        }
        
        const [result] = await pool.query(`
            SELECT COUNT(*) as unreadCount
            FROM Notifications
            WHERE (UserID = ? OR UserID IS NULL)
              AND IsRead = FALSE
              AND IsDeleted = FALSE
              AND (ExpiresAt IS NULL OR ExpiresAt > NOW())
        `, [userId]);
        
        res.json({
            success: true,
            unreadCount: result[0].unreadCount
        });
        
    } catch (error) {
        console.error('❌ Error getting unread count:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server khi đếm thông báo',
            error: error.message
        });
    }
});

// ================================
// 3. MARK AS READ
// Đánh dấu thông báo đã đọc
// ================================
router.put('/:id/read', async (req, res) => {
    try {
        // FIXED: Check userId field first
        const userId = req.user?.userId || req.user?.id || req.user?.UserID;
        const notificationId = req.params.id;
        
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Vui lòng đăng nhập'
            });
        }
        
        // Update - chỉ update nếu notification thuộc về user này hoặc là broadcast
        await pool.query(`
            UPDATE Notifications
            SET IsRead = TRUE, ReadAt = NOW()
            WHERE NotificationID = ?
              AND (UserID = ? OR UserID IS NULL)
              AND IsDeleted = FALSE
        `, [notificationId, userId]);
        
        res.json({
            success: true,
            message: 'Đã đánh dấu đã đọc'
        });
        
    } catch (error) {
        console.error('❌ Error marking as read:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server khi cập nhật',
            error: error.message
        });
    }
});

// ================================
// 4. MARK ALL AS READ
// Đánh dấu tất cả đã đọc
// ================================
router.put('/read-all', async (req, res) => {
    try {
        // FIXED: Check userId field first
        const userId = req.user?.userId || req.user?.id || req.user?.UserID;
        
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Vui lòng đăng nhập'
            });
        }
        
        await pool.query(`
            UPDATE Notifications
            SET IsRead = TRUE, ReadAt = NOW()
            WHERE (UserID = ? OR UserID IS NULL)
              AND IsRead = FALSE
              AND IsDeleted = FALSE
        `, [userId]);
        
        res.json({
            success: true,
            message: 'Đã đánh dấu tất cả đã đọc'
        });
        
    } catch (error) {
        console.error('❌ Error marking all as read:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server khi cập nhật',
            error: error.message
        });
    }
});

// ================================
// 5. DELETE NOTIFICATION
// Xóa thông báo (soft delete)
// ================================
router.delete('/:id', async (req, res) => {
    try {
        // FIXED: Check userId field first
        const userId = req.user?.userId || req.user?.id || req.user?.UserID;
        const notificationId = req.params.id;
        
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Vui lòng đăng nhập'
            });
        }
        
        // Soft delete
        await pool.query(`
            UPDATE Notifications
            SET IsDeleted = TRUE, DeletedAt = NOW()
            WHERE NotificationID = ?
              AND (UserID = ? OR UserID IS NULL)
        `, [notificationId, userId]);
        
        res.json({
            success: true,
            message: 'Đã xóa thông báo'
        });
        
    } catch (error) {
        console.error('❌ Error deleting notification:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server khi xóa',
            error: error.message
        });
    }
});

// ================================
// 6. SEND NOTIFICATION (ADMIN ONLY)
// Gửi thông báo cho user
// ================================
router.post('/send', async (req, res) => {
    try {
        // FIXED: Check userId and role fields
        const adminId = req.user?.userId || req.user?.id || req.user?.UserID;
        const adminRoleId = req.user?.role || req.user?.roleId || req.user?.RoleID;
        
        // Check admin permission (RoleID = 1 là Admin)
        if (!adminId || adminRoleId !== 1) {
            return res.status(403).json({
                success: false,
                message: 'Chỉ Admin mới có quyền gửi thông báo'
            });
        }
        
        const {
            userId,  // null = broadcast to all users
            title,
            message,
            type = 'system',
            priority = 'normal',
            iconType = 'info',
            actionUrl = null,
            relatedId = null,
            relatedType = null,
            expiresAt = null
        } = req.body;
        
        // Validate
        if (!title || !message) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu tiêu đề hoặc nội dung'
            });
        }
        
        // Insert notification
        const [result] = await pool.query(`
            INSERT INTO Notifications 
            (UserID, SenderID, Title, Message, Type, Priority, IconType, ActionUrl, RelatedID, RelatedType, ExpiresAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [userId, adminId, title, message, type, priority, iconType, actionUrl, relatedId, relatedType, expiresAt]);
        
        const notificationId = result.insertId;
        
        // Emit socket event (real-time)
        const io = req.app.get('io');
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
                // Send to specific user
                io.to(`user_${userId}`).emit('new_notification', notification);
                console.log(`✅ Sent notification to user_${userId}`);
            } else {
                // Broadcast to all users
                io.emit('new_notification', notification);
                console.log('✅ Broadcast notification to all users');
            }
        }
        
        res.json({
            success: true,
            message: userId ? 'Đã gửi thông báo' : 'Đã gửi thông báo tới tất cả người dùng',
            notificationId
        });
        
    } catch (error) {
        console.error('❌ Error sending notification:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server khi gửi thông báo',
            error: error.message
        });
    }
});

// ================================
// EXPORT ROUTER
// ================================
module.exports = router;

// ================================
// NOTES:
// - FIXED: JWT payload uses userId, role (not id, UserID, RoleID)
// - Tương thích với database schema hiện tại (websuaxe)
// - RoleID = 1 là Admin
// - UserID NULL = broadcast
// - Soft delete với IsDeleted flag
// ================================