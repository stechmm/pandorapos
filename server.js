const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const rootDir = __dirname;
const dataDir = process.env.POS_DATA_DIR || rootDir;
const stateFile = path.join(dataDir, process.env.POS_STATE_FILE || "cloud-state.json");
const backupStateFile = `${stateFile}.bak`;
const port = Number(process.env.PORT || 4173);

const defaultUsers = [
  { id: "u1", username: "admin", name: "Admin 1", role: "admin", password: "1991" },
  { id: "u2", username: "waiter", name: "Waiter 1", role: "waiter", password: "1212" },
  { id: "u3", username: "cashier", name: "Cashier 1", role: "cashier", password: "1500" },
  { id: "u4", username: "owner", name: "Owner", role: "owner", password: "123", allowedTabs: ["dashboard-pane", "reports-pane"] }
];

let store = {
  version: 0,
  updatedAt: new Date().toISOString(),
  state: null
};

const sessions = new Map();
const eventClients = new Set();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function loadStore() {
  if (!fs.existsSync(stateFile)) return;
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (saved && typeof saved === "object") {
      // New online shape.
      if ("state" in saved) {
        store = {
          version: Number(saved.version || 0),
          updatedAt: saved.updatedAt || new Date().toISOString(),
          state: saved.state || null
        };
        return;
      }
      // Legacy demo shape: { version, payload }.
      if ("payload" in saved) {
        store = {
          version: Number(saved.version || 0),
          updatedAt: saved.updatedAt || new Date().toISOString(),
          state: saved.payload || null
        };
      }
    }
  } catch (error) {
    console.warn("Could not read POS state file:", error.message);
  }
}

function saveStore() {
  fs.mkdirSync(dataDir, { recursive: true });
  const tempFile = `${stateFile}.${process.pid}.tmp`;
  if (fs.existsSync(stateFile)) {
    fs.copyFileSync(stateFile, backupStateFile);
  }
  fs.writeFileSync(tempFile, JSON.stringify(store, null, 2));
  fs.renameSync(tempFile, stateFile);
}

function parseCookies(header = "") {
  return header.split(";").reduce((cookies, item) => {
    const [rawKey, ...rest] = item.trim().split("=");
    if (!rawKey) return cookies;
    cookies[rawKey] = decodeURIComponent(rest.join("=") || "");
    return cookies;
  }, {});
}

function makeToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("hex");
}

function getSession(request) {
  const cookies = parseCookies(request.headers.cookie || "");
  const sid = cookies.pos_session;
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  session.lastSeen = Date.now();
  return session;
}

function getUsers() {
  const stateUsers = Array.isArray(store.state && store.state.users) ? store.state.users : [];
  const merged = new Map(defaultUsers.map((user) => [user.username.toLowerCase(), user]));
  stateUsers.forEach((user) => {
    if (user && user.username) merged.set(String(user.username).toLowerCase(), user);
  });
  return Array.from(merged.values());
}

function getLanAddress() {
  return Object.values(os.networkInterfaces())
    .flat()
    .find((item) => item && item.family === "IPv4" && !item.internal)?.address || "127.0.0.1";
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  const allowedOrigin = process.env.CORS_ORIGIN || origin || "*";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Vary": "Origin"
  };
}

function sendJson(request, response, statusCode, data, extraHeaders = {}) {
  response.writeHead(statusCode, {
    ...corsHeaders(request),
    ...extraHeaders,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        request.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function readJsonBody(request) {
  const raw = await readBody(request);
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function requireCsrf(request, session) {
  const token = request.headers["x-csrf-token"];
  return Boolean(session && token && token === session.csrfToken);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role
  };
}

function notifyStateUpdated() {
  const event = `event: update\ndata: ${JSON.stringify({ version: store.version, updatedAt: store.updatedAt })}\n\n`;
  for (const response of eventClients) {
    try {
      response.write(event);
    } catch {
      eventClients.delete(response);
    }
  }
}

function sendSse(request, response) {
  response.writeHead(200, {
    ...corsHeaders(request),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.write(`event: connected\ndata: ${JSON.stringify({ version: store.version })}\n\n`);
  eventClients.add(response);
  const ping = setInterval(() => {
    try {
      response.write(`event: ping\ndata: ${Date.now()}\n\n`);
    } catch {
      clearInterval(ping);
      eventClients.delete(response);
    }
  }, 25000);
  request.on("close", () => {
    clearInterval(ping);
    eventClients.delete(response);
  });
}

function updateStore(nextState) {
  store = {
    version: store.version + 1,
    updatedAt: new Date().toISOString(),
    state: nextState || {}
  };
  saveStore();
  notifyStateUpdated();
}

async function handleApi(request, response, requestUrl) {
  const action = requestUrl.searchParams.get("action") || "";
  const session = getSession(request);

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders(request));
    response.end();
    return;
  }

  if (action === "status") {
    sendJson(request, response, 200, {
      ok: true,
      authenticated: Boolean(session),
      user: session ? publicUser(session.user) : null,
      csrfToken: session ? session.csrfToken : null,
      version: store.version,
      localIp: getLanAddress()
    });
    return;
  }

  if (action === "login" && request.method === "POST") {
    const body = await readJsonBody(request);
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const user = getUsers().find((item) => {
      return String(item.username || "").trim().toLowerCase() === username &&
        String(item.password || "") === password;
    });
    if (!user) {
      sendJson(request, response, 401, { error: "Invalid username or password." });
      return;
    }
    const sid = makeToken();
    const csrfToken = makeToken(16);
    sessions.set(sid, {
      id: sid,
      csrfToken,
      user: publicUser(user),
      createdAt: Date.now(),
      lastSeen: Date.now()
    });
    sendJson(request, response, 200, {
      ok: true,
      user: publicUser(user),
      csrfToken
    }, {
      "Set-Cookie": `pos_session=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax`
    });
    return;
  }

  if (action === "logout" && request.method === "POST") {
    const cookies = parseCookies(request.headers.cookie || "");
    if (cookies.pos_session) sessions.delete(cookies.pos_session);
    sendJson(request, response, 200, { ok: true }, {
      "Set-Cookie": "pos_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"
    });
    return;
  }

  if (action === "events" && request.method === "GET") {
    sendSse(request, response);
    return;
  }

  if (action === "state" && request.method === "GET") {
    sendJson(request, response, 200, {
      exists: Boolean(store.state),
      version: store.version,
      updatedAt: store.updatedAt,
      state: store.state
    });
    return;
  }

  if (action === "state" && request.method === "PUT") {
    if (!session) {
      sendJson(request, response, 401, { error: "Login required." });
      return;
    }
    if (!requireCsrf(request, session)) {
      sendJson(request, response, 403, { error: "Invalid CSRF token." });
      return;
    }
    const body = await readJsonBody(request);
    const baseVersion = Number(body.baseVersion || 0);
    if (baseVersion !== store.version) {
      sendJson(request, response, 409, {
        error: "State version conflict.",
        exists: Boolean(store.state),
        version: store.version,
        updatedAt: store.updatedAt,
        state: store.state
      });
      return;
    }
    updateStore(body.state || {});
    sendJson(request, response, 200, {
      ok: true,
      exists: true,
      version: store.version,
      updatedAt: store.updatedAt,
      state: store.state
    });
    return;
  }

  sendJson(request, response, 404, { error: `Unknown API action: ${action}` });
}

async function handleLegacyState(request, response) {
  if (request.method === "GET") {
    sendJson(request, response, 200, {
      version: store.version,
      updatedAt: store.updatedAt,
      payload: store.state
    });
    return;
  }

  if (request.method === "PUT") {
    const body = await readJsonBody(request);
    updateStore(body.payload || body.state || {});
    sendJson(request, response, 200, {
      version: store.version,
      updatedAt: store.updatedAt,
      payload: store.state
    });
    return;
  }

  sendJson(request, response, 405, { error: "Method not allowed." });
}

function serveStatic(request, response, requestUrl) {
  const cleanPath = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
  const filePath = path.normalize(path.join(rootDir, cleanPath));
  if (!filePath.startsWith(rootDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(content);
  });
}

loadStore();

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (requestUrl.pathname === "/api/index.php") {
      await handleApi(request, response, requestUrl);
      return;
    }
    if (requestUrl.pathname === "/api/state") {
      await handleLegacyState(request, response);
      return;
    }
    if (requestUrl.pathname === "/api/cloud-download" || requestUrl.pathname === "/api/cloud-upload") {
      sendJson(request, response, 501, { error: "Cloud proxy is disabled in the online API server. Use the central state API directly." });
      return;
    }
    serveStatic(request, response, requestUrl);
  } catch (error) {
    sendJson(request, response, 500, { error: error.message });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log("");
  console.log("Pandora POS online-ready server is running.");
  console.log(`Local:   http://localhost:${port}`);
  console.log(`Network: http://${getLanAddress()}:${port}`);
  console.log(`API:     http://localhost:${port}/api/index.php`);
  console.log("");
});
