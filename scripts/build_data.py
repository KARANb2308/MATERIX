#!/usr/bin/env python3
"""
สร้างไฟล์ข้อมูลร้านวัสดุก่อสร้างทั่วประเทศจากไฟล์ OpenStreetMap (.osm.pbf)

    python scripts/build_data.py thailand-latest.osm.pbf data

ผลลัพธ์:
    data/index.json            วันที่ของข้อมูล ขนาดช่อง และจำนวนร้านในแต่ละช่อง
    data/tiles/<lat>_<lng>.json ร้านในช่องตาราง (ขนาด CELL องศา) แต่ละรายการคือ
                               [ชนิด n/w, OSM id, lat, lng, {tags}]

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


def data_timestamp(fp):
    ts = fp.header.get('osmosis_replication_timestamp')
    if ts:
        return ts
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def build(pbf, out_dir):
    matcher = Matcher(load_config())
    fp = (osmium.FileProcessor(pbf, osmium.osm.NODE | osmium.osm.WAY)
          .with_locations()
          .with_filter(osmium.filter.KeyFilter('shop', 'craft', 'industrial', 'man_made')))

    tiles = {}
    total = 0
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
        tiles.setdefault(tile_key(lat, lng), []).append([kind, obj.id, round(lat, 6), round(lng, 6), kept])
        total += 1

    tiles_dir = os.path.join(out_dir, 'tiles')
    shutil.rmtree(tiles_dir, ignore_errors=True)
    os.makedirs(tiles_dir)
    for key, rows in tiles.items():
        rows.sort(key=lambda r: (r[0], r[1]))
        with open(os.path.join(tiles_dir, key + '.json'), 'w', encoding='utf-8') as f:
            json.dump(rows, f, ensure_ascii=False, separators=(',', ':'))

    index = {
        'v': 1,
        'generated': data_timestamp(fp),
        'source': 'OpenStreetMap (Geofabrik extract)',
        'cell': CELL,
        'dp': DP,
        'total': total,
        'cells': {k: len(tiles[k]) for k in sorted(tiles)},
    }
    with open(os.path.join(out_dir, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{total} stores in {len(tiles)} tiles, data as of {index["generated"]}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    build(sys.argv[1], sys.argv[2])
