// routes/adminPaymentProofRoutes.js - Admin duyệt ảnh chứng từ

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('./authRoutes');

// Middleware kiểm tra admin
const checkAdminRole = (req, res, next) => {
    if (req.user.roleId !== 1 && req.user.roleId !== 2) {
        return res.status(403).json({
            success: false,
            message: 'Chỉ admin mới có quyền truy cập'
        });
    }
    next();
};

// Middleware xác thực cho tất cả routes
router.use(authenticateToken);
router.use(checkAdminRole);


/**
 * API: Lấy danh sách payment proofs
 * GET /api/admin/payment-proofs?status=Pending&limit=20&offset=0
 */
router.get('/payment-proofs', async (req, res) => {
    try {
        const { status, limit = 50, offset = 0 } = req.query;
        
        let query = 'SELECT * FROM vw_PendingPaymentProofs WHERE 1=1';
        const params = [];
        
        // Filter by status
        if (status) {
            query += ' AND ProofStatus = ?';
            params.push(status);
        }
        
        // Order by created date (newest first)
        query += ' ORDER BY UploadedAt DESC';
        
        // Pagination
        query += ' LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [proofs] = await pool.query(query, params);
        
        // Count total
        let countQuery = 'SELECT COUNT(*) as total FROM vw_PendingPaymentProofs WHERE 1=1';
        const countParams = [];
        
        if (status) {
            countQuery += ' AND ProofStatus = ?';
            countParams.push(status);
        }
        
        const [countResult] = await pool.query(countQuery, countParams);
        const total = countResult[0].total;
        
        res.json({
            success: true,
            data: proofs,
            pagination: {
                total,
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: (parseInt(offset) + proofs.length) < total
            }
        });
        
    } catch (error) {
        console.error('Error getting payment proofs:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});


/**
 * API: Lấy chi tiết 1 payment proof
 * GET /api/admin/payment-proofs/:proofId
 */
router.get('/payment-proofs/:proofId', async (req, res) => {
    try {
        const { proofId } = req.params;
        
        const [proofs] = await pool.query(
            'SELECT * FROM vw_PendingPaymentProofs WHERE ProofID = ?',
            [proofId]
        );
        
        if (proofs.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy payment proof'
            });
        }
        
        res.json({
            success: true,
            data: proofs[0]
        });
        
    } catch (error) {
        console.error('Error getting payment proof:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});


/**
 * API: Approve payment proof
 * POST /api/admin/payment-proofs/:proofId/approve
 */
router.post('/payment-proofs/:proofId/approve', async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        const { proofId } = req.params;
        const adminId = req.user.id || req.user.userId;
        
        await connection.beginTransaction();
        
        // 1. Check payment proof exists and is pending
        const [proofs] = await connection.query(
            'SELECT * FROM PaymentProofs WHERE ProofID = ?',
            [proofId]
        );
        
        if (proofs.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy payment proof'
            });
        }
        
        const proof = proofs[0];
        
        if (proof.Status !== 'Pending') {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Payment proof đã được xử lý'
            });
        }
        
        // 2. Update PaymentProof status
        await connection.query(
            `UPDATE PaymentProofs 
             SET Status = 'Approved', 
                 ReviewedBy = ?, 
                 ReviewedAt = NOW()
             WHERE ProofID = ?`,
            [adminId, proofId]
        );
        
        // 3. Update Appointment status
        await connection.query(
            `UPDATE Appointments 
             SET Status = 'Confirmed'
             WHERE AppointmentID = ?`,
            [proof.AppointmentID]
        );
        
        // 4. Update Payment status
        await connection.query(
            `UPDATE Payments 
             SET Status = 'Paid', 
                 PaymentDate = NOW()
             WHERE AppointmentID = ?`,
            [proof.AppointmentID]
        );
        
        await connection.commit();
        
        console.log(`✅ Admin ${adminId} approved payment proof ${proofId} for appointment ${proof.AppointmentID}`);
        
        res.json({
            success: true,
            message: 'Đã duyệt thanh toán thành công',
            data: {
                proofId,
                appointmentId: proof.AppointmentID,
                status: 'Approved'
            }
        });
        
    } catch (error) {
        await connection.rollback();
        console.error('Error approving payment:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    } finally {
        connection.release();
    }
});


/**
 * API: Reject payment proof
 * POST /api/admin/payment-proofs/:proofId/reject
 * Body: { notes: "Lý do từ chối" }
 */
router.post('/payment-proofs/:proofId/reject', async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        const { proofId } = req.params;
        const { notes } = req.body;
        const adminId = req.user.id || req.user.userId;
        
        if (!notes || notes.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng nhập lý do từ chối'
            });
        }
        
        await connection.beginTransaction();
        
        // 1. Check payment proof exists and is pending
        const [proofs] = await connection.query(
            'SELECT * FROM PaymentProofs WHERE ProofID = ?',
            [proofId]
        );
        
        if (proofs.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy payment proof'
            });
        }
        
        const proof = proofs[0];
        
        if (proof.Status !== 'Pending') {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Payment proof đã được xử lý'
            });
        }
        
        // 2. Update PaymentProof status
        await connection.query(
            `UPDATE PaymentProofs 
             SET Status = 'Rejected', 
                 AdminNotes = ?,
                 ReviewedBy = ?, 
                 ReviewedAt = NOW()
             WHERE ProofID = ?`,
            [notes, adminId, proofId]
        );
        
        // 3. Update Appointment status
        await connection.query(
            `UPDATE Appointments 
             SET Status = 'Canceled'
             WHERE AppointmentID = ?`,
            [proof.AppointmentID]
        );
        
        // 4. Update Payment status
        await connection.query(
            `UPDATE Payments 
             SET Status = 'Cancelled'
             WHERE AppointmentID = ?`,
            [proof.AppointmentID]
        );
        
        await connection.commit();
        
        console.log(`❌ Admin ${adminId} rejected payment proof ${proofId} for appointment ${proof.AppointmentID}`);
        
        res.json({
            success: true,
            message: 'Đã từ chối thanh toán',
            data: {
                proofId,
                appointmentId: proof.AppointmentID,
                status: 'Rejected',
                notes
            }
        });
        
    } catch (error) {
        await connection.rollback();
        console.error('Error rejecting payment:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    } finally {
        connection.release();
    }
});


/**
 * API: Get statistics (dashboard)
 * GET /api/admin/payment-proofs/stats
 */
router.get('/stats', async (req, res) => {
    try {
        const [stats] = await pool.query(`
            SELECT 
                COUNT(CASE WHEN ProofStatus = 'Pending' THEN 1 END) as pending,
                COUNT(CASE WHEN ProofStatus = 'Approved' THEN 1 END) as approved,
                COUNT(CASE WHEN ProofStatus = 'Rejected' THEN 1 END) as rejected,
                COUNT(CASE WHEN ProofStatus = 'Expired' THEN 1 END) as expired,
                COUNT(*) as total,
                SUM(CASE WHEN ProofStatus = 'Pending' THEN Amount ELSE 0 END) as pendingAmount,
                SUM(CASE WHEN ProofStatus = 'Approved' THEN Amount ELSE 0 END) as approvedAmount
            FROM vw_PendingPaymentProofs
            WHERE DATE(UploadedAt) = CURDATE()
        `);
        
        res.json({
            success: true,
            data: {
                today: stats[0],
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});


/**
 * API: Bulk approve (approve nhiều cùng lúc)
 * POST /api/admin/payment-proofs/bulk-approve
 * Body: { proofIds: [1, 2, 3] }
 */
router.post('/bulk-approve', async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        const { proofIds } = req.body;
        const adminId = req.user.id || req.user.userId;
        
        if (!Array.isArray(proofIds) || proofIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng chọn ít nhất 1 payment proof'
            });
        }
        
        await connection.beginTransaction();
        
        const results = {
            success: [],
            failed: []
        };
        
        for (const proofId of proofIds) {
            try {
                // Get proof
                const [proofs] = await connection.query(
                    'SELECT * FROM PaymentProofs WHERE ProofID = ? AND Status = "Pending"',
                    [proofId]
                );
                
                if (proofs.length === 0) {
                    results.failed.push({ proofId, reason: 'Không tìm thấy hoặc đã xử lý' });
                    continue;
                }
                
                const proof = proofs[0];
                
                // Update PaymentProof
                await connection.query(
                    'UPDATE PaymentProofs SET Status = "Approved", ReviewedBy = ?, ReviewedAt = NOW() WHERE ProofID = ?',
                    [adminId, proofId]
                );
                
                // Update Appointment
                await connection.query(
                    'UPDATE Appointments SET Status = "Confirmed" WHERE AppointmentID = ?',
                    [proof.AppointmentID]
                );
                
                // Update Payment
                await connection.query(
                    'UPDATE Payments SET Status = "Paid", PaymentDate = NOW() WHERE AppointmentID = ?',
                    [proof.AppointmentID]
                );
                
                results.success.push({ proofId, appointmentId: proof.AppointmentID });
                
            } catch (error) {
                results.failed.push({ proofId, reason: error.message });
            }
        }
        
        await connection.commit();
        
        res.json({
            success: true,
            message: `Đã duyệt ${results.success.length}/${proofIds.length} payment proofs`,
            data: results
        });
        
    } catch (error) {
        await connection.rollback();
        console.error('Error bulk approving:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    } finally {
        connection.release();
    }
});

module.exports = router;