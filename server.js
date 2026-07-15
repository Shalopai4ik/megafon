const http = require('http');
const fs = require('fs');
const path = require('path');
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

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
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
  console.log(`Server running at: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log('Mode: Static file server (Node.js)');
  console.log('=====================\n');
});

process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});
