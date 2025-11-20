// routes/uploadRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('../config/cloudinary');
const { authenticateToken } = require('./authRoutes');
const { pool } = require('../db');

// Multer - lưu vào memory
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

/**
 * Helper: Upload to Cloudinary
 */
async function uploadToCloudinary(buffer, folder, filename) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `suaxe/${folder}`,
        public_id: filename,
        resource_type: 'image',
        transformation: [
          { width: 800, height: 800, crop: 'limit' },
          { quality: 'auto' },
          { fetch_format: 'auto' }
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

/**
 * API: Upload avatar
 * POST /api/upload/avatar
 */
router.post('/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Không tìm thấy file' });
    }

    const userId = req.user.userId;
    const filename = `avatar_${userId}_${Date.now()}`;

    // Upload lên Cloudinary
    const result = await uploadToCloudinary(req.file.buffer, 'avatars', filename);

    // Lưu vào database
    await pool.query(
      'UPDATE Users SET AvatarUrl = ?, ProfilePicture = ? WHERE UserID = ?',
      [result.secure_url, result.secure_url, userId]
    );

    res.json({
      success: true,
      message: 'Upload avatar thành công',
      avatarUrl: result.secure_url
    });
  } catch (error) {
    console.error('Upload avatar error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * API: Upload service image (Admin only)
 * POST /api/upload/service/:serviceId
 */
router.post('/service/:serviceId', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Không tìm thấy file' });
    }

    // Check admin
    if (req.user.role !== 1) {
      return res.status(403).json({ success: false, message: 'Chỉ admin được upload' });
    }

    const serviceId = req.params.serviceId;
    const filename = `service_${serviceId}_${Date.now()}`;

    // Upload lên Cloudinary
    const result = await uploadToCloudinary(req.file.buffer, 'services', filename);

    // Lưu vào database
    await pool.query(
      'UPDATE Services SET ServiceImage = ? WHERE ServiceID = ?',
      [result.secure_url, serviceId]
    );

    res.json({
      success: true,
      message: 'Upload service image thành công',
      imageUrl: result.secure_url
    });
  } catch (error) {
    console.error('Upload service error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * API: Upload vehicle image
 * POST /api/upload/vehicle/:vehicleId
 */
router.post('/vehicle/:vehicleId', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Không tìm thấy file' });
    }

    const vehicleId = req.params.vehicleId;
    const userId = req.user.userId;

    // Kiểm tra quyền
    const [vehicles] = await pool.query(
      'SELECT UserID FROM Vehicles WHERE VehicleID = ?',
      [vehicleId]
    );

    if (vehicles.length === 0 || vehicles[0].UserID !== userId) {
      return res.status(403).json({ success: false, message: 'Không có quyền' });
    }

    const filename = `vehicle_${vehicleId}_${Date.now()}`;

    // Upload lên Cloudinary
    const result = await uploadToCloudinary(req.file.buffer, 'vehicles', filename);

    // Lưu vào database
    await pool.query(
      'UPDATE Vehicles SET VehicleImage = ? WHERE VehicleID = ?',
      [result.secure_url, vehicleId]
    );

    res.json({
      success: true,
      message: 'Upload vehicle image thành công',
      imageUrl: result.secure_url
    });
  } catch (error) {
    console.error('Upload vehicle error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;