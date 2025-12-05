const http = require('http');
const { renderLandingPage } = require('./landingPage');
const { parseRequestBody } = require('./utils');

function createRouter({
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
}) {
  return async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const { pathname, searchParams } = url;
    const timezone = 'Asia/Ho_Chi_Minh';

    const parseDateParam = (value, fallback) => {
      if (!value) return fallback;
      const parsed = DateTime.fromISO(value, { zone: timezone });
      return parsed.isValid ? parsed.startOf('day') : fallback;
    };

    const respondJson = (payload) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
    };

    const handleConfigError = (error) => {
      if (error && error.code === 'CONFIG_MISSING') {
        res.statusCode = 400;
        respondJson({ message: error.message });
        return true;
      }
      return false;
    };

    if (req.method === 'GET' && pathname === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(renderLandingPage());
      return;
    }

    if (pathname === '/health') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (pathname === '/api/credentials') {
        if (req.method === 'GET') {
          const hasCredentials = await credentialsExist();
          respondJson({ hasCredentials, sheetId: config.SHEET_ID });
          return;
        }

        if (req.method === 'POST') {
          try {
            const body = await parseRequestBody(req);
            if (!body.client_email || !body.private_key || !body.sheet_id) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ message: 'Thiếu client_email, private_key hoặc sheet_id' }));
              return;
            }

            await saveCreds({ client_email: body.client_email, private_key: body.private_key });
            config.SHEET_ID = body.sheet_id;
            resetSheetCache();

            respondJson({ message: 'Đã lưu tài khoản dịch vụ và Sheet ID.' });
          } catch (error) {
            logger.error('Lỗi lưu credentials qua web', { error });
            res.statusCode = 500;
            respondJson({ message: 'Lưu credentials thất bại.' });
          }
          return;
        }

        res.statusCode = 405;
        respondJson({ message: 'Method not allowed' });
        return;
      }

      if (pathname === '/api/credentials/test' && req.method === 'POST') {
        try {
          const result = await testSheetConnection();
          respondJson({ ok: true, message: result.message, sheet: result.sheet });
        } catch (error) {
          if (handleConfigError(error)) return;
          logger.error('Lỗi kiểm tra kết nối Google Sheets', { error });
          res.statusCode = 500;
          respondJson({ ok: false, message: 'Kiểm tra kết nối thất bại. Vui lòng kiểm tra tài khoản dịch vụ và Sheet ID.' });
        }
        return;
      }

    if (pathname === '/api/tasks' && req.method === 'GET') {
      try {
        await ensureSheetConfigAvailable();
        const now = DateTime.now().setZone(timezone).startOf('day');
        const startDate = parseDateParam(searchParams.get('start'), now);
        const endDate = parseDateParam(searchParams.get('end'), startDate).endOf('day');
        const progressFilters = (searchParams.get('progress') || '')
          .split(',')
          .map(p => p.trim())
          .filter(Boolean);
        const assigneeFilter = (searchParams.get('assignee') || '').trim().toLowerCase();
        const assignerFilter = (searchParams.get('assigner') || '').trim().toLowerCase();
        const searchFilter = (searchParams.get('q') || '').trim().toLowerCase();

        const months = new Set();
        let cursor = startDate.startOf('month');
        const lastMonth = endDate.startOf('month');
        while (cursor <= lastMonth) {
          months.add(cursor.month);
          cursor = cursor.plus({ months: 1 });
        }

        const monthRows = await Promise.all(Array.from(months).map(async month => ({
          month,
          rows: await (await getSheet(month)).getRows()
        })));

        const tasks = monthRows.flatMap(({ rows }) =>
          rows
            .map(row => {
              const timestamp = row['Thời gian'];
              const parsedTime = DateTime.fromFormat(timestamp, 'dd/MM/yyyy HH:mm', { zone: timezone });
              return {
                parsedTime,
                content: row['Nội dung công việc'],
                assignee: row['Người Thực Hiện'] || '',
                assigner: row['Người Giao Việc'] || '',
                progress: row['Tiến Độ'] || '',
                note: row['Ghi Chú'] || ''
              };
            })
            .filter(task => task.parsedTime.isValid)
            .filter(task => task.parsedTime >= startDate && task.parsedTime <= endDate)
            .filter(task => task.content && !task.content.match(/^Ngày\s/))
            .filter(task => !progressFilters.length || progressFilters.includes(task.progress))
            .filter(task => !assigneeFilter || task.assignee.toLowerCase().includes(assigneeFilter))
            .filter(task => !assignerFilter || task.assigner.toLowerCase().includes(assignerFilter))
            .filter(task => !searchFilter || `${task.content} ${task.note} ${task.assigner} ${task.assignee}`.toLowerCase().includes(searchFilter))
        );

        tasks.sort((a, b) => b.parsedTime.toMillis() - a.parsedTime.toMillis());

        const normalizedTasks = tasks.map(task => ({
          time: task.parsedTime.toFormat('dd/MM/yyyy HH:mm'),
          content: task.content,
          assignee: task.assignee,
          assigner: task.assigner,
          progress: task.progress,
          note: task.note
        }));

        const summary = {
          total: normalizedTasks.length,
          completed: normalizedTasks.filter(t => t.progress === 'Hoàn Thành').length,
          inProgress: normalizedTasks.filter(t => t.progress === 'Chưa Hoàn Thành').length,
          pendingNote: normalizedTasks.filter(t => !t.note).length
        };

        respondJson({ tasks: normalizedTasks, summary, range: { start: startDate.toISODate(), end: endDate.toISODate() } });
      } catch (error) {
        if (handleConfigError(error)) return;
        logger.error('Lỗi khi trả về danh sách công việc', { error });
        res.statusCode = 500;
        respondJson({ message: 'Không lấy được danh sách công việc. Kiểm tra credentials và Sheet ID.' });
      }
      return;
    }

    if (pathname === '/api/messages') {
      try {
        await ensureSheetConfigAvailable();
        const now = DateTime.now().setZone(timezone);
        const sheet = await getSheet(now.month);
        const rows = await sheet.getRows();
        const messages = rows
          .filter(row => row['Nội dung công việc'] && !row['Nội dung công việc'].match(/^Ngày\s/))
          .slice(-100)
          .reverse()
          .map(row => ({
            content: row['Nội dung công việc'],
            sender: row['Người Giao Việc'] || 'Không rõ',
            time: row['Thời gian'] || ''
          }));

        respondJson({ messages });
      } catch (error) {
        if (handleConfigError(error)) return;
        logger.error('Lỗi khi trả về danh sách tin nhắn', { error });
        res.statusCode = 500;
        respondJson({ message: 'Không lấy được tin nhắn. Kiểm tra credentials và Sheet ID.' });
      }
      return;
    }

    const handleReportResponse = async (targetDate, reportType, titlePrefix) => {
      await ensureSheetConfigAvailable();
      const sheet = await getSheet(targetDate.month);
      const rows = await sheet.getRows();
      const filteredRows = filterRowsForReport(rows, targetDate, reportType);

      if (filteredRows.length === 0) {
        res.statusCode = 404;
        res.end(reportType === 'daily' ? 'Không có dữ liệu báo cáo cho ngày này.' : 'Không có dữ liệu công việc cho ngày này.');
        return;
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(generateReportHTML(filteredRows, `${titlePrefix} - ${targetDate.toFormat('dd/MM/yyyy')}`));
    };

    if (pathname === '/reports/daily') {
      try {
        const fallback = DateTime.now().setZone(timezone);
        const targetDate = parseDateParam(searchParams.get('date'), fallback);
        await handleReportResponse(targetDate, 'daily', 'BÁO CÁO CÔNG VIỆC');
      } catch (error) {
        if (handleConfigError(error)) return;
        logger.error('Lỗi khi trả về báo cáo ngày', { error });
        res.statusCode = 500;
        res.end('Có lỗi xảy ra khi tạo báo cáo.');
      }
      return;
    }

    if (pathname === '/reports/tomorrow') {
      try {
        const fallback = DateTime.now().setZone(timezone).plus({ days: 1 });
        const targetDate = parseDateParam(searchParams.get('date'), fallback);
        await handleReportResponse(targetDate, 'tomorrow', 'DANH SÁCH CÔNG VIỆC NGÀY MAI');
      } catch (error) {
        if (handleConfigError(error)) return;
        logger.error('Lỗi khi trả về báo cáo ngày mai', { error });
        res.statusCode = 500;
        res.end('Có lỗi xảy ra khi tạo báo cáo.');
      }
      return;
    }

    res.statusCode = 404;
    res.end('Endpoint không tồn tại.');
  };
}

function startWebServer(deps) {
  const handler = createRouter(deps);
  const server = http.createServer(handler);
  const port = deps.config.WEB_PORT || 3000;
  server.listen(port, () => {
    deps.logger.info(`Web server đang lắng nghe tại cổng ${port}`);
  });
  return server;
}

module.exports = { createRouter, startWebServer };
