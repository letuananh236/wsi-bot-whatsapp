require('dotenv').config();
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const fs = require('fs/promises');
const { DateTime } = require('luxon');
const puppeteer = require('puppeteer');
const path = require('path');
const cron = require('node-cron');
const pRetry = require('p-retry');
const winston = require('winston');
const config = require('./config');
const { startWebServer } = require('./server/webServer');

// Khởi tạo logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console()
  ]
});

// Cache Google Sheet và Puppeteer
let cachedSheet = null;
let browserInstance = null;
let configWarningLogged = false;
const SHEET_ERROR_COOLDOWN_MS = 60000;
let lastSheetErrorLogTime = 0;

/**
 * Xóa cache sheet khi thay đổi thông tin cấu hình
 */
function resetSheetCache() {
  cachedSheet = null;
  configWarningLogged = false;
}

function logSheetError(error, message = 'Lỗi truy cập Google Sheets') {
  const now = Date.now();
  if (now - lastSheetErrorLogTime >= SHEET_ERROR_COOLDOWN_MS) {
    logger.error(message, { error });
    lastSheetErrorLogTime = now;
  }
}

/**
 * Truy cập Google Sheet với retry logic
 * @param {number} [month] - Tháng cần truy cập (mặc định là tháng hiện tại)
 * @returns {Promise<GoogleSpreadsheetWorksheet>} - Sheet đã truy cập
 */
async function getSheet(month = null) {
  try {
    await ensureSheetConfigAvailable();
    configWarningLogged = false;
    if (cachedSheet && (!month || cachedSheet.month === month)) {
      return cachedSheet.sheet;
    }

    const creds = await loadCreds();
    const doc = new GoogleSpreadsheet(config.SHEET_ID);
    await pRetry(() => doc.useServiceAccountAuth({
      client_email: creds.client_email,
      private_key: creds.private_key.replace(/\\n/g, '\n')
    }), { retries: 3 });

    await doc.loadInfo();
    logger.info(`Đã tải thông tin Google Sheets: ${doc.title}`);

    const now = DateTime.now().setZone('Asia/Ho_Chi_Minh');
    const targetMonth = month || now.month;
    const sheetTitle = `T${targetMonth}`;
    const sheet = doc.sheetsByTitle[sheetTitle];

    if (!sheet) {
      throw new Error(`Sheet "${sheetTitle}" không tồn tại.`);
    }

    if (!sheet.headerValues || !arraysEqual(sheet.headerValues, config.HEADERS)) {
      await sheet.setHeaderRow(config.HEADERS);
      logger.info(`Đã thiết lập tiêu đề cho sheet: ${sheetTitle}`);
    }

    cachedSheet = { sheet, month: targetMonth };
    lastSheetErrorLogTime = 0;
    return sheet;
  } catch (error) {
    if (error && error.code === 'CONFIG_MISSING') {
      if (!configWarningLogged) {
        logger.warn(error.message);
        configWarningLogged = true;
      }
    } else {
      logSheetError(error);
    }
    throw error;
  }
}

/**
 * Kiểm tra khả năng kết nối tới Google Sheet hiện tại
 * @param {number|null} month - Tháng cần kiểm tra, mặc định tháng hiện tại
 * @returns {Promise<{sheet: {title: string, month: number}, message: string}>}
 */
async function testSheetConnection(month = null) {
  const now = DateTime.now().setZone('Asia/Ho_Chi_Minh');
  const targetMonth = month || now.month;
  const sheet = await getSheet(targetMonth);
  const sheetTitle = sheet.title || `T${targetMonth}`;
  return {
    sheet: { title: sheetTitle, month: targetMonth },
    message: `Kết nối thành công tới sheet "${sheetTitle}".`
  };
}

class ConfigMissingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigMissingError';
    this.code = 'CONFIG_MISSING';
  }
}

async function ensureSheetConfigAvailable() {
  if (!config.SHEET_ID) {
    throw new ConfigMissingError('Chưa cấu hình SHEET_ID. Vui lòng nhập Sheet ID trên dashboard.');
  }

  const hasCreds = await credentialsExist();
  if (!hasCreds) {
    throw new ConfigMissingError('Chưa có tài khoản dịch vụ Google. Vui lòng tải credentials trên dashboard.');
  }
}

/**
 * So sánh hai mảng có bằng nhau không
 * @param {Array} arr1 - Mảng thứ nhất
 * @param {Array} arr2 - Mảng thứ hai
 * @returns {boolean} - Kết quả so sánh
 */
function arraysEqual(arr1, arr2) {
  return arr1.length === arr2.length && arr1.every((val, i) => val === arr2[i]);
}

/**
 * Đọc file credentials
 * @returns {Promise<Object>} - Dữ liệu credentials
 */
async function loadCreds() {
  try {
    const data = await fs.readFile(config.SERVICE_ACCOUNT_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Không thể đọc file credentials', { error });
    throw error;
  }
}

/**
 * Lưu credentials xuống file
 * @param {{client_email: string, private_key: string}} creds
 */
async function saveCreds(creds) {
  await fs.writeFile(config.SERVICE_ACCOUNT_FILE, JSON.stringify(creds, null, 2), 'utf8');
  resetSheetCache();
}

/**
 * Kiểm tra file credentials đã tồn tại chưa
 * @returns {Promise<boolean>}
 */
async function credentialsExist() {
  try {
    await fs.access(config.SERVICE_ACCOUNT_FILE);
    return true;
  } catch {
    return false;
  }
}

/**
 * Thay thế số điện thoại bằng tên trong nội dung
 * @param {string} content - Nội dung gốc
 * @returns {string} - Nội dung đã thay thế
 */
function replacePhoneNumbersWithNames(content) {
  let updatedContent = content;
  for (const [phone, name] of Object.entries(config.phoneNameMap)) {
    updatedContent = updatedContent.replace(new RegExp(phone, 'g'), name);
  }
  return updatedContent;
}

/**
 * Trích xuất MessageID từ full ID
 * @param {string} fullId - ID đầy đủ
 * @returns {string} - MessageID
 */
function extractMessageId(fullId) {
  return fullId.split('_')[2] || fullId;
}

/**
 * Chèn tiêu đề ngày nếu chưa tồn tại
 * @param {GoogleSpreadsheetWorksheet} sheet - Sheet để chèn tiêu đề
 */
async function insertDailyHeaderIfNeeded(sheet) {
  try {
    const today = DateTime.now().setZone('Asia/Ho_Chi_Minh');
    const formattedDate = today.toFormat('dd/MM/yyyy');
    const dateHeader = `Ngày ${formattedDate}`;
    const rows = await sheet.getRows();

    if (!rows.some(row => row['Nội dung công việc'] === dateHeader)) {
      await sheet.addRow({
        'STT': '',
        'Nội dung công việc': dateHeader,
        'Người Thực Hiện': '',
        'Người Giao Việc': 'Bot',
        'Tiến Độ': '',
        'Ghi Chú': '',
        'Thời gian': today.toFormat('dd/MM/yyyy HH:mm'),
        'MessageID': `HEADER_${today.toISODate()}`
      });
      await fs.writeFile('./lastInsertedDate.txt', formattedDate, 'utf8');
      logger.info(`Đã chèn tiêu đề ngày: ${dateHeader}`);
    }
  } catch (error) {
    logger.error('Lỗi khi chèn tiêu đề ngày', { error });
  }
}

/**
 * Lấy instance Puppeteer
 * @returns {Promise<Puppeteer.Browser>} - Instance trình duyệt
 */
async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  }
  return browserInstance;
}

/**
 * Tạo HTML cho báo cáo
 * @param {Array} rows - Dữ liệu hàng
 * @param {string} title - Tiêu đề báo cáo
 * @returns {string} - Nội dung HTML
 */
function generateReportHTML(rows, title) {
  let htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #2c3e50; text-align: left; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px; white-space: pre-wrap; word-wrap: break-word; }
        th { background-color: #3498db; color: white; }
        tr:nth-child(even) { background-color: #f2f2f2; }
        .col-stt { text-align: center; width: 3%; }
        .col-content { text-align: left; width: 50%; }
        .col-assignee { text-align: left; width: 10%; font-weight: bold; }
        .col-assigner { text-align: center; width: 8%; }
        .col-progress { text-align: center; width: 10%; font-weight: bold; }
        .col-note { text-align: left; width: 25%; }
        .progress-incomplete { color: red; }
        .progress-complete { color: black; }
        .red-bold { color: red; font-weight: bold; }
      </style>
    </head>
    <body>
      <h1>${title}</h1>
      <table>
        <tr>
          <th class="col-stt">STT</th>
          <th class="col-content">Nội dung công việc</th>
          <th class="col-assignee">Người Thực Hiện</th>
          <th class="col-assigner">Người Giao Việc</th>
          <th class="col-progress">Tiến Độ</th>
          <th class="col-note">Ghi Chú</th>
        </tr>
  `;

  rows.forEach((row, index) => {
    const stt = index + 1;
    let content = replacePhoneNumbersWithNames(row['Nội dung công việc'] || '').replace(/\n/g, '<br>');
    let note = row['Ghi Chú']?.replace(/\n/g, '<br>') || '';
    note = note.replace(/(Gửi|Gui)\s*HCM/gi, '<span class="red-bold">$1 HCM</span>');
    const progressClass = row['Tiến Độ'] === 'Hoàn Thành' ? 'progress-complete' : 'progress-incomplete';

    htmlContent += `
      <tr>
        <td class="col-stt">${stt}</td>
        <td class="col-content">${content}</td>
        <td class="col-assignee">${row['Người Thực Hiện'] || ''}</td>
        <td class="col-assigner">${row['Người Giao Việc'] || ''}</td>
        <td class="col-progress ${progressClass}">${row['Tiến Độ'] || ''}</td>
        <td class="col-note">${note}</td>
      </tr>
    `;
  });

  htmlContent += `</table></body></html>`;
  return htmlContent;
}

/**
 * Lọc dữ liệu báo cáo dựa trên loại báo cáo
 * @param {Array} rows - Danh sách hàng từ Google Sheet
 * @param {DateTime} date - Ngày cần lọc
 * @param {'daily'|'tomorrow'} reportType - Loại báo cáo
 * @returns {Array} - Danh sách hàng đã lọc
 */
function filterRowsForReport(rows, date, reportType) {
  const formattedDate = date.toFormat('dd/MM/yyyy');

  if (reportType === 'daily') {
    return rows.filter(row =>
      row['Nội dung công việc'] !== `Ngày ${formattedDate}` &&
      row['Thời gian']?.startsWith(formattedDate) &&
      (row['Tiến Độ'] === 'Chưa Hoàn Thành' || row['Tiến Độ'] === 'Hoàn Thành')
    );
  }

  return rows.filter(row =>
    row['Thời gian']?.startsWith(formattedDate) &&
    row['Nội dung công việc'] &&
    !row['Nội dung công việc'].match(/^Ngày\s/) &&
    row['Tiến Độ'] !== 'Hoàn Thành'
  );
}

/**
 * Tạo báo cáo và lưu thành ảnh
 * @param {GoogleSpreadsheetWorksheet} sheet - Sheet Google
 * @param {DateTime} date - Ngày báo cáo
 * @param {string} reportType - Loại báo cáo ('daily' hoặc 'tomorrow')
 * @param {string} titlePrefix - Tiêu đề báo cáo
 * @returns {Promise<string|null>} - Đường dẫn file ảnh
 */
async function generateReport(sheet, date, reportType, titlePrefix) {
  try {
    const formattedDate = date.toFormat('dd/MM/yyyy');
    const rows = await sheet.getRows();
    const filteredRows = filterRowsForReport(rows, date, reportType);

    if (filteredRows.length === 0) {
      logger.warn(`Không có dữ liệu cho ${reportType} báo cáo ngày ${formattedDate}`);
      return null;
    }

    const htmlContent = generateReportHTML(filteredRows, `${titlePrefix} - ${formattedDate}`);
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setContent(htmlContent);
    await page.setViewport({ width: 1280, height: 800 });

    const reportDir = './reports';
    await fs.mkdir(reportDir, { recursive: true });
    const imagePath = path.join(reportDir, `${reportType}_${date.toFormat('yyyyMMdd')}.png`);

    await page.screenshot({ path: imagePath, fullPage: true });
    await page.close();
    logger.info(`Đã tạo ${reportType} báo cáo tại: ${imagePath}`);
    return imagePath;
  } catch (error) {
    logger.error(`Lỗi khi tạo ${reportType} báo cáo`, { error });
    return null;
  }
}



/**
 * Gửi báo cáo qua WhatsApp
 * @param {string} chatId - ID của chat
 * @param {string} imagePath - Đường dẫn file ảnh
 * @param {string} caption - Chú thích
 */
async function sendReport(chatId, imagePath, caption) {
  try {
    if (!imagePath) return;
    const media = await MessageMedia.fromFilePath(imagePath);
    const chat = await client.getChatById(chatId);
    await chat.sendMessage(media, { caption });
    logger.info(`Đã gửi báo cáo tới ${chatId} với caption: ${caption}`);
  } catch (error) {
    logger.error(`Lỗi khi gửi báo cáo tới ${chatId}`, { error });
  }
}

/**
 * Lên lịch công việc ngày mai
 * @param {GoogleSpreadsheetWorksheet} sheet - Sheet Google
 */
async function scheduleTasksForTomorrow(sheet) {
  try {
    const today = DateTime.now().setZone('Asia/Ho_Chi_Minh').startOf('day');
    const tomorrow = today.plus({ days: 1 });
    const formattedDateTomorrow = tomorrow.toFormat('dd/MM/yyyy');

    const rows = await sheet.getRows();
    const tasksToCopy = rows.filter(row => {
      if (!row['Thời gian']) return false;
      const rowDate = DateTime.fromFormat(row['Thời gian'], 'dd/MM/yyyy HH:mm', { zone: 'Asia/Ho_Chi_Minh' });
      return rowDate.isValid &&
        rowDate.startOf('day').equals(today) &&
        row['Nội dung công việc'] &&
        !row['Nội dung công việc'].match(/^Ngày\s/) &&
        (row['Tiến Độ'] !== 'Hoàn Thành');
    });

    if (tasksToCopy.length === 0) {
      logger.warn('Không có công việc để sao chép sang ngày mai');
      return;
    }

    const tomorrowHeader = `Ngày ${formattedDateTomorrow}`;
    if (!rows.some(row => row['Nội dung công việc'] === tomorrowHeader)) {
      await sheet.addRow({
        'STT': '',
        'Nội dung công việc': tomorrowHeader,
        'Người Thực Hiện': '',
        'Người Giao Việc': 'Bot',
        'Tiến Độ': '',
        'Ghi Chú': '',
        'Thời gian': tomorrow.toFormat('dd/MM/yyyy HH:mm'),
        'MessageID': `HEADER_${tomorrow.toISODate()}`
      });
      logger.info(`Đã chèn tiêu đề ngày mai: ${tomorrowHeader}`);
    }

    const newRows = tasksToCopy.map(task => ({
      'STT': '',
      'Nội dung công việc': task['Nội dung công việc'],
      'Người Thực Hiện': task['Người Thực Hiện'],
      'Người Giao Việc': task['Người Giao Việc'],
      'Tiến Độ': task['Tiến Độ'] || '',
      'Ghi Chú': task['Ghi Chú'],
      'Thời gian': tomorrow.toFormat('dd/MM/yyyy HH:mm'),
      'MessageID': `TOMORROW_${task['MessageID']}`
    }));

    await sheet.addRows(newRows);
    logger.info(`Đã sao chép ${newRows.length} công việc sang ngày mai`);
  } catch (error) {
    logger.error('Lỗi khi lên lịch công việc ngày mai', { error });
  }
}

/**
 * Lấy tất cả tin nhắn từ nhóm
 * @param {GoogleSpreadsheetWorksheet} sheet - Sheet Google
 */
async function fetchAllGroupMessages(sheet) {
  try {
    await insertDailyHeaderIfNeeded(sheet);
    const now = DateTime.now().setZone('Asia/Ho_Chi_Minh');
    const startTime = now.startOf('day').plus({ hours: 6 });
    const endTime = now.startOf('day').plus({ hours: 23, minutes: 30 });

    const loggedMessageIDs = new Set((await sheet.getRows()).map(row => row.MessageID));
    const targetChat = (await client.getChats()).find(chat => chat.id._serialized.trim() === config.TARGET_GROUP_ID.trim());
    if (!targetChat) throw new Error(`Không tìm thấy nhóm: ${config.TARGET_GROUP_ID}`);

    const messages = [];
    let lastMessage = null;
    const batchSize = 500;
    const maxMessages = 2000;

    while (messages.length < maxMessages) {
      const batch = await targetChat.fetchMessages({ limit: batchSize, before: lastMessage?.id._serialized });
      if (!batch.length) break;

      messages.push(...batch.filter(m => {
        const msgTime = DateTime.fromMillis(m.timestamp * 1000).setZone('Asia/Ho_Chi_Minh');
        return msgTime >= startTime && msgTime <= endTime && m.body && m.body.trim();
      }));

      lastMessage = batch[batch.length - 1];
      if (batch.length < batchSize || DateTime.fromMillis(lastMessage.timestamp * 1000).setZone('Asia/Ho_Chi_Minh') < startTime) break;
    }

    const newRows = messages
      .filter(m => !loggedMessageIDs.has(extractMessageId(m.id._serialized)))
      .map(m => {
        const msgTime = DateTime.fromMillis(m.timestamp * 1000).setZone('Asia/Ho_Chi_Minh');
        const rawSenderID = (m.author || m.from).replace('@c.us', '');
        return {
          'STT': '',
          'Nội dung công việc': replacePhoneNumbersWithNames(m.body),
          'Người Thực Hiện': '',
          'Người Giao Việc': config.phoneNameMap[rawSenderID] || rawSenderID,
          'Tiến Độ': '',
          'Ghi Chú': '',
          'Thời gian': msgTime.toFormat('dd/MM/yyyy HH:mm'),
          'MessageID': extractMessageId(m.id._serialized)
        };
      });

    if (newRows.length > 0) {
      await sheet.addRows(newRows);
      logger.info(`Đã lưu ${newRows.length} tin nhắn mới vào Google Sheets`);
    }
  } catch (error) {
    logger.error('Lỗi khi fetch tin nhắn từ nhóm', { error });
  }
}

/**
 * Lên lịch các tác vụ cron
 * @param {GoogleSpreadsheetWorksheet} sheet - Sheet Google
 */
async function scheduleCronJobs(sheet) {
  cron.schedule('30 21 * * 0', async () => {
    logger.info('Chạy báo cáo cuối tuần');
    try {
      const now = DateTime.now().setZone('Asia/Ho_Chi_Minh');
      const sunday = now.startOf('day');
      const lastFriday = sunday.minus({ days: 2 });
      const nextMonday = sunday.plus({ days: 1 });
      const fridayFormatted = lastFriday.toFormat('dd/MM/yyyy');
      const mondayFormatted = nextMonday.toFormat('dd/MM/yyyy');

      const fridaySheet = await getSheet(lastFriday.month);
      const imagePath = await generateReport(fridaySheet, lastFriday, 'daily', 'BÁO CÁO CÔNG VIỆC');
      await sendReport(config.AUTHORIZED_PHONE_NUMBER, imagePath, `Báo cáo công việc ngày ${fridayFormatted} (Thứ Sáu)`);

      const rows = await fridaySheet.getRows();
      const incompleteTasks = rows.filter(row => {
        if (!row['Thời gian']) return false;
        const rowDate = DateTime.fromFormat(row['Thời gian'], 'dd/MM/yyyy HH:mm', { zone: 'Asia/Ho_Chi_Minh' });
        return rowDate.isValid &&
          rowDate.startOf('day').equals(lastFriday) &&
          row['Tiến Độ'] !== 'Hoàn Thành' &&
          row['Nội dung công việc'] &&
          !row['Nội dung công việc'].match(/^Ngày\s/);
      });

      if (incompleteTasks.length > 0) {
        const mondaySheet = await getSheet(nextMonday.month);
        const mondayRows = await mondaySheet.getRows();
        const mondayHeader = `Ngày ${mondayFormatted}`;
        if (!mondayRows.some(row => row['Nội dung công việc'] === mondayHeader)) {
          await mondaySheet.addRow({
            'STT': '',
            'Nội dung công việc': mondayHeader,
            'Người Thực Hiện': '',
            'Người Giao Việc': 'Bot',
            'Tiến Độ': '',
            'Ghi Chú': '',
            'Thời gian': nextMonday.toFormat('dd/MM/yyyy HH:mm'),
            'MessageID': `HEADER_${nextMonday.toISODate()}`
          });
        }

        const newRows = incompleteTasks.map(task => ({
          'STT': '',
          'Nội dung công việc': task['Nội dung công việc'],
          'Người Thực Hiện': task['Người Thực Hiện'],
          'Người Giao Việc': task['Người Giao Việc'],
          'Tiến Độ': task['Tiến Độ'] || '',
          'Ghi Chú': task['Ghi Chú'],
          'Thời gian': mondayFormatted + ' 06:00',
          'MessageID': `MONDAY_${task['MessageID']}`
        }));

        await mondaySheet.addRows(newRows);
        logger.info(`Đã lên lịch ${newRows.length} công việc từ thứ Sáu cho thứ Hai`);
      }
    } catch (error) {
      logger.error('Lỗi khi chạy báo cáo cuối tuần', { error });
    }
  }, { timezone: 'Asia/Ho_Chi_Minh' });

  cron.schedule('30 21 * * 0-4', async () => {
    logger.info('Chạy báo cáo hàng ngày');
    try {
      const now = DateTime.now().setZone('Asia/Ho_Chi_Minh');
      const sheet = await getSheet(now.month);
      const today = now.toFormat('dd/MM/yyyy');
      const tomorrow = now.plus({ days: 1 }).toFormat('dd/MM/yyyy');

      await sendReport(config.AUTHORIZED_PHONE_NUMBER, 
        await generateReport(sheet, now, 'daily', 'BÁO CÁO CÔNG VIỆC'),
        `Báo cáo công việc ngày ${today}`);
      await sendReport(config.AUTHORIZED_PHONE_NUMBER, 
        await generateReport(sheet, now.plus({ days: 1 }), 'tomorrow', 'DANH SÁCH CÔNG VIỆC NGÀY MAI'),
        `Danh sách công việc ngày mai ${tomorrow}`);
      
      const chat = await client.getChatById(config.AUTHORIZED_PHONE_NUMBER);
      await chat.sendMessage(`Đã gửi báo cáo ngày ${today} và danh sách ngày mai thành công!`);
    } catch (error) {
      logger.error('Lỗi khi chạy báo cáo hàng ngày', { error });
    }
  }, { timezone: 'Asia/Ho_Chi_Minh' });
}

// Khởi tạo WhatsApp client
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: puppeteer.executablePath()
  }
});

let initializingClient = false;

async function initializeWhatsAppClient() {
  if (initializingClient) return;
  initializingClient = true;

  try {
    logger.info('Khởi động WhatsApp client...');
    await client.initialize();
  } catch (error) {
    logger.error('Khởi động WhatsApp client thất bại, sẽ thử lại sau.', { error });
    setTimeout(() => initializeWhatsAppClient(), 5000);
  } finally {
    initializingClient = false;
  }
}

async function restartWhatsAppClient(reason) {
  logger.warn(`WhatsApp client bị ngắt kết nối (${reason || 'không rõ lý do'}). Đang khởi động lại...`);
  try {
    await client.destroy();
  } catch (destroyError) {
    logger.warn('Lỗi khi hủy client cũ trước khi khởi động lại', { error: destroyError });
  }
  setTimeout(() => initializeWhatsAppClient(), 5000);
}

client.on('qr', qr => {
  logger.info('Tạo QR code để đăng nhập WhatsApp');
  qrcode.generate(qr, { small: true });
});

client.on('disconnected', reason => {
  restartWhatsAppClient(reason);
});

client.on('auth_failure', message => {
  logger.error(`Xác thực WhatsApp thất bại: ${message}. Sẽ thử khởi động lại.`);
  restartWhatsAppClient('auth_failure');
});

client.on('ready', async () => {
  logger.info('Bot WhatsApp đã sẵn sàng');
  try {
    const sheet = await getSheet();
    await scheduleCronJobs(sheet);
  } catch (error) {
    if (error && error.code === 'CONFIG_MISSING') {
      logger.warn(`${error.message} Bỏ qua khởi động cron cho đến khi cấu hình xong.`);
      return;
    }
    logSheetError(error, 'Lỗi khi khởi động bot');
  }
});

client.on('message', async msg => {
  try {
    const chat = await msg.getChat();
    const senderId = msg.from;
    let sheet;
    try {
      sheet = await getSheet();
    } catch (error) {
      if (error && error.code === 'CONFIG_MISSING') {
        logger.warn('Bỏ qua xử lý tin nhắn vì chưa cấu hình Google Sheets.');
        if (senderId === config.AUTHORIZED_PHONE_NUMBER && msg.to === config.BOT_PHONE_NUMBER) {
          await msg.reply(error.message);
        }
        return;
      }
      throw error;
    }

    // Lưu tin nhắn từ nhóm mục tiêu
    if (chat.id._serialized.trim() === config.TARGET_GROUP_ID.trim()) {
      const now = DateTime.now().setZone('Asia/Ho_Chi_Minh');
      const startTime = now.startOf('day').plus({ hours: 6 });
      const endTime = now.startOf('day').plus({ hours: 23, minutes: 30 });
      const msgTime = DateTime.fromMillis(msg.timestamp * 1000).setZone('Asia/Ho_Chi_Minh');

      if (msgTime >= startTime && msgTime <= endTime && msg.body && msg.body.trim()) {
        await insertDailyHeaderIfNeeded(sheet);
        const rawSenderID = (msg.author || senderId).replace('@c.us', '');
        await sheet.addRow({
          'STT': '',
          'Nội dung công việc': replacePhoneNumbersWithNames(msg.body),
          'Người Thực Hiện': '',
          'Người Giao Việc': config.phoneNameMap[rawSenderID] || rawSenderID,
          'Tiến Độ': '',
          'Ghi Chú': '',
          'Thời gian': msgTime.toFormat('dd/MM/yyyy HH:mm'),
          'MessageID': extractMessageId(msg.id._serialized)
        });
        logger.info(`Đã lưu tin nhắn từ nhóm: ${msg.body}`);
      }
    }

    // Xử lý lệnh từ số được ủy quyền
    if (senderId === config.AUTHORIZED_PHONE_NUMBER && msg.to === config.BOT_PHONE_NUMBER) {
      const command = msg.body.trim();
      const reportMatch = command.match(/^!bc(\d{1,2})-(\d{1,2})$/);

      if (reportMatch) {
        const day = reportMatch[1].padStart(2, '0');
        const month = reportMatch[2].padStart(2, '0');
        const now = DateTime.now().setZone('Asia/Ho_Chi_Minh');
        const specificDate = DateTime.fromFormat(`${day}/${month}/${now.year}`, 'dd/MM/yyyy', { zone: 'Asia/Ho_Chi_Minh' });

        if (!specificDate.isValid) {
          await msg.reply('Ngày không hợp lệ! Dùng định dạng: !bcDD-MM (VD: !bc28-2)');
          return;
        }

        const targetSheet = await getSheet(specificDate.month);
        await sendReport(config.AUTHORIZED_PHONE_NUMBER, 
          await generateReport(targetSheet, specificDate, 'daily', 'BÁO CÁO CÔNG VIỆC'),
          `Báo cáo công việc ngày ${specificDate.toFormat('dd/MM/yyyy')}`);
        await msg.reply(`Đã gửi báo cáo ngày ${specificDate.toFormat('dd/MM/yyyy')} thành công!`);
        return;
      }

      switch (command.toLowerCase()) {
        case '!full':
          await fetchAllGroupMessages(sheet);
          await msg.reply('Đã lấy tất cả tin nhắn từ nhóm và lưu vào sheet!');
          break;
        case '!nhom':
          const today = DateTime.now().setZone('Asia/Ho_Chi_Minh');
          await sendReport(config.TARGET_GROUP_ID, 
            await generateReport(sheet, today, 'daily', 'BÁO CÁO CÔNG VIỆC'),
            `Báo cáo công việc ngày ${today.toFormat('dd/MM/yyyy')}`);
          await sendReport(config.TARGET_GROUP_ID, 
            await generateReport(sheet, today.plus({ days: 1 }), 'tomorrow', 'DANH SÁCH CÔNG VIỆC NGÀY MAI'),
            `Danh sách công việc ngày mai ${today.plus({ days: 1 }).toFormat('dd/MM/yyyy')}`);
          await msg.reply(`Đã gửi báo cáo và danh sách công việc vào nhóm!`);
          break;
        case '!bc':
          const now = DateTime.now().setZone('Asia/Ho_Chi_Minh');
          await sendReport(config.AUTHORIZED_PHONE_NUMBER, 
            await generateReport(sheet, now, 'daily', 'BÁO CÁO CÔNG VIỆC'),
            `Báo cáo công việc ngày ${now.toFormat('dd/MM/yyyy')}`);
          await sendReport(config.AUTHORIZED_PHONE_NUMBER, 
            await generateReport(sheet, now.plus({ days: 1 }), 'tomorrow', 'DANH SÁCH CÔNG VIỆC NGÀY MAI'),
            `Danh sách công việc ngày mai ${now.plus({ days: 1 }).toFormat('dd/MM/yyyy')}`);
          await msg.reply(`Đã gửi báo cáo và danh sách ngày mai thành công!`);
          break;
        case '!kh':
          await scheduleTasksForTomorrow(sheet);
          await msg.reply('Đã lên lịch công việc ngày mai trong sheet thành công!');
          break;
        default:
          await msg.reply('Lệnh không hợp lệ! Dùng: !full, !nhom, !bc, !kh, !bcDD-MM');
      }
    }
  } catch (error) {
    logger.error('Lỗi xử lý tin nhắn', { error });
    if (msg.from === config.AUTHORIZED_PHONE_NUMBER && msg.to === config.BOT_PHONE_NUMBER) {
      await msg.reply('Có lỗi xảy ra, vui lòng thử lại!');
    }
  }
});

startWebServer({
  config,
  logger,
  credentialsExist,
  saveCreds,
  resetSheetCache,
  ensureSheetConfigAvailable,
  getSheet,
  testSheetConnection,
  filterRowsForReport,
  generateReportHTML,
  DateTime
});

// Khởi động bot với cơ chế tự phục hồi khi phiên trình duyệt lỗi
initializeWhatsAppClient();
