const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const querystring = require('querystring');

const PORT = 8000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SESSION_MAX_AGE = 24 * 60 * 60;
const REMEMBER_MAX_AGE = 30 * 24 * 60 * 60;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@(gmail\.com|mail\.ru|yahoo\.com|yahoo\.co\.uk|outlook\.com|outlook\.co\.uk|hotmail\.com|live\.com)$/i;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', 'utf8');

function readSessions() {
  try {
    const storedSessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    return new Map(Object.entries(storedSessions).filter(([, session]) => session.expiresAt > Date.now()));
  } catch (error) {
    return new Map();
  }
}

const sessions = readSessions();

function sessionKey(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function saveSessions() {
  const activeSessions = [...sessions].filter(([, session]) => session.expiresAt > Date.now());
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(activeSessions), null, 2), 'utf8');
}

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (error) {
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedValue) {
  const [salt, storedHash] = String(storedValue).split(':');
  if (!salt || !storedHash) return false;
  const actualHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(storedHash, 'hex'));
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map(cookie => {
    const separator = cookie.indexOf('=');
    return [cookie.slice(0, separator).trim(), decodeURIComponent(cookie.slice(separator + 1))];
  }));
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) parts.push('HttpOnly');
  return parts.join('; ');
}

function redirect(response, location, headers = {}) {
  response.writeHead(302, { Location: location, ...headers });
  response.end();
}

function message(text, type) {
  return `/index.html?msg=${encodeURIComponent(text)}&type=${type}`;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 100000) request.destroy();
    });
    request.on('end', () => resolve(querystring.parse(body)));
    request.on('error', reject);
  });
}

function currentUser(request) {
  const token = parseCookies(request).oa_session;
  if (!token) return null;

  const key = sessionKey(token);
  const session = sessions.get(key);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(key);
    saveSessions();
    return null;
  }

  return { name: session.name, email: session.email };
}

function serveStatic(request, response, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(ROOT, `.${requested}`);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.md': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg'
  };
  response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    const cookies = parseCookies(request);
    if (request.method === 'GET' && (pathname === '/' || pathname === '/index.html') && currentUser(request) && cookies.oa_remember_login) {
      redirect(response, '/dashboard.html');
      return;
    }

    if (request.method === 'GET' && pathname === '/api/check-email') {
      const email = normalizeEmail(url.searchParams.get('email'));
      const exists = readUsers().some(user => normalizeEmail(user.email) === email);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ exists }));
      return;
    }

    if (request.method === 'GET' && pathname === '/api/me') {
      const user = currentUser(request);
      if (!user) {
        response.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ...user, remembered: Boolean(cookies.oa_remember_login) }));
      return;
    }

    if (request.method === 'GET' && pathname === '/logout') {
      const cookies = parseCookies(request);
      if (cookies.oa_session) {
        sessions.delete(sessionKey(cookies.oa_session));
        saveSessions();
      }
      redirect(response, `${message('Вы вышли из аккаунта', 'success')}&loggedOut=1`, {
        'Set-Cookie': [
          cookie('oa_session', '', { maxAge: 0, httpOnly: true }),
          cookie('oa_remember_login', '', { maxAge: 0, httpOnly: true }),
          cookie('oa_remember_email', '', { maxAge: 0 })
        ]
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/register') {
      const fields = await readBody(request);
      const name = String(fields.name || '').trim();
      const email = normalizeEmail(fields.email);
      const password = String(fields.password || '');
      const password2 = String(fields.password2 || '');
      const users = readUsers();

      if (name.length < 2) return redirect(response, message('Имя должно быть не короче 2 символов', 'error'));
      if (!EMAIL_REGEX.test(email)) return redirect(response, message('Разрешены Gmail, Mail.ru, Yahoo и Outlook', 'error'));
      if (password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
        return redirect(response, message('Пароль: минимум 8 символов, заглавная, строчная буква и цифра', 'error'));
      }
      if (password !== password2) return redirect(response, message('Пароли не совпадают', 'error'));
      if (users.some(user => normalizeEmail(user.email) === email)) return redirect(response, message('Этот email уже зарегистрирован', 'error'));

      users.push({ id: crypto.randomUUID(), name, email, passwordHash: hashPassword(password), createdAt: new Date().toISOString() });
      writeUsers(users);
      return redirect(response, message('Регистрация успешна, теперь войдите', 'success'));
    }

    if (request.method === 'POST' && pathname === '/login') {
      const fields = await readBody(request);
      const email = normalizeEmail(fields.email);
      const user = readUsers().find(item => normalizeEmail(item.email) === email);
      if (!user || !verifyPassword(String(fields.password || ''), user.passwordHash)) {
        return redirect(response, message('Неверный email или пароль', 'error'));
      }

      const token = crypto.randomBytes(32).toString('hex');
      const remember = Boolean(fields.remember);
      const sessionMaxAge = remember ? REMEMBER_MAX_AGE : SESSION_MAX_AGE;
      sessions.set(sessionKey(token), {
        name: user.name,
        email: user.email,
        expiresAt: Date.now() + sessionMaxAge * 1000
      });
      saveSessions();
      const sessionCookieOptions = remember
        ? { maxAge: sessionMaxAge, httpOnly: true }
        : { httpOnly: true };
      const headers = { 'Set-Cookie': [cookie('oa_session', token, sessionCookieOptions)] };
      headers['Set-Cookie'].push(remember
        ? cookie('oa_remember_login', '1', { maxAge: REMEMBER_MAX_AGE, httpOnly: true })
        : cookie('oa_remember_login', '', { maxAge: 0, httpOnly: true }));
      headers['Set-Cookie'].push(remember
        ? cookie('oa_remember_email', email, { maxAge: REMEMBER_MAX_AGE })
        : cookie('oa_remember_email', '', { maxAge: 0 }));
      return redirect(response, remember ? '/dashboard.html?remembered=1' : '/dashboard.html?tabSession=1', headers);
    }

    serveStatic(request, response, pathname);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Server error');
    console.error(error);
  }
});

server.listen(PORT, () => {
  console.log(`OA site running at http://localhost:${PORT}`);
});
