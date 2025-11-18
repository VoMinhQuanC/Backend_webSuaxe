// imageRoutes.js - API xử lý hình ảnh cho web sửa xe
const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db');
const { authenticateToken } = require('./authRoutes');

// Đảm bảo các thư mục tồn tại - sử dụng /tmp cho Google Cloud App Engine
let webImagesDir, avatarsDir, servicesDir, vehiclesDir, tempDir;

if (process.env.NODE_ENV === 'production') {
    // Trong môi trường production (Google Cloud App Engine), sử dụng /tmp
    webImagesDir = '/tmp/images';
    avatarsDir = '/tmp/avatars';
    servicesDir = '/tmp/services';
    vehiclesDir = '/tmp/vehicles';
    tempDir = '/tmp/temp';
} else {
    // Trong môi trường development, sử dụng đường dẫn gốc
    webImagesDir = path.join(__dirname, '../../Web/images');
    avatarsDir = path.join(webImagesDir, 'avatars');
    servicesDir = path.join(webImagesDir, 'services');
    vehiclesDir = path.join(webImagesDir, 'vehicles');
    tempDir = path.join(webImagesDir, 'temp');
}

// Tạo thư mục nếu chưa tồn tại
[webImagesDir, avatarsDir, servicesDir, vehiclesDir, tempDir].forEach(dir => {
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`Đã tạo thư mục: ${dir}`);
        }
    } catch (error) {
        console.error(`Không thể tạo thư mục ${dir}:`, error.message);
        // Sử dụng thư mục dự phòng
        if (dir !== tempDir) {
            tempDir = process.env.NODE_ENV === 'production' ? '/tmp' : path.join(__dirname, '../');
        }
    }
});

/**
 * Xóa tất cả hình ảnh cũ của dịch vụ trước khi thêm hình mới
 * @param {number} serviceId ID của dịch vụ
 * @param {string} serviceSlug Slug của tên dịch vụ để tìm các file liên quan
 */
async function removeOldServiceImages(serviceId, serviceSlug) {
    try {
        // Lấy thông tin dịch vụ
        const [services] = await pool.query('SELECT ServiceImage FROM Services WHERE ServiceID = ?', [serviceId]);
        
        // Xóa hình ảnh cũ đã lưu trong database nếu có
        if (services.length > 0 && services[0].ServiceImage) {
            const oldImagePath = path.join(__dirname, '../../Web', services[0].ServiceImage);
            if (fs.existsSync(oldImagePath)) {
                fs.unlinkSync(oldImagePath);
                console.log(`Đã xóa hình ảnh cũ từ database: ${oldImagePath}`);
            }
        }
        
        // Xóa tất cả các file có chứa ID dịch vụ trong tên
        if (fs.existsSync(servicesDir)) {
            const files = fs.readdirSync(servicesDir);
            const servicePrefix = `service-${serviceSlug}`;
            
            for (const file of files) {
                // Tìm các file có tên bắt đầu bằng service- và chứa ID dịch vụ
                if (file.includes(`-${serviceId}-`) && file.startsWith(servicePrefix)) {
                    const filePath = path.join(servicesDir, file);
                    fs.unlinkSync(filePath);
                    console.log(`Đã xóa file trùng lặp: ${filePath}`);
                }
            }
        }
    } catch (error) {
        console.error('Lỗi khi xóa hình ảnh cũ:', error);
        // Chỉ log lỗi, không throw để quá trình upload vẫn tiếp tục
    }
}

/**
 * Xóa tất cả hình ảnh cũ của xe trước khi thêm hình mới
 * @param {number} vehicleId ID của xe
 */
async function removeOldVehicleImages(vehicleId) {
    try {
        // Lấy thông tin xe
        const [vehicles] = await pool.query('SELECT VehicleImage FROM Vehicles WHERE VehicleID = ?', [vehicleId]);
        
        // Xóa hình ảnh cũ nếu có
        if (vehicles.length > 0 && vehicles[0].VehicleImage) {
            const oldImagePath = path.join(__dirname, '../../Web', vehicles[0].VehicleImage);
            if (fs.existsSync(oldImagePath)) {
                fs.unlinkSync(oldImagePath);
                console.log(`Đã xóa hình ảnh xe cũ: ${oldImagePath}`);
            }
        }
        
        // Xóa tất cả các file có chứa ID xe trong tên
        if (fs.existsSync(vehiclesDir)) {
            const files = fs.readdirSync(vehiclesDir);
            
            for (const file of files) {
                if (file.includes(`-${vehicleId}-`)) {
                    const filePath = path.join(vehiclesDir, file);
                    fs.unlinkSync(filePath);
                    console.log(`Đã xóa file xe trùng lặp: ${filePath}`);
                }
            }
        }
    } catch (error) {
        console.error('Lỗi khi xóa hình ảnh xe cũ:', error);
    }
}

/**
 * Xóa các avatar cũ của người dùng
 * @param {number} userId ID của người dùng
 */
async function removeOldAvatarImages(userId) {
    try {
        console.log(`Bắt đầu xóa avatar cũ cho người dùng ${userId}`);
        
        // Kiểm tra thông tin hiện tại của người dùng
        const [users] = await pool.query('SELECT UserID, ProfilePicture, AvatarUrl FROM Users WHERE UserID = ?', [userId]);
        
        if (users.length === 0) {
            console.log(`Không tìm thấy người dùng với ID ${userId}`);
            return;
        }
        
        console.log('Thông tin người dùng từ CSDL:', users[0]);
        
        // Xóa avatar cũ nếu có
        if (users.length > 0) {
            // Kiểm tra ProfilePicture
            if (users[0].ProfilePicture) {
                const oldProfilePicPath = path.join(__dirname, '../../Web', users[0].ProfilePicture);
                console.log('Kiểm tra đường dẫn ProfilePicture:', oldProfilePicPath);
                
                try {
                    if (fs.existsSync(oldProfilePicPath)) {
                        fs.unlinkSync(oldProfilePicPath);
                        console.log(`Đã xóa ProfilePicture cũ: ${oldProfilePicPath}`);
                    } else {
                        console.log(`ProfilePicture cũ không tồn tại: ${oldProfilePicPath}`);
                    }
                } catch (error) {
                    console.error(`Lỗi khi xóa ProfilePicture: ${error.message}`);
                }
            } else {
                console.log('Không có ProfilePicture để xóa');
            }
            
            // Kiểm tra AvatarUrl nếu khác với ProfilePicture
            if (users[0].AvatarUrl && users[0].AvatarUrl !== users[0].ProfilePicture) {
                const oldAvatarPath = path.join(__dirname, '../../Web', users[0].AvatarUrl);
                console.log('Kiểm tra đường dẫn AvatarUrl:', oldAvatarPath);
                
                try {
                    if (fs.existsSync(oldAvatarPath)) {
                        fs.unlinkSync(oldAvatarPath);
                        console.log(`Đã xóa AvatarUrl cũ: ${oldAvatarPath}`);
                    } else {
                        console.log(`AvatarUrl cũ không tồn tại: ${oldAvatarPath}`);
                    }
                } catch (error) {
                    console.error(`Lỗi khi xóa AvatarUrl: ${error.message}`);
                }
            } else {
                console.log('Không có AvatarUrl khác với ProfilePicture để xóa');
            }
        }
        
        console.log(`Hoàn tất xóa avatar cũ cho người dùng ${userId}`);
    } catch (error) {
        console.error('Lỗi khi xóa avatar cũ:', error);
        // Không throw lỗi để tiếp tục quá trình upload
    }
}

/**
 * Chuyển tên thành slug (bỏ dấu, thay khoảng trắng bằng gạch ngang)
 * @param {string} text Chuỗi cần chuyển đổi
 * @returns {string} Chuỗi đã được chuyển đổi thành slug
 */
function convertToSlug(text) {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Bỏ dấu
        .replace(/\s+/g, '-') // Thay khoảng trắng bằng gạch ngang
        .replace(/[^\w\-]+/g, '') // Bỏ ký tự đặc biệt
        .replace(/\-\-+/g, '-') // Bỏ nhiều gạch ngang liên tiếp
        .replace(/^-+|-+$/g, ''); // Bỏ gạch ngang ở đầu và cuối
}

// Cấu hình multer cho việc upload file
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            // Đường dẫn thư mục lưu file
            let targetDir;
            
            // Xác định thư mục đích dựa vào loại upload
            if (req.originalUrl.includes('/upload-avatar')) {
                targetDir = avatarsDir;
            } else if (req.originalUrl.includes('/upload/service')) {
                targetDir = servicesDir;
            } else if (req.originalUrl.includes('/upload/vehicle')) {
                targetDir = vehiclesDir;
            } else {
                targetDir = tempDir;
            }
            
            // Đảm bảo thư mục tồn tại
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
                console.log(`Đã tạo thư mục: ${targetDir}`);
            }
            
            cb(null, targetDir);
        },
        filename: (req, file, cb) => {
            // Tạo tên file ngẫu nhiên theo loại upload
            if (req.originalUrl.includes('/upload-avatar')) {
                // Tạo tên file avatar với timestamp để tránh trùng lặp
                const userId = req.user ? req.user.userId : 'unknown';
                const timestamp = Date.now();
                const randomStr = Math.random().toString(36).substring(2, 10);
                const ext = path.extname(file.originalname) || '.jpg';
                cb(null, `avatar-${userId}-${timestamp}-${randomStr}${ext}`);
            } else if (req.originalUrl.includes('/upload/service') && req.serviceInfo) {
                // Tạo tên file dịch vụ với ID và slug
                const timestamp = Date.now();
                const ext = path.extname(file.originalname) || '.jpg';
                cb(null, `service-${req.serviceInfo.slug}-${req.serviceInfo.id}-${timestamp}${ext}`);
            } else if (req.originalUrl.includes('/upload/vehicle')) {
                // Tạo tên file xe với ID
                const vehicleId = req.params.id || 'unknown';
                const timestamp = Date.now();
                const ext = path.extname(file.originalname) || '.jpg';
                cb(null, `vehicle-${vehicleId}-${timestamp}${ext}`);
            } else {
                // File tạm - sử dụng tên ngẫu nhiên
                const timestamp = Date.now();
                const randomStr = Math.random().toString(36).substring(2, 10);
                const ext = path.extname(file.originalname) || '.jpg';
                cb(null, `temp-${timestamp}-${randomStr}${ext}`);
            }
        }
    }),
    fileFilter: (req, file, cb) => {
        // Kiểm tra loại file
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Chỉ chấp nhận file hình ảnh'), false);
        }
        cb(null, true);
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // Giới hạn 5MB
    }
});

// API endpoint để upload avatar
router.post('/upload-avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
    try {
        console.log('API upload-avatar được gọi');
        
        if (!req.file) {
            console.log('Không tìm thấy file upload');
            return res.status(400).json({
                success: false,
                message: 'Không tìm thấy file upload'
            });
        }

        console.log('File upload:', req.file);
        
        const userId = req.user.userId;
        const filename = req.file.filename;
        
        // Đảm bảo đường dẫn tương đối đúng cho cả production và development
        let imagePath;
        if (process.env.NODE_ENV === 'production') {
            // Trong production, sử dụng đường dẫn tương đối từ /tmp
            imagePath = req.file.path.replace(/\\/g, '/').split('/tmp/')[1] || `avatars/${filename}`;
        } else {
            // Trong development, sử dụng đường dẫn từ /Web
            const relativePath = req.file.path.replace(/\\/g, '/').split('/Web/')[1];
            imagePath = relativePath || `images/avatars/${filename}`;
        }
        
        console.log('Đường dẫn tương đối:', imagePath);
        console.log('Đường dẫn tuyệt đối:', req.file.path);

        try {
            // Xóa avatar cũ nếu có
            await removeOldAvatarImages(userId);
            console.log('Đã xử lý xóa avatar cũ');
        } catch (error) {
            // Chỉ log lỗi, không dừng tiến trình
            console.error('Lỗi khi xóa avatar cũ:', error);
        }

        // Cập nhật đường dẫn trong database
        await pool.query(
            'UPDATE Users SET ProfilePicture = ?, AvatarUrl = ? WHERE UserID = ?',
            [imagePath, imagePath, userId]
        );
        
        console.log('Đã cập nhật đường dẫn avatar trong CSDL');

        // Lấy thông tin người dùng đã cập nhật
        const [updatedUser] = await pool.query(
            'SELECT UserID, FullName, Email, PhoneNumber, ProfilePicture, AvatarUrl, RoleID, Status FROM Users WHERE UserID = ?',
            [userId]
        );

        if (!updatedUser || updatedUser.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy thông tin người dùng'
            });
        }

        // Thêm timestamp để tránh cache
        const timestamp = Date.now();
        
        console.log('Trả về kết quả thành công');
        return res.json({
            success: true,
            message: 'Cập nhật avatar thành công',
            user: updatedUser[0],
            avatarUrl: imagePath + '?t=' + timestamp,
            imagePath: imagePath
        });

    } catch (error) {
        console.error('Lỗi khi upload avatar:', error);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi upload avatar: ' + error.message
        });
    }
});

// API Upload hình ảnh dịch vụ
router.post('/upload/service/:id', authenticateToken, async (req, res, next) => {
    try {
        // Kiểm tra quyền admin
        if (req.user.role !== 1) {
            return res.status(403).json({
                success: false,
                message: 'Không có quyền thực hiện thao tác này'
            });
        }

        const serviceId = req.params.id;
        
        // Kiểm tra dịch vụ có tồn tại không
        const [serviceCheck] = await pool.query('SELECT * FROM Services WHERE ServiceID = ?', [serviceId]);
        
        if (serviceCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy dịch vụ'
            });
        }
        
        // Tạo slug từ tên dịch vụ để dùng trong tên file
        const serviceSlug = convertToSlug(serviceCheck[0].ServiceName);
            
        // Xóa hình ảnh cũ của dịch vụ này trước khi thêm mới
        await removeOldServiceImages(serviceId, serviceSlug);
        
        // Lưu thông tin dịch vụ vào req để sử dụng ở middleware sau
        req.serviceInfo = {
            id: serviceId,
            name: serviceCheck[0].ServiceName,
            slug: serviceSlug
        };
        
        // Tiếp tục quy trình upload
        next();
    } catch (error) {
        console.error('Lỗi khi kiểm tra trước khi upload:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
}, upload.single('image'), async (req, res) => {
    try {
        const serviceId = req.params.id;
        
        // Lấy đường dẫn tương đối của file để lưu vào database
        let imagePath;
        if (process.env.NODE_ENV === 'production') {
            imagePath = req.file.path.replace(/\\/g, '/').split('/tmp/')[1] || `services/${req.file.filename}`;
        } else {
            imagePath = req.file.path.replace(/\\/g, '/').split('/Web/')[1];
        }
        
        // Cập nhật đường dẫn hình ảnh trong database
        await pool.query('UPDATE Services SET ServiceImage = ? WHERE ServiceID = ?', [imagePath, serviceId]);
        
        // Trả về thông tin thành công và đường dẫn hình ảnh
        res.json({
            success: true,
            message: 'Upload hình ảnh dịch vụ thành công',
            imagePath: imagePath,
            fileName: req.file.filename
        });
    } catch (error) {
        console.error('Lỗi khi upload hình ảnh dịch vụ:', error);
        // Xóa file nếu có lỗi xảy ra
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

// API Upload hình ảnh xe
router.post('/upload/vehicle/:id', authenticateToken, async (req, res, next) => {
    try {
        const vehicleId = req.params.id;
        
        // Kiểm tra xe có tồn tại không
        const [vehicleCheck] = await pool.query('SELECT * FROM Vehicles WHERE VehicleID = ?', [vehicleId]);
        
        if (vehicleCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy xe'
            });
        }

        // Kiểm tra quyền - chỉ admin hoặc chủ xe mới được upload
        if (req.user.role !== 1 && req.user.userId !== vehicleCheck[0].UserID) {
            return res.status(403).json({
                success: false,
                message: 'Không có quyền thực hiện thao tác này'
            });
        }
        
        // Xóa hình ảnh cũ của xe này
        await removeOldVehicleImages(vehicleId);
        
        next();
    } catch (error) {
        console.error('Lỗi khi kiểm tra trước khi upload hình xe:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
}, upload.single('image'), async (req, res) => {
    try {
        const vehicleId = req.params.id;
        
        // Lấy đường dẫn tương đối của file để lưu vào database
        let imagePath;
        if (process.env.NODE_ENV === 'production') {
            imagePath = req.file.path.replace(/\\/g, '/').split('/tmp/')[1] || `vehicles/${req.file.filename}`;
        } else {
            imagePath = req.file.path.replace(/\\/g, '/').split('/Web/')[1];
        }
        
        // Cập nhật đường dẫn hình ảnh trong database
        await pool.query('UPDATE Vehicles SET VehicleImage = ? WHERE VehicleID = ?', [imagePath, vehicleId]);
        
        res.json({
            success: true,
            message: 'Upload hình ảnh xe thành công',
            imagePath: imagePath
        });
    } catch (error) {
        console.error('Lỗi khi upload hình ảnh xe:', error);
        // Xóa file nếu có lỗi xảy ra
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

// API xóa hình ảnh dịch vụ
router.delete('/service/:id', authenticateToken, async (req, res) => {
    try {
        // Kiểm tra quyền admin
        if (req.user.role !== 1) {
            return res.status(403).json({
                success: false,
                message: 'Không có quyền thực hiện thao tác này'
            });
        }

        const serviceId = req.params.id;
        
        // Kiểm tra dịch vụ có tồn tại không
        const [serviceCheck] = await pool.query('SELECT * FROM Services WHERE ServiceID = ?', [serviceId]);
        
        if (serviceCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy dịch vụ'
            });
        }

        // Kiểm tra nếu có hình ảnh thì xóa
        if (serviceCheck[0].ServiceImage) {
            const imagePath = path.join(__dirname, '../../Web', serviceCheck[0].ServiceImage);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
            
            // Cập nhật đường dẫn hình ảnh trong database thành null
            await pool.query('UPDATE Services SET ServiceImage = NULL WHERE ServiceID = ?', [serviceId]);
        } else {
            return res.status(404).json({
                success: false,
                message: 'Dịch vụ này không có hình ảnh'
            });
        }
        
        res.json({
            success: true,
            message: 'Xóa hình ảnh dịch vụ thành công'
        });
    } catch (error) {
        console.error('Lỗi khi xóa hình ảnh dịch vụ:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

// API xóa hình ảnh xe
router.delete('/vehicle/:id', authenticateToken, async (req, res) => {
    try {
        const vehicleId = req.params.id;
        
        // Kiểm tra xe có tồn tại không
        const [vehicleCheck] = await pool.query('SELECT * FROM Vehicles WHERE VehicleID = ?', [vehicleId]);
        
        if (vehicleCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy xe'
            });
        }

        // Kiểm tra quyền - chỉ admin hoặc chủ xe mới được xóa
        if (req.user.role !== 1 && req.user.userId !== vehicleCheck[0].UserID) {
            return res.status(403).json({
                success: false,
                message: 'Không có quyền thực hiện thao tác này'
            });
        }

        // Kiểm tra nếu có hình ảnh thì xóa
        if (vehicleCheck[0].VehicleImage) {
            const imagePath = path.join(__dirname, '../../Web', vehicleCheck[0].VehicleImage);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
            
            // Cập nhật đường dẫn hình ảnh trong database thành null
            await pool.query('UPDATE Vehicles SET VehicleImage = NULL WHERE VehicleID = ?', [vehicleId]);
        } else {
            return res.status(404).json({
                success: false,
                message: 'Xe này không có hình ảnh'
            });
        }
        
        res.json({
            success: true,
            message: 'Xóa hình ảnh xe thành công'
        });
    } catch (error) {
        console.error('Lỗi khi xóa hình ảnh xe:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

// API lấy danh sách hình ảnh trong thư mục services
router.get('/services', async (req, res) => {
    try {
        if (!fs.existsSync(servicesDir)) {
            return res.json({
                success: true,
                images: []
            });
        }
        
        const files = fs.readdirSync(servicesDir);
        const images = files
            .filter(file => /\.(jpg|jpeg|png|gif)$/i.test(file))
            .map(file => `/images/services/${file}`);
        
        res.json({
            success: true,
            images: images
        });
    } catch (error) {
        console.error('Lỗi khi lấy danh sách hình ảnh dịch vụ:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

// API Upload hình ảnh tạm thời (để sử dụng trong CKEditor hoặc các editor khác)
router.post('/upload/temp', authenticateToken, upload.single('upload'), async (req, res) => {
    try {
        // Lấy đường dẫn tương đối của file
        let imagePath;
        if (process.env.NODE_ENV === 'production') {
            imagePath = req.file.path.replace(/\\/g, '/').split('/tmp/')[1] || `temp/${req.file.filename}`;
        } else {
            imagePath = req.file.path.replace(/\\/g, '/').split('/Web/')[1];
        }
        
        // Đường dẫn đầy đủ đến file (URL)
        const imageUrl = `${req.protocol}://${req.get('host')}/${imagePath}`;
        
        // Nếu là từ CKEditor, trả về định dạng mà CKEditor mong đợi
        if (req.query.CKEditor || req.query.responseType === 'ckeditor') {
            return res.json({
                uploaded: 1,
                fileName: req.file.filename,
                url: imageUrl
            });
        }
        
        // Trả về định dạng chung
        res.json({
            success: true,
            message: 'Upload hình ảnh thành công',
            imagePath: imagePath,
            imageUrl: imageUrl
        });
    } catch (error) {
        console.error('Lỗi khi upload hình ảnh tạm thời:', error);
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

// API khởi tạo thư mục hình ảnh - gọi khi khởi động server
router.get('/init-directories', async (req, res) => {
    try {
        // Danh sách thư mục cần tạo
        const directories = ['services', 'vehicles', 'avatars', 'temp'];
        
        // Tạo thư mục gốc nếu chưa có
        if (!fs.existsSync(webImagesDir)) {
            fs.mkdirSync(webImagesDir, { recursive: true });
            console.log(`Đã tạo thư mục images gốc: ${webImagesDir}`);
        }
        
        // Tạo các thư mục con
        const createdDirs = [];
        for (const dir of directories) {
            const dirPath = path.join(webImagesDir, dir);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
                createdDirs.push(dir);
                console.log(`Đã tạo thư mục: ${dirPath}`);
            }
        }
        
        res.json({
            success: true,
            message: 'Đã kiểm tra và tạo các thư mục hình ảnh cần thiết',
            createdDirectories: createdDirs
        });
    } catch (error) {
        console.error('Lỗi khi kiểm tra và tạo thư mục hình ảnh:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + error.message
        });
    }
});

// Đường dẫn để kiểm tra xem API hình ảnh có hoạt động không
router.get('/check', (req, res) => {
    res.json({
        success: true,
        message: 'API xử lý hình ảnh đang hoạt động',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;