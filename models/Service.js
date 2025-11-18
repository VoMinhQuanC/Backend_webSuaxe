const { pool } = require('../db'); // Import pool thay vì sql và connectDB

class Service {
    // Lấy danh sách tất cả dịch vụ
    static async getAllServices() {
        try {
            const [rows] = await pool.query('SELECT * FROM Services');
            return rows;
        } catch (err) {
            throw err;
        }
    }

    // Lấy dịch vụ theo ID
    static async getServiceById(serviceId) {
        try {
            const [rows] = await pool.query('SELECT * FROM Services WHERE ServiceId = ?', [serviceId]);
            return rows[0];
        } catch (err) {
            throw err;
        }
    }

    // Thêm dịch vụ mới
    static async addService(name, price) {
        try {
            const [result] = await pool.query(
                'INSERT INTO Services (ServiceName, Price) VALUES (?, ?)', 
                [name, price]
            );
            return result;
        } catch (err) {
            throw err;
        }
    }

    // Cập nhật dịch vụ
    static async updateService(id, name, price) {
        try {
            const [result] = await pool.query(
                'UPDATE Services SET ServiceName = ?, Price = ? WHERE ServiceId = ?', 
                [name, price, id]
            );
            return result;
        } catch (err) {
            throw err;
        }
    }

    // Xóa dịch vụ
    static async deleteService(id) {
        try {
            const [result] = await pool.query('DELETE FROM Services WHERE ServiceId = ?', [id]);
            return result;
        } catch (err) {
            throw err;
        }
    }
}

module.exports = Service;