const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-pos-smoke-'));
const port = 4873 + Math.floor(Math.random() * 200);
const baseUrl = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ['server.js'], {
  cwd: rootDir,
  env: {
    ...process.env,
    PORT: String(port),
    POS_DATA_DIR: dataDir,
    POS_STATE_FILE: 'cloud-state.json'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';
server.stdout.on('data', chunk => { stdout += chunk.toString(); });
server.stderr.on('data', chunk => { stderr += chunk.toString(); });

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`${baseUrl}/api/index.php?action=status`);
      if (res.ok) return;
    } catch {
      // Keep polling until the server is ready.
    }
    await wait(150);
  }
  throw new Error(`Server did not start.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

function cookieFrom(response) {
  return response.headers.get('set-cookie')?.split(';')[0] || '';
}

function sampleState() {
  return {
    categories: [{ id: 'c1', name: 'Food', color: '#10b981' }],
    products: [{ id: 'p1', name: 'Tea', price: 1000, categoryId: 'c1', track_inventory: false, stock: 0 }],
    tables: [{ id: 1, name: 'Table 1', status: 'free', x: 20, y: 20, floor: 'main' }],
    orders: [],
    salesHistory: [],
    marketExpenses: [],
    users: [{ id: 'u1', username: 'admin', password: '1991', role: 'admin', name: 'Admin 1' }],
    settings: { restaurantName: 'Pandora POS', currency: 'MMK', taxRate: 0 }
  };
}

(async () => {
  try {
    await waitForServer();

    const statusRes = await fetch(`${baseUrl}/api/index.php?action=status`);
    assert.equal(statusRes.status, 200);
    const status = await statusRes.json();
    assert.equal(status.ok, true);
    assert.equal(status.authenticated, false);
    assert.equal(typeof status.backups.count, 'number');

    const badLoginRes = await fetch(`${baseUrl}/api/index.php?action=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' })
    });
    assert.equal(badLoginRes.status, 401);

    const loginRes = await fetch(`${baseUrl}/api/index.php?action=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '1991' })
    });
    assert.equal(loginRes.status, 200);
    const cookie = cookieFrom(loginRes);
    const login = await loginRes.json();
    assert.ok(cookie);
    assert.ok(login.csrfToken);

    const statePutRes = await fetch(`${baseUrl}/api/index.php?action=state`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie,
        'X-CSRF-Token': login.csrfToken
      },
      body: JSON.stringify({ baseVersion: 0, state: sampleState() })
    });
    assert.equal(statePutRes.status, 200);
    const statePut = await statePutRes.json();
    assert.equal(statePut.version, 1);

    const legacyPutRes = await fetch(`${baseUrl}/api/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: sampleState() })
    });
    assert.equal(legacyPutRes.status, 410);

    assert.ok(fs.existsSync(path.join(dataDir, 'cloud-state.json')));
    assert.ok(fs.existsSync(path.join(dataDir, 'audit-log.jsonl')));
    const audit = fs.readFileSync(path.join(dataDir, 'audit-log.jsonl'), 'utf8');
    assert.match(audit, /login_success/);
    assert.match(audit, /state_update/);

    console.log('POS server API smoke checks passed.');
  } finally {
    server.kill();
  }
})().catch(error => {
  server.kill();
  console.error(error);
  process.exit(1);
});
