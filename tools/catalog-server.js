'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { exec } = require('child_process');

const CATALOG = path.join(__dirname, '../data/static/ai/command-catalog.json');
const HTML    = path.join(__dirname, 'catalog-editor.html');
const PORT    = 3737;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // Serve editor UI
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(HTML, 'utf8'));
  }

  // Read catalog
  if (req.method === 'GET' && req.url === '/api/catalog') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(fs.readFileSync(CATALOG, 'utf8'));
  }

  // Write catalog
  if (req.method === 'POST' && req.url === '/api/catalog') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        JSON.parse(body); // validate before writing
        fs.writeFileSync(CATALOG, body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`Catalog editor running at ${url}`);
  console.log('Press Ctrl+C to stop.\n');
  exec(`open ${url}`);
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} already in use. Kill the existing process or change PORT.`);
  else throw e;
});
