function renderLandingPage() {
  return `<!DOCTYPE html>
  <html lang="vi">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>WSI Bot WhatsApp - Dashboard</title>
      <style>
        :root { --green: #1abc9c; --dark: #2c3e50; --gray: #7f8c8d; --bg: #f5f7fb; }
        * { box-sizing: border-box; }
        body { font-family: 'Inter', system-ui, -apple-system, sans-serif; margin: 0; padding: 0; background: var(--bg); color: var(--dark); }
        header { background: var(--green); color: white; padding: 20px 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
        header h1 { margin: 0 0 6px 0; font-size: 24px; }
        header p { margin: 0; color: #e8fffa; }
        main { padding: 24px; display: grid; gap: 24px; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); }
        section { background: white; border-radius: 10px; box-shadow: 0 6px 16px rgba(17, 24, 39, 0.08); padding: 18px 20px; }
        h2 { margin-top: 0; font-size: 18px; color: var(--green); }
        label { display: block; font-weight: 600; margin: 12px 0 6px; }
        input, textarea, select { width: 100%; padding: 10px; border: 1px solid #d9e2ec; border-radius: 8px; font-family: 'Inter', monospace; }
        textarea { min-height: 120px; }
        button { margin-top: 14px; padding: 10px 14px; background: var(--green); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 700; }
        button.secondary { background: #3498db; }
        button:disabled { opacity: 0.6; cursor: not-allowed; }
        .status { margin-top: 10px; font-size: 13px; }
        .status.ok { color: #2ecc71; }
        .status.err { color: #e74c3c; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
        th, td { border: 1px solid #eef2f7; padding: 8px 10px; text-align: left; }
        th { background: #f0f4f8; }
        .muted { color: var(--gray); font-size: 13px; }
        .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
        .summary { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); margin-top: 10px; }
        .pill { background: #f0f4f8; padding: 10px 12px; border-radius: 8px; font-weight: 700; color: var(--dark); border: 1px solid #e2e8f0; }
        .filter-row { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); align-items: end; }
        .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; background: #ecfdf3; color: #166534; font-size: 13px; }
        .badge.gray { background: #f3f4f6; color: #374151; }
        .badge.blue { background: #eff6ff; color: #1d4ed8; }
        .table-wrapper { max-height: 420px; overflow: auto; border: 1px solid #e5e7eb; border-radius: 8px; }
        .actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 8px; }
      </style>
    </head>
    <body>
      <header>
        <h1>WSI Bot WhatsApp - Dashboard</h1>
        <p>Quản lý cấu hình Google Sheet, xem công việc, lọc và xuất báo cáo trực tiếp trên web.</p>
      </header>
      <main>
        <section>
          <h2>1) Kết nối Google Sheet</h2>
          <p class="muted">Dán <strong>client_email</strong> và <strong>private_key</strong> của Service Account có quyền đọc/ghi Google Sheet mục tiêu.</p>
          <form id="creds-form">
            <label for="sheet_id">Google Sheet ID</label>
            <input id="sheet_id" name="sheet_id" placeholder="Ví dụ: 1AbC..." />
            <label for="client_email">client_email</label>
            <input id="client_email" name="client_email" placeholder="service-account@project.iam.gserviceaccount.com" />
            <label for="private_key">private_key</label>
            <textarea id="private_key" name="private_key" placeholder="-----BEGIN PRIVATE KEY-----\n..."></textarea>
            <button type="submit">Lưu cấu hình</button>
            <div id="creds-status" class="status"></div>
          </form>
        </section>

        <section>
          <h2>2) Đăng nhập WhatsApp</h2>
          <p>Hãy mở ứng dụng WhatsApp trên điện thoại > Kết nối thiết bị > Quét mã QR hiển thị trong terminal của server.</p>
          <p class="muted">Sau khi quét thành công, bot sẽ tự động nhận và lưu tin nhắn vào Google Sheet đã cấu hình.</p>
          <div id="whats-status" class="badge gray">Bot luôn chạy nền để nhận và lưu tin nhắn.</div>
        </section>

        <section>
          <h2>3) Bộ lọc công việc</h2>
          <div class="filter-row">
            <div>
              <label for="start-date">Từ ngày</label>
              <input type="date" id="start-date" />
            </div>
            <div>
              <label for="end-date">Đến ngày</label>
              <input type="date" id="end-date" />
            </div>
            <div>
              <label for="assignee">Người thực hiện</label>
              <input id="assignee" placeholder="Tên hoặc từ khóa" />
            </div>
            <div>
              <label for="assigner">Người giao việc</label>
              <input id="assigner" placeholder="Tên hoặc từ khóa" />
            </div>
          </div>
          <div class="filter-row" style="margin-top:10px;">
            <div>
              <label>Tiến độ</label>
              <div class="grid">
                <label><input type="checkbox" name="progress" value="Hoàn Thành" checked /> Hoàn Thành</label>
                <label><input type="checkbox" name="progress" value="Chưa Hoàn Thành" checked /> Chưa Hoàn Thành</label>
              </div>
            </div>
            <div>
              <label for="search">Tìm kiếm nội dung/Ghi chú</label>
              <input id="search" placeholder="Từ khóa liên quan" />
            </div>
            <div>
              <label for="report-date">Ngày báo cáo</label>
              <input type="date" id="report-date" />
              <div class="actions">
                <button type="button" id="btn-daily" class="secondary">Báo cáo ngày</button>
                <button type="button" id="btn-tomorrow" class="secondary">Công việc ngày mai</button>
              </div>
            </div>
          </div>
          <div class="summary" id="task-summary">
            <div class="pill">Tổng: <span id="sum-total">0</span></div>
            <div class="pill">Hoàn thành: <span id="sum-done">0</span></div>
            <div class="pill">Chưa hoàn thành: <span id="sum-progress">0</span></div>
            <div class="pill">Chưa có ghi chú: <span id="sum-note">0</span></div>
          </div>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Nội dung công việc</th>
                  <th>Người thực hiện</th>
                  <th>Người giao việc</th>
                  <th>Tiến độ</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody id="task-rows"></tbody>
            </table>
          </div>
        </section>

        <section>
          <h2>4) Tin nhắn gần nhất</h2>
          <p class="muted">Trích 100 dòng cuối từ Google Sheet.</p>
          <div id="messages"></div>
        </section>
      </main>
      <script>
        const state = { loadingTasks: false };

        function formatDateInput(date = new Date()) {
          const tzOffset = date.getTimezoneOffset();
          const local = new Date(date.getTime() - tzOffset * 60000);
          return local.toISOString().split('T')[0];
        }

        async function loadStatus() {
          try {
            const res = await fetch('/api/credentials');
            if (!res.ok) throw new Error('Không tải được trạng thái');
            const data = await res.json();
            document.getElementById('sheet_id').value = data.sheetId || '';
            document.getElementById('creds-status').textContent = data.hasCredentials ? 'Đã tìm thấy file credentials trên server.' : 'Chưa có credentials, vui lòng nhập và lưu.';
            document.getElementById('creds-status').className = 'status ' + (data.hasCredentials ? 'ok' : 'err');
          } catch (e) {
            document.getElementById('creds-status').textContent = 'Không thể tải trạng thái: ' + e.message;
            document.getElementById('creds-status').className = 'status err';
          }
        }

        async function saveCreds(event) {
          event.preventDefault();
          const button = event.target.querySelector('button');
          button.disabled = true;
          const payload = {
            sheet_id: document.getElementById('sheet_id').value.trim(),
            client_email: document.getElementById('client_email').value.trim(),
            private_key: document.getElementById('private_key').value
          };
          try {
            const res = await fetch('/api/credentials', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            const data = await res.json();
            document.getElementById('creds-status').textContent = data.message || 'Đã lưu cấu hình.';
            document.getElementById('creds-status').className = 'status ok';
          } catch (e) {
            document.getElementById('creds-status').textContent = 'Lỗi lưu cấu hình: ' + e.message;
            document.getElementById('creds-status').className = 'status err';
          } finally {
            button.disabled = false;
          }
        }

        function getFilters() {
          const progress = Array.from(document.querySelectorAll('input[name="progress"]:checked')).map(i => i.value);
          return {
            start: document.getElementById('start-date').value,
            end: document.getElementById('end-date').value,
            assignee: document.getElementById('assignee').value.trim(),
            assigner: document.getElementById('assigner').value.trim(),
            progress,
            q: document.getElementById('search').value.trim()
          };
        }

        async function loadTasks() {
          const rowsEl = document.getElementById('task-rows');
          if (state.loadingTasks) return;
          state.loadingTasks = true;
          rowsEl.innerHTML = '<tr><td colspan="6">Đang tải...</td></tr>';
          const filters = getFilters();
          const params = new URLSearchParams();
          if (filters.start) params.set('start', filters.start);
          if (filters.end) params.set('end', filters.end);
          if (filters.assignee) params.set('assignee', filters.assignee);
          if (filters.assigner) params.set('assigner', filters.assigner);
          if (filters.progress.length) params.set('progress', filters.progress.join(','));
          if (filters.q) params.set('q', filters.q);
          try {
            const res = await fetch('/api/tasks?' + params.toString());
            if (!res.ok) throw new Error('Không lấy được danh sách công việc');
            const data = await res.json();
            document.getElementById('sum-total').textContent = data.summary.total;
            document.getElementById('sum-done').textContent = data.summary.completed;
            document.getElementById('sum-progress').textContent = data.summary.inProgress;
            document.getElementById('sum-note').textContent = data.summary.pendingNote;

            if (!data.tasks.length) {
              rowsEl.innerHTML = '<tr><td colspan="6">Không có công việc trong khoảng đã chọn.</td></tr>';
            } else {
              rowsEl.innerHTML = data.tasks
                .map(
                  (t) =>
                    '<tr>' +
                    '<td>' + t.time + '</td>' +
                    '<td>' + t.content + '</td>' +
                    '<td>' + t.assignee + '</td>' +
                    '<td>' + t.assigner + '</td>' +
                    '<td>' + t.progress + '</td>' +
                    '<td>' + (t.note || '') + '</td>' +
                    '</tr>'
                )
                .join('');
            }
          } catch (e) {
            rowsEl.innerHTML = '<tr><td colspan="6">Lỗi tải công việc: ' + e.message + '</td></tr>';
          } finally {
            state.loadingTasks = false;
          }
        }

        async function loadMessages() {
          const container = document.getElementById('messages');
          container.textContent = 'Đang tải...';
          try {
            const res = await fetch('/api/messages');
            if (!res.ok) throw new Error('Không lấy được tin nhắn');
            const data = await res.json();
            if (!data.messages || data.messages.length === 0) {
              container.textContent = 'Chưa có tin nhắn để hiển thị.';
              return;
            }
            const rows = data.messages
              .map(
                (m) =>
                  '<tr>' +
                  '<td>' + m.time + '</td>' +
                  '<td>' + m.sender + '</td>' +
                  '<td>' + m.content + '</td>' +
                  '</tr>'
              )
              .join('');
            container.innerHTML =
              '<table><thead><tr><th>Thời gian</th><th>Người gửi</th><th>Nội dung</th></tr></thead><tbody>' +
              rows +
              '</tbody></table>';
          } catch (e) {
            container.textContent = 'Lỗi tải tin nhắn: ' + e.message;
          }
        }

        function openReport(type) {
          const date = document.getElementById('report-date').value || document.getElementById('start-date').value;
          const params = date ? '?date=' + date : '';
          window.open('/reports/' + type + params, '_blank');
        }

        document.getElementById('creds-form').addEventListener('submit', saveCreds);
        document.getElementById('btn-daily').addEventListener('click', () => openReport('daily'));
        document.getElementById('btn-tomorrow').addEventListener('click', () => openReport('tomorrow'));

        ['start-date','end-date','assignee','assigner','search'].forEach(id => {
          document.getElementById(id).addEventListener('change', loadTasks);
          document.getElementById(id).addEventListener('keyup', (e) => { if (e.key === 'Enter') loadTasks(); });
        });
        document.querySelectorAll('input[name="progress"]').forEach(cb => cb.addEventListener('change', loadTasks));

        (function init() {
          const today = formatDateInput();
          document.getElementById('start-date').value = today;
          document.getElementById('report-date').value = today;
          loadStatus();
          loadTasks();
          loadMessages();
        })();
      </script>
    </body>
  </html>`;
}

module.exports = { renderLandingPage };
