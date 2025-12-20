// routes/paymentProofRoutes.js
// API quản lý chứng từ thanh toán chuyển khoản

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { pool } = require('../db');
const { authenticateToken } = require('./authRoutes');

// ============ CLOUDINARY CONFIG ============
// Nếu chưa có file config/cloudinary.js, dùng inline config
let cloudinary;
try {
    cloudinary = require('../config/cloudinary');
} catch (e) {
    // Fallback: inline config
    cloudinary = require('cloudinary').v2;
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'your_cloud_name',
        api_key: process.env.CLOUDINARY_API_KEY || 'your_api_key',
        api_secret: process.env.CLOUDINARY_API_SECRET || 'your_api_secret'
    });
    console.log('⚠️ paymentProofRoutes: Using inline Cloudinary config');
}
// ============================================

// Multer config - lưu vào memory
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Chỉ chấp nhận file hình ảnh!'), false);
        }
        cb(null, true);
    }
});

// Thời gian hết hạn thanh toán (15 phút)
const PAYMENT_EXPIRY_MINUTES = 15;

/**
 * Helper: Upload ảnh lên Cloudinary
 */
async function uploadToCloudinary(buffer, folder, filename) {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: `suaxe/${folder}`,
                public_id: filename,
                resource_type: 'image',
                transformation: [
                    { width: 1200, height: 1600, crop: 'limit' },
                    { quality: 'auto' }
                ]
            },
            (error, result) => {
                if (error) reject(error);
                else resolve(result);
            }
        );
        uploadStream.end(buffer);
    });
}

// ============================================
// CUSTOMER APIs
// ============================================

/**
 * API: Tạo yêu cầu thanh toán (khi khách chọn chuyển khoản)
 * POST /api/payment-proof/create
 * Body: { appointmentId, amount }
 */
router.post('/create', authenticateToken, async (req, res) => {
    try {
        const { appointmentId, amount } = req.body;
        const userId = req.user.userId;

        // Validate
        if (!appointmentId || !amount) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu thông tin bắt buộc'
            });
        }

        // Kiểm tra appointment thuộc về user này
        const [appointments] = await pool.query(
            'SELECT * FROM Appointments WHERE AppointmentID = ? AND UserID = ? AND IsDeleted = 0',
            [appointmentId, userId]
        );

        if (appointments.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy đơn hàng'
            });
        }

        // Kiểm tra xem đã có proof pending chưa
        const [existingProofs] = await pool.query(
            'SELECT * FROM PaymentProofs WHERE AppointmentID = ? AND Status IN ("Pending", "WaitingReview")',
            [appointmentId]
        );

        if (existingProofs.length > 0) {
            // Trả về proof đã tồn tại
            const existingProof = existingProofs[0];
            const remainingTime = Math.max(0, Math.floor((new Date(existingProof.ExpiresAt) - new Date()) / 1000));
            
            return res.json({
                success: true,
                message: 'Đã có yêu cầu thanh toán',
                data: {
                    proofId: existingProof.ProofID,
                    status: existingProof.Status,
                    expiresAt: existingProof.ExpiresAt,
                    remainingSeconds: remainingTime,
                    transferContent: existingProof.TransferContent
                }
            });
        }

        // Tạo mã nội dung chuyển khoản
        const transferContent = `BK${appointmentId}`;
        
        // Tính thời gian hết hạn
        const now = new Date();
        const expiresAt = new Date(now.getTime() + PAYMENT_EXPIRY_MINUTES * 60 * 1000);

        // Insert vào database
        const [result] = await pool.query(
            `INSERT INTO PaymentProofs 
             (AppointmentID, Amount, TransferContent, QRGeneratedAt, ExpiresAt, Status) 
             VALUES (?, ?, ?, ?, ?, 'Pending')`,
            [appointmentId, amount, transferContent, now, expiresAt]
        );

        console.log(`✅ Payment proof created: ${result.insertId} for appointment ${appointmentId}`);

        res.json({
            success: true,
            message: 'Tạo yêu cầu thanh toán thành công',
            data: {
                proofId: result.insertId,
                transferContent: transferContent,
                amount: amount,
                expiresAt: expiresAt,
                remainingSeconds: PAYMENT_EXPIRY_MINUTES * 60
            }
        });

    } catch (error) {
        console.error('❌ Error creating payment proof:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

/**
 * API: Upload ảnh chứng từ thanh toán
 * POST /api/payment-proof/upload/:proofId
 * FormData: image (file)
 */
router.post('/upload/:proofId', authenticateToken, upload.single('image'), async (req, res) => {
    try {
        const { proofId } = req.params;
        const userId = req.user.userId;

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng chọn ảnh chứng từ thanh toán'
            });
        }

        // Lấy thông tin proof và kiểm tra quyền
        const [proofs] = await pool.query(`
            SELECT pp.*, a.UserID 
            FROM PaymentProofs pp
            JOIN Appointments a ON pp.AppointmentID = a.AppointmentID
            WHERE pp.ProofID = ?
        `, [proofId]);

        if (proofs.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy yêu cầu thanh toán'
            });
        }

        const proof = proofs[0];

        // Kiểm tra quyền sở hữu
        if (proof.UserID !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Không có quyền thực hiện'
            });
        }

        // Kiểm tra trạng thái
        if (proof.Status !== 'Pending') {
            return res.status(400).json({
                success: false,
                message: `Không thể upload ảnh. Trạng thái hiện tại: ${proof.Status}`
            });
        }

        // Kiểm tra hết hạn
        if (new Date() > new Date(proof.ExpiresAt)) {
            // Cập nhật status thành Expired
            await pool.query(
                'UPDATE PaymentProofs SET Status = "Expired" WHERE ProofID = ?',
                [proofId]
            );

            return res.status(400).json({
                success: false,
                message: 'Đã quá thời gian thanh toán (15 phút). Vui lòng đặt lịch lại.'
            });
        }

        // Upload ảnh lên Cloudinary
        const filename = `payment_proof_${proofId}_${Date.now()}`;
        const uploadResult = await uploadToCloudinary(
            req.file.buffer, 
            'payment-proofs', 
            filename
        );

        // Cập nhật database
        await pool.query(`
            UPDATE PaymentProofs 
            SET ImageUrl = ?, 
                ImagePublicId = ?,
                ProofUploadedAt = NOW(),
                Status = 'WaitingReview'
            WHERE ProofID = ?
        `, [uploadResult.secure_url, uploadResult.public_id, proofId]);

        console.log(`✅ Payment proof uploaded: ${proofId}`);
        // ⭐ UPDATE APPOINTMENT STATUS TO PENDINGAPPROVAL ⭐
        await pool.query(`
            UPDATE Appointments 
            SET Status = 'PendingApproval'
            WHERE AppointmentID = ?
        `, [proof.AppointmentID]);

        console.log(`📊 Appointment ${proof.AppointmentID} status updated to: PendingApproval`);

        // TODO: Emit socket event để notify admin
        // socketService.emitNewPaymentProof(proofId);

        res.json({
            success: true,
            message: 'Upload ảnh thành công! Đang chờ admin xác nhận.',
            data: {
                proofId: proofId,
                imageUrl: uploadResult.secure_url,
                status: 'WaitingReview'
            }
        });

    } catch (error) {
        console.error('❌ Error uploading payment proof:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

/**
 * API: Kiểm tra trạng thái thanh toán
 * GET /api/payment-proof/status/:appointmentId
 */
router.get('/status/:appointmentId', authenticateToken, async (req, res) => {
    try {
        const { appointmentId } = req.params;
        const userId = req.user.userId;

        const [proofs] = await pool.query(`
            SELECT pp.*, a.UserID 
            FROM PaymentProofs pp
            JOIN Appointments a ON pp.AppointmentID = a.AppointmentID
            WHERE pp.AppointmentID = ?
            ORDER BY pp.CreatedAt DESC
            LIMIT 1
        `, [appointmentId]);

        if (proofs.length === 0) {
            return res.json({
                success: true,
                data: null,
                message: 'Chưa có yêu cầu thanh toán'
            });
        }

        const proof = proofs[0];

        // Kiểm tra quyền (user hoặc admin)
        if (proof.UserID !== userId && req.user.role !== 1) {
            return res.status(403).json({
                success: false,
                message: 'Không có quyền xem'
            });
        }

        // Tính thời gian còn lại
        const remainingTime = Math.max(0, Math.floor((new Date(proof.ExpiresAt) - new Date()) / 1000));

        res.json({
            success: true,
            data: {
                proofId: proof.ProofID,
                status: proof.Status,
                imageUrl: proof.ImageUrl,
                amount: proof.Amount,
                transferContent: proof.TransferContent,
                qrGeneratedAt: proof.QRGeneratedAt,
                proofUploadedAt: proof.ProofUploadedAt,
                expiresAt: proof.ExpiresAt,
                remainingSeconds: remainingTime,
                reviewNote: proof.ReviewNote
            }
        });

    } catch (error) {
        console.error('❌ Error getting payment status:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

// ============================================
// ADMIN APIs
// ============================================

/**
 * Middleware: Kiểm tra quyền admin
 */
const checkAdminAccess = (req, res, next) => {
    if (req.user.role !== 1) {
        return res.status(403).json({
            success: false,
            message: 'Yêu cầu quyền admin'
        });
    }
    next();
};

/**
 * API: Lấy danh sách chứng từ chờ duyệt
 * GET /api/payment-proof/admin/pending
 */
router.get('/admin/pending', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        const [proofs] = await pool.query(`
            SELECT 
                pp.*,
                a.AppointmentDate,
                a.Status as AppointmentStatus,
                u.FullName as CustomerName,
                u.PhoneNumber as CustomerPhone,
                u.Email as CustomerEmail,
                (SELECT GROUP_CONCAT(s.ServiceName SEPARATOR ', ')
                 FROM AppointmentServices aps
                 JOIN Services s ON aps.ServiceID = s.ServiceID
                 WHERE aps.AppointmentID = a.AppointmentID) as Services
            FROM PaymentProofs pp
            JOIN Appointments a ON pp.AppointmentID = a.AppointmentID
            JOIN Users u ON a.UserID = u.UserID
            WHERE pp.Status = 'WaitingReview'
            ORDER BY pp.ProofUploadedAt ASC
        `);

        // Tính thời gian chờ duyệt
        const proofsWithWaitTime = proofs.map(proof => {
            const uploadedAt = new Date(proof.ProofUploadedAt);
            const waitMinutes = Math.floor((new Date() - uploadedAt) / 60000);
            return {
                ...proof,
                waitMinutes: waitMinutes,
                waitTimeText: waitMinutes < 60 
                    ? `${waitMinutes} phút trước` 
                    : `${Math.floor(waitMinutes/60)} giờ ${waitMinutes%60} phút trước`
            };
        });

        res.json({
            success: true,
            count: proofs.length,
            data: proofsWithWaitTime
        });

    } catch (error) {
        console.error('❌ Error getting pending proofs:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

/**
 * API: Lấy tất cả chứng từ (có filter)
 * GET /api/payment-proof/admin/all?status=WaitingReview&dateFrom=&dateTo=
 */
router.get('/admin/all', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        const { status, dateFrom, dateTo } = req.query;

        let query = `
            SELECT 
                pp.*,
                a.AppointmentDate,
                a.Status as AppointmentStatus,
                u.FullName as CustomerName,
                u.PhoneNumber as CustomerPhone,
                reviewer.FullName as ReviewerName
            FROM PaymentProofs pp
            JOIN Appointments a ON pp.AppointmentID = a.AppointmentID
            JOIN Users u ON a.UserID = u.UserID
            LEFT JOIN Users reviewer ON pp.ReviewedBy = reviewer.UserID
            WHERE 1=1
        `;
        
        const params = [];

        if (status) {
            query += ' AND pp.Status = ?';
            params.push(status);
        }

        if (dateFrom) {
            query += ' AND DATE(pp.CreatedAt) >= ?';
            params.push(dateFrom);
        }

        if (dateTo) {
            query += ' AND DATE(pp.CreatedAt) <= ?';
            params.push(dateTo);
        }

        query += ' ORDER BY pp.CreatedAt DESC LIMIT 100';

        const [proofs] = await pool.query(query, params);

        res.json({
            success: true,
            count: proofs.length,
            data: proofs
        });

    } catch (error) {
        console.error('❌ Error getting all proofs:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

/**
 * API: Duyệt chứng từ thanh toán
 * POST /api/payment-proof/admin/approve/:proofId
 */
router.post('/admin/approve/:proofId', authenticateToken, checkAdminAccess, async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        const { proofId } = req.params;
        const adminId = req.user.userId;

        await connection.beginTransaction();

        // Lấy thông tin proof
        const [proofs] = await connection.query(
            'SELECT * FROM PaymentProofs WHERE ProofID = ?',
            [proofId]
        );

        if (proofs.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy chứng từ'
            });
        }

        const proof = proofs[0];

        if (proof.Status !== 'WaitingReview') {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: `Không thể duyệt. Trạng thái hiện tại: ${proof.Status}`
            });
        }

        // 1. Cập nhật PaymentProof status
        await connection.query(`
            UPDATE PaymentProofs 
            SET Status = 'Approved', 
                ReviewedBy = ?,
                ReviewedAt = NOW()
            WHERE ProofID = ?
        `, [adminId, proofId]);

        // 2. Tạo record Payment
        const [paymentResult] = await connection.query(`
            INSERT INTO Payments 
            (AppointmentID, UserID, Amount, PaymentMethod, Status, PaymentDate)
            SELECT 
                pp.AppointmentID,
                a.UserID,
                pp.Amount,
                'Bank Transfer',
                'Completed',
                NOW()
            FROM PaymentProofs pp
            JOIN Appointments a ON pp.AppointmentID = a.AppointmentID
            WHERE pp.ProofID = ?
        `, [proofId]);

        // 3. Cập nhật PaymentID trong PaymentProof
        await connection.query(
            'UPDATE PaymentProofs SET PaymentID = ? WHERE ProofID = ?',
            [paymentResult.insertId, proofId]
        );

        // 4. Cập nhật Appointment status thành 'Pending' (HIỆN RA)
        await connection.query(`
            UPDATE Appointments 
            SET Status = 'Pending',
                PaymentMethod = 'Chuyển khoản ngân hàng'
            WHERE AppointmentID = ?
        `, [proof.AppointmentID]);

        await connection.commit();

        console.log(`✅ Payment proof approved: ${proofId} by admin ${adminId}`);

        // TODO: Emit socket event để notify customer
        // socketService.emitPaymentApproved(proof.AppointmentID);

        res.json({
            success: true,
            message: 'Đã duyệt thanh toán thành công',
            data: {
                proofId: proofId,
                paymentId: paymentResult.insertId
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error('❌ Error approving payment:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    } finally {
        connection.release();
    }
});

/**
 * API: Từ chối chứng từ thanh toán
 * POST /api/payment-proof/admin/reject/:proofId
 * Body: { reason: "Lý do từ chối" }
 */
router.post('/admin/reject/:proofId', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        const { proofId } = req.params;
        const { reason } = req.body;
        const adminId = req.user.userId;

        if (!reason) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng nhập lý do từ chối'
            });
        }

        // Lấy thông tin proof
        const [proofs] = await pool.query(
            'SELECT * FROM PaymentProofs WHERE ProofID = ?',
            [proofId]
        );

        if (proofs.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy chứng từ'
            });
        }

        const proof = proofs[0];

        if (proof.Status !== 'WaitingReview') {
            return res.status(400).json({
                success: false,
                message: `Không thể từ chối. Trạng thái hiện tại: ${proof.Status}`
            });
        }

        // Cập nhật status
        await pool.query(`
            UPDATE PaymentProofs 
            SET Status = 'Rejected', 
                ReviewedBy = ?,
                ReviewedAt = NOW(),
                ReviewNote = ?
            WHERE ProofID = ?
        `, [adminId, reason, proofId]);

        console.log(`❌ Payment proof rejected: ${proofId} by admin ${adminId}`);

        // TODO: Emit socket event để notify customer
        // socketService.emitPaymentRejected(proof.AppointmentID, reason);

        res.json({
            success: true,
            message: 'Đã từ chối thanh toán',
            data: {
                proofId: proofId,
                reason: reason
            }
        });

    } catch (error) {
        console.error('❌ Error rejecting payment:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

/**
 * API: Thống kê chứng từ thanh toán
 * GET /api/payment-proof/admin/stats
 */
router.get('/admin/stats', authenticateToken, checkAdminAccess, async (req, res) => {
    try {
        const [stats] = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN Status = 'Pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN Status = 'WaitingReview' THEN 1 ELSE 0 END) as waitingReview,
                SUM(CASE WHEN Status = 'Approved' THEN 1 ELSE 0 END) as approved,
                SUM(CASE WHEN Status = 'Rejected' THEN 1 ELSE 0 END) as rejected,
                SUM(CASE WHEN Status = 'Expired' THEN 1 ELSE 0 END) as expired
            FROM PaymentProofs
            WHERE DATE(CreatedAt) = CURDATE()
        `);

        res.json({
            success: true,
            data: stats[0]
        });

    } catch (error) {
        console.error('❌ Error getting stats:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

// ============================================
// CRON JOB: Tự động hủy các đơn quá hạn
// (Gọi định kỳ mỗi phút)
// ============================================

/**
 * API: Xử lý các đơn hết hạn (gọi từ cron hoặc scheduler)
 * POST /api/payment-proof/process-expired
 * Header: x-cron-secret (optional security)
 */
router.post('/process-expired', async (req, res) => {
    try {
        // Optional: Check cron secret nếu cần bảo mật
        const cronSecret = process.env.CRON_SECRET;
        if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
            console.warn('⚠️ Unauthorized process-expired attempt');
            // Vẫn cho phép chạy nhưng log warning (cho dev dễ test)
        }
        
        // Tìm và cập nhật các đơn đã hết hạn
        const [result] = await pool.query(`
            UPDATE PaymentProofs 
            SET Status = 'Expired'
            WHERE Status = 'Pending' 
            AND ExpiresAt < NOW()
        `);

        console.log(`⏰ Processed ${result.affectedRows} expired payment proofs`);

        // Cập nhật Appointment status nếu cần
        if (result.affectedRows > 0) {
            await pool.query(`
                UPDATE Appointments a
                JOIN PaymentProofs pp ON a.AppointmentID = pp.AppointmentID
                SET a.Status = 'Đã hủy', 
                    a.Notes = CONCAT(IFNULL(a.Notes, ''), ' [Hủy do không thanh toán trong 15 phút]')
                WHERE pp.Status = 'Expired'
                AND a.Status = 'Chờ thanh toán'
            `);
        }

        res.json({
            success: true,
            expiredCount: result.affectedRows
        });

    } catch (error) {
        console.error('❌ Error processing expired proofs:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================
// THÊM CÁC ENDPOINT MỚI
// ============================================

/**
 * API: Lấy thông tin payment proof theo AppointmentID
 * GET /api/payment-proof/appointment/:appointmentId
 * Dùng cho trang payment.html
 */
router.get('/appointment/:appointmentId', authenticateToken, async (req, res) => {
    try {
        const { appointmentId } = req.params;
        const userId = req.user.userId;
        const isAdmin = req.user.role === 1;

        // Query proof
        let query = `
            SELECT pp.*, a.Status as AppointmentStatus, a.PaymentMethod
            FROM PaymentProofs pp
            JOIN Appointments a ON pp.AppointmentID = a.AppointmentID
            WHERE pp.AppointmentID = ?
        `;
        
        // Nếu không phải admin, chỉ cho xem proof của mình
        if (!isAdmin) {
            query += ' AND a.UserID = ?';
        }
        
        query += ' ORDER BY pp.CreatedAt DESC LIMIT 1';

        const params = isAdmin ? [appointmentId] : [appointmentId, userId];
        const [proofs] = await pool.query(query, params);

        if (proofs.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy thông tin thanh toán'
            });
        }

        res.json({
            success: true,
            data: proofs[0]
        });

    } catch (error) {
        console.error('❌ Error getting proof by appointment:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * API: Đánh dấu proof hết hạn (gọi từ client khi countdown = 0)
 * POST /api/payment-proof/expire/:proofId
 */
router.post('/expire/:proofId', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        const { proofId } = req.params;
        const userId = req.user.userId;

        await connection.beginTransaction();

        // Kiểm tra proof thuộc về user này và đang Pending
        const [proofs] = await connection.query(`
            SELECT pp.*, a.UserID 
            FROM PaymentProofs pp
            JOIN Appointments a ON pp.AppointmentID = a.AppointmentID
            WHERE pp.ProofID = ? AND a.UserID = ? AND pp.Status = 'Pending'
        `, [proofId, userId]);

        if (proofs.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy hoặc không có quyền'
            });
        }

        const proof = proofs[0];

        // Cập nhật proof status
        await connection.query(
            'UPDATE PaymentProofs SET Status = "Expired" WHERE ProofID = ?',
            [proofId]
        );

        // Cập nhật appointment status thành Đã hủy
        await connection.query(`
            UPDATE Appointments 
            SET Status = 'Đã hủy', 
                Notes = CONCAT(IFNULL(Notes, ''), ' [Hủy tự động: không thanh toán trong 15 phút]')
            WHERE AppointmentID = ?
        `, [proof.AppointmentID]);

        await connection.commit();

        console.log(`⏰ Payment proof expired by user: ${proofId}`);

        res.json({
            success: true,
            message: 'Đã hủy đơn hàng do hết thời gian thanh toán'
        });

    } catch (error) {
        await connection.rollback();
        console.error('❌ Error expiring proof:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    } finally {
        connection.release();
    }
});

/**
 * API: Kiểm tra và tự động hủy các đơn hết hạn
 * POST /api/payment-proof/auto-expire
 * Có thể gọi từ cron job hoặc scheduler
 */
router.post('/auto-expire', async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();

        // Tìm và cập nhật các proof hết hạn
        const [result] = await connection.query(`
            UPDATE PaymentProofs 
            SET Status = 'Expired'
            WHERE Status = 'Pending' 
            AND ExpiresAt < NOW()
        `);

        // Cập nhật Appointment status
        if (result.affectedRows > 0) {
            await connection.query(`
                UPDATE Appointments a
                JOIN PaymentProofs pp ON a.AppointmentID = pp.AppointmentID
                SET a.Status = 'Đã hủy', 
                    a.Notes = CONCAT(IFNULL(a.Notes, ''), ' [Hủy tự động: không thanh toán trong 15 phút]')
                WHERE pp.Status = 'Expired'
                AND a.Status = 'Chờ thanh toán'
            `);
        }

        await connection.commit();

        console.log(`⏰ Auto-expired ${result.affectedRows} payment proofs`);

        res.json({
            success: true,
            expiredCount: result.affectedRows
        });

    } catch (error) {
        await connection.rollback();
        console.error('❌ Error auto-expiring proofs:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    } finally {
        connection.release();
    }
});

module.exports = router;