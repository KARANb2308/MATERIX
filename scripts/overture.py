"""
ร้านวัสดุก่อสร้างจาก Overture Maps Places (https://overturemaps.org) — ข้อมูลเปิดที่มีเบอร์โทร/เพจ Facebook มากกว่า OSM

อ่านไฟล์ GeoParquet จาก S3 สาธารณะของ Overture ด้วย DuckDB เฉพาะกรอบประเทศไทย
แล้วแปลงเป็นแท็กแบบ OSM เพื่อให้หน้าเว็บจัดหมวดได้เหมือนข้อมูล OSM
"""
import re
import urllib.request
from collections import Counter

BUCKET = 'overturemaps-us-west-2'
LIST_URL = f'https://{BUCKET}.s3.us-west-2.amazonaws.com/?list-type=2&prefix=release/&delimiter=/'
TH_BBOX = (97.3, 5.6, 105.7, 20.5)  # xmin, ymin, xmax, ymax
MIN_CONFIDENCE = 0.5

# คัดกว้าง ๆ ก่อนใน SQL (ชื่อหมวดของ Overture เป็นภาษาอังกฤษแบบ snake_case)
BROAD = ('hardware|building_suppl|building_material|home_improvement|lumber|timber|tile|flooring|paint|plumb|'
         'electrical|lighting|steel|metal|concrete|cement|brick|sand|gravel|glass|door|window|roof|equipment_rental|'
         'tool|scaffold|machinery|construction|bathroom|kitchen_and_bath|fence|stone|marble|granite|pipe|aluminum|'
         'masonry|engineering|industrial_equipment|welding|woodworking')

# หมวดหลักของ Overture → แท็กแบบ OSM (ให้ js/config.js จัดหมวดต่อจากแท็กและชื่อร้าน)
# รายการนี้คัดจากรายงานหมวดที่พบจริงในประเทศไทย (ดู log ของ workflow "Update store data")
CATEGORY_TAGS = {
    'building_supply_store': {'shop': 'building_materials'},
    'hardware_store': {'shop': 'hardware'},
    'hardware_home_and_garden_store': {'shop': 'hardware'},
    'home_improvement_store': {'shop': 'doityourself'},
    'welding_supply_store': {'shop': 'hardware'},
    'metal_supplier': {'craft': 'metal_construction'},
    'metal_fabricator': {'craft': 'metal_construction'},
    'steel_fabricator': {'craft': 'metal_construction'},
    'fence_and_gate_sales_service': {'craft': 'metal_construction'},
    'glass_and_mirror_sales_service': {'shop': 'glaziery'},
    'windows_installation': {'shop': 'windows'},
    'window_supplier': {'shop': 'windows'},
    'garage_door_service': {'shop': 'doors'},
    'roofing': {'shop': 'trade'},
    'lighting_store': {'shop': 'lighting'},
    'lighting_fixtures_and_equipment': {'shop': 'lighting'},
    'electrical_supply_store': {'shop': 'electrical'},
    'plumbing_supply_store': {'shop': 'plumbing'},
    'lumber_store': {'shop': 'timber'},
    'woodworking_supply_store': {'shop': 'timber'},
    'cement_supplier': {'industrial': 'cement'},
    'granite_supplier': {'shop': 'tiles'},
    'tile_store': {'shop': 'tiles'},
    'flooring_store': {'shop': 'flooring'},
    'paint_store': {'shop': 'paint'},
    'machine_and_tool_rental': {'shop': 'tool_hire'},
    'construction_equipment_rental': {'shop': 'tool_hire'},
    'heavy_equipment_rental': {'shop': 'tool_hire'},
}

# หมวดผู้รับเหมา/บริการ — รับเฉพาะเมื่อชื่อร้านบอกว่าขายวัสดุหรือให้เช่าเครื่องมือ (ใช้กฎแรกที่ตรง)
NAME_GATED = {'masonry_concrete', 'stone_and_masonry', 'building_or_construction_service', 'engineering_service',
              'industrial_equipment_manufacturer'}
NAME_RULES = [
    (re.compile(r'เช่า|นั่งร้าน|แบ็?คโฮ|รถขุด|เครน|rental|for rent|scaffold', re.I), {'shop': 'tool_hire'}),
    (re.compile(r'คอนกรีต|ปูน|อิฐ|ทราย|หินคลุก|ดินถม|เสาเข็ม|concrete|cement|brick|ready ?mix', re.I), {'industrial': 'concrete'}),
    (re.compile(r'วัสดุ|ฮาร์ดแวร์|hardware|building material', re.I), {'shop': 'building_materials'}),
    (re.compile(r'เหล็ก|เมทัลชีท|steel|metal ?sheet', re.I), {'craft': 'metal_construction'}),
]

# ชื่อที่ไม่ใช่ร้านวัสดุแน่นอน แม้ Overture จะจัดหมวดไว้ใกล้เคียง
NAME_EXCLUDE = re.compile(r'บอนไซ|bonsai|ต้นไม้|พันธุ์ไม้|กล้วยไม้|ไม้ประดับ|nursery|ไอที|คอมพิวเตอร์|computer|โรงแรม|hotel|'
                          r'รีสอร์ท|resort|ร้านอาหาร|restaurant|คาเฟ่|cafe|coffee|กาแฟ', re.I)


def latest_release():
    with urllib.request.urlopen(LIST_URL, timeout=60) as res:
        xml = res.read().decode()
    releases = sorted(re.findall(r'<Prefix>release/([^/<]+)/</Prefix>', xml))
    if not releases:
        raise RuntimeError('no Overture releases listed')
    return releases[::-1]


def map_category(primary, name):
    if not primary or not name or NAME_EXCLUDE.search(name):
        return None
    if primary in CATEGORY_TAGS:
        return CATEGORY_TAGS[primary]
    if primary in NAME_GATED:
        for pattern, tags in NAME_RULES:
            if pattern.search(name):
                return tags
    return None


def _first(items):
    return items[0] if items else None


def to_tags(row):
    """แปลงแถว Overture เป็นแท็กแบบ OSM (เก็บเฉพาะที่หน้าเว็บใช้)"""
    tags = dict(row['mapped'])
    tags['name'] = row['name']
    phones = [p for p in (row['phones'] or []) if p]
    if phones:
        tags['phone'] = ';'.join(dict.fromkeys(phones))
    for url in row['socials'] or []:
        low = url.lower()
        if 'facebook.com' in low and 'contact:facebook' not in tags:
            tags['contact:facebook'] = url
        elif 'line.me' in low and 'contact:line' not in tags:
            tags['contact:line'] = url
    for url in row['websites'] or []:
        if 'facebook.com' in url.lower():
            tags.setdefault('contact:facebook', url)
        elif 'website' not in tags:
            tags['website'] = url
    email = _first(row['emails'] or [])
    if email:
        tags['email'] = email
    addr = _first(row['addresses'] or []) or {}
    region = addr.get('region') or ''
    parts = [addr.get('freeform'), addr.get('locality'), '' if region.startswith('TH-') else region, addr.get('postcode')]
    full = ' '.join(p for p in parts if p)
    if full:
        tags['addr:full'] = full
    return tags


def fetch(log=print):
    """คืน (release, rows) แต่ละแถวมี id, name, lat, lng, primary, tags"""
    import duckdb

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    last_err = None
    for release in latest_release()[:3]:
        src = f"read_parquet('s3://{BUCKET}/release/{release}/theme=places/type=place/*', hive_partitioning=1)"
        try:
            cols = {r[0] for r in con.execute(f'DESCRIBE SELECT * FROM {src}').fetchall()}
        except Exception as e:  # รุ่นที่ยังอัปโหลดไม่ครบ — ลองรุ่นก่อนหน้า
            last_err = e
            log(f'Overture {release}: {e}')
            continue

        cat_parts, primary_parts = [], []
        if 'taxonomy' in cols:
            primary_parts.append('taxonomy.primary')
            cat_parts += ['taxonomy.primary', "array_to_string(taxonomy.hierarchy, '|')", "array_to_string(taxonomy.alternates, '|')"]
        if 'categories' in cols:
            primary_parts.append('categories.primary')
            cat_parts += ['categories.primary', "array_to_string(categories.alternate, '|')"]
        if 'basic_category' in cols:
            cat_parts.append('basic_category')
        status = 'operating_status' if 'operating_status' in cols else 'NULL'
        opt = lambda c: c if c in cols else 'NULL'
        xmin, ymin, xmax, ymax = TH_BBOX
        sql = f"""
            SELECT * FROM (
              SELECT id, names.primary AS name, coalesce({', '.join(primary_parts)}) AS primary_cat,
                     lower(concat_ws('|', {', '.join(cat_parts)})) AS cat_text,
                     confidence, {status} AS status, {opt('phones')} AS phones, {opt('websites')} AS websites,
                     {opt('socials')} AS socials, {opt('emails')} AS emails, {opt('addresses')} AS addresses,
                     (bbox.ymin + bbox.ymax) / 2 AS lat, (bbox.xmin + bbox.xmax) / 2 AS lng
              FROM {src}
              WHERE bbox.xmin >= {xmin} AND bbox.xmax <= {xmax} AND bbox.ymin >= {ymin} AND bbox.ymax <= {ymax}
            )
            WHERE regexp_matches(cat_text, '{BROAD}') AND name IS NOT NULL
        """
        cur = con.execute(sql)
        names = [d[0] for d in cur.description]
        raw = [dict(zip(names, r)) for r in cur.fetchall()]
        log(f'Overture {release}: {len(raw)} places in Thailand match the broad category filter')

        report = Counter()
        rows = []
        for r in raw:
            addr = _first(r['addresses'] or []) or {}
            if addr.get('country') not in (None, 'TH'):
                continue
            if (r['status'] or 'open') != 'open' or (r['confidence'] is not None and r['confidence'] < MIN_CONFIDENCE):
                continue
            mapped = map_category(r['primary_cat'], r['name'])
            report[(r['primary_cat'], bool(mapped))] += 1
            if not mapped:
                continue
            r['mapped'] = mapped
            rows.append({'id': r['id'], 'name': r['name'], 'lat': r['lat'], 'lng': r['lng'],
                         'primary': r['primary_cat'], 'tags': to_tags(r)})

        log('Overture categories (count, kept?, primary):')
        for (cat, kept), n in report.most_common(200):
            log(f'  {n:6d}  {"KEEP" if kept else "skip"}  {cat}')
        return release, rows
    raise RuntimeError(f'Overture unavailable: {last_err}')
