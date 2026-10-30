/*
 * MATERIX — ค้นหาร้านวัสดุก่อสร้างและเช่าอุปกรณ์ใกล้คุณ
 * ข้อมูลร้าน: OpenStreetMap (Overpass API) + ร้านพันธมิตร (js/stores-data.js) + ร้านที่ผู้ใช้เพิ่มเอง (localStorage)
 */
(function () {
  'use strict';

  const CFG = window.MATERIX_CONFIG;
  const PARTNERS = Array.isArray(window.MATERIX_STORES) ? window.MATERIX_STORES : [];
  const CATS = CFG.categories;
  const CAT_BY_ID = Object.fromEntries(CATS.map((c) => [c.id, c]));

  const PAGE_SIZE = 30;
  const MAX_MARKERS = 300;
  const FAV_KEY = 'materix:favs';
  const MINE_KEY = 'materix:mystores';
  const LAST_KEY = 'materix:last';
  const MY_LOCATION = 'ตำแหน่งของฉัน';
  const CACHE_KEY = 'materix:areas:v1';
  const ENDPOINT_KEY = 'materix:endpoint';
  const CACHE_TTL = 12 * 60 * 60 * 1000;
  const MAX_CACHE_ENTRIES = 12;
  const MAX_SAVED_ENTRIES = 4;
  const MAX_SAVED_CHARS = 1500000;
  const HEDGE_MS = 6000;
  const LIVE_MAX_MS = 30000; // ดึงสดจาก Overpass รอนานสุดเท่านี้ แล้วกลับไปใช้ข้อมูลที่มีอยู่


  let preferredEndpoint = loadJSON(ENDPOINT_KEY, null);

  /* ---------------- ตัวช่วยทั่วไป ---------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const unique = (arr) => Array.from(new Set(arr));
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function loadJSON(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* โหมดส่วนตัว / พื้นที่เต็ม — ข้ามไป */ }
  }

  function distanceKm(a, b) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function fmtDist(km) {
    if (km < 1) return Math.max(10, Math.round(km * 100) * 10) + ' ม.';
    return (km < 10 ? km.toFixed(1) : Math.round(km)) + ' กม.';
  }

  function fmtCoords(p) {
    return p.lat.toFixed(5) + ', ' + p.lng.toFixed(5);
  }

  /* ---------------- ลิงก์ติดต่อ ---------------- */
  function splitList(...values) {
    return values
      .filter(Boolean)
      .flatMap((v) => String(v).split(/[;,]/))
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function phoneDisplay(p) {
    return p.trim().replace(/^\+66[\s-]*(\(0\))?[\s-]*/, '0');
  }

  function phoneHref(p) {
    return 'tel:' + p.trim().replace(/[^\d+]/g, '');
  }

  function uniquePhones(list) {
    const seen = new Set();
    return list.filter((p) => {
      const key = phoneDisplay(p).replace(/\D/g, '');
      if (key.length < 3 || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function safeUrl(u) {
    if (!u) return null;
    let s = String(u).trim();
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
    try {
      const url = new URL(s);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch (e) {
      return null;
    }
  }

  function lineUrl(v) {
    const s = String(v).trim();
    if (/^https?:\/\//i.test(s) || /^line\.me\//i.test(s)) return safeUrl(s);
    if (s.startsWith('@')) return 'https://line.me/R/ti/p/' + encodeURIComponent(s);
    return 'https://line.me/ti/p/~' + encodeURIComponent(s);
  }

  function facebookUrl(v) {
    const s = String(v).trim();
    if (/^https?:\/\//i.test(s) || /(^|\.)facebook\.com\//i.test(s) || /^fb\.com\//i.test(s)) return safeUrl(s);
    return 'https://www.facebook.com/' + encodeURIComponent(s.replace(/^@/, ''));
  }

  function directionsUrl(s) {
    return 'https://www.google.com/maps/dir/?api=1&destination=' + s.lat + ',' + s.lng;
  }

  function mapUrl(s) {
    return 'https://www.google.com/maps/search/?api=1&query=' + s.lat + ',' + s.lng;
  }

  const DAY_TH = { Mo: 'จ.', Tu: 'อ.', We: 'พ.', Th: 'พฤ.', Fr: 'ศ.', Sa: 'ส.', Su: 'อา.', PH: 'วันหยุดนักขัตฤกษ์' };
  function fmtHours(h) {
    const s = String(h).trim();
    if (s === '24/7') return 'เปิด 24 ชั่วโมง';
    return s
      .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (m) => DAY_TH[m])
      .replace(/\b(off|closed)\b/gi, 'ปิด')
      .replace(/\s*;\s*/g, ' · ');
  }

  /* ---------------- หมวดหมู่ ---------------- */
  CATS.forEach((c) => {
    c.re = c.keywords && c.keywords.length ? new RegExp(c.keywords.map(escRe).join('|'), 'i') : null;
  });
  const NAME_PATTERN = unique(CATS.flatMap((c) => c.keywords || [])).join('|');

  function classify(tags) {
    const text = [tags.name, tags['name:th'], tags['name:en'], tags.brand, tags['brand:th'], tags.trade, tags.product, tags.description]
      .filter(Boolean).join(' | ');
    const out = CATS.filter((c) =>
      (c.shop && c.shop.includes(tags.shop)) ||
      (c.craft && c.craft.includes(tags.craft)) ||
      (c.industrial && c.industrial.includes(tags.industrial)) ||
      (c.re && c.re.test(text))
    ).map((c) => c.id);
    return out.length ? out : ['general'];
  }

  function primaryOf(cats) {
    return cats.find((id) => id !== 'general') || 'general';
  }

  /* ---------------- แปลงข้อมูลร้าน ---------------- */
  function buildAddress(t) {
    if (t['addr:full']) return t['addr:full'];
    const parts = [
      t['addr:housenumber'] && 'เลขที่ ' + t['addr:housenumber'],
      t['addr:street'],
      t['addr:subdistrict'],
      t['addr:district'],
      t['addr:province'] || t['addr:city'],
      t['addr:postcode']
    ].filter(Boolean);
    return parts.join(' ');
  }

  function normalizeOsm(el) {
    const t = el.tags || {};
    const lat = el.lat != null ? el.lat : el.center && el.center.lat;
    const lng = el.lon != null ? el.lon : el.center && el.center.lon;
    if (lat == null || lng == null) return null;
    const cats = classify(t);
    const primary = primaryOf(cats);
    const name = t['name:th'] || t.name || t.brand || '';
    let nameAlt = '';
    if (name) {
      const alt = t['name:th'] && t.name && t.name !== t['name:th'] ? t.name : t['name:en'];
      if (alt && alt !== name) nameAlt = alt;
    }
    const fromOverture = el.type === 'overture';
    return {
      id: fromOverture ? 'ov-' + el.id : 'osm-' + el.type + '-' + el.id,
      source: fromOverture ? 'overture' : 'osm',
      osmType: el.type,
      osmId: el.id,
      named: Boolean(name),
      name: name || CAT_BY_ID[primary].label + ' (ไม่ระบุชื่อ)',
      nameAlt,
      brand: t.brand || '',
      lat, lng, cats, primary,
      phones: uniquePhones(splitList(t.phone, t['contact:phone'], t.mobile, t['contact:mobile'])),
      line: t['contact:line'] || t.line || '',
      facebook: t['contact:facebook'] || t.facebook || '',
      website: t.website || t['contact:website'] || t.url || '',
      email: t.email || t['contact:email'] || '',
      hours: t.opening_hours || '',
      address: buildAddress(t),
      note: t.description || ''
    };
  }

  function normalizeCustom(s, source) {
    const cats = unique((s.cats || []).filter((id) => CAT_BY_ID[id]));
    if (!cats.length) cats.push('general');
    const lat = Number(s.lat);
    const lng = Number(s.lng);
    if (!s.name || !isFinite(lat) || !isFinite(lng)) return null;
    return {
      id: String(s.id || source + '-' + s.name + '-' + lat + '-' + lng),
      source,
      named: true,
      name: String(s.name),
      nameAlt: s.nameAlt || '',
      brand: '',
      lat, lng, cats,
      primary: primaryOf(cats),
      phones: uniquePhones(Array.isArray(s.phones) ? s.phones.map(String) : splitList(s.phones || s.phone)),
      line: s.line || '',
      facebook: s.facebook || '',
      website: s.website || '',
      email: s.email || '',
      hours: s.hours || '',
      address: s.address || '',
      note: s.note || ''
    };
  }

  function contactScore(s) {
    return s.phones.length * 3 + (s.line ? 2 : 0) + (s.facebook ? 1 : 0) + (s.website ? 1 : 0) +
      (s.named ? 1 : 0) + (s.source === 'partner' ? 10 : 0) + (s.source === 'local' ? 5 : 0);
  }

  function dedupe(stores) {
    const byKey = new Map();
    stores.forEach((s) => {
      const key = s.named ? s.name.toLowerCase() + '|' + s.lat.toFixed(3) + '|' + s.lng.toFixed(3) : s.id;
      const prev = byKey.get(key);
      if (!prev || contactScore(s) > contactScore(prev)) byKey.set(key, s);
    });
    return Array.from(byKey.values());
  }

  /* ---------------- Overpass ---------------- */
  function bboxOf(center, radiusKm) {
    const dLat = radiusKm / 110.574;
    const dLng = radiusKm / (111.32 * Math.cos((center.lat * Math.PI) / 180));
    return [center.lat - dLat, center.lng - dLng, center.lat + dLat, center.lng + dLng].map((v) => v.toFixed(5));
  }

  // ใช้กรอบสี่เหลี่ยม (bbox) แทน around เพราะเซิร์ฟเวอร์ไม่ต้องคำนวณระยะทุกจุด แล้วค่อยตัดเป็นวงกลมในเบราว์เซอร์
  // ไม่ดึง relation เพราะร้านแทบไม่มี และต้องโหลดสมาชิกทั้งหมดมาหาจุดกึ่งกลาง
  function buildQuery(center, radiusKm) {
    const shops = unique(CATS.flatMap((c) => c.shop || []));
    const crafts = unique(CATS.flatMap((c) => c.craft || []));
    const industrial = unique(CATS.flatMap((c) => c.industrial || []));
    return '[out:json][timeout:25][bbox:' + bboxOf(center, radiusKm).join(',') + '];(' +
      'nw["shop"~"^(' + shops.join('|') + ')$"];' +
      'nw["shop"]["shop"!~"^(' + CFG.excludedShops.join('|') + ')$"]["name"~"' + NAME_PATTERN + '",i];' +
      'nw["craft"~"^(' + crafts.join('|') + ')$"];' +
      'nw["industrial"~"^(' + industrial.join('|') + ')$"];' +
      'nw["man_made"="works"]["product"~"' + CFG.worksProducts.join('|') + '",i];' +
      ');out center tags qt;';
  }

  async function fetchOverpass(url, query, signal) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: 'data=' + encodeURIComponent(query),
      signal
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (!Array.isArray(json.elements)) throw new Error('bad response');
    if (json.remark && /runtime error/i.test(json.remark)) throw new Error(json.remark);
    return json;
  }

  /*
   * เริ่มจากเซิร์ฟเวอร์ที่ตอบเร็วล่าสุด ถ้าล้มเหลวจะสลับทันที
   * ถ้าเงียบนานเกิน HEDGE_MS จะยิงเซิร์ฟเวอร์ถัดไปพร้อมกัน แล้วใช้ผลที่มาก่อน
   */
  function overpass(query, outerSignal, onSlow) {
    const endpoints = unique([preferredEndpoint].concat(CFG.overpassEndpoints).filter((u) => CFG.overpassEndpoints.includes(u)));
    return new Promise((resolve, reject) => {
      const ctrls = [];
      let next = 0;
      let running = 0;
      let done = false;
      let lastErr = new Error('no endpoint');
      let hedgeTimer = null;

      const finish = (ok, value) => {
        if (done) return;
        done = true;
        clearTimeout(hedgeTimer);
        ctrls.forEach((c) => c.abort());
        outerSignal.removeEventListener('abort', onAbort);
        (ok ? resolve : reject)(value);
      };
      const onAbort = () => finish(false, new DOMException('Aborted', 'AbortError'));
      outerSignal.addEventListener('abort', onAbort);
      setTimeout(() => finish(false, new Error('ไม่มีเซิร์ฟเวอร์ตอบภายใน ' + LIVE_MAX_MS / 1000 + ' วินาที')), LIVE_MAX_MS);

      const launch = () => {
        if (done || next >= endpoints.length) return false;
        const url = endpoints[next++];
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 30000);
        ctrls.push(ctrl);
        running++;
        fetchOverpass(url, query, ctrl.signal).then((json) => {
          if (url !== preferredEndpoint) {
            preferredEndpoint = url;
            saveJSON(ENDPOINT_KEY, url);
          }
          finish(true, json);
        }, (e) => {
          running--;
          lastErr = e;
          if (!launch() && running === 0) finish(false, lastErr);
        }).finally(() => clearTimeout(timer));
        clearTimeout(hedgeTimer);
        hedgeTimer = setTimeout(() => {
          if (!done && next < endpoints.length) {
            if (onSlow) onSlow();
            launch();
          }
        }, HEDGE_MS);
        return true;
      };
      launch();
    });
  }

  /* ---------------- แคชข้อมูลร้านตามพื้นที่ ---------------- */
  // เก็บผลแต่ละครั้งเป็น "วงกลม" ถ้าพื้นที่ใหม่อยู่ในวงที่โหลดไว้แล้ว (เช่น ลดระยะ หรือขยับหมุดนิดเดียว) ไม่ต้องโหลดใหม่
  let areaCache = loadJSON(CACHE_KEY, []).filter((e) => e && Array.isArray(e.stores) && Date.now() - e.t < CACHE_TTL);

  function isFresh(e) {
    return Date.now() - e.t < CACHE_TTL;
  }

  function coveringEntry(center, radiusKm) {
    return areaCache
      .filter((e) => isFresh(e) && distanceKm(e, center) + radiusKm <= e.r + 0.01)
      .sort((a, b) => a.r - b.r)[0];
  }

  // ร้านจากพื้นที่ที่ทับซ้อนกัน ใช้แสดงไปก่อนระหว่างรอข้อมูลใหม่
  function overlappingStores(center, radiusKm) {
    return dedupe(areaCache
      .filter((e) => isFresh(e) && distanceKm(e, center) < e.r + radiusKm)
      .flatMap((e) => e.stores));
  }

  function addToCache(center, radiusKm, stores) {
    const entry = { lat: center.lat, lng: center.lng, r: radiusKm, t: Date.now(), stores };
    areaCache = areaCache.filter((e) => isFresh(e) && distanceKm(e, center) + e.r > radiusKm + 0.01);
    areaCache.push(entry);
    if (areaCache.length > MAX_CACHE_ENTRIES) areaCache = areaCache.slice(-MAX_CACHE_ENTRIES);
    persistCache();
    return entry;
  }

  function persistCache() {
    const newest = areaCache.slice().sort((a, b) => b.t - a.t).slice(0, MAX_SAVED_ENTRIES);
    for (let n = newest.length; n >= 0; n--) {
      const json = JSON.stringify(newest.slice(0, n));
      if (n > 0 && json.length > MAX_SAVED_CHARS) continue;
      try {
        localStorage.setItem(CACHE_KEY, json);
        return;
      } catch (e) { /* พื้นที่เต็ม — ลองเก็บให้น้อยลง */ }
    }
  }

  function dropCacheFor(center, radiusKm) {
    areaCache = areaCache.filter((e) => !(distanceKm(e, center) + radiusKm <= e.r + 0.01));
    persistCache();
  }

  /* ---------------- ข้อมูลร้านที่สร้างไว้ล่วงหน้า (data/) ---------------- */
  // แบ่งเป็นช่องตาราง โหลดเฉพาะช่องที่ทับวงค้นหา ไฟล์อยู่เว็บเดียวกันจึงเร็วและไม่ขึ้นกับเซิร์ฟเวอร์แผนที่
  const OSM_TYPES = { n: 'node', w: 'way', r: 'relation', o: 'overture' };
  const staticData = { index: undefined, tiles: new Map(), pending: new Map() };

  async function loadStaticIndex() {
    if (staticData.index !== undefined) return staticData.index;
    try {
      const res = await fetch(CFG.dataUrl + 'index.json', { cache: 'no-cache' });
      const json = res.ok ? await res.json() : null;
      staticData.index = json && json.cells && json.cell ? json : null;
    } catch (e) {
      staticData.index = null;
    }
    return staticData.index;
  }

  function tileKeysFor(index, center, radiusKm) {
    const [s, w, n, e] = bboxOf(center, radiusKm).map(Number);
    const keys = [];
    for (let i = Math.floor(s / index.cell); i <= Math.floor(n / index.cell); i++) {
      for (let j = Math.floor(w / index.cell); j <= Math.floor(e / index.cell); j++) {
        const key = (i * index.cell).toFixed(index.dp) + '_' + (j * index.cell).toFixed(index.dp);
        if (index.cells[key]) keys.push(key);
      }
    }
    return keys;
  }

  function loadTile(key) {
    if (staticData.tiles.has(key)) return Promise.resolve(staticData.tiles.get(key));
    if (!staticData.pending.has(key)) {
      const p = fetch(CFG.dataUrl + 'tiles/' + key + '.json')
        .then((res) => {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then((rows) => {
          const stores = rows.map((r) => normalizeOsm({ type: OSM_TYPES[r[0]], id: r[1], lat: r[2], lon: r[3], tags: r[4] }))
            .filter(Boolean);
          staticData.tiles.set(key, stores);
          return stores;
        })
        .finally(() => staticData.pending.delete(key));
      staticData.pending.set(key, p);
    }
    return staticData.pending.get(key);
  }

  async function staticOverture(center, radiusKm) {
    const index = await loadStaticIndex();
    if (!index) return [];
    try {
      const lists = await Promise.all(tileKeysFor(index, center, radiusKm).map(loadTile));
      return [].concat(...lists).filter((s) => s.source === 'overture');
    } catch (e) {
      return [];
    }
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });
  }

  function fmtAge(ms) {
    const min = Math.round(ms / 60000);
    if (min < 60) return min + ' นาที';
    return Math.round(min / 60) + ' ชม.';
  }

  /* ---------------- ค้นหาชื่อสถานที่ (Photon + Nominatim) ---------------- */
  const TH_BBOX = '97.3,5.6,105.7,20.5';

  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((resolve, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
  }

  async function geocodeNominatim(q) {
    const url = CFG.nominatimUrl + '/search?format=jsonv2&limit=6&countrycodes=th&accept-language=th&q=' + encodeURIComponent(q);
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return (await res.json()).map((r) => {
      const parts = String(r.display_name).split(',').map((x) => x.trim());
      return { lat: parseFloat(r.lat), lng: parseFloat(r.lon), name: r.name || parts[0], detail: parts.slice(1, 4).join(', ') };
    });
  }

  // Photon: เร็ว พิมพ์ผิดเล็กน้อยก็เจอ และเรียงผลใกล้ตำแหน่งปัจจุบันก่อน
  async function geocodePhoton(q) {
    const url = CFG.photonUrl + '/api/?limit=6&bbox=' + TH_BBOX + '&lat=' + state.center.lat.toFixed(4) +
      '&lon=' + state.center.lng.toFixed(4) + '&q=' + encodeURIComponent(q);
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return ((await res.json()).features || []).map((f) => {
      const p = f.properties || {};
      const name = p.name || p.street || p.district || p.city || '';
      const detail = unique([p.district, p.city, p.county, p.state].filter((x) => x && x !== name)).join(', ');
      return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], name, detail };
    }).filter((x) => x.name);
  }

  const reverseCache = new Map();
  async function reverseLabel(lat, lng) {
    const key = lat.toFixed(3) + ',' + lng.toFixed(3);
    if (reverseCache.has(key)) return reverseCache.get(key);
    const url = CFG.nominatimUrl + '/reverse?format=jsonv2&zoom=14&accept-language=th&lat=' + lat + '&lon=' + lng;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const a = j.address || {};
    const local = a.suburb || a.city_district || a.quarter || a.town || a.village || a.municipality || a.county || a.city;
    const province = a.state || a.province || a.city;
    const label = unique([local, province].filter(Boolean)).join(', ') || (j.name || '');
    reverseCache.set(key, label);
    return label;
  }

  /* ---------------- สถานะของแอป ---------------- */
  const params = new URLSearchParams(location.search);
  const last = loadJSON(LAST_KEY, null);
  const startLat = parseFloat(params.get('lat'));
  const startLng = parseFloat(params.get('lng'));
  const fromUrl = isFinite(startLat) && isFinite(startLng);
  const startRadius = parseFloat(params.get('r'));

  const state = {
    center: fromUrl
      ? { lat: startLat, lng: startLng, label: params.get('at') || '' }
      : (last && last.center) || Object.assign({}, CFG.defaultCenter),
    radiusKm: CFG.radiusOptions.includes(startRadius) ? startRadius
      : (last && CFG.radiusOptions.includes(last.radiusKm) ? last.radiusKm : CFG.defaultRadiusKm),
    cats: new Set((params.get('cat') || '').split(',').filter((id) => CAT_BY_ID[id])),
    text: '',
    phoneOnly: false,
    sort: 'distance',
    chain: null,
    osm: [],
    dataTime: null,
    source: null,
    loading: false,
    liveRefresh: false,
    slow: false,
    error: null,
    shown: PAGE_SIZE,
    activeId: null,
    tab: 'nearby',
    me: null,
    usedGps: false,
    pick: null,
    favs: loadJSON(FAV_KEY, {}),
    mine: loadJSON(MINE_KEY, [])
  };

  const partnerStores = PARTNERS.map((s) => normalizeCustom(s, 'partner')).filter(Boolean);
  let storeIndex = new Map();
  let reqSeq = 0;
  let currentAbort = null;
  let needsFit = true;

  const mineStores = () => state.mine.map((s) => normalizeCustom(s, 'local')).filter(Boolean);

  /* ---------------- แผนที่ ---------------- */
  const map = L.map('map', { zoomControl: true }).setView([state.center.lat, state.center.lng], 13);
  L.tileLayer(CFG.tileUrl, { maxZoom: 19, attribution: CFG.tileAttribution }).addTo(map);

  const centerIcon = L.divIcon({
    className: '',
    html: '<div class="center-pin"><svg viewBox="0 0 30 42" aria-hidden="true"><path d="M15 41S2 25.5 2 15a13 13 0 1 1 26 0c0 10.5-13 26-13 26z" fill="#c92a2a" stroke="#fff" stroke-width="2"/><circle cx="15" cy="15" r="5" fill="#fff"/></svg></div>',
    iconSize: [30, 42],
    iconAnchor: [15, 41]
  });
  const centerMarker = L.marker([state.center.lat, state.center.lng], {
    icon: centerIcon, draggable: true, zIndexOffset: 2000, title: 'จุดค้นหา (ลากเพื่อย้าย)'
  }).addTo(map);
  centerMarker.bindTooltip('จุดค้นหา — ลากเพื่อย้ายได้', { direction: 'top', offset: [0, -40] });

  const radiusCircle = L.circle([state.center.lat, state.center.lng], {
    radius: state.radiusKm * 1000, color: '#c2410c', weight: 1.5, fillColor: '#fcc419', fillOpacity: 0.07, dashArray: '6 6', interactive: false
  }).addTo(map);

  let meMarker = null;
  const storeLayer = L.layerGroup().addTo(map);
  const tempLayer = L.layerGroup().addTo(map);
  let markers = new Map();

  function mapVisible() {
    return $('#map').offsetWidth > 0;
  }

  function fitToRadius() {
    if (!mapVisible()) { needsFit = true; return; }
    needsFit = false;
    map.fitBounds(radiusCircle.getBounds(), { padding: [16, 16] });
  }

  function pinIcon(s, active) {
    const cat = CAT_BY_ID[s.primary];
    return L.divIcon({
      className: '',
      html: '<div class="pin' + (s.phones.length ? ' has-phone' : '') + (active ? ' active' : '') +
        '" style="--pin:' + cat.color + '"><span>' + cat.icon + '</span></div>',
      iconSize: [34, 34],
      iconAnchor: [17, 41],
      popupAnchor: [0, -38]
    });
  }

  /* ---------------- คำนวณรายการ ---------------- */
  function withDist(s) {
    return Object.assign({}, s, { dist: distanceKm(state.center, s) });
  }

  function storesInRadius() {
    const all = dedupe(state.osm.concat(partnerStores, mineStores()));
    return all.map(withDist).filter((s) => s.dist <= state.radiusKm);
  }

  function matchesText(s, q) {
    if (!q) return true;
    const hay = [s.name, s.nameAlt, s.brand, s.note, s.address].concat(s.cats.map((id) => CAT_BY_ID[id].label))
      .join(' ').toLowerCase();
    return hay.includes(q);
  }

  function matchesChain(s) {
    if (!state.chain) return true;
    const hay = (s.name + ' ' + s.nameAlt + ' ' + s.brand).toLowerCase();
    return state.chain.match.some((m) => hay.includes(m.toLowerCase()));
  }

  function computeLists() {
    const q = state.text.trim().toLowerCase();
    const base = storesInRadius().filter((s) =>
      (!state.phoneOnly || s.phones.length) && matchesText(s, q) && matchesChain(s));

    const counts = {};
    base.forEach((s) => s.cats.forEach((id) => { counts[id] = (counts[id] || 0) + 1; }));

    const filtered = state.cats.size ? base.filter((s) => s.cats.some((id) => state.cats.has(id))) : base;
    const sorters = {
      distance: (a, b) => a.dist - b.dist,
      contact: (a, b) => contactScore(b) - contactScore(a) || a.dist - b.dist,
      name: (a, b) => (a.named === b.named ? a.name.localeCompare(b.name, 'th') : a.named ? -1 : 1)
    };
    filtered.sort(sorters[state.sort] || sorters.distance);

    storeIndex = new Map();
    filtered.forEach((s) => storeIndex.set(s.id, s));
    Object.values(state.favs).forEach((s) => { if (!storeIndex.has(s.id)) storeIndex.set(s.id, withDist(s)); });

    return { base, filtered, counts };
  }

  /* ---------------- HTML ของการ์ด ---------------- */
  function actionsHTML(s, compact) {
    const out = [];
    s.phones.slice(0, compact ? 1 : 3).forEach((p) => {
      out.push('<a class="act call" href="' + esc(phoneHref(p)) + '">📞 ' + esc(phoneDisplay(p)) + '</a>');
    });
    if (s.line) {
      const u = lineUrl(s.line);
      if (u) out.push('<a class="act line" href="' + esc(u) + '" target="_blank" rel="noopener">LINE' +
        (compact || /^https?:/i.test(s.line) ? '' : ' ' + esc(s.line)) + '</a>');
    }
    if (s.facebook) {
      const u = facebookUrl(s.facebook);
      if (u) out.push('<a class="act fb" href="' + esc(u) + '" target="_blank" rel="noopener">Facebook</a>');
    }
    if (!compact && s.website) {
      const u = safeUrl(s.website);
      if (u) out.push('<a class="act" href="' + esc(u) + '" target="_blank" rel="noopener">🌐 เว็บไซต์</a>');
    }
    if (!compact && s.email && s.email.includes('@')) {
      out.push('<a class="act" href="mailto:' + esc(s.email) + '">✉️ อีเมล</a>');
    }
    out.push('<a class="act" href="' + esc(directionsUrl(s)) + '" target="_blank" rel="noopener">🧭 นำทาง</a>');
    if (!compact) {
      if (!s.phones.length && (s.source === 'osm' || s.source === 'overture') && s.named) {
        const q = s.name + ' ' + (s.address || '') + ' เบอร์โทร';
        out.push('<a class="act muted" href="https://www.google.com/search?q=' + encodeURIComponent(q) +
          '" target="_blank" rel="noopener">🔎 หาเบอร์</a>');
      }
      out.push('<button type="button" class="act" data-act="share">↗ แชร์</button>');
      if (!s.phones.length && s.source === 'osm') {
        out.push('<a class="act muted" href="https://www.openstreetmap.org/edit?' + s.osmType + '=' + s.osmId +
          '" target="_blank" rel="noopener" title="ช่วยเพิ่มเบอร์โทรใน OpenStreetMap">✏️ แก้ไขข้อมูล</a>');
      }
      if (s.source === 'local') {
        out.push('<button type="button" class="act" data-act="copy">📋 คัดลอกข้อมูลร้าน</button>');
        out.push('<button type="button" class="act danger" data-act="delete">ลบ</button>');
      }
    }
    return out.join('');
  }

  function cardHTML(s) {
    const cat = CAT_BY_ID[s.primary];
    const fav = Boolean(state.favs[s.id]);
    const pills = [];
    if (s.dist != null) pills.push('<span class="pill dist">' + fmtDist(s.dist) + '</span>');
    if (s.source === 'partner') pills.push('<span class="pill partner">✔ ร้านพันธมิตร</span>');
    if (s.source === 'local') pills.push('<span class="pill local">ร้านที่คุณเพิ่ม</span>');
    s.cats.forEach((id) => pills.push('<span class="pill">' + CAT_BY_ID[id].icon + ' ' + esc(CAT_BY_ID[id].short) + '</span>'));

    const info = [];
    if (s.phones.length) info.push(['📞', s.phones.map(phoneDisplay).join(', ')]);
    if (s.address) info.push(['📍', s.address]);
    if (s.hours) info.push(['🕒', fmtHours(s.hours)]);
    if (s.note) info.push(['📝', s.note]);

    const hasContact = s.phones.length || s.line || s.facebook || s.website || s.email;
    return '<li class="store' + (s.id === state.activeId ? ' active' : '') + '" data-id="' + esc(s.id) + '">' +
      '<div class="store-icon" data-act="focus" title="ดูบนแผนที่" style="border-color:' + cat.color + '33">' + cat.icon + '</div>' +
      '<div class="store-main">' +
        '<div class="store-head">' +
          '<h3 class="store-name" data-act="focus" role="button" tabindex="0">' + esc(s.name) +
            (s.nameAlt ? '<small>' + esc(s.nameAlt) + '</small>' : '') + '</h3>' +
          '<button type="button" class="fav-btn" data-act="fav" aria-pressed="' + fav + '" aria-label="' +
            (fav ? 'เลิกบันทึกร้านนี้' : 'บันทึกร้านนี้') + '">' + (fav ? '♥' : '♡') + '</button>' +
        '</div>' +
        '<div class="store-meta">' + pills.join('') + '</div>' +
        (info.length ? '<ul class="store-info">' + info.map((i) =>
          '<li><span aria-hidden="true">' + i[0] + '</span><span>' + esc(i[1]) + '</span></li>').join('') + '</ul>' : '') +
        '<div class="actions">' + actionsHTML(s, false) + '</div>' +
        (hasContact ? '' : '<div class="no-contact">ยังไม่มีเบอร์โทรในระบบ — ลองกด “หาเบอร์” หรือแวะไปที่ร้านได้เลย</div>') +
      '</div></li>';
  }

  function popupHTML(s) {
    const cat = CAT_BY_ID[s.primary];
    return '<p class="popup-name">' + esc(s.name) + '</p>' +
      '<div class="popup-sub">' + cat.icon + ' ' + esc(cat.label) + (s.dist != null ? ' · ' + fmtDist(s.dist) : '') + '</div>' +
      (s.phones.length ? '<div>📞 ' + esc(s.phones.map(phoneDisplay).join(', ')) + '</div>' : '') +
      (s.address ? '<div class="popup-sub">' + esc(s.address) + '</div>' : '') +
      '<div class="actions">' + actionsHTML(s, true) + '</div>';
  }

  /* ---------------- เรนเดอร์ ---------------- */
  const els = {
    results: $('#results'),
    favResults: $('#favResults'),
    status: $('#status'),
    more: $('#btnMore'),
    chips: $('#catChips'),
    locLabel: $('#locLabel'),
    countNearby: $('#countNearby'),
    countFavs: $('#countFavs')
  };

  function renderChips(counts, total) {
    const chips = ['<button type="button" class="chip" data-cat="" aria-pressed="' + (state.cats.size === 0) + '">ทั้งหมด <span class="n">' + total + '</span></button>']
      .concat(CATS.map((c) =>
        '<button type="button" class="chip" data-cat="' + c.id + '" aria-pressed="' + state.cats.has(c.id) + '" title="' + esc(c.label) + '">' +
        c.icon + ' ' + esc(c.short) + ' <span class="n">' + (counts[c.id] || 0) + '</span></button>'));
    els.chips.innerHTML = chips.join('');
  }

  function nextRadius() {
    return CFG.radiusOptions.find((r) => r > state.radiusKm);
  }

  function renderStatus(filtered) {
    const s = els.status;
    s.className = 'status';
    if (state.loading && state.liveRefresh) {
      s.classList.add('info');
      s.innerHTML = '<div>⏳ กำลังดึงข้อมูลสดจากแผนที่ออนไลน์ (เซิร์ฟเวอร์สาธารณะ อาจใช้เวลาถึง ' + LIVE_MAX_MS / 1000 +
        ' วินาที) — ระหว่างนี้ดูและโทรหาร้านด้านล่างได้เลย</div>';
      return;
    }
    if (state.loading) {
      s.classList.add('info');
      s.innerHTML = '<div>⏳ กำลังค้นหาร้านในระยะ ' + state.radiusKm + ' กม.…' +
        (filtered.length ? ' แสดงร้านที่โหลดไว้แล้ว ' + filtered.length + ' ร้านไปก่อน' : '') + '</div>' +
        (state.slow ? '<div class="hint" style="margin:4px 0 0">เซิร์ฟเวอร์แผนที่ตอบช้า กำลังลองเซิร์ฟเวอร์สำรองพร้อมกัน</div>' : '');
      return;
    }
    const parts = [];
    if (state.error && state.source === 'static') {
      // กด "ดึงข้อมูลล่าสุด" แล้วเซิร์ฟเวอร์แผนที่ไม่ตอบ — ยังมีข้อมูลเดิมให้ดู
      s.classList.add('error');
      parts.push('<div>⚠️ ดึงข้อมูลล่าสุดไม่สำเร็จ (เซิร์ฟเวอร์แผนที่ไม่ว่าง) — แสดงข้อมูล ณ ' + esc(fmtDate(state.dataTime)) + ' แทน</div>' +
        '<button type="button" class="btn btn-sm" data-act="refresh">ลองดึงอีกครั้ง</button>');
    } else if (state.error) {
      s.classList.add('error');
      parts.push('<div>⚠️ โหลดข้อมูลร้านไม่สำเร็จ (ไม่มีอินเทอร์เน็ต หรือเซิร์ฟเวอร์แผนที่ไม่ว่าง)' +
        (filtered.length ? ' — แสดงเฉพาะร้านที่มีข้อมูลอยู่ในเครื่องแล้ว' : '') + '</div>' +
        '<button type="button" class="btn btn-sm" data-act="retry">ลองอีกครั้ง</button>');
    } else {
      const withPhone = filtered.filter((x) => x.phones.length).length;
      const age = state.dataTime ? Date.now() - state.dataTime : 0;
      let dataInfo = '';
      if (state.source === 'static') {
        dataInfo = '<span>ข้อมูล ณ ' + esc(fmtDate(state.dataTime)) +
          ' · <button type="button" class="link-btn" data-act="refresh">ดึงข้อมูลล่าสุด</button></span>';
      } else if (age > 10 * 60 * 1000) {
        dataInfo = '<span>ข้อมูลเมื่อ ' + fmtAge(age) + ' ที่แล้ว · <button type="button" class="link-btn" data-act="refresh">โหลดใหม่</button></span>';
      }
      parts.push('<div class="summary"><span>พบ <b>' + filtered.length + '</b> ร้าน ในระยะ ' + state.radiusKm + ' กม.</span>' +
        '<span>มีเบอร์โทร <b>' + withPhone + '</b> ร้าน</span>' + dataInfo + '</div>');
    }
    if (state.chain) {
      parts.push('<div>กำลังแสดงเฉพาะสาขา <b>' + esc(state.chain.name) + '</b> ' +
        '<button type="button" class="btn btn-sm" data-act="clear-chain">✕ ดูทุกร้าน</button></div>');
    }
    if (!state.usedGps && !fromUrl && !state.error) {
      parts.push('<div class="hint" style="margin:6px 0 0">💡 กด “ใช้ตำแหน่งของฉัน” เพื่อหาร้านใกล้คุณ หรือปักหมุดบนแผนที่เพื่อดูพื้นที่อื่น</div>');
    }
    s.innerHTML = parts.join('');
  }

  function renderEmpty() {
    const nr = nextRadius();
    const filtersOn = state.cats.size || state.text || state.phoneOnly || state.chain;
    return '<li class="empty-state"><div class="big">🔍</div>' +
      '<p>ไม่พบร้านที่ตรงเงื่อนไขในระยะ ' + state.radiusKm + ' กม.</p>' +
      (nr ? '<button type="button" class="btn btn-primary" data-act="expand">ขยายระยะเป็น ' + nr + ' กม.</button> ' : '') +
      (filtersOn ? '<button type="button" class="btn" data-act="clear-filters">ล้างตัวกรอง</button> ' : '') +
      (state.source === 'static' ? '<button type="button" class="btn" data-act="refresh">ค้นหาสดจากแผนที่ออนไลน์</button>' : '') +
      '</li>';
  }

  function renderMarkers(filtered) {
    storeLayer.clearLayers();
    markers = new Map();
    filtered.slice(0, MAX_MARKERS).forEach((s) => {
      const m = L.marker([s.lat, s.lng], { icon: pinIcon(s, s.id === state.activeId), title: s.name, riseOnHover: true });
      m.bindPopup(() => popupHTML(storeIndex.get(s.id) || s), { maxWidth: 300 });
      m.on('click', () => setActive(s.id, { fromMap: true }));
      if (s.id === state.activeId) m.setZIndexOffset(1000);
      storeLayer.addLayer(m);
      markers.set(s.id, m);
    });
  }

  function renderFavs() {
    const favs = Object.values(state.favs).map(withDist).sort((a, b) => a.dist - b.dist);
    els.countFavs.textContent = favs.length;
    els.favResults.innerHTML = favs.length ? favs.map(cardHTML).join('')
      : '<li class="empty-state"><div class="big">♡</div><p>ยังไม่มีร้านที่บันทึกไว้</p></li>';
  }

  function render() {
    const { base, filtered, counts } = computeLists();
    renderChips(counts, base.length);
    renderStatus(filtered);
    els.countNearby.textContent = state.loading && !filtered.length ? '…' : filtered.length;

    if (state.loading && !filtered.length) {
      els.results.innerHTML = '<li class="skeleton"></li><li class="skeleton"></li><li class="skeleton"></li>';
      els.more.hidden = true;
    } else {
      els.results.innerHTML = filtered.length ? filtered.slice(0, state.shown).map(cardHTML).join('')
        : state.error ? '' : renderEmpty();
      els.more.hidden = filtered.length <= state.shown;
      els.more.textContent = 'แสดงเพิ่มเติม (เหลืออีก ' + Math.max(0, filtered.length - state.shown) + ' ร้าน)';
    }
    renderMarkers(filtered);
    renderFavs();
    updateUrl();
  }

  function updateUrl() {
    // "ตำแหน่งของฉัน" มีความหมายเฉพาะเครื่องนี้ จึงไม่ใส่ในลิงก์ที่แชร์
    const label = state.center.label.replace(new RegExp('^' + MY_LOCATION + '( · )?'), '');
    const p = new URLSearchParams();
    p.set('lat', state.center.lat.toFixed(5));
    p.set('lng', state.center.lng.toFixed(5));
    p.set('r', state.radiusKm);
    if (state.cats.size) p.set('cat', Array.from(state.cats).join(','));
    if (label) p.set('at', label);
    try { history.replaceState(null, '', '?' + p.toString()); } catch (e) { /* file:// */ }
    saveJSON(LAST_KEY, { center: { lat: state.center.lat, lng: state.center.lng, label }, radiusKm: state.radiusKm });
  }

  /* ---------------- โหลดร้าน ---------------- */
  // ลำดับ: ข้อมูลสดที่เคยดึงไว้ (ใหม่กว่า) → ข้อมูลที่สร้างไว้ล่วงหน้า → ดึงสดจาก Overpass
  // opts.live = กด "ดึงข้อมูลล่าสุด" ให้ข้ามไปดึงสดเลย
  async function loadNearby(opts = {}) {
    if (currentAbort) currentAbort.abort();
    currentAbort = null;
    const seq = ++reqSeq;
    const center = { lat: state.center.lat, lng: state.center.lng };
    const radiusKm = state.radiusKm;
    state.error = null;
    state.slow = false;
    if (opts.live) dropCacheFor(center, radiusKm);

    const hit = !opts.live && coveringEntry(center, radiusKm);
    if (hit) {
      const extra = await staticOverture(center, radiusKm);
      if (seq !== reqSeq) return;
      Object.assign(state, { osm: dedupe(hit.stores.concat(extra)), dataTime: hit.t, source: 'live', loading: false });
      render();
      return;
    }

    if (!opts.live && await loadStatic(seq, center, radiusKm)) return;
    if (seq !== reqSeq) return;
    await loadLive(seq, center, radiusKm, opts.live);
  }

  async function loadStatic(seq, center, radiusKm) {
    const index = await loadStaticIndex();
    if (seq !== reqSeq || !index) return seq !== reqSeq;
    const keys = tileKeysFor(index, center, radiusKm);
    const ready = keys.filter((k) => staticData.tiles.has(k));
    if (ready.length < keys.length) {
      state.osm = dedupe(ready.flatMap((k) => staticData.tiles.get(k)).concat(overlappingStores(center, radiusKm)));
      state.loading = true;
      render();
    }
    try {
      const lists = await Promise.all(keys.map(loadTile));
      if (seq !== reqSeq) return true;
      Object.assign(state, { osm: dedupe([].concat(...lists)), dataTime: Date.parse(index.generated), source: 'static', loading: false });
      render();
      return true;
    } catch (e) {
      console.warn('Static data error', e);
      return seq !== reqSeq;
    }
  }

  async function loadLive(seq, center, radiusKm, keepShown) {
    const ctrl = new AbortController();
    currentAbort = ctrl;
    if (!keepShown) {
      state.osm = overlappingStores(center, radiusKm);
      state.dataTime = null;
      state.source = null;
    }
    state.loading = true;
    state.liveRefresh = Boolean(keepShown);
    render();
    try {
      const json = await overpass(buildQuery(center, radiusKm), ctrl.signal, () => {
        if (seq !== reqSeq) return;
        state.slow = true;
        render();
      });
      if (seq !== reqSeq) return;
      const entry = addToCache(center, radiusKm, dedupe(json.elements.map(normalizeOsm).filter(Boolean)));
      // Overpass มีแต่ร้าน OSM — เติมร้านจาก Overture ที่อยู่ในข้อมูลสร้างล่วงหน้ากลับเข้าไป
      const extra = await staticOverture(center, radiusKm);
      if (seq !== reqSeq) return;
      Object.assign(state, { osm: dedupe(entry.stores.concat(extra)), dataTime: entry.t, source: 'live' });
    } catch (e) {
      if (seq !== reqSeq) return;
      console.warn('Overpass error', e);
      state.error = e;
    }
    state.loading = false;
    state.slow = false;
    state.liveRefresh = false;
    render();
  }

  /* ---------------- ตำแหน่ง ---------------- */
  let labelSeq = 0;
  function setCenter(lat, lng, label, opts = {}) {
    state.center = { lat, lng, label: label || '' };
    state.shown = PAGE_SIZE;
    state.activeId = null;
    tempLayer.clearLayers();
    centerMarker.setLatLng([lat, lng]);
    radiusCircle.setLatLng([lat, lng]);
    $('#btnSearchArea').hidden = true;
    els.locLabel.textContent = label || fmtCoords(state.center);
    if (!opts.keepView) fitToRadius();

    if (!label || opts.refineLabel) {
      const seq = ++labelSeq;
      reverseLabel(lat, lng).then((name) => {
        if (seq !== labelSeq || !name) return;
        state.center.label = opts.refineLabel ? label + ' · ' + name : name;
        els.locLabel.textContent = state.center.label;
        updateUrl();
      }).catch(() => {});
    }
    loadNearby();
  }

  function setRadius(km) {
    state.radiusKm = km;
    $('#radiusSelect').value = String(km);
    radiusCircle.setRadius(km * 1000);
    state.shown = PAGE_SIZE;
    fitToRadius();
    loadNearby();
  }

  // ขอตำแหน่งคร่าว ๆ ก่อน (จากเครือข่าย ได้แทบทันที) แล้วค่อยขอ GPS ละเอียดเบื้องหลัง
  // ถ้าตำแหน่งละเอียดต่างจากเดิมพอสมควรค่อยขยับจุดค้นหาให้
  function showMe(pos) {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    state.me = { lat, lng };
    if (meMarker) meMarker.remove();
    meMarker = L.circleMarker([lat, lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#1c7ed6', fillOpacity: 1 })
      .bindTooltip('คุณอยู่ที่นี่' + (accuracy ? ' (±' + Math.round(accuracy) + ' ม.)' : ''))
      .addTo(map);
    return { lat, lng, accuracy };
  }

  function locate() {
    if (!('geolocation' in navigator)) {
      toast('เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง ลองค้นหาชื่อสถานที่แทน');
      return;
    }
    const btn = $('#btnLocate');
    const label = btn.querySelector('span');
    const reset = () => {
      btn.disabled = false;
      label.textContent = 'ใช้ตำแหน่งของฉัน';
    };
    btn.disabled = true;
    label.textContent = 'กำลังหาตำแหน่ง…';

    const fail = (err) => {
      reset();
      const msg = {
        1: 'ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง — เปิดสิทธิ์ตำแหน่งในการตั้งค่าเบราว์เซอร์ หรือค้นหาชื่อสถานที่แทน',
        2: 'หาตำแหน่งไม่ได้ในขณะนี้ ลองใหม่อีกครั้ง หรือค้นหาชื่อสถานที่แทน',
        3: 'หาตำแหน่งนานเกินไป ลองใหม่อีกครั้ง หรือค้นหาชื่อสถานที่แทน'
      }[err.code] || 'หาตำแหน่งไม่สำเร็จ';
      toast(msg, 5000);
    };

    const refine = (first) => {
      navigator.geolocation.getCurrentPosition((pos) => {
        const centerIsMine = state.center.label.startsWith(MY_LOCATION) &&
          distanceKm(state.center, first) < 0.01;
        const me = showMe(pos);
        if (centerIsMine && distanceKm(first, me) > Math.max(0.3, state.radiusKm * 0.15)) {
          setCenter(me.lat, me.lng, MY_LOCATION, { refineLabel: true });
        }
      }, () => {}, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    };

    navigator.geolocation.getCurrentPosition((pos) => {
      reset();
      state.usedGps = true;
      const me = showMe(pos);
      setCenter(me.lat, me.lng, MY_LOCATION, { refineLabel: true });
      if (!me.accuracy || me.accuracy > 100) refine(me);
    }, (err) => {
      if (err.code === 1) return fail(err);
      // ตำแหน่งคร่าว ๆ ไม่ได้ ลองแบบละเอียดอีกครั้ง
      navigator.geolocation.getCurrentPosition((pos) => {
        reset();
        state.usedGps = true;
        const me = showMe(pos);
        setCenter(me.lat, me.lng, MY_LOCATION, { refineLabel: true });
      }, fail, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    }, { enableHighAccuracy: false, timeout: 5000, maximumAge: 5 * 60 * 1000 });
  }

  /* ---------------- โหมดปักหมุด ---------------- */
  function startPick(purpose) {
    state.pick = purpose;
    $('#pickBanner').hidden = false;
    $('#pickText').textContent = purpose === 'store' ? 'แตะบนแผนที่ตรงตำแหน่งร้านของคุณ' : 'แตะบนแผนที่เพื่อเลือกจุดค้นหา';
    $('.map-panel').classList.add('picking');
    $('#btnPick').setAttribute('aria-pressed', 'true');
    setView('map');
  }

  function endPick() {
    const p = state.pick;
    state.pick = null;
    $('#pickBanner').hidden = true;
    $('.map-panel').classList.remove('picking');
    $('#btnPick').setAttribute('aria-pressed', 'false');
    return p;
  }

  map.on('click', (e) => {
    if (!state.pick) return;
    const purpose = endPick();
    if (purpose === 'store') {
      addDraft = { lat: e.latlng.lat, lng: e.latlng.lng };
      showAddCoords();
      $('#addDialog').showModal();
    } else {
      setCenter(e.latlng.lat, e.latlng.lng, '', { keepView: true });
    }
  });

  centerMarker.on('dragend', () => {
    const p = centerMarker.getLatLng();
    setCenter(p.lat, p.lng, '', { keepView: true });
  });

  map.on('dragend', () => {
    const c = map.getCenter();
    const moved = distanceKm(state.center, { lat: c.lat, lng: c.lng });
    $('#btnSearchArea').hidden = moved < state.radiusKm * 0.35;
  });

  $('#btnSearchArea').addEventListener('click', () => {
    const c = map.getCenter();
    setCenter(c.lat, c.lng, '', { keepView: true });
  });

  /* ---------------- ร้านที่เลือก ---------------- */
  function setActive(id, opts = {}) {
    const prev = state.activeId;
    state.activeId = id;
    [prev, id].forEach((x) => {
      const m = x && markers.get(x);
      const s = x && storeIndex.get(x);
      if (m && s) {
        m.setIcon(pinIcon(s, x === id));
        m.setZIndexOffset(x === id ? 1000 : 0);
      }
    });
    $$('.store').forEach((li) => li.classList.toggle('active', li.dataset.id === id));

    if (opts.fromMap) {
      const card = $('#results .store[data-id="' + CSS.escape(id) + '"]');
      if (card && $('.list-panel').offsetWidth > 0) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }

    const s = storeIndex.get(id);
    if (!s) return;
    setView('map', () => {
      let m = markers.get(id);
      if (!m) {
        tempLayer.clearLayers();
        m = L.marker([s.lat, s.lng], { icon: pinIcon(s, true), zIndexOffset: 1000 })
          .bindPopup(() => popupHTML(s), { maxWidth: 300 });
        tempLayer.addLayer(m);
      }
      map.setView([s.lat, s.lng], Math.max(map.getZoom(), 16));
      m.openPopup();
    });
  }

  /* ---------------- ร้านโปรด / ร้านของฉัน ---------------- */
  function toggleFav(id) {
    const s = storeIndex.get(id);
    if (state.favs[id]) {
      delete state.favs[id];
      toast('นำออกจากร้านที่บันทึกไว้แล้ว');
    } else if (s) {
      const copy = Object.assign({}, s);
      delete copy.dist;
      state.favs[id] = copy;
      toast('บันทึกร้านแล้ว ดูได้ที่แท็บ “ร้านที่บันทึกไว้”');
    }
    saveJSON(FAV_KEY, state.favs);
    render();
  }

  function storeExport(s) {
    return {
      id: 'partner-' + Date.now().toString(36),
      name: s.name,
      cats: s.cats,
      phones: s.phones,
      line: s.line,
      facebook: s.facebook,
      website: s.website,
      email: s.email,
      address: s.address,
      hours: s.hours,
      note: s.note,
      lat: Number(s.lat.toFixed(6)),
      lng: Number(s.lng.toFixed(6))
    };
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  function shareText(s) {
    return [
      s.name,
      s.phones.length ? 'โทร ' + s.phones.map(phoneDisplay).join(', ') : '',
      s.line ? 'LINE ' + s.line : '',
      s.address,
      mapUrl(s)
    ].filter(Boolean).join('\n');
  }

  async function shareStore(s) {
    const text = shareText(s);
    if (navigator.share) {
      try {
        await navigator.share({ title: s.name, text });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    toast((await copyText(text)) ? 'คัดลอกข้อมูลร้านแล้ว นำไปวางในแชตได้เลย' : 'คัดลอกไม่สำเร็จ');
  }

  function handleStoreAction(e) {
    const actEl = e.target.closest('[data-act]');
    if (!actEl) return;
    const act = actEl.dataset.act;
    if (act === 'retry') { loadNearby(); return; }
    if (act === 'refresh') { loadNearby({ live: true }); return; }
    if (act === 'expand') { const nr = nextRadius(); if (nr) setRadius(nr); return; }
    if (act === 'clear-filters') { clearFilters(); return; }
    if (act === 'clear-chain') { state.chain = null; render(); return; }

    const li = actEl.closest('.store');
    if (!li) return;
    const id = li.dataset.id;
    const s = storeIndex.get(id);
    if (act === 'focus') setActive(id);
    else if (act === 'fav') toggleFav(id);
    else if (act === 'share' && s) shareStore(s);
    else if (act === 'copy' && s) {
      const json = JSON.stringify(storeExport(s), null, 2);
      copyText(json + ',').then((ok) => toast(ok
        ? 'คัดลอกข้อมูลร้านแล้ว ส่งให้ผู้ดูแลเว็บเพื่อเพิ่มใน js/stores-data.js'
        : 'คัดลอกไม่สำเร็จ', 5000));
    } else if (act === 'delete') {
      if (!confirm('ลบร้าน “' + (s ? s.name : '') + '” ออกจากเครื่องนี้?')) return;
      state.mine = state.mine.filter((x) => x.id !== id);
      saveJSON(MINE_KEY, state.mine);
      if (state.favs[id]) { delete state.favs[id]; saveJSON(FAV_KEY, state.favs); }
      render();
      toast('ลบร้านแล้ว');
    }
  }

  function clearFilters() {
    state.cats.clear();
    state.text = '';
    state.phoneOnly = false;
    state.chain = null;
    $('#textFilter').value = '';
    $('#phoneOnly').checked = false;
    state.shown = PAGE_SIZE;
    render();
  }

  /* ---------------- เพิ่มร้าน ---------------- */
  let addDraft = null;

  function showAddCoords() {
    $('#addCoords').textContent = addDraft ? fmtCoords(addDraft) : '—';
  }

  function openAddDialog() {
    const box = $('#addCats');
    if (!box.children.length) {
      box.innerHTML = CATS.map((c) =>
        '<label><input type="checkbox" name="cats" value="' + c.id + '"><span>' + c.icon + ' ' + esc(c.label) + '</span></label>').join('');
    }
    addDraft = state.me ? Object.assign({}, state.me) : { lat: state.center.lat, lng: state.center.lng };
    showAddCoords();
    $('#addError').textContent = '';
    $('#addDialog').showModal();
  }

  $('#addUseGps').addEventListener('click', () => {
    if (!('geolocation' in navigator)) return;
    $('#addCoords').textContent = 'กำลังหาตำแหน่ง…';
    navigator.geolocation.getCurrentPosition((pos) => {
      addDraft = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      showAddCoords();
    }, () => {
      showAddCoords();
      $('#addError').textContent = 'หาตำแหน่ง GPS ไม่สำเร็จ ลองเลือกบนแผนที่แทน';
    }, { enableHighAccuracy: true, timeout: 15000 });
  });

  $('#addPickMap').addEventListener('click', () => {
    $('#addDialog').close();
    startPick('store');
  });

  $('#addForm').addEventListener('input', () => { $('#addError').textContent = ''; });

  $('#addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const data = new FormData(f);
    const cats = data.getAll('cats');
    const name = String(data.get('name') || '').trim();
    const phones = splitList(String(data.get('phone') || ''));
    const err = !name ? 'กรุณากรอกชื่อร้าน'
      : !cats.length ? 'กรุณาเลือกอย่างน้อย 1 หมวดสินค้า'
      : !phones.length ? 'กรุณากรอกเบอร์โทร'
      : !addDraft ? 'กรุณาเลือกตำแหน่งร้าน' : '';
    if (err) {
      $('#addError').textContent = err;
      return;
    }
    const store = {
      id: 'local-' + Date.now().toString(36),
      name, cats, phones,
      line: String(data.get('line') || '').trim(),
      facebook: String(data.get('facebook') || '').trim(),
      website: String(data.get('website') || '').trim(),
      address: String(data.get('address') || '').trim(),
      hours: String(data.get('hours') || '').trim(),
      note: String(data.get('note') || '').trim(),
      lat: addDraft.lat,
      lng: addDraft.lng
    };
    state.mine.push(store);
    saveJSON(MINE_KEY, state.mine);
    f.reset();
    addDraft = null;
    $('#addDialog').close();
    switchTab('nearby');
    const d = distanceKm(state.center, store);
    if (d > state.radiusKm) {
      setCenter(store.lat, store.lng, store.name);
    } else {
      render();
    }
    toast('บันทึกร้านแล้ว (แสดงในเครื่องนี้) กด “คัดลอกข้อมูลร้าน” เพื่อส่งให้ผู้ดูแลเว็บ', 6000);
  });

  /* ---------------- ห้างวัสดุทั่วประเทศ ---------------- */
  function renderChains() {
    $('#chainList').innerHTML = CFG.chains.map((c, i) => {
      const acts = [];
      if (c.phone) acts.push('<a class="act call" href="' + esc(phoneHref(c.phone)) + '">📞 ' + esc(c.phone) + '</a>');
      if (c.line) acts.push('<a class="act line" href="' + esc(lineUrl(c.line)) + '" target="_blank" rel="noopener">LINE ' + esc(c.line) + '</a>');
      if (c.website) acts.push('<a class="act" href="' + esc(safeUrl(c.website)) + '" target="_blank" rel="noopener">🌐 เว็บไซต์ / สั่งออนไลน์</a>');
      acts.push('<button type="button" class="act" data-chain="' + i + '">📍 หาสาขาใกล้ฉัน</button>');
      return '<li class="chain"><h3>' + esc(c.name) + '<small>' + esc(c.nameEn || '') + '</small></h3>' +
        (c.note ? '<p>' + esc(c.note) + '</p>' : '') + '<div class="actions">' + acts.join('') + '</div></li>';
    }).join('');
  }

  $('#chainList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-chain]');
    if (!b) return;
    state.chain = CFG.chains[Number(b.dataset.chain)];
    state.cats.clear();
    switchTab('nearby');
    if (state.radiusKm < 20) setRadius(20);
    else render();
  });

  /* ---------------- แท็บและมุมมอง ---------------- */
  function switchTab(tab) {
    state.tab = tab;
    $$('.tab').forEach((t) => {
      const on = t.dataset.tab === tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on);
    });
    $('#tabNearby').hidden = tab !== 'nearby';
    $('#tabFavs').hidden = tab !== 'favs';
    $('#tabChains').hidden = tab !== 'chains';
  }

  function setView(v, afterShow) {
    document.body.dataset.view = v;
    $$('.view-switch button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    if (v !== 'map') return;
    requestAnimationFrame(() => {
      map.invalidateSize();
      if (afterShow) {
        needsFit = false;
        afterShow();
      } else if (needsFit) {
        fitToRadius();
      }
      if (window.innerWidth < 960) $('.map-panel').scrollIntoView({ block: 'end' });
    });
  }

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function toast(msg, ms = 3200) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  /* ---------------- ช่องค้นหาด้านบน ---------------- */
  // แสดงสิ่งที่หาได้ทันทีจากข้อมูลในเว็บ (หมวดสินค้า ห้างวัสดุ ร้านในพื้นที่ เมือง) ก่อน แล้วต่อด้วยชื่อสถานที่จากออนไลน์
  const placeResults = $('#placeResults');
  let placeItems = [];
  let placeSeq = 0;

  function hidePlaces() {
    placeResults.hidden = true;
  }

  function localSuggestions(q) {
    const qq = q.toLowerCase().replace(/^ร้าน\s*/, '').trim();
    if (!qq) return [];
    const out = [];
    CATS.forEach((c) => {
      if ((c.re && c.re.test(q)) || (qq.length >= 2 && (c.label.includes(qq) || c.short.includes(qq)))) {
        out.push({ kind: 'cat', id: c.id, name: c.icon + ' ' + c.label, detail: 'กรองร้านหมวดนี้ในพื้นที่ที่เลือก' });
      }
    });
    CFG.chains.forEach((c, i) => {
      if (c.match.some((m) => qq.includes(m.toLowerCase()) || (qq.length >= 3 && m.toLowerCase().includes(qq)))) {
        out.push({ kind: 'chain', i, name: '🏬 สาขา' + c.name, detail: 'หาสาขาใกล้ตำแหน่งนี้' });
      }
    });
    storesInRadius()
      .filter((s) => (s.name + ' ' + s.nameAlt + ' ' + s.brand).toLowerCase().includes(qq))
      .sort((a, b) => a.dist - b.dist).slice(0, 5)
      .forEach((s) => out.push({ kind: 'store', id: s.id, name: CAT_BY_ID[s.primary].icon + ' ' + s.name,
        detail: fmtDist(s.dist) + (s.phones.length ? ' · ' + phoneDisplay(s.phones[0]) : '') }));
    CFG.cities.forEach((c) => {
      if (qq.length >= 2 && c.label.includes(qq)) out.push({ kind: 'place', lat: c.lat, lng: c.lng, name: c.label, detail: 'เมือง' });
    });
    return out;
  }

  function renderPlaceResults(q, local, online, pending) {
    placeItems = local.concat(online.map((p) => Object.assign({ kind: 'place' }, p)));
    const item = (p, i) => '<li><button type="button" data-i="' + i + '"><b>' + esc(p.name) + '</b><small>' + esc(p.detail || '') + '</small></button></li>';
    const rows = [];
    if (local.length) rows.push('<li class="group">ในเว็บนี้</li>', ...local.map(item));
    rows.push('<li class="group">ชื่อสถานที่</li>');
    if (online.length) rows.push(...online.map((p, i) => item(p, local.length + i)));
    else rows.push('<li class="empty">' + (pending ? 'กำลังค้นหาสถานที่…' : 'ไม่พบสถานที่ “' + esc(q) + '” ลองพิมพ์ชื่ออำเภอหรือจังหวัด') + '</li>');
    placeResults.innerHTML = rows.join('');
    placeResults.hidden = false;
  }

  // full = กด Enter/ปุ่มค้นหา (ใช้ Nominatim ด้วย) ส่วนตอนพิมพ์ใช้แค่ Photon ตามเงื่อนไขการใช้งานของ Nominatim
  function runPlaceSearch(q, full) {
    const seq = ++placeSeq;
    const local = localSuggestions(q);
    let online = [];
    const sources = full ? [geocodePhoton(q), geocodeNominatim(q)] : [geocodePhoton(q)];
    let pending = sources.length;
    renderPlaceResults(q, local, online, true);
    sources.forEach((p) => withTimeout(p, 8000).then((list) => {
      if (seq !== placeSeq) return;
      const seen = new Set(online.map((x) => x.name + x.lat.toFixed(2) + x.lng.toFixed(2)));
      online = online.concat(list.filter((x) => !seen.has(x.name + x.lat.toFixed(2) + x.lng.toFixed(2))));
    }, () => {}).finally(() => {
      pending--;
      if (seq !== placeSeq) return;
      if (full && !pending && !local.length && online.length === 1) {
        hidePlaces();
        setCenter(online[0].lat, online[0].lng, online[0].name);
        return;
      }
      if (!placeResults.hidden || full) renderPlaceResults(q, local, online, pending > 0);
    }));
  }

  let placeTimer = null;

  $('#placeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(placeTimer);
    const q = $('#placeInput').value.trim();
    if (!q) return;
    const coord = q.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (coord) {
      hidePlaces();
      setCenter(parseFloat(coord[1]), parseFloat(coord[2]), '');
      return;
    }
    runPlaceSearch(q, true);
  });

  $('#placeInput').addEventListener('input', (e) => {
    clearTimeout(placeTimer);
    const q = e.target.value.trim();
    if (q.length < 2) {
      placeSeq++;
      hidePlaces();
      return;
    }
    placeTimer = setTimeout(() => runPlaceSearch(q, false), 400);
  });

  placeResults.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const p = placeItems[Number(b.dataset.i)];
    clearTimeout(placeTimer);
    placeSeq++;
    hidePlaces();
    if (p.kind === 'place') {
      setCenter(p.lat, p.lng, p.name);
    } else if (p.kind === 'cat') {
      state.cats = new Set([p.id]);
      state.chain = null;
      state.shown = PAGE_SIZE;
      switchTab('nearby');
      render();
    } else if (p.kind === 'chain') {
      state.chain = CFG.chains[p.i];
      state.cats.clear();
      switchTab('nearby');
      if (state.radiusKm < 20) setRadius(20);
      else render();
    } else if (p.kind === 'store') {
      clearFilters();
      switchTab('nearby');
      setActive(p.id);
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#placeForm')) hidePlaces();
  });

  /* ---------------- ผูกเหตุการณ์ ---------------- */
  function init() {
    const radiusSel = $('#radiusSelect');
    radiusSel.innerHTML = CFG.radiusOptions.map((r) => '<option value="' + r + '">' + r + ' กม.</option>').join('');
    radiusSel.value = String(state.radiusKm);
    radiusSel.addEventListener('change', () => setRadius(Number(radiusSel.value)));

    const citySel = $('#citySelect');
    citySel.innerHTML += CFG.cities.map((c, i) => '<option value="' + i + '">' + esc(c.label) + '</option>').join('');
    citySel.addEventListener('change', () => {
      if (citySel.value === '') return;
      const c = CFG.cities[Number(citySel.value)];
      citySel.value = '';
      setCenter(c.lat, c.lng, c.label);
    });

    $('#btnLocate').addEventListener('click', locate);
    $('#btnPick').addEventListener('click', () => (state.pick ? endPick() : startPick('center')));
    $('#btnPickCancel').addEventListener('click', () => {
      const p = endPick();
      if (p === 'store') $('#addDialog').showModal();
    });

    els.chips.addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      const id = b.dataset.cat;
      if (!id) state.cats.clear();
      else if (state.cats.has(id)) state.cats.delete(id);
      else state.cats.add(id);
      state.shown = PAGE_SIZE;
      render();
    });

    let textTimer = null;
    $('#textFilter').addEventListener('input', (e) => {
      clearTimeout(textTimer);
      textTimer = setTimeout(() => {
        state.text = e.target.value;
        state.shown = PAGE_SIZE;
        render();
      }, 200);
    });
    $('#phoneOnly').addEventListener('change', (e) => {
      state.phoneOnly = e.target.checked;
      state.shown = PAGE_SIZE;
      render();
    });
    $('#sortSelect').addEventListener('change', (e) => {
      state.sort = e.target.value;
      render();
    });
    els.more.addEventListener('click', () => {
      state.shown += PAGE_SIZE;
      render();
    });

    [els.results, els.favResults, els.status].forEach((el) => el.addEventListener('click', handleStoreAction));
    [els.results, els.favResults].forEach((el) => el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-act="focus"]')) {
        e.preventDefault();
        handleStoreAction(e);
      }
    }));

    $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    $$('.view-switch button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

    $('#btnAddStore').addEventListener('click', openAddDialog);
    $('#btnAbout').addEventListener('click', () => $('#aboutDialog').showModal());
    $$('.dialog').forEach((d) => {
      d.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]') || e.target === d) d.close();
      });
    });

    renderChains();

    els.locLabel.textContent = state.center.label || fmtCoords(state.center);
    setCenter(state.center.lat, state.center.lng, state.center.label);

    // ถ้าเคยอนุญาตตำแหน่งแล้ว และไม่ได้เปิดจากลิงก์ที่แชร์มา ให้ใช้ตำแหน่งปัจจุบันเลย
    if (!fromUrl && navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then((r) => {
        if (r.state === 'granted') locate();
      }).catch(() => {});
    }
  }

  init();
})();
