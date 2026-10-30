// ตรวจเว็บจริงด้วยเบราว์เซอร์ที่ต่ออินเทอร์เน็ต (รันใน GitHub Actions: .github/workflows/site-check.yml)
// SITES="ชื่อ=URL,ชื่อ=URL"  เช่น live=https://karanb2308.github.io/MATERIX/,branch=http://127.0.0.1:8000/
import { chromium } from 'playwright';

const SITES = (process.env.SITES || 'live=https://karanb2308.github.io/MATERIX/')
  .split(',').map((s) => s.split('=')).map(([name, url]) => ({ name, url }));

const AREAS = [
  ['สนามหลวง', 13.7563, 100.5018, 5],
  ['บางนา', 13.668, 100.605, 10],
  ['รังสิต', 13.9877, 100.6177, 10],
  ['เชียงใหม่', 18.7883, 98.9853, 10],
  ['ขอนแก่น', 16.4322, 102.8236, 20],
  ['อุดรธานี', 17.4138, 102.7872, 10],
  ['ภูเก็ต', 7.8804, 98.3923, 10],
  ['หาดใหญ่', 7.0086, 100.4747, 30]
];
const PLACES = ['บางนา', 'ตลาดไท', 'อำเภอเมืองขอนแก่น', 'ขอนแก่น', 'รังสิต', 'เซ็นทรัลเวิลด์', 'หัวหิน', 'ร้านเหล็ก', 'ไทวัสดุ', 'ปูน'];

const log = (...a) => console.log('CHECK', ...a);
const host = (u) => { try { return new URL(u).host; } catch (e) { return u; } };

async function timeFetch(label, url, init) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
    const body = await res.text();
    log(`api ${label}: HTTP ${res.status} in ${Date.now() - t0} ms, ${body.length} bytes`);
  } catch (e) {
    log(`api ${label}: FAILED after ${Date.now() - t0} ms: ${e.message}`);
  }
}

async function newPage(browser) {
  const ctx = await browser.newContext({ locale: 'th-TH', timezoneId: 'Asia/Bangkok', viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const net = [];
  const errors = [];
  page.on('requestfinished', async (req) => {
    try {
      const res = await req.response();
      net.push({ url: req.url(), status: res ? res.status() : 0, ms: req.timing().responseEnd });
    } catch (e) { /* page closed */ }
  });
  page.on('requestfailed', (req) => net.push({ url: req.url(), status: 'FAILED ' + (req.failure() || {}).errorText, ms: -1 }));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  return { ctx, page, net, errors };
}

function summarizeNet(net) {
  const groups = {};
  for (const r of net) {
    const h = host(r.url);
    const key = /\/data\//.test(r.url) ? 'data/' : /overpass|mail\.ru/.test(h) ? 'overpass' : h;
    const g = (groups[key] = groups[key] || { n: 0, bad: 0, max: 0 });
    g.n++;
    if (typeof r.status !== 'number' || r.status >= 400) g.bad++;
    g.max = Math.max(g.max, Math.round(r.ms));
  }
  return Object.entries(groups).filter(([k]) => !/fonts|tile\.openstreetmap/.test(k))
    .map(([k, g]) => `${k}:${g.n}${g.bad ? ` (${g.bad} bad)` : ''} max ${g.max}ms`).join(', ');
}

async function checkSite(browser, site) {
  log(`===== ${site.name}: ${site.url}`);
  const { ctx, page, net } = await newPage(browser);
  for (const path of ['', 'js/app.js', 'data/index.json']) {
    const t0 = Date.now();
    try {
      const res = await page.request.get(site.url + path);
      const body = await res.text();
      const extra = path === 'js/app.js' ? ` loadStaticIndex=${body.includes('loadStaticIndex')}`
        : path === 'data/index.json' ? ` total=${(JSON.parse(body) || {}).total}` : '';
      log(`${site.name} GET /${path}: HTTP ${res.status()} ${Date.now() - t0} ms cache-control="${res.headers()['cache-control']}"${extra}`);
    } catch (e) {
      log(`${site.name} GET /${path}: FAILED ${e.message}`);
    }
  }
  await ctx.close();

  for (const [label, lat, lng, r] of AREAS) {
    const { ctx: c, page: p, net: n, errors } = await newPage(browser);
    const t0 = Date.now();
    let result;
    try {
      await p.goto(`${site.url}?lat=${lat}&lng=${lng}&r=${r}&at=${encodeURIComponent(label)}`, { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => {
        const s = document.querySelector('#status');
        return s && /พบ \d+ ร้าน|ไม่สำเร็จ/.test(s.textContent);
      }, null, { timeout: 120000 });
      const status = (await p.textContent('#status')).replace(/\s+/g, ' ').trim();
      result = `${Date.now() - t0} ms | ${status.slice(0, 120)}`;
    } catch (e) {
      result = `NO RESULT after ${Date.now() - t0} ms (${e.message.split('\n')[0]}) status="${((await p.textContent('#status').catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 100)}"`;
    }
    log(`${site.name} area ${label} ${r}km: ${result}`);
    log(`${site.name}   net: ${summarizeNet(n)}`);
    if (errors.length) log(`${site.name}   errors: ${errors.slice(0, 3).join(' | ')}`);
    await c.close();
  }

  // ค้นหาสถานที่จากช่องค้นหาด้านบน
  const { ctx: pc, page: pp, net: pn } = await newPage(browser);
  await pp.goto(site.url + '?lat=13.7563&lng=100.5018&r=5', { waitUntil: 'domcontentloaded' });
  await pp.waitForTimeout(1500);
  for (const q of PLACES) {
    await pp.evaluate(() => { window.__lastLabel = document.querySelector('#locLabel').textContent; document.querySelector('#placeResults').hidden = true; });
    await pp.fill('#placeInput', q);
    const t0 = Date.now();
    await pp.press('#placeInput', 'Enter');
    let out;
    try {
      await pp.waitForFunction(() => {
        const box = document.querySelector('#placeResults');
        const label = document.querySelector('#locLabel').textContent;
        return (box && !box.hidden && !/กำลังค้นหา/.test(box.textContent)) || window.__lastLabel !== label;
      }, null, { timeout: 30000 });
      const box = await pp.$('#placeResults');
      const visible = box && await box.isVisible();
      out = visible ? (await box.innerText()).replace(/\s+/g, ' ').slice(0, 140) : 'jumped to: ' + await pp.textContent('#locLabel');
    } catch (e) {
      out = 'TIMEOUT';
    }
    log(`${site.name} place "${q}": ${Date.now() - t0} ms -> ${out}`);
  }
  log(`${site.name}   place net: ${summarizeNet(pn)}`);
  await pc.close();

  // ปุ่ม "ใช้ตำแหน่งของฉัน" (จำลองพิกัดที่ขอนแก่น)
  {
    const gctx = await browser.newContext({ locale: 'th-TH', geolocation: { latitude: 16.4322, longitude: 102.8236, accuracy: 30 }, permissions: ['geolocation'] });
    const gp = await gctx.newPage();
    await gp.goto(site.url + '?lat=13.7563&lng=100.5018&r=10', { waitUntil: 'domcontentloaded' });
    await gp.waitForFunction(() => /พบ \d+ ร้าน/.test(document.querySelector('#status').textContent), null, { timeout: 60000 }).catch(() => {});
    const t0 = Date.now();
    await gp.click('#btnLocate');
    try {
      await gp.waitForFunction(() => document.querySelector('#locLabel').textContent.includes('ตำแหน่งของฉัน') &&
        /พบ \d+ ร้าน/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
      log(`${site.name} my location: ${Date.now() - t0} ms | ${(await gp.textContent('#status')).replace(/\s+/g, ' ').slice(0, 80)}`);
    } catch (e) {
      log(`${site.name} my location: NO RESULT after ${Date.now() - t0} ms`);
    }
    await gctx.close();
  }

  // ดึงข้อมูลล่าสุด (สด) จาก Overpass
  const { ctx: lc, page: lp, net: ln } = await newPage(browser);
  await lp.goto(site.url + '?lat=13.7563&lng=100.5018&r=5', { waitUntil: 'domcontentloaded' });
  try {
    await lp.waitForSelector('[data-act="refresh"]', { timeout: 60000 });
    const t0 = Date.now();
    await lp.click('[data-act="refresh"]');
    await lp.waitForFunction(() => !/กำลังค้นหา/.test(document.querySelector('#status').textContent), null, { timeout: 120000 });
    log(`${site.name} live refresh: ${Date.now() - t0} ms | ${(await lp.textContent('#status')).replace(/\s+/g, ' ').slice(0, 120)}`);
  } catch (e) {
    log(`${site.name} live refresh: ${e.message.split('\n')[0]}`);
  }
  log(`${site.name}   live net: ${summarizeNet(ln)}`);
  await lc.close();
}

const browser = await chromium.launch();
await timeFetch('overpass-api.de status', 'https://overpass-api.de/api/status');
await timeFetch('nominatim search', 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=th&q=' + encodeURIComponent('ตลาดไท'),
  { headers: { 'User-Agent': 'MATERIX site check (github actions)' } });
await timeFetch('photon search', 'https://photon.komoot.io/api/?limit=5&bbox=97.3,5.6,105.7,20.5&q=' + encodeURIComponent('ตลาดไท'));
for (const site of SITES) await checkSite(browser, site);
await browser.close();
