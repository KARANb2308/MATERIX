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
         'tool|scaffold|machinery|construction|bathroom|kitchen_and_bath|fence|stone|marble|granite|pipe|aluminum')

# หมวดหลักของ Overture → แท็กแบบ OSM (ให้ js/config.js จัดหมวดต่อ) ใช้กฎแรกที่ตรง
# ชื่อหมวดคั่นคำด้วย _ จึงใช้ (^|_) … (_|$) กันคำย่อยตรงผิด เช่น door ใน outdoor
CATEGORY_RULES = [
    (r'(^|_)home_improvement', {'shop': 'doityourself'}),
    (r'(^|_)hardware(_|$)', {'shop': 'hardware'}),
    (r'building_suppl|building_material|construction_material', {'shop': 'building_materials'}),
    (r'(^|_)(lumber|timber|sawmill)', {'shop': 'timber'}),
    (r'(^|_)(tile|tiles|flooring)(_|$)|kitchen_and_bath|bathroom_suppl|sanitary', {'shop': 'tiles'}),
    (r'(^|_)paint_store|paint_suppl', {'shop': 'paint'}),
    (r'plumbing_suppl|plumbing_store', {'shop': 'plumbing'}),
    (r'electrical_suppl|electrical_store|lighting_store|lighting_fixture', {'shop': 'electrical'}),
    (r'(^|_)(steel|metal_suppl|metal_fabricat|aluminum|aluminium)', {'craft': 'metal_construction'}),
    (r'(^|_)(concrete|cement|ready_mix|brick)', {'industrial': 'concrete'}),
    (r'glass_and_mirror|(^|_)(doors?|windows?)(_|$)', {'shop': 'glaziery'}),
    (r'equipment_rental|tool_rental|scaffold|(^|_)machinery|heavy_equipment', {'shop': 'tool_hire'}),
]
# หมวดที่บังเอิญมีคำค้น แต่ไม่ใช่ร้านวัสดุ (เทียบเป็นคำ)
EXCLUDE = re.compile(r'(^|_)(restaurant|cafe|food|hotel|eyewear|optician|optical|auto|automotive|car|vehicle|motorcycle|'
                     r'bicycle|boat|electronics|computer|mobile|phone|appliance|appliances|jewelry|clothing|beauty|salon|'
                     r'spa|massage|school|church|temple|government|hospital|clinic|bank|atm|event|party|music|art|museum|'
                     r'bar|pub|toy|toys|game|games|camera|audio|medical|pharmacy|pet|tattoo|nail|washing|cleaning|'
                     r'tinting|repair)(_|$)')


def latest_release():
    with urllib.request.urlopen(LIST_URL, timeout=60) as res:
        xml = res.read().decode()
    releases = sorted(re.findall(r'<Prefix>release/([^/<]+)/</Prefix>', xml))
    if not releases:
        raise RuntimeError('no Overture releases listed')
    return releases[::-1]


def map_category(primary, cat_text):
    if not primary or EXCLUDE.search(primary):
        return None
    for pattern, tags in CATEGORY_RULES:
        if re.search(pattern, primary):
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
            mapped = map_category(r['primary_cat'], r['cat_text'])
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
