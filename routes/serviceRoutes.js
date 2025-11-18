const express = require('express');
const router = express.Router();
const Service = require('../models/Service');

// API: Lấy tất cả dịch vụ

/*
router.get('/', async (req, res) => {
    try {
        const services = await Service.getAllServices();
        res.json(services);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

*/

router.get('/', async (req, res) => {
    try {
        const services = await Service.getAllServices();
        
        // Thêm đường dẫn đúng cho hình ảnh
        services.forEach(service => {
            if (service.ServiceImage && !service.ServiceImage.startsWith('http')) {
                service.ServiceImage = `https://storage.googleapis.com/suaxe-api-web/images/services/${service.ServiceImage}`;
            }
        });
        
        res.json({
            success: true,
            services: services
        });
    } catch (err) {
        res.status(500).json({
            success: false, 
            message: err.message
        });
    }
});

// API: Lấy dịch vụ theo ID
router.get('/:id', async (req, res) => {
    try {
        const service = await Service.getServiceById(req.params.id);
        if (!service) return res.status(404).json({ message: 'Không tìm thấy dịch vụ' });
        res.json(service);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

module.exports = router;