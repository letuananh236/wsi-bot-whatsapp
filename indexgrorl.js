/************************************************
 * 1) IMPORT & CẤU HÌNH CƠ BẢN
 ************************************************/
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const fs = require('fs/promises');
const { DateTime } = require('luxon');

// Thay ID Google Sheets (phần nằm trong URL)
const SHEET_ID = '1fRj-0yxdNBhArIeMFZ0gJR2o0HVFHdGP05oplSDbaOY';
// Đường dẫn file JSON service account
const SERVICE_ACCOUNT_FILE = './botwhataap-55f0f0413dd1.json';

// Mảng tiêu đề cho sheet (đã thêm cột MessageID ở cuối)
const HEADERS = [
  'STT',
  'Nội dung công việc',
  '',
  'Người Thực Hiện',
  'Người Giao Việc',
  'Tiến Độ',
  'Ghi Chú',
  'Thời gian',
  'MessageID'
];

// ID nhóm mục tiêu – đây là nhóm "BÁO GIAO HÀNG BÁO LỖI"
const TARGET_GROUP_ID = "120363399148489869@g.us";

/************************************************
 * 2) TẠO MAP TỪ SỐ ĐIỆN THOẠI -> TÊN NGƯỜI DÙNG
 ************************************************/
const phoneNameMap = {
  '84335528919': 'Xuyên',
  '84984183573': 'Ly',
  '84393835518': 'Hà',
  '84986481230': 'E Dung',
  '84979656593': 'E Tuấn',
  '84333355056': 'Biện',
  '84984920382': 'C Hân',
  '84339869149': 'E Thành',
  '84989781705': 'C Liên',
};

/************************************************
 * 3) HÀM ĐỌC FILE JSON SERVICE ACCOUNT
 ************************************************/
async function loadCreds() {
  const data = await fs.readFile(SERVICE_ACCOUNT_FILE, 'utf8');
  return JSON.parse(data);
}

/************************************************
 * 4) KẾT NỐI GOOGLE SHEETS
 ************************************************/
let doc; // Bộ nhớ đệm để chỉ load 1 lần
async function accessSpreadsheet() {
  if (!doc) {
    const creds = await loadCreds();
    doc = new GoogleSpreadsheet(SHEET_ID);
    await doc.useServiceAccountAuth({
      client_email: creds.client_email,
      private_key: creds.private_key.replace(/\\n/g, '\n')
    });
    await doc.loadInfo();
    console.log("Đã tải thông tin Google Sheets:", doc.title);
  }
  return doc.sheetsByIndex[0];
}

/************************************************
 * 4.1) HÀM TRỎ GIÁ TRỊ PHẦN THỨ 3 CỦA MESSAGEID
 ************************************************/
function extractMessageId(fullId) {
  const parts = fullId.split('_');
  return parts[2] || fullId;
}

/************************************************
 * 5) KHỞI TẠO BOT WHATSAPP
 ************************************************/
const client = new Client({
  authStrategy: new LocalAuth()
});

/************************************************
 * 6) SỰ KIỆN QUÉT QR
 ************************************************/
client.on('qr', (qr) => {
  console.log('QRCode để đăng nhập WhatsApp:');
  qrcode.generate(qr, { small: true });
});

/************************************************
 * 7) HÀM LƯU VÀ LOAD NGÀY CUỐI CÙNG CHÈN TIÊU ĐỀ
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

/************************************************
 * 8) HÀM KIỂM TRA VÀ CHÈN TIÊU ĐỀ NGÀY
 ************************************************/
async function insertDailyHeaderIfNeeded(sheet) {
  try {
    const today = DateTime.now().setZone('Asia/Ho_Chi_Minh');
    const formattedDate = today.toFormat('dd/MM/yyyy');
    const dateHeader = `Ngày ${formattedDate}`;

    // Load ngày cuối cùng đã chèn từ file
    let loadedDate = await loadLastInsertedDate();
    if (loadedDate !== formattedDate) {
      const rows = await sheet.getRows();
      const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;

      if (!lastRow || lastRow['Nội dung công việc'] !== dateHeader) {
        await sheet.addRow({
          'STT': '',
          'Nội dung công việc': dateHeader,
          'Người Thực Hiện': '',
          'Người Giao Việc': 'Bot',
          'Tiến Độ': '',
          'Ghi Chú': '',
          'Thời gian': today.toFormat('dd/MM/yyyy HH:mm'), // Cập nhật định dạng thời gian
          'MessageID': `HEADER_${today.toISODate()}`
        });
        console.log(`✅ Đã chèn tiêu đề ngày: ${dateHeader}`);
      }
      await saveLastInsertedDate(formattedDate);
    }
  } catch (error) {
    console.error('❌ Lỗi khi chèn tiêu đề ngày:', error);
  }
}

/************************************************
 * 9) HÀM CẬP NHẬT SỐ THỨ TỰ (STT) SAU MỖI TIÊU ĐỀ NGÀY
 ************************************************/
async function updateSerialNumbers(sheet) {
  const rows = await sheet.getRows();
  let currentStt = 1;
  let isAfterHeader = false;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row['Nội dung công việc'] && row['Nội dung công việc'].startsWith('Ngày')) {
      row.STT = '';
      isAfterHeader = true;
      currentStt = 1;
    } else if (isAfterHeader) {
      row.STT = currentStt;
      currentStt++;
    } else {
      row.STT = '';
    }
    await row.save();
  }
}

/************************************************
 * 10) BOT SẴN SÀNG & CẬP NHẬT TIÊU ĐỀ GOOGLE SHEETS
 ************************************************/
client.on('ready', async () => {
  console.log('✅ Bot WhatsApp đã sẵn sàng!');
  try {
    const sheet = await accessSpreadsheet();
    const currentHeaders = sheet.headerValues;
    let needUpdate = false;
    if (!currentHeaders || currentHeaders.length !== HEADERS.length) {
      needUpdate = true;
    } else {
      for (let i = 0; i < HEADERS.length; i++) {
        if (currentHeaders[i] !== HEADERS[i]) {
          needUpdate = true;
          break;
        }
      }
    }
    if (needUpdate) {
      await sheet.setHeaderRow(HEADERS);
      console.log('✅ Đã thiết lập (hoặc ghi đè) tiêu đề cho sheet.');
    } else {
      console.log('⚠️ Tiêu đề sheet đã đúng, không cần ghi đè.');
    }
    await fetchAllGroupMessages(sheet);
  } catch (err) {
    console.error('❌ Lỗi thiết lập tiêu đề:', err);
  }
});

/************************************************
 * 11) HÀM FETCH TẤT CẢ TIN NHẮN TỪ NHÓM MỤC TIÊU
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
    const targetChat = chats.find(chat => 
      chat.id._serialized.trim() === TARGET_GROUP_ID.trim()
    );
    if (!targetChat) {
      console.log('❌ Không tìm thấy nhóm mục tiêu với ID:', TARGET_GROUP_ID);
      return;
    }
    console.log('✅ Đã tìm thấy nhóm:', targetChat.name, '-', targetChat.id._serialized);

    let allMessages = [];
    let lastMessage = null;
    let fetching = true;
    while (fetching) {
      const options = { limit: 100 };
      if (lastMessage) {
        options.before = lastMessage.id._serialized;
      }
      const messages = await targetChat.fetchMessages(options);
      if (!messages || messages.length === 0) break;

      if (messages[messages.length - 1].timestamp * 1000 < startTime.toMillis()) {
        const validMessages = messages.filter(m => (m.timestamp * 1000) >= startTime.toMillis());
        allMessages = allMessages.concat(validMessages);
        break;
      } else {
        allMessages = allMessages.concat(messages);
        lastMessage = messages[messages.length - 1];
        if (messages.length < 100) break;
      }
    }
    console.log(`✅ Đã fetch được ${allMessages.length} tin nhắn từ nhóm mục tiêu.`);

    for (const message of allMessages) {
      const msgTime = DateTime.fromMillis(message.timestamp * 1000).setZone('Asia/Ho_Chi_Minh');
      if (msgTime >= startTime && msgTime <= endTime && message.body && message.body.trim() !== "") {
        if (!loggedMessageIDs.has(extractMessageId(message.id._serialized))) {
          const senderId = message.author || "";
          const rawSenderID = senderId.replace('@c.us', '');
          const mappedName = phoneNameMap[rawSenderID] || rawSenderID;
          await sheet.addRow({
            'STT': '',
            'Nội dung công việc': message.body,
            'Người Thực Hiện': '',
            'Người Giao Việc': mappedName,
            'Tiến Độ': '',
            'Ghi Chú': '',
            'Thời gian': msgTime.toFormat('dd/MM/yyyy HH:mm'), // Cập nhật định dạng thời gian
            'MessageID': extractMessageId(message.id._serialized)
          });
          console.log('Đã lưu tin nhắn:', message.body);
        }
      }
    }
    await updateSerialNumbers(sheet);
    console.log('✅ Đã fetch và lưu xong tất cả tin nhắn trong khoảng 6h - 23h30.');
  } catch (err) {
    console.error('❌ Lỗi khi fetch tin nhắn từ nhóm:', err);
  }
}

/************************************************
 * 12) XỬ LÝ TIN NHẮN MỚI VÀ LƯU VÀO GOOGLE SHEETS
 ************************************************/
client.on('message', async (msg) => {
  try {
    const chat = await msg.getChat();
    if (chat.id._serialized.trim() !== TARGET_GROUP_ID.trim()) return;

    const now = DateTime.now().setZone('Asia/Ho_Chi_Minh');
    const startTime = now.startOf('day').plus({ hours: 6 });
    const endTime = now.startOf('day').plus({ hours: 23, minutes: 30 });

    const msgTime = DateTime.fromMillis(msg.timestamp * 1000).setZone('Asia/Ho_Chi_Minh');
    if (msgTime < startTime || msgTime > endTime || !msg.body || msg.body.trim() === "") return;

    console.log('Tin nhắn mới từ nhóm mục tiêu:', msg.body);

    const sheet = await accessSpreadsheet();
    await insertDailyHeaderIfNeeded(sheet);

    const senderId = msg.author || msg.from;
    const rawSenderID = senderId.replace('@c.us', '');
    const mappedName = phoneNameMap[rawSenderID] || rawSenderID;

    await sheet.addRow({
      'STT': '',
      'Nội dung công việc': msg.body,
      'Người Thực Hiện': '',
      'Người Giao Việc': mappedName,
      'Tiến Độ': '',
      'Ghi Chú': '',
      'Thời gian': msgTime.toFormat('dd/MM/yyyy HH:mm'), // Cập nhật định dạng thời gian
      'MessageID': extractMessageId(msg.id._serialized)
    });
    console.log('Đã lưu tin nhắn mới:', msg.body);
    await updateSerialNumbers(sheet);
  } catch (error) {
    console.error('❌ Lỗi ghi Google Sheets:', error);
  }
});

/************************************************
 * 13) KHỞI ĐỘNG BOT
 ************************************************/
client.initialize();