// schedulesRoutes.js - Quản lý API cho lịch làm việc kỹ thuật viên

const express = require('express');
const socketService = require('../socket-service');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken } = require('./authRoutes');

const { pool } = require('../db');
const { parseVietnamTime, parseVietnamDate, isValidTimeFormat, isValidDateFormat } = require('../utils/timeUtils');

// Middleware xác thực cho tất cả các routes
router.use(authenticateToken);


// API: GET /api/schedules/available-slots?date=YYYY-MM-DD
router.get('/available-slots', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, message: 'Thiếu ngày cần kiểm tra' });

    // Chỉ lấy lịch làm việc, không lấy lịch nghỉ
    const [rows] = await pool.query(
      `SELECT s.ScheduleID, s.MechanicID, u.FullName AS MechanicName, s.WorkDate, s.StartTime, s.EndTime
       FROM StaffSchedule s
       JOIN Users u ON s.MechanicID = u.UserID
       WHERE s.WorkDate = ? 
       AND (s.Status IS NULL OR s.Status NOT IN ('ApprovedLeave', 'PendingLeave', 'RejectedLeave'))
       AND (s.Type IS NULL OR s.Type != 'unavailable')
       ORDER BY s.StartTime`,
      [date]
    );

    res.json({
      success: true,
      date,
      availableSlots: rows
    });
  } catch (err) {
    console.error('Lỗi /available-slots schedules:', err);
    res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
  }
});


// API lấy danh sách lịch làm việc
router.get('/', async (req, res) => {
  try {
    // Lấy danh sách lịch làm việc từ database
    const [schedules] = await pool.query(`
      SELECT s.*, u.FullName AS MechanicName
      FROM StaffSchedule s
      LEFT JOIN Users u ON s.MechanicID = u.UserID
      ORDER BY s.WorkDate DESC, s.StartTime ASC
    `);
    
    res.json({
      success: true,
      schedules: schedules
    });
  } catch (error) {
    console.error('Lỗi khi lấy danh sách lịch làm việc:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server: ' + error.message 
    });
  }
});

// API lấy lịch làm việc theo khoảng thời gian
router.get('/by-date-range/:startDate/:endDate', async (req, res) => {
  try {
    const { startDate, endDate } = req.params;
    const { includeLeave } = req.query; // Thêm param để include lịch nghỉ nếu cần
    
    // Kiểm tra tham số đầu vào
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu tham số ngày bắt đầu hoặc ngày kết thúc'
      });
    }
    
    // Lấy lịch trình trong khoảng thời gian
    // Mặc định: LỌC BỎ lịch nghỉ đã duyệt (ApprovedLeave, PendingLeave)
    let query = `
      SELECT s.*, u.FullName AS MechanicName
      FROM StaffSchedule s
      LEFT JOIN Users u ON s.MechanicID = u.UserID
      WHERE s.WorkDate BETWEEN ? AND ?
    `;
    
    // Nếu không yêu cầu include lịch nghỉ, thêm filter
    if (includeLeave !== 'true') {
      query += ` AND (s.Status IS NULL OR s.Status NOT IN ('ApprovedLeave', 'PendingLeave', 'RejectedLeave'))`;
      query += ` AND (s.Type IS NULL OR s.Type != 'unavailable')`;
    }
    
    query += ` ORDER BY s.WorkDate ASC, s.StartTime ASC`;
    
    const [schedules] = await pool.query(query, [startDate, endDate]);
    
    res.json({
      success: true,
      schedules: schedules
    });
  } catch (error) {
    console.error('Lỗi khi lấy lịch làm việc theo khoảng thời gian:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server: ' + error.message 
    });
  }
});

// API lấy lịch làm việc theo ngày
router.get('/by-date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const mechanicId = req.query.mechanicId;
    const includeLeave = req.query.includeLeave;
    
    // Kiểm tra tham số đầu vào
    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu tham số ngày'
      });
    }
    
    let query = `
      SELECT s.*, u.FullName AS MechanicName
      FROM StaffSchedule s
      LEFT JOIN Users u ON s.MechanicID = u.UserID
      WHERE s.WorkDate = ?
    `;
    
    const queryParams = [date];
    
    // Thêm điều kiện lọc theo kỹ thuật viên nếu có
    if (mechanicId) {
      query += ' AND s.MechanicID = ?';
      queryParams.push(mechanicId);
    }
    
    // Lọc bỏ lịch nghỉ (mặc định)
    if (includeLeave !== 'true') {
      query += ` AND (s.Status IS NULL OR s.Status NOT IN ('ApprovedLeave', 'PendingLeave', 'RejectedLeave'))`;
      query += ` AND (s.Type IS NULL OR s.Type != 'unavailable')`;
    }
    
    query += ' ORDER BY s.StartTime ASC';
    
    // Lấy lịch trình theo ngày
    const [schedules] = await pool.query(query, queryParams);
    
    res.json({
      success: true,
      schedules: schedules
    });
  } catch (error) {
    console.error('Lỗi khi lấy lịch làm việc theo ngày:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server: ' + error.message 
    });
  }
});

// API lấy danh sách kỹ thuật viên
router.get('/mechanics/list', async (req, res) => {
  try {
    // Lấy danh sách kỹ thuật viên (users có role = 3)
    const [mechanics] = await pool.query(`
      SELECT u.UserID, u.FullName, u.Email, u.PhoneNumber
      FROM Users u
      WHERE u.RoleID = 3
      ORDER BY u.FullName
    `);
    
    res.json({
      success: true,
      mechanics: mechanics
    });
  } catch (error) {
    console.error('Lỗi khi lấy danh sách kỹ thuật viên:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server: ' + error.message 
    });
  }
});

// API lấy chi tiết lịch làm việc
router.get('/:id', async (req, res) => {
  try {
    const scheduleId = req.params.id;
    
    // Lấy thông tin lịch làm việc từ database
    const [schedules] = await pool.query(`
      SELECT s.*, u.FullName AS MechanicName
      FROM StaffSchedule s
      LEFT JOIN Users u ON s.MechanicID = u.UserID
      WHERE s.ScheduleID = ?
    `, [scheduleId]);
    
    if (schedules.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy lịch làm việc'
      });
    }
    
    res.json({
      success: true,
      schedule: schedules[0]
    });
  } catch (error) {
    console.error('Lỗi khi lấy chi tiết lịch làm việc:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server: ' + error.message 
    });
  }
});

// API tạo lịch làm việc mới
router.post('/', async (req, res) => {
  try {
    const { mechanicId, workDate, startTime, endTime } = req.body;
    
    // Kiểm tra dữ liệu đầu vào
    if (!mechanicId || !workDate || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu thông tin bắt buộc'
      });
    }
    
    // ✅ Parse time về Vietnam timezone (GMT+7)
    const parsedDate = parseVietnamDate(workDate);
    const parsedStartTime = parseVietnamTime(startTime);
    const parsedEndTime = parseVietnamTime(endTime);
    
    console.log('📅 [SCHEDULE] Input:', { workDate, startTime, endTime });
    console.log('✅ [SCHEDULE] Parsed:', { parsedDate, parsedStartTime, parsedEndTime });
    
    // Validate parsed values
    if (!parsedDate || !parsedStartTime || !parsedEndTime) {
      return res.status(400).json({
        success: false,
        message: 'Định dạng ngày hoặc giờ không hợp lệ'
      });
    }
    
    // Kiểm tra xem kỹ thuật viên có tồn tại không
    const [mechanicRows] = await pool.query('SELECT UserID FROM Users WHERE UserID = ? AND RoleID = 3', [mechanicId]);
    
    if (mechanicRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy kỹ thuật viên'
      });
    }
    
    // Kiểm tra xem lịch làm việc trùng lặp không
    const [duplicateRows] = await pool.query(`
      SELECT * FROM StaffSchedule 
      WHERE MechanicID = ? AND WorkDate = ? AND
      ((StartTime <= ? AND EndTime >= ?) OR 
       (StartTime <= ? AND EndTime >= ?) OR
       (StartTime >= ? AND EndTime <= ?))
    `, [mechanicId, parsedDate, parsedStartTime, parsedStartTime, parsedEndTime, parsedEndTime, parsedStartTime, parsedEndTime]);
    
    if (duplicateRows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Lịch làm việc bị trùng với lịch đã tồn tại'
      });
    }
    
    // Thêm lịch làm việc mới với parsed time
    const [result] = await pool.query(
      'INSERT INTO StaffSchedule (MechanicID, WorkDate, StartTime, EndTime) VALUES (?, ?, ?, ?)',
      [mechanicId, parsedDate, parsedStartTime, parsedEndTime]
    );
    
    console.log('✅ [SCHEDULE] Created schedule:', result.insertId);
    
    res.status(201).json({
      success: true,
      message: 'Thêm lịch làm việc thành công',
      scheduleId: result.insertId
    });
  } catch (error) {
    console.error('❌ [SCHEDULE] Error creating schedule:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server: ' + error.message 
    });
  }
});

// API cập nhật lịch làm việc
router.put('/:id', async (req, res) => {
  try {
    const scheduleId = req.params.id;
    const { mechanicId, workDate, startTime, endTime } = req.body;
    
    // Kiểm tra dữ liệu đầu vào
    if (!mechanicId || !workDate || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu thông tin bắt buộc'
      });
    }
    
    // ✅ Parse time về Vietnam timezone (GMT+7)
    const parsedDate = parseVietnamDate(workDate);
    const parsedStartTime = parseVietnamTime(startTime);
    const parsedEndTime = parseVietnamTime(endTime);
    
    console.log('📅 [SCHEDULE] Update Input:', { workDate, startTime, endTime });
    console.log('✅ [SCHEDULE] Parsed:', { parsedDate, parsedStartTime, parsedEndTime });
    
    // Validate parsed values
    if (!parsedDate || !parsedStartTime || !parsedEndTime) {
      return res.status(400).json({
        success: false,
        message: 'Định dạng ngày hoặc giờ không hợp lệ'
      });
    }
    
    // Kiểm tra xem lịch làm việc có tồn tại không
    const [scheduleRows] = await pool.query('SELECT * FROM StaffSchedule WHERE ScheduleID = ?', [scheduleId]);
    
    if (scheduleRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy lịch làm việc'
      });
    }
    
    // Kiểm tra xem kỹ thuật viên có tồn tại không
    const [mechanicRows] = await pool.query('SELECT UserID FROM Users WHERE UserID = ? AND RoleID = 3', [mechanicId]);
    
    if (mechanicRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy kỹ thuật viên'
      });
    }
    
    // Kiểm tra xem lịch làm việc trùng lặp không (trừ lịch hiện tại)
    const [duplicateRows] = await pool.query(`
      SELECT * FROM StaffSchedule 
      WHERE MechanicID = ? AND WorkDate = ? AND
      ((StartTime <= ? AND EndTime >= ?) OR 
       (StartTime <= ? AND EndTime >= ?) OR
       (StartTime >= ? AND EndTime <= ?))
      AND ScheduleID <> ?
    `, [mechanicId, parsedDate, parsedStartTime, parsedStartTime, parsedEndTime, parsedEndTime, parsedStartTime, parsedEndTime, scheduleId]);
    
    if (duplicateRows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Lịch làm việc bị trùng với lịch đã tồn tại'
      });
    }
    
    // Cập nhật lịch làm việc với parsed time
    await pool.query(
      'UPDATE StaffSchedule SET MechanicID = ?, WorkDate = ?, StartTime = ?, EndTime = ? WHERE ScheduleID = ?',
      [mechanicId, parsedDate, parsedStartTime, parsedEndTime, scheduleId]
    );
    
    console.log('✅ [SCHEDULE] Updated schedule:', scheduleId);
    
    res.json({
      success: true,
      message: 'Cập nhật lịch làm việc thành công'
    });
  } catch (error) {
    console.error('❌ [SCHEDULE] Error updating schedule:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server: ' + error.message 
    });
  }
});

// API xóa lịch làm việc
router.delete('/:id', async (req, res) => {
  try {
    const scheduleId = req.params.id;
    
    // Kiểm tra xem lịch làm việc có tồn tại không
    const [scheduleRows] = await pool.query('SELECT * FROM StaffSchedule WHERE ScheduleID = ?', [scheduleId]);
    
    if (scheduleRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy lịch làm việc'
      });
    }
    
    // Xóa lịch làm việc
    await pool.query('DELETE FROM StaffSchedule WHERE ScheduleID = ?', [scheduleId]);
    
    res.json({
      success: true,
      message: 'Xóa lịch làm việc thành công'
    });
  } catch (error) {
    console.error('Lỗi khi xóa lịch làm việc:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server: ' + error.message 
    });
  }
});

module.exports = router;