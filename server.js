[15.07.2026 11:01] Anikey: Хлебопашев Антон Александрович:
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

// Определяем путь к psql в зависимости от операционной системы
const isWindows = os.platform() === 'win32';
const PSQL_PATH = isWindows
? '"C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe"'
: 'psql';

const DB_USER = process.env.DB_USER || 'postgres';
const DB_NAME = process.env.DB_NAME || 'megafon';
const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = process.env.DB_PORT || '5432';
const DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';
const TEMP_DIR = os.tmpdir();

// Защита от DDoS и зацикливания
const requestTracker = new Map();
const MAX_REQUESTS_PER_SECOND = 5;
const REQUEST_WINDOW = 1000; // 1 second

function isRequestAllowed(clientIP, endpoint) {
const key =  ${clientIP}:${endpoint} ;
const now = Date.now();
if (!requestTracker.has(key)) {
requestTracker.set(key, {
timestamps: [now],
blocked: false,
blockStartTime: 0
});
return true;
}
const tracker = requestTracker.get(key);
const recentRequests = tracker.timestamps.filter(timestamp =>
now - timestamp < REQUEST_WINDOW
);
// Если уже заблокирован
if (tracker.blocked) {
// Проверяем, прошло ли 30 секунд
if (now - tracker.blockStartTime < 30000) {
console.log( [${new Date().toISOString()}] BLOCKED REQUEST from ${clientIP} to ${endpoint} );
return false;
} else {
// Разблокируем
tracker.blocked = false;
tracker.blockStartTime = 0;
tracker.timestamps = [now];
return true;
}
}
if (recentRequests.length >= MAX_REQUESTS_PER_SECOND) {
console.warn( [${new Date().toISOString()}] RATE LIMIT BLOCKING: ${key} - too many requests );
tracker.blocked = true;
tracker.blockStartTime = now;
// Автоматическая очистка
setTimeout(() => {
requestTracker.delete(key);
}, 35000);
return false;
}
recentRequests.push(now);
tracker.timestamps = recentRequests;
return true;
}

function getClientIP(req) {
return req.headers['x-forwarded-for'] ||
req.connection.remoteAddress ||
req.socket.remoteAddress ||
(req.connection.socket ? req.connection.socket.remoteAddress : null) ||
'unknown';
}

console.log('=== Database Configuration ===');
console.log( Host: ${DB_HOST} );
console.log( Port: ${DB_PORT} );
console.log( Database: ${DB_NAME} );
console.log( User: ${DB_USER} );
console.log('==============================');

function escapeSql(str) {
if (typeof str !== 'string') return str;
return str.replace(/'/g, "''");
}

function executeSQL(sql, callback) {
const tempFile = path.join(TEMP_DIR,  megafon_temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.sql );
fs.writeFile(tempFile, sql, (err) => {
if (err) {
callback(err);
return;
}
let command;
const env = Object.assign({}, process.env);
if (isWindows) {
command =  ${PSQL_PATH} -U ${DB_USER} -d ${DB_NAME} -h ${DB_HOST} -p ${DB_PORT} -f "${tempFile}" -t --no-align ;
if (DB_PASSWORD) {
env.PGPASSWORD = DB_PASSWORD;
}
} else {
env.PGPASSWORD = DB_PASSWORD;
command =  ${PSQL_PATH} -U ${DB_USER} -d ${DB_NAME} -h ${DB_HOST} -p ${DB_PORT} -f "${tempFile}" -t --no-align ;
}
const execOptions = {
cwd: __dirname,
timeout: 30000,
env: env,
maxBuffer: 1024 * 1024 * 10
};
exec(command, execOptions, (error, stdout, stderr) => {
fs.un

Хлебопашев Антон Александрович:
link(tempFile, () => {});
if (error) {
callback(error, null, stderr || error.message);
} else {
callback(null, stdout, stderr);
}
});
});
}
[15.07.2026 11:01] Anikey: function executeSelectSQL(sql, callback) {
const tempFile = path.join(TEMP_DIR,  megafon_select_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.sql );
const sqlWithFormat =  \\copy (${sql}) to stdout with csv header ;
fs.writeFile(tempFile, sqlWithFormat, (err) => {
if (err) {
callback(err);
return;
}
let command;
const env = Object.assign({}, process.env);
if (isWindows) {
command =  ${PSQL_PATH} -U ${DB_USER} -d ${DB_NAME} -h ${DB_HOST} -p ${DB_PORT} -f "${tempFile}" ;
if (DB_PASSWORD) {
env.PGPASSWORD = DB_PASSWORD;
}
} else {
env.PGPASSWORD = DB_PASSWORD;
command =  ${PSQL_PATH} -U ${DB_USER} -d ${DB_NAME} -h ${DB_HOST} -p ${DB_PORT} -f "${tempFile}" ;
}
const execOptions = {
cwd: __dirname,
timeout: 30000,
env: env,
maxBuffer: 1024 * 1024 * 10
};
exec(command, execOptions, (error, stdout, stderr) => {
fs.unlink(tempFile, () => {});
if (error) {
callback(error, null, stderr || error.message);
return;
}
try {
const lines = stdout.trim().split('\n').filter(line =>
line.trim() &&
!line.startsWith('COPY') &&
!line.includes('(0 rows)') &&
!line.includes('row)')
);
if (lines.length === 0) {
callback(null, []);
return;
}
const headers = lines[0].split(',');
const results = [];
for (let i = 1; i < lines.length; i++) {
if (lines[i].trim() &&
!lines[i].startsWith('COPY') &&
!lines[i].includes('(0 rows)') &&
!lines[i].includes('row)')) {
const values = lines[i].split(',');
const obj = {};
for (let j = 0; j < headers.length; j++) {
const value = j < values.length ? values[j].trim() : null;
obj[headers[j].trim()] = value === '\\N' || value === '' ? null : value;
}
results.push(obj);
}
}
callback(null, results);
} catch (parseError) {
callback(parseError, null);
}
});
});
}

const server = http.createServer((req, res) => {
const clientIP = getClientIP(req);
const endpoint =  ${req.method} ${req.url} ;
// Проверяем rate limiting для критических эндпоинтов
if ((req.url === '/api/parameter_values' && req.method === 'POST') ||
(req.url === '/api/reports' && req.method === 'POST') ||
(req.url === '/api/batch_parameter_values' && req.method === 'POST')) {
if (!isRequestAllowed(clientIP, endpoint)) {
res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
res.end(JSON.stringify({
error: 'Too Many Requests',
message: 'Rate limit exceeded. Try again in 30 seconds.'
}));
return;
}
}
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
if (req.method === 'OPTIONS') {
res.writeHead(204);
res.end();
return;
}
if (req.method === 'GET' && req.url.startsWith('/api/user-by-number/')) {
const phoneNumber = req.url.split('/')[3];
if (!phoneNumber) {
res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
res.end(JSON.stringify({ error: 'Не указан номер телефона' }));
return;
}
const sql =  SELECT id FROM users_numbers WHERE number = '${escapeSql(phoneNumber)}' LIMIT 1 ;
executeSelectSQL(sql, (error, results) => {
if (error) {
res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
res.end(JSON.stringify({
error: 'Ошибка поиска пользователя',
details: error.message
}));
return;

Хлебопашев Антон Александрович:
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
const sql = 'SELECT * FROM reports_2 ORDER BY created_at DESC LIMIT 100';
executeSelectSQL(sql, (error, results) => {
if (error) {
res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
[15.07.2026 11:01] Anikey: res.end(JSON.stringify({
error: 'Ошибка получения данных',
details: error.message
}));
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
const sql =  INSERT INTO reports_2 (report_date, report_month, subscriber_id, created_at) VALUES ('${reportDate}', '${reportMonth}', '${subscriberId}', '${createdAt}') RETURNING id ;
executeSQL(sql, (error, stdout, stderr) => {
if (error) {
res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
res.end(JSON.stringify({
error: 'Ошибка подключения к БД',
details: stderr || error.message
}));
return;
}
let newId = null;
const lines = stdout.trim().split('\n');
for (const line of lines) {
const cleanLine = line.trim();
if (cleanLine && /^\d+/.test(cleanLine)) {
newId = parseInt(cleanLine);
break;
}
}
const newReport = {
id: newId || Date.now(),
...reportData,
created_at: createdAt
};
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

// Новый эндпоинт для батчевой обработки параметров
if (req.method === 'POST' && req.url === '/api/batch_parameter_values') {
console.log( [${new Date().toISOString()}] Batch parameter values request from ${clientIP} );
let body = '';
req.on('data', chunk => { body += chunk.toString(); });
req.on('end', () => {
try {
const { parameters } = JSON.parse(body);

if (!Array.isArray(parameters) || parameters.length === 0) {
res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
res.end(JSON.stringify({ error: 'Неверный формат параметров' }));
return;
}

// Создаем один SQL запрос для всех параметров
const values = parameters.map(param => 
 (${param.report_id}, ${param.parameter_id}, '${escapeSql(param.volume || '')}', ${param.no_discount !== undefined ? param.no_discount : 'NULL'}, ${param.discount !== undefined ? param.discount : 'NULL'}, ${param.with_discount !== undefined ? param.with_discount : 'NULL'}, '${new Date().toISOString()}') 
).join(',');

const sql =  INSERT INTO parameter_values_2  (report_id, parameter_id, volume, no_discount, discount, with_discount, created_at)  VALUES ${values} RETURNING id ;

Хлебопашев Антон Александрович:
executeSQL(sql, (error, stdout, stderr) => {
if (error) {
res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
res.end(JSON.stringify({
error: 'Ошибка вставки',
details: stderr || error.message
}));
return;
}
res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
res.end(JSON.stringify({ success: true, count: parameters.length }));
});
} catch (e) {
res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
res.end(JSON.stringify({ error: 'Ошибка парсинга JSON', details: e.message }));
}
});
return;
}

if (req.method === 'POST' && req.url === '/api/parameter_values') {
console.log( [${new Date().toISOString()}] Parameter values request from ${clientIP} );
let body = '';
req.on('data', chunk => { body += chunk.toString(); });
req.on('end', () => {
try {
const paramData = JSON.parse(body);
const createdAt = new Date().toISOString();
const reportId = parseInt(paramData.report_id);
const parameterId = parseInt(paramData.parameter_id);
[15.07.2026 11:01] Anikey: const volume = escapeSql(paramData.volume);
const noDiscount = paramData.no_discount !== undefined ? paramData.no_discount : 'NULL';
const discount = paramData.discount !== undefined ? paramData.discount : 'NULL';
const withDiscount = paramData.with_discount !== undefined ? paramData.with_discount : 'NULL';
const checkSql =  SELECT id FROM parameter_values_2 WHERE report_id = ${reportId} AND parameter_id = ${parameterId} ;
executeSelectSQL(checkSql, (checkError, checkResults) => {
if (checkError  !checkResults  checkResults.length === 0) {
const sql =  INSERT INTO parameter_values_2 (report_id, parameter_id, volume, no_discount, discount, with_discount, created_at) VALUES (${reportId}, ${parameterId}, '${volume}', ${noDiscount}, ${discount}, ${withDiscount}, '${createdAt}') RETURNING id ;
executeSQL(sql, (insertError, stdout, stderr) => {
if (insertError) {
res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
res.end(JSON.stringify({
error: 'Ошибка вставки',
details: stderr || insertError.message
}));
return;
}
let newId = null;
if (stdout) {
const lines = stdout.trim().split('\n');
for (const line of lines) {
if (line.trim() && /^\d+$/.test(line.trim())) {
newId = parseInt(line.trim());
break;
}
}
}
res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
res.end(JSON.stringify({ id: newId || Date.now(), ...paramData, created_at: createdAt }));
});
} else {
const existingId = checkResults[0].id;
const updateSql =  UPDATE parameter_values_2 SET volume = '${volume}', no_discount = ${noDiscount}, discount = ${discount}, with_discount = ${withDiscount}, created_at = '${createdAt}' WHERE id = ${existingId} RETURNING id ;
executeSQL(updateSql, (updateError, stdout, stderr) => {
if (updateError) {
res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
res.end(JSON.stringify({
error: 'Ошибка обновления',
details: stderr || updateError.message
}));
return;
}
res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
res.end(JSON.stringify({ id: existingId, ...paramData, created_at: createdAt }));
});
}
});
} catch (e) {
res.wr

Хлебопашев Антон Александрович:
iteHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
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
const sql =  SELECT * FROM parameter_values_2 WHERE report_id = ${parseInt(reportId)} ORDER BY id ;
executeSelectSQL(sql, (error, results) => {
if (error) {
res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
res.end(JSON.stringify({
error: 'Ошибка получения данных',
details: error.message
}));
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
res.end(JSON.stringify({
error: 'Ошибка выполнения SQL',
details: stderr || error.message
}));
return;
}
res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
res.end(JSON.stringify({ success: true, message: 'Запрос выполнен успешно', output: stdout }));
[15.07.2026 11:01] Anikey: });
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
console.log('\n=== SERVER STARTED ===');
console.log( Server running at: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} );
console.log('Mode: PostgreSQL via psql CLI');
console.log( DB Port: ${DB_PORT} );
console.log( OS: ${isWindows ? 'Windows' : 'Linux/macOS'} );
console.log( Rate limiting: ${MAX_REQUESTS_PER_SECOND} requests per second );
console.log('=====================\n');
});

// Очистка трекера запросов каждые 5 секунд
setInterval(() => {
const now = Date.now();
for (const [key, tracker] of requestTracker.entries()) {
const recentTimestamps = tracker.timestamps.filter(timestamp =>
now - timestamp < REQUEST_WINDOW
);
if (recentTimestamps.length === 0 && !tracker.blocked) {
requestTracker.

Хлебопашев Антон Александрович:
delete(key);
    } else {
      tracker.timestamps = recentTimestamps;
    }
  }
}, 5000);

process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  console.error('Stack:', err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});