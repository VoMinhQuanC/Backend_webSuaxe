// utils/timeUtils.js - Xử lý timezone cho Vietnam (GMT+7)

/**
 * Parse time input và convert về format HH:MM (Vietnam timezone)
 * @param {string|Date} timeInput - Time input (có thể là ISO string, Date object, hoặc "HH:MM")
 * @returns {string} Time trong format "HH:MM" (24h format)
 */
function parseVietnamTime(timeInput) {
  if (!timeInput) {
    return null;
  }

  // Nếu đã là format "HH:MM" rồi → return luôn
  if (typeof timeInput === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(timeInput)) {
    return timeInput.substring(0, 5); // Chỉ lấy HH:MM
  }

  try {
    let date;
    
    // Parse thành Date object
    if (typeof timeInput === 'string') {
      date = new Date(timeInput);
    } else if (timeInput instanceof Date) {
      date = timeInput;
    } else {
      throw new Error('Invalid time input type');
    }

    // Check valid date
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date');
    }

    // Convert về Vietnam timezone (GMT+7)
    // getTimezoneOffset() trả về phút chênh lệch so với UTC
    // VD: Vietnam = -420 (tức là +7 giờ so với UTC)
    const vietnamOffset = 7 * 60; // GMT+7 = 420 phút
    const localOffset = date.getTimezoneOffset(); // Phút chênh với UTC (âm nếu ahead)
    const diffMinutes = vietnamOffset + localOffset;
    
    // Adjust date về Vietnam time
    const vietnamDate = new Date(date.getTime() + diffMinutes * 60 * 1000);
    
    // Format thành HH:MM
    const hours = String(vietnamDate.getHours()).padStart(2, '0');
    const minutes = String(vietnamDate.getMinutes()).padStart(2, '0');
    
    return `${hours}:${minutes}`;
  } catch (error) {
    console.error('❌ Error parsing time:', error.message, 'Input:', timeInput);
    
    // Fallback: Nếu là string có format time, extract ra
    if (typeof timeInput === 'string') {
      const match = timeInput.match(/(\d{2}):(\d{2})/);
      if (match) {
        return `${match[1]}:${match[2]}`;
      }
    }
    
    return null;
  }
}

/**
 * Parse date input và convert về format YYYY-MM-DD (Vietnam timezone)
 * @param {string|Date} dateInput - Date input
 * @returns {string} Date trong format "YYYY-MM-DD"
 */
function parseVietnamDate(dateInput) {
  if (!dateInput) {
    return null;
  }

  // Nếu đã là format "YYYY-MM-DD" rồi → return luôn
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    return dateInput;
  }

  try {
    let date;
    
    // Parse thành Date object
    if (typeof dateInput === 'string') {
      date = new Date(dateInput);
    } else if (dateInput instanceof Date) {
      date = dateInput;
    } else {
      throw new Error('Invalid date input type');
    }

    // Check valid date
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date');
    }

    // Convert về Vietnam timezone
    const vietnamOffset = 7 * 60;
    const localOffset = date.getTimezoneOffset();
    const diffMinutes = vietnamOffset + localOffset;
    const vietnamDate = new Date(date.getTime() + diffMinutes * 60 * 1000);
    
    // Format thành YYYY-MM-DD
    const year = vietnamDate.getFullYear();
    const month = String(vietnamDate.getMonth() + 1).padStart(2, '0');
    const day = String(vietnamDate.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  } catch (error) {
    console.error('❌ Error parsing date:', error.message, 'Input:', dateInput);
    
    // Fallback: Extract YYYY-MM-DD nếu có
    if (typeof dateInput === 'string') {
      const match = dateInput.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        return `${match[1]}-${match[2]}-${match[3]}`;
      }
    }
    
    return null;
  }
}

/**
 * Format datetime để log (Vietnam timezone)
 * @param {Date} date 
 * @returns {string} Formatted datetime string
 */
function formatVietnamDateTime(date = new Date()) {
  const vietnamOffset = 7 * 60;
  const localOffset = date.getTimezoneOffset();
  const diffMinutes = vietnamOffset + localOffset;
  const vietnamDate = new Date(date.getTime() + diffMinutes * 60 * 1000);
  
  const year = vietnamDate.getFullYear();
  const month = String(vietnamDate.getMonth() + 1).padStart(2, '0');
  const day = String(vietnamDate.getDate()).padStart(2, '0');
  const hours = String(vietnamDate.getHours()).padStart(2, '0');
  const minutes = String(vietnamDate.getMinutes()).padStart(2, '0');
  const seconds = String(vietnamDate.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Get current date in Vietnam timezone (YYYY-MM-DD)
 * @returns {string}
 */
function getCurrentVietnamDate() {
  return parseVietnamDate(new Date());
}

/**
 * Get current time in Vietnam timezone (HH:MM)
 * @returns {string}
 */
function getCurrentVietnamTime() {
  return parseVietnamTime(new Date());
}

/**
 * Validate time format HH:MM
 * @param {string} time 
 * @returns {boolean}
 */
function isValidTimeFormat(time) {
  if (!time || typeof time !== 'string') {
    return false;
  }
  
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return false;
  }
  
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60;
}

/**
 * Validate date format YYYY-MM-DD
 * @param {string} date 
 * @returns {boolean}
 */
function isValidDateFormat(date) {
  if (!date || typeof date !== 'string') {
    return false;
  }
  
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return false;
  }
  
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  
  if (month < 1 || month > 12) {
    return false;
  }
  
  const daysInMonth = new Date(year, month, 0).getDate();
  return day >= 1 && day <= daysInMonth;
}

module.exports = {
  parseVietnamTime,
  parseVietnamDate,
  formatVietnamDateTime,
  getCurrentVietnamDate,
  getCurrentVietnamTime,
  isValidTimeFormat,
  isValidDateFormat
};