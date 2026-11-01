/**
 * ============================================================================
 *  NusaStore v3.0 ProAPI — Backend Inti REST API (Kode.gs)
 *  Arsitektur: Decoupled Frontend (GitHub Pages) + Pure JSON REST API (GAS)
 *
 *  Skill Terintegrasi:
 *  1. gas-pro-api                 : doGet & doPost murni JSON, bebas CORS
 *  2. gas-rahasia-script-properties: Zero literal secrets, HMAC token, redaksi
 *  3. gas-scale-turbo             : CacheX chunking, scoped version, telemetri
 *  4. gas-notifikasi-wa-crm       : Antrean non-blocking WA/Email & CRM Kontak
 *  5. gas-migrasi-database        : Upsert idempoten & pindai dry-run aman
 * ============================================================================
 */

const APP = {
  NAME: 'NusaStore',
  VERSION: '3.0.0',
  TZ: 'Asia/Jakarta',
  FOLDER_ROOT: 'NusaStore_App',
  FOLDER_UPLOADS: 'NusaStore_Uploads',
  FOLDER_PROOF: 'Bukti_Transfer',
  FOLDER_PRODUCT_IMG: 'Gambar_Produk',
  FOLDER_INVOICE: 'Invoice',
  FOLDER_EXPORT: 'Ekspor',
  SS_NAME: 'Database_NusaStore',
  SESSION_HOURS: 8,
  CACHE_TTL: 21600,
  FONNTE_URL: 'https://api.fonnte.com/send',
  FONNTE_VALIDATE_URL: 'https://api.fonnte.com/validate',
  FONNTE_DEVICE_URL: 'https://api.fonnte.com/device'
};

const SH = {
  PRODUK: 'Produk',
  PESANAN: 'Pesanan',
  KATEGORI: 'Kategori',
  PENGATURAN: 'Pengaturan',
  TESTIMONI: 'Testimoni',
  LISENSI: 'Lisensi',
  LOG_WA: 'Log_WA',
  NEWSLETTER: 'Newsletter',
  ANTRIAN_NOTIF: 'AntrianNotif',
  BLAST_WA: 'BlastWA',
  CRM_KONTAK: 'CRM_Kontak',
  CRM_INTERAKSI: 'CRM_Interaksi',
  APPCONFIG: 'AppConfig'
};

/**
 * Skema kolom setiap sheet.
 * Urutan kolom v2.4 dipertahankan 100% (Data Suci), kolom baru (galeri_url) ditaruh paling belakang.
 */
const HEADERS = {
  Produk: [
    'id_produk', 'nama_produk', 'kategori', 'deskripsi', 'harga', 'harga_coret', 'gambar_url',
    'badge_promo', 'status_aktif', 'spesifikasi', 'rating', 'jumlah_ulasan', 'urutan', 'diperbarui',
    'galeri_url'
  ],
  Pesanan: [
    'id_pesanan', 'tanggal_order', 'nama_pelanggan', 'no_whatsapp', 'id_produk', 'nama_produk',
    'total_harga', 'status_pesanan', 'sumber_pesanan', 'catatan', 'link_bukti_transfer',
    'qty', 'item_json', 'metode_bayar', 'kunci_lisensi', 'diperbarui', 'riwayat_status'
  ],
  Kategori: ['id_kategori', 'nama_kategori', 'icon_url', 'subjudul', 'urutan'],
  Pengaturan: ['key', 'value', 'keterangan'],
  Testimoni: [
    'id_testimoni', 'nama', 'jabatan_perusahaan', 'avatar_url', 'produk_terkait',
    'rating', 'kutipan_singkat', 'cerita_lengkap', 'hasil_highlight', 'tanggal', 'terverifikasi', 'tampil'
  ],
  Lisensi: ['kode_lisensi', 'id_produk', 'status', 'id_pesanan', 'tanggal_alokasi', 'dibuat'],
  Log_WA: ['waktu', 'id_pesanan', 'nomor', 'template', 'status', 'http_code', 'message_id', 'ringkasan_pesan'],
  Newsletter: ['email', 'tanggal', 'sumber'],
  AntrianNotif: [
    'AntrianID', 'Kanal', 'Tujuan', 'NamaPenerima', 'Subjek', 'Pesan', 'Event',
    'RefID', 'BlastID', 'Status', 'Percobaan', 'Respon', 'DibuatPada', 'DikirimPada'
  ],
  BlastWA: [
    'BlastID', 'Judul', 'Pesan', 'Sasaran', 'Total', 'Terkirim', 'Gagal',
    'UkuranBatch', 'JedaDetik', 'Status', 'DibuatOleh', 'Tanggal', 'SelesaiPada'
  ],
  CRM_Kontak: [
    'KontakID', 'Nama', 'Email', 'NoWA', 'Segmen', 'Sumber', 'RefID', 'Tag',
    'StatusWA', 'CekWAAt', 'EmailValid', 'OptOut', 'Catatan', 'JumlahPesan',
    'TerakhirDihubungi', 'Info', 'DibuatPada', 'DiperbaruiPada'
  ],
  CRM_Interaksi: ['InteraksiID', 'KontakID', 'Kanal', 'Arah', 'Ringkasan', 'RefID', 'Oleh', 'Tanggal'],
  AppConfig: ['key', 'value', 'catatan']
};

const STATUS_LIST = ['Pending', 'Lunas', 'Diproses', 'Selesai', 'Batal'];
const PAID_STATUS = ['Lunas', 'Diproses', 'Selesai'];
const SUMBER_LIST = ['Katalog Web', 'Input Admin (WA Chat)', 'Input Admin (Offline)'];
const ORDER_ID_RE = /^ORD-\d{8}-[A-Z0-9]{4}$/;

const TPL = {
  web: 'Halo {nama_toko}, saya ingin memesan:\n{daftar_produk}\n- Nama Pemesan: {nama}\n- No. HP: {no_wa}\n- Catatan: {catatan}\n- ID Pesanan: {id_pesanan}\nMohon info instruksi pembayaran selanjutnya. Terima kasih!',
  transfer: 'Halo Kak *{nama}*, terima kasih telah memesan di {nama_toko}.\n\n*TAGIHAN PESANAN {id_pesanan}*\n{daftar_item}\nTotal Tagihan: *Rp {total}*\n\nSilakan transfer ke rekening berikut:\n{rekening}\nBerita transfer: {id_pesanan}\n\nMohon kirim bukti transfer ke nomor ini maksimal {batas_bayar_jam} jam. Pesanan diproses setelah pembayaran terverifikasi.\n\nSalam,\nTim {nama_toko}',
  qris: 'Halo Kak *{nama}*, berikut tagihan pesanan *{id_pesanan}* di {nama_toko}.\n\n{daftar_item}\nTotal: *Rp {total}*\n\nBayar instan via QRIS (semua e-wallet & m-banking):\n{link_qris}\n\nSetelah bayar, balas pesan ini dengan tangkapan layar bukti pembayaran. Terima kasih!',
  pengingat: 'Halo Kak {nama}, pengingat ramah dari {nama_toko}.\nPesanan *{id_pesanan}* senilai *Rp {total}* masih menunggu pembayaran.\n\nRekening: {rekening}\n\nAbaikan pesan ini bila sudah membayar. Terima kasih!',
  lunas: 'Halo Kak *{nama}*, terima kasih!\n\n*PEMBAYARAN DITERIMA & LUNAS*\n- No. Pesanan: {id_pesanan}\n- Total: Rp {total}\n- Item: {produk}\n\nPesanan Anda sedang kami siapkan. Kami kabari lagi saat sudah selesai.\nSalam, Tim {nama_toko}',
  selesai: 'Halo Kak *{nama}*, pesanan *{id_pesanan}* telah *SELESAI*.\n\n- Item: {produk}\n- Kunci Lisensi: {kunci_lisensi}\n- Faktur Resmi (PDF): {link_invoice}\n\nSimpan pesan ini sebagai bukti kepemilikan. Butuh bantuan teknis? Balas pesan ini.\nSalam, Tim {nama_toko}'
};

const DEFAULT_HERO_SLIDES = [
  {
    id: 'slide-1',
    badge: 'SOLUSI DIGITAL ENTERPRISE • DISKON 25%',
    title: 'Infrastruktur Toko Digital & Otomasi WhatsApp Tanpa Biaya Server',
    subtitle: 'Bangun etalase e-commerce secepat kilat dengan database Google Sheets real-time, notifikasi Fonnte otomatis, CRM pelanggan terpadu, dan faktur resmi ber-QR.',
    ctaPrimary: 'Jelajahi Katalog',
    ctaTarget: '#products',
    ctaSecondary: 'Konsultasi Gratis',
    image: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80',
    accentProduct: 'PRD-001',
    metricLabel: 'Kecepatan Muat',
    metricValue: '< 0.8 Detik'
  },
  {
    id: 'slide-2',
    badge: 'OTOMASI WHATSAPP & CRM PINTAR',
    title: 'Broadcast Kampanye Terjadwal & Pengiriman Lisensi Instan 24/7',
    subtitle: 'Antrean notifikasi non-blocking mengirim tagihan, konfirmasi lunas, faktur PDF, hingga kode lisensi otomatis ke WhatsApp & Email pelanggan.',
    ctaPrimary: 'Lihat Paket Otomasi',
    ctaTarget: 'cat:automation',
    ctaSecondary: 'Tanya Tim Teknis',
    image: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80',
    accentProduct: 'PRD-005',
    metricLabel: 'Pengiriman Otomatis',
    metricValue: '99.8% Terkirim'
  },
  {
    id: 'slide-3',
    badge: 'WORKSTATION & HARDWARE RESMI',
    title: 'Perangkat Kerja Kreator, Kasir POS & Developer Performa Tinggi',
    subtitle: 'Mulai dari MacBook Pro M3 Pro, laptop gaming OLED, hingga printer struk thermal Bluetooth untuk operasional multi-cabang bisnis Anda.',
    ctaPrimary: 'Cek Perangkat Kerja',
    ctaTarget: 'cat:hardware',
    ctaSecondary: 'Klaim Harga Bundling',
    image: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=1200&q=80',
    accentProduct: 'PRD-004',
    metricLabel: 'Garansi Resmi',
    metricValue: '100% Original'
  },
  {
    id: 'slide-4',
    badge: 'LAYANAN SETUP TERIMA BERES',
    title: 'Tim Engineer Kami Siapkan Sistem Anda Sampai Siap Jualan',
    subtitle: 'Tidak ingin repot konfigurasi teknis? Pesan bundling jasa instalasi, integrasi domain GitHub Pages, migrasi database, dan sesi panduan 1-on-1.',
    ctaPrimary: 'Pilih Jasa Setup',
    ctaTarget: 'cat:jasa',
    ctaSecondary: 'Chat CS Sekarang',
    image: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1200&q=80',
    accentProduct: 'PRD-002',
    metricLabel: 'SLA Pengerjaan',
    metricValue: '1–2 Hari Kerja'
  }
];

const DEFAULT_SETTINGS = [
  ['nama_toko', 'NusaStore', 'Nama toko (header, pesan WA, faktur)'],
  ['tagline', 'Enterprise Digital', 'Teks kecil di bawah logo'],
  ['nama_perusahaan', 'PT Nusa Digital Teknologi', 'Nama badan usaha di faktur & footer'],
  ['nomor_wa_admin', '6281288009900', 'Nomor WA admin/CS tujuan checkout (format 628xxx)'],
  ['email_kontak', 'billing@nusastore.id', 'Email kontak toko'],
  ['alamat_toko', 'Menara Palma Lt. 12, Jl. H. R. Rasuna Said Kav. 6-9, Kuningan, Jakarta Selatan 12920', 'Alamat di faktur'],
  ['npwp', '01.345.678.9-012.000', 'NPWP di faktur (opsional)'],
  ['promo_topbar', 'Cloud Server Licensing & Web Solutions Flash Sale — Hemat hingga 45% Hari Ini!', 'Teks pengumuman bilah atas'],
  ['hero_diskon', '25', 'Angka badge diskon di hero (%)'],
  ['flash_diskon', '30', 'Angka diskon banner flash offer (%)'],
  ['rekening_bank', 'BCA 828-091-8899 a.n. PT Nusa Digital Teknologi', 'Rekening untuk tagihan transfer'],
  ['link_qris', '', 'Tautan gambar QRIS (Google Drive/URL publik)'],
  ['batas_bayar_jam', '24', 'Batas waktu pembayaran (jam)'],
  ['target_omzet_bulanan', '36500000', 'Target omzet bulanan untuk progress KPI'],
  ['notif_otomatis_lunas', 'Ya', 'Kirim WA otomatis saat status → Lunas (Ya/Tidak)'],
  ['notif_otomatis_selesai', 'Ya', 'Kirim WA otomatis saat status → Selesai (Ya/Tidak)'],
  ['wa_floating_sapaan', 'Halo Kak! Ada yang bisa tim NusaStore bantu hari ini? Pilih topik atau ketik langsung ya.', 'Sapaan widget WA mengambang'],
  ['hero_slides_json', JSON.stringify(DEFAULT_HERO_SLIDES), 'Daftar slide hero otomatis (JSON)'],
  ['template_pesan_web', TPL.web, 'Pesan checkout pelanggan → WA admin'],
  ['template_tagihan_transfer', TPL.transfer, 'Tagihan transfer bank (Fonnte)'],
  ['template_tagihan_qris', TPL.qris, 'Tagihan QRIS (Fonnte)'],
  ['template_pengingat', TPL.pengingat, 'Pengingat pembayaran (Fonnte)'],
  ['template_pesan_lunas', TPL.lunas, 'Konfirmasi lunas (Fonnte)'],
  ['template_pesan_selesai', TPL.selesai, 'Pesanan selesai + lisensi + faktur (Fonnte)']
];

const SETTING_KEYS = DEFAULT_SETTINGS.map(function (r) { return r[0]; });
const SETTING_PUBLIK = [
  'nama_toko', 'tagline', 'nama_perusahaan', 'nomor_wa_admin', 'email_kontak',
  'promo_topbar', 'hero_diskon', 'flash_diskon', 'wa_floating_sapaan', 'hero_slides_json', 'template_pesan_web'
];
const TEMPLATE_KEYS = [
  'template_tagihan_transfer', 'template_tagihan_qris', 'template_pengingat',
  'template_pesan_lunas', 'template_pesan_selesai'
];

/** Allowlist rahasia Kelas A yang boleh diubah dari dashboard Admin (R5). */
const RAHASIA_DASHBOARD = {
  FONNTE_TOKEN: { min: 8, maks: 200 }
};

// ============================================================================
//  1. SATU PINTU SCRIPT PROPERTIES, KRIPTOGRAFI & REDAKSI (gas-rahasia-script-properties)
// ============================================================================
const PROPS = PropertiesService.getScriptProperties();
let _PROP_MEMO = null;

function prop_(key, def) {
  if (!_PROP_MEMO) _PROP_MEMO = PROPS.getProperties();
  const v = _PROP_MEMO[key];
  return (v === undefined || v === null || v === '') ? (def === undefined ? '' : def) : v;
}
function setProp_(key, val) {
  PROPS.setProperty(key, String(val));
  if (_PROP_MEMO) _PROP_MEMO[key] = String(val);
}
function setProps_(obj) {
  const clean = {};
  Object.keys(obj).forEach(function (k) { clean[k] = String(obj[k]); });
  PROPS.setProperties(clean);
  if (_PROP_MEMO) Object.keys(clean).forEach(function (k) { _PROP_MEMO[k] = clean[k]; });
}
function delProp_(key) {
  PROPS.deleteProperty(key);
  if (_PROP_MEMO) delete _PROP_MEMO[key];
}

function acak_(n, huruf) {
  huruf = huruf || 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  while (s.length < n) {
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid())
      .forEach(function (b) { if (s.length < n) s += huruf[(b & 0xff) % huruf.length]; });
  }
  return s;
}

function hashPass_(pass, salt) {
  let h = String(pass);
  for (let i = 0; i < 300; i++) {
    h = Utilities.base64Encode(Utilities.computeHmacSha256Signature(h + salt, salt));
  }
  return h;
}

function samaAman_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function samarkan_(v) {
  v = String(v || '');
  if (!v) return '';
  if (v.length <= 8) return '••••••';
  return v.slice(0, 4) + '••••••' + v.slice(-3);
}

/** Sensor otomatis semua nilai rahasia dari pesan log/error sebelum dikirim ke klien (R7). */
function redaksi_(teks) {
  let s = String(teks || '');
  ['FONNTE_TOKEN', 'SESSION_SECRET', 'ADMIN_PIN_HASH', 'DARURAT_HASH'].forEach(function (k) {
    const v = prop_(k);
    if (v && v.length >= 6) s = s.split(v).join('[DISEMBUNYIKAN]');
  });
  return s;
}

function secret_() {
  let s = prop_('SESSION_SECRET');
  if (!s) {
    s = acak_(64);
    setProp_('SESSION_SECRET', s);
  }
  return s;
}

function hmac_(s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s, secret_())).replace(/=+$/, '');
}

function signToken_(p) {
  const body = Utilities.base64EncodeWebSafe(JSON.stringify(p)).replace(/=+$/, '');
  return body + '.' + hmac_(body);
}

function buatSesi_(mode) {
  const now = Date.now();
  return signToken_({ r: 'admin', m: mode || 'pin', i: now, x: now + APP.SESSION_HOURS * 3600e3, n: acak_(8) });
}

function verifyToken_(t) {
  try {
    const parts = String(t || '').split('.');
    if (parts.length !== 2 || !samaAman_(hmac_(parts[0]), parts[1])) return null;
    let b = parts[0];
    while (b.length % 4) b += '=';
    const p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(b)).getDataAsString());
    if (!p.x || p.x < Date.now()) return null;
    const rev = Number(CacheService.getScriptCache().get('rev_admin') || prop_('REV_ADMIN') || 0);
    if (p.i < rev) return null;
    return { role: p.r, mode: p.m || 'pin', iat: p.i, exp: p.x };
  } catch (e) {
    return null;
  }
}

function revokeAll_() {
  const t = String(Date.now());
  setProp_('REV_ADMIN', t);
  CacheService.getScriptCache().put('rev_admin', t, 21600);
}

function guard_(token, fn) {
  try {
    const s = verifyToken_(token);
    if (!s) return fail_('Sesi admin berakhir atau tidak valid. Silakan masuk kembali.', { code: 'AUTH' });
    return fn(s);
  } catch (e) {
    const msg = redaksi_(e && e.message ? e.message : String(e));
    console.error(redaksi_(e && e.stack ? e.stack : msg));
    return fail_(msg);
  }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Server sedang memproses penyimpanan lain. Silakan coba beberapa detik lagi.');
  try { return fn(); } finally { lock.releaseLock(); }
}

// ============================================================================
//  2. ENTRY POINTS REST API MURNI: doGet & doPost (gas-pro-api + gas-scale-turbo)
// ============================================================================
function versionsMap_() {
  return {
    catalog: ver_('CATALOG'),
    orders: ver_('ORDERS'),
    crm: ver_('CRM')
  };
}

function jsonOut_(obj, t0) {
  const out = obj || { success: false, data: null, message: 'Respons kosong.' };
  out.ms = Date.now() - (t0 || Date.now());
  out.v = versionsMap_();
  out.nq = prop_('ANTRIAN_ADA') === '1';
  return ContentService
    .createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function ok_(data, message) {
  return { success: true, data: data === undefined ? null : data, message: message || 'OK' };
}

function fail_(message, extra) {
  const r = { success: false, data: null, message: redaksi_(message || 'Terjadi kesalahan.') };
  if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
  return r;
}

/**
 * Endpoint GET publik untuk pembacaan cepat katalog & pengecekan status.
 */
function doGet(e) {
  const t0 = Date.now();
  try {
    const p = (e && e.parameter) ? e.parameter : {};
    const action = String(p.action || 'getPublicData');

    if (action === 'ping') {
      return jsonOut_(ok_({ name: APP.NAME, version: APP.VERSION, time: new Date().toISOString() }, 'Pong'), t0);
    }
    if (action === 'getPublicData') {
      return jsonOut_(ok_(getPublicData_(), 'Katalog berhasil dimuat.'), t0);
    }
    if (action === 'verifyInvoice') {
      return jsonOut_(verifyInvoicePublic_(String(p.orderId || ''), String(p.sig || '')), t0);
    }
    return jsonOut_(fail_('Action GET tidak dikenal: ' + action), t0);
  } catch (err) {
    return jsonOut_(fail_(err.message), t0);
  }
}

/**
 * Endpoint POST utama (text/plain;charset=utf-8 → bebas preflight CORS).
 * Mendukung eksekusi tunggal dan action='batch' (gas-scale-turbo).
 */
function doPost(e) {
  const t0 = Date.now();
  try {
    const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const body = JSON.parse(raw);
    const action = String(body.action || '');

    if (action === 'batch') {
      const calls = Array.isArray(body.calls) ? body.calls.slice(0, 10) : [];
      const token = body.token || '';
      const results = calls.map(function (c) {
        const subBody = Object.assign({}, c.params || {}, { action: c.action, token: c.token || token });
        return dispatchPostAction_(String(c.action || ''), subBody);
      });
      return jsonOut_(ok_(results, 'Batch selesai.'), t0);
    }

    const res = dispatchPostAction_(action, body);
    return jsonOut_(res, t0);
  } catch (err) {
    return jsonOut_(fail_('Gagal memproses permintaan: ' + err.message), t0);
  }
}

function dispatchPostAction_(action, b) {
  const token = String(b.token || '');
  switch (action) {
    // --- Publik ---
    case 'ping': return ok_({ name: APP.NAME, version: APP.VERSION, time: new Date().toISOString() });
    case 'getPublicData': return ok_(getPublicData_());
    case 'submitPublicOrder': return submitPublicOrder(b.payload || b);
    case 'subscribeNewsletter': return subscribeNewsletter(b.email);
    case 'submitPublicTestimonial': return submitPublicTestimonial(b.payload || b);

    // --- Autentikasi Admin ---
    case 'adminLogin': return adminLogin(b.pin, !!b.withData);
    case 'adminEmergencyLogin': return adminEmergencyLogin(b.username, b.password, !!b.withData);
    case 'adminChangePin': return adminChangePin(token, b.oldPin, b.newPin);
    case 'adminLogoutAll': return adminLogoutAll(token);

    // --- Bootstrap & Sync ---
    case 'adminBootstrap': return adminBootstrap(token);
    case 'adminSync': return adminSync(token, b.vOrders, b.vCatalog, b.vCrm);
    case 'adminClearCache': return adminClearCache(token);

    // --- Katalog, Kategori & Testimoni ---
    case 'adminSaveProduct': return adminSaveProduct(token, b.product || b.payload);
    case 'adminDeleteProduct': return adminDeleteProduct(token, b.id);
    case 'adminSaveCategory': return adminSaveCategory(token, b.category || b.payload);
    case 'adminDeleteCategory': return adminDeleteCategory(token, b.id);
    case 'adminSaveTestimonial': return adminSaveTestimonial(token, b.testimonial || b.payload);
    case 'adminDeleteTestimonial': return adminDeleteTestimonial(token, b.id);

    // --- Pesanan, Lisensi & Berkas ---
    case 'adminCreateOrder': return adminCreateOrder(token, b.order, b.opts);
    case 'adminUpdateOrder': return adminUpdateOrder(token, b.id, b.patch, b.opts);
    case 'adminDeleteOrder': return adminDeleteOrder(token, b.id);
    case 'adminSendWa': return adminSendWa(token, b.orderId, b.templateKey, b.customText, b.linkInvoice);
    case 'adminAddLicenses': return adminAddLicenses(token, b.productId, b.codes);
    case 'adminDeleteLicense': return adminDeleteLicense(token, b.code);
    case 'adminUploadFile': return adminUploadFile(token, b.kind, b.base64, b.mime, b.filename, b.refId);
    case 'adminSaveExport': return adminSaveExport(token, b.filename, b.csv);
    case 'adminExportXlsx': return adminExportXlsx(token, b.filename, b.header, b.rows);
    case 'adminInvoicePdf': return adminInvoicePdf(token, b.orderId, b.html);

    // --- Pengaturan & Rahasia ---
    case 'adminSaveSettings': return adminSaveSettings(token, b.settings || b.payload);
    case 'adminSaveSecret': return adminSaveSecret(token, b.key, b.value);
    case 'adminFonnteStatus': return adminFonnteStatus(token, !!b.force);
    case 'adminTestFonnte': return adminTestFonnte(token, b.nomor);

    // --- Modul CRM & Notifikasi WA/Email (NotifikasiCRM.gs) ---
    case 'adminNotifCrmBootstrap': return adminNotifCrmBootstrap(token);
    case 'adminSaveNotifConfig': return adminSaveNotifConfig(token, b.config || b.payload);
    case 'adminDrainNotifQueue': return adminDrainNotifQueue(token, b.maxItems);
    case 'adminClearDoneQueue': return adminClearDoneQueue(token);
    case 'adminCreateBlast': return adminCreateBlast(token, b.blast || b.payload);
    case 'adminControlBlast': return adminControlBlast(token, b.blastId, b.command);
    case 'adminValidateWaNumbers': return adminValidateWaNumbers(token, b.kontakIds);
    case 'adminCrmSync': return adminCrmSync(token);
    case 'adminCrmSaveContact': return adminCrmSaveContact(token, b.contact || b.payload);
    case 'adminCrmDeleteContact': return adminCrmDeleteContact(token, b.kontakId);
    case 'adminCrmToggleOptOut': return adminCrmToggleOptOut(token, b.kontakId, b.optOut);
    case 'adminCrmMergeDuplicates': return adminCrmMergeDuplicates(token);
    case 'adminCrmAddInteraction': return adminCrmAddInteraction(token, b.interaction || b.payload);
    case 'adminCrmGetInteractions': return adminCrmGetInteractions(token, b.kontakId);

    // --- Modul Migrasi Database (Migrasi.gs) ---
    case 'adminMigrateScan': return adminMigrateScan(token, b.sourceIdOrUrl);
    case 'adminMigrateExecute': return adminMigrateExecute(token, b.sourceIdOrUrl, b.sheets);

    default:
      return fail_('Action tidak dikenal: ' + action);
  }
}

// ============================================================================
//  3. AKSES SPREADSHEET, DRIVE & CACHEX BERPOTONGAN (gas-scale-turbo)
// ============================================================================
let _SS = null;
function ss_() {
  if (_SS) return _SS;
  const id = prop_('SPREADSHEET_ID');
  if (!id) throw new Error('Database belum disiapkan. Jalankan fungsi setupAppEnvironment() satu kali di editor Google Apps Script.');
  _SS = SpreadsheetApp.openById(id);
  return _SS;
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) {
    if (HEADERS[name]) return ensureSheet_(ss_(), name, []);
    throw new Error('Sheet "' + name + '" tidak ditemukan. Jalankan setupAppEnvironment().');
  }
  return sh;
}

function folder_(propKey) {
  const id = prop_(propKey);
  if (!id) throw new Error('Folder Drive (' + propKey + ') belum disiapkan. Jalankan setupAppEnvironment().');
  return DriveApp.getFolderById(id);
}

function plain_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  return v === null || v === undefined ? '' : v;
}
function str_(v, max) { return String(v === null || v === undefined ? '' : v).trim().slice(0, max || 500); }
function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = Number(String(v || '').replace(/[^\d.-]/g, ''));
  return isFinite(n) ? n : 0;
}
function now_() { return new Date(); }
function fmtDate_(d, pattern) { return Utilities.formatDate(d || new Date(), APP.TZ, pattern || 'yyyy-MM-dd HH:mm'); }
function rupiah_(n) {
  const s = String(Math.round(num_(n)));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Normalisasi nomor WA ke format 628xxxxxxxxx. */
function normalizePhone_(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.indexOf('00') === 0) d = d.slice(2);
  if (d.indexOf('0') === 0) d = '62' + d.slice(1);
  else if (d.indexOf('8') === 0) d = '62' + d;
  return d;
}
function validPhone_(d) { return /^628\d{7,12}$/.test(String(d || '')); }

function effPrice_(p) {
  const h = num_(p.harga), c = num_(p.harga_coret);
  return (c > 0 && c < h) ? c : h;
}

function driveImg_(url) {
  url = str_(url, 700);
  if (!url) return '';
  const m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=|thumbnail\?id=)([\w-]{20,})/);
  return m ? 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1200' : url;
}

/** Uraikan gambar utama + galeri menjadi array URL bersih untuk auto-slideshow produk. */
function parseGalleryImages_(utama, galeriRaw) {
  const list = [];
  const add = function (u) {
    const clean = driveImg_(u);
    if (clean && /^https?:\/\//i.test(clean) && list.indexOf(clean) < 0) list.push(clean);
  };
  add(utama);
  String(galeriRaw || '').split(/[\r\n|,;]+/).forEach(add);
  return list;
}

function readTable_(name) {
  const sh = sheet_(name);
  const lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lc === 0) return { sheet: sh, headers: (HEADERS[name] || []).slice(), rows: [] };
  const values = sh.getRange(1, 1, Math.max(lr, 1), lc).getValues();
  return {
    sheet: sh,
    headers: values[0].map(function (h) { return String(h).trim(); }),
    rows: values.slice(1)
  };
}

function toObjects_(t) {
  return t.rows.filter(function (r) { return String(r[0] === undefined ? '' : r[0]).trim() !== ''; }).map(function (r, idx) {
    const o = { _row: idx + 2 };
    t.headers.forEach(function (h, i) { if (h) o[h] = plain_(r[i]); });
    return o;
  });
}

function rowFromObject_(headers, obj, base) {
  return headers.map(function (h, i) {
    if (obj[h] !== undefined) return obj[h];
    return base ? base[i] : '';
  });
}

function findRow_(sh, id) {
  const lr = sh.getLastRow();
  if (lr < 2) return -1;
  const ids = sh.getRange(2, 1, lr - 1, 1).getValues();
  const target = String(id).trim();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === target) return i + 2;
  }
  return -1;
}

function headersOf_(sh) {
  const lc = sh.getLastColumn();
  if (lc === 0) return [];
  return sh.getRange(1, 1, 1, lc).getValues()[0].map(function (h) { return String(h).trim(); });
}

function appendObject_(sh, obj) {
  const headers = headersOf_(sh);
  const r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, headers.length).setValues([rowFromObject_(headers, obj)]);
  return r;
}

/**
 * Penulis blok kontigu hemat kuota (gas-scale-turbo).
 */
function updateWhere_(name, pred, mut) {
  const t = readTable_(name);
  if (!t.rows.length) return 0;
  const idx = {};
  t.headers.forEach(function (h, i) { idx[h] = i; });
  let lo = -1, hi = -1, n = 0;
  for (let i = 0; i < t.rows.length; i++) {
    const o = {};
    t.headers.forEach(function (h, c) { o[h] = t.rows[i][c]; });
    if (!pred(o, i)) continue;
    const patch = mut(o, i) || o;
    Object.keys(patch).forEach(function (k) {
      if (idx[k] !== undefined) t.rows[i][idx[k]] = patch[k];
    });
    if (lo < 0) lo = i;
    hi = i;
    n++;
  }
  if (n > 0) {
    t.sheet.getRange(lo + 2, 1, hi - lo + 1, t.headers.length).setValues(t.rows.slice(lo, hi + 1));
  }
  return n;
}

/** CacheX berpotongan 45 KB untuk melewati batas 100 KB per entri CacheService. */
const CHUNK_SIZE = 45000;
function cacheGetJson_(key) {
  try {
    const c = CacheService.getScriptCache();
    const head = c.get(key);
    if (!head) return null;
    if (head.indexOf('__CHUNK__:') !== 0) return JSON.parse(head);
    const n = Number(head.split(':')[1] || 0);
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(key + '__' + i);
    const parts = c.getAll(keys);
    let raw = '';
    for (let j = 0; j < n; j++) {
      if (parts[keys[j]] == null) return null;
      raw += parts[keys[j]];
    }
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function cachePutJson_(key, val, ttl) {
  try {
    const c = CacheService.getScriptCache();
    const s = JSON.stringify(val);
    const exp = ttl || APP.CACHE_TTL;
    if (s.length <= CHUNK_SIZE) {
      c.put(key, s, exp);
      return;
    }
    const n = Math.ceil(s.length / CHUNK_SIZE);
    const bag = {};
    bag[key] = '__CHUNK__:' + n;
    for (let i = 0; i < n; i++) {
      bag[key + '__' + i] = s.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    }
    c.putAll(bag, exp);
  } catch (e) {
    console.warn('CacheX skip: ' + e.message);
  }
}

function ver_(scope) { return prop_('VER_' + scope, '1'); }
function bumpVer_(scope) {
  const v = String(Date.now());
  setProp_('VER_' + scope, v);
  return v;
}

// ============================================================================
//  4. PEMBACA DATA BER-CACHE (KATALOG, HERO, PRODUK MULTI-GAMBAR, TESTIMONI)
// ============================================================================
function readSettings_() {
  const map = {};
  DEFAULT_SETTINGS.forEach(function (r) { map[r[0]] = r[1]; });
  toObjects_(readTable_(SH.PENGATURAN)).forEach(function (o) {
    if (o.key) map[String(o.key)] = String(o.value);
  });
  return map;
}

function readHeroSlides_(settings) {
  settings = settings || readSettings_();
  try {
    const parsed = JSON.parse(settings.hero_slides_json || '[]');
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch (e) { /* gunakan default */ }
  return DEFAULT_HERO_SLIDES;
}

function readCategories_() {
  return toObjects_(readTable_(SH.KATEGORI)).map(function (c) {
    return {
      id_kategori: String(c.id_kategori),
      nama_kategori: String(c.nama_kategori),
      icon_url: String(c.icon_url || ''),
      subjudul: String(c.subjudul || ''),
      urutan: num_(c.urutan)
    };
  }).sort(function (a, b) { return a.urutan - b.urutan; });
}

function readProducts_(cats) {
  cats = cats || readCategories_();
  const byName = {};
  cats.forEach(function (c) {
    byName[c.nama_kategori.toLowerCase()] = c.id_kategori;
    byName[c.id_kategori.toLowerCase()] = c.id_kategori;
  });
  return toObjects_(readTable_(SH.PRODUK)).map(function (p) {
    const kat = String(p.kategori || '');
    const mainImg = driveImg_(p.gambar_url);
    const images = parseGalleryImages_(mainImg, p.galeri_url);
    return {
      id_produk: String(p.id_produk),
      nama_produk: String(p.nama_produk),
      kategori: byName[kat.toLowerCase()] || kat,
      deskripsi: String(p.deskripsi || ''),
      harga: num_(p.harga),
      harga_coret: num_(p.harga_coret),
      gambar_url: images[0] || mainImg,
      galeri_url: String(p.galeri_url || ''),
      images: images,
      badge_promo: String(p.badge_promo || ''),
      status_aktif: String(p.status_aktif || 'Aktif') === 'Nonaktif' ? 'Nonaktif' : 'Aktif',
      spesifikasi: String(p.spesifikasi || ''),
      rating: num_(p.rating) || 4.9,
      jumlah_ulasan: num_(p.jumlah_ulasan),
      urutan: num_(p.urutan),
      diperbarui: p.diperbarui ? String(p.diperbarui) : ''
    };
  }).sort(function (a, b) { return a.urutan - b.urutan; });
}

function readTestimonials_(onlyPublic) {
  const list = toObjects_(readTable_(SH.TESTIMONI)).map(function (t) {
    return {
      id_testimoni: String(t.id_testimoni),
      nama: String(t.nama || ''),
      jabatan_perusahaan: String(t.jabatan_perusahaan || ''),
      avatar_url: driveImg_(t.avatar_url || ''),
      produk_terkait: String(t.produk_terkait || ''),
      rating: Math.max(1, Math.min(5, num_(t.rating) || 5)),
      kutipan_singkat: String(t.kutipan_singkat || ''),
      cerita_lengkap: String(t.cerita_lengkap || ''),
      hasil_highlight: String(t.hasil_highlight || ''),
      tanggal: String(t.tanggal || ''),
      terverifikasi: String(t.terverifikasi || 'Ya') === 'Tidak' ? 'Tidak' : 'Ya',
      tampil: String(t.tampil || 'Ya') === 'Tidak' ? 'Tidak' : 'Ya'
    };
  });
  return onlyPublic ? list.filter(function (t) { return t.tampil === 'Ya'; }) : list;
}

function getPublicData_() {
  const v = ver_('CATALOG');
  const key = 'pub_v3_' + v;
  const hit = cacheGetJson_(key);
  if (hit) return hit;

  const settings = readSettings_();
  const cats = readCategories_();
  const pubSettings = {};
  SETTING_PUBLIK.forEach(function (k) { pubSettings[k] = settings[k] || ''; });

  const products = readProducts_(cats)
    .filter(function (p) { return p.status_aktif === 'Aktif'; })
    .map(function (p) {
      return {
        id_produk: p.id_produk,
        nama_produk: p.nama_produk,
        kategori: p.kategori,
        deskripsi: p.deskripsi,
        harga: p.harga,
        harga_coret: p.harga_coret,
        gambar_url: p.gambar_url,
        galeri_url: p.galeri_url,
        images: p.images,
        badge_promo: p.badge_promo,
        spesifikasi: p.spesifikasi,
        rating: p.rating,
        jumlah_ulasan: p.jumlah_ulasan,
        urutan: p.urutan,
        diperbarui: p.diperbarui
      };
    });

  const data = {
    v: v,
    settings: pubSettings,
    heroSlides: readHeroSlides_(settings),
    categories: cats,
    products: products,
    testimonials: readTestimonials_(true),
    generatedAt: new Date().toISOString()
  };
  cachePutJson_(key, data);
  return data;
}

function readOrders_() {
  const v = ver_('ORDERS');
  const key = 'ord_v3_' + v;
  const hit = cacheGetJson_(key);
  if (hit) return hit;

  const t = readTable_(SH.PESANAN);
  const out = [];
  t.rows.forEach(function (r, i) {
    if (String(r[0] || '').trim() === '') return;
    const o = { _row: i + 2 };
    t.headers.forEach(function (h, j) { if (h) o[h] = plain_(r[j]); });
    o.total_harga = num_(o.total_harga);
    o.qty = num_(o.qty) || 1;
    o.no_whatsapp = String(o.no_whatsapp || '');
    out.push(o);
  });
  cachePutJson_(key, out);
  return out;
}

function readLicenses_() { return toObjects_(readTable_(SH.LISENSI)); }
function readWaLog_(limit) {
  const t = readTable_(SH.LOG_WA);
  return toObjects_({ headers: t.headers, rows: t.rows.slice(-(limit || 150)) }).reverse();
}

// ============================================================================
//  5. ENDPOINT PUBLIK (CHECKOUT, NEWSLETTER, TESTIMONI, VERIFIKASI FAKTUR)
// ============================================================================
function rateLimit_(key, max, windowSec) {
  const c = CacheService.getScriptCache();
  const k = 'rl_' + key;
  const n = Number(c.get(k) || 0);
  if (n >= max) return false;
  c.put(k, String(n + 1), windowSec);
  return true;
}

function genOrderId_(date) {
  const huruf = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'ORD-' + Utilities.formatDate(date || new Date(), APP.TZ, 'yyyyMMdd') + '-' + acak_(4, huruf);
}

function buildItems_(items, products, allowOverride) {
  const byId = {};
  products.forEach(function (p) { byId[p.id_produk] = p; });
  const out = [];
  let total = 0, qty = 0;
  items.forEach(function (it) {
    const p = byId[str_(it.id, 30)];
    if (!p) throw new Error('Produk ' + str_(it.id, 30) + ' tidak ditemukan.');
    if (!allowOverride && p.status_aktif !== 'Aktif') throw new Error('Produk "' + p.nama_produk + '" sedang tidak tersedia.');
    const q = Math.max(1, Math.min(99, Math.round(num_(it.qty) || 1)));
    const harga = (allowOverride && it.harga !== undefined && it.harga !== '') ? Math.max(0, Math.round(num_(it.harga))) : effPrice_(p);
    out.push({ id: p.id_produk, nama: p.nama_produk, qty: q, harga: harga, subtotal: harga * q });
    total += harga * q;
    qty += q;
  });
  return {
    items: out,
    total: total,
    qty: qty,
    ids: out.map(function (i) { return i.id; }).join(', '),
    names: out.map(function (i) { return i.nama + (i.qty > 1 ? ' (x' + i.qty + ')' : ''); }).join('; ')
  };
}

function submitPublicOrder(payload) {
  try {
    payload = payload || {};
    if (str_(payload.website)) return ok_({ id: '-', ignored: true }, 'OK'); // Honeypot anti-bot
    const nama = str_(payload.nama, 80);
    const wa = normalizePhone_(payload.wa);
    const email = str_(payload.email, 120).toLowerCase();
    const catatan = str_(payload.catatan, 500);
    if (nama.length < 2) return fail_('Nama pemesan wajib diisi (minimal 2 huruf).');
    if (!validPhone_(wa)) return fail_('Nomor WhatsApp tidak valid. Contoh: 0812-3456-7890.');
    const items = Array.isArray(payload.items) ? payload.items.slice(0, 20) : [];
    if (!items.length) return fail_('Keranjang pesanan masih kosong.');

    let id = str_(payload.id, 20).toUpperCase();
    if (!ORDER_ID_RE.test(id)) id = genOrderId_();

    const cache = CacheService.getScriptCache();
    const done = cache.get('ordok_' + id);
    if (done) return ok_(JSON.parse(done), 'Pesanan sudah tercatat sebelumnya.');
    if (!rateLimit_('wa_' + wa, 8, 600)) return fail_('Terlalu banyak permintaan dari nomor ini. Silakan tunggu beberapa menit.');

    const built = buildItems_(items, readProducts_(), false);
    const catatanFull = email ? (catatan ? catatan + ' | Email: ' + email : 'Email: ' + email) : catatan;

    // 1. Tulis ke Pesanan di dalam Lock singkat
    const res = withLock_(function () {
      const sh = sheet_(SH.PESANAN);
      const existing = findRow_(sh, id);
      if (existing > 0) return { id: id, row: existing, total: built.total, duplicate: true };
      const ts = now_();
      const rec = {
        id_pesanan: id,
        tanggal_order: ts,
        nama_pelanggan: nama,
        no_whatsapp: wa,
        id_produk: built.ids,
        nama_produk: built.names,
        total_harga: built.total,
        status_pesanan: 'Pending',
        sumber_pesanan: 'Katalog Web',
        catatan: catatanFull,
        link_bukti_transfer: '',
        qty: built.qty,
        item_json: JSON.stringify(built.items),
        metode_bayar: '',
        kunci_lisensi: '',
        diperbarui: ts,
        riwayat_status: fmtDate_(ts) + ' Dibuat (Katalog Web)'
      };
      const row = appendObject_(sh, rec);
      bumpVer_('ORDERS');
      return { id: id, row: row, total: built.total, createdAt: ts.toISOString(), record: rec };
    });

    // 2. Di LUAR Lock (gas-scale-turbo #5): Sinkron CRM & antrekan notifikasi otomatis non-blocking
    if (!res.duplicate && res.record) {
      try {
        crmUpsertFromOrder_(res.record, email);
        enqueueOrderEvent_('PESANAN_BARU', res.record, email, '');
      } catch (bgErr) {
        console.warn('CRM/Notif async skip: ' + redaksi_(bgErr.message));
      }
    }

    const cleanRes = { id: res.id, row: res.row, total: res.total, createdAt: res.createdAt, items: built.items };
    cache.put('ordok_' + id, JSON.stringify(cleanRes), 21600);
    return ok_(cleanRes, 'Pesanan berhasil tercatat di Google Sheets.');
  } catch (e) {
    return fail_(e.message);
  }
}

function subscribeNewsletter(email) {
  try {
    email = str_(email, 120).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail_('Format alamat email tidak valid.');
    if (!rateLimit_('nl_' + email, 3, 3600)) return ok_(null, 'Email sudah terdaftar.');
    const added = withLock_(function () {
      const sh = sheet_(SH.NEWSLETTER);
      if (findRow_(sh, email) > 0) return false;
      appendObject_(sh, { email: email, tanggal: now_(), sumber: 'Footer Etalase' });
      return true;
    });
    if (added) {
      try { crmUpsertFromNewsletter_(email); } catch (e) { /* abaikan */ }
    }
    return ok_(null, added ? 'Berhasil berlangganan newsletter NusaStore!' : 'Email Anda sudah terdaftar. Terima kasih!');
  } catch (e) {
    return fail_(e.message);
  }
}

function submitPublicTestimonial(payload) {
  try {
    payload = payload || {};
    if (str_(payload.website)) return ok_(null, 'OK');
    const nama = str_(payload.nama, 80);
    const jabatan = str_(payload.jabatan_perusahaan, 80);
    const produk = str_(payload.produk_terkait, 100);
    const kutipan = str_(payload.kutipan_singkat, 260);
    const cerita = str_(payload.cerita_lengkap, 1500);
    const highlight = str_(payload.hasil_highlight, 120);
    const rating = Math.max(1, Math.min(5, Math.round(num_(payload.rating) || 5)));

    if (nama.length < 2 || kutipan.length < 10) {
      return fail_('Nama dan ulasan singkat (minimal 10 karakter) wajib diisi.');
    }
    if (!rateLimit_('testi_' + nama.toLowerCase(), 3, 3600)) {
      return fail_('Ulasan Anda baru saja dikirim. Terima kasih!');
    }
    withLock_(function () {
      const sh = sheet_(SH.TESTIMONI);
      appendObject_(sh, {
        id_testimoni: 'TST-' + acak_(6, '0123456789ABCDEF'),
        nama: nama,
        jabatan_perusahaan: jabatan || 'Pelanggan NusaStore',
        avatar_url: '',
        produk_terkait: produk || 'Layanan NusaStore',
        rating: rating,
        kutipan_singkat: kutipan,
        cerita_lengkap: cerita || kutipan,
        hasil_highlight: highlight || 'Kepuasan Terverifikasi',
        tanggal: fmtDate_(now_(), 'dd MMM yyyy'),
        terverifikasi: 'Tidak',
        tampil: 'Tidak' // Moderasi admin terlebih dahulu
      });
      bumpVer_('CATALOG');
    });
    return ok_(null, 'Terima kasih! Testimoni Anda berhasil dikirim dan menunggu verifikasi Admin.');
  } catch (e) {
    return fail_(e.message);
  }
}

function signInvoiceHash_(orderId, total) {
  return hmac_('INV|' + orderId + '|' + Math.round(num_(total))).slice(0, 16);
}

function verifyInvoicePublic_(orderId, sig) {
  if (!ORDER_ID_RE.test(orderId)) return fail_('Format nomor pesanan tidak valid.');
  const order = readOrders_().filter(function (o) { return o.id_pesanan === orderId; })[0];
  if (!order) return fail_('Faktur tidak ditemukan dalam database.');
  const valid = sig ? samaAman_(signInvoiceHash_(order.id_pesanan, order.total_harga), sig) : true;
  if (!valid) return fail_('Tanda tangan digital faktur tidak cocok.');
  return ok_({
    id_pesanan: order.id_pesanan,
    tanggal_order: order.tanggal_order,
    nama_pelanggan: order.nama_pelanggan,
    nama_produk: order.nama_produk,
    total_harga: order.total_harga,
    status_pesanan: order.status_pesanan,
    terverifikasi: true
  }, 'Faktur resmi terverifikasi asli.');
}

// ============================================================================
//  6. AUTENTIKASI ADMIN: PIN 6 DIGIT & LOGIN DARURAT (gas-rahasia-script-properties)
// ============================================================================
function ensureSecretsAndPin_() {
  secret_();
  let generatedPin = null;
  let generatedDarurat = null;

  // Migrasi otomatis bila user mengetik ADMIN_PIN polos di Script Properties
  const plainPin = prop_('ADMIN_PIN');
  if (plainPin) {
    if (/^\d{6}$/.test(plainPin)) {
      const salt = Utilities.getUuid();
      setProps_({ ADMIN_PIN_SALT: salt, ADMIN_PIN_HASH: hashPass_(plainPin, salt) });
      delProp_('ADMIN_PIN');
    }
  }

  if (!prop_('ADMIN_PIN_HASH')) {
    generatedPin = acak_(6, '0123456789');
    const salt = Utilities.getUuid();
    setProps_({ ADMIN_PIN_SALT: salt, ADMIN_PIN_HASH: hashPass_(generatedPin, salt) });
  }

  if (!prop_('DARURAT_HASH')) {
    generatedDarurat = acak_(16);
    const dSalt = Utilities.getUuid();
    setProps_({
      DARURAT_USER: 'darurat',
      DARURAT_SALT: dSalt,
      DARURAT_HASH: hashPass_(generatedDarurat, dSalt)
    });
  }

  return { pin: generatedPin, daruratPass: generatedDarurat };
}

function isWeakPin_(pin) {
  if (!/^\d{6}$/.test(pin)) return true;
  if (/^(\d)\1{5}$/.test(pin)) return true;
  if ('01234567890'.indexOf(pin) >= 0) return true;
  if ('09876543210'.indexOf(pin) >= 0) return true;
  return false;
}

function adminLogin(pin, withData) {
  try {
    ensureSecretsAndPin_();
    const lockUntil = Number(prop_('ADMIN_LOCK_UNTIL') || 0);
    if (lockUntil > Date.now()) {
      return fail_('Terlalu banyak percobaan gagal. Portal dikunci ' + Math.ceil((lockUntil - Date.now()) / 60000) + ' menit lagi.', { code: 'LOCKED' });
    }
    pin = String(pin || '').trim();
    const valid = /^\d{6}$/.test(pin) && samaAman_(hashPass_(pin, prop_('ADMIN_PIN_SALT')), prop_('ADMIN_PIN_HASH'));
    const c = CacheService.getScriptCache();
    if (!valid) {
      const n = Number(c.get('pin_gagal') || 0) + 1;
      c.put('pin_gagal', String(n), 900);
      if (n >= 5) {
        setProp_('ADMIN_LOCK_UNTIL', String(Date.now() + 15 * 60000));
        c.remove('pin_gagal');
      }
      Utilities.sleep(450);
      return fail_('PIN tidak sesuai.' + (n >= 3 && n < 5 ? ' Sisa percobaan: ' + (5 - n) + '.' : n >= 5 ? ' Portal dikunci 15 menit.' : ''), { code: n >= 5 ? 'LOCKED' : 'PIN' });
    }
    c.remove('pin_gagal');
    const token = buatSesi_('pin');
    const exp = Date.now() + APP.SESSION_HOURS * 3600e3;
    const out = { token: token, exp: exp, mode: 'pin' };
    if (withData) {
      try { out.boot = bootstrapData_({ exp: exp, mode: 'pin' }); } catch (err) { out.bootError = redaksi_(err.message); }
    }
    return ok_(out, 'Selamat datang di Admin Portal NusaStore.');
  } catch (e) {
    return fail_(e.message);
  }
}

function adminEmergencyLogin(username, password, withData) {
  try {
    ensureSecretsAndPin_();
    const lockUntil = Number(prop_('ADMIN_LOCK_UNTIL') || 0);
    if (lockUntil > Date.now()) {
      return fail_('Portal sedang dikunci sementara. Tunggu ' + Math.ceil((lockUntil - Date.now()) / 60000) + ' menit.', { code: 'LOCKED' });
    }
    const uOk = samaAman_(String(username || '').trim().toLowerCase(), String(prop_('DARURAT_USER', 'darurat')).toLowerCase());
    const pOk = samaAman_(hashPass_(String(password || ''), prop_('DARURAT_SALT')), prop_('DARURAT_HASH'));
    const c = CacheService.getScriptCache();
    if (!uOk || !pOk) {
      const n = Number(c.get('pin_gagal') || 0) + 1;
      c.put('pin_gagal', String(n), 900);
      if (n >= 5) {
        setProp_('ADMIN_LOCK_UNTIL', String(Date.now() + 15 * 60000));
        c.remove('pin_gagal');
      }
      Utilities.sleep(500);
      return fail_('Kredensial akses darurat tidak valid.');
    }
    c.remove('pin_gagal');
    const token = buatSesi_('darurat');
    const exp = Date.now() + APP.SESSION_HOURS * 3600e3;
    const out = { token: token, exp: exp, mode: 'darurat' };
    if (withData) {
      try { out.boot = bootstrapData_({ exp: exp, mode: 'darurat' }); } catch (err) { out.bootError = redaksi_(err.message); }
    }
    return ok_(out, 'Masuk menggunakan Akses Darurat.');
  } catch (e) {
    return fail_(e.message);
  }
}

function adminChangePin(token, oldPin, newPin) {
  return guard_(token, function (sesi) {
    oldPin = String(oldPin || '').trim();
    newPin = String(newPin || '').trim();
    // Jika masuk dengan mode darurat, izinkan setel ulang PIN tanpa PIN lama
    if (sesi.mode !== 'darurat') {
      if (!samaAman_(hashPass_(oldPin, prop_('ADMIN_PIN_SALT')), prop_('ADMIN_PIN_HASH'))) {
        return fail_('PIN lama tidak sesuai.');
      }
    }
    if (!/^\d{6}$/.test(newPin)) return fail_('PIN baru wajib 6 digit angka.');
    if (isWeakPin_(newPin)) return fail_('PIN terlalu mudah ditebak (hindari angka kembar atau berurutan).');

    const salt = Utilities.getUuid();
    setProps_({ ADMIN_PIN_SALT: salt, ADMIN_PIN_HASH: hashPass_(newPin, salt) });
    revokeAll_();
    return ok_({ token: buatSesi_('pin') }, 'PIN Admin berhasil diperbarui. Semua perangkat lain telah dikeluarkan.');
  });
}

function adminLogoutAll(token) {
  return guard_(token, function () {
    revokeAll_();
    return ok_(null, 'Seluruh sesi perangkat telah dikeluarkan.');
  });
}

// ============================================================================
//  7. ADMIN BOOTSTRAP & POLLING HEMAT (gas-scale-turbo)
// ============================================================================
function adminBootstrap(token) {
  return guard_(token, function (s) { return ok_(bootstrapData_(s)); });
}

function bootstrapData_(s) {
  const cats = readCategories_();
  const orders = readOrders_().map(function (o) {
    const copy = Object.assign({}, o);
    copy.invoiceSig = signInvoiceHash_(o.id_pesanan, o.total_harga);
    return copy;
  });
  let notifCrm = null;
  try { notifCrm = getNotifCrmSnapshot_(); } catch (e) { notifCrm = null; }

  return {
    settings: readSettings_(),
    heroSlides: readHeroSlides_(),
    categories: cats,
    products: readProducts_(cats),
    testimonials: readTestimonials_(false),
    orders: orders,
    licenses: readLicenses_(),
    waLog: readWaLog_(150),
    notifCrm: notifCrm,
    versions: versionsMap_(),
    secrets: {
      fonnte: {
        ada: !!prop_('FONNTE_TOKEN'),
        samar: samarkan_(prop_('FONNTE_TOKEN'))
      }
    },
    meta: metaInfo_(),
    session: { exp: s.exp, mode: s.mode || 'pin' }
  };
}

function adminSync(token, vOrders, vCatalog, vCrm) {
  return guard_(token, function () {
    const cur = versionsMap_();
    const out = { versions: cur };
    if (cur.orders !== String(vOrders || '')) {
      out.orders = readOrders_().map(function (o) {
        const copy = Object.assign({}, o);
        copy.invoiceSig = signInvoiceHash_(o.id_pesanan, o.total_harga);
        return copy;
      });
      out.licenses = readLicenses_();
      out.waLog = readWaLog_(150);
    }
    if (cur.catalog !== String(vCatalog || '')) {
      const cats = readCategories_();
      out.categories = cats;
      out.products = readProducts_(cats);
      out.testimonials = readTestimonials_(false);
      out.settings = readSettings_();
      out.heroSlides = readHeroSlides_(out.settings);
    }
    if (vCrm !== undefined && cur.crm !== String(vCrm || '')) {
      try { out.notifCrm = getNotifCrmSnapshot_(); } catch (e) { /* skip */ }
    }
    return ok_(out);
  });
}

function metaInfo_() {
  const id = prop_('SPREADSHEET_ID');
  return {
    spreadsheetId: id || '',
    spreadsheetUrl: id ? 'https://docs.google.com/spreadsheets/d/' + id + '/edit' : '',
    spreadsheetName: APP.SS_NAME,
    proofFolderUrl: prop_('PROOF_FOLDER_ID') ? 'https://drive.google.com/drive/folders/' + prop_('PROOF_FOLDER_ID') : '',
    exportFolderUrl: prop_('EXPORT_FOLDER_ID') ? 'https://drive.google.com/drive/folders/' + prop_('EXPORT_FOLDER_ID') : '',
    invoiceFolderUrl: prop_('INVOICE_FOLDER_ID') ? 'https://drive.google.com/drive/folders/' + prop_('INVOICE_FOLDER_ID') : '',
    appVersion: APP.VERSION,
    tz: APP.TZ
  };
}

function adminClearCache(token) {
  return guard_(token, function () {
    bumpVer_('CATALOG');
    bumpVer_('ORDERS');
    bumpVer_('CRM');
    return ok_(versionsMap_(), 'Cache server berhasil disegarkan dari Google Sheets.');
  });
}

// ============================================================================
//  8. ADMIN CRUD: PRODUK (MULTI-GAMBAR), KATEGORI & TESTIMONI
// ============================================================================
function adminSaveProduct(token, p) {
  return guard_(token, function () {
    p = p || {};
    const cats = readCategories_();
    const nama = str_(p.nama_produk, 140);
    if (nama.length < 3) return fail_('Nama produk minimal 3 karakter.');
    if (!cats.some(function (c) { return c.id_kategori === p.kategori; })) return fail_('Kategori tidak valid.');

    const harga = Math.round(num_(p.harga));
    let promo = Math.round(num_(p.harga_coret));
    if (harga <= 0) return fail_('Harga normal wajib lebih dari 0.');
    if (promo < 0) promo = 0;
    if (promo >= harga) return fail_('Harga promo harus lebih kecil dari harga normal (isi 0 bila tidak diskon).');

    const rawMain = str_(p.gambar_url, 700);
    const rawGaleri = str_(p.galeri_url, 3000);
    const allImgs = parseGalleryImages_(rawMain, rawGaleri);
    const mainImg = allImgs[0] || '';
    const extraImgs = allImgs.slice(1).join('\n');

    const rec = {
      nama_produk: nama,
      kategori: p.kategori,
      deskripsi: str_(p.deskripsi, 5000),
      harga: harga,
      harga_coret: promo,
      gambar_url: mainImg,
      galeri_url: extraImgs,
      badge_promo: str_(p.badge_promo, 30),
      status_aktif: p.status_aktif === 'Nonaktif' ? 'Nonaktif' : 'Aktif',
      spesifikasi: str_(p.spesifikasi, 240),
      rating: Math.max(0, Math.min(5, num_(p.rating) || 4.9)),
      jumlah_ulasan: Math.max(0, Math.round(num_(p.jumlah_ulasan))),
      urutan: Math.round(num_(p.urutan)),
      diperbarui: now_()
    };

    const saved = withLock_(function () {
      const sh = sheet_(SH.PRODUK);
      const headers = headersOf_(sh);
      if (headers.indexOf('galeri_url') < 0) {
        sh.getRange(1, headers.length + 1).setValue('galeri_url');
        headers.push('galeri_url');
      }
      let id = str_(p.id_produk, 30);
      let r = id ? findRow_(sh, id) : -1;
      if (r > 0) {
        const base = sh.getRange(r, 1, 1, headers.length).getValues()[0];
        sh.getRange(r, 1, 1, headers.length).setValues([rowFromObject_(headers, rec, base)]);
      } else {
        if (!id) id = nextProductId_(sh);
        rec.id_produk = id;
        appendObject_(sh, rec);
      }
      rec.id_produk = id;
      bumpVer_('CATALOG');
      return rec;
    });

    saved.diperbarui = saved.diperbarui.toISOString();
    saved.images = allImgs;
    return ok_(saved, 'Produk ' + saved.id_produk + ' berhasil disimpan.');
  });
}

function nextProductId_(sh) {
  const lr = sh.getLastRow();
  let max = 0;
  if (lr >= 2) {
    sh.getRange(2, 1, lr - 1, 1).getValues().forEach(function (r) {
      const m = String(r[0]).match(/^PRD-(\d+)$/);
      if (m) max = Math.max(max, Number(m[1]));
    });
  }
  return 'PRD-' + ('00' + (max + 1)).slice(-3);
}

function adminDeleteProduct(token, id) {
  return guard_(token, function () {
    return withLock_(function () {
      const sh = sheet_(SH.PRODUK);
      const r = findRow_(sh, id);
      if (r < 0) return fail_('Produk tidak ditemukan.');
      sh.deleteRow(r);
      bumpVer_('CATALOG');
      return ok_({ id: id }, 'Produk ' + id + ' dihapus.');
    });
  });
}

function adminSaveCategory(token, c) {
  return guard_(token, function () {
    c = c || {};
    const nama = str_(c.nama_kategori, 60);
    if (nama.length < 2) return fail_('Nama kategori wajib diisi.');
    let id = str_(c.id_kategori, 40).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!id) id = nama.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const rec = {
      id_kategori: id,
      nama_kategori: nama,
      icon_url: str_(c.icon_url, 300),
      subjudul: str_(c.subjudul, 60),
      urutan: Math.round(num_(c.urutan))
    };
    withLock_(function () {
      const sh = sheet_(SH.KATEGORI);
      const r = findRow_(sh, c.original_id || id);
      const headers = headersOf_(sh);
      if (r > 0) sh.getRange(r, 1, 1, headers.length).setValues([rowFromObject_(headers, rec)]);
      else appendObject_(sh, rec);
      bumpVer_('CATALOG');
    });
    return ok_(rec, 'Kategori "' + nama + '" disimpan.');
  });
}

function adminDeleteCategory(token, id) {
  return guard_(token, function () {
    if (readProducts_().some(function (p) { return p.kategori === id; })) {
      return fail_('Kategori masih digunakan oleh produk aktif/arsip. Pindahkan produk terlebih dahulu.');
    }
    return withLock_(function () {
      const sh = sheet_(SH.KATEGORI);
      const r = findRow_(sh, id);
      if (r < 0) return fail_('Kategori tidak ditemukan.');
      sh.deleteRow(r);
      bumpVer_('CATALOG');
      return ok_({ id: id }, 'Kategori dihapus.');
    });
  });
}

function adminSaveTestimonial(token, t) {
  return guard_(token, function () {
    t = t || {};
    const nama = str_(t.nama, 80);
    const kutipan = str_(t.kutipan_singkat, 300);
    if (nama.length < 2 || kutipan.length < 5) return fail_('Nama pelanggan dan kutipan singkat wajib diisi.');
    let id = str_(t.id_testimoni, 30);
    if (!id) id = 'TST-' + acak_(6, '0123456789ABCDEF');

    const rec = {
      id_testimoni: id,
      nama: nama,
      jabatan_perusahaan: str_(t.jabatan_perusahaan, 100) || 'Pelanggan Terverifikasi',
      avatar_url: driveImg_(t.avatar_url || ''),
      produk_terkait: str_(t.produk_terkait, 120),
      rating: Math.max(1, Math.min(5, Math.round(num_(t.rating) || 5))),
      kutipan_singkat: kutipan,
      cerita_lengkap: str_(t.cerita_lengkap, 2000) || kutipan,
      hasil_highlight: str_(t.hasil_highlight, 140) || 'Transaksi Terverifikasi',
      tanggal: str_(t.tanggal, 40) || fmtDate_(now_(), 'dd MMM yyyy'),
      terverifikasi: String(t.terverifikasi || 'Ya') === 'Tidak' ? 'Tidak' : 'Ya',
      tampil: String(t.tampil || 'Ya') === 'Tidak' ? 'Tidak' : 'Ya'
    };

    withLock_(function () {
      const sh = sheet_(SH.TESTIMONI);
      const r = findRow_(sh, id);
      const headers = headersOf_(sh);
      if (r > 0) sh.getRange(r, 1, 1, headers.length).setValues([rowFromObject_(headers, rec)]);
      else appendObject_(sh, rec);
      bumpVer_('CATALOG');
    });
    return ok_(rec, 'Testimoni "' + nama + '" disimpan.');
  });
}

function adminDeleteTestimonial(token, id) {
  return guard_(token, function () {
    return withLock_(function () {
      const sh = sheet_(SH.TESTIMONI);
      const r = findRow_(sh, id);
      if (r < 0) return fail_('Testimoni tidak ditemukan.');
      sh.deleteRow(r);
      bumpVer_('CATALOG');
      return ok_({ id: id }, 'Testimoni dihapus.');
    });
  });
}

// ============================================================================
//  9. ADMIN PESANAN, LISENSI, UPLOAD BERKAS, FAKTUR PDF & EKSPOR XLSX
// ============================================================================
function adminCreateOrder(token, o, opts) {
  return guard_(token, function () {
    o = o || {};
    opts = opts || {};
    const nama = str_(o.nama, 80);
    const wa = normalizePhone_(o.wa);
    if (nama.length < 2) return fail_('Nama pelanggan wajib diisi.');
    if (!validPhone_(wa)) return fail_('Nomor WhatsApp tidak valid.');
    const status = STATUS_LIST.indexOf(o.status) >= 0 ? o.status : 'Pending';
    const sumber = SUMBER_LIST.indexOf(o.sumber) >= 0 ? o.sumber : 'Input Admin (WA Chat)';
    const built = buildItems_(Array.isArray(o.items) ? o.items.slice(0, 20) : [], readProducts_(), true);
    if (!built.items.length) return fail_('Pilih minimal satu produk.');
    const total = (o.total !== undefined && o.total !== '' && num_(o.total) >= 0) ? Math.round(num_(o.total)) : built.total;

    let id = str_(o.id, 20).toUpperCase();
    if (!ORDER_ID_RE.test(id)) id = genOrderId_();

    const order = withLock_(function () {
      const sh = sheet_(SH.PESANAN);
      const exist = findRow_(sh, id);
      if (exist > 0) {
        const headers = headersOf_(sh);
        const row = sh.getRange(exist, 1, 1, headers.length).getValues()[0];
        const ob = { _row: exist };
        headers.forEach(function (h, i) { ob[h] = plain_(row[i]); });
        return ob;
      }
      const ts = now_();
      let licenses = [];
      if (status === 'Selesai') {
        licenses = allocateLicenses_(id, built.items, ts);
      }
      const rec = {
        id_pesanan: id,
        tanggal_order: ts,
        nama_pelanggan: nama,
        no_whatsapp: wa,
        id_produk: built.ids,
        nama_produk: built.names,
        total_harga: total,
        status_pesanan: status,
        sumber_pesanan: sumber,
        catatan: str_(o.catatan, 500),
        link_bukti_transfer: '',
        qty: built.qty,
        item_json: JSON.stringify(built.items),
        metode_bayar: str_(o.metode_bayar, 60),
        kunci_lisensi: licenses.join(', '),
        diperbarui: ts,
        riwayat_status: fmtDate_(ts) + ' Dibuat (' + sumber + ') • ' + status
      };
      const row = appendObject_(sh, rec);
      bumpVer_('ORDERS');
      rec._row = row;
      rec.tanggal_order = ts.toISOString();
      rec.diperbarui = ts.toISOString();
      rec.invoiceSig = signInvoiceHash_(id, total);
      return rec;
    });

    // Di luar lock: sinkron CRM + antrean / kirim WA
    try { crmUpsertFromOrder_(order, str_(o.email, 120)); } catch (e) { /* skip */ }
    let waRes = null;
    if (opts.notify) {
      const ev = status === 'Lunas' ? 'PEMBAYARAN_LUNAS' : status === 'Selesai' ? 'PESANAN_SELESAI' : 'TAGIHAN_TERBIT';
      enqueueOrderEvent_(ev, order, str_(o.email, 120), '');
      waRes = { queued: true, event: ev };
    }
    return ok_({ order: order, wa: waRes }, 'Pesanan ' + id + ' berhasil disimpan.');
  });
}

function adminUpdateOrder(token, id, patch, opts) {
  return guard_(token, function () {
    patch = patch || {};
    opts = opts || {};
    const allowed = ['status_pesanan', 'catatan', 'metode_bayar', 'link_bukti_transfer', 'nama_pelanggan', 'no_whatsapp', 'total_harga'];
    const result = withLock_(function () {
      const sh = sheet_(SH.PESANAN);
      const r = findRow_(sh, id);
      if (r < 0) throw new Error('Pesanan ' + id + ' tidak ditemukan.');
      const headers = headersOf_(sh);
      const row = sh.getRange(r, 1, 1, headers.length).getValues()[0];
      const cur = {};
      headers.forEach(function (h, i) { cur[h] = row[i]; });

      const upd = {};
      allowed.forEach(function (k) { if (patch[k] !== undefined) upd[k] = patch[k]; });
      if (upd.status_pesanan !== undefined && STATUS_LIST.indexOf(upd.status_pesanan) < 0) throw new Error('Status pesanan tidak valid.');
      if (upd.no_whatsapp !== undefined) {
        upd.no_whatsapp = normalizePhone_(upd.no_whatsapp);
        if (!validPhone_(upd.no_whatsapp)) throw new Error('Nomor WhatsApp tidak valid.');
      }
      if (upd.nama_pelanggan !== undefined) upd.nama_pelanggan = str_(upd.nama_pelanggan, 80);
      if (upd.catatan !== undefined) upd.catatan = str_(upd.catatan, 500);
      if (upd.total_harga !== undefined) upd.total_harga = Math.max(0, Math.round(num_(upd.total_harga)));
      if (upd.link_bukti_transfer !== undefined) upd.link_bukti_transfer = str_(upd.link_bukti_transfer, 600);

      const ts = now_();
      const from = String(cur.status_pesanan || '');
      let licenses = [];
      if (upd.status_pesanan && upd.status_pesanan !== from) {
        upd.riwayat_status = (String(cur.riwayat_status || '') + '; ' + fmtDate_(ts) + ' ' + from + ' → ' + upd.status_pesanan).replace(/^; /, '').slice(-2000);
        if (upd.status_pesanan === 'Selesai' && !String(cur.kunci_lisensi || '')) {
          licenses = allocateLicenses_(String(id), parseItems_(cur), ts);
          if (licenses.length) upd.kunci_lisensi = licenses.join(', ');
        }
      }
      upd.diperbarui = ts;
      const newRow = rowFromObject_(headers, upd, row);
      sh.getRange(r, 1, 1, headers.length).setValues([newRow]);
      bumpVer_('ORDERS');

      const ob = { _row: r };
      headers.forEach(function (h, i) { ob[h] = plain_(newRow[i]); });
      ob.total_harga = num_(ob.total_harga);
      ob.qty = num_(ob.qty) || 1;
      ob.no_whatsapp = String(ob.no_whatsapp || '');
      ob.invoiceSig = signInvoiceHash_(ob.id_pesanan, ob.total_harga);
      return { order: ob, licenses: licenses, changed: !!(upd.status_pesanan && upd.status_pesanan !== from) };
    });

    // Di luar lock: sinkron CRM & kirim antrean notifikasi bila status berubah ke Lunas/Selesai
    try { crmUpsertFromOrder_(result.order, ''); } catch (e) { /* skip */ }
    const st = result.order.status_pesanan;
    if (opts.notify && result.changed && (st === 'Lunas' || st === 'Selesai')) {
      const ev = st === 'Lunas' ? 'PEMBAYARAN_LUNAS' : 'PESANAN_SELESAI';
      enqueueOrderEvent_(ev, result.order, '', opts.linkInvoice || '');
      result.wa = { queued: true, event: ev };
    }
    return ok_(result, 'Pesanan ' + id + ' diperbarui.');
  });
}

function adminDeleteOrder(token, id) {
  return guard_(token, function () {
    return withLock_(function () {
      const sh = sheet_(SH.PESANAN);
      const r = findRow_(sh, id);
      if (r < 0) return fail_('Pesanan tidak ditemukan.');
      sh.deleteRow(r);
      bumpVer_('ORDERS');
      return ok_({ id: id }, 'Pesanan ' + id + ' dihapus.');
    });
  });
}

function parseItems_(o) {
  try {
    const arr = JSON.parse(String(o.item_json || '[]'));
    if (Array.isArray(arr) && arr.length) return arr;
  } catch (e) { /* fallback */ }
  return [{
    id: String(o.id_produk || '').split(',')[0].trim(),
    nama: String(o.nama_produk || ''),
    qty: num_(o.qty) || 1,
    harga: num_(o.total_harga),
    subtotal: num_(o.total_harga)
  }];
}

function renderTemplate_(tpl, vars) {
  return String(tpl || '').split('\n').filter(function (line) {
    const toks = line.match(/\{(\w+)\}/g) || [];
    return !toks.some(function (t) {
      const k = t.slice(1, -1);
      return Object.prototype.hasOwnProperty.call(vars, k) && (vars[k] === '' || vars[k] === null || vars[k] === undefined);
    });
  }).map(function (line) {
    return line.replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m;
    });
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function orderVars_(o, st, linkInvoice) {
  const items = parseItems_(o);
  return {
    nama: o.nama_pelanggan,
    id_pesanan: o.id_pesanan,
    produk: o.nama_produk,
    total: rupiah_(o.total_harga),
    status: o.status_pesanan,
    tanggal: o.tanggal_order ? fmtDate_(new Date(o.tanggal_order), 'dd MMM yyyy HH:mm') : '',
    nama_toko: st.nama_toko,
    rekening: st.rekening_bank,
    link_qris: st.link_qris,
    batas_bayar_jam: st.batas_bayar_jam,
    kunci_lisensi: o.kunci_lisensi || '',
    link_invoice: linkInvoice || '',
    catatan: o.catatan || '',
    no_wa: o.no_whatsapp,
    daftar_item: items.map(function (i) { return '- ' + i.nama + ' x' + i.qty + ' = Rp ' + rupiah_(i.subtotal || i.harga * i.qty); }).join('\n')
  };
}

/** Kirim pesan WA langsung (manual 1-klik dari laci pesanan). */
function adminSendWa(token, orderId, templateKey, customText, linkInvoice) {
  return guard_(token, function () {
    const order = readOrders_().filter(function (o) { return o.id_pesanan === orderId; })[0];
    if (!order) return fail_('Pesanan tidak ditemukan.');
    if (templateKey !== 'custom' && TEMPLATE_KEYS.indexOf(templateKey) < 0) return fail_('Template pesan tidak dikenal.');
    const st = readSettings_();
    const msg = templateKey === 'custom' ? str_(customText, 4000) : renderTemplate_(st[templateKey] || '', orderVars_(order, st, linkInvoice || ''));
    const res = sendFonnteDirect_(order.no_whatsapp, msg, { orderId: order.id_pesanan, template: templateKey, nama: order.nama_pelanggan });
    return ok_(res, res.ok ? 'Pesan WhatsApp terkirim ke ' + order.no_whatsapp + '.' : 'Gagal mengirim: ' + res.detail);
  });
}

function sendFonnteDirect_(target, message, meta) {
  meta = meta || {};
  const res = {
    ok: false, code: 0, id: '', detail: '',
    target: target, template: meta.template || '',
    at: new Date().toISOString()
  };
  const tk = prop_('FONNTE_TOKEN');
  if (!tk) {
    res.detail = 'FONNTE_TOKEN belum diisi di menu WA & Notifikasi.';
  } else {
    try {
      const r = UrlFetchApp.fetch(APP.FONNTE_URL, {
        method: 'post',
        headers: { Authorization: tk },
        muteHttpExceptions: true,
        payload: { target: String(target), message: String(message), countryCode: '62' }
      });
      res.code = r.getResponseCode();
      let body = {};
      try { body = JSON.parse(r.getContentText() || '{}'); } catch (e) { body = {}; }
      res.ok = res.code === 200 && body.status === true;
      res.id = Array.isArray(body.id) ? body.id.join(',') : String(body.id || '');
      res.detail = res.ok ? String(body.process || 'terkirim') : redaksi_(String(body.reason || body.detail || ('HTTP ' + res.code)));
    } catch (e) {
      res.detail = redaksi_(e.message);
    }
  }
  try {
    appendObject_(sheet_(SH.LOG_WA), {
      waktu: now_(),
      id_pesanan: meta.orderId || '-',
      nomor: target,
      template: meta.template || 'custom',
      status: res.ok ? 'TERKIRIM' : 'GAGAL',
      http_code: res.code,
      message_id: res.id,
      ringkasan_pesan: String(message).replace(/\s+/g, ' ').slice(0, 180)
    });
    if (res.ok) {
      try { crmTouchInteractionByPhone_(target, 'WA', 'KELUAR', String(message).slice(0, 140), meta.orderId || ''); } catch (e2) { /* skip */ }
    }
    bumpVer_('ORDERS');
  } catch (e) { /* abaikan log gagal */ }
  return res;
}

// --- License Vault ---
function allocateLicenses_(orderId, items, ts) {
  const t = readTable_(SH.LISENSI);
  if (!t.rows.length) return [];
  const H = {};
  t.headers.forEach(function (h, i) { H[h] = i; });
  const need = {};
  items.forEach(function (i) { need[i.id] = (need[i.id] || 0) + (num_(i.qty) || 1); });
  const codes = [];
  let lo = -1, hi = -1;
  t.rows.forEach(function (r, idx) {
    const pid = String(r[H.id_produk]);
    if (need[pid] > 0 && String(r[H.status]) === 'Tersedia') {
      r[H.status] = 'Terpakai';
      r[H.id_pesanan] = orderId;
      r[H.tanggal_alokasi] = ts;
      codes.push(String(r[H.kode_lisensi]));
      need[pid]--;
      if (lo < 0) lo = idx;
      hi = idx;
    }
  });
  if (lo >= 0) {
    t.sheet.getRange(lo + 2, 1, hi - lo + 1, t.headers.length).setValues(t.rows.slice(lo, hi + 1));
  }
  return codes;
}

function adminAddLicenses(token, productId, codes) {
  return guard_(token, function () {
    const prod = readProducts_().filter(function (p) { return p.id_produk === productId; })[0];
    if (!prod) return fail_('Produk tidak ditemukan.');
    const list = (Array.isArray(codes) ? codes : String(codes || '').split(/\r?\n/))
      .map(function (c) { return str_(c, 120); })
      .filter(function (c) { return c.length >= 4; });
    if (!list.length) return fail_('Masukkan minimal 1 kode lisensi valid (minimal 4 karakter).');
    if (list.length > 500) return fail_('Maksimal 500 kode per sekali simpan.');

    const added = withLock_(function () {
      const t = readTable_(SH.LISENSI);
      const exist = {};
      t.rows.forEach(function (r) { exist[String(r[0])] = 1; });
      const ts = now_();
      const rows = [];
      list.forEach(function (c) {
        if (!exist[c]) {
          exist[c] = 1;
          rows.push(rowFromObject_(t.headers, {
            kode_lisensi: c, id_produk: productId, status: 'Tersedia',
            id_pesanan: '', tanggal_alokasi: '', dibuat: ts
          }));
        }
      });
      if (rows.length) {
        t.sheet.getRange(t.sheet.getLastRow() + 1, 1, rows.length, t.headers.length).setValues(rows);
      }
      bumpVer_('ORDERS');
      return rows.length;
    });
    return ok_({ added: added, licenses: readLicenses_() }, added + ' kode lisensi berhasil ditambahkan.');
  });
}

function adminDeleteLicense(token, code) {
  return guard_(token, function () {
    return withLock_(function () {
      const sh = sheet_(SH.LISENSI);
      const r = findRow_(sh, code);
      if (r < 0) return fail_('Kode lisensi tidak ditemukan.');
      const headers = headersOf_(sh);
      const st = sh.getRange(r, headers.indexOf('status') + 1).getValue();
      if (String(st) === 'Terpakai') return fail_('Kode lisensi yang sudah terpakai tidak boleh dihapus.');
      sh.deleteRow(r);
      bumpVer_('ORDERS');
      return ok_({ code: code }, 'Kode lisensi dihapus.');
    });
  });
}

// --- Pengaturan & Rahasia Dashboard ---
function adminSaveSettings(token, obj) {
  return guard_(token, function () {
    obj = obj || {};
    if (obj.nomor_wa_admin !== undefined) {
      obj.nomor_wa_admin = normalizePhone_(obj.nomor_wa_admin);
      if (!validPhone_(obj.nomor_wa_admin)) return fail_('Nomor WhatsApp Admin tidak valid.');
    }
    if (obj.hero_slides_json !== undefined) {
      try {
        const arr = JSON.parse(String(obj.hero_slides_json));
        if (!Array.isArray(arr) || !arr.length) return fail_('Data slide hero harus berupa array minimal 1 slide.');
      } catch (e) {
        return fail_('Format JSON slide hero tidak valid.');
      }
    }
    withLock_(function () {
      const t = readTable_(SH.PENGATURAN);
      const idx = {};
      t.rows.forEach(function (r, i) { idx[String(r[0])] = i; });
      const desc = {};
      DEFAULT_SETTINGS.forEach(function (r) { desc[r[0]] = r[2]; });
      Object.keys(obj).forEach(function (k) {
        if (SETTING_KEYS.indexOf(k) < 0) return;
        const maxLen = k === 'hero_slides_json' ? 25000 : 4000;
        const v = str_(obj[k], maxLen);
        if (idx[k] !== undefined) t.rows[idx[k]][1] = v;
        else { t.rows.push([k, v, desc[k] || '']); idx[k] = t.rows.length - 1; }
      });
      const w = Math.max(3, t.headers.length);
      const rows = t.rows.map(function (r) { const x = r.slice(0, w); while (x.length < w) x.push(''); return x; });
      if (rows.length) t.sheet.getRange(2, 1, rows.length, w).setValues(rows);
      bumpVer_('CATALOG');
    });
    const st = readSettings_();
    return ok_({ settings: st, heroSlides: readHeroSlides_(st) }, 'Pengaturan toko berhasil disimpan.');
  });
}

function adminSaveSecret(token, key, value) {
  return guard_(token, function () {
    const aturan = RAHASIA_DASHBOARD[key];
    if (!aturan) return fail_('Kunci rahasia tidak diizinkan oleh allowlist.');
    if (value === '__HAPUS__') {
      delProp_(key);
    } else {
      const v = str_(value, aturan.maks);
      if (!v) return fail_('Nilai token kosong — tidak ada perubahan.');
      if (v.length < aturan.min) return fail_('Token terlalu pendek (minimal ' + aturan.min + ' karakter).');
      setProp_(key, v);
    }
    CacheService.getScriptCache().remove('fonnte_dev');
    return ok_({ kunci: key, ada: !!prop_(key), samar: samarkan_(prop_(key)) }, 'Token berhasil diamankan di Script Properties.');
  });
}

function adminFonnteStatus(token, force) {
  return guard_(token, function () {
    const tk = prop_('FONNTE_TOKEN');
    const base = { ada: !!tk, samar: samarkan_(tk) };
    if (!tk) return ok_(base);
    const c = CacheService.getScriptCache();
    const hit = !force && c.get('fonnte_dev');
    if (hit) { base.device = JSON.parse(hit); return ok_(base); }
    try {
      const r = UrlFetchApp.fetch(APP.FONNTE_DEVICE_URL, {
        method: 'post', headers: { Authorization: tk }, muteHttpExceptions: true
      });
      const b = JSON.parse(r.getContentText() || '{}');
      base.device = {
        ok: b.status === true,
        status: String(b.device_status || ''),
        nomor: String(b.device || ''),
        nama: String(b.name || ''),
        kuota: String(b.quota || ''),
        paket: String(b.package || ''),
        kedaluwarsa: String(b.expired || ''),
        alasan: redaksi_(String(b.reason || ''))
      };
      c.put('fonnte_dev', JSON.stringify(base.device), 300);
    } catch (e) {
      base.device = { ok: false, alasan: redaksi_(e.message) };
    }
    return ok_(base);
  });
}

function adminTestFonnte(token, nomor) {
  return guard_(token, function () {
    const t = normalizePhone_(nomor);
    if (!validPhone_(t)) return fail_('Nomor WhatsApp uji tidak valid.');
    const st = readSettings_();
    const res = sendFonnteDirect_(t, 'Tes koneksi Fonnte Gateway dari Admin Portal *' + st.nama_toko + '* (' + fmtDate_(now_(), 'dd MMM yyyy HH:mm') + ' WIB). Koneksi aktif!', {
      orderId: 'TEST', template: 'tes_koneksi'
    });
    return ok_(res, res.ok ? 'Pesan uji terkirim ke ' + t + '.' : 'Gagal: ' + res.detail);
  });
}

// --- Upload Drive, Faktur PDF & Ekspor XLSX ---
function adminUploadFile(token, kind, base64, mime, filename, refId) {
  return guard_(token, function () {
    mime = str_(mime, 60);
    if (!/^image\/(png|jpe?g|webp|gif)$|^application\/pdf$/.test(mime)) {
      return fail_('Format berkas wajib gambar (JPG/PNG/WEBP) atau PDF.');
    }
    const bytes = Utilities.base64Decode(String(base64 || ''));
    if (bytes.length > 5 * 1024 * 1024) return fail_('Ukuran berkas maksimal 5 MB.');
    const ext = mime === 'application/pdf' ? 'pdf' : mime.split('/')[1].replace('jpeg', 'jpg');
    let name, folder;
    if (kind === 'proof') {
      const order = readOrders_().filter(function (o) { return o.id_pesanan === refId; })[0];
      if (!order) return fail_('Pesanan tidak ditemukan.');
      name = 'BUKTI_' + refId + '_' + String(order.nama_pelanggan).replace(/[^\w]+/g, '') + '.' + ext;
      folder = folder_('PROOF_FOLDER_ID');
    } else {
      name = 'PRODUK_' + (str_(refId, 30) || 'GALERI') + '_' + Date.now() + '.' + ext;
      folder = folder_('PRODUCT_IMG_FOLDER_ID');
    }
    const file = folder.createFile(Utilities.newBlob(bytes, mime, name));
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* domain policy */ }
    const res = {
      fileId: file.getId(),
      url: file.getUrl(),
      name: name,
      img: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1200'
    };
    if (kind === 'proof') {
      const up = adminUpdateOrder(token, refId, { link_bukti_transfer: file.getUrl() }, {});
      if (!up.success) return up;
      res.order = up.data.order;
    }
    return ok_(res, 'Berkas berhasil diunggah ke Google Drive.');
  });
}

function adminSaveExport(token, filename, csv) {
  return guard_(token, function () {
    const name = str_(filename, 120).replace(/[^\w.-]+/g, '_') || ('NusaStore_Export_' + Date.now() + '.csv');
    const file = folder_('EXPORT_FOLDER_ID').createFile(Utilities.newBlob(String(csv || ''), 'text/csv', name));
    return ok_({ url: file.getUrl(), name: name }, 'Salinan CSV tersimpan di Google Drive.');
  });
}

function adminExportXlsx(token, filename, header, rows) {
  return guard_(token, function () {
    if (!Array.isArray(header) || !Array.isArray(rows)) return fail_('Data ekspor tidak valid.');
    if (rows.length > 20000) return fail_('Maksimal 20.000 baris per ekspor.');
    const name = (str_(filename, 100).replace(/[^\w.-]+/g, '_') || 'NusaStore_Export').replace(/\.xlsx$/i, '');
    const tmp = SpreadsheetApp.create(name);
    try {
      const sh = tmp.getSheets()[0];
      sh.setName('Pesanan');
      const data = [header].concat(rows.map(function (r) {
        return header.map(function (_, i) { return r[i] === undefined ? '' : r[i]; });
      }));
      sh.getRange(1, 1, data.length, header.length).setValues(data);
      sh.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#0F172A').setFontColor('#FFFFFF');
      sh.setFrozenRows(1);
      const totalCol = header.indexOf('total_harga');
      if (totalCol >= 0 && rows.length) sh.getRange(2, totalCol + 1, rows.length, 1).setNumberFormat('"Rp" #,##0');
      sh.autoResizeColumns(1, header.length);
      SpreadsheetApp.flush();
      const resp = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + tmp.getId() + '/export?format=xlsx', {
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        muteHttpExceptions: true
      });
      if (resp.getResponseCode() !== 200) throw new Error('Ekspor XLSX ditolak Google (HTTP ' + resp.getResponseCode() + ').');
      const blob = resp.getBlob().setName(name + '.xlsx');
      const file = folder_('EXPORT_FOLDER_ID').createFile(blob);
      return ok_({ url: file.getUrl(), name: name + '.xlsx', base64: Utilities.base64Encode(blob.getBytes()), size: blob.getBytes().length }, 'Berkas Excel siap diunduh.');
    } finally {
      try { DriveApp.getFileById(tmp.getId()).setTrashed(true); } catch (e) { /* skip */ }
    }
  });
}

function adminInvoicePdf(token, orderId, html) {
  return guard_(token, function () {
    if (!ORDER_ID_RE.test(String(orderId))) return fail_('ID pesanan tidak valid.');
    const page = '<html><head><meta charset="utf-8"><style>@page{size:A4;margin:14mm}body{font-family:Arial,Helvetica,sans-serif}</style></head><body>' + String(html || '').slice(0, 400000) + '</body></html>';
    const blob = HtmlService.createHtmlOutput(page).getAs('application/pdf').setName('Faktur_' + orderId + '.pdf');
    const folder = folder_('INVOICE_FOLDER_ID');
    const old = folder.getFilesByName('Faktur_' + orderId + '.pdf');
    while (old.hasNext()) old.next().setTrashed(true);
    const file = folder.createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* skip */ }
    return ok_({ url: file.getUrl(), fileId: file.getId(), size: blob.getBytes().length }, 'Faktur PDF berhasil disimpan di Google Drive.');
  });
}

// ============================================================================
//  10. AUTO-SETUP IDEMPOTEN & UTILITAS PEMULIHAN RAHASIA
// ============================================================================
function setupAppEnvironment() {
  try {
    const root = findOrCreateFolder_(null, APP.FOLDER_ROOT, 'ROOT_FOLDER_ID');
    const uploads = findOrCreateFolder_(root, APP.FOLDER_UPLOADS, 'UPLOADS_FOLDER_ID');
    const proof = findOrCreateFolder_(uploads, APP.FOLDER_PROOF, 'PROOF_FOLDER_ID');
    const prodImg = findOrCreateFolder_(uploads, APP.FOLDER_PRODUCT_IMG, 'PRODUCT_IMG_FOLDER_ID');
    const inv = findOrCreateFolder_(root, APP.FOLDER_INVOICE, 'INVOICE_FOLDER_ID');
    const exp = findOrCreateFolder_(root, APP.FOLDER_EXPORT, 'EXPORT_FOLDER_ID');

    let ss = null;
    if (prop_('SPREADSHEET_ID')) {
      try { ss = SpreadsheetApp.openById(prop_('SPREADSHEET_ID')); } catch (e) { ss = null; }
    }
    if (!ss) {
      const files = root.getFilesByName(APP.SS_NAME);
      if (files.hasNext()) ss = SpreadsheetApp.open(files.next());
      else {
        ss = SpreadsheetApp.create(APP.SS_NAME);
        DriveApp.getFileById(ss.getId()).moveTo(root);
      }
      setProp_('SPREADSHEET_ID', ss.getId());
    }
    _SS = ss;

    const demo = demoData_();
    ensureSheet_(ss, SH.KATEGORI, demo.kategori);
    ensureSheet_(ss, SH.PRODUK, demo.produk);
    ensureSheet_(ss, SH.PESANAN, demo.pesanan);
    ensureSheet_(ss, SH.PENGATURAN, DEFAULT_SETTINGS);
    ensureSheet_(ss, SH.TESTIMONI, demo.testimoni);
    ensureSheet_(ss, SH.LISENSI, demo.lisensi);
    ensureSheet_(ss, SH.LOG_WA, demo.logwa);
    ensureSheet_(ss, SH.NEWSLETTER, []);
    ensureSheet_(ss, SH.ANTRIAN_NOTIF, []);
    ensureSheet_(ss, SH.BLAST_WA, []);
    ensureSheet_(ss, SH.CRM_KONTAK, demo.crmKontak);
    ensureSheet_(ss, SH.CRM_INTERAKSI, demo.crmInteraksi);
    ensureSheet_(ss, SH.APPCONFIG, []);
    ensureSettingKeys_(ss);

    // Format kolom teks telepon & nominal rupiah
    const ps = ss.getSheetByName(SH.PESANAN), pH = headersOf_(ps);
    ps.getRange(1, pH.indexOf('no_whatsapp') + 1, ps.getMaxRows(), 1).setNumberFormat('@');
    ps.getRange(2, pH.indexOf('total_harga') + 1, Math.max(1, ps.getMaxRows() - 1), 1).setNumberFormat('#,##0');

    const crmS = ss.getSheetByName(SH.CRM_KONTAK), crmH = headersOf_(crmS);
    crmS.getRange(1, crmH.indexOf('NoWA') + 1, crmS.getMaxRows(), 1).setNumberFormat('@');

    // Hapus sheet kosong bawaan
    const ours = Object.keys(SH).map(function (k) { return SH[k]; });
    ss.getSheets().forEach(function (x) {
      if (ours.indexOf(x.getName()) < 0 && x.getLastRow() === 0 && ss.getSheets().length > 1) {
        ss.deleteSheet(x);
      }
    });

    // Inisialisasi Rahasia (hanya saat belum ada) & Konfigurasi Notifikasi Default
    const sec = ensureSecretsAndPin_();
    ensureNotifProps_();
    try { pasangTriggerNotif(); } catch (tErr) { Logger.log('ℹ️ Trigger otomatis: jalankan pasangTriggerNotif() bila diperlukan (' + tErr.message + ')'); }

    // Cermin Kelas B baca-saja di AppConfig
    const ac = ss.getSheetByName(SH.APPCONFIG);
    const cfg = [
      ['SPREADSHEET_ID', ss.getId(), 'Sumber kebenaran: Script Properties'],
      ['ROOT_FOLDER_ID', root.getId(), 'Folder utama NusaStore'],
      ['PROOF_FOLDER_ID', proof.getId(), 'Bukti Transfer Pelanggan'],
      ['PRODUCT_IMG_FOLDER_ID', prodImg.getId(), 'Galeri Gambar Produk'],
      ['INVOICE_FOLDER_ID', inv.getId(), 'Arsip Faktur PDF'],
      ['EXPORT_FOLDER_ID', exp.getId(), 'Hasil Ekspor CSV/XLSX'],
      ['APP_VERSION', APP.VERSION, 'Diperbarui ' + fmtDate_(now_())]
    ];
    if (ac.getLastRow() > 1) ac.getRange(2, 1, ac.getLastRow() - 1, 3).clearContent();
    ac.getRange(2, 1, cfg.length, 3).setValues(cfg);

    bumpVer_('CATALOG');
    bumpVer_('ORDERS');
    bumpVer_('CRM');
    getPublicData_();

    Logger.log('============================================================');
    Logger.log('✅ SETUP NUSASTORE v' + APP.VERSION + ' BERHASIL!');
    Logger.log('📊 Spreadsheet Database : ' + ss.getUrl());
    Logger.log('📁 Folder Google Drive  : ' + root.getUrl());
    if (sec.pin) {
      Logger.log('🔐 PIN ADMIN AWAL (CATAT SEKARANG — HANYA TAMPIL SEKALI): ' + sec.pin);
    } else {
      Logger.log('🔐 PIN Admin sudah terenkripsi di Script Properties (tidak ditimpa).');
    }
    if (sec.daruratPass) {
      Logger.log('🆘 LOGIN DARURAT (CATAT SEKARANG — HANYA TAMPIL SEKALI):');
      Logger.log('   Username : darurat');
      Logger.log('   Password : ' + sec.daruratPass);
    }
    Logger.log('============================================================');
    return ok_({ spreadsheetUrl: ss.getUrl(), folderUrl: root.getUrl() }, 'Setup berhasil!');
  } catch (e) {
    Logger.log('❌ Setup gagal: ' + redaksi_(e.message));
    return fail_(e.message);
  }
}

function findOrCreateFolder_(parent, name, propKey) {
  const id = prop_(propKey);
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* buat baru */ }
  }
  const it = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  const f = it.hasNext() ? it.next() : (parent ? parent.createFolder(name) : DriveApp.createFolder(name));
  setProp_(propKey, f.getId());
  return f;
}

function ensureSheet_(ss, name, demoRows) {
  const headers = HEADERS[name];
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (demoRows && demoRows.length) {
      const rows = demoRows.map(function (r) { return Array.isArray(r) ? r : rowFromObject_(headers, r); });
      sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }
  } else {
    const cur = headersOf_(sh);
    const missing = headers.filter(function (h) { return cur.indexOf(h) < 0; });
    if (missing.length) sh.getRange(1, cur.length + 1, 1, missing.length).setValues([missing]);
  }
  const lc = sh.getLastColumn();
  sh.getRange(1, 1, 1, lc).setFontWeight('bold').setBackground('#0F172A').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  return sh;
}

function ensureSettingKeys_(ss) {
  const sh = ss.getSheetByName(SH.PENGATURAN);
  const have = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { have[String(r[0])] = 1; });
  }
  const add = DEFAULT_SETTINGS.filter(function (r) { return !have[r[0]]; });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 3).setValues(add);
}

/** Jalankan manual di editor GAS jika lupa PIN 6 digit. */
function resetPinAdmin() {
  delProp_('ADMIN_PIN_HASH');
  delProp_('ADMIN_PIN_SALT');
  delProp_('ADMIN_LOCK_UNTIL');
  const sec = ensureSecretsAndPin_();
  revokeAll_();
  Logger.log('🔐 PIN ADMIN BARU: ' + sec.pin + ' — Segera masuk dan ubah dari menu Pengaturan.');
}

/** Jalankan manual di editor GAS untuk merotasi sandi akun darurat. */
function resetAksesDarurat() {
  delProp_('DARURAT_HASH');
  delProp_('DARURAT_SALT');
  delProp_('ADMIN_LOCK_UNTIL');
  const sec = ensureSecretsAndPin_();
  revokeAll_();
  Logger.log('🆘 SANDI DARURAT BARU (user: darurat): ' + sec.daruratPass);
}

/** Putus paksa semua sesi login aktif di seluruh perangkat. */
function rotasiSecretSesi() {
  setProp_('SESSION_SECRET', acak_(64));
  revokeAll_();
  Logger.log('✅ SESSION_SECRET berhasil dirotasi — seluruh sesi lama berakhir.');
}

// ============================================================================
//  11. DATA CONTOH AWAL (MULTI-GAMBAR PRODUK, TESTIMONI, PESANAN, CRM)
// ============================================================================
function demoData_() {
  const U = 'https://images.unsplash.com/';
  const q = '?auto=format&fit=crop&w=900&q=75';
  const img = function (id) { return U + id + q; };

  const kategori = [
    { id_kategori: 'web-dev', nama_kategori: 'Web Development', icon_url: 'code', subjudul: 'E-Commerce & SaaS', urutan: 1 },
    { id_kategori: 'automation', nama_kategori: 'Automation Tools', icon_url: 'zap', subjudul: 'Fonnte WA & CRM', urutan: 2 },
    { id_kategori: 'business', nama_kategori: 'Business Store', icon_url: 'briefcase', subjudul: 'POS & Operasional', urutan: 3 },
    { id_kategori: 'hardware', nama_kategori: 'Hardware Devices', icon_url: 'monitor', subjudul: 'Laptop & Workstation', urutan: 4 },
    { id_kategori: 'gaming', nama_kategori: 'Gaming Laptops', icon_url: 'cpu', subjudul: 'Performa Ekstrem', urutan: 5 },
    { id_kategori: 'jasa', nama_kategori: 'Jasa & Konsultasi', icon_url: 'headphones', subjudul: 'Setup Terima Beres', urutan: 6 }
  ];

  const ts = now_();
  const P = function (id, nama, kat, harga, promo, mainPhoto, extraPhotos, badge, spek, rating, ulasan, urut, desk, status) {
    return {
      id_produk: id,
      nama_produk: nama,
      kategori: kat,
      deskripsi: desk,
      harga: harga,
      harga_coret: promo,
      gambar_url: mainPhoto ? img(mainPhoto) : '',
      galeri_url: (extraPhotos || []).map(img).join('\n'),
      badge_promo: badge,
      status_aktif: status || 'Aktif',
      spesifikasi: spek,
      rating: rating,
      jumlah_ulasan: ulasan,
      urutan: urut,
      diperbarui: ts
    };
  };

  const produk = [
    P('PRD-001', 'NusaStore E-Commerce ProAPI + Fonnte CRM Suite', 'web-dev', 1999000, 1499000,
      'photo-1460925895917-afdab827c52f',
      ['photo-1551288049-bebda4e38f71', 'photo-1556742049-0cfed4f6a45d', 'photo-1498050108023-c5249f4df085'],
      'Best Seller', 'Frontend GitHub Pages • REST API GAS • CRM & WA Blast', 4.9, 142, 1,
      'Template toko online fullstack generasi terbaru berbasis arsitektur terpisah (GitHub Pages + Google Apps Script REST API).\n• Database Google Sheets real-time bebas biaya sewa server\n• Checkout instan ke WhatsApp + Keranjang Belanja Pintar\n• Modul CRM Pelanggan & Broadcast WhatsApp ber-batch\n• Generator Faktur Resmi PDF ber-QR & License Vault otomatis'),
    P('PRD-002', 'Bundling Setup Terima Beres & Integrasi Domain', 'jasa', 450000, 350000,
      'photo-1522202176988-66273c2fd55f',
      ['photo-1531482615713-2afd69097998', 'photo-1553877522-43269d4ea984'],
      'Popular', 'SLA 1–2 Hari Kerja • Deploy GitHub Pages + GAS + Fonnte', 4.9, 78, 2,
      'Tim engineer kami memasangkan seluruh sistem sampai toko Anda siap menerima pesanan.\n• Setup backend Google Apps Script & Script Properties aman\n• Deploy frontend ke GitHub Pages + Custom Domain HTTPS\n• Konfigurasi token Fonnte & uji antrean notifikasi\n• Sesi pelatihan privat 60 menit via Google Meet'),
    P('PRD-003', 'Cloud POS Kasir Multi-Cabang (Thermal Bluetooth)', 'business', 1250000, 899000,
      'photo-1556742049-0cfed4f6a45d',
      ['photo-1556740738-b6a63e27c4df', 'photo-1554224155-6726b3ff858f'],
      'New Release', 'Cetak Struk 58/80mm • Laba Rugi Cabang • Offline-First', 4.8, 53, 3,
      'Aplikasi kasir modern multi-cabang dengan sinkronisasi Google Sheets.\n• Tetap jalan lancar meski sinyal internet kasir putus sementara\n• Cetak struk via Web Bluetooth ESC/POS & RawBT Android\n• Laporan omzet, HPP, dan laba bersih otomatis per outlet'),
    P('PRD-004', 'MacBook Pro M3 Pro Workstation 14-inch Resmi', 'hardware', 34500000, 31999000,
      'photo-1517336714731-489689fd1ca8',
      ['photo-1611186871348-b1ce696e52c9', 'photo-1541807084-5c52b6b3adef'],
      'Hot Item', '18GB Unified RAM • 512GB NVMe • Garansi Resmi iBox', 5.0, 94, 4,
      'Workstation andalan software engineer, desainer UI/UX, dan eksekutif.\n• Chip Apple M3 Pro 11-core CPU & 14-core GPU\n• Memori terpadu 18GB & penyimpanan SSD 512GB super cepat\n• Layar Liquid Retina XDR 14.2 inci ProMotion 120Hz'),
    P('PRD-005', 'Fonnte WhatsApp Automation & Smart CRM Engine', 'automation', 990000, 750000,
      'photo-1611746872915-64382b5c76da',
      ['photo-1563986768609-322da13575f3', 'photo-1512428559087-560fa5ceab42'],
      'Auto WA', 'Antrean Non-Blocking • Validasi Nomor WA • Anti-Banned', 4.9, 89, 5,
      'Mesin otomasi notifikasi WhatsApp & manajemen pelanggan terintegrasi.\n• Antrean pengiriman non-blocking di latar belakang\n• Blast WA massal dengan jeda acak manusiawi 3–8 detik\n• Validasi nomor WA aktif otomatis & kepatuhan Opt-Out'),
    P('PRD-006', 'ASUS ROG Zephyrus G14 OLED (RTX 4060)', 'gaming', 26800000, 24499000,
      'photo-1603302576837-37561b2e2302',
      ['photo-1593640408182-31c70c8268f5', 'photo-1587202372775-e229f172b9d7'],
      'Gaming Rig', 'Ryzen 9 8945HS • 16GB LPDDR5X • 1TB SSD • 3K OLED', 4.9, 65, 6,
      'Laptop kreator & gaming ultra-ringkas dengan layar Nebula OLED 3K.\n• Prosesor AMD Ryzen 9 8945HS dengan Ryzen AI\n• GPU NVIDIA GeForce RTX 4060 8GB GDDR6\n• Sasis aluminium CNC ringan 1.5 kg, garansi resmi 2 tahun'),
    P('PRD-007', 'Dell XPS 13 Plus 9320 Core i7 OLED Touch', 'hardware', 23500000, 21890000,
      'photo-1593642632823-8f785ba67e45',
      ['photo-1588872657578-7efd1f1555ed', 'photo-1496181133206-80ce9b88a853'],
      'Ultrabook', 'Core i7-1360P • 16GB RAM • 1TB SSD • 3.5K OLED Touch', 4.8, 52, 7,
      'Ultrabook masa depan dengan desain minimalis kapasitif.\n• Intel Evo Platform Core i7-1360P\n• Layar sentuh 13.4 inci 3.5K OLED tajam memukau\n• Bobot hanya 1.26 kg untuk mobilitas bisnis tinggi'),
    P('PRD-008', 'Sales Pipeline CRM & Faktur Pajak QR Engine', 'automation', 850000, 650000,
      'photo-1551288049-bebda4e38f71',
      ['photo-1454165804606-c3d57bc86b40', 'photo-1543286386-713bdd548da4'],
      'CRM Suite', 'Pipeline Sheets • Faktur PDF HMAC • Auto Follow-Up', 4.9, 96, 8,
      'Kelola prospek B2B hingga penagihan lunas dalam satu dashboard.\n• Pelacakan interaksi telepon, email, dan WhatsApp pelanggan\n• Pembuatan faktur PDF resmi lengkap tanda tangan QR\n• Pengingat jatuh tempo otomatis H-3 dan H-0'),
    P('PRD-009', 'Next.js 15 Enterprise SaaS Starter Kit', 'web-dev', 1500000, 1150000,
      'photo-1498050108023-c5249f4df085',
      ['photo-1555066931-4365d14bab8c', 'photo-1517694712202-14dd9538aa97'],
      'Fullstack', 'TypeScript • Multi-Tenant Auth • Payment Gateway Ready', 5.0, 112, 9,
      'Fondasi aplikasi SaaS skala produksi siap rilis.\n• Arsitektur modular TypeScript + komponen UI responsif\n• Autentikasi multi-role, RBAC, dan webhook pembayaran\n• Dokumentasi deployment lengkap'),
    P('PRD-011', 'Printer Struk Thermal Bluetooth 58mm Portable', 'hardware', 350000, 285000,
      'photo-1612815154858-60aa4c59eaa6',
      ['photo-1556742049-0cfed4f6a45d', 'photo-1586880244406-556ebe35f282'],
      'Hemat 19%', 'Bluetooth + USB • Baterai 1500mAh • Support Android/Web', 4.7, 44, 10,
      'Printer thermal ringkas untuk kasir toko, kurir, dan loket pembayaran.\n• Cetak cepat tanpa tinta di kertas thermal 58mm\n• Kompatibel langsung dengan Web Bluetooth Chrome & RawBT')
  ];

  const testimoni = [
    {
      id_testimoni: 'TST-001',
      nama: 'Rendy Prakoso',
      jabatan_perusahaan: 'Founder • KopiNusa Roastery (8 Cabang)',
      avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=240&q=80',
      produk_terkait: 'NusaStore E-Commerce ProAPI + Fonnte CRM Suite',
      rating: 5,
      kutipan_singkat: 'Pindah ke NusaStore bikin biaya hosting bulanan kami Rp 0, tapi konversi checkout WhatsApp naik hampir dua kali lipat!',
      cerita_lengkap: 'Sebelumnya kami memakai platform toko online berlangganan yang lambat dibuka di HP pelanggan dan membebani biaya bulanan tinggi. Sejak migrasi ke NusaStore ProAPI di GitHub Pages, halaman katalog terbuka kurang dari 1 detik. Tim CS kami sangat terbantu karena setiap pesanan otomatis masuk ke Google Sheets sekaligus mengirim tagihan dan faktur PDF lewat WhatsApp Fonnte tanpa diketik manual.',
      hasil_highlight: '+92% Konversi Checkout WA • Rp 0 Biaya Server',
      tanggal: '18 Okt 2026',
      terverifikasi: 'Ya',
      tampil: 'Ya'
    },
    {
      id_testimoni: 'TST-002',
      nama: 'Nadira Kusumawardhani',
      jabatan_perusahaan: 'Head of Growth • Sinar Kreatif Digital',
      avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=240&q=80',
      produk_terkait: 'Fonnte WhatsApp Automation & Smart CRM Engine',
      rating: 5,
      kutipan_singkat: 'Fitur CRM & Blast WA ber-jeda acak menyelamatkan tim kami! Kirim 800 info promo tertarget aman tanpa kendala blokir.',
      cerita_lengkap: 'Dulu kami kesulitan memisahkan kontak pelanggan lama, pembeli VIP, dan subscriber newsletter. Modul CRM di Admin Portal otomatis menyatukan semua kontak tanpa duplikat, mengecek nomor WA mana yang masih aktif lewat API validasi, dan menjalankan broadcast bertahap di latar belakang sambil menghormati pelanggan yang memilih Opt-Out.',
      hasil_highlight: '800+ Kontak Tersinkron • 0 Nomor Terblokir',
      tanggal: '22 Okt 2026',
      terverifikasi: 'Ya',
      tampil: 'Ya'
    },
    {
      id_testimoni: 'TST-003',
      nama: 'dr. Hendra Wijaya, M.Kes',
      jabatan_perusahaan: 'Direktur Operasional • Klinik Pratama Sehat',
      avatar_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=240&q=80',
      produk_terkait: 'Bundling Setup Terima Beres & Integrasi Domain',
      rating: 5,
      kutipan_singkat: 'Sangat direkomendasikan bagi pemilik bisnis yang sibuk. Dalam 24 jam sistem katalog & pengingat otomatis kami langsung jalan!',
      cerita_lengkap: 'Saya tidak punya latar belakang coding sama sekali, namun tim teknis NusaStore menyiapkan semuanya dengan sangat rapi—mulai dari domain kustom ber-HTTPS, struktur Google Sheets, keamanan PIN Admin, hingga template pesan WhatsApp. Sesi panduannya jelas dan mudah dipahami staf administrasi kami.',
      hasil_highlight: 'Go-Live dalam 24 Jam • Staf Langsung Mahir',
      tanggal: '25 Okt 2026',
      terverifikasi: 'Ya',
      tampil: 'Ya'
    },
    {
      id_testimoni: 'TST-004',
      nama: 'Aulia Rahman',
      jabatan_perusahaan: 'CTO • EduTech Nusantara',
      avatar_url: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=240&q=80',
      produk_terkait: 'Sales Pipeline CRM & Faktur Pajak QR Engine',
      rating: 5,
      kutipan_singkat: 'Alokasi kode lisensi otomatis begitu pesanan klik Selesai benar-benar menghemat 3 jam kerja admin setiap hari.',
      cerita_lengkap: 'Kami menjual ribuan voucher akses kursus digital setiap kuartal. Dengan License Vault NusaStore, begitu pembayaran diverifikasi Lunas dan Selesai, sistem otomatis mengambil 1 kode unik dari sheet Lisensi, mencetak faktur resmi PDF dengan hash keamanan, lalu mengirimkannya ke WhatsApp siswa detik itu juga.',
      hasil_highlight: 'Hemat 3 Jam/Hari • 0 Salah Kirim Lisensi',
      tanggal: '28 Okt 2026',
      terverifikasi: 'Ya',
      tampil: 'Ya'
    },
    {
      id_testimoni: 'TST-005',
      nama: 'Meilani Putri',
      jabatan_perusahaan: 'Owner • Butik & Hampers KayuManis',
      avatar_url: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=240&q=80',
      produk_terkait: 'Cloud POS Kasir Multi-Cabang (Thermal Bluetooth)',
      rating: 5,
      kutipan_singkat: 'Tampilan galerinya mewah, pelanggan suka lihat slideshow foto produk, dan laporan omzet 3 cabang terpantau real-time dari rumah!',
      cerita_lengkap: 'Pelanggan kami sering memuji betapa halusnya tampilan katalog saat dibuka dari link bio Instagram. Di sisi belakang layar, saya bisa memantau grafik tren penjualan 30 hari, mengunduh rekap Excel rapi untuk akuntan, dan mencetak struk langsung ke printer Bluetooth 58mm.',
      hasil_highlight: '3 Cabang Real-Time • Rekap Excel 1-Klik',
      tanggal: '30 Okt 2026',
      terverifikasi: 'Ya',
      tampil: 'Ya'
    },
    {
      id_testimoni: 'TST-006',
      nama: 'Bagas Prasetyo',
      jabatan_perusahaan: 'Lead Creative • Studio PixelCraft',
      avatar_url: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=240&q=80',
      produk_terkait: 'MacBook Pro M3 Pro Workstation 14-inch Resmi',
      rating: 5,
      kutipan_singkat: 'Pengadaan 4 unit workstation untuk tim desain berjalan mulus, faktur resmi perusahaan lengkap NPWP langsung terbit otomatis.',
      cerita_lengkap: 'Untuk pembelian B2B kantor, kelengkapan dokumen pajak dan kecepatan respon sangat krusial. Tim NusaStore memberikan harga bundling terbaik, unit segel resmi iBox, dan faktur PDF ber-QR verifikasi yang langsung disetujui divisi finance kami tanpa revisi.',
      hasil_highlight: 'Pengadaan B2B Cepat • Faktur Resmi Valid',
      tanggal: '31 Okt 2026',
      terverifikasi: 'Ya',
      tampil: 'Ya'
    }
  ];

  // 36 pesanan contoh tersebar 30 hari terakhir
  const names = [
    'Budi Santoso', 'Siti Rahmawati', 'Ahmad Fauzi', 'Rian Pratama', 'Maya Angelia',
    'Dimas Bayu Aji', 'Dewi Safitri', 'Indra Kusuma', 'PT Sinar Abadi Kreatif',
    'Larasati Putri', 'Hendra Wijaya', 'Nadia Paramitha'
  ];
  const pesanan = [];
  let seed = 11;
  const rnd = function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 36; i++) {
    const daysAgo = Math.floor(Math.pow(rnd(), 1.35) * 29);
    const d = new Date(ts.getTime() - daysAgo * 86400000 - Math.floor(rnd() * 9) * 3600000);
    const p = produk[Math.floor(rnd() * produk.length)];
    const harga = effPrice_(p);
    const st = i < 4 ? 'Pending' : i < 6 ? 'Diproses' : i < 8 ? 'Batal' : i < 14 ? 'Lunas' : 'Selesai';
    const src = rnd() < 0.8 ? 'Katalog Web' : 'Input Admin (WA Chat)';
    const nm = names[i % names.length];
    const wa = '62812' + String(10000000 + (i % 12) * 7312451).slice(0, 8);
    pesanan.push({
      id_pesanan: genOrderId_(d),
      tanggal_order: d,
      nama_pelanggan: nm,
      no_whatsapp: wa,
      id_produk: p.id_produk,
      nama_produk: p.nama_produk,
      total_harga: harga,
      status_pesanan: st,
      sumber_pesanan: src,
      catatan: i % 5 === 0 ? 'Mohon dibantu panduan instalasi awal.' : '',
      link_bukti_transfer: '',
      qty: 1,
      item_json: JSON.stringify([{ id: p.id_produk, nama: p.nama_produk, qty: 1, harga: harga, subtotal: harga }]),
      metode_bayar: (st === 'Pending' || st === 'Batal') ? '' : (rnd() < 0.65 ? 'Transfer BCA' : 'QRIS'),
      kunci_lisensi: '',
      diperbarui: d,
      riwayat_status: fmtDate_(d) + ' Dibuat (' + src + ')'
    });
  }
  pesanan.sort(function (a, b) { return a.tanggal_order - b.tanggal_order; });

  const lisensi = [];
  ['PRD-001', 'PRD-003', 'PRD-005', 'PRD-008'].forEach(function (pid, k) {
    for (let j = 0; j < 5; j++) {
      lisensi.push({
        kode_lisensi: 'NUSA-' + ['PRO', 'POS', 'FNT', 'CRM'][k] + '-2026-' + acak_(5, '0123456789') + '-' + acak_(3, 'ABCDEFGHJKLMNPQRSTUVWXYZ'),
        id_produk: pid,
        status: 'Tersedia',
        id_pesanan: '',
        tanggal_alokasi: '',
        dibuat: ts
      });
    }
  });

  const crmKontak = names.slice(0, 8).map(function (nm, idx) {
    const wa = '62812' + String(10000000 + idx * 7312451).slice(0, 8);
    const slug = nm.toLowerCase().replace(/[^a-z0-9]+/g, '.');
    return {
      KontakID: 'KTK-DEMO0' + (idx + 1),
      Nama: nm,
      Email: slug + '@contohbisnis.id',
      NoWA: wa,
      Segmen: idx < 3 ? 'Pelanggan VIP' : idx < 6 ? 'Pembeli Aktif' : 'Prospek',
      Sumber: 'Pesanan',
      RefID: pesanan[idx] ? pesanan[idx].id_pesanan : '',
      Tag: idx < 3 ? 'VIP, Repeat Order' : 'Web Checkout',
      StatusWA: idx < 5 ? 'Terdaftar' : 'Belum Dicek',
      CekWAAt: idx < 5 ? fmtDate_(ts) : '',
      EmailValid: 'YA',
      OptOut: 'TIDAK',
      Catatan: idx === 0 ? 'Klien korporat prioritas, minat paket otomasi penuh.' : '',
      JumlahPesan: idx + 1,
      TerakhirDihubungi: fmtDate_(ts),
      Info: 'Sinkron otomatis dari histori pesanan',
      DibuatPada: fmtDate_(ts),
      DiperbaruiPada: fmtDate_(ts)
    };
  });

  const crmInteraksi = [
    {
      InteraksiID: 'INT-DEMO01',
      KontakID: 'KTK-DEMO01',
      Kanal: 'WA',
      Arah: 'KELUAR',
      Ringkasan: 'Pengiriman faktur resmi & kunci lisensi pesanan selesai.',
      RefID: pesanan[0] ? pesanan[0].id_pesanan : '-',
      Oleh: 'Sistem Otomatis',
      Tanggal: fmtDate_(ts)
    }
  ];

  const logwa = [{
    waktu: ts, id_pesanan: 'SETUP', nomor: '-', template: 'sistem',
    status: 'INFO', http_code: 200, message_id: '-',
    ringkasan_pesan: 'Mesin WA Fonnte & Antrean Non-Blocking siap. Simpan FONNTE_TOKEN di menu Notifikasi & CRM.'
  }];

  return {
    kategori: kategori,
    produk: produk,
    testimoni: testimoni,
    pesanan: pesanan,
    lisensi: lisensi,
    crmKontak: crmKontak,
    crmInteraksi: crmInteraksi,
    logwa: logwa
  };
}
