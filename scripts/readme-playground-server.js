#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const {
  buildBenchmarkSummarySvg,
  extractHexColors,
  parseReadmeSections
} = require('../src/readme-playground');

const projectRoot = path.resolve(__dirname, '..');
const readmePath = path.join(projectRoot, 'README.md');
const assetDir = path.join(projectRoot, 'docs', 'assets');
const defaultPlaygroundPath = '/docs/playground/readme-playground.html';

function parseArgs(argv) {
  const options = {
    host: '127.0.0.1',
    port: 4173
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--host') options.host = argv[index + 1] || options.host;
    if (arg === '--port') options.port = Number(argv[index + 1] || options.port);
  }

  if (!Number.isFinite(options.port) || options.port < 1) {
    throw new Error(`Invalid port: ${options.port}`);
  }

  return options;
}

function listSvgFiles() {
  return fs.readdirSync(assetDir)
    .filter((name) => name.toLowerCase().endsWith('.svg'))
    .sort((left, right) => left.localeCompare(right));
}

function isSafeRepoPath(targetPath) {
  const relative = path.relative(projectRoot, targetPath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveSvgPath(name) {
  if (!/^[a-z0-9-]+\.svg$/i.test(String(name || ''))) return null;
  const targetPath = path.join(assetDir, name);
  if (!isSafeRepoPath(targetPath) || !fs.existsSync(targetPath)) return null;
  return targetPath;
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  response.end(body);
}

function sendText(response, statusCode, body, type = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body)
  });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4 * 1024 * 1024) {
        reject(new Error('Request too large'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function parseJsonBody(request) {
  return readBody(request).then((body) => {
    if (!body.trim()) return {};
    return JSON.parse(body);
  });
}

function staticContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.md') return 'text/markdown; charset=utf-8';
  return 'application/octet-stream';
}

function sendStatic(response, requestPath) {
  const relativePath = requestPath === '/' ? defaultPlaygroundPath : requestPath;
  const filePath = path.join(projectRoot, decodeURIComponent(relativePath.replace(/^\//, '')));
  if (!isSafeRepoPath(filePath) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(response, 404, 'Not found');
    return;
  }
  const body = fs.readFileSync(filePath);
  response.writeHead(200, {
    'Content-Type': staticContentType(filePath),
    'Content-Length': body.length
  });
  response.end(body);
}

function buildStatePayload() {
  const readme = fs.readFileSync(readmePath, 'utf8');
  return {
    readmePath: 'README.md',
    readme,
    sections: parseReadmeSections(readme),
    svgFiles: listSvgFiles(),
    assetDir: 'docs/assets'
  };
}

async function handleApi(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/state') {
    sendJson(response, 200, buildStatePayload());
    return true;
  }

  if (request.method === 'GET' && pathname.startsWith('/api/svg/')) {
    const assetName = pathname.slice('/api/svg/'.length);
    if (assetName.includes('/')) {
      sendText(response, 404, 'Not found');
      return true;
    }
    const svgPath = resolveSvgPath(assetName);
    if (!svgPath) {
      sendText(response, 404, 'SVG not found');
      return true;
    }
    const content = fs.readFileSync(svgPath, 'utf8');
    sendJson(response, 200, {
      name: assetName,
      path: `docs/assets/${assetName}`,
      content,
      colors: extractHexColors(content),
      supportsTemplate: assetName === 'benchmark-summary.svg'
    });
    return true;
  }

  if (request.method === 'POST' && pathname === '/api/readme') {
    const body = await parseJsonBody(request);
    const markdown = String(body.markdown || '');
    fs.writeFileSync(readmePath, markdown, 'utf8');
    sendJson(response, 200, {
      ok: true,
      bytes: Buffer.byteLength(markdown),
      sections: parseReadmeSections(markdown)
    });
    return true;
  }

  if (request.method === 'POST' && pathname.startsWith('/api/svg/') && pathname.endsWith('/template')) {
    const assetName = pathname.slice('/api/svg/'.length, -'/template'.length);
    if (assetName !== 'benchmark-summary.svg') {
      sendText(response, 404, 'Template mode not supported for this asset');
      return true;
    }
    const body = await parseJsonBody(request);
    const content = buildBenchmarkSummarySvg(body || {});
    sendJson(response, 200, {
      name: assetName,
      content,
      colors: extractHexColors(content)
    });
    return true;
  }

  if (request.method === 'POST' && pathname.startsWith('/api/svg/')) {
    const assetName = pathname.slice('/api/svg/'.length);
    if (assetName.includes('/')) {
      sendText(response, 404, 'Not found');
      return true;
    }
    const svgPath = resolveSvgPath(assetName);
    if (!svgPath) {
      sendText(response, 404, 'SVG not found');
      return true;
    }
    const body = await parseJsonBody(request);
    const content = String(body.content || '');
    fs.writeFileSync(svgPath, content, 'utf8');
    sendJson(response, 200, {
      ok: true,
      bytes: Buffer.byteLength(content),
      colors: extractHexColors(content)
    });
    return true;
  }

  return false;
}

function createServer() {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const handled = await handleApi(request, response, url.pathname);
      if (!handled) sendStatic(response, url.pathname);
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: error && error.message ? error.message : String(error)
      });
    }
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const server = createServer();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, resolve);
  });

  console.log(`README playground live at http://${options.host}:${options.port}${defaultPlaygroundPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  buildStatePayload,
  createServer,
  listSvgFiles,
  parseArgs,
  resolveSvgPath
};
