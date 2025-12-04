/************************************************
 * 1) IMPORT & CẤU HÌNH CƠ BẢN
 ************************************************/
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const fs = require('fs/promises');
const { DateTime } = require('luxon');
const puppeteer = require('puppeteer');
const path = require('path');
const cron = require('node-cron');

/************************************************
 * 2) CẤU HÌNH CÁC THAM SỐ
 ************************************************/
const SHEET_ID = '1fRj-0yxdNBhArIeMFZ0gJR2o0HVFHdGP05oplSDbaOY';
const SERVICE_ACCOUNT_FILE = './botwhataap-55f0f0413dd1.json';

const HEADERS = [
  'STT',
  'Nội dung công việc',
  '_',
  'Người Thực Hiện',
  'Người Giao Việc',
  'Tiến Độ',
  'Ghi Chú',
  'Thời gian',
  'MessageID'
];

const TARGET_GROUP_ID = "120363399148489869@g.us";
const BOT_PHONE_NUMBER = '84918283236@c.us';
const AUTHORIZED_PHONE_NUMBER = '84775003236@c.us';

const phoneNameMap = {
  '84335528919': 'Xuyên',
  '130163849359563@lid': 'Ly',
  '84393835518': 'Hà',
  '84986481230': 'E Dung',
  '84979656593': 'E Tuấn',
  '132607736037469@lid': 'Biện',
  '84984920382': 'C Hân',
  '51493034025177@lid': 'E Thành',
  '223201531559986@lid': 'Dung',
  '277919230386208': 'Lee Anh',
  '84867601068': 'A Vỹ',
  '84964151628': 'Nhài',
  '84931546323': 'Hùng',
  '234385576034515@lid': 'Trường',
  '84364921368': 'Hằng',
  '168986075488504@lid': 'Nga',
  '181746490454049@lid': 'Sang',
  '84775003236': 'Người Gửi Lệnh',
  '84376937039': 'Tiến',
  '84973400890': 'Kiểm',
  '84936214486': 'Thảo',
  '84984738113': 'Cường',
  '24855562973378@lid': 'Trang',
  '165481382207555@lid': 'Toàn',
  '211291503345776@lid': 'Quân',
  '84968502040': 'Trung',
  '224541494235236@lid': 'Oanh',
  '84963529869': 'Duyên',
  
};

/************************************************
 * 3) HÀM HỖ TRỢ
 ************************************************/
function extractMessageId(fullId) {
  const parts = fullId.split('_');
  return parts[2] || fullId;
}

function replacePhoneNumbersWithNames(content) {
  let updatedContent = content;
  for (const [phone, name] of Object.entries(phoneNameMap)) {
    const regex = new RegExp(phone, 'g');
    updatedContent = updatedContent.replace(regex, name);
  }
  return updatedContent;
}

/************************************************
 * 4) KẾT NỐI GOOGLE SHEETS
 ************************************************/
async function loadCreds() {
  try {
    const data = await fs.readFile(SERVICE_ACCOUNT_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Không thể đọc file credentials: ${error.message}`);
    throw new Error(`Không thể đọc file credentials: ${error.message}`);
  }
}

async function accessSpreadsheet(month = null) {
  try {
    const creds = await loadCreds();
    const doc = new GoogleSpreadsheet(SHEET_ID);
    await doc.useServiceAccountAuth({
      client_email: creds.client_email,
      private_key: creds.private_key.replace(/\\n/g, '\n')
    });
    await doc.loadInfo();
    console.log("Đã tải thông tin Google Sheets:", doc.title);

    const now = DateTime.now().setZone('Asia/Ho_Chi_Minh');
    const targetMonth = month || now.month;
    const sheetTitle = `T${targetMonth}`;

    const sheet = doc.sheetsByTitle[sheetTitle];
    if (!sheet) {
      throw new Error(`Sheet "${sheetTitle}" không tồn tại. Vui lòng tạo sẵn sheet trong Google Sheet.`);
    }
    console.log(`Truy cập sheet: ${sheetTitle}`);

    let currentHeaders = sheet.headerValues || [];
    console.log("Tiêu đề hiện tại trong sheet:", JSON.stringify(currentHeaders));
    console.log("Tiêu đề mong đợi (HEADERS):", JSON.stringify(HEADERS));

    let needUpdate = false;
    if (!currentHeaders || currentHeaders.length === 0) {
      needUpdate = true;
      console.log("Lý do cập nhật: Tiêu đề trống hoàn toàn");
    } else if (currentHeaders.length !== HEADERS.length) {
      needUpdate = true;
      console.log(`Lý do cập nhật: Độ dài không khớp (${currentHeaders.length} != ${HEADERS.length})`);
    } else {
      for (let i = 0; i < HEADERS.length; i++) {
        if (currentHeaders[i] !== HEADERS[i]) {
          needUpdate = true;
          console.log(`Lý do cập nhật: Giá trị không khớp tại vị trí ${i}: "${currentHeaders[i]}" != "${HEADERS[i]}"`);
          break;
        }
      }
    }

    if (needUpdate) {
      await sheet.setHeaderRow(HEADERS);
      console.log(`Đã thiết lập tiêu đề cho sheet: ${sheetTitle}`);
      await sheet.loadHeaderRow();
      console.log("Tiêu đề sau khi thiết lập:", JSON.stringify(sheet.headerValues));
    } else {
      console.log("Tiêu đề đã đúng, không cần cập nhật");
    }

    return sheet;
  } catch (error) {
    console.error(`Lỗi truy cập Google Sheets: ${error.message}`);
    throw error;
  }
}

/************************************************
 * 5) HÀM QUẢN LÝ TIÊU ĐỀ VÀ NGÀY
 ************************************************/
async function saveLastInsertedDate(date) {
  await fs.writeFile('./lastInsertedDate.txt', date, 'utf8');
}

async function loadLastInsertedDate() {
  try {
    const data = await fs.readFile('./lastInsertedDate.txt', 'utf8');
    return data;
  } catch (error) {
    return null;
  }
}

async function insertDailyHeaderIfNeeded(sheet) {
  try {
    const today = DateTime.now().setZone('Asia/Ho_Chi_Minh');
    const formattedDate = today.toFormat('dd/MM/yyyy');
    const dateHeader = `Ngày ${formattedDate}`;

    const rows = await sheet.getRows();
    const headerExists = rows.some(row => row['Nội dung công việc'] === dateHeader);

    if (!headerExists) {
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
      console.log(`✅ Đã chèn tiêu đề ngày: ${dateHeader}`);
      await saveLastInsertedDate(formattedDate);
    }
  } catch (error) {
    console.error('❌ Lỗi khi chèn tiêu đề ngày:', error);
  }
}

/************************************************
 * 6) HÀM TẠO BÁO CÁO VÀ DANH SÁCH
 ************************************************/
async function generateDailyReport(sheet, specificDate = null) {
  try {
    const now = DateTime.now().setZone('Asia/Ho_Chi_Minh');
    const dateToUse = specificDate || now;
    const formattedDate = dateToUse.toFormat('dd/MM/yyyy');
    const dateHeader = `Ngày ${formattedDate}`;

    const rows = await sheet.getRows();
    const dailyRows = rows.filter(row => 
      row['Nội dung công việc'] !== dateHeader && 
      (row['Thời gian'] && row['Thời gian'].startsWith(formattedDate)) &&
      (row['Tiến Độ'] === 'Chưa Hoàn Thành' || row['Tiến Độ'] === 'Hoàn Thành')
    );

    if (dailyRows.length === 0) {
      console.log(`⚠️ Không có dữ liệu để tạo báo cáo cho ngày ${formattedDate}`);
      return null;
    }

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
        <h1>BÁO CÁO CÔNG VIỆC - ${formattedDate}</h1>
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

    dailyRows.forEach((row, index) => {
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

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(htmlContent);
    await page.setViewport({ width: 1280, height: 800 });

    const reportDir = './reports';
    await fs.mkdir(reportDir, { recursive: true });
    const imagePath = path.join(reportDir, `bao_cao_${dateToUse.toFormat('yyyyMMdd')}.png`);
    
    await page.screenshot({ path: imagePath, fullPage: true });
    await browser.close();
    console.log(`✅ Đã tạo báo cáo ảnh tại: ${imagePath}`);
    return imagePath;
  } catch (error) {
    console.error('❌ Lỗi khi tạo báo cáo:', error);
    return null;
  }
}

async function generateTomorrowReport(sheet, formattedDateTomorrow) {
  try {
    const rows = await sheet.getRows();
    const tomorrowRows = rows.filter(row => 
      row['Thời gian']?.startsWith(formattedDateTomorrow) && 
      row['Nội dung công việc'] && 
      !row['Nội dung công việc'].match(/^Ngày\s/) &&
      (row['Tiến Độ'] === 'Chưa Hoàn Thành' || !row['Tiến Độ'] || row['Tiến Độ'] === 'Bỏ') &&
      row['Tiến Độ'] !== 'Hoàn Thành'
    );

    if (tomorrowRows.length === 0) {
      console.log('⚠️ Không có công việc nào phù hợp cho ngày mai');
      return null;
    }

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
        <h1>DANH SÁCH CÔNG VIỆC NGÀY MAI - ${formattedDateTomorrow}</h1>
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

    tomorrowRows.forEach((row, index) => {
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

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(htmlContent);
    await page.setViewport({ width: 1280, height: 800 });

    const imagePath = path.join('./reports', `danh_sach_ngay_mai_${DateTime.now().plus({ days: 1 }).toFormat('yyyyMMdd')}.png`);
    await page.screenshot({ path: imagePath, fullPage: true });
    await browser.close();
    console.log(`✅ Đã tạo danh sách công việc ngày mai tại: ${imagePath}`);
    return imagePath;
  } catch (error) {
    console.error('❌ Lỗi tạo danh sách ngày mai:', error);
    return null;
  }
}

/************************************************
 * 7) HÀM GỬI BÁO CÁO VÀ DANH SÁCH
 ************************************************/
async function sendFullReport(sheet) {
  try {
    const imagePath = await generateDailyReport(sheet);
    if (!imagePath) return;

    const media = await MessageMedia.fromFilePath(imagePath);
    const today = DateTime.now().setZone('Asia/Ho_Chi_Minh').toFormat('dd/MM/yyyy');
    const groupChat = await client.getChatById(TARGET_GROUP_ID);
    
    await groupChat.sendMessage(media, {
      caption: `Báo cáo công việc ngày ${today}`
    });
    console.log('✅ Đã gửi báo cáo hôm nay vào nhóm mục tiêu');
  } catch (error) {
    console.error('❌ Lỗi gửi báo cáo:', error);
  }
}

async function sendTestReport(sheet, specificDate = null) {
  try {
    const dateToUse = specificDate || DateTime.now().setZone('Asia/Ho_Chi_Minh');
    const imagePath = await generateDailyReport(sheet, dateToUse);
    if (!imagePath) return;

    const media = await MessageMedia.fromFilePath(imagePath);
    const myPhone = AUTHORIZED_PHONE_NUMBER;
    const chat = await client.getChatById(myPhone);
    
    await chat.sendMessage(media, {
      caption: `Báo cáo công việc ngày ${dateToUse.toFormat('dd/MM/yyyy')}`
    });
    console.log(`✅ Đã gửi báo cáo ngày ${dateToUse.toFormat('dd/MM/yyyy')} cho bạn (số ${myPhone})`);
  } catch (error) {
    console.error('❌ Lỗi gửi báo cáo thử nghiệm:', error);
  }
}

async function sendTomorrowTasks(sheet) {
  try {
    const tomorrow = DateTime.now().setZone('Asia/Ho_Chi_Minh').plus({ days: 1 });
    const formattedDateTomorrow = tomorrow.toFormat('dd/MM/yyyy');
    const imagePath = await generateTomorrowReport(sheet, formattedDateTomorrow);
    if (!imagePath) return;

    const media = await MessageMedia.fromFilePath(imagePath);
    const groupChat = await client.getChatById(TARGET_GROUP_ID);
    
    await groupChat.sendMessage(media, {
      caption: `Danh sách công việc ngày mai ${formattedDateTomorrow}`
    });
    console.log('✅ Đã gửi danh sách công việc ngày mai vào nhóm');
  } catch (error) {
    console.error('❌ Lỗi gửi danh sách công việc ngày mai:', error);
  }
}

async function sendTestTomorrowTasks(sheet) {
  try {
    const tomorrow = DateTime.now().setZone('Asia/Ho_Chi_Minh').plus({ days: 1 });
    const formattedDateTomorrow = tomorrow.toFormat('dd/MM/yyyy');
    const imagePath = await generateTomorrowReport(sheet, formattedDateTomorrow);
    if (!imagePath) return;

    const media = await MessageMedia.fromFilePath(imagePath);
    const myPhone = AUTHORIZED_PHONE_NUMBER;
    const chat = await client.getChatById(myPhone);
    
    await chat.sendMessage(media, {
      caption: `Danh sách công việc ngày mai ${formattedDateTomorrow}`
    });
    console.log(`✅ Đã gửi danh sách công việc ngày mai cho bạn (số ${myPhone})`);
  } catch (error) {
    console.error('❌ Lỗi gửi danh sách ngày mai thử nghiệm:', error);
  }
}

/************************************************
 * 8) HÀM QUẢN LÝ CÔNG VIỆC NGÀY MAI
 ************************************************/
async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scheduleTasksForTomorrow(sheet) {
  try {
    const today = DateTime.now().setZone('Asia/Ho_Chi_Minh').startOf('day');
    const tomorrow = today.plus({ days: 1 }).startOf('day');
    const formattedDateToday = today.toFormat('dd/MM/yyyy');
    const formattedDateTomorrow = tomorrow.toFormat('dd/MM/yyyy');
    
    const allRows = await sheet.getRows();
    
    // Lấy các công việc cần sao chép
    const tasksToCopy = allRows.filter(row => {
      if (!row['Thời gian']) return false;
      const rowDate = DateTime.fromFormat(row['Thời gian'], 'dd/MM/yyyy HH:mm', { zone: 'Asia/Ho_Chi_Minh' });
      if (!rowDate.isValid) return false;

      const isToday = rowDate.startOf('day').equals(today);
      return isToday && 
             row['Nội dung công việc'] && 
             !row['Nội dung công việc'].match(/^Ngày\s/) &&
             (row['Tiến Độ'] === 'Chưa Hoàn Thành' || !row['Tiến Độ'] || row['Tiến Độ'] === 'Bỏ');
    });

    if (tasksToCopy.length === 0) {
      console.log('⚠️ Không có công việc nào cần sao chép từ ngày hôm nay sang ngày mai');
      return;
    }

    // Kiểm tra và thêm tiêu đề ngày mai nếu chưa có
    const tomorrowHeader = `Ngày ${formattedDateTomorrow}`;
    const hasTomorrowHeader = allRows.some(row => row['Nội dung công việc'] === tomorrowHeader);
    if (!hasTomorrowHeader) {
      await sheet.addRow({
        'STT': '',
        'Nội dung công việc': tomorrowHeader,
        'Người Thực Hiện': '',
        'Người Giao Việc': 'Bot',
        'Tiến Độ': '', // Tiêu đề để trống
        'Ghi Chú': '',
        'Thời gian': tomorrow.toFormat('dd/MM/yyyy HH:mm'),
        'MessageID': `HEADER_${tomorrow.toISODate()}`
      });
      console.log(`✅ Đã chèn tiêu đề ngày mai: ${tomorrowHeader}`);
    }

    // Chuẩn bị danh sách công việc mới để thêm vào ngày mai
    const newRows = tasksToCopy.map(task => ({
      'STT': '',
      'Nội dung công việc': task['Nội dung công việc'],
      'Người Thực Hiện': task['Người Thực Hiện'],
      'Người Giao Việc': task['Người Giao Việc'],
      'Tiến Độ': task['Tiến Độ'] || '', // Giữ nguyên Tiến Độ
      'Ghi Chú': task['Ghi Chú'],
      'Thời gian': tomorrow.toFormat('dd/MM/yyyy HH:mm'),
      'MessageID': `TOMORROW_${task['MessageID']}`
    }));

    // Thêm tất cả công việc mới vào ngày mai
    if (newRows.length > 0) {
      await sheet.addRows(newRows);
      console.log(`✅ Đã sao chép ${newRows.length} công việc từ ngày hôm nay sang ngày mai`);
    }

    // **ĐÃ BỎ PHẦN XÓA CÔNG VIỆC TẠI ĐÂY**
    // (Không còn tính năng xóa những dòng có Tiến Độ trống hoặc "Bỏ")
  } catch (error) {
    console.error('❌ Lỗi khi lên lịch công việc ngày mai:', error);
  }
}

/************************************************
 * 9) HÀM FETCH TIN NHẮN TỪ NHÓM
 ************************************************/
async function fetchAllGroupMessages(sheet) {
  try {
    await insertDailyHeaderIfNeeded(sheet);

    const now = DateTime.now().setZone('Asia/Ho_Chi_Minh');
    const startTime = now.startOf('day').plus({ hours: 6 });
    const endTime = now.startOf('day').plus({ hours: 23, minutes: 30 });

    const existingRows = await sheet.getRows();
    const loggedMessageIDs = new Set(existingRows.map(row => row.MessageID));

    const chats = await client.getChats();
    const targetChat = chats.find(chat => chat.id._serialized.trim() === TARGET_GROUP_ID.trim());
    if (!targetChat) {
      console.log('❌ Không tìm thấy nhóm mục tiêu với ID:', TARGET_GROUP_ID);
      return;
    }
    console.log('✅ Đã tìm thấy nhóm:', targetChat.name, '-', targetChat.id._serialized);

    let allMessages = [];
    let lastMessage = null;
    let fetching = true;
    const maxMessages = 2000;

    while (fetching) {
      const options = { limit: 500 };
      if (lastMessage) options.before = lastMessage.id._serialized;
      const messages = await targetChat.fetchMessages(options);
      if (!messages || messages.length === 0) break;

      const todayMessages = messages.filter(m => {
        const msgTime = DateTime.fromMillis(m.timestamp * 1000).setZone('Asia/Ho_Chi_Minh');
        return msgTime >= startTime && msgTime <= endTime;
      });

      if (todayMessages.length > 0) {
        allMessages = allMessages.concat(todayMessages);
        if (allMessages.length >= maxMessages) {
          console.log(`Đã đạt giới hạn ${maxMessages} tin nhắn, dừng fetch.`);
          break;
        }
      }

      const lastMsgTime = DateTime.fromMillis(messages[messages.length - 1].timestamp * 1000).setZone('Asia/Ho_Chi_Minh');
      if (lastMsgTime < startTime || messages.length < 500) fetching = false;

      lastMessage = messages[messages.length - 1];
    }
    console.log(`✅ Đã fetch được ${allMessages.length} tin nhắn từ nhóm mục tiêu trong ngày hôm nay.`);

    const newRows = [];
    for (const message of allMessages) {
      const msgTime = DateTime.fromMillis(message.timestamp * 1000).setZone('Asia/Ho_Chi_Minh');
      if (msgTime >= startTime && msgTime <= endTime && message.body && message.body.trim() !== "") {
        if (!loggedMessageIDs.has(extractMessageId(message.id._serialized))) {
          const senderId = message.author || "";
          const rawSenderID = senderId.replace('@c.us', '');
          const mappedName = phoneNameMap[rawSenderID] || rawSenderID;
          const updatedContent = replacePhoneNumbersWithNames(message.body);

          newRows.push({
            'STT': '',
            'Nội dung công việc': updatedContent,
            'Người Thực Hiện': '',
            'Người Giao Việc': mappedName,
            'Tiến Độ': '',
            'Ghi Chú': '',
            'Thời gian': msgTime.toFormat('dd/MM/yyyy HH:mm'),
            'MessageID': extractMessageId(message.id._serialized)
          });
          console.log('Đã thêm tin nhắn mới:', updatedContent);
        }
      }
    }

    if (newRows.length > 0) {
      await sheet.addRows(newRows);
      console.log(`✅ Đã lưu ${newRows.length} tin nhắn mới vào Google Sheets.`);
    }

    console.log('✅ Đã fetch và lưu xong tất cả tin nhắn trong khoảng 6h - 23h30 của ngày hôm nay.');
  } catch (err) {
    console.error('❌ Lỗi khi fetch tin nhắn từ nhóm:', err);
  }
}

/************************************************
 * 10) KHỞI TẠO VÀ LÊN LỊCH BOT
 ************************************************/
const client = new Client({
  authStrategy: new LocalAuth()
});

client.on('qr', (qr) => {
  console.log('QRCode để đăng nhập WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('✅ Bot WhatsApp đã sẵn sàng!');
  try {
    const sheet = await accessSpreadsheet();
    console.log('✅ Đã truy cập sheet theo tháng hiện tại');
  } catch (err) {
    console.error('❌ Lỗi khi khởi động bot:', err);
  }

  // Lên lịch chạy vào 21:30 Chủ Nhật hàng tuần
  cron.schedule('30 21 * * 0', async () => {
    console.log('✅ Bắt đầu tạo báo cáo cuối tuần và lên lịch cho thứ Hai...');
    try {
      const now = DateTime.now().setZone('Asia/Ho_Chi_Minh');
      const sunday = now.startOf('day');

      const lastFriday = sunday.minus({ days: 2 });
      const fridayFormatted = lastFriday.toFormat('dd/MM/yyyy');

      const nextMonday = sunday.plus({ days: 1 });
      const mondayFormatted = nextMonday.toFormat('dd/MM/yyyy');

      const fridayMonth = lastFriday.month;
      const sheet = await accessSpreadsheet(fridayMonth);

      console.log(`Tạo báo cáo cho ngày ${fridayFormatted}...`);
      const fridayReportImage = await generateDailyReport(sheet, lastFriday);
      if (fridayReportImage) {
        const media = await MessageMedia.fromFilePath(fridayReportImage);
        const myPhone = AUTHORIZED_PHONE_NUMBER;
        const chat = await client.getChatById(myPhone);
        await chat.sendMessage(media, {
          caption: `Báo cáo công việc ngày ${fridayFormatted} (Thứ Sáu)`
        });
        console.log(`✅ Đã gửi báo cáo ngày ${fridayFormatted} cho bạn (số ${myPhone})`);
      } else {
        console.log(`⚠️ Không có dữ liệu để tạo báo cáo cho ngày ${fridayFormatted}`);
      }

      console.log(`Lên lịch công việc từ ${fridayFormatted} cho ngày ${mondayFormatted}...`);
      const rows = await sheet.getRows();
      const incompleteFridayTasks = rows.filter(row => {
        if (!row['Thời gian']) return false;
        const rowDate = DateTime.fromFormat(row['Thời gian'], 'dd/MM/yyyy HH:mm', { zone: 'Asia/Ho_Chi_Minh' });
        if (!rowDate.isValid) return false;

        const isFriday = rowDate.startOf('day').equals(lastFriday);
        return isFriday && 
               row['Tiến Độ'] !== 'Hoàn Thành' && 
               row['Nội dung công việc'] && 
               !row['Nội dung công việc'].match(/^Ngày\s/);
      });

      if (incompleteFridayTasks.length > 0) {
        const mondayMonth = nextMonday.month;
        const mondaySheet = await accessSpreadsheet(mondayMonth);
        const mondayRows = await mondaySheet.getRows();
        const mondayHeader = `Ngày ${mondayFormatted}`;
        const hasMondayHeader = mondayRows.some(row => row['Nội dung công việc'] === mondayHeader);
        if (!hasMondayHeader) {
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
          console.log(`✅ Đã chèn tiêu đề ngày thứ Hai: ${mondayHeader}`);
        }

        const newRows = incompleteFridayTasks.map(task => ({
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
        console.log(`✅ Đã lên lịch ${newRows.length} công việc chưa hoàn thành từ thứ Sáu cho thứ Hai`);
      } else {
        console.log(`⚠️ Không có công việc chưa hoàn thành nào từ ngày ${fridayFormatted} để lên lịch cho ${mondayFormatted}`);
      }
    } catch (error) {
      console.error('❌ Lỗi khi tạo báo cáo cuối tuần và lên lịch:', error);
    }
  }, {
    timezone: 'Asia/Ho_Chi_Minh'
  });

  // Lên lịch gửi báo cáo tự động vào 21:30 từ Thứ Hai đến Thứ Năm và Chủ Nhật
  cron.schedule('30 21 * * 0-4', async () => {
    console.log('✅ Bắt đầu gửi báo cáo tự động cho bạn lúc 21:30...');
    try {
      const now = DateTime.now().setZone('Asia/Ho_Chi_Minh');
      const today = now.startOf('day');
      const formattedDateToday = today.toFormat('dd/MM/yyyy');
      const sheet = await accessSpreadsheet(now.month);

      console.log(`Gửi báo cáo cho ngày ${formattedDateToday}...`);
      await sendTestReport(sheet);

      console.log(`Gửi danh sách công việc cho ngày mai...`);
      await sendTestTomorrowTasks(sheet);

      const myPhone = AUTHORIZED_PHONE_NUMBER;
      const chat = await client.getChatById(myPhone);
      await chat.sendMessage(`Đã gửi báo cáo cho ngày ${formattedDateToday} và danh sách ngày mai cho bạn thành công!`);
      console.log(`✅ Hoàn tất gửi báo cáo và danh sách công việc ngày mai lúc 21:30`);
    } catch (error) {
      console.error('❌ Lỗi khi gửi báo cáo tự động:', error);
    }
  }, {
    timezone: 'Asia/Ho_Chi_Minh'
  });
});

/************************************************
 * 11) XỬ LÝ TIN NHẮN
 ************************************************/
client.on('message', async (msg) => {
  try {
    const chat = await msg.getChat();
    const senderId = msg.from;

    const sheet = await accessSpreadsheet();

    // 1. Nếu tin nhắn đến từ nhóm mục tiêu, lưu vào Google Sheet (6h-23h30)
    if (chat.id._serialized.trim() === TARGET_GROUP_ID.trim()) {
      const now = DateTime.now().setZone('Asia/Ho_Chi_Minh');
      const startTime = now.startOf('day').plus({ hours: 6 });
      const endTime = now.startOf('day').plus({ hours: 23, minutes: 30 });
      const msgTime = DateTime.fromMillis(msg.timestamp * 1000).setZone('Asia/Ho_Chi_Minh');

      if (msgTime >= startTime && msgTime <= endTime && msg.body && msg.body.trim() !== "") {
        console.log('Tin nhắn mới từ nhóm mục tiêu:', msg.body);
        await insertDailyHeaderIfNeeded(sheet);

        const rawSenderID = (msg.author || senderId).replace('@c.us', '');
        const mappedName = phoneNameMap[rawSenderID] || rawSenderID;
        const updatedContent = replacePhoneNumbersWithNames(msg.body);

        await sheet.addRow({
          'STT': '',
          'Nội dung công việc': updatedContent,
          'Người Thực Hiện': '',
          'Người Giao Việc': mappedName,
          'Tiến Độ': '',
          'Ghi Chú': '',
          'Thời gian': msgTime.toFormat('dd/MM/yyyy HH:mm'),
          'MessageID': extractMessageId(msg.id._serialized)
        });
        console.log('Đã lưu tin nhắn mới:', updatedContent);
      }
    }

    // 2. Nếu tin nhắn từ số được ủy quyền -> các lệnh điều khiển bot
    if (senderId === AUTHORIZED_PHONE_NUMBER && msg.to === BOT_PHONE_NUMBER) {
      const command = msg.body.trim();

      // Lệnh tạo báo cáo cho ngày tùy chọn (!bcDD-MM)
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

        const targetMonth = specificDate.month;
        const targetSheet = await accessSpreadsheet(targetMonth);
        await sendTestReport(targetSheet, specificDate);
        await msg.reply(`Đã gửi báo cáo ngày ${specificDate.toFormat('dd/MM/yyyy')} cho bạn thành công!`);
        return;
      }

      // Xử lý các lệnh khác
      switch (command.toLowerCase()) {
        case '!full':
          await fetchAllGroupMessages(sheet);
          await msg.reply('Đã lấy tất cả tin nhắn từ nhóm và lưu vào sheet thành công!');
          break;

        case '!nhom':
          await sendFullReport(sheet);
          await sendTomorrowTasks(sheet);
          await msg.reply(`Đã gửi báo cáo cho ngày ${DateTime.now().setZone('Asia/Ho_Chi_Minh').toFormat('dd/MM/yyyy')} và danh sách công việc ngày mai vào nhóm thành công!`);
          break;

        case '!bc':
          await sendTestReport(sheet);
          await sendTestTomorrowTasks(sheet);
          await msg.reply(`Đã gửi báo cáo cho ngày ${DateTime.now().setZone('Asia/Ho_Chi_Minh').toFormat('dd/MM/yyyy')} và danh sách ngày mai cho bạn thành công!`);
          break;

        case '!kh':
          await scheduleTasksForTomorrow(sheet);
          await msg.reply('Đã lên lịch công việc ngày mai trong sheet thành công (đã bỏ tính năng xóa)!');
          break;

        default:
          await msg.reply('Lệnh không hợp lệ! Dùng: !full, !nhom, !bc, !kh, !bcDD-MM');
          break;
      }
    }
  } catch (error) {
    console.error('❌ Lỗi xử lý tin nhắn:', error);
    if (msg.from === AUTHORIZED_PHONE_NUMBER && msg.to === BOT_PHONE_NUMBER) {
      await msg.reply('Có lỗi xảy ra, vui lòng thử lại!');
    }
  }
});

/************************************************
 * 12) KHỞI ĐỘNG BOT
 ************************************************/
client.initialize();
