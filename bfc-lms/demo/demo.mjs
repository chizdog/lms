import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE = path.join(__dirname, 'chrome-profile');
const SHOTS = path.join(__dirname, 'shots');
const PORT = 9222;
const APP = 'http://127.0.0.1:4000';
const VIEW = { width: 1440, height: 900 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJSON(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
      let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

async function launch() {
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    `--window-size=${VIEW.width + 16},${VIEW.height + 120}`,
    '--window-position=30,20',
    '--no-first-run', '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter,CalculateNativeWinOcclusion',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    `${APP}/login`,
  ];
  const child = spawn(CHROME, args, { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 80; i++) {
    try { const v = await getJSON('/json/version'); if (v.webSocketDebuggerUrl) { console.log('Chrome up:', v.Browser); return; } } catch {}
    await sleep(500);
  }
  throw new Error('Chrome did not expose debugging endpoint');
}

async function connect() {
  const list = await getJSON('/json/list');
  const page = list.find((t) => t.type === 'page' && t.url.startsWith(APP)) || list.find((t) => t.type === 'page');
  if (!page) throw new Error('No page target found');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    const timer = setTimeout(() => { pending.delete(mid); rej(new Error('CDP timeout: ' + method)); }, 20000);
    pending.set(mid, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: false });
  const evalJS = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails));
    return r.result.value;
  };
  const close = () => { try { ws.close(); } catch {} };
  return { send, evalJS, close, page };
}

async function waitFor(c, selector, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ok = await c.evalJS(`!!document.querySelector(${JSON.stringify(selector)})`);
    if (ok) return true;
    await sleep(250);
  }
  throw new Error('timeout waiting for ' + selector);
}

async function goto(c, urlPath, waitSel) {
  await c.send('Page.navigate', { url: APP + urlPath });
  // wait until the SPA has actually committed to the target route
  const target = urlPath.split('?')[0];
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const p = await c.evalJS('location.pathname');
    if (p === target) break;
    await sleep(200);
  }
  if (waitSel) { try { await waitFor(c, waitSel); } catch {} }
  await sleep(1800); // let react-query data + charts settle
}

async function shot(c, name, full = false) {
  try { await c.send('Page.bringToFront'); } catch {}
  const { data } = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
  const file = path.join(SHOTS, name + '.png');
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`shot ${name}.png (${kb}kb)`);
}

async function clickText(c, text, tag = 'button') {
  const clicked = await c.evalJS(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(tag)})];
    const el = els.find(e => (e.innerText||'').trim().includes(${JSON.stringify(text)}));
    if (el) { el.click(); return true; } return false;
  })()`);
  if (!clicked) throw new Error('click target not found: ' + text);
  await sleep(400);
}

async function login(c, identifier) {
  await c.send('Network.clearBrowserCookies');
  await goto(c, '/login', 'form');
  await clickText(c, identifier); // demo quick-fill button (fills username + password)
  await sleep(300);
  await c.evalJS(`document.querySelector('form button[type="submit"]').click()`);
  await sleep(2500);
  const url = await c.evalJS('location.pathname');
  console.log('after login ->', url);
  return url;
}

const ADMIN_ROUTES = [
  ['/', '01-dashboard', 'main'],
  ['/employees', '02-employees', 'table'],
  ['/organization', '03-organization', 'main'],
  ['/users', '04-users', 'table'],
  ['/courses', '05-courses', 'main'],
  ['/courses/1', '06-course-detail', 'main'],
  ['/courses/new', '07-course-new', 'form'],
  ['/categories', '08-categories', 'main'],
  ['/quizzes', '09-quizzes', 'main'],
  ['/quizzes/1/edit', '10-quiz-edit', 'main'],
  ['/quizzes/new', '11-quiz-new', 'form'],
  ['/quizzes/attempts/1', '12-attempt-result', 'main'],
  ['/assignments', '13-assignments', 'table'],
  ['/certificates', '14-certificates', 'table'],
  ['/reports', '15-reports', 'main'],
  ['/notifications', '16-notifications', 'main'],
  ['/settings', '17-settings', 'main'],
  ['/profile', '18-profile', 'main'],
];

const LEARNER_ROUTES = [
  ['/learner', '20-learner-dashboard', 'main'],
  ['/learner/catalog', '21-learner-catalog', 'main'],
  ['/learner/courses/1', '22-learner-player', 'main'],
  ['/learner/quizzes/1/take', '23-learner-quiz', 'main'],
  ['/learner/certificates', '24-learner-certs', 'main'],
  ['/learner/attempts/4', '25-learner-attempt', 'main'],
];

async function tour(role) {
  const c = await connect();
  const routes = role === 'learner' ? LEARNER_ROUTES : ADMIN_ROUTES;
  for (const [p, name, sel] of routes) {
    try {
      await goto(c, p, sel === 'table' ? 'table' : sel === 'form' ? 'form' : 'main');
      await shot(c, name);
    } catch (e) { console.log('FAIL', name, e.message); }
  }
  c.close();
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'close') {
    const v = await getJSON('/json/version');
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    await sleep(800); try { ws.close(); } catch {}
    console.log('chrome closed'); return;
  }
  if (cmd === 'launch') { await launch(); return; }
  if (cmd === 'inspect') {
    const c = await connect();
    const info = await c.evalJS(`(() => ({ url: location.href, title: document.title, inputs: [...document.querySelectorAll('input')].map(i=>({type:i.type,ac:i.autocomplete,ph:i.placeholder})), buttons: [...document.querySelectorAll('button')].slice(0,12).map(b=>(b.innerText||'').trim().slice(0,30)) }))()`);
    console.log(JSON.stringify(info, null, 2)); c.close(); return;
  }
  if (cmd === 'login') {
    const c = await connect();
    await login(c, process.argv[3] || 'superadmin');
    await shot(c, process.argv[3] === 'employee' ? '19-employee-login-dashboard' : '00-login-dashboard');
    c.close(); return;
  }
  if (cmd === 'shotlogin') {
    const c = await connect(); await goto(c, '/login', 'form'); await shot(c, '00-login'); c.close(); return;
  }
  if (cmd === 'tour') { await tour(process.argv[3] || 'admin'); return; }
  if (cmd === 'debug') {
    const c = await connect();
    await goto(c, process.argv[3], 'main');
    const info = await c.evalJS(`({path:location.pathname, heads:[...document.querySelectorAll('h1,h2')].map(x=>x.innerText).slice(0,3)})`);
    console.log(JSON.stringify(info));
    await shot(c, process.argv[4] || 'debug');
    c.close(); return;
  }
  if (cmd === 'shot') {
    const c = await connect(); await goto(c, process.argv[3], process.argv[5] || 'main'); await shot(c, process.argv[4], process.argv[6] === 'full'); c.close(); return;
  }
  console.log('commands: launch | inspect | login <id> | shotlogin | tour <admin|learner> | shot <path> <name> [sel] [full]');
}

main().catch((e) => { console.error('ERROR', e.message); process.exit(1); });