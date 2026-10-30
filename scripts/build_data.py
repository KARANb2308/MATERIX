#!/usr/bin/env python3
"""
สร้างไฟล์ข้อมูลร้านวัสดุก่อสร้างทั่วประเทศจาก OpenStreetMap (.osm.pbf) + Overture Maps Places

    python scripts/build_data.py thailand-latest.osm.pbf data
    python scripts/build_data.py thailand-latest.osm.pbf data --no-overture   # ใช้เฉพาะ OSM

ร้านเดียวกันที่อยู่ทั้งสองแหล่ง (ห่างไม่เกิน 80 ม. ชื่อคล้ายกัน) จะรวมเป็นรายการ OSM เดียว
โดยเติมเบอร์โทร/เพจ/เว็บไซต์จาก Overture ให้

ผลลัพธ์:
    data/index.json            วันที่ของข้อมูล ขนาดช่อง และจำนวนร้านในแต่ละช่อง
    data/tiles/<lat>_<lng>.json ร้านในช่องตาราง (ขนาด CELL องศา) แต่ละรายการคือ
                               [ชนิด n/w/o(Overture), id, lat, lng, {tags}]

เกณฑ์คัดร้านใช้ค่าจาก js/config.js ชุดเดียวกับหน้าเว็บ
"""
import datetime
import json
import math
import os
import re
import shutil
import subprocess
import sys

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import overture  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CELL = 0.1
DP = 1

KEEP_TAGS = (
    'name', 'name:th', 'name:en', 'brand', 'brand:th', 'shop', 'craft', 'industrial', 'trade', 'product', 'description',
    'phone', 'contact:phone', 'mobile', 'contact:mobile', 'contact:line', 'line', 'contact:facebook', 'facebook',
    'website', 'contact:website', 'url', 'email', 'contact:email', 'opening_hours',
    'addr:full', 'addr:housenumber', 'addr:street', 'addr:subdistrict', 'addr:district', 'addr:province',
    'addr:city', 'addr:postcode',
)


def load_config():
    code = 'global.window={};require(process.argv[1]);process.stdout.write(JSON.stringify(window.MATERIX_CONFIG))'
    out = subprocess.run(['node', '-e', code, os.path.join(ROOT, 'js', 'config.js')],
                         check=True, capture_output=True, text=True).stdout
    return json.loads(out)


class Matcher:
    """เกณฑ์เดียวกับคำค้น Overpass ใน js/app.js (buildQuery)"""

    def __init__(self, cfg):
        cats = cfg['categories']
        self.shops = {v for c in cats for v in c.get('shop', [])}
        self.crafts = {v for c in cats for v in c.get('craft', [])}
        self.industrial = {v for c in cats for v in c.get('industrial', [])}
        self.excluded = set(cfg['excludedShops'])
        keywords = sorted({k for c in cats for k in c.get('keywords', [])})
        self.name_re = re.compile('|'.join(re.escape(k) for k in keywords), re.I)
        self.works_re = re.compile('|'.join(re.escape(p) for p in cfg['worksProducts']), re.I)

    def match(self, tags):
        shop = tags.get('shop')
        if shop in self.shops:
            return True
        if shop and shop not in self.excluded:
            names = ' | '.join(tags.get(k, '') for k in ('name', 'name:th', 'name:en'))
            if self.name_re.search(names):
                return True
        if tags.get('craft') in self.crafts or tags.get('industrial') in self.industrial:
            return True
        return tags.get('man_made') == 'works' and bool(self.works_re.search(tags.get('product', '')))


def tile_key(lat, lng):
    return f'{math.floor(lat / CELL) * CELL:.{DP}f}_{math.floor(lng / CELL) * CELL:.{DP}f}'


def way_center(way):
    lats, lngs = [], []
    for n in way.nodes:
        if n.location.valid():
            lats.append(n.location.lat)
            lngs.append(n.location.lon)
    if not lats:
        return None
    return (min(lats) + max(lats)) / 2, (min(lngs) + max(lngs)) / 2


NAME_NOISE = re.compile(r'ร้าน|บริษัท|บจก|หจก|จำกัด|limited|ltd|co\b|สาขา.*$|[\s.,\-()\'"&/]+', re.I)
PHONE_KEYS = ('phone', 'contact:phone', 'mobile', 'contact:mobile')
NAME_KEYS = ('name', 'name:th', 'name:en', 'brand')


def norm_name(s):
    return NAME_NOISE.sub('', (s or '').lower())


def similarity(a, b):
    """2 = ชื่อเหมือนกัน, 1 = ชื่อหนึ่งอยู่ในอีกชื่อ, 0 = ไม่เหมือน"""
    a, b = norm_name(a), norm_name(b)
    if not a or not b:
        return 0
    if a == b:
        return 2
    return 1 if min(len(a), len(b)) >= 4 and (a in b or b in a) else 0


def similar(a, b):
    return similarity(a, b) > 0


def meters(lat1, lng1, lat2, lng2):
    dy = (lat2 - lat1) * 111320
    dx = (lng2 - lng1) * 111320 * math.cos(math.radians(lat1))
    return math.hypot(dx, dy)


def enrich(dst, src):
    if 'phone' in src and not any(k in dst for k in PHONE_KEYS):
        dst['phone'] = src['phone']
    for key, alts in (('contact:facebook', ('facebook',)), ('contact:line', ('line',)),
                      ('website', ('contact:website', 'url')), ('email', ('contact:email',)), ('addr:full', ())):
        if key in src and key not in dst and not any(a in dst for a in alts):
            dst[key] = src[key]


def merge_overture(records, places):
    """เพิ่มร้านจาก Overture ลงใน records ถ้าซ้ำกับร้านที่มีอยู่ให้เติมข้อมูลติดต่อแทน"""
    grid = {}
    for rec in records:
        grid.setdefault((int(rec[2] * 100), int(rec[3] * 100)), []).append(rec)

    def find_match(p):
        gy, gx = int(p['lat'] * 100), int(p['lng'] * 100)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for rec in grid.get((gy + dy, gx + dx), ()):
                    sim = max(similarity(rec[4].get(k), p['name']) for k in NAME_KEYS)
                    # ชื่อเหมือนกันทุกตัวอักษรยอมให้ห่างได้มากกว่า (ร้านใหญ่ พิกัดสองแหล่งมักต่างกัน)
                    if sim and meters(rec[2], rec[3], p['lat'], p['lng']) <= (250 if sim == 2 else 80):
                        return rec
        return None

    merged = added = 0
    for p in places:
        rec = find_match(p)
        if rec:
            enrich(rec[4], p['tags'])
            merged += 1
            continue
        rec = ['o', p['id'], round(p['lat'], 6), round(p['lng'], 6), p['tags']]
        records.append(rec)
        grid.setdefault((int(rec[2] * 100), int(rec[3] * 100)), []).append(rec)
        added += 1
    return merged, added


def data_timestamp(fp):
    ts = fp.header.get('osmosis_replication_timestamp')
    if ts:
        return ts
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def build(pbf, out_dir, use_overture=True):
    matcher = Matcher(load_config())
    fp = (osmium.FileProcessor(pbf, osmium.osm.NODE | osmium.osm.WAY)
          .with_locations()
          .with_filter(osmium.filter.KeyFilter('shop', 'craft', 'industrial', 'man_made')))

    records = []
    for obj in fp:
        tags = {t.k: t.v for t in obj.tags}
        if not matcher.match(tags):
            continue
        if obj.is_node():
            if not obj.location.valid():
                continue
            kind, lat, lng = 'n', obj.location.lat, obj.location.lon
        else:
            center = way_center(obj)
            if center is None:
                continue
            kind, (lat, lng) = 'w', center
        kept = {k: v for k, v in tags.items() if k in KEEP_TAGS}
        records.append([kind, obj.id, round(lat, 6), round(lng, 6), kept])
    osm_count = len(records)
    print(f'OpenStreetMap: {osm_count} stores')

    release = None
    if use_overture:
        try:
            release, places = overture.fetch()
            merged, added = merge_overture(records, places)
            print(f'Overture {release}: {len(places)} stores, {merged} merged into OSM stores, {added} added')
        except Exception as e:  # Overture ล่ม — ยังได้ข้อมูล OSM
            print(f'WARNING: skipped Overture: {e}')

    tiles = {}
    for rec in records:
        tiles.setdefault(tile_key(rec[2], rec[3]), []).append(rec)
    total = len(records)

    tiles_dir = os.path.join(out_dir, 'tiles')
    shutil.rmtree(tiles_dir, ignore_errors=True)
    os.makedirs(tiles_dir)
    for key, rows in tiles.items():
        rows.sort(key=lambda r: (r[0], str(r[1])))
        with open(os.path.join(tiles_dir, key + '.json'), 'w', encoding='utf-8') as f:
            json.dump(rows, f, ensure_ascii=False, separators=(',', ':'))

    index = {
        'v': 1,
        'generated': data_timestamp(fp),
        'source': 'OpenStreetMap (Geofabrik extract)' + (f', Overture Maps Places {release}' if release else ''),
        'overture': release,
        'cell': CELL,
        'dp': DP,
        'total': total,
        'cells': {k: len(tiles[k]) for k in sorted(tiles)},
    }
    with open(os.path.join(out_dir, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{total} stores in {len(tiles)} tiles, data as of {index["generated"]}')


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 2:
        sys.exit(__doc__)
    build(args[0], args[1], use_overture='--no-overture' not in sys.argv)
