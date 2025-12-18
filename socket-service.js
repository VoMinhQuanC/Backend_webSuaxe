// socket-service.js
// Real-time communication service using Socket.io

const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');

let io;
const userSockets = new Map(); // Map userId -> socketId

/**
 * Initialize Socket.io server
 * @param {Object} server - HTTP server instance
 */
function initializeSocket(server) {
  io = socketIO(server, {
    cors: {
      origin: [
        'http://localhost:5000',
        'http://localhost:3000', 
        'https://suaxe-web-73744.web.app',
        'https://suaxe-web-73744.firebaseapp.com'
      ],
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  // Middleware xác thực
  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      console.log('❌ Socket connection rejected: No token');
      return next(new Error('Authentication error'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-2024');
      socket.userId = decoded.userId;
      socket.role = decoded.role;
      socket.userName = decoded.userName || 'User';
      next();
    } catch (err) {
      console.log('❌ Socket authentication failed:', err.message);
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`✅ User connected: ${socket.userName} (ID: ${socket.userId})`);
    
    // Lưu socket của user
    userSockets.set(socket.userId, socket.id);

    // Join room theo role
    const roleRoom = getRoleRoom(socket.role);
    socket.join(roleRoom);
    socket.join(`user_${socket.userId}`); // Personal room
    
    console.log(`📍 User ${socket.userId} joined room: ${roleRoom}`);

    // Events
    socket.on('disconnect', () => {
      console.log(`❌ User disconnected: ${socket.userName} (ID: ${socket.userId})`);
      userSockets.delete(socket.userId);
    });

    // Ping-pong để maintain connection
    socket.on('ping', () => {
      socket.emit('pong');
    });
  });

  console.log('🚀 Socket.io initialized');
  return io;
}

/**
 * Get room name by role
 */
function getRoleRoom(role) {
  const rooms = {
    1: 'admin',
    2: 'customer', 
    3: 'mechanic'
  };
  return rooms[role] || 'customer';
}

/**
 * Emit event khi có appointment mới
 */
function emitNewAppointment(appointmentData) {
  if (!io) return;
  
  console.log('📢 Emitting new_appointment:', appointmentData.AppointmentID);
  
  // Gửi cho admin
  io.to('admin').emit('new_appointment', {
    type: 'new_appointment',
    data: appointmentData,
    timestamp: new Date().toISOString()
  });

  // Gửi cho mechanic được assign (nếu có)
  if (appointmentData.MechanicID) {
    io.to(`user_${appointmentData.MechanicID}`).emit('new_task', {
      type: 'new_task',
      data: appointmentData,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Emit event khi appointment được update
 */
function emitAppointmentUpdated(appointmentData, previousStatus) {
  if (!io) return;
  
  console.log('📢 Emitting appointment_updated:', appointmentData.AppointmentID);
  
  const event = {
    type: 'appointment_updated',
    data: appointmentData,
    previousStatus,
    timestamp: new Date().toISOString()
  };

  // Gửi cho customer
  io.to(`user_${appointmentData.UserID}`).emit('appointment_updated', event);

  // Gửi cho mechanic
  if (appointmentData.MechanicID) {
    io.to(`user_${appointmentData.MechanicID}`).emit('task_updated', event);
  }

  // Gửi cho admin
  io.to('admin').emit('appointment_updated', event);
}

/**
 * Emit event khi có schedule mới
 */
function emitScheduleCreated(scheduleData) {
  if (!io) return;
  
  console.log('📢 Emitting schedule_created:', scheduleData.ScheduleID);
  
  // Gửi cho admin
  io.to('admin').emit('schedule_created', {
    type: 'schedule_created',
    data: scheduleData,
    timestamp: new Date().toISOString()
  });

  // Gửi cho mechanic owner
  if (scheduleData.MechanicID) {
    io.to(`user_${scheduleData.MechanicID}`).emit('my_schedule_updated', {
      type: 'my_schedule_updated',
      data: scheduleData,
      timestamp: new Date().toISOString()
    });
  }

  // Gửi cho tất cả mechanics (để update team schedule)
  io.to('mechanic').emit('team_schedule_updated', {
    type: 'team_schedule_updated',
    data: scheduleData,
    timestamp: new Date().toISOString()
  });
}

/**
 * Emit event khi schedule được approve/reject
 */
function emitScheduleStatusChanged(scheduleData) {
  if (!io) return;
  
  console.log('📢 Emitting schedule_status_changed:', scheduleData.ScheduleID);
  
  // Gửi cho mechanic owner
  if (scheduleData.MechanicID) {
    io.to(`user_${scheduleData.MechanicID}`).emit('schedule_status_changed', {
      type: 'schedule_status_changed',
      data: scheduleData,
      timestamp: new Date().toISOString()
    });
  }

  // Gửi cho admin
  io.to('admin').emit('schedule_status_changed', {
    type: 'schedule_status_changed',
    data: scheduleData,
    timestamp: new Date().toISOString()
  });
}

/**
 * Emit notification đến user cụ thể
 */
function emitNotification(userId, notification) {
  if (!io) return;
  
  console.log(`📢 Emitting notification to user ${userId}`);
  
  io.to(`user_${userId}`).emit('new_notification', {
    type: 'new_notification',
    data: notification,
    timestamp: new Date().toISOString()
  });
}

/**
 * Broadcast message đến một room
 */
function broadcastToRoom(room, event, data) {
  if (!io) return;
  
  console.log(`📢 Broadcasting ${event} to room ${room}`);
  
  io.to(room).emit(event, {
    type: event,
    data,
    timestamp: new Date().toISOString()
  });
}

/**
 * Get connected users count
 */
function getConnectedUsersCount() {
  return userSockets.size;
}

/**
 * Check if user is online
 */
function isUserOnline(userId) {
  return userSockets.has(userId);
}

module.exports = {
  initializeSocket,
  emitNewAppointment,
  emitAppointmentUpdated,
  emitScheduleCreated,
  emitScheduleStatusChanged,
  emitNotification,
  broadcastToRoom,
  getConnectedUsersCount,
  isUserOnline
};