// routes/serviceRoutes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('./authRoutes');

// Middleware kiểm tra admin
const checkAdminAccess = (req, res, next) => {
  if (req.user && req.user.role === 1) {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Không có quyền truy cập. Yêu cầu quyền admin.'
  });
};

/**
 * GET /api/services - Lấy tất cả dịch vụ
 */
router.get('/', async (req, res) => {
  try {
    const [services] = await pool.query('SELECT * FROM Services ORDER BY ServiceID DESC');
    
    res.json({
      success: true,
      services: services
    });
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/services/:id - Lấy dịch vụ theo ID
 */
router.get('/:id', async (req, res) => {
  try {
    const [services] = await pool.query('SELECT * FROM Services WHERE ServiceID = ?', [req.params.id]);
    
    if (services.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy dịch vụ'
      });
    }
    
    res.json({
      success: true,
      service: services[0]
    });
  } catch (error) {
    console.error('Error fetching service:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/services - Tạo dịch vụ mới (Admin only)
 */
router.post('/', authenticateToken, checkAdminAccess, async (req, res) => {
  try {
    const { ServiceName, Description, Price, EstimatedTime, ServiceImage } = req.body;
    
    // Validate
    if (!ServiceName || !Price) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu thông tin bắt buộc'
      });
    }
    
    // Insert
    const [result] = await pool.query(
      'INSERT INTO Services (ServiceName, Description, Price, EstimatedTime, ServiceImage) VALUES (?, ?, ?, ?, ?)',
      [ServiceName, Description || null, Price, EstimatedTime || 0, ServiceImage || null]
    );
    
    res.json({
      success: true,
      message: 'Tạo dịch vụ thành công',
      serviceId: result.insertId
    });
  } catch (error) {
    console.error('Error creating service:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * PUT /api/services/:id - Cập nhật dịch vụ (Admin only)
 */
router.put('/:id', authenticateToken, checkAdminAccess, async (req, res) => {
  try {
    const serviceId = req.params.id;
    const { ServiceName, Description, Price, EstimatedTime, ServiceImage } = req.body;
    
    // Kiểm tra dịch vụ tồn tại
    const [existing] = await pool.query('SELECT * FROM Services WHERE ServiceID = ?', [serviceId]);
    
    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy dịch vụ'
      });
    }
    
    // Validate
    if (!ServiceName || !Price) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu thông tin bắt buộc'
      });
    }
    
    // Update
    await pool.query(
      'UPDATE Services SET ServiceName = ?, Description = ?, Price = ?, EstimatedTime = ?, ServiceImage = ? WHERE ServiceID = ?',
      [ServiceName, Description || null, Price, EstimatedTime || 0, ServiceImage || existing[0].ServiceImage, serviceId]
    );
    
    res.json({
      success: true,
      message: 'Cập nhật dịch vụ thành công'
    });
  } catch (error) {
    console.error('Error updating service:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * DELETE /api/services/:id - Xóa dịch vụ (Admin only)
 */
router.delete('/:id', authenticateToken, checkAdminAccess, async (req, res) => {
  try {
    const serviceId = req.params.id;
    
    // Kiểm tra dịch vụ tồn tại
    const [existing] = await pool.query('SELECT * FROM Services WHERE ServiceID = ?', [serviceId]);
    
    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy dịch vụ'
      });
    }
    
    // Delete
    await pool.query('DELETE FROM Services WHERE ServiceID = ?', [serviceId]);
    
    res.json({
      success: true,
      message: 'Xóa dịch vụ thành công'
    });
  } catch (error) {
    console.error('Error deleting service:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;


// File cũ
// const express = require('express');
// const router = express.Router();
// const { pool } = require('../db');
// const { authenticateToken } = require('./authRoutes');

// // API: Lấy tất cả dịch vụ

// /*
// router.get('/', async (req, res) => {
//     try {
//         const services = await Service.getAllServices();
//         res.json(services);
//     } catch (err) {
//         res.status(500).send(err.message);
//     }
// });

// */

// router.get('/', async (req, res) => {
//     try {
//         const services = await Service.getAllServices();
        
//         // Thêm đường dẫn đúng cho hình ảnh
//         services.forEach(service => {
//             if (service.ServiceImage && !service.ServiceImage.startsWith('http')) {
//                 service.ServiceImage = `https://storage.googleapis.com/suaxe-api-web/images/services/${service.ServiceImage}`;
//             }
//         });
        
//         res.json({
//             success: true,
//             services: services
//         });
//     } catch (err) {
//         res.status(500).json({
//             success: false, 
//             message: err.message
//         });
//     }
// });

// // API: Lấy dịch vụ theo ID
// router.get('/:id', async (req, res) => {
//     try {
//         const service = await Service.getServiceById(req.params.id);
//         if (!service) return res.status(404).json({ message: 'Không tìm thấy dịch vụ' });
//         res.json(service);
//     } catch (err) {
//         res.status(500).send(err.message);
//     }
// });

// module.exports = router;