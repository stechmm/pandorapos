const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const PORT = Number(process.env.PANDORA_PRINT_BRIDGE_PORT || 4788);
const JOB_DIR = path.join(os.tmpdir(), 'pandora-print-bridge');
const VERSION = '1.0.0';

fs.mkdirSync(JOB_DIR, { recursive: true });

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error('Request body too large.'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function runPowerShell(args, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], {
      windowsHide: true,
      timeout: timeoutMs
    }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
    child.stdin?.end();
  });
}

async function getPrinters() {
  if (process.platform !== 'win32') return [];
  const script = [
    '$items = Get-CimInstance Win32_Printer | Select-Object Name,DriverName,PortName,Default,WorkOffline,PrinterStatus;',
    '$items | ConvertTo-Json -Compress'
  ].join(' ');
  const output = (await runPowerShell(['-Command', script])).trim();
  if (!output) return [];
  const raw = JSON.parse(output);
  const rows = Array.isArray(raw) ? raw : [raw];
  return rows.map(row => ({
    name: row.Name || '',
    driverName: row.DriverName || '',
    portName: row.PortName || '',
    isDefault: Boolean(row.Default),
    offline: Boolean(row.WorkOffline),
    status: row.PrinterStatus || null
  })).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

async function setDefaultPrinter(printerName) {
  if (!printerName || process.platform !== 'win32') return;
  const safeName = String(printerName).replace(/'/g, "''");
  const script = [
    `$printer = Get-CimInstance Win32_Printer -Filter "Name='${safeName}'" -ErrorAction SilentlyContinue;`,
    'if ($printer) {',
    `  (New-Object -ComObject WScript.Network).SetDefaultPrinter('${safeName}');`,
    '}'
  ].join(' ');
  await runPowerShell(['-Command', script], 8000);
}

function findBrowser() {
  const candidates = [
    path.join(process.env.ProgramFiles || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft\\Edge\\Application\\msedge.exe')
  ];
  return candidates.find(file => file && fs.existsSync(file));
}

function buildPrintHtml({ html, title, paperSize }) {
  const width = paperSize === '58mm' ? '58mm' : '80mm';
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${String(title || 'Pandora Print Slip').replace(/[<>]/g, '')}</title>
  <style>
    @page { size: ${width} auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
      font-family: Arial, "Myanmar Text", "Noto Sans Myanmar", sans-serif;
      font-size: 11px;
      line-height: 1.35;
      font-weight: 400;
    }
    .print-paper {
      width: ${width};
      max-width: 100%;
      margin: 0 auto;
      padding: 6px 6px 18mm;
      background: #fff;
    }
    .receipt-header { text-align: center; margin-bottom: 10px; }
    .receipt-kitchen-header { margin-bottom: 6px; }
    .receipt-kitchen-title { font-size: 15px; font-weight: 800; letter-spacing: 0; }
    .receipt-kitchen-subtitle { font-size: 11px; margin-top: 2px; }
    .receipt-title { font-size: 15px; font-weight: 800; }
    .receipt-subtitle { font-size: 11px; margin-top: 3px; }
    .receipt-divider { border-top: 1px dashed #000; margin: 7px 0; }
    .receipt-info-row,
    .receipt-item-row,
    .receipt-total-row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 4px;
    }
    .receipt-item-name { flex: 1; overflow-wrap: anywhere; }
    .receipt-item-qty-price { white-space: nowrap; }
    .receipt-item-note { margin: 2px 0 5px 10px; font-size: 10px; }
    .receipt-inset-section { padding-left: 3mm; padding-right: 3mm; }
    .receipt-payment-row span:last-child { padding-right: 1mm; white-space: nowrap; }
    .receipt-kitchen-items { margin-top: 4px; }
    .receipt-kitchen-item { display: block; margin-bottom: 10px; line-height: 1.3; font-size: 12px; font-weight: 700; }
    .receipt-kitchen-note { margin-left: 14px; font-size: 10px; font-style: normal; font-weight: 700; }
    .receipt-kitchen-footer { margin-top: 10px; font-size: 12px; font-weight: 700; }
    .receipt-total-row.grand { font-weight: 800; border-top: 1px solid #000; padding-top: 5px; }
    .receipt-footer { text-align: center; margin-top: 12px; padding-bottom: 12mm; }
    .receipt-page-break { page-break-after: always; break-after: page; height: 0; overflow: hidden; }
    img { display: none !important; }
  </style>
</head>
<body>
  <div class="print-paper">${html || ''}</div>
  <script>
    window.addEventListener('load', function () {
      setTimeout(function () {
        window.focus();
        window.print();
        setTimeout(function () { window.close(); }, 800);
      }, 250);
    });
  </script>
</body>
</html>`;
}

async function printHtml(payload) {
  const browser = findBrowser();
  if (!browser) throw new Error('Chrome or Microsoft Edge was not found.');
  if (payload.printerName) await setDefaultPrinter(payload.printerName);

  const fileName = `pandora-print-${Date.now()}-${Math.random().toString(16).slice(2)}.html`;
  const filePath = path.join(JOB_DIR, fileName);
  fs.writeFileSync(filePath, buildPrintHtml(payload), 'utf8');

  const child = spawn(browser, [
    '--kiosk-printing',
    '--new-window',
    `file:///${filePath.replace(/\\/g, '/')}`
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
  return filePath;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  try {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true, name: 'Pandora Local Print Bridge', version: VERSION });
      return;
    }

    if (req.method === 'GET' && req.url === '/printers') {
      const printers = await getPrinters();
      sendJson(res, 200, { ok: true, printers });
      return;
    }

    if (req.method === 'POST' && req.url === '/print-html') {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      if (!payload.html) throw new Error('Missing print HTML.');
      const jobFile = await printHtml(payload);
      sendJson(res, 200, { ok: true, jobFile, printerName: payload.printerName || '' });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { ok: false, error: error.message || 'Print bridge error.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Pandora Local Print Bridge ${VERSION}`);
  console.log(`Listening on http://127.0.0.1:${PORT}`);
  console.log('Keep this window open while using Pandora POS printing.');
});
