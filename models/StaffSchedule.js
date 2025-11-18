// models/StaffSchedule.js - Model for staff work schedules
const { pool } = require('../db');

class StaffSchedule {
    /**
     * Get all staff schedules
     * @returns {Promise<Array>} List of all schedules
     */
    static async getAllSchedules() {
        try {
            const [rows] = await pool.query(`
                SELECT ss.*, u.FullName as MechanicName
                FROM StaffSchedule ss
                JOIN Users u ON ss.MechanicID = u.UserID
                ORDER BY ss.WorkDate DESC, ss.StartTime ASC
            `);
            return rows;
        } catch (err) {
            console.error('Error in getAllSchedules:', err);
            throw err;
        }
    }

    /**
     * Get a schedule by ID
     * @param {number} scheduleId Schedule ID to find
     * @returns {Promise<Object|null>} Schedule if found, null otherwise
     */
    static async getScheduleById(scheduleId) {
        try {
            const [rows] = await pool.query(`
                SELECT ss.*, u.FullName as MechanicName
                FROM StaffSchedule ss
                JOIN Users u ON ss.MechanicID = u.UserID
                WHERE ss.ScheduleID = ?
            `, [scheduleId]);
            
            return rows.length > 0 ? rows[0] : null;
        } catch (err) {
            console.error('Error in getScheduleById:', err);
            throw err;
        }
    }

    /**
     * Get schedules for a specific date
     * @param {string} date Date in YYYY-MM-DD format
     * @returns {Promise<Array>} List of schedules for the date
     */
    static async getSchedulesByDate(date) {
        try {
            const [rows] = await pool.query(`
                SELECT ss.*, u.FullName as MechanicName
                FROM StaffSchedule ss
                JOIN Users u ON ss.MechanicID = u.UserID
                WHERE DATE(ss.WorkDate) = ?
                ORDER BY ss.MechanicID, ss.StartTime ASC
            `, [date]);
            
            return rows;
        } catch (err) {
            console.error('Error in getSchedulesByDate:', err);
            throw err;
        }
    }

    /**
     * Get schedules for a specific mechanic
     * @param {number} mechanicId Mechanic ID
     * @returns {Promise<Array>} List of schedules for the mechanic
     */
    static async getSchedulesByMechanic(mechanicId) {
        try {
            const [rows] = await pool.query(`
                SELECT ss.*, u.FullName as MechanicName
                FROM StaffSchedule ss
                JOIN Users u ON ss.MechanicID = u.UserID
                WHERE ss.MechanicID = ?
                ORDER BY ss.WorkDate DESC, ss.StartTime ASC
            `, [mechanicId]);
            
            return rows;
        } catch (err) {
            console.error('Error in getSchedulesByMechanic:', err);
            throw err;
        }
    }

    /**
     * Get schedules for a date range
     * @param {string} startDate Start date in YYYY-MM-DD format
     * @param {string} endDate End date in YYYY-MM-DD format
     * @returns {Promise<Array>} List of schedules in the date range
     */
    static async getSchedulesByDateRange(startDate, endDate) {
        try {
            const [rows] = await pool.query(`
                SELECT ss.*, u.FullName as MechanicName
                FROM StaffSchedule ss
                JOIN Users u ON ss.MechanicID = u.UserID
                WHERE DATE(ss.WorkDate) BETWEEN ? AND ?
                ORDER BY ss.WorkDate, ss.MechanicID, ss.StartTime ASC
            `, [startDate, endDate]);
            
            return rows;
        } catch (err) {
            console.error('Error in getSchedulesByDateRange:', err);
            throw err;
        }
    }

    /**
     * Get all mechanics (users with RoleID = 3)
     * @returns {Promise<Array>} List of all mechanics
     */
    static async getMechanics() {
        try {
            const [rows] = await pool.query(`
                SELECT UserID, FullName, Email, PhoneNumber
                FROM Users
                WHERE RoleID = 3 AND Status = 1
                ORDER BY FullName
            `);
            
            return rows;
        } catch (err) {
            console.error('Error in getMechanics:', err);
            throw err;
        }
    }

    /**
     * Add a new schedule
     * @param {number} mechanicId Mechanic ID
     * @param {string} workDate Work date in YYYY-MM-DD format
     * @param {string} startTime Start time in HH:MM format
     * @param {string} endTime End time in HH:MM format
     * @returns {Promise<number>} ID of the new schedule
     */
    static async addSchedule(mechanicId, workDate, startTime, endTime) {
        try {
            // Validate mechanic exists
            const [mechanicCheck] = await pool.query(
                'SELECT UserID FROM Users WHERE UserID = ? AND RoleID = 3',
                [mechanicId]
            );
            
            if (mechanicCheck.length === 0) {
                throw new Error('Kỹ thuật viên không tồn tại');
            }
            
            // Check for schedule conflicts
            const [conflictCheck] = await pool.query(`
                SELECT ScheduleID 
                FROM StaffSchedule 
                WHERE MechanicID = ? 
                AND WorkDate = ? 
                AND ((StartTime <= ? AND EndTime > ?) 
                    OR (StartTime < ? AND EndTime >= ?) 
                    OR (StartTime >= ? AND EndTime <= ?))
            `, [mechanicId, workDate, startTime, startTime, endTime, endTime, startTime, endTime]);
            
            if (conflictCheck.length > 0) {
                throw new Error('Thời gian này đã được lên lịch cho kỹ thuật viên. Vui lòng chọn thời gian khác.');
            }
            
            // Add new schedule
            const [result] = await pool.query(
                'INSERT INTO StaffSchedule (MechanicID, WorkDate, StartTime, EndTime) VALUES (?, ?, ?, ?)',
                [mechanicId, workDate, startTime, endTime]
            );
            
            return result.insertId;
        } catch (err) {
            console.error('Error in addSchedule:', err);
            throw err;
        }
    }

    /**
     * Update an existing schedule
     * @param {number} scheduleId Schedule ID to update
     * @param {number} mechanicId Mechanic ID
     * @param {string} workDate Work date in YYYY-MM-DD format
     * @param {string} startTime Start time in HH:MM format
     * @param {string} endTime End time in HH:MM format
     * @returns {Promise<boolean>} True if successful, false otherwise
     */
    static async updateSchedule(scheduleId, mechanicId, workDate, startTime, endTime) {
        try {
            // Check if schedule exists
            const [scheduleCheck] = await pool.query(
                'SELECT ScheduleID FROM StaffSchedule WHERE ScheduleID = ?',
                [scheduleId]
            );
            
            if (scheduleCheck.length === 0) {
                return false;
            }
            
            // Validate mechanic exists
            const [mechanicCheck] = await pool.query(
                'SELECT UserID FROM Users WHERE UserID = ? AND RoleID = 3',
                [mechanicId]
            );
            
            if (mechanicCheck.length === 0) {
                throw new Error('Kỹ thuật viên không tồn tại');
            }
            
            // Check for schedule conflicts (excluding the current schedule)
            const [conflictCheck] = await pool.query(`
                SELECT ScheduleID 
                FROM StaffSchedule 
                WHERE MechanicID = ? 
                AND WorkDate = ? 
                AND ScheduleID != ?
                AND ((StartTime <= ? AND EndTime > ?) 
                    OR (StartTime < ? AND EndTime >= ?) 
                    OR (StartTime >= ? AND EndTime <= ?))
            `, [mechanicId, workDate, scheduleId, startTime, startTime, endTime, endTime, startTime, endTime]);
            
            if (conflictCheck.length > 0) {
                throw new Error('Thời gian này đã được lên lịch cho kỹ thuật viên. Vui lòng chọn thời gian khác.');
            }
            
            // Update schedule
            const [result] = await pool.query(
                'UPDATE StaffSchedule SET MechanicID = ?, WorkDate = ?, StartTime = ?, EndTime = ? WHERE ScheduleID = ?',
                [mechanicId, workDate, startTime, endTime, scheduleId]
            );
            
            return result.affectedRows > 0;
        } catch (err) {
            console.error('Error in updateSchedule:', err);
            throw err;
        }
    }

    /**
     * Delete a schedule
     * @param {number} scheduleId Schedule ID to delete
     * @returns {Promise<boolean>} True if successful, false otherwise
     */
    static async deleteSchedule(scheduleId) {
        try {
            const [result] = await pool.query(
                'DELETE FROM StaffSchedule WHERE ScheduleID = ?',
                [scheduleId]
            );
            
            return result.affectedRows > 0;
        } catch (err) {
            console.error('Error in deleteSchedule:', err);
            throw err;
        }
    }

    /**
     * Check if a mechanic is available at a specific time
     * @param {number} mechanicId Mechanic ID
     * @param {string} workDate Work date in YYYY-MM-DD format
     * @param {string} startTime Start time in HH:MM format
     * @param {string} endTime End time in HH:MM format
     * @param {number} excludeScheduleId Optional schedule ID to exclude from conflict check
     * @returns {Promise<boolean>} True if available, false otherwise
     */
    static async isMechanicAvailable(mechanicId, workDate, startTime, endTime, excludeScheduleId = null) {
        try {
            let query = `
                SELECT COUNT(*) as count
                FROM StaffSchedule 
                WHERE MechanicID = ? 
                AND WorkDate = ? 
                AND ((StartTime <= ? AND EndTime > ?) 
                    OR (StartTime < ? AND EndTime >= ?) 
                    OR (StartTime >= ? AND EndTime <= ?))
            `;
            
            let params = [mechanicId, workDate, startTime, startTime, endTime, endTime, startTime, endTime];
            
            // Exclude a specific schedule from the check (useful for updates)
            if (excludeScheduleId) {
                query += ' AND ScheduleID != ?';
                params.push(excludeScheduleId);
            }
            
            const [result] = await pool.query(query, params);
            
            // If count is 0, mechanic is available
            return result[0].count === 0;
        } catch (err) {
            console.error('Error in isMechanicAvailable:', err);
            throw err;
        }
    }

    /**
     * Get available time slots for a specific date
     * @param {string} date Date in YYYY-MM-DD format
     * @returns {Promise<Array>} List of available time slots
     */
    static async getAvailableTimeSlots(date) {
        try {
            // Define business hours (e.g., 8:00 to 17:00)
            const businessHours = {
                start: '08:00',
                end: '17:00',
                interval: 60 // in minutes
            };
            
            // Define standard time slots
            const timeSlots = [];
            let currentTime = businessHours.start;
            
            while (currentTime < businessHours.end) {
                const [hours, minutes] = currentTime.split(':').map(Number);
                const slot = {
                    time: currentTime,
                    available: true
                };
                
                timeSlots.push(slot);
                
                // Add interval
                const totalMinutes = hours * 60 + minutes + businessHours.interval;
                const newHours = Math.floor(totalMinutes / 60);
                const newMinutes = totalMinutes % 60;
                
                currentTime = `${String(newHours).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}`;
            }
            
            // Get all schedules for the date
            const [schedules] = await pool.query(`
                SELECT MechanicID, StartTime, EndTime
                FROM StaffSchedule
                WHERE WorkDate = ?
            `, [date]);
            
            // Mark slots that are already booked
            for (const slot of timeSlots) {
                for (const schedule of schedules) {
                    if (slot.time >= schedule.StartTime && slot.time < schedule.EndTime) {
                        slot.available = false;
                        break;
                    }
                }
            }
            
            return timeSlots;
        } catch (err) {
            console.error('Error in getAvailableTimeSlots:', err);
            throw err;
        }
    }
}

module.exports = StaffSchedule;