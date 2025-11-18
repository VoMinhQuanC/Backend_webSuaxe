const mysql = require('mysql2/promise');  // Sử dụng mysql2 thay vì mssql

const config = {
    host: process.env.DB_HOST || '34.124.218.251',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '123456',
    database: process.env.DB_NAME || 'websuaxe',
    port: parseInt(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// Tạo một pool connection
const pool = mysql.createPool(config);

// Kiểm tra kết nối
async function connectDB() {
    try {
        const connection = await pool.getConnection();
        console.log("✅ Kết nối MySQL thành công!");
        connection.release();
        return pool;
    } catch (err) {
        console.error("❌ Lỗi kết nối MySQL:", err);
        throw err;
    }
}

// Thêm hàm xử lý lỗi kết nối
async function executeQuery(query, params = []) {
    try {
        const [rows] = await pool.query(query, params);
        return rows;
    } catch (error) {
        console.error("Lỗi thực thi truy vấn:", error);
        console.error("Query:", query);
        console.error("Params:", params);
        throw error;
    }
}

module.exports = { mysql, connectDB, pool, executeQuery };
