// routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');

// Sử dụng pool từ api-server.js hoặc tạo connection
// Giả sử bạn export pool từ api-server.js hoặc db.js
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
 * API: Lấy thông tin thanh toán + QR code cho đơn hàng
 * GET /api/payment/qr/:appointmentId
 * 
 * Response: { qrUrl, bookingCode, totalAmount, bankInfo }
 */
router.get('/qr/:appointmentId', async (req, res) => {
    try {
        const appointmentId = req.params.appointmentId;
        
        console.log(`📱 Generating QR for appointment: ${appointmentId}`);
        
        // BƯỚC 1: Lấy thông tin đơn hàng từ DATABASE
        const [appointments] = await pool.query(`
            SELECT 
                a.AppointmentID,
                a.UserID,
                a.Status,
                a.AppointmentDate,
                u.FullName as CustomerName,
                u.PhoneNumber,
                u.Email
            FROM Appointments a
            JOIN Users u ON a.UserID = u.UserID
            WHERE a.AppointmentID = ? AND a.IsDeleted = 0
        `, [appointmentId]);
        
        if (appointments.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy đơn hàng'
            });
        }
        
        const appointment = appointments[0];
        
        // BƯỚC 2: Tính tổng tiền từ các dịch vụ
        const [services] = await pool.query(`
            SELECT 
                SUM(s.Price * aps.Quantity) as TotalAmount,
                GROUP_CONCAT(s.ServiceName SEPARATOR ', ') as ServiceNames
            FROM AppointmentServices aps
            JOIN Services s ON aps.ServiceID = s.ServiceID
            WHERE aps.AppointmentID = ?
        `, [appointmentId]);
        
        const totalAmount = services[0]?.TotalAmount || 0;
        const serviceNames = services[0]?.ServiceNames || '';
        
        console.log(`💰 Total Amount: ${totalAmount}đ`);
        console.log(`🔧 Services: ${serviceNames}`);
        
        // BƯỚC 3: Tạo mã booking TỰ ĐỘNG theo AppointmentID
        const bookingCode = `BK${appointmentId}`;
        
        // BƯỚC 4: Thông tin tài khoản ngân hàng (LẤY TỪ .ENV)
        const bankInfo = {
            accountNo: process.env.BANK_ACCOUNT_NO || '0947084064',
            accountName: process.env.BANK_ACCOUNT_NAME || 'VO MINH QUAN',
            bankId: process.env.BANK_ID || '970422', // 970422 = MB Bank
            bankName: getBankName(process.env.BANK_ID || '970422')
        };
        
        // BƯỚC 5: Generate QR URL với VietQR API (MIỄN PHÍ)
        // Format: https://img.vietqr.io/image/{BANK_ID}-{ACCOUNT_NO}-{TEMPLATE}.png?amount={AMOUNT}&addInfo={CONTENT}
        // addInfo chính là NỘI DUNG CHUYỂN KHOẢN - tự động theo mã đơn
        const qrUrl = `https://img.vietqr.io/image/${bankInfo.bankId}-${bankInfo.accountNo}-compact2.png?amount=${totalAmount}&addInfo=${encodeURIComponent(bookingCode)}&accountName=${encodeURIComponent(bankInfo.accountName)}`;
        
        console.log(`✅ QR generated successfully`);
        console.log(`📝 Booking Code: ${bookingCode}`);
        console.log(`💰 Amount: ${totalAmount}đ`);
        console.log(`🔗 QR URL: ${qrUrl}`);
        
        // BƯỚC 6: Trả về response
        res.json({
            success: true,
            data: {
                appointmentId: appointmentId,
                bookingCode: bookingCode, // Mã đơn: BK1030, BK1031, ...
                totalAmount: totalAmount, // Tổng tiền thật từ DB
                customerName: appointment.CustomerName,
                serviceNames: serviceNames,
                qrUrl: qrUrl,
                bankInfo: {
                    accountNo: bankInfo.accountNo,
                    accountName: bankInfo.accountName,
                    bankName: bankInfo.bankName,
                    bankCode: bankInfo.bankId, // ✅ ĐÃ THÊM bankCode
                    transferContent: bookingCode // Nội dung CK tự động
                }
            }
        });
        
    } catch (err) {
        console.error('❌ Error generating QR:', err);
        res.status(500).json({
            success: false,
            message: 'Lỗi server: ' + err.message
        });
    }
});

/**
 * Helper: Lấy tên ngân hàng từ mã BIN
 */
function getBankName(bankId) {
    const banks = {
        '970422': 'MB Bank (Quân Đội)',
        '970415': 'Vietinbank',
        '970436': 'Vietcombank',
        '970418': 'BIDV',
        '970405': 'Agribank',
        '970407': 'Techcombank',
        '970423': 'TPBank',
        '970403': 'Sacombank',
        '970416': 'ACB',
        '970432': 'VPBank',
        '970441': 'VIB',
        '970448': 'OCB',
        '970414': 'Oceanbank',
        '970431': 'Eximbank',
        '970426': 'MSB',
        '970433': 'VietCapitalBank',
        '970438': 'BacABank',
        '970440': 'SeABank',
        '970443': 'SHB',
        '970427': 'VietABank',
        '970429': 'SCB',
        '970419': 'NCB',
        '970424': 'ShinhanBank',
        '970410': 'StandardChartered',
        '970430': 'PGBank',
        '970425': 'ABBank',
        '970409': 'BaoVietBank',
        '970412': 'PVcomBank',
        '970428': 'NamABank',
        '970437': 'HDBank',
        '970439': 'PublicBank',
        '970444': 'CBBank',
        '970446': 'COOPBANK',
        '970449': 'LienVietPostBank',
        '970421': 'VRB',
        '970454': 'VietBank',
        '970457': 'WooriBank',
        '970458': 'UnitedOverseas',
        '970434': 'IndovinaBank',
        '970456': 'IBKHN',
        '970455': 'IBBVN',
        '970442': 'HongLeongBank',
        '970406': 'DongABank',
        '970408': 'GPBank',
        '970413': 'KienLongBank',
    };
    return banks[bankId] || 'Ngân hàng';
}

module.exports = router;