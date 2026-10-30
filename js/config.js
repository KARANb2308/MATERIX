/*
 * MATERIX — การตั้งค่าหลักของเว็บ
 * แก้ไขหมวดหมู่ จังหวัดลัด และรายชื่อห้างวัสดุได้ที่ไฟล์นี้
 */
window.MATERIX_CONFIG = {
  // จุดเริ่มต้นเมื่อผู้ใช้ยังไม่ได้เลือกตำแหน่ง
  defaultCenter: { lat: 13.7563, lng: 100.5018, label: 'กรุงเทพมหานคร' },
  defaultRadiusKm: 5,
  radiusOptions: [1, 3, 5, 10, 20, 30],

  // ข้อมูลร้านทั่วประเทศที่สร้างไว้ล่วงหน้า (scripts/build_data.py) — ค้นหาได้ทันทีโดยไม่ต้องรอเซิร์ฟเวอร์แผนที่
  dataUrl: 'data/',

  // ใช้เมื่อกด "ดึงข้อมูลล่าสุด" หรือเมื่อไม่มีข้อมูลที่สร้างไว้ล่วงหน้า
  overpassEndpoints: [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
  ],
  nominatimUrl: 'https://nominatim.openstreetmap.org',
  photonUrl: 'https://photon.komoot.io',
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">ผู้ร่วมให้ข้อมูล OpenStreetMap</a>',

  // ร้านที่ชื่อบังเอิญมีคำค้น แต่ไม่ใช่ร้านวัสดุแน่นอน
  excludedShops: ['jewelry', 'clothes', 'fashion', 'shoes', 'bag', 'beauty', 'cosmetics', 'hairdresser', 'massage',
    'convenience', 'supermarket', 'bakery', 'butcher', 'seafood', 'greengrocer', 'frozen_food', 'coffee', 'tea',
    'beverages', 'alcohol', 'wine', 'tobacco', 'e-cigarette', 'books', 'stationery', 'optician', 'mobile_phone',
    'car', 'motorcycle', 'tyres', 'laundry', 'dry_cleaning', 'pet', 'florist', 'gift', 'toys', 'lottery',
    'tattoo', 'travel_agency', 'funeral_directors', 'tailor', 'chemist', 'medical_supply', 'rice', 'pastry', 'confectionery',
    'computer', 'electronics', 'video_games', 'hifi', 'camera', 'art', 'fabric'],

  // โรงงาน (man_made=works) ที่ผลิตสินค้าเหล่านี้นับเป็นแหล่งวัสดุ
  worksProducts: ['concrete', 'cement', 'brick', 'steel', 'timber'],

  /*
   * หมวดหมู่สินค้า
   * - shop / craft / industrial : ค่าแท็กใน OpenStreetMap ที่นับว่าอยู่ในหมวดนี้
   * - keywords : คำในชื่อร้าน (ไม่สนตัวพิมพ์เล็ก/ใหญ่)
   * ร้านหนึ่งอยู่ได้หลายหมวด ลำดับในอาร์เรย์คือลำดับปุ่มบนหน้าเว็บ
   */
  categories: [
    {
      id: 'general', label: 'วัสดุก่อสร้างทั่วไป', short: 'วัสดุทั่วไป', icon: '🧱', color: '#c2410c',
      shop: ['hardware', 'trade', 'building_materials'],
      keywords: ['วัสดุก่อสร้าง', 'ค้าวัสดุ', 'วัสดุภัณฑ์', 'ฮาร์ดแวร์', 'hardware', 'building material']
    },
    {
      id: 'homecenter', label: 'โฮมเซ็นเตอร์ / ห้างวัสดุ', short: 'ห้างวัสดุ', icon: '🏬', color: '#7048e8',
      shop: ['doityourself'],
      keywords: ['โฮมโปร', 'homepro', 'ไทวัสดุ', 'thai watsadu', 'thaiwatsadu', 'โกลบอลเฮ้าส์', 'โกลบอล เฮ้าส์',
        'global house', 'globalhouse', 'บุญถาวร', 'boonthavorn', 'ดูโฮม', 'dohome', 'do home',
        'เมกาโฮม', 'เมกา โฮม', 'mega home', 'megahome', 'บีเอ็นบี โฮม', 'bnb home', 'scg home']
    },
    {
      id: 'cement', label: 'ปูน คอนกรีต อิฐ ทราย หิน', short: 'ปูน/คอนกรีต', icon: '🪨', color: '#495057',
      industrial: ['concrete', 'cement', 'concrete_plant', 'brickworks'],
      keywords: ['ปูน', 'คอนกรีต', 'อิฐ', 'ขายทราย', 'ทรายหิน', 'หินทราย', 'หินคลุก', 'ดินถม', 'cement', 'concrete', 'brick', 'ready mix', 'readymix', 'ซีแพค', 'cpac']
    },
    {
      id: 'steel', label: 'เหล็ก และโลหะ', short: 'เหล็ก', icon: '🔩', color: '#1c7ed6',
      craft: ['metal_construction'],
      keywords: ['เหล็ก', 'สแตนเลส', 'steel', 'stainless', 'metal']
    },
    {
      id: 'wood', label: 'ไม้ และไม้แปรรูป', short: 'ไม้', icon: '🪵', color: '#8d5524',
      shop: ['timber', 'wood'],
      craft: ['sawmill'],
      industrial: ['sawmill'],
      keywords: ['ค้าไม้', 'โรงไม้', 'ไม้แปรรูป', 'โรงเลื่อย', 'ไม้อัด', 'ไม้เทียม', 'timber', 'lumber', 'sawmill']
    },
    {
      id: 'tiles', label: 'กระเบื้อง สุขภัณฑ์ พื้น', short: 'กระเบื้อง/สุขภัณฑ์', icon: '🛁', color: '#0c8599',
      shop: ['tiles', 'bathroom_furnishing', 'flooring'],
      keywords: ['กระเบื้อง', 'สุขภัณฑ์', 'เซรามิก', 'sanitary', 'ceramic', 'flooring']
    },
    {
      id: 'paint', label: 'สี และเคมีภัณฑ์ก่อสร้าง', short: 'สี', icon: '🎨', color: '#d6336c',
      shop: ['paint'],
      keywords: ['ร้านสี', 'ศูนย์สี', 'สีทาบ้าน', 'เบเยอร์', 'beger', 'jotun', 'nippon paint', 'paint']
    },
    {
      id: 'electric', label: 'ไฟฟ้า และประปา', short: 'ไฟฟ้า/ประปา', icon: '💡', color: '#e67700',
      shop: ['electrical', 'lighting', 'plumbing'],
      keywords: ['ไฟฟ้า', 'ประปา', 'ปั๊มน้ำ', 'ท่อพีวีซี', 'ท่อ pvc', 'electric', 'plumbing', 'lighting']
    },
    {
      id: 'doorroof', label: 'ประตู หน้าต่าง กระจก หลังคา', short: 'ประตู/หลังคา', icon: '🚪', color: '#5c940d',
      shop: ['doors', 'windows', 'glaziery'],
      keywords: ['ประตูไม้', 'ประตูเหล็ก', 'ประตูม้วน', 'ประตูรั้ว', 'ประตูหน้าต่าง', 'หน้าต่าง', 'กระจก', 'อลูมิเนียม', 'อะลูมิเนียม',
        'หลังคา', 'เมทัลชีท', 'metal sheet', 'metalsheet', 'aluminium', 'aluminum', 'roofing']
    },
    {
      id: 'rental', label: 'เครื่องมือ / เช่าเครื่องจักร', short: 'เครื่องมือ/เช่า', icon: '🏗️', color: '#f08c00',
      shop: ['tool_hire', 'tools', 'machinery'],
      keywords: ['เช่านั่งร้าน', 'นั่งร้าน', 'เช่าเครื่อง', 'เครื่องมือช่าง', 'เครื่องจักร', 'แบ็คโฮ', 'แบคโฮ', 'รถขุด',
        'รถเครน', 'เครน', 'backhoe', 'excavator', 'crane', 'scaffold', 'tool hire', 'equipment rental', 'power tools']
    }
  ],

  // ปุ่มลัดเปลี่ยนเมือง (พิกัดกลางเมืองโดยประมาณ)
  cities: [
    { label: 'กรุงเทพมหานคร', lat: 13.7563, lng: 100.5018 },
    { label: 'นนทบุรี', lat: 13.8621, lng: 100.5144 },
    { label: 'ปทุมธานี', lat: 14.0208, lng: 100.5250 },
    { label: 'สมุทรปราการ', lat: 13.5991, lng: 100.5998 },
    { label: 'พระนครศรีอยุธยา', lat: 14.3532, lng: 100.5689 },
    { label: 'ชลบุรี', lat: 13.3611, lng: 100.9847 },
    { label: 'พัทยา', lat: 12.9236, lng: 100.8825 },
    { label: 'ระยอง', lat: 12.6814, lng: 101.2816 },
    { label: 'หัวหิน', lat: 12.5684, lng: 99.9577 },
    { label: 'นครสวรรค์', lat: 15.7047, lng: 100.1372 },
    { label: 'พิษณุโลก', lat: 16.8211, lng: 100.2659 },
    { label: 'เชียงใหม่', lat: 18.7883, lng: 98.9853 },
    { label: 'เชียงราย', lat: 19.9105, lng: 99.8406 },
    { label: 'นครราชสีมา', lat: 14.9799, lng: 102.0977 },
    { label: 'ขอนแก่น', lat: 16.4322, lng: 102.8236 },
    { label: 'อุดรธานี', lat: 17.4138, lng: 102.7872 },
    { label: 'อุบลราชธานี', lat: 15.2287, lng: 104.8564 },
    { label: 'สุราษฎร์ธานี', lat: 9.1382, lng: 99.3215 },
    { label: 'ภูเก็ต', lat: 7.8804, lng: 98.3923 },
    { label: 'หาดใหญ่ (สงขลา)', lat: 7.0086, lng: 100.4747 }
  ],

  /*
   * ห้างวัสดุก่อสร้างรายใหญ่ (สั่งออนไลน์ / มีสาขาทั่วประเทศ)
   * ใส่เบอร์ Call Center เฉพาะที่ยืนยันจากประกาศของบริษัทแล้วเท่านั้น
   * - match : คำที่ใช้ค้นหาสาขาจากชื่อร้านในแผนที่
   */
  chains: [
    {
      name: 'ไทวัสดุ', nameEn: 'Thai Watsadu', phone: '1308', line: '@thaiwatsadu',
      website: 'https://www.thaiwatsadu.com', match: ['ไทวัสดุ', 'thai watsadu', 'thaiwatsadu'],
      note: 'วัสดุก่อสร้าง เครื่องมือช่าง ของแต่งบ้าน'
    },
    {
      name: 'โฮมโปร', nameEn: 'HomePro', phone: '1284',
      website: 'https://www.homepro.co.th', match: ['โฮมโปร', 'homepro'],
      note: 'Call Center สั่งซื้อได้ 24 ชั่วโมง'
    },
    {
      name: 'โกลบอลเฮ้าส์', nameEn: 'Global House',
      website: 'https://www.globalhouse.co.th', match: ['โกลบอล', 'global house', 'globalhouse'],
      note: 'ศูนย์รวมวัสดุก่อสร้างและของแต่งบ้าน'
    },
    {
      name: 'ดูโฮม', nameEn: 'Dohome',
      website: 'https://www.dohome.co.th', match: ['ดูโฮม', 'dohome', 'do home'],
      note: 'วัสดุก่อสร้าง ราคาส่ง'
    },
    {
      name: 'บุญถาวร', nameEn: 'Boonthavorn',
      website: 'https://www.boonthavorn.com', match: ['บุญถาวร', 'boonthavorn'],
      note: 'กระเบื้อง สุขภัณฑ์ ส่งทั่วประเทศ'
    },
    {
      name: 'เมกาโฮม', nameEn: 'Mega Home',
      website: 'https://www.megahome.co.th', match: ['เมกาโฮม', 'เมกา โฮม', 'mega home', 'megahome'],
      note: 'ศูนย์วัสดุก่อสร้างครบวงจร'
    }
  ]
};
