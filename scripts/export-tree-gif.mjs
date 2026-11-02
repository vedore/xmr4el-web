// Record the home page beam-search tree (one animation cycle) as light and dark GIFs.
// Needs a build (npm run build), Google Chrome and ffmpeg. Usage: node scripts/export-tree-gif.mjs
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4329;
const URL = `http://localhost:${PORT}/XMR4EL/`;
const CYCLE = 6 * 1800; // ms; six steps of 1.8 s, matches the tree script in src/pages/index.astro
const OUT = 'docs/assets';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = mkdtempSync(join(tmpdir(), 'tree-gif-'));
// Static server for dist/ under the site base (astro preview runs as a shared daemon)
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  let path = 'dist' + decodeURIComponent(new globalThis.URL(req.url, URL).pathname).replace(/^\/XMR4EL/, '');
  if (path.endsWith('/')) path += 'index.html';
  let body;
  try { body = readFileSync(path); } catch { return res.writeHead(404).end(); }
  res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body);
}).listen(PORT);
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${tmp}/profile`,
  '--hide-scrollbars', '--mute-audio', 'about:blank'], { stdio: 'ignore' });

try {
  // Wait for Chrome's DevTools port
  let port;
  for (;;) { try { port = readFileSync(`${tmp}/profile/DevToolsActivePort`, 'utf8').split('\n')[0]; break; } catch {} await sleep(200); }
  const [page] = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === 'page');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) pending.get(m.id)(m.result);
    else events.push(m.method);
  });
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 900, deviceScaleFactor: 2, mobile: false });
  mkdirSync(OUT, { recursive: true });

  for (const theme of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    events.length = 0;
    await send('Page.navigate', { url: URL });
    while (!events.includes('Page.loadEventFired')) await sleep(50);
    const r = await evaluate(`document.fonts.ready.then(() => {
      const el = document.querySelector('.tree-fig');
      el.scrollIntoView({ block: 'center' });
      const b = el.getBoundingClientRect(), pad = 24;
      return { x: b.x - pad + scrollX, y: b.y - pad + scrollY, width: b.width + 2 * pad, height: b.height + 2 * pad };
    })`);

    // Capture as fast as possible for one cycle; real timestamps give each frame its duration
    const frames = [];
    const t0 = Date.now();
    while (Date.now() - t0 < CYCLE) {
      const t = Date.now() - t0;
      const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } });
      const f = join(tmp, `${theme}-${frames.length}.png`);
      writeFileSync(f, Buffer.from(data, 'base64'));
      frames.push({ f, t });
    }
    const list = frames.map(({ f, t }, i) => `file '${f}'\nduration ${((frames[i + 1]?.t ?? CYCLE) - t) / 1000}`);
    writeFileSync(join(tmp, `${theme}.txt`), list.join('\n') + `\nfile '${frames.at(-1).f}'\n`);

    const out = `${OUT}/beam-search-tree-${theme}.gif`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(tmp, `${theme}.txt`),
      '-vf', 'scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none',
      '-loop', '0', out]);
    console.log(`${out}: ${frames.length} frames`);
  }
  ws.close();
} finally {
  chrome.kill();
  server.close();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); // Chrome may still be writing its profile
}
