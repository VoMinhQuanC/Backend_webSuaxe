// routes/vehicleRoutes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('./authRoutes');

/**
 * GET /api/vehicles/user/:userId - Lấy tất cả xe của user
 */
router.get('/user/:userId', authenticateToken, async (req, res) => {
    try {
        const userId = req.params.userId;
        
        // Kiểm tra quyền: chỉ user đó hoặc admin mới xem được
        if (req.user.userId != userId && req.user.role !== 1) {
            return res.status(403).json({
                success: false,
                message: 'Không có quyền truy cập'
            });
        }
        
        const [vehicles] = await pool.query(
            'SELECT * FROM Vehicles WHERE UserID = ? ORDER BY CreatedAt DESC',
            [userId]
        );
        
        res.json({
            success: true,
            data: vehicles,
            vehicles: vehicles // Hỗ trợ cả 2 format
        });
    } catch (error) {
        console.error('Error fetching user vehicles:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * GET /api/vehicles/:id - Lấy thông tin xe theo ID
 */
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const vehicleId = req.params.id;
        
        const [vehicles] = await pool.query(
            'SELECT * FROM Vehicles WHERE VehicleID = ?',
            [vehicleId]
        );
        
        if (vehicles.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy xe'
            });
        }
        
        const vehicle = vehicles[0];
        
        // Kiểm tra quyền: chỉ user đó hoặc admin mới xem được
        if (req.user.userId != vehicle.UserID && req.user.role !== 1) {
            return res.status(403).json({
                success: false,
                message: 'Không có quyền truy cập'
            });
        }
        
        res.json({
            success: true,
            data: vehicle,
            vehicle: vehicle // Hỗ trợ cả 2 format
        });
    } catch (error) {
        console.error('Error fetching vehicle:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * POST /api/vehicles - Tạo xe mới
 */
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { userId, licensePlate, brand, model, year } = req.body;
        
        // Validate
        if (!userId || !licensePlate) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu thông tin bắt buộc (userId, licensePlate)'
            });
        }
        
        // Kiểm tra quyền: chỉ user đó hoặc admin mới tạo được
        if (req.user.userId != userId && req.user.role !== 1) {
            return res.status(403).json({
                success: false,
                message: 'Không có quyền tạo xe cho user khác'
            });
        }
        
        // Kiểm tra biển số đã tồn tại chưa (cho user này)
        const [existing] = await pool.query(
            'SELECT * FROM Vehicles WHERE UserID = ? AND LicensePlate = ?',
            [userId, licensePlate]
        );
        
        if (existing.length > 0) {
            // Nếu đã tồn tại, trả về thông tin xe hiện có
            return res.json({
                success: true,
                message: 'Xe đã tồn tại',
                data: existing[0],
                id: existing[0].VehicleID
            });
        }
        
        // Tạo xe mới
        const [result] = await pool.query(
            'INSERT INTO Vehicles (UserID, LicensePlate, Brand, Model, Year, CreatedAt) VALUES (?, ?, ?, ?, ?, NOW())',
            [userId, licensePlate, brand || null, model || null, year || null]
        );
        
        // Lấy thông tin xe vừa tạo
        const [newVehicle] = await pool.query(
            'SELECT * FROM Vehicles WHERE VehicleID = ?',
            [result.insertId]
        );
        
        res.status(201).json({
            success: true,
            message: 'Tạo xe mới thành công',
            data: newVehicle[0],
            id: result.insertId
        });
    } catch (error) {
        console.error('Error creating vehicle:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * PUT /api/vehicles/:id - Cập nhật thông tin xe
 */
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const vehicleId = req.params.id;
        const { licensePlate, brand, model, year } = req.body;
        
        // Kiểm tra xe tồn tại
        const [existing] = await pool.query(
            'SELECT * FROM Vehicles WHERE VehicleID = ?',
            [vehicleId]
        );
        
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy xe'
            });
        }
        
        const vehicle = existing[0];
        
        // Kiểm tra quyền: chỉ user đó hoặc admin mới cập nhật được
        if (req.user.userId != vehicle.UserID && req.user.role !== 1) {
            return res.status(403).json({
                success: false,
                message: 'Không có quyền cập nhật xe này'
            });
        }
        
        // Cập nhật
        await pool.query(
            'UPDATE Vehicles SET LicensePlate = ?, Brand = ?, Model = ?, Year = ? WHERE VehicleID = ?',
            [
                licensePlate || vehicle.LicensePlate,
                brand || vehicle.Brand,
                model || vehicle.Model,
                year || vehicle.Year,
                vehicleId
            ]
        );
        
        // Lấy thông tin xe sau khi cập nhật
        const [updated] = await pool.query(
            'SELECT * FROM Vehicles WHERE VehicleID = ?',
            [vehicleId]
        );
        
        res.json({
            success: true,
            message: 'Cập nhật xe thành công',
            data: updated[0]
        });
    } catch (error) {
        console.error('Error updating vehicle:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * DELETE /api/vehicles/:id - Xóa xe
 */
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const vehicleId = req.params.id;
        
        // Kiểm tra xe tồn tại
        const [existing] = await pool.query(
            'SELECT * FROM Vehicles WHERE VehicleID = ?',
            [vehicleId]
        );
        
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy xe'
            });
        }
        
        const vehicle = existing[0];
        
        // Kiểm tra quyền: chỉ user đó hoặc admin mới xóa được
        if (req.user.userId != vehicle.UserID && req.user.role !== 1) {
            return res.status(403).json({
                success: false,
                message: 'Không có quyền xóa xe này'
            });
        }
        
        // Kiểm tra xe có đang được dùng trong appointment không
        const [appointments] = await pool.query(
            'SELECT COUNT(*) as count FROM Appointments WHERE VehicleID = ?',
            [vehicleId]
        );
        
        if (appointments[0].count > 0) {
            return res.status(400).json({
                success: false,
                message: 'Không thể xóa xe đang có lịch hẹn. Vui lòng xóa các lịch hẹn trước.'
            });
        }
        
        // Xóa xe
        await pool.query('DELETE FROM Vehicles WHERE VehicleID = ?', [vehicleId]);
        
        res.json({
            success: true,
            message: 'Xóa xe thành công'
        });
    } catch (error) {
        console.error('Error deleting vehicle:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;