const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

const PORT = Number(process.env.PORT || 3001);
const HOST = '0.0.0.0';
const STATIC_DIR = __dirname;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

const PSQL_PATH = '"C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe"';
const DB_USER = 'postgres';
const DB_NAME = 'megafon';
const DB_HOST = '127.0.0.1';
const DB_PORT = '5434';

const TEMP_DIR = os.tmpdir();

function escapeSql(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/'/g, "''");
}

function executeSQL(sql, callback) {
  const tempFile = path.join(TEMP_DIR, `megafon_temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.sql`);
  fs.writeFile(tempFile, sql, (err) => {
    if (err) { callback(err); return; }
    const command = `${PSQL_PATH} -U ${DB_USER} -d ${DB_NAME} -h ${DB_HOST} -p ${DB_PORT} -f "${tempFile}" -t --no-align`;
    exec(command, { cwd: __dirname, timeout: 30000 }, (error, stdout, stderr) => {
      fs.unlink(tempFile, () => {});
      if (error) { callback(error, null, stderr); } else { callback(null, stdout, stderr); }
    });
  });
}

function executeSelectSQL(sql, callback) {
  const tempFile = path.join(TEMP_DIR, `megafon_select_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.sql`);
  const sqlWithFormat = `\\copy (${sql}) to stdout with csv header`;
  fs.writeFile(tempFile, sqlWithFormat, (err) => {
    if (err) { callback(err); return; }
    const command = `${PSQL_PATH} -U ${DB_USER} -d ${DB_NAME} -h ${DB_HOST} -p ${DB_PORT} -f "${tempFile}"`;
    exec(command, { cwd: __dirname, timeout: 30000 }, (error, stdout, stderr) => {
      fs.unlink(tempFile, () => {});
      if (error) { callback(error, null, stderr); return; }
      try {
        const lines = stdout.trim().split('\n').filter(line => line.trim() && !line.startsWith('COPY') && !line.includes('rows)'));
        if (lines.length === 0) { callback(null, []); return; }
        const headers = parseCSVLine(lines[0]);
        const results = [];
        for (let i = 1; i < lines.length; i++) {
          if (lines[i].trim() && !lines[i].startsWith('COPY') && !lines[i].includes('rows)')) {
            const values = parseCSVLine(lines[i]);
            const obj = {};
            for (let j = 0; j < headers.length; j++) {
              const value = j < values.length ? values[j] : null;
              obj[headers[j]] = value === '\\N' || value === '' ? null : value;
            }
            results.push(obj);
          }
        }
        callback(null, results);
      } catch (parseError) { callback(parseError, null); }
    });
  });
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (char === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += char; }
  }
  result.push(current);
  return result;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url.startsWith('/api/user-by-number/')) {
    const phoneNumber = req.url.split('/')[3];
    if (!phoneNumber) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Не указан номер телефона' }));
      return;
    }
    const sql = `SELECT id FROM users_numbers WHERE number = '${escapeSql(phoneNumber)}' LIMIT 1`;
    executeSelectSQL(sql, (error, results) => {
      if (error) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Ошибка поиска пользователя', details: error.message }));
        return;
      }
      if (results && results.length > 0) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ user_id: results[0].id }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Пользователь не найден' }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/reports') {
    const sql = 'SELECT * FROM reports ORDER BY created_at DESC LIMIT 100';
    executeSelectSQL(sql, (error, results) => {
      if (error) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Ошибка получения данных', details: error.message }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(results));
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/reports') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const reportData = JSON.parse(body);
        const createdAt = new Date().toISOString();
        const reportDate = escapeSql(reportData.report_date);
        const reportMonth = escapeSql(reportData.report_month);
        const subscriberId = escapeSql(reportData.subscriber_id);
        const sql = `INSERT INTO reports (report_date, report_month, subscriber_id, created_at) VALUES ('${reportDate}', '${reportMonth}', '${subscriberId}', '${createdAt}') RETURNING id`;
        executeSQL(sql, (error, stdout, stderr) => {
          if (error) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Ошибка подключения к БД', details: stderr || error.message }));
            return;
          }
          let newId = null;
          const lines = stdout.trim().split('\n');
          for (const line of lines) {
            const cleanLine = line.trim();
            if (cleanLine && /^\d+/.test(cleanLine)) { newId = parseInt(cleanLine); break; }
          }
          const newReport = { id: newId || Date.now(), ...reportData, created_at: createdAt };
          res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(newReport));
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Ошибка парсинга JSON', details: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/parameter_values') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const paramData = JSON.parse(body);
        const createdAt = new Date().toISOString();
        const reportId = parseInt(paramData.report_id);
        const parameterId = parseInt(paramData.parameter_id);
        const volume = escapeSql(paramData.volume);
        const noDiscount = paramData.no_discount !== undefined ? paramData.no_discount : 'NULL';
        const discount = paramData.discount !== undefined ? paramData.discount : 'NULL';
        const withDiscount = paramData.with_discount !== undefined ? paramData.with_discount : 'NULL';

        const checkSql = `SELECT id FROM parameter_values WHERE report_id = ${reportId} AND parameter_id = ${parameterId}`;
        executeSelectSQL(checkSql, (checkError, checkResults) => {
          if (checkError || !checkResults || checkResults.length === 0) {
            const sql = `INSERT INTO parameter_values (report_id, parameter_id, volume, no_discount, discount, with_discount, created_at) VALUES (${reportId}, ${parameterId}, '${volume}', ${noDiscount}, ${discount}, ${withDiscount}, '${createdAt}') RETURNING id`;
            executeSQL(sql, (insertError, stdout, stderr) => {
              if (insertError) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Ошибка插入', details: stderr || insertError.message }));
                return;
              }
              let newId = null;
              if (stdout) {
                const lines = stdout.trim().split('\n');
                for (const line of lines) {
                  if (line.trim() && /^\d+$/.test(line.trim())) { newId = parseInt(line.trim()); break; }
                }
              }
              res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ id: newId || Date.now(), ...paramData, created_at: createdAt }));
            });
          } else {
            const existingId = checkResults[0].id;
            const updateSql = `UPDATE parameter_values SET volume = '${volume}', no_discount = ${noDiscount}, discount = ${discount}, with_discount = ${withDiscount}, created_at = '${createdAt}' WHERE id = ${existingId} RETURNING id`;
            executeSQL(updateSql, (updateError, stdout, stderr) => {
              if (updateError) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Ошибка обновления', details: stderr || updateError.message }));
                return;
              }
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ id: existingId, ...paramData, created_at: createdAt }));
            });
          }
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Ошибка парсинга JSON', details: e.message }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/parameter_values/')) {
    const reportId = req.url.split('/')[3];
    if (!reportId) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Не указан report_id' }));
      return;
    }
    const sql = `SELECT * FROM parameter_values WHERE report_id = ${parseInt(reportId)} ORDER BY id`;
    executeSelectSQL(sql, (error, results) => {
      if (error) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Ошибка получения данных', details: error.message }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(results));
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/execute-sql') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { sql } = JSON.parse(body);
        if (!sql) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'SQL не предоставлен' }));
          return;
        }
        executeSQL(sql, (error, stdout, stderr) => {
          if (error) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Ошибка выполнения SQL', details: stderr || error.message }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, message: 'Запрос выполнен успешно', output: stdout }));
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Ошибка парсинга JSON' }));
      }
    });
    return;
  }

  if (req.method === 'GET') {
    let requestPath = decodeURIComponent(req.url.split('?')[0]);
    if (requestPath === '/') requestPath = '/index.html';
    const safePath = path.normalize(requestPath).replace(/^([.][.][/\\])+/, '');
    const filePath = path.join(STATIC_DIR, safePath);
    if (!filePath.startsWith(STATIC_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Доступ запрещён');
      return;
    }
    fs.readFile(filePath, (error, content) => {
      if (error) {
        res.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(error.code === 'ENOENT' ? '404 Файл не найден' : '500 Ошибка сервера');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(content);
    });
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Метод не поддерживается');
});

server.listen(PORT, HOST, () => {
  console.log(`Сервер запущен: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log('Режим: Работа с PostgreSQL через psql CLI');
  console.log(`Порт PostgreSQL: ${DB_PORT}`);
});

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
process.on('uncaughtException', (err) => { console.error(err); process.exit(1); });
process.on('unhandledRejection', (reason) => { console.error(reason); process.exit(1); });
