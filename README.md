# wsi-bot-whatsapp

WhatsApp automation bot for WSI: reading group messages, logging tasks to Google Sheets, generating daily reports, scheduling tasks, and auto-sending summaries.

## Yêu cầu
- Node.js 18+ và npm.
- Tài khoản dịch vụ Google có quyền đọc/ghi vào Google Sheet mục tiêu.
- Điện thoại có ứng dụng WhatsApp để quét mã QR đăng nhập.

## Cấu hình nhanh
1. Cài phụ thuộc:
   ```bash
   npm install
   ```

2. Tạo file `.env` (tùy chọn) để ghi đè cấu hình mặc định trong `config.js`:
   ```env
   SHEET_ID=<ID Google Sheet>
   SERVICE_ACCOUNT_FILE=./botwhataap-55f0f0413dd1.json
   WEB_PORT=3000
   ```
   > `SHEET_ID`: ID bảng cần ghi dữ liệu.  
   > `SERVICE_ACCOUNT_FILE`: đường dẫn file JSON tài khoản dịch vụ.  
   > `WEB_PORT`: cổng web server dùng để xem báo cáo/kiểm tra trạng thái.

3. Bạn có thể nhập trực tiếp thông tin Service Account từ giao diện web (xem bên dưới) **hoặc** đặt sẵn file JSON đúng đường dẫn `SERVICE_ACCOUNT_FILE` và bảo đảm khóa `private_key` không bị xuống dòng sai (dùng `\\n` trong biến môi trường nếu cần).

4. Chỉnh sửa các giá trị trong `config.js` nếu cần (ID nhóm WhatsApp, bản đồ số điện thoại → tên, v.v.).

## Chạy bot
1. Khởi động ứng dụng:
   ```bash
   node index.js
   ```
2. Lần đầu chạy, quét mã QR hiển thị trong terminal để đăng nhập WhatsApp Web.
3. Bot sẽ tự động:
   - Nghe tin nhắn trong nhóm `TARGET_GROUP_ID` và ghi vào Google Sheet theo `HEADERS`.
   - Khởi chạy web server song song tại `http://localhost:<WEB_PORT>` để cấu hình và xem dữ liệu:
     - Trang chủ `/`: dashboard web nhập `client_email`, `private_key`, `Google Sheet ID`, lọc công việc theo ngày/tiến độ/người liên quan, xem tin nhắn đã lưu, và mở báo cáo.
     - `/api/credentials` (GET/POST): đọc/lưu thông tin Service Account & Sheet ID.
     - `/api/credentials/test` (POST): kiểm tra nhanh quyền truy cập Google Sheet với cấu hình hiện tại.
     - `/api/tasks` (GET): trả về danh sách công việc đã lọc (params: `start`, `end`, `progress`, `assignee`, `assigner`, `q`).
     - `/api/messages`: trả về JSON tin nhắn đã lưu trong sheet.
     - `/health`: kiểm tra trạng thái.
     - `/reports/daily?date=YYYY-MM-DD`: báo cáo công việc cho ngày bất kỳ (mặc định hôm nay).
     - `/reports/tomorrow?date=YYYY-MM-DD`: danh sách công việc cho ngày chỉ định (mặc định ngày mai).

## Ghi chú vận hành
- Log được ghi vào `combined.log` và `error.log` để tiện theo dõi.
- Sau khi nhập Service Account trên dashboard, bấm **Kiểm tra kết nối** để xác nhận tài khoản có quyền đọc/ghi vào Google Sheet mục tiêu.
- Ảnh báo cáo sinh tự động nằm trong thư mục `reports/`.
- Thay đổi cấu trúc cột trên Google Sheet cần cập nhật `HEADERS` tương ứng trong `config.js`.
