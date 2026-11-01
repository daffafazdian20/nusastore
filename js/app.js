/**
 * ============================================================================
 *  NusaStore v3.0 ProAPI — Frontend SPA Engine (js/app.js)
 *  Arsitektur: Static Frontend (GitHub Pages) + Google Apps Script REST API
 *
 *  Terintegrasi:
 *  - gas-pro-api       : Pure fetch GET & POST text/plain;charset=utf-8 (Bebas CORS)
 *  - gas-scale-turbo   : In-flight dedup, writeEpoch, SWR localStorage, adaptive poll
 *  - gas-notifikasi-wa-crm : Modul CRM Kontak, Saklar 2 Lapis, Antrean & Blast WA
 *  - gas-migrasi-database  : Pindai Dry-Run & Sinkronisasi Delta Database
 *  - Interactive UX    : Hero & Product Multi-Image Slideshows, Cursor Glow/Shimmer,
 *                        3D Auto-Flip Testimonials + Pop-Up, Floating WA, Lifelike Mascot
 * ============================================================================
 */
(function () {
  'use strict';

  const CFG = window.NUSASTORE_CONFIG || {};
  const RAW_GAS_URL = String(CFG.GAS_URL || '').trim();
  const IS_DEMO = !RAW_GAS_URL || RAW_GAS_URL.indexOf('GANTI_DENGAN') >= 0;

  // PIN sesi acak sekali pakai HANYA untuk Mode Pratinjau Lokal (Zero Literal Secrets!)
  const DEMO_SESSION_PIN = (function () {
    const arr = new Uint32Array(1);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(arr);
    else arr[0] = Math.floor(Math.random() * 900000);
    return String(100000 + (arr[0] % 900000));
  })();

  const LS = {
    CART: 'ns3_cart',
    WISH: 'ns3_wish',
    MY_ORDERS: 'ns3_my_orders',
    THEME: 'ns3_theme',
    PUB_CACHE: 'ns3_pub_swr',
    ADMIN_TOKEN: 'ns3_admin_token',
    ADMIN_BOOT: 'ns3_admin_boot',
    MASCOT_DOCK: 'ns3_mascot_dock'
  };

  const STATE = {
    settings: {},
    heroSlides: [],
    categories: [],
    products: [],
    testimonials: [],
    cart: loadJson(LS.CART, []),
    wish: loadJson(LS.WISH, []),
    myOrders: loadJson(LS.MY_ORDERS, []),
    filterCat: 'ALL',
    searchQuery: '',
    sortBy: 'featured',
    heroIdx: 0,
    heroHover: false,
    drawerMode: 'cart',

    // Admin State
    adminToken: sessionStorage.getItem(LS.ADMIN_TOKEN) || '',
    adminTab: 'overview',
    catalogSubTab: 'products',
    orderStatusFilter: 'ALL',
    orderSearch: '',
    chartRange: 30,
    crmSegmenFilter: 'ALL',
    crmSearch: '',
    adminData: {
      orders: [],
      licenses: [],
      waLog: [],
      testimonials: [],
      notifCrm: null,
      secrets: { fonnte: { ada: false, samar: '' } },
      meta: {},
      versions: { catalog: '1', orders: '1', crm: '1' }
    },
    lastMigrationScan: null,
    lastMs: 0,
    queueFlag: false
  };

  // ── Utilitas Dasar ──────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function loadJson(k, def) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  }
  function saveJson(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* quota */ }
  }
  function rupiah(n) {
    const x = Math.round(Number(n) || 0);
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  function effPrice(p) {
    const h = Number(p.harga) || 0, c = Number(p.harga_coret) || 0;
    return (c > 0 && c < h) ? c : h;
  }
  function normPhone(v) {
    let d = String(v || '').replace(/\D/g, '');
    if (d.indexOf('0') === 0) d = '62' + d.slice(1);
    else if (d.indexOf('8') === 0) d = '62' + d;
    return d;
  }
  function fmtDateShort(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function genClientOrderId() {
    const now = new Date();
    const ymd = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return 'ORD-' + ymd + '-' + s;
  }
  function toast(msg, type) {
    const stack = $('toast-stack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      el.style.transition = '0.25s ease';
      setTimeout(function () { el.remove(); }, 260);
    }, 3600);
  }
  function openOverlay(id) { const el = $(id); if (el) el.classList.remove('hidden'); }
  function closeOverlay(id) { const el = $(id); if (el) el.classList.add('hidden'); }

  function copyText(val, label) {
    const text = String(val || '').trim();
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast((label || 'Teks') + ' berhasil disalin!', 'ok');
      }).catch(function () {
        fallbackCopyText(text, label);
      });
    } else {
      fallbackCopyText(text, label);
    }
  }
  function fallbackCopyText(text, label) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast((label || 'Teks') + ' berhasil disalin!', 'ok'); } catch (e) { /* skip */ }
    ta.remove();
  }
  function debounce(fn, waitMs) {
    let t = null;
    return function () {
      const ctx = this, args = arguments;
      if (t) clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, waitMs);
    };
  }
  function extractDriveFileId(url) {
    const s = String(url || '').trim();
    if (!s) return '';
    const m = s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || s.match(/\/d\/([a-zA-Z0-9_-]+)/) || s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    return m ? m[1] : '';
  }
  function driveImgClient(url) {
    const s = String(url || '').trim();
    if (!s) return '';
    const id = extractDriveFileId(s);
    return id ? ('https://lh3.googleusercontent.com/d/' + id + '=w1200') : s;
  }
  function driveImgFallback(url) {
    const s = String(url || '').trim();
    if (!s) return '';
    const id = extractDriveFileId(s);
    return id ? ('https://drive.google.com/thumbnail?id=' + id + '&sz=w1200') : s;
  }
  function extractAccountDigits(str) {
    const m = String(str || '').match(/(\d[\d\s-]{6,}\d)/);
    return m ? m[1].replace(/\D/g, '') : '';
  }
  function openProofLightbox(url, title) {
    if (!url) return;
    const imgUrl = driveImgClient(url);
    const fbUrl = driveImgFallback(url);
    $('mpl-title').textContent = title || '🧾 Bukti Transfer dari Klien';
    $('mpl-body').innerHTML =
      '<div style="background:var(--surface-2);padding:12px;border-radius:12px;margin-bottom:14px;">' +
        '<img id="mpl-preview-img" src="' + esc(imgUrl) + '" data-fb="' + esc(fbUrl) + '" alt="Bukti Transfer Klien" style="max-width:100%;max-height:65vh;border-radius:10px;object-fit:contain;margin:0 auto;">' +
        '<div id="mpl-doc-fallback" style="display:none;padding:24px;color:var(--muted);font-size:0.86rem;">Berkas berupa dokumen PDF atau memerlukan pembukaan langsung di tab baru.</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">' +
        '<a href="' + esc(url) + '" target="_blank" rel="noopener" class="btn btn-primary btn-sm">🔗 Buka Bukti Asli di Tab Baru</a>' +
        '<button type="button" class="btn btn-outline btn-sm" data-close="modal-proof-lightbox">Tutup Pratinjau</button>' +
      '</div>';
    const pImg = $('mpl-preview-img');
    if (pImg) {
      pImg.onerror = function () {
        const fb = pImg.getAttribute('data-fb');
        if (fb && pImg.src !== fb) {
          pImg.src = fb;
        } else {
          pImg.style.display = 'none';
          const docFb = $('mpl-doc-fallback');
          if (docFb) docFb.style.display = 'block';
        }
      };
    }
    openOverlay('modal-proof-lightbox');
  }
  function saveMyLocalOrder(rec) {
    if (!rec || !rec.id_pesanan) return;
    const list = Array.isArray(STATE.myOrders) ? STATE.myOrders.slice() : [];
    const ix = list.findIndex(function (x) { return x.id_pesanan === rec.id_pesanan; });
    if (ix >= 0) list[ix] = Object.assign({}, list[ix], rec);
    else list.unshift(rec);
    STATE.myOrders = list.slice(0, 15);
    saveJson(LS.MY_ORDERS, STATE.myOrders);
    updateHeaderBadges();
  }

  // ── Data Simulasi Lokal (Aktif otomatis saat GAS_URL masih kosong) ──────────
  const DEMO_DB = (function buildDemoDb() {
    const U = 'https://images.unsplash.com/';
    const q = '?auto=format&fit=crop&w=900&q=75';
    const im = function (id) { return U + id + q; };

    const settings = {
      nama_toko: 'NusaStore',
      tagline: 'Enterprise Digital',
      nama_perusahaan: 'PT Nusa Digital Teknologi',
      nomor_wa_admin: '6281288009900',
      email_kontak: 'billing@nusastore.id',
      alamat_toko: 'Menara Palma Lt. 12, Jl. H. R. Rasuna Said Kav. 6-9, Kuningan, Jakarta Selatan 12920',
      npwp: '01.345.678.9-012.000',
      promo_topbar: 'Cloud Server Licensing & Web Solutions Flash Sale — Hemat hingga 45% Hari Ini!',
      hero_diskon: '25',
      flash_diskon: '30',
      rekening_bank: 'BCA 828-091-8899 a.n. PT Nusa Digital Teknologi',
      link_qris: '',
      batas_bayar_jam: '24',
      target_omzet_bulanan: '36500000',
      notif_otomatis_lunas: 'Ya',
      notif_otomatis_selesai: 'Ya',
      wa_floating_sapaan: 'Halo Kak! 👋 Ada yang bisa tim NusaStore bantu hari ini? Pilih topik cepat atau ketik langsung di bawah ya.',
      template_pesan_web: 'Halo {nama_toko}, saya ingin memesan:\n{daftar_produk}\n- Nama Pemesan: {nama}\n- No. HP: {no_wa}\n- Catatan: {catatan}\n- ID Pesanan: {id_pesanan}\nMohon info instruksi pembayaran selanjutnya. Terima kasih!',
      template_tagihan_transfer: 'Halo Kak *{nama}*, terima kasih telah memesan di {nama_toko}.\n\n*TAGIHAN PESANAN {id_pesanan}*\n{daftar_item}\nTotal Tagihan: *Rp {total}*\n\nRekening: {rekening}\nMohon kirim bukti transfer maksimal {batas_bayar_jam} jam.',
      template_tagihan_qris: 'Halo Kak *{nama}*, berikut tagihan QRIS pesanan *{id_pesanan}* senilai *Rp {total}*:\n{link_qris}',
      template_pengingat: 'Halo Kak {nama}, pengingat ramah pesanan *{id_pesanan}* senilai *Rp {total}* masih menunggu konfirmasi pembayaran.',
      template_pesan_lunas: 'Halo Kak *{nama}*, pembayaran pesanan *{id_pesanan}* (Rp {total}) telah *LUNAS*. Pesanan segera kami siapkan!',
      template_pesan_selesai: 'Halo Kak *{nama}*, pesanan *{id_pesanan}* telah *SELESAI*.\nKunci Lisensi: {kunci_lisensi}\nFaktur Resmi: {link_invoice}'
    };

    const heroSlides = [
      {
        id: 'slide-1',
        badge: 'SOLUSI DIGITAL ENTERPRISE • DISKON 25%',
        title: 'Infrastruktur Toko Digital & Otomasi WhatsApp Tanpa Biaya Server',
        subtitle: 'Bangun etalase e-commerce secepat kilat dengan database Google Sheets real-time, notifikasi Fonnte otomatis, CRM pelanggan terpadu, dan faktur resmi ber-QR.',
        ctaPrimary: 'Jelajahi Katalog',
        ctaTarget: '#products',
        ctaSecondary: 'Konsultasi Gratis',
        image: im('photo-1460925895917-afdab827c52f'),
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
        image: im('photo-1551288049-bebda4e38f71'),
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
        image: im('photo-1517336714731-489689fd1ca8'),
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
        image: im('photo-1522202176988-66273c2fd55f'),
        metricLabel: 'SLA Pengerjaan',
        metricValue: '1–2 Hari Kerja'
      }
    ];

    const categories = [
      { id_kategori: 'web-dev', nama_kategori: 'Web Development', icon_url: '💻', subjudul: 'E-Commerce & SaaS', urutan: 1 },
      { id_kategori: 'automation', nama_kategori: 'Automation Tools', icon_url: '⚡', subjudul: 'Fonnte WA & CRM', urutan: 2 },
      { id_kategori: 'business', nama_kategori: 'Business Store', icon_url: '🏪', subjudul: 'POS & Operasional', urutan: 3 },
      { id_kategori: 'hardware', nama_kategori: 'Hardware Devices', icon_url: '🖥️', subjudul: 'Laptop & Workstation', urutan: 4 },
      { id_kategori: 'gaming', nama_kategori: 'Gaming Laptops', icon_url: '🎮', subjudul: 'Performa Ekstrem', urutan: 5 },
      { id_kategori: 'jasa', nama_kategori: 'Jasa & Konsultasi', icon_url: '🎧', subjudul: 'Setup Terima Beres', urutan: 6 }
    ];

    const mkProd = function (id, nama, kat, harga, promo, photos, badge, spek, rating, ulasan, urut, desk) {
      const imgs = photos.map(im);
      return {
        id_produk: id, nama_produk: nama, kategori: kat, deskripsi: desk,
        harga: harga, harga_coret: promo, gambar_url: imgs[0], galeri_url: imgs.slice(1).join('\n'),
        images: imgs, badge_promo: badge, status_aktif: 'Aktif', spesifikasi: spek,
        rating: rating, jumlah_ulasan: ulasan, urutan: urut, diperbarui: new Date().toISOString()
      };
    };

    const products = [
      mkProd('PRD-001', 'NusaStore E-Commerce ProAPI + Fonnte CRM Suite', 'web-dev', 1999000, 1499000,
        ['photo-1460925895917-afdab827c52f', 'photo-1551288049-bebda4e38f71', 'photo-1556742049-0cfed4f6a45d', 'photo-1498050108023-c5249f4df085'],
        'Best Seller', 'Frontend GitHub Pages • REST API GAS • CRM & WA Blast', 4.9, 142, 1,
        'Template toko online fullstack generasi terbaru berbasis arsitektur terpisah (GitHub Pages + Google Apps Script REST API).\n• Database Google Sheets real-time bebas biaya sewa server\n• Checkout instan ke WhatsApp + Keranjang Belanja Pintar\n• Modul CRM Pelanggan & Broadcast WhatsApp ber-batch\n• Generator Faktur Resmi PDF ber-QR & License Vault otomatis'),
      mkProd('PRD-002', 'Bundling Setup Terima Beres & Integrasi Domain', 'jasa', 450000, 350000,
        ['photo-1522202176988-66273c2fd55f', 'photo-1531482615713-2afd69097998', 'photo-1553877522-43269d4ea984'],
        'Popular', 'SLA 1–2 Hari Kerja • Deploy GitHub Pages + GAS + Fonnte', 4.9, 78, 2,
        'Tim engineer kami memasangkan seluruh sistem sampai toko Anda siap menerima pesanan.\n• Setup backend Google Apps Script & Script Properties aman\n• Deploy frontend ke GitHub Pages + Custom Domain HTTPS\n• Konfigurasi token Fonnte & uji antrean notifikasi\n• Sesi pelatihan privat 60 menit via Google Meet'),
      mkProd('PRD-003', 'Cloud POS Kasir Multi-Cabang (Thermal Bluetooth)', 'business', 1250000, 899000,
        ['photo-1556742049-0cfed4f6a45d', 'photo-1556740738-b6a63e27c4df', 'photo-1554224155-6726b3ff858f'],
        'New Release', 'Cetak Struk 58/80mm • Laba Rugi Cabang • Offline-First', 4.8, 53, 3,
        'Aplikasi kasir modern multi-cabang dengan sinkronisasi Google Sheets.\n• Tetap jalan lancar meski sinyal internet kasir putus sementara\n• Cetak struk via Web Bluetooth ESC/POS & RawBT Android\n• Laporan omzet, HPP, dan laba bersih otomatis per outlet'),
      mkProd('PRD-004', 'MacBook Pro M3 Pro Workstation 14-inch Resmi', 'hardware', 34500000, 31999000,
        ['photo-1517336714731-489689fd1ca8', 'photo-1611186871348-b1ce696e52c9', 'photo-1541807084-5c52b6b3adef'],
        'Hot Item', '18GB Unified RAM • 512GB NVMe • Garansi Resmi iBox', 5.0, 94, 4,
        'Workstation andalan software engineer, desainer UI/UX, dan eksekutif.\n• Chip Apple M3 Pro 11-core CPU & 14-core GPU\n• Memori terpadu 18GB & penyimpanan SSD 512GB super cepat\n• Layar Liquid Retina XDR 14.2 inci ProMotion 120Hz'),
      mkProd('PRD-005', 'Fonnte WhatsApp Automation & Smart CRM Engine', 'automation', 990000, 750000,
        ['photo-1611746872915-64382b5c76da', 'photo-1563986768609-322da13575f3', 'photo-1512428559087-560fa5ceab42'],
        'Auto WA', 'Antrean Non-Blocking • Validasi Nomor WA • Anti-Banned', 4.9, 89, 5,
        'Mesin otomasi notifikasi WhatsApp & manajemen pelanggan terintegrasi.\n• Antrean pengiriman non-blocking di latar belakang\n• Blast WA massal dengan jeda acak manusiawi 3–8 detik\n• Validasi nomor WA aktif otomatis & kepatuhan Opt-Out'),
      mkProd('PRD-006', 'ASUS ROG Zephyrus G14 OLED (RTX 4060)', 'gaming', 26800000, 24499000,
        ['photo-1603302576837-37561b2e2302', 'photo-1593640408182-31c70c8268f5', 'photo-1587202372775-e229f172b9d7'],
        'Gaming Rig', 'Ryzen 9 8945HS • 16GB LPDDR5X • 1TB SSD • 3K OLED', 4.9, 65, 6,
        'Laptop kreator & gaming ultra-ringkas dengan layar Nebula OLED 3K.\n• Prosesor AMD Ryzen 9 8945HS dengan Ryzen AI\n• GPU NVIDIA GeForce RTX 4060 8GB GDDR6\n• Sasis aluminium CNC ringan 1.5 kg, garansi resmi 2 tahun'),
      mkProd('PRD-008', 'Sales Pipeline CRM & Faktur Pajak QR Engine', 'automation', 850000, 650000,
        ['photo-1551288049-bebda4e38f71', 'photo-1454165804606-c3d57bc86b40', 'photo-1543286386-713bdd548da4'],
        'CRM Suite', 'Pipeline Sheets • Faktur PDF HMAC • Auto Follow-Up', 4.9, 96, 7,
        'Kelola prospek B2B hingga penagihan lunas dalam satu dashboard.\n• Pelacakan interaksi telepon, email, dan WhatsApp pelanggan\n• Pembuatan faktur PDF resmi lengkap tanda tangan QR\n• Pengingat jatuh tempo otomatis H-3 dan H-0'),
      mkProd('PRD-011', 'Printer Struk Thermal Bluetooth 58mm Portable', 'hardware', 350000, 285000,
        ['photo-1612815154858-60aa4c59eaa6', 'photo-1556742049-0cfed4f6a45d', 'photo-1586880244406-556ebe35f282'],
        'Hemat 19%', 'Bluetooth + USB • Baterai 1500mAh • Support Android/Web', 4.7, 44, 8,
        'Printer thermal ringkas untuk kasir toko, kurir, dan loket pembayaran.\n• Cetak cepat tanpa tinta di kertas thermal 58mm\n• Kompatibel langsung dengan Web Bluetooth Chrome & RawBT')
    ];

    const testimonials = [
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

    const names = ['Budi Santoso', 'Siti Rahmawati', 'Ahmad Fauzi', 'Rian Pratama', 'Maya Angelia', 'Dimas Bayu Aji', 'Dewi Safitri', 'PT Sinar Abadi Kreatif'];
    const orders = [];
    for (let i = 0; i < 24; i++) {
      const p = products[i % products.length];
      const h = effPrice(p);
      const d = new Date(Date.now() - (23 - i) * 86400000);
      const st = i > 20 ? 'Pending' : i === 19 ? 'Diproses' : i > 15 ? 'Lunas' : 'Selesai';
      orders.push({
        id_pesanan: 'ORD-202610' + String(10 + (i % 19)).padStart(2, '0') + '-DM' + String(i + 10),
        tanggal_order: d.toISOString(),
        nama_pelanggan: names[i % names.length],
        no_whatsapp: '62812800010' + String(i).padStart(2, '0'),
        id_produk: p.id_produk,
        nama_produk: p.nama_produk,
        total_harga: h,
        status_pesanan: st,
        sumber_pesanan: i % 4 === 0 ? 'Input Admin (WA Chat)' : 'Katalog Web',
        catatan: '',
        link_bukti_transfer: '',
        qty: 1,
        item_json: JSON.stringify([{ id: p.id_produk, nama: p.nama_produk, qty: 1, harga: h, subtotal: h }]),
        metode_bayar: st === 'Pending' ? '' : 'Transfer BCA',
        kunci_lisensi: st === 'Selesai' ? 'NUSA-PRO-2026-88412-XYZ' : '',
        diperbarui: d.toISOString(),
        riwayat_status: fmtDateShort(d.toISOString()) + ' Dibuat • ' + st,
        invoiceSig: 'DEMO99A1B2C3'
      });
    }

    const contacts = names.map(function (nm, idx) {
      return {
        KontakID: 'KTK-DM0' + (idx + 1),
        Nama: nm,
        Email: nm.toLowerCase().replace(/[^a-z0-9]+/g, '.') + '@bisnis.id',
        NoWA: '628128000100' + idx,
        Segmen: idx < 3 ? 'Pelanggan VIP' : idx < 6 ? 'Pembeli Aktif' : 'Prospek',
        Sumber: 'Pesanan',
        RefID: orders[idx].id_pesanan,
        Tag: idx < 3 ? 'VIP, Repeat Order' : 'Checkout Web',
        StatusWA: idx < 5 ? 'Terdaftar' : 'Belum Dicek',
        CekWAAt: idx < 5 ? '2026-10-31 14:00' : '',
        EmailValid: 'YA',
        OptOut: 'TIDAK',
        Catatan: idx === 0 ? 'Pelanggan prioritas korporat.' : '',
        JumlahPesan: idx + 1,
        TerakhirDihubungi: '2026-10-31 15:20',
        Info: '3 pesanan • Total Rp ' + rupiah(orders[idx].total_harga * 3)
      };
    });

    const licenses = [
      { kode_lisensi: 'NUSA-PRO-2026-99120-KLM', id_produk: 'PRD-001', status: 'Tersedia', id_pesanan: '', dibuat: new Date().toISOString() },
      { kode_lisensi: 'NUSA-PRO-2026-77341-QWE', id_produk: 'PRD-001', status: 'Tersedia', id_pesanan: '', dibuat: new Date().toISOString() },
      { kode_lisensi: 'NUSA-FNT-2026-55210-RTY', id_produk: 'PRD-005', status: 'Tersedia', id_pesanan: '', dibuat: new Date().toISOString() }
    ];

    const notifCrm = {
      config: {
        waAktif: true,
        emailAktif: true,
        emailQuota: 98,
        antrianAda: false,
        fonnteAda: false,
        fonnteSamar: '',
        matriks: {
          PESANAN_BARU: { label: 'Pesanan Baru Masuk (Checkout Web)', wa: true, email: true },
          TAGIHAN_TERBIT: { label: 'Tagihan / Instruksi Pembayaran', wa: true, email: true },
          PEMBAYARAN_LUNAS: { label: 'Konfirmasi Pembayaran Lunas', wa: true, email: true },
          PESANAN_SELESAI: { label: 'Pesanan Selesai + Lisensi & Faktur', wa: true, email: true },
          PENGINGAT_BAYAR: { label: 'Pengingat Pembayaran Jatuh Tempo', wa: true, email: false }
        }
      },
      queueStats: { total: 2, waiting: 0, sent: 2, failed: 0 },
      queueRecent: [
        { AntrianID: 'Q-DEMO01', Kanal: 'WA', Tujuan: '6281280001000', NamaPenerima: 'Budi Santoso', Event: 'PESANAN_SELESAI', Status: 'TERKIRIM', Percobaan: 1, Respon: 'Terkirim (simulasi)', DibuatPada: '2026-10-31 15:10' },
        { AntrianID: 'Q-DEMO02', Kanal: 'EMAIL', Tujuan: 'budi.santoso@bisnis.id', NamaPenerima: 'Budi Santoso', Event: 'PESANAN_SELESAI', Status: 'TERKIRIM', Percobaan: 1, Respon: 'Email terkirim', DibuatPada: '2026-10-31 15:10' }
      ],
      blasts: [
        { BlastID: 'BL-20261030-A1B2', Judul: 'Promo Flash Bundling Akhir Bulan', Sasaran: 'Pelanggan VIP', Total: 28, Terkirim: 28, Gagal: 0, UkuranBatch: 20, JedaDetik: 4, Status: 'SELESAI', Tanggal: '2026-10-30 10:00' }
      ],
      contacts: contacts,
      interactions: [
        { InteraksiID: 'INT-DM01', KontakID: 'KTK-DM01', Kanal: 'WA', Arah: 'KELUAR', Ringkasan: 'Pengiriman faktur resmi & lisensi otomatis.', RefID: orders[0].id_pesanan, Oleh: 'Sistem', Tanggal: '2026-10-31 15:10' }
      ]
    };

    const waLog = [
      { waktu: new Date().toISOString(), id_pesanan: orders[0].id_pesanan, nomor: '6281280001000', template: 'pesanan_selesai', status: 'TERKIRIM', http_code: 200, ringkasan_pesan: 'Halo Kak Budi Santoso, pesanan telah SELESAI...' }
    ];

    return { settings: settings, heroSlides: heroSlides, categories: categories, products: products, testimonials: testimonials, orders: orders, licenses: licenses, notifCrm: notifCrm, waLog: waLog };
  })();

  // ── Klien REST API Murni (gas-pro-api + gas-scale-turbo) ───────────────────
  const _inflight = new Map();
  let _writeEpoch = 0;

  function isReadOnlyAction(action) {
    return ['getPublicData', 'ping', 'trackPublicOrder', 'adminBootstrap', 'adminSync', 'adminNotifCrmBootstrap', 'adminFonnteStatus', 'adminCrmGetInteractions'].indexOf(action) >= 0;
  }

  async function apiCall(action, payload, method) {
    payload = payload || {};
    const useGet = method === 'GET' && !IS_DEMO;
    const dedupKey = action + ':' + JSON.stringify(payload);

    if (isReadOnlyAction(action) && _inflight.has(dedupKey)) {
      return _inflight.get(dedupKey);
    }
    if (!isReadOnlyAction(action)) _writeEpoch++;
    const reqEpoch = _writeEpoch;

    const promise = (async function () {
      const t0 = performance.now();
      if (IS_DEMO) {
        const sim = await handleDemoApi(action, payload);
        STATE.lastMs = Math.max(2, Math.round(performance.now() - t0));
        updateTelemetryBar();
        return sim;
      }

      let resp;
      if (useGet) {
        const url = new URL(RAW_GAS_URL);
        url.searchParams.set('action', action);
        Object.keys(payload).forEach(function (k) { url.searchParams.set(k, String(payload[k])); });
        resp = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
      } else {
        // Penting (gas-pro-api): text/plain;charset=utf-8 mencegah preflight OPTIONS CORS!
        const bodyObj = Object.assign({ action: action }, payload);
        if (STATE.adminToken && !bodyObj.token) bodyObj.token = STATE.adminToken;
        resp = await fetch(RAW_GAS_URL, {
          method: 'POST',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(bodyObj)
        });
      }

      const json = await resp.json();
      STATE.lastMs = json.ms !== undefined ? json.ms : Math.round(performance.now() - t0);
      STATE.queueFlag = !!json.nq;
      if (json.v && reqEpoch === _writeEpoch) {
        STATE.adminData.versions = json.v;
      }
      updateTelemetryBar();

      if (!json.success && json.code === 'AUTH') {
        STATE.adminToken = '';
        sessionStorage.removeItem(LS.ADMIN_TOKEN);
        toast('Sesi Admin berakhir. Silakan masuk kembali.', 'err');
        openOverlay('modal-admin-login');
      }
      return json;
    })();

    if (isReadOnlyAction(action)) {
      _inflight.set(dedupKey, promise);
      promise.finally(function () { _inflight.delete(dedupKey); });
    }
    return promise;
  }

  // Handler Simulasi Lokal Lengkap agar 100% fitur berjalan walau belum deploy GAS
  async function handleDemoApi(action, b) {
    await new Promise(function (r) { setTimeout(r, 110); });
    const ok = function (d, m) { return { success: true, data: d, message: m || 'OK (Simulasi Lokal)' }; };
    const fail = function (m, extra) { return Object.assign({ success: false, data: null, message: m }, extra || {}); };

    switch (action) {
      case 'getPublicData':
        return ok({
          v: 'demo-1',
          settings: DEMO_DB.settings,
          heroSlides: DEMO_DB.heroSlides,
          categories: DEMO_DB.categories,
          products: DEMO_DB.products.filter(function (p) { return p.status_aktif === 'Aktif'; }),
          testimonials: DEMO_DB.testimonials.filter(function (t) { return t.tampil === 'Ya'; })
        });
      case 'submitPublicOrder': {
        const p = b.payload || b;
        const id = p.id || genClientOrderId();
        let total = 0;
        const built = (p.items || []).map(function (it) {
          const pr = DEMO_DB.products.find(function (x) { return x.id_produk === it.id; }) || DEMO_DB.products[0];
          const h = effPrice(pr);
          total += h * (it.qty || 1);
          return { id: pr.id_produk, nama: pr.nama_produk, qty: it.qty || 1, harga: h, subtotal: h * (it.qty || 1) };
        });
        const rec = {
          id_pesanan: id, tanggal_order: new Date().toISOString(), nama_pelanggan: p.nama,
          no_whatsapp: normPhone(p.wa), id_produk: built.map(function (i) { return i.id; }).join(', '),
          nama_produk: built.map(function (i) { return i.nama; }).join('; '), total_harga: total,
          status_pesanan: 'Pending', sumber_pesanan: 'Katalog Web', catatan: p.catatan || '',
          qty: built.length, item_json: JSON.stringify(built), metode_bayar: '', kunci_lisensi: '',
          riwayat_status: fmtDateShort(new Date().toISOString()) + ' Dibuat (Katalog Web)', invoiceSig: 'DEMOSIG88'
        };
        DEMO_DB.orders.push(rec);
        return ok({
          id: id,
          total: total,
          items: built,
          invoiceSig: 'DEMOSIG88',
          paymentInfo: {
            rekening_bank: DEMO_DB.settings.rekening_bank,
            link_qris: DEMO_DB.settings.link_qris,
            batas_bayar_jam: DEMO_DB.settings.batas_bayar_jam,
            nama_toko: DEMO_DB.settings.nama_toko,
            nama_perusahaan: DEMO_DB.settings.nama_perusahaan,
            alamat_toko: DEMO_DB.settings.alamat_toko,
            npwp: DEMO_DB.settings.npwp,
            nomor_wa_admin: DEMO_DB.settings.nomor_wa_admin
          }
        }, 'Pesanan tercatat (Simulasi Lokal).');
      }
      case 'trackPublicOrder': {
        const p = b.payload || b;
        const wa = normPhone(p.wa);
        const oid = String(p.orderId || '').trim().toUpperCase();
        const matched = DEMO_DB.orders.filter(function (o) {
          if (normPhone(o.no_whatsapp) !== wa) return false;
          if (oid && String(o.id_pesanan).toUpperCase() !== oid) return false;
          return true;
        }).slice().reverse().map(function (o) {
          return Object.assign({}, o, { has_bukti: !!o.link_bukti_transfer });
        });
        return ok({
          orders: matched,
          paymentInfo: {
            rekening_bank: DEMO_DB.settings.rekening_bank,
            link_qris: DEMO_DB.settings.link_qris,
            batas_bayar_jam: DEMO_DB.settings.batas_bayar_jam,
            nama_toko: DEMO_DB.settings.nama_toko,
            nama_perusahaan: DEMO_DB.settings.nama_perusahaan,
            alamat_toko: DEMO_DB.settings.alamat_toko,
            npwp: DEMO_DB.settings.npwp,
            nomor_wa_admin: DEMO_DB.settings.nomor_wa_admin
          }
        }, matched.length ? (matched.length + ' pesanan ditemukan.') : 'Pesanan belum ditemukan.');
      }
      case 'uploadPublicPaymentProof': {
        const p = b.payload || b;
        const ord = DEMO_DB.orders.find(function (o) {
          return String(o.id_pesanan).toUpperCase() === String(p.orderId || '').toUpperCase() && normPhone(o.no_whatsapp) === normPhone(p.wa);
        });
        if (!ord) return fail('Pesanan tidak ditemukan atau Nomor WA tidak cocok.');
        ord.link_bukti_transfer = 'data:' + (p.mime || 'image/png') + ';base64,' + (p.base64 || '');
        ord.metode_bayar = p.metode_bayar || 'Transfer Bank';
        ord.riwayat_status = (ord.riwayat_status ? ord.riwayat_status + '; ' : '') + fmtDateShort(new Date().toISOString()) + ' Bukti bayar diunggah pelanggan (' + ord.metode_bayar + ')';
        return ok({ order: Object.assign({}, ord, { has_bukti: true }) }, 'Bukti pembayaran berhasil diterima (Simulasi)!');
      }
      case 'subscribeNewsletter':
        return ok(null, 'Berhasil berlangganan newsletter NusaStore!');
      case 'submitPublicTestimonial': {
        const t = b.payload || b;
        DEMO_DB.testimonials.unshift({
          id_testimoni: 'TST-' + Date.now().toString(36).toUpperCase(),
          nama: t.nama, jabatan_perusahaan: t.jabatan_perusahaan || 'Pelanggan NusaStore',
          avatar_url: '', produk_terkait: t.produk_terkait || 'NusaStore',
          rating: Number(t.rating) || 5, kutipan_singkat: t.kutipan_singkat,
          cerita_lengkap: t.cerita_lengkap || t.kutipan_singkat,
          hasil_highlight: t.hasil_highlight || 'Ulasan Baru', tanggal: 'Baru saja',
          terverifikasi: 'Ya', tampil: 'Ya'
        });
        return ok(null, 'Terima kasih! Ulasan Anda langsung ditampilkan pada mode pratinjau.');
      }
      case 'adminLogin': {
        if (String(b.pin) !== DEMO_SESSION_PIN) {
          return fail('PIN Simulasi salah. Gunakan PIN Sesi Uji di pita atas halaman: ' + DEMO_SESSION_PIN);
        }
        return ok({
          token: 'demo-token-' + Date.now(),
          exp: Date.now() + 8 * 3600e3,
          boot: {
            settings: DEMO_DB.settings,
            heroSlides: DEMO_DB.heroSlides,
            categories: DEMO_DB.categories,
            products: DEMO_DB.products,
            testimonials: DEMO_DB.testimonials,
            orders: DEMO_DB.orders,
            licenses: DEMO_DB.licenses,
            waLog: DEMO_DB.waLog,
            notifCrm: DEMO_DB.notifCrm,
            versions: { catalog: '1', orders: '1', crm: '1' },
            secrets: { fonnte: { ada: !!DEMO_DB.notifCrm.config.fonnteAda, samar: DEMO_DB.notifCrm.config.fonnteSamar } },
            meta: { spreadsheetName: 'Database_NusaStore (Mode Simulasi Lokal)', appVersion: '3.0.0' }
          }
        }, 'Berhasil masuk Admin Portal (Mode Simulasi).');
      }
      case 'adminEmergencyLogin':
        return fail('Mode darurat hanya aktif setelah dihubungkan ke Google Apps Script.');
      case 'adminBootstrap':
        return ok({
          settings: DEMO_DB.settings, heroSlides: DEMO_DB.heroSlides, categories: DEMO_DB.categories,
          products: DEMO_DB.products, testimonials: DEMO_DB.testimonials, orders: DEMO_DB.orders,
          licenses: DEMO_DB.licenses, waLog: DEMO_DB.waLog, notifCrm: DEMO_DB.notifCrm,
          versions: { catalog: '1', orders: '1', crm: '1' },
          secrets: { fonnte: { ada: !!DEMO_DB.notifCrm.config.fonnteAda, samar: DEMO_DB.notifCrm.config.fonnteSamar } },
          meta: { spreadsheetName: 'Database_NusaStore (Simulasi)', appVersion: '3.0.0' }
        });
      case 'adminSync':
        return ok({ versions: { catalog: '1', orders: '1', crm: '1' } });
      case 'adminSaveProduct': {
        const p = b.product;
        const imgs = [p.gambar_url].concat(String(p.galeri_url || '').split(/[\r\n|,]+/)).map(function (s) { return s.trim(); }).filter(Boolean);
        p.images = imgs;
        p.gambar_url = imgs[0] || '';
        const idx = DEMO_DB.products.findIndex(function (x) { return x.id_produk === p.id_produk; });
        if (idx >= 0) DEMO_DB.products[idx] = Object.assign({}, DEMO_DB.products[idx], p);
        else { p.id_produk = 'PRD-0' + (DEMO_DB.products.length + 12); DEMO_DB.products.unshift(p); }
        return ok(p, 'Produk berhasil disimpan.');
      }
      case 'adminDeleteProduct':
        DEMO_DB.products = DEMO_DB.products.filter(function (x) { return x.id_produk !== b.id; });
        return ok({ id: b.id }, 'Produk dihapus.');
      case 'adminSaveCategory': {
        const c = b.category;
        if (!c.id_kategori) c.id_kategori = c.nama_kategori.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const idx = DEMO_DB.categories.findIndex(function (x) { return x.id_kategori === (c.original_id || c.id_kategori); });
        if (idx >= 0) DEMO_DB.categories[idx] = c; else DEMO_DB.categories.push(c);
        return ok(c, 'Kategori disimpan.');
      }
      case 'adminDeleteCategory':
        DEMO_DB.categories = DEMO_DB.categories.filter(function (x) { return x.id_kategori !== b.id; });
        return ok({ id: b.id }, 'Kategori dihapus.');
      case 'adminSaveTestimonial': {
        const t = b.testimonial;
        if (!t.id_testimoni) t.id_testimoni = 'TST-' + Math.floor(100 + Math.random() * 899);
        const idx = DEMO_DB.testimonials.findIndex(function (x) { return x.id_testimoni === t.id_testimoni; });
        if (idx >= 0) DEMO_DB.testimonials[idx] = t; else DEMO_DB.testimonials.unshift(t);
        return ok(t, 'Testimoni disimpan.');
      }
      case 'adminDeleteTestimonial':
        DEMO_DB.testimonials = DEMO_DB.testimonials.filter(function (x) { return x.id_testimoni !== b.id; });
        return ok({ id: b.id }, 'Testimoni dihapus.');
      case 'adminCreateOrder': {
        const o = b.order;
        const id = genClientOrderId();
        const pr = DEMO_DB.products.find(function (x) { return x.id_produk === o.items[0].id; }) || DEMO_DB.products[0];
        const total = Number(o.total) || effPrice(pr) * (o.items[0].qty || 1);
        const rec = {
          id_pesanan: id, tanggal_order: new Date().toISOString(), nama_pelanggan: o.nama,
          no_whatsapp: normPhone(o.wa), id_produk: pr.id_produk, nama_produk: pr.nama_produk,
          total_harga: total, status_pesanan: o.status || 'Pending', sumber_pesanan: o.sumber || 'Input Admin (WA Chat)',
          catatan: o.catatan || '', qty: o.items[0].qty || 1, metode_bayar: o.metode_bayar || '',
          kunci_lisensi: '', riwayat_status: 'Dibuat manual oleh Admin', invoiceSig: 'DEMOSIG99'
        };
        DEMO_DB.orders.push(rec);
        return ok({ order: rec }, 'Pesanan manual berhasil disimpan.');
      }
      case 'adminUpdateOrder': {
        const ord = DEMO_DB.orders.find(function (x) { return x.id_pesanan === b.id; });
        if (!ord) return fail('Pesanan tidak ditemukan.');
        Object.assign(ord, b.patch);
        if (b.patch.status_pesanan === 'Selesai' && !ord.kunci_lisensi) {
          const lic = DEMO_DB.licenses.find(function (l) { return l.status === 'Tersedia'; });
          if (lic) { lic.status = 'Terpakai'; lic.id_pesanan = ord.id_pesanan; ord.kunci_lisensi = lic.kode_lisensi; }
        }
        return ok({ order: ord }, 'Pesanan diperbarui.');
      }
      case 'adminDeleteOrder':
        DEMO_DB.orders = DEMO_DB.orders.filter(function (x) { return x.id_pesanan !== b.id; });
        return ok({ id: b.id }, 'Pesanan dihapus.');
      case 'adminSendWa':
        DEMO_DB.waLog.unshift({ waktu: new Date().toISOString(), id_pesanan: b.orderId, nomor: '62812xxx', template: b.templateKey, status: 'TERKIRIM', http_code: 200, ringkasan_pesan: 'Simulasi kirim WA Fonnte berhasil.' });
        return ok({ ok: true }, 'Pesan WA terkirim (Simulasi).');
      case 'adminAddLicenses': {
        const codes = String(b.codes || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        codes.forEach(function (c) { DEMO_DB.licenses.push({ kode_lisensi: c, id_produk: b.productId, status: 'Tersedia', id_pesanan: '', dibuat: new Date().toISOString() }); });
        return ok({ added: codes.length, licenses: DEMO_DB.licenses }, codes.length + ' lisensi ditambahkan.');
      }
      case 'adminDeleteLicense':
        DEMO_DB.licenses = DEMO_DB.licenses.filter(function (x) { return x.kode_lisensi !== b.code; });
        return ok({ code: b.code }, 'Lisensi dihapus.');
      case 'adminSaveSettings':
        Object.assign(DEMO_DB.settings, b.settings || {});
        if (b.settings && b.settings.hero_slides_json) {
          try { DEMO_DB.heroSlides = JSON.parse(b.settings.hero_slides_json); } catch (e) { /* skip */ }
        }
        return ok({ settings: DEMO_DB.settings, heroSlides: DEMO_DB.heroSlides }, 'Pengaturan disimpan.');
      case 'adminSaveSecret':
        DEMO_DB.notifCrm.config.fonnteAda = b.value !== '__HAPUS__';
        DEMO_DB.notifCrm.config.fonnteSamar = b.value === '__HAPUS__' ? '' : String(b.value).slice(0, 4) + '••••••' + String(b.value).slice(-3);
        return ok({ ada: DEMO_DB.notifCrm.config.fonnteAda, samar: DEMO_DB.notifCrm.config.fonnteSamar }, 'Token disimpan (Simulasi).');
      case 'adminFonnteStatus':
        return ok({ ada: DEMO_DB.notifCrm.config.fonnteAda, samar: DEMO_DB.notifCrm.config.fonnteSamar, device: { ok: true, status: 'connect', nomor: '6281288009900', nama: 'NusaStore Gateway', kuota: '9.840' } });
      case 'adminTestFonnte':
        return ok({ ok: true }, 'Pesan uji Fonnte terkirim (Simulasi).');
      case 'adminSaveNotifConfig':
        Object.assign(DEMO_DB.notifCrm.config, b.config || {});
        return ok(DEMO_DB.notifCrm.config, 'Konfigurasi saklar & matriks disimpan.');
      case 'adminDrainNotifQueue':
        DEMO_DB.notifCrm.queueRecent.forEach(function (q) { q.Status = 'TERKIRIM'; q.Respon = 'Terkirim (simulasi)'; });
        DEMO_DB.notifCrm.queueStats.waiting = 0;
        return ok({ result: { sent: 2, failed: 0, remaining: 0 }, snapshot: DEMO_DB.notifCrm }, 'Antrean berhasil dikuras.');
      case 'adminClearDoneQueue':
        DEMO_DB.notifCrm.queueRecent = DEMO_DB.notifCrm.queueRecent.filter(function (q) { return q.Status === 'MENUNGGU'; });
        return ok({ snapshot: DEMO_DB.notifCrm }, 'Riwayat antrean dibersihkan.');
      case 'adminCreateBlast': {
        const bl = b.blast || {};
        const total = DEMO_DB.notifCrm.contacts.filter(function (k) { return k.OptOut !== 'YA'; }).length;
        const rec = { BlastID: 'BL-SIM-' + Math.floor(100 + Math.random() * 899), Judul: bl.judul, Sasaran: bl.segmen || 'SEMUA', Total: total, Terkirim: 0, Gagal: 0, UkuranBatch: bl.ukuranBatch || 20, JedaDetik: bl.jedaDetik || 4, Status: 'MENUNGGU', Tanggal: fmtDateShort(new Date().toISOString()) };
        DEMO_DB.notifCrm.blasts.unshift(rec);
        DEMO_DB.notifCrm.queueStats.waiting += total;
        return ok({ blast: rec, queued: total, snapshot: DEMO_DB.notifCrm }, 'Blast WA dijadwalkan untuk ' + total + ' kontak.');
      }
      case 'adminControlBlast': {
        const target = DEMO_DB.notifCrm.blasts.find(function (x) { return x.BlastID === b.blastId; });
        if (target) target.Status = b.command === 'JEDA' ? 'DIJEDA' : b.command === 'LANJUT' ? 'BERJALAN' : 'DIHENTIKAN';
        return ok({ snapshot: DEMO_DB.notifCrm }, 'Status kampanye diperbarui.');
      }
      case 'adminValidateWaNumbers':
        DEMO_DB.notifCrm.contacts.forEach(function (k) { k.StatusWA = 'Terdaftar'; k.CekWAAt = 'Baru saja'; });
        return ok({ checked: DEMO_DB.notifCrm.contacts.length, registered: DEMO_DB.notifCrm.contacts.length, snapshot: DEMO_DB.notifCrm }, 'Seluruh nomor tervalidasi aktif (Simulasi).');
      case 'adminCrmSync':
        return ok({ stats: { added: 2, updated: 6 }, snapshot: DEMO_DB.notifCrm }, 'Sinkronisasi CRM berhasil (Simulasi).');
      case 'adminCrmSaveContact': {
        const c = b.contact;
        if (!c.KontakID) { c.KontakID = 'KTK-SM' + Math.floor(10 + Math.random() * 89); c.StatusWA = 'Belum Dicek'; c.OptOut = c.OptOut || 'TIDAK'; DEMO_DB.notifCrm.contacts.unshift(c); }
        else {
          const ix = DEMO_DB.notifCrm.contacts.findIndex(function (x) { return x.KontakID === c.KontakID; });
          if (ix >= 0) Object.assign(DEMO_DB.notifCrm.contacts[ix], c);
        }
        return ok({ snapshot: DEMO_DB.notifCrm }, 'Kontak disimpan.');
      }
      case 'adminCrmDeleteContact':
        DEMO_DB.notifCrm.contacts = DEMO_DB.notifCrm.contacts.filter(function (x) { return x.KontakID !== b.kontakId; });
        return ok({ snapshot: DEMO_DB.notifCrm }, 'Kontak dihapus.');
      case 'adminCrmToggleOptOut': {
        const ct = DEMO_DB.notifCrm.contacts.find(function (x) { return x.KontakID === b.kontakId; });
        if (ct) ct.OptOut = b.optOut ? 'YA' : 'TIDAK';
        return ok({ snapshot: DEMO_DB.notifCrm }, 'Status Opt-Out diperbarui.');
      }
      case 'adminCrmMergeDuplicates':
        return ok({ merged: 0, snapshot: DEMO_DB.notifCrm }, 'Tidak ditemukan kontak duplikat.');
      case 'adminCrmAddInteraction': {
        const it = b.interaction;
        it.InteraksiID = 'INT-' + Date.now().toString(36).toUpperCase();
        it.Tanggal = fmtDateShort(new Date().toISOString());
        it.Oleh = 'Admin';
        DEMO_DB.notifCrm.interactions.unshift(it);
        return ok({ snapshot: DEMO_DB.notifCrm }, 'Interaksi pelanggan dicatat.');
      }
      case 'adminCrmGetInteractions':
        return ok(DEMO_DB.notifCrm.interactions.filter(function (i) { return i.KontakID === b.kontakId; }));
      case 'adminMigrateScan':
        return ok({
          mode: 'DRY_RUN',
          sourceName: 'Database_NusaStore_v2.4 (Simulasi Pratinjau)',
          sourceId: b.sourceIdOrUrl || '1AbCdEfGhIjKlMnOpQrStUvWxYz',
          summary: { toInsert: 19, toUpdate: 4, unchanged: 38 },
          reports: [
            { sheet: 'Kategori', existsInSource: true, sourceCount: 6, inserted: 0, updated: 0, skipped: 6, samples: [] },
            { sheet: 'Produk', existsInSource: true, sourceCount: 13, inserted: 3, updated: 2, skipped: 8, samples: [{ key: 'PRD-029', action: 'BARU', label: 'Webhook Notifikasi WhatsApp' }] },
            { sheet: 'Pesanan', existsInSource: true, sourceCount: 42, inserted: 16, updated: 2, skipped: 24, samples: [{ key: 'ORD-20261029-AB12', action: 'BARU', label: 'Indra Kusuma' }] },
            { sheet: 'Lisensi', existsInSource: true, sourceCount: 16, inserted: 0, updated: 0, skipped: 16, samples: [] },
            { sheet: 'Log_WA', existsInSource: true, sourceCount: 12, inserted: 0, updated: 0, skipped: 12, samples: [] }
          ]
        }, 'Pemindaian Dry-Run selesai (Simulasi).');
      case 'adminMigrateExecute':
        return ok({
          mode: 'EXECUTED',
          sourceName: 'Database_NusaStore_v2.4',
          summary: { inserted: 19, updated: 4, skipped: 38 },
          reports: []
        }, 'Sinkronisasi berhasil: 19 baris baru disalin tanpa menyentuh aplikasi lama!');
      case 'adminClearCache':
        return ok({}, 'Cache disegarkan.');
      case 'adminInvoicePdf':
        return ok({ url: '#simulasi-pdf' }, 'Pada mode produksi, PDF tersimpan otomatis ke Google Drive.');
      default:
        return ok({}, 'Aksi simulasi selesai.');
    }
  }

  // ── Render Storefront & Hero Auto-Slideshow ─────────────────────────────────
  let heroTimer = null;
  let productSlideshowTimer = null;
  let _lastPublicDataSig = '';

  function applyPublicData(data) {
    if (!data) return;
    try {
      const sig = JSON.stringify({
        s: data.settings,
        h: data.heroSlides,
        c: data.categories,
        p: data.products,
        t: data.testimonials
      });
      if (sig === _lastPublicDataSig) return;
      _lastPublicDataSig = sig;
    } catch (e) { /* lanjut render */ }
    STATE.settings = Object.assign({}, STATE.settings, data.settings || {});
    STATE.heroSlides = Array.isArray(data.heroSlides) && data.heroSlides.length ? data.heroSlides : DEMO_DB.heroSlides;
    STATE.categories = Array.isArray(data.categories) ? data.categories : [];
    STATE.products = (Array.isArray(data.products) ? data.products : []).map(function (p) {
      if (!Array.isArray(p.images) || !p.images.length) {
        p.images = [p.gambar_url].concat(String(p.galeri_url || '').split(/[\r\n|,]+/)).map(function (u) { return String(u || '').trim(); }).filter(Boolean);
      }
      return p;
    });
    STATE.testimonials = Array.isArray(data.testimonials) ? data.testimonials : [];

    // Branding & teks dinamis
    const st = STATE.settings;
    if ($('ui-promo-topbar')) $('ui-promo-topbar').textContent = st.promo_topbar || '';
    if ($('ui-brand-name')) $('ui-brand-name').textContent = st.nama_toko || 'NusaStore';
    if ($('ui-brand-tagline')) $('ui-brand-tagline').textContent = st.tagline || 'Enterprise Digital';
    if ($('ui-flash-diskon')) $('ui-flash-diskon').textContent = st.flash_diskon || '30';
    if ($('ft-brand-name')) $('ft-brand-name').textContent = st.nama_toko || 'NusaStore';
    if ($('ft-company-name')) $('ft-company-name').textContent = st.nama_perusahaan || '';
    if ($('ft-copy-company')) $('ft-copy-company').textContent = st.nama_perusahaan || st.nama_toko || 'NusaStore';
    if ($('ft-year')) $('ft-year').textContent = String(new Date().getFullYear());
    if ($('ft-contact-info')) {
      $('ft-contact-info').innerHTML = 'WhatsApp CS: +' + esc(st.nomor_wa_admin || '') + '<br>Email: ' + esc(st.email_kontak || '');
    }
    if ($('wa-greeting-text') && st.wa_floating_sapaan) {
      $('wa-greeting-text').textContent = st.wa_floating_sapaan;
    }

    renderHeroSlideshow();
    renderCategories();
    renderCatalog();
    renderTestimonials();
    populateTestiProductSelect();
    updateHeaderBadges();
  }

  function renderHeroSlideshow() {
    const host = $('hero-slides-host');
    const dots = $('hero-dots');
    if (!host || !dots) return;
    const slides = STATE.heroSlides;
    if (STATE.heroIdx >= slides.length) STATE.heroIdx = 0;

    const diskon = STATE.settings.hero_diskon || '25';
    host.innerHTML = slides.map(function (s, idx) {
      return '<div class="hero-slide ' + (idx === STATE.heroIdx ? 'is-active' : '') + '" data-slide-idx="' + idx + '">' +
        '<div>' +
          '<div class="hero-pill">✨ ' + esc(s.badge || 'SOLUSI DIGITAL ENTERPRISE') + '</div>' +
          '<h1 class="hero-title">' + esc(s.title) + '</h1>' +
          '<p class="hero-sub">' + esc(s.subtitle) + '</p>' +
          '<div class="hero-cta-row">' +
            '<button type="button" class="btn btn-primary btn-lg btn-shimmer hero-cta-primary" data-target="' + esc(s.ctaTarget || '#products') + '">' + esc(s.ctaPrimary || 'Jelajahi Katalog') + ' &#8594;</button>' +
            '<button type="button" class="btn hero-btn-glass btn-lg hero-cta-wa">💬 ' + esc(s.ctaSecondary || 'Konsultasi Gratis') + '</button>' +
          '</div>' +
          '<div class="hero-trust">' +
            '<div class="hero-trust-item"><strong>1.400+</strong><span>Lisensi &amp; Toko Aktif</span></div>' +
            '<div class="hero-trust-item"><strong>4.9 / 5.0</strong><span>Kepuasan Pelanggan</span></div>' +
            '<div class="hero-trust-item"><strong>24 / 7</strong><span>Otomasi WhatsApp Gateway</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="hero-visual-card">' +
          '<div class="hero-discount-orb">HEMAT HINGGA ' + esc(diskon) + '%</div>' +
          '<div class="hero-visual-frame">' +
            '<img src="' + esc(s.image) + '" alt="' + esc(s.title) + '" loading="' + (idx === 0 ? 'eager' : 'lazy') + '">' +
          '</div>' +
          '<div class="hero-metric-chip">' +
            '<small>' + esc(s.metricLabel || 'Performa Unggulan') + '</small>' +
            '<strong>⚡ ' + esc(s.metricValue || 'Real-Time Sync') + '</strong>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    dots.innerHTML = slides.map(function (_, idx) {
      return '<button type="button" class="hero-dot ' + (idx === STATE.heroIdx ? 'is-active' : '') + '" style="--slide-ms:5500ms" data-hero-dot="' + idx + '" aria-label="Slide ' + (idx + 1) + '"></button>';
    }).join('');

    restartHeroAutoTimer();
  }

  function stepHeroSlide(delta) {
    const len = STATE.heroSlides.length;
    if (!len) return;
    STATE.heroIdx = (STATE.heroIdx + delta + len) % len;
    renderHeroSlideshow();
  }

  function restartHeroAutoTimer() {
    if (heroTimer) clearInterval(heroTimer);
    heroTimer = setInterval(function () {
      if (!STATE.heroHover && document.visibilityState === 'visible' && !$('view-storefront').classList.contains('hidden')) {
        stepHeroSlide(1);
      }
    }, 5500);
  }

  function catIconSymbol(raw) {
    const map = { code: '💻', zap: '⚡', briefcase: '🏪', monitor: '🖥️', cpu: '🎮', headphones: '🎧' };
    return map[String(raw || '').toLowerCase()] || (raw && raw.length <= 3 ? raw : '📦');
  }

  function renderCategories() {
    const grid = $('cat-grid');
    const sel = $('search-cat-select');
    const ftLinks = $('ft-cat-links');
    if (!grid) return;

    grid.innerHTML = STATE.categories.map(function (c) {
      const active = STATE.filterCat === c.id_kategori ? 'is-active' : '';
      return '<div class="cat-card ' + active + '" data-cat-pick="' + esc(c.id_kategori) + '">' +
        '<div class="cat-icon" style="font-size:1.35rem;">' + esc(catIconSymbol(c.icon_url)) + '</div>' +
        '<h4>' + esc(c.nama_kategori) + '</h4>' +
        '<span>' + esc(c.subjudul || 'Lihat Produk') + '</span>' +
      '</div>';
    }).join('');

    if (sel) {
      sel.innerHTML = '<option value="ALL">Semua Kategori</option>' +
        STATE.categories.map(function (c) {
          return '<option value="' + esc(c.id_kategori) + '"' + (STATE.filterCat === c.id_kategori ? ' selected' : '') + '>' + esc(c.nama_kategori) + '</option>';
        }).join('');
    }

    if (ftLinks) {
      ftLinks.innerHTML = STATE.categories.slice(0, 6).map(function (c) {
        return '<li><button type="button" data-cat-pick="' + esc(c.id_kategori) + '">' + esc(c.nama_kategori) + '</button></li>';
      }).join('');
    }
  }

  function getFilteredProducts() {
    const q = STATE.searchQuery.trim().toLowerCase();
    let list = STATE.products.filter(function (p) {
      if (STATE.filterCat !== 'ALL' && p.kategori !== STATE.filterCat) return false;
      if (q) {
        const hay = (p.nama_produk + ' ' + p.spesifikasi + ' ' + p.deskripsi + ' ' + p.kategori).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    if (STATE.sortBy === 'price-asc') list.sort(function (a, b) { return effPrice(a) - effPrice(b); });
    else if (STATE.sortBy === 'price-desc') list.sort(function (a, b) { return effPrice(b) - effPrice(a); });
    else if (STATE.sortBy === 'rating') list.sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
    else list.sort(function (a, b) { return (a.urutan || 0) - (b.urutan || 0); });
    return list;
  }

  function renderCatalog() {
    const chips = $('catalog-chips');
    const grid = $('product-grid');
    const countEl = $('catalog-count');
    if (!grid) return;

    if (chips) {
      chips.innerHTML = '<button type="button" class="filter-chip ' + (STATE.filterCat === 'ALL' ? 'is-active' : '') + '" data-cat-pick="ALL">Semua (' + STATE.products.length + ')</button>' +
        STATE.categories.map(function (c) {
          const n = STATE.products.filter(function (p) { return p.kategori === c.id_kategori; }).length;
          return '<button type="button" class="filter-chip ' + (STATE.filterCat === c.id_kategori ? 'is-active' : '') + '" data-cat-pick="' + esc(c.id_kategori) + '">' + esc(c.nama_kategori) + ' (' + n + ')</button>';
        }).join('');
    }

    const list = getFilteredProducts();
    if (countEl) countEl.textContent = 'Menampilkan ' + list.length + ' produk unggulan';

    if (!list.length) {
      grid.innerHTML = '<div class="panel-card" style="grid-column:1/-1;text-align:center;padding:42px;">' +
        '<h3>Produk tidak ditemukan</h3><p style="color:var(--muted);">Coba kata kunci lain atau tampilkan seluruh kategori.</p>' +
        '<button type="button" class="btn btn-primary btn-sm" id="btn-empty-reset">Reset Filter</button></div>';
      const rst = $('btn-empty-reset');
      if (rst) rst.onclick = function () { STATE.filterCat = 'ALL'; STATE.searchQuery = ''; $('search-input').value = ''; renderCategories(); renderCatalog(); };
      return;
    }

    const catMap = {};
    STATE.categories.forEach(function (c) { catMap[c.id_kategori] = c.nama_kategori; });

    grid.innerHTML = list.map(function (p) {
      const price = effPrice(p);
      const hasPromo = p.harga_coret > 0 && p.harga_coret < p.harga;
      const savePct = hasPromo ? Math.round(((p.harga - price) / p.harga) * 100) : 0;
      const wished = STATE.wish.indexOf(p.id_produk) >= 0;
      const imgs = (p.images && p.images.length) ? p.images : ['https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=70'];
      const multi = imgs.length > 1;

      return '<article class="pcard" data-pid="' + esc(p.id_produk) + '" data-slide-cur="0" data-slide-total="' + imgs.length + '">' +
        '<div class="pcard-media" data-open-prod="' + esc(p.id_produk) + '">' +
          (p.badge_promo ? '<span class="pcard-badge">' + esc(p.badge_promo) + '</span>' : '') +
          '<button type="button" class="pcard-wish ' + (wished ? 'is-wished' : '') + '" data-wish-toggle="' + esc(p.id_produk) + '" title="Simpan ke Favorit" aria-label="Simpan Favorit">' + (wished ? '♥' : '♡') + '</button>' +
          '<div class="pcard-slides">' +
            imgs.map(function (u, ix) {
              return '<img class="pcard-slide-img ' + (ix === 0 ? 'is-active' : '') + '" src="' + esc(u) + '" alt="' + esc(p.nama_produk) + ' foto ' + (ix + 1) + '" loading="lazy">';
            }).join('') +
          '</div>' +
          (multi ? (
            '<div class="pcard-gallery-nav">' +
              '<button type="button" class="pcard-gbtn" data-pcard-step="-1" aria-label="Foto sebelumnya">&#8249;</button>' +
              '<button type="button" class="pcard-gbtn" data-pcard-step="1" aria-label="Foto berikutnya">&#8250;</button>' +
            '</div>' +
            '<div class="pcard-dots">' +
              imgs.map(function (_, ix) {
                return '<button type="button" class="pcard-dot ' + (ix === 0 ? 'is-active' : '') + '" data-pcard-goto="' + ix + '" aria-label="Foto ' + (ix + 1) + '"></button>';
              }).join('') +
            '</div>' +
            '<span class="pcard-photo-count">1/' + imgs.length + '</span>'
          ) : '') +
        '</div>' +
        '<div class="pcard-body">' +
          '<div class="pcard-meta">' +
            '<span>' + esc(catMap[p.kategori] || p.kategori) + '</span>' +
            '<span class="pcard-rating">★ ' + esc((p.rating || 4.9).toFixed(1)) + ' <small style="color:var(--muted);font-weight:500;">(' + esc(p.jumlah_ulasan || 0) + ')</small></span>' +
          '</div>' +
          '<h3 class="pcard-title" data-open-prod="' + esc(p.id_produk) + '">' + esc(p.nama_produk) + '</h3>' +
          '<div class="pcard-spec">' + esc(p.spesifikasi || '') + '</div>' +
          '<div class="pcard-price-row tabular">' +
            '<span class="pcard-price">Rp ' + rupiah(price) + '</span>' +
            (hasPromo ? '<span class="pcard-strike">Rp ' + rupiah(p.harga) + '</span><span class="pcard-save">-' + savePct + '%</span>' : '') +
          '</div>' +
          '<div class="pcard-actions">' +
            '<button type="button" class="btn btn-wa btn-sm btn-shimmer" data-quick-buy="' + esc(p.id_produk) + '">⚡ Pesan via WA</button>' +
            '<button type="button" class="btn btn-outline btn-sm" data-add-cart="' + esc(p.id_produk) + '" title="Tambah ke Keranjang">+ 🛒</button>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');

    startProductCardSlideshows();
  }

  function setCardSlide(cardEl, nextIdx) {
    const total = Number(cardEl.getAttribute('data-slide-total') || 1);
    if (total <= 1) return;
    const idx = ((nextIdx % total) + total) % total;
    cardEl.setAttribute('data-slide-cur', String(idx));
    const imgs = cardEl.querySelectorAll('.pcard-slide-img');
    const dots = cardEl.querySelectorAll('.pcard-dot');
    const cnt = cardEl.querySelector('.pcard-photo-count');
    imgs.forEach(function (im, i) { im.classList.toggle('is-active', i === idx); });
    dots.forEach(function (dt, i) { dt.classList.toggle('is-active', i === idx); });
    if (cnt) cnt.textContent = (idx + 1) + '/' + total;
  }

  function startProductCardSlideshows() {
    if (productSlideshowTimer) clearInterval(productSlideshowTimer);
    let tick = 0;
    productSlideshowTimer = setInterval(function () {
      if (document.visibilityState !== 'visible' || $('view-storefront').classList.contains('hidden')) return;
      tick++;
      const cards = document.querySelectorAll('.pcard[data-slide-total]');
      cards.forEach(function (card, cardIdx) {
        const total = Number(card.getAttribute('data-slide-total') || 1);
        if (total <= 1 || card.matches(':hover')) return;
        // Staggered pergantian gambar agar tiap kartu berganti secara alami & berirama
        if ((tick + cardIdx) % 3 === 0) {
          const cur = Number(card.getAttribute('data-slide-cur') || 0);
          setCardSlide(card, cur + 1);
        }
      });
    }, 1450);
  }

  // ── Modal Detail Produk + Galeri Multi-Gambar + Checkout Instan ────────────
  function openProductModal(pid) {
    const p = STATE.products.find(function (x) { return x.id_produk === pid; });
    if (!p) return;
    const price = effPrice(p);
    const hasPromo = p.harga_coret > 0 && p.harga_coret < p.harga;
    const imgs = (p.images && p.images.length) ? p.images : [p.gambar_url];

    $('mp-title').textContent = p.nama_produk;
    $('mp-body').innerHTML =
      '<div class="product-modal-grid">' +
        '<div>' +
          '<div style="border-radius:16px;overflow:hidden;aspect-ratio:4/3;background:var(--surface-2);border:1px solid var(--border);margin-bottom:10px;">' +
            '<img id="mp-main-img" src="' + esc(imgs[0]) + '" alt="' + esc(p.nama_produk) + '" style="width:100%;height:100%;object-fit:cover;">' +
          '</div>' +
          (imgs.length > 1 ? (
            '<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;">' +
              imgs.map(function (u, i) {
                return '<img src="' + esc(u) + '" data-mp-thumb="' + esc(u) + '" style="width:66px;height:52px;object-fit:cover;border-radius:8px;cursor:pointer;border:2px solid ' + (i === 0 ? 'var(--primary)' : 'var(--border)') + ';" alt="Thumb">';
              }).join('') +
            '</div>'
          ) : '') +
          '<div style="margin-top:16px;font-size:0.86rem;white-space:pre-line;color:var(--text-2);background:var(--surface-2);padding:14px;border-radius:12px;">' + esc(p.deskripsi) + '</div>' +
        '</div>' +

        '<div>' +
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;">' +
            (p.badge_promo ? '<span class="pill pill-Diproses">' + esc(p.badge_promo) + '</span>' : '') +
            '<span style="color:#F59E0B;font-weight:700;">★ ' + esc((p.rating || 4.9).toFixed(1)) + ' (' + esc(p.jumlah_ulasan || 0) + ' ulasan)</span>' +
          '</div>' +
          '<div style="font-size:0.82rem;color:var(--muted);margin-bottom:12px;">' + esc(p.spesifikasi || '') + '</div>' +
          '<div class="tabular" style="padding:14px 16px;border-radius:14px;background:var(--primary-soft);margin-bottom:16px;">' +
            '<div style="font-size:1.55rem;font-weight:800;font-family:var(--font-display);color:var(--primary);">Rp ' + rupiah(price) + '</div>' +
            (hasPromo ? '<div style="font-size:0.83rem;color:var(--muted);">Harga Normal: <span style="text-decoration:line-through;">Rp ' + rupiah(p.harga) + '</span></div>' : '') +
          '</div>' +

          '<form id="form-instant-checkout">' +
            '<input type="text" name="website" class="hp-trap" tabindex="-1" autocomplete="off">' +
            '<h4 style="margin-bottom:10px;font-size:0.95rem;">⚡ Checkout Instan via WhatsApp</h4>' +
            '<div class="form-grid-2">' +
              '<div class="field"><label>Nama Pemesan *</label><input class="input" name="nama" required placeholder="Nama Anda"></div>' +
              '<div class="field"><label>Nomor WhatsApp *</label><input class="input" name="wa" required placeholder="0812xxxx"></div>' +
            '</div>' +
            '<div class="form-grid-2">' +
              '<div class="field"><label>Email (Faktur &amp; Notifikasi)</label><input type="email" class="input" name="email" placeholder="nama@email.com"></div>' +
              '<div class="field"><label>Jumlah (Qty)</label><input type="number" class="input" name="qty" min="1" max="99" value="1"></div>' +
            '</div>' +
            '<div class="field"><label>Catatan Pesanan (Opsional)</label><input class="input" name="catatan" placeholder="Misal: Nama domain / jadwal setup..."></div>' +
            '<div class="modal-cta-split" style="margin-top:12px;">' +
              '<button type="submit" class="btn btn-primary btn-lg btn-shimmer">💳 Buat Pesanan &amp; Bayar Sekarang</button>' +
              '<button type="button" class="btn btn-outline btn-lg" id="mp-add-cart-btn">+ Keranjang</button>' +
            '</div>' +
          '</form>' +
        '</div>' +
      '</div>';

    $('mp-body').querySelectorAll('[data-mp-thumb]').forEach(function (th) {
      th.addEventListener('click', function () {
        $('mp-main-img').src = th.getAttribute('data-mp-thumb');
        $('mp-body').querySelectorAll('[data-mp-thumb]').forEach(function (x) { x.style.borderColor = 'var(--border)'; });
        th.style.borderColor = 'var(--primary)';
      });
    });

    $('mp-add-cart-btn').onclick = function () {
      addToCart(p.id_produk, 1);
      closeOverlay('modal-product');
    };

    $('form-instant-checkout').onsubmit = function (ev) {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const qty = Math.max(1, Number(fd.get('qty')) || 1);
      processCheckoutSubmit({
        nama: String(fd.get('nama') || '').trim(),
        wa: String(fd.get('wa') || '').trim(),
        email: String(fd.get('email') || '').trim(),
        catatan: String(fd.get('catatan') || '').trim(),
        website: String(fd.get('website') || ''),
        items: [{ id: p.id_produk, qty: qty }]
      }, function () { closeOverlay('modal-product'); });
    };

    openOverlay('modal-product');
  }

  // ── Keranjang Belanja & Wishlist ────────────────────────────────────────────
  function updateHeaderBadges() {
    const cartQty = STATE.cart.reduce(function (s, i) { return s + (i.qty || 1); }, 0);
    const myCount = Array.isArray(STATE.myOrders) ? STATE.myOrders.length : 0;
    const cb = $('cart-badge'), wb = $('wish-badge'), mb = $('my-order-badge');
    if (cb) { cb.textContent = String(cartQty); cb.classList.toggle('hidden', cartQty <= 0); }
    if (wb) { wb.textContent = String(STATE.wish.length); wb.classList.toggle('hidden', STATE.wish.length <= 0); }
    if (mb) { mb.textContent = String(myCount); mb.classList.toggle('hidden', myCount <= 0); }
  }

  function addToCart(pid, qty) {
    const p = STATE.products.find(function (x) { return x.id_produk === pid; });
    if (!p) return;
    const ex = STATE.cart.find(function (i) { return i.id === pid; });
    if (ex) ex.qty = Math.min(99, (ex.qty || 1) + (qty || 1));
    else STATE.cart.push({ id: pid, qty: qty || 1 });
    saveJson(LS.CART, STATE.cart);
    updateHeaderBadges();
    toast('"' + p.nama_produk + '" ditambahkan ke keranjang!', 'ok');
    sayMascot('Yeay! Masuk keranjang! 🛒✨', 2800);
  }

  function toggleWish(pid) {
    const ix = STATE.wish.indexOf(pid);
    if (ix >= 0) STATE.wish.splice(ix, 1);
    else STATE.wish.push(pid);
    saveJson(LS.WISH, STATE.wish);
    updateHeaderBadges();
    renderCatalog();
    sayMascot(ix >= 0 ? 'Dihapus dari favorit.' : 'Disimpan ke favorit! ❤️', 2200);
  }

  function openCartDrawer(mode) {
    STATE.drawerMode = mode || 'cart';
    const title = $('drawer-cart-title'), body = $('drawer-cart-body'), foot = $('drawer-cart-foot');
    if (STATE.drawerMode === 'wish') {
      title.textContent = '❤️ Produk Favorit (' + STATE.wish.length + ')';
      const items = STATE.wish.map(function (id) { return STATE.products.find(function (p) { return p.id_produk === id; }); }).filter(Boolean);
      if (!items.length) {
        body.innerHTML = '<p style="text-align:center;color:var(--muted);padding:36px 0;">Belum ada produk favorit.</p>';
        foot.innerHTML = '';
      } else {
        body.innerHTML = items.map(function (p) {
          return '<div style="display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">' +
            '<img src="' + esc(p.gambar_url) + '" style="width:56px;height:56px;border-radius:10px;object-fit:cover;" alt="">' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-weight:700;font-size:0.88rem;">' + esc(p.nama_produk) + '</div>' +
              '<div style="color:var(--primary);font-weight:800;font-size:0.85rem;">Rp ' + rupiah(effPrice(p)) + '</div>' +
            '</div>' +
            '<button type="button" class="btn btn-primary btn-sm" data-wish-to-cart="' + esc(p.id_produk) + '">+ 🛒</button>' +
          '</div>';
        }).join('');
        foot.innerHTML = '<button type="button" class="btn btn-outline" style="width:100%;" id="btn-switch-to-cart">Lihat Keranjang Belanja</button>';
        $('btn-switch-to-cart').onclick = function () { openCartDrawer('cart'); };
      }
      body.querySelectorAll('[data-wish-to-cart]').forEach(function (b) {
        b.onclick = function () { addToCart(b.getAttribute('data-wish-to-cart'), 1); openCartDrawer('cart'); };
      });
      openOverlay('drawer-cart');
      return;
    }

    title.textContent = '🛒 Keranjang Belanja';
    const detailed = STATE.cart.map(function (c) {
      const p = STATE.products.find(function (x) { return x.id_produk === c.id; });
      return p ? { p: p, qty: c.qty } : null;
    }).filter(Boolean);

    if (!detailed.length) {
      body.innerHTML = '<div style="text-align:center;padding:42px 10px;color:var(--muted);">Keranjang Anda masih kosong. Pilih produk unggulan terlebih dahulu.</div>';
      foot.innerHTML = '';
      openOverlay('drawer-cart');
      return;
    }

    let grandTotal = 0;
    body.innerHTML = detailed.map(function (row) {
      const h = effPrice(row.p);
      grandTotal += h * row.qty;
      return '<div style="display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">' +
        '<img src="' + esc(row.p.gambar_url) + '" style="width:54px;height:54px;border-radius:10px;object-fit:cover;" alt="">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-weight:700;font-size:0.86rem;">' + esc(row.p.nama_produk) + '</div>' +
          '<div class="tabular" style="font-size:0.82rem;color:var(--primary);font-weight:700;">Rp ' + rupiah(h) + ' × ' + row.qty + '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:4px;">' +
          '<button type="button" class="btn btn-outline btn-sm" data-cart-delta="-1" data-cid="' + esc(row.p.id_produk) + '">−</button>' +
          '<button type="button" class="btn btn-outline btn-sm" data-cart-delta="1" data-cid="' + esc(row.p.id_produk) + '">+</button>' +
        '</div>' +
      '</div>';
    }).join('') +
    '<form id="form-cart-checkout" style="margin-top:16px;">' +
      '<input type="text" name="website" class="hp-trap" tabindex="-1" autocomplete="off">' +
      '<div class="field"><label>Nama Lengkap *</label><input class="input" name="nama" required placeholder="Nama Pemesan"></div>' +
      '<div class="field"><label>Nomor WhatsApp *</label><input class="input" name="wa" required placeholder="0812xxxx"></div>' +
      '<div class="field"><label>Email (Opsional untuk Faktur &amp; Notifikasi)</label><input type="email" class="input" name="email" placeholder="nama@email.com"></div>' +
      '<div class="field"><label>Catatan</label><input class="input" name="catatan" placeholder="Catatan tambahan..."></div>' +
    '</form>';

    foot.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
        '<span style="font-weight:600;color:var(--muted);">Total Estimasi</span>' +
        '<strong class="tabular" style="font-size:1.2rem;font-family:var(--font-display);color:var(--primary);">Rp ' + rupiah(grandTotal) + '</strong>' +
      '</div>' +
      '<button type="button" class="btn btn-primary btn-lg btn-shimmer" style="width:100%;" id="btn-submit-cart-wa">💳 Buat Pesanan &amp; Pilih Pembayaran</button>';

    body.querySelectorAll('[data-cart-delta]').forEach(function (b) {
      b.onclick = function () {
        const cid = b.getAttribute('data-cid');
        const d = Number(b.getAttribute('data-cart-delta'));
        const item = STATE.cart.find(function (x) { return x.id === cid; });
        if (!item) return;
        item.qty += d;
        if (item.qty <= 0) STATE.cart = STATE.cart.filter(function (x) { return x.id !== cid; });
        saveJson(LS.CART, STATE.cart);
        updateHeaderBadges();
        openCartDrawer('cart');
      };
    });

    $('btn-submit-cart-wa').onclick = function () {
      const form = $('form-cart-checkout');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      processCheckoutSubmit({
        nama: String(fd.get('nama') || '').trim(),
        wa: String(fd.get('wa') || '').trim(),
        email: String(fd.get('email') || '').trim(),
        catatan: String(fd.get('catatan') || '').trim(),
        website: String(fd.get('website') || ''),
        items: STATE.cart.slice()
      }, function () {
        STATE.cart = [];
        saveJson(LS.CART, []);
        updateHeaderBadges();
        closeOverlay('drawer-cart');
      });
    };

    openOverlay('drawer-cart');
  }

  function buildCustomerWaConfirmUrl(ord, extraStatusNote) {
    const st = STATE.settings || {};
    let parsedItems = [];
    try { parsedItems = JSON.parse(ord.item_json || '[]'); } catch (e) { parsedItems = []; }
    const lines = parsedItems.length
      ? parsedItems.map(function (it) { return '- ' + it.nama + ' (x' + it.qty + ') = Rp ' + rupiah(it.subtotal || (it.harga * it.qty)); }).join('\n')
      : ('- ' + (ord.nama_produk || 'Produk') + ' = Rp ' + rupiah(ord.total_harga));

    let msg = (st.template_pesan_web || 'Halo {nama_toko}, saya ingin mengonfirmasi pesanan:\n{daftar_produk}\n- Nama Pemesan: {nama}\n- No. HP: {no_wa}\n- Catatan: {catatan}\n- ID Pesanan: {id_pesanan}\nMohon dibantu verifikasi ya. Terima kasih!')
      .replace(/\{nama_toko\}/g, st.nama_toko || 'NusaStore')
      .replace(/\{daftar_produk\}/g, lines + '\nTotal Tagihan: Rp ' + rupiah(ord.total_harga))
      .replace(/\{nama\}/g, ord.nama_pelanggan || '')
      .replace(/\{no_wa\}/g, ord.no_whatsapp || '')
      .replace(/\{catatan\}/g, ord.catatan || '-')
      .replace(/\{id_pesanan\}/g, ord.id_pesanan || '');

    if (extraStatusNote) msg += '\n\nInfo Tambahan: ' + extraStatusNote;
    const waAdmin = normPhone(st.nomor_wa_admin || DEMO_DB.settings.nomor_wa_admin || '6281288009900');
    return 'https://wa.me/' + waAdmin + '?text=' + encodeURIComponent(msg);
  }

  async function processCheckoutSubmit(orderPayload, onSuccess) {
    if (orderPayload.nama.length < 2) { toast('Nama pemesan wajib diisi.', 'err'); return; }
    const cleanWa = normPhone(orderPayload.wa);
    if (!/^628\d{7,12}$/.test(cleanWa)) { toast('Nomor WhatsApp tidak valid (contoh: 08123456789).', 'err'); return; }

    const orderId = genClientOrderId();
    orderPayload.id = orderId;

    let total = 0;
    let totalQty = 0;
    const builtItems = orderPayload.items.map(function (it) {
      const p = STATE.products.find(function (x) { return x.id_produk === it.id; });
      const h = p ? effPrice(p) : 0;
      const q = Math.max(1, Number(it.qty) || 1);
      total += h * q;
      totalQty += q;
      return { id: it.id, nama: p ? p.nama_produk : it.id, qty: q, harga: h, subtotal: h * q };
    });

    const localOrd = {
      id_pesanan: orderId,
      tanggal_order: new Date().toISOString(),
      nama_pelanggan: orderPayload.nama,
      no_whatsapp: cleanWa,
      nama_produk: builtItems.map(function (i) { return i.nama + (i.qty > 1 ? ' (x' + i.qty + ')' : ''); }).join('; '),
      total_harga: total,
      qty: totalQty,
      item_json: JSON.stringify(builtItems),
      status_pesanan: 'Pending',
      catatan: orderPayload.catatan || '',
      metode_bayar: '',
      has_bukti: false,
      kunci_lisensi: '',
      riwayat_status: fmtDateShort(new Date().toISOString()) + ' Pesanan dibuat di website',
      invoiceSig: 'PENDING'
    };

    saveMyLocalOrder(localOrd);
    if (onSuccess) onSuccess();

    // OPSI 1: Buka Pop-Up Pembayaran Instan (Rekening Bank + QRIS + Upload Bukti + WA)
    openPaymentInstructionModal(localOrd, true);
    sayMascot('Pesanan ' + orderId + ' dibuat! Silakan pilih metode pembayaran 💳✨', 4200);

    try {
      const res = await apiCall('submitPublicOrder', { payload: orderPayload }, 'POST');
      if (res && res.success) {
        if (res.data && res.data.paymentInfo) {
          STATE.settings = Object.assign({}, STATE.settings, res.data.paymentInfo);
        }
        if (res.data && res.data.invoiceSig) localOrd.invoiceSig = res.data.invoiceSig;
        if (res.data && res.data.total) localOrd.total_harga = res.data.total;
        saveMyLocalOrder(localOrd);

        const syncPill = $('mpc-sync-pill');
        if (syncPill) {
          syncPill.className = 'pill pill-Lunas';
          syncPill.textContent = '✓ Tercatat Resmi di Sistem';
        }
        refreshPaymentMethodBoxInModal();
        toast('Pesanan ' + orderId + ' berhasil tercatat! Silakan selesaikan pembayaran.', 'ok');
      } else {
        const syncPill = $('mpc-sync-pill');
        if (syncPill) {
          syncPill.className = 'pill pill-Pending';
          syncPill.textContent = '⚠️ Lanjutkan Konfirmasi via WA';
        }
        toast((res && res.message) || 'Silakan konfirmasi pesanan melalui tombol WhatsApp.', 'err');
      }
    } catch (e) {
      const syncPill = $('mpc-sync-pill');
      if (syncPill) {
        syncPill.className = 'pill pill-Pending';
        syncPill.textContent = '⚠️ Koneksi Sibuk — Gunakan Tombol WA';
      }
    }
  }

  function getEffectivePaymentSettings() {
    const st = STATE.settings || {};
    return {
      rekening_bank: st.rekening_bank || DEMO_DB.settings.rekening_bank || 'BCA 828-091-8899 a.n. PT Nusa Digital Teknologi',
      link_qris: st.link_qris ? driveImgClient(st.link_qris) : '',
      batas_bayar_jam: st.batas_bayar_jam || '24',
      nama_toko: st.nama_toko || 'NusaStore',
      nomor_wa_admin: st.nomor_wa_admin || DEMO_DB.settings.nomor_wa_admin || '6281288009900'
    };
  }

  function renderPaymentMethodPanelsHtml(ord, activeMethod) {
    const pay = getEffectivePaymentSettings();
    const accDigits = extractAccountDigits(pay.rekening_bank);
    const qrFallback = 'https://quickchart.io/qr?size=200&text=' + encodeURIComponent('NUSASTORE|' + ord.id_pesanan + '|RP' + Math.round(Number(ord.total_harga) || 0));

    return '<div class="pay-method-tabs">' +
        '<button type="button" class="pay-method-tab ' + (activeMethod !== 'qris' ? 'is-active' : '') + '" data-switch-pay="bank">🏦 Transfer Bank</button>' +
        '<button type="button" class="pay-method-tab ' + (activeMethod === 'qris' ? 'is-active' : '') + '" data-switch-pay="qris">📱 QRIS Instan (E-Wallet &amp; M-Banking)</button>' +
      '</div>' +
      '<div id="pay-tab-bank" class="pay-box-card ' + (activeMethod === 'qris' ? 'hidden' : '') + '">' +
        '<div style="font-size:0.76rem;color:var(--muted);text-transform:uppercase;font-weight:700;margin-bottom:6px;">Rekening Tujuan Resmi</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">' +
          '<div style="font-size:1.02rem;font-weight:800;color:var(--text);">' + esc(pay.rekening_bank) + '</div>' +
          (accDigits ? '<button type="button" class="copy-pill-btn" data-copy-val="' + esc(accDigits) + '" data-copy-lbl="Nomor rekening">📋 Salin No. Rek (' + esc(accDigits) + ')</button>' : '') +
        '</div>' +
        '<div style="margin-top:10px;font-size:0.8rem;color:var(--muted);line-height:1.5;">' +
          '1. Transfer tepat sejumlah <strong style="color:var(--primary);">Rp ' + rupiah(ord.total_harga) + '</strong>.<br>' +
          '2. Simpan tangkapan layar / struk bukti transfer.<br>' +
          '3. Unggah bukti pembayaran pada formulir di bawah agar pesanan segera diverifikasi.' +
        '</div>' +
      '</div>' +
      '<div id="pay-tab-qris" class="pay-box-card ' + (activeMethod !== 'qris' ? 'hidden' : '') + '" style="text-align:center;">' +
        (pay.link_qris
          ? '<div style="font-size:0.82rem;font-weight:700;margin-bottom:8px;">Scan QRIS Resmi ' + esc(pay.nama_toko) + ' (GoPay, OVO, DANA, ShopeePay, M-Banking)</div>' +
            '<img src="' + esc(pay.link_qris) + '" alt="QRIS Resmi" style="max-width:230px;width:100%;border-radius:12px;border:1px solid var(--border);padding:8px;background:#FFF;margin:0 auto 10px;cursor:pointer;" id="btn-zoom-qris">' +
            '<div><button type="button" class="copy-pill-btn" id="btn-zoom-qris-2">🔍 Perbesar Gambar QRIS</button></div>'
          : '<div style="font-size:0.84rem;font-weight:700;margin-bottom:6px;">Kode Referensi Pesanan #' + esc(ord.id_pesanan) + '</div>' +
            '<img src="' + esc(qrFallback) + '" width="150" height="150" alt="QR Referensi" style="border-radius:12px;border:1px solid var(--border);padding:6px;background:#FFF;margin:0 auto 8px;">' +
            '<div style="font-size:0.79rem;color:var(--muted);max-width:440px;margin:0 auto;">Gambar QRIS Merchant dapat diminta langsung dalam 1 klik melalui tombol <strong>Konfirmasi via WhatsApp</strong> di bawah, atau gunakan tab <strong>Transfer Bank</strong> untuk pembayaran instan.</div>'
        ) +
      '</div>';
  }

  function bindPaymentMethodTabs(rootEl) {
    const pay = getEffectivePaymentSettings();
    rootEl.querySelectorAll('[data-switch-pay]').forEach(function (btn) {
      btn.onclick = function () {
        const mode = btn.getAttribute('data-switch-pay');
        rootEl.querySelectorAll('[data-switch-pay]').forEach(function (x) {
          x.classList.toggle('is-active', x.getAttribute('data-switch-pay') === mode);
        });
        const bEl = rootEl.querySelector('#pay-tab-bank');
        const qEl = rootEl.querySelector('#pay-tab-qris');
        if (bEl) bEl.classList.toggle('hidden', mode !== 'bank');
        if (qEl) qEl.classList.toggle('hidden', mode !== 'qris');
        const sel = rootEl.querySelector('[name="metode_bayar"]');
        if (sel) sel.value = mode === 'qris' ? 'QRIS' : 'Transfer Bank';
      };
    });
    rootEl.querySelectorAll('[data-copy-val]').forEach(function (btn) {
      btn.onclick = function () { copyText(btn.getAttribute('data-copy-val'), btn.getAttribute('data-copy-lbl')); };
    });
    const z1 = rootEl.querySelector('#btn-zoom-qris');
    const z2 = rootEl.querySelector('#btn-zoom-qris-2');
    if (z1 && pay.link_qris) z1.onclick = function () { openProofLightbox(pay.link_qris, '📱 QRIS Resmi ' + pay.nama_toko); };
    if (z2 && pay.link_qris) z2.onclick = function () { openProofLightbox(pay.link_qris, '📱 QRIS Resmi ' + pay.nama_toko); };
  }

  let _activeCheckoutOrd = null;
  function refreshPaymentMethodBoxInModal() {
    const host = $('mpc-pay-methods-host');
    if (!host || !_activeCheckoutOrd) return;
    host.innerHTML = renderPaymentMethodPanelsHtml(_activeCheckoutOrd, 'bank');
    bindPaymentMethodTabs(host);
  }

  function renderProofUploadWidget(hostEl, ord, onUploaded) {
    if (!hostEl) return;
    hostEl.innerHTML =
      '<div style="background:var(--surface);border:1.5px dashed var(--primary);border-radius:14px;padding:16px;">' +
        '<h4 style="margin:0 0 4px;font-size:0.95rem;">📤 Unggah Bukti Pembayaran Langsung di Website</h4>' +
        '<p style="margin:0 0 12px;font-size:0.8rem;color:var(--muted);">Bukti transfer Anda otomatis masuk ke sistem Admin tanpa harus mengantre chat.</p>' +
        '<form class="form-public-proof">' +
          '<div class="form-grid-2">' +
            '<div class="field"><label>Metode yang Digunakan</label>' +
              '<select class="select" name="metode_bayar">' +
                '<option value="Transfer Bank">Transfer Bank</option>' +
                '<option value="QRIS">QRIS / E-Wallet</option>' +
              '</select>' +
            '</div>' +
            '<div class="field"><label>Nama Pengirim / Info Bank (Opsional)</label>' +
              '<input type="text" class="input" name="catatan_bayar" placeholder="Misal: BCA a.n. Budi">' +
            '</div>' +
          '</div>' +
          '<div class="field">' +
            '<label>Pilih Foto / Screenshot / PDF Bukti Bayar (Maks. 5 MB) *</label>' +
            '<input type="file" class="input proof-file-inp" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" required style="font-size:0.82rem;">' +
          '</div>' +
          '<div class="proof-local-preview hidden" style="margin-bottom:12px;text-align:center;background:var(--surface-2);padding:10px;border-radius:10px;">' +
            '<img src="" alt="Pratinjau Bukti" style="max-height:150px;border-radius:8px;margin:0 auto;">' +
          '</div>' +
          '<button type="submit" class="btn btn-primary btn-shimmer proof-submit-btn" style="width:100%;">📤 Kirim Bukti Pembayaran Sekarang</button>' +
        '</form>' +
      '</div>';

    const fileInp = hostEl.querySelector('.proof-file-inp');
    const prevWrap = hostEl.querySelector('.proof-local-preview');
    const prevImg = prevWrap ? prevWrap.querySelector('img') : null;

    fileInp.onchange = function () {
      const f = fileInp.files && fileInp.files[0];
      if (!f || !prevWrap || !prevImg) return;
      if (f.type.indexOf('image/') === 0) {
        const rd = new FileReader();
        rd.onload = function () { prevImg.src = rd.result; prevWrap.classList.remove('hidden'); };
        rd.readAsDataURL(f);
      } else {
        prevWrap.classList.add('hidden');
      }
    };

    hostEl.querySelector('.form-public-proof').onsubmit = function (ev) {
      ev.preventDefault();
      const f = fileInp.files && fileInp.files[0];
      if (!f) { toast('Pilih berkas bukti pembayaran terlebih dahulu.', 'err'); return; }
      if (f.size > 5 * 1024 * 1024) { toast('Ukuran berkas melebihi 5 MB. Kompres atau potong screenshot terlebih dahulu.', 'err'); return; }

      const fd = new FormData(ev.target);
      const metode = String(fd.get('metode_bayar') || 'Transfer Bank');
      const catBayar = String(fd.get('catatan_bayar') || '').trim();
      const btn = hostEl.querySelector('.proof-submit-btn');
      btn.disabled = true;
      btn.textContent = '⏳ Mengunggah bukti ke server aman...';

      const reader = new FileReader();
      reader.onload = async function () {
        const base64 = String(reader.result || '').split(',')[1] || '';
        try {
          const res = await apiCall('uploadPublicPaymentProof', {
            payload: {
              orderId: ord.id_pesanan,
              wa: ord.no_whatsapp,
              metode_bayar: metode,
              catatan_bayar: catBayar,
              base64: base64,
              mime: f.type || 'image/jpeg',
              filename: f.name || 'bukti.jpg'
            }
          }, 'POST');

          if (res && res.success) {
            ord.has_bukti = true;
            ord.metode_bayar = metode;
            if (res.data && res.data.order) Object.assign(ord, res.data.order);
            saveMyLocalOrder(ord);
            toast(res.message || 'Bukti pembayaran berhasil dikirim!', 'ok');
            sayMascot('Bukti bayar diterima! Admin segera memverifikasi 🎉', 3800);

            hostEl.innerHTML =
              '<div style="background:var(--wa-soft);border:1.5px solid rgba(16,185,129,0.45);border-radius:14px;padding:18px;text-align:center;">' +
                '<div style="font-size:1.8rem;margin-bottom:4px;">✅</div>' +
                '<h4 style="margin:0 0 6px;color:#059669;">Bukti Pembayaran Berhasil Terkirim!</h4>' +
                '<p style="margin:0 0 12px;font-size:0.83rem;color:var(--text);">Tim Admin kami sedang memverifikasi pembayaran pesanan <strong>' + esc(ord.id_pesanan) + '</strong>. Kunci lisensi &amp; faktur resmi dapat Anda ambil kapan saja melalui menu <strong>💳 Cek Pesanan</strong> di bagian atas halaman.</p>' +
                '<a href="' + esc(buildCustomerWaConfirmUrl(ord, 'Saya baru saja mengunggah bukti pembayaran (' + metode + ') di website.')) + '" target="_blank" rel="noopener" class="btn btn-wa btn-sm">💬 Beri Tahu Admin di WhatsApp (Opsional)</a>' +
              '</div>';
            if (onUploaded) onUploaded(ord);
          } else if (res && /tidak dikenal/i.test(String(res.message || ''))) {
            btn.disabled = false;
            btn.textContent = '📤 Kirim Bukti Pembayaran Sekarang';
            toast('Mengarahkan ke WhatsApp Admin untuk pengiriman lampiran bukti...', 'info');
            window.open(buildCustomerWaConfirmUrl(ord, 'Saya sudah membayar via ' + metode + ' dan ingin melampirkan bukti transfer di chat ini.'), '_blank', 'noopener');
          } else {
            btn.disabled = false;
            btn.textContent = '📤 Kirim Bukti Pembayaran Sekarang';
            toast((res && res.message) || 'Gagal mengunggah berkas, silakan kirim via tombol WhatsApp.', 'err');
          }
        } catch (err) {
          btn.disabled = false;
          btn.textContent = '📤 Kirim Bukti Pembayaran Sekarang';
          toast('Jaringan sedang sibuk, silakan kirim bukti via tombol WhatsApp.', 'err');
        }
      };
      reader.readAsDataURL(f);
    };
  }

  function openPaymentInstructionModal(ord, isSubmittingAsync) {
    _activeCheckoutOrd = ord;
    const pay = getEffectivePaymentSettings();
    let items = [];
    try { items = JSON.parse(ord.item_json || '[]'); } catch (e) { items = []; }

    $('mpc-title').textContent = '💳 Tagihan & Pembayaran Pesanan #' + ord.id_pesanan;
    const body = $('mpc-body');
    body.innerHTML =
      '<div class="pay-summary-banner">' +
        '<div>' +
          '<span id="mpc-sync-pill" class="pill ' + (isSubmittingAsync ? 'pill-Diproses' : 'pill-Lunas') + '">' +
            (isSubmittingAsync ? '⏳ Menyimpan pesanan ke database...' : '✓ Tercatat Resmi di Sistem') +
          '</span>' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;">' +
            '<span style="font-size:1.1rem;font-weight:800;" class="tabular">ID: ' + esc(ord.id_pesanan) + '</span>' +
            '<button type="button" class="copy-pill-btn" data-copy-val="' + esc(ord.id_pesanan) + '" data-copy-lbl="ID Pesanan">📋 Salin ID</button>' +
          '</div>' +
          '<div style="font-size:0.79rem;color:#CBD5E1;margin-top:4px;">Pemesan: <strong>' + esc(ord.nama_pelanggan) + '</strong> (+' + esc(ord.no_whatsapp) + ') • Batas Bayar: ' + esc(pay.batas_bayar_jam) + ' Jam</div>' +
        '</div>' +
        '<div style="text-align:right;">' +
          '<div style="font-size:0.74rem;color:#93C5FD;text-transform:uppercase;font-weight:700;">Total Tagihan</div>' +
          '<div class="tabular" style="font-size:1.55rem;font-weight:800;color:#FFFFFF;">Rp ' + rupiah(ord.total_harga) + '</div>' +
          '<button type="button" class="copy-pill-btn" data-copy-val="' + esc(Math.round(Number(ord.total_harga) || 0)) + '" data-copy-lbl="Nominal pembayaran" style="margin-top:4px;">📋 Salin Nominal</button>' +
        '</div>' +
      '</div>' +

      (items.length ? '<div style="background:var(--surface-2);border-radius:12px;padding:11px 14px;margin-bottom:14px;font-size:0.83rem;">' +
        '<div style="font-weight:700;margin-bottom:4px;color:var(--muted);">Rincian Item Pesanan:</div>' +
        items.map(function (it) {
          return '<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0;"><span>' + esc(it.nama) + ' × ' + it.qty + '</span><strong class="tabular">Rp ' + rupiah(it.subtotal || (it.harga * it.qty)) + '</strong></div>';
        }).join('') +
      '</div>' : '') +

      '<div id="mpc-pay-methods-host">' + renderPaymentMethodPanelsHtml(ord, 'bank') + '</div>' +

      '<div id="mpc-proof-upload-host" style="margin-bottom:16px;"></div>' +

      '<div class="modal-cta-split">' +
        '<a href="' + esc(buildCustomerWaConfirmUrl(ord, '')) + '" target="_blank" rel="noopener" class="btn btn-wa" style="text-align:center;">💬 Konfirmasi / Tanya via WhatsApp</a>' +
        '<button type="button" class="btn btn-outline" id="mpc-go-tracker-btn">🔍 Buka Menu Cek Pesanan</button>' +
      '</div>';

    body.querySelectorAll('.pay-summary-banner [data-copy-val]').forEach(function (btn) {
      btn.onclick = function () { copyText(btn.getAttribute('data-copy-val'), btn.getAttribute('data-copy-lbl')); };
    });
    bindPaymentMethodTabs($('mpc-pay-methods-host'));
    renderProofUploadWidget($('mpc-proof-upload-host'), ord);

    $('mpc-go-tracker-btn').onclick = function () {
      closeOverlay('modal-payment-checkout');
      openOrderTrackerModal(ord.id_pesanan, ord.no_whatsapp);
    };

    openOverlay('modal-payment-checkout');
  }

  // ── OPSI 2: PORTAL CEK STATUS PESANAN, KONFIRMASI BAYAR & AMBIL LISENSI ────
  function openOrderTrackerModal(prefillOrderId, prefillWa) {
    const recent = Array.isArray(STATE.myOrders) ? STATE.myOrders : [];
    const defaultWa = prefillWa || (recent[0] ? recent[0].no_whatsapp : '');
    const defaultId = prefillOrderId || '';

    const body = $('mot-body');
    body.innerHTML =
      (recent.length ? '<div style="margin-bottom:16px;">' +
        '<div style="font-size:0.78rem;font-weight:700;color:var(--muted);margin-bottom:8px;">⚡ Pesanan Terakhir Anda di Perangkat Ini (Klik untuk Cek Instan):</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          recent.slice(0, 5).map(function (ro) {
            return '<button type="button" class="my-order-chip" data-quick-trk-id="' + esc(ro.id_pesanan) + '" data-quick-trk-wa="' + esc(ro.no_whatsapp) + '">' +
              '<span>🧾 ' + esc(ro.id_pesanan) + '</span>' +
              '<span style="color:var(--primary);">Rp ' + rupiah(ro.total_harga) + '</span>' +
            '</button>';
          }).join('') +
        '</div>' +
      '</div>' : '') +

      '<form id="form-track-public-order" class="pay-box-card" style="margin-bottom:18px;">' +
        '<div class="form-grid-2">' +
          '<div class="field" style="margin-bottom:10px;">' +
            '<label>Nomor WhatsApp Pemesan *</label>' +
            '<input type="tel" id="trk-input-wa" class="input" required placeholder="Contoh: 08123456789" value="' + esc(defaultWa) + '">' +
          '</div>' +
          '<div class="field" style="margin-bottom:10px;">' +
            '<label>ID Pesanan (Opsional — kosongkan untuk semua)</label>' +
            '<input type="text" id="trk-input-id" class="input" placeholder="Contoh: ORD-20261101-XXXX" value="' + esc(defaultId) + '">' +
          '</div>' +
        '</div>' +
        '<button type="submit" class="btn btn-primary" id="btn-run-track" style="width:100%;">🔍 Cek Status Pesanan &amp; Pembayaran</button>' +
      '</form>' +
      '<div id="trk-results-host"></div>';

    body.querySelectorAll('[data-quick-trk-id]').forEach(function (chip) {
      chip.onclick = function () {
        $('trk-input-id').value = chip.getAttribute('data-quick-trk-id');
        $('trk-input-wa').value = chip.getAttribute('data-quick-trk-wa');
        executePublicOrderLookup();
      };
    });

    $('form-track-public-order').onsubmit = function (ev) {
      ev.preventDefault();
      executePublicOrderLookup();
    };

    openOverlay('modal-order-tracker');
    if (defaultWa) executePublicOrderLookup();
  }

  async function executePublicOrderLookup() {
    const rawWa = $('trk-input-wa') ? $('trk-input-wa').value.trim() : '';
    const rawId = $('trk-input-id') ? $('trk-input-id').value.trim().toUpperCase() : '';
    const cleanWa = normPhone(rawWa);
    const host = $('trk-results-host');
    if (!host) return;

    if (!/^628\d{7,12}$/.test(cleanWa)) {
      toast('Masukkan Nomor WhatsApp pemesan yang valid (contoh: 08123456789).', 'err');
      return;
    }

    const btn = $('btn-run-track');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Memeriksa status terbaru di server...'; }
    host.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);">Memuat data pesanan...</div>';

    let orders = [];
    try {
      const res = await apiCall('trackPublicOrder', { payload: { wa: cleanWa, orderId: rawId } }, 'POST');
      if (res && res.success && res.data) {
        if (res.data.paymentInfo) STATE.settings = Object.assign({}, STATE.settings, res.data.paymentInfo);
        orders = Array.isArray(res.data.orders) ? res.data.orders : [];
        orders.forEach(saveMyLocalOrder);
      } else if (res && /tidak dikenal/i.test(String(res.message || ''))) {
        // Fallback anggun bila backend GAS belum di-deploy ke versi terbaru
        orders = (STATE.myOrders || []).filter(function (o) {
          if (normPhone(o.no_whatsapp) !== cleanWa) return false;
          if (rawId && String(o.id_pesanan).toUpperCase() !== rawId) return false;
          return true;
        });
      } else if (res && !res.success) {
        toast(res.message || 'Gagal memuat pesanan.', 'err');
      }
    } catch (e) {
      orders = (STATE.myOrders || []).filter(function (o) {
        if (normPhone(o.no_whatsapp) !== cleanWa) return false;
        if (rawId && String(o.id_pesanan).toUpperCase() !== rawId) return false;
        return true;
      });
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔍 Cek Status Pesanan & Pembayaran'; }
    }

    if (!orders.length) {
      host.innerHTML =
        '<div style="text-align:center;padding:28px 16px;background:var(--surface-2);border-radius:14px;">' +
          '<div style="font-size:1.8rem;margin-bottom:6px;">🔎</div>' +
          '<h4 style="margin:0 0 6px;">Belum Ditemukan Pesanan</h4>' +
          '<p style="margin:0;font-size:0.84rem;color:var(--muted);">Pastikan Nomor WhatsApp sama persis dengan yang Anda masukkan saat memesan, atau kosongkan kolom ID Pesanan untuk menampilkan semua transaksi nomor tersebut.</p>' +
        '</div>';
      return;
    }

    renderTrackedOrderCards(host, orders);
  }

  function renderTrackedOrderCards(host, orders) {
    host.innerHTML = orders.map(function (o, idx) {
      const st = String(o.status_pesanan || 'Pending');
      const isPaid = ['Lunas', 'Diproses', 'Selesai'].indexOf(st) >= 0;
      const isDone = st === 'Selesai';
      const hasBukti = !!o.has_bukti || isPaid;
      const statusLabel = (st === 'Pending' && hasBukti) ? 'Menunggu Verifikasi Admin' : st;
      const pillClass = (st === 'Pending' && hasBukti) ? 'pill-Diproses' : ('pill-' + st);

      return '<div class="panel-card" style="margin-bottom:16px;" data-trk-card="' + idx + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;padding-bottom:12px;border-bottom:1px solid var(--border);">' +
          '<div>' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
              '<strong class="tabular" style="font-size:1.05rem;">#' + esc(o.id_pesanan) + '</strong>' +
              '<button type="button" class="copy-pill-btn" data-copy-val="' + esc(o.id_pesanan) + '" data-copy-lbl="ID Pesanan">📋 Salin ID</button>' +
              '<span class="pill ' + esc(pillClass) + '">' + esc(statusLabel) + '</span>' +
            '</div>' +
            '<div style="font-size:0.8rem;color:var(--muted);margin-top:4px;">' + esc(fmtDateShort(o.tanggal_order)) + ' • Pemesan: ' + esc(o.nama_pelanggan) + '</div>' +
          '</div>' +
          '<div style="text-align:right;">' +
            '<div style="font-size:0.75rem;color:var(--muted);">Total Tagihan</div>' +
            '<strong class="tabular" style="font-size:1.2rem;color:var(--primary);">Rp ' + rupiah(o.total_harga) + '</strong>' +
          '</div>' +
        '</div>' +

        '<div style="padding:10px 0 4px;font-size:0.88rem;"><strong>Produk / Layanan:</strong> ' + esc(o.nama_produk) + '</div>' +

        (st !== 'Batal' ? '<div class="order-stepper">' +
          '<div class="order-step-item is-done">1. Pesanan Dibuat</div>' +
          '<div class="order-step-item ' + (hasBukti ? 'is-done' : 'is-current') + '">2. Bukti Bayar</div>' +
          '<div class="order-step-item ' + (isPaid ? 'is-done' : (hasBukti ? 'is-current' : '')) + '">3. Diverifikasi Lunas</div>' +
          '<div class="order-step-item ' + (isDone ? 'is-done' : (isPaid ? 'is-current' : '')) + '">4. Selesai &amp; Lisensi</div>' +
        '</div>' : '<div class="pill pill-Batal" style="margin:10px 0;">Pesanan Dibatalkan</div>') +

        (st === 'Pending' ? (
          '<div class="trk-pay-methods-slot">' + renderPaymentMethodPanelsHtml(o, 'bank') + '</div>' +
          (hasBukti
            ? '<div style="background:var(--primary-soft);border:1px solid rgba(37,99,235,0.3);border-radius:12px;padding:13px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">' +
                '<div style="font-size:0.83rem;"><strong>📎 Bukti Pembayaran Sudah Diterima!</strong><br><span style="color:var(--muted);">Tim Admin kami sedang memverifikasi pembayaran Anda.</span></div>' +
                '<button type="button" class="btn btn-outline btn-sm btn-reupload-proof">Unggah Ulang Bukti</button>' +
              '</div>' +
              '<div class="trk-proof-slot hidden" style="margin-bottom:12px;"></div>'
            : '<div class="trk-proof-slot" style="margin-bottom:12px;"></div>'
          ) +
          '<a href="' + esc(buildCustomerWaConfirmUrl(o, hasBukti ? 'Mohon bantuannya cek bukti pembayaran pesanan saya.' : '')) + '" target="_blank" rel="noopener" class="btn btn-wa btn-sm" style="width:100%;text-align:center;">💬 Hubungi / Konfirmasi ke WhatsApp Admin</a>'
        ) : '') +

        (isPaid ? (
          '<div style="background:var(--wa-soft);border:1px solid rgba(16,185,129,0.35);border-radius:12px;padding:14px;margin-bottom:12px;">' +
            '<div style="font-weight:800;color:#059669;margin-bottom:6px;">✅ Pembayaran Terverifikasi (' + esc(st) + ')</div>' +
            (o.kunci_lisensi
              ? '<div style="background:var(--surface);padding:10px 12px;border-radius:10px;border:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px;">' +
                  '<div><div style="font-size:0.74rem;color:var(--muted);font-weight:700;">🔑 KUNCI LISENSI / KODE AKSES RESMI:</div><code style="font-size:0.95rem;font-weight:800;color:var(--primary);">' + esc(o.kunci_lisensi) + '</code></div>' +
                  '<button type="button" class="copy-pill-btn" data-copy-val="' + esc(o.kunci_lisensi) + '" data-copy-lbl="Kunci Lisensi">📋 Salin Lisensi</button>' +
                '</div>'
              : '<div style="font-size:0.82rem;color:var(--muted);">Pesanan sedang disiapkan oleh tim teknis kami. Kunci lisensi / akses produk akan segera muncul di halaman ini begitu berstatus <strong>Selesai</strong>.</div>'
            ) +
          '</div>' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
            '<button type="button" class="btn btn-primary btn-sm btn-cust-invoice" data-inv-idx="' + idx + '">🧾 Lihat &amp; Cetak Faktur Resmi (PDF)</button>' +
            '<a href="' + esc(buildCustomerWaConfirmUrl(o, 'Halo Admin, saya ingin menanyakan progres/panduan pesanan saya.')) + '" target="_blank" rel="noopener" class="btn btn-outline btn-sm">💬 Bantuan Teknis via WA</a>' +
          '</div>'
        ) : '') +
      '</div>';
    }).join('');

    host.querySelectorAll('[data-trk-card]').forEach(function (cardEl) {
      const idx = Number(cardEl.getAttribute('data-trk-card'));
      const ord = orders[idx];
      cardEl.querySelectorAll('[data-copy-val]').forEach(function (b) {
        b.onclick = function () { copyText(b.getAttribute('data-copy-val'), b.getAttribute('data-copy-lbl')); };
      });
      const pmSlot = cardEl.querySelector('.trk-pay-methods-slot');
      if (pmSlot) bindPaymentMethodTabs(pmSlot);

      const proofSlot = cardEl.querySelector('.trk-proof-slot');
      if (proofSlot && !proofSlot.classList.contains('hidden')) {
        renderProofUploadWidget(proofSlot, ord, function () { executePublicOrderLookup(); });
      }
      const reBtn = cardEl.querySelector('.btn-reupload-proof');
      if (reBtn && proofSlot) {
        reBtn.onclick = function () {
          proofSlot.classList.toggle('hidden');
          if (!proofSlot.innerHTML) renderProofUploadWidget(proofSlot, ord, function () { executePublicOrderLookup(); });
        };
      }
      const invBtn = cardEl.querySelector('.btn-cust-invoice');
      if (invBtn) {
        invBtn.onclick = function () { openCustomerInvoiceModal(ord); };
      }
    });
  }

  function openCustomerInvoiceModal(o) {
    if (!o) return;
    const st = STATE.settings || {};
    const sig = o.invoiceSig || 'VERIFIED';
    const verifyText = (RAW_GAS_URL ? RAW_GAS_URL + '?action=verifyInvoice&orderId=' + encodeURIComponent(o.id_pesanan) + '&sig=' + encodeURIComponent(sig) : 'NUSASTORE-OFFICIAL-' + o.id_pesanan + '-' + sig);
    const qrImgUrl = 'https://quickchart.io/qr?size=130&text=' + encodeURIComponent(verifyText);

    $('mae-title').textContent = '🧾 Faktur Pembelian Resmi — ' + o.id_pesanan;
    $('mae-body').innerHTML =
      '<div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">' +
        '<button type="button" class="btn btn-primary btn-sm" id="btn-cust-inv-print">🖨️ Cetak / Simpan PDF</button>' +
      '</div>' +
      '<div id="invoice-print-area" class="invoice-sheet">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0F172A;padding-bottom:18px;margin-bottom:20px;">' +
          '<div>' +
            '<h2 style="margin:0;color:#2563EB;font-size:1.5rem;">' + esc(st.nama_toko || 'NusaStore') + '</h2>' +
            '<div style="font-weight:700;font-size:0.9rem;">' + esc(st.nama_perusahaan || DEMO_DB.settings.nama_perusahaan) + '</div>' +
            '<div style="font-size:0.78rem;color:#475569;max-width:340px;">' + esc(st.alamat_toko || DEMO_DB.settings.alamat_toko) + '</div>' +
            ((st.npwp || DEMO_DB.settings.npwp) ? '<div style="font-size:0.76rem;color:#475569;">NPWP: ' + esc(st.npwp || DEMO_DB.settings.npwp) + '</div>' : '') +
          '</div>' +
          '<div style="text-align:right;">' +
            '<div style="font-size:1.3rem;font-weight:800;letter-spacing:0.06em;">INVOICE RESMI</div>' +
            '<div style="font-size:0.86rem;font-weight:700;color:#2563EB;">#' + esc(o.id_pesanan) + '</div>' +
            '<div style="font-size:0.78rem;color:#64748B;">Tanggal: ' + esc(fmtDateShort(o.tanggal_order)) + '</div>' +
            '<div style="margin-top:6px;display:inline-block;padding:3px 10px;border-radius:99px;background:#ECFDF5;color:#059669;font-weight:800;font-size:0.75rem;">STATUS: ' + esc(String(o.status_pesanan).toUpperCase()) + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="margin-bottom:18px;font-size:0.86rem;">' +
          '<div style="color:#64748B;font-size:0.74rem;text-transform:uppercase;font-weight:700;">Ditagihkan Kepada:</div>' +
          '<strong>' + esc(o.nama_pelanggan) + '</strong><br>WhatsApp: +' + esc(o.no_whatsapp) +
        '</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:0.86rem;margin-bottom:20px;">' +
          '<thead><tr style="background:#0F172A;color:#FFF;"><th style="padding:10px;text-align:left;">Deskripsi Produk / Layanan</th><th style="padding:10px;text-align:center;">Qty</th><th style="padding:10px;text-align:right;">Subtotal</th></tr></thead>' +
          '<tbody><tr>' +
            '<td style="padding:12px 10px;border-bottom:1px solid #E2E8F0;"><strong>' + esc(o.nama_produk) + '</strong>' +
              (o.kunci_lisensi ? '<br><small style="color:#2563EB;">Lisensi Resmi: ' + esc(o.kunci_lisensi) + '</small>' : '') + '</td>' +
            '<td style="padding:12px 10px;border-bottom:1px solid #E2E8F0;text-align:center;">' + esc(o.qty || 1) + '</td>' +
            '<td style="padding:12px 10px;border-bottom:1px solid #E2E8F0;text-align:right;font-weight:700;">Rp ' + rupiah(o.total_harga) + '</td>' +
          '</tr></tbody>' +
        '</table>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap;padding-top:12px;">' +
          '<div style="display:flex;align-items:center;gap:12px;">' +
            '<img src="' + esc(qrImgUrl) + '" width="88" height="88" alt="QR Verifikasi" style="border:1px solid #E2E8F0;border-radius:8px;padding:4px;">' +
            '<div style="font-size:0.74rem;color:#475569;">' +
              '<strong>Terverifikasi Kriptografis (HMAC)</strong><br>Signature: <code>' + esc(sig) + '</code>' +
            '</div>' +
          '</div>' +
          '<div style="text-align:right;">' +
            '<div style="font-size:0.8rem;color:#64748B;">Total Pembayaran</div>' +
            '<div style="font-size:1.5rem;font-weight:800;color:#0F172A;">Rp ' + rupiah(o.total_harga) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    $('btn-cust-inv-print').onclick = function () { window.print(); };
    openOverlay('modal-admin-editor');
  }

  // ── TESTIMONI INTERAKTIF: 3D AUTO-FLIP + HOVER GLOW + POP-UP LENGKAP ───────
  let testiFlipTimer = null;
  let testiFlipCursor = 0;

  function fmtDateClean(raw) {
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}T/.test(String(raw))) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    return String(raw);
  }

  function renderTestimonials() {
    const grid = $('testi-grid');
    if (!grid) return;
    const list = STATE.testimonials;
    if (!list.length) {
      grid.innerHTML = '<div class="panel-card" style="grid-column:1/-1;text-align:center;">Belum ada testimoni ditampilkan.</div>';
      return;
    }

    grid.innerHTML = list.map(function (t, idx) {
      const stars = '★'.repeat(Math.max(1, Math.min(5, Number(t.rating) || 5)));
      const initials = String(t.nama || 'N').split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
      const avatarHtml = t.avatar_url
        ? '<img class="tcard-avatar" src="' + esc(t.avatar_url) + '" alt="' + esc(t.nama) + '" loading="lazy">'
        : '<div class="tcard-avatar">' + esc(initials) + '</div>';

      return '<div class="tcard-scene" data-tid="' + esc(t.id_testimoni) + '" data-tidx="' + idx + '">' +
        '<div class="tcard-glow-ring"></div>' +
        '<div class="tcard-inner">' +
          // SISI DEPAN
          '<div class="tcard-face tcard-front">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
              '<span class="tcard-stars">' + stars + '</span>' +
              (t.terverifikasi === 'Ya' ? '<span class="tcard-verified">✓ Pembeli Terverifikasi</span>' : '<span class="pill pill-Diproses">Ulasan Pelanggan</span>') +
            '</div>' +
            '<p class="tcard-quote">“' + esc(t.kutipan_singkat) + '”</p>' +
            '<div class="tcard-author">' +
              '<div class="tcard-person">' +
                avatarHtml +
                '<div>' +
                  '<div style="font-weight:800;font-size:0.88rem;">' + esc(t.nama) + '</div>' +
                  '<div style="font-size:0.74rem;color:var(--muted);">' + esc(t.jabatan_perusahaan) + '</div>' +
                '</div>' +
              '</div>' +
              '<button type="button" class="tcard-flip-btn" data-manual-flip="' + esc(t.id_testimoni) + '" title="Putar Kartu">↻ Balik</button>' +
            '</div>' +
          '</div>' +

          // SISI BELAKANG
          '<div class="tcard-face tcard-back">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;">' +
              '<span style="font-size:0.73rem;color:#7DD3FC;font-weight:800;letter-spacing:0.06em;">HASIL &amp; DAMPAK NYATA</span>' +
              '<span style="font-size:0.73rem;color:#CBD5E1;">' + esc(fmtDateClean(t.tanggal)) + '</span>' +
            '</div>' +
            '<div class="tcard-impact-box">' +
              '<small>Highlight Pencapaian</small>' +
              '<strong>🚀 ' + esc(t.hasil_highlight || 'Transaksi & Layanan Memuaskan') + '</strong>' +
            '</div>' +
            '<div style="font-size:0.8rem;color:#CBD5E1;">' +
              '<div style="color:#93C5FD;font-size:0.72rem;font-weight:700;">Produk / Layanan yang Digunakan:</div>' +
              '<strong>' + esc(t.produk_terkait || 'NusaStore Suite') + '</strong>' +
            '</div>' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;">' +
              '<button type="button" class="btn btn-primary btn-sm btn-shimmer" data-open-testi="' + esc(t.id_testimoni) + '" style="flex:1;">📖 Baca Pop-Up Lengkap</button>' +
              '<button type="button" class="tcard-flip-btn" data-manual-flip="' + esc(t.id_testimoni) + '" style="background:rgba(255,255,255,0.12);color:#FFF;border-color:rgba(255,255,255,0.2);">↻</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    startTestimonialAutoFlip();
  }

  function startTestimonialAutoFlip() {
    if (testiFlipTimer) clearInterval(testiFlipTimer);
    testiFlipTimer = setInterval(function () {
      if (document.visibilityState !== 'visible' || $('view-storefront').classList.contains('hidden')) return;
      const cards = document.querySelectorAll('.tcard-scene');
      if (!cards.length) return;
      const target = cards[testiFlipCursor % cards.length];
      testiFlipCursor++;
      if (!target || target.matches(':hover')) return;
      target.classList.toggle('is-flipped');
    }, 3400);
  }

  function openTestimonialPopup(tid) {
    const t = STATE.testimonials.find(function (x) { return x.id_testimoni === tid; });
    if (!t) return;
    const stars = '★'.repeat(Math.max(1, Math.min(5, Number(t.rating) || 5)));
    const initials = String(t.nama || 'N').split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    const relatedProd = STATE.products.find(function (p) {
      return t.produk_terkait && p.nama_produk.toLowerCase().indexOf(t.produk_terkait.toLowerCase().slice(0, 14)) >= 0;
    });

    $('mtd-body').innerHTML =
      '<div style="display:flex;align-items:center;gap:14px;margin-bottom:18px;">' +
        (t.avatar_url
          ? '<img src="' + esc(t.avatar_url) + '" style="width:62px;height:62px;border-radius:50%;object-fit:cover;border:3px solid var(--cyan);" alt="">'
          : '<div class="tcard-avatar" style="width:62px;height:62px;font-size:1.3rem;">' + esc(initials) + '</div>') +
        '<div style="flex:1;">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
            '<h3 style="margin:0;font-size:1.15rem;">' + esc(t.nama) + '</h3>' +
            (t.terverifikasi === 'Ya' ? '<span class="tcard-verified">✓ Transaksi Terverifikasi</span>' : '') +
          '</div>' +
          '<div style="color:var(--muted);font-size:0.86rem;">' + esc(t.jabatan_perusahaan) + ' • ' + esc(fmtDateClean(t.tanggal)) + '</div>' +
          '<div style="color:#F59E0B;font-size:1rem;margin-top:3px;">' + stars + ' <strong style="color:var(--text);">(' + (t.rating || 5) + '.0 / 5.0)</strong></div>' +
        '</div>' +
      '</div>' +

      '<div style="padding:14px 18px;border-radius:14px;background:linear-gradient(135deg,#0F172A,#1E3A8A);color:#FFFFFF;margin-bottom:18px;">' +
        '<div style="font-size:0.72rem;color:#7DD3FC;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;">Dampak &amp; Pencapaian Utama</div>' +
        '<div style="font-family:var(--font-display);font-size:1.12rem;font-weight:800;margin-top:4px;">🚀 ' + esc(t.hasil_highlight || 'Kepuasan Pelanggan Terverifikasi') + '</div>' +
      '</div>' +

      '<blockquote style="margin:0 0 16px;padding:14px 18px;border-left:4px solid var(--primary);background:var(--surface-2);border-radius:0 12px 12px 0;font-weight:600;font-size:0.96rem;">' +
        '“' + esc(t.kutipan_singkat) + '”' +
      '</blockquote>' +

      '<div style="font-size:0.92rem;line-height:1.7;color:var(--text-2);margin-bottom:20px;white-space:pre-line;">' +
        esc(t.cerita_lengkap || t.kutipan_singkat) +
      '</div>' +

      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding-top:16px;border-top:1px solid var(--border);">' +
        '<div>' +
          '<small style="color:var(--muted);display:block;">Produk yang Digunakan:</small>' +
          '<strong>' + esc(t.produk_terkait || 'NusaStore Suite') + '</strong>' +
        '</div>' +
        (relatedProd
          ? '<button type="button" class="btn btn-primary btn-shimmer" id="mtd-view-prod">🔍 Lihat Produk Ini</button>'
          : '<a href="#products" class="btn btn-primary" data-close="modal-testimoni-detail">Jelajahi Katalog</a>') +
      '</div>';

    const btnProd = $('mtd-view-prod');
    if (btnProd && relatedProd) {
      btnProd.onclick = function () {
        closeOverlay('modal-testimoni-detail');
        openProductModal(relatedProd.id_produk);
      };
    }
    openOverlay('modal-testimoni-detail');
    sayMascot('Kisah nyata pelanggan kami! 🌟', 2800);
  }

  function populateTestiProductSelect() {
    const sel = $('testi-prod-select');
    if (!sel) return;
    sel.innerHTML = STATE.products.map(function (p) {
      return '<option value="' + esc(p.nama_produk) + '">' + esc(p.nama_produk) + '</option>';
    }).join('') + '<option value="Layanan Konsultasi NusaStore">Layanan Konsultasi NusaStore</option>';
  }

  // ── FLOATING WHATSAPP CHAT ──────────────────────────────────────────────────
  function openDirectWaChat(text) {
    const waAdmin = normPhone(STATE.settings.nomor_wa_admin || '6281288009900');
    const msg = text || ('Halo ' + (STATE.settings.nama_toko || 'NusaStore') + ', saya ingin bertanya mengenai produk di website.');
    window.open('https://wa.me/' + waAdmin + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
  }

  // ── KARAKTER HIDUP PENGIKUT KURSOR ("NUSA BUDDY") ───────────────────────────
  const _isCoarseTouch = Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const _savedMascotPref = localStorage.getItem(LS.MASCOT_DOCK);
  const MASCOT = {
    docked: _savedMascotPref !== null ? (_savedMascotPref === '1') : _isCoarseTouch,
    rafRunning: false,
    mouseX: window.innerWidth * 0.72,
    mouseY: window.innerHeight * 0.45,
    x: window.innerWidth * 0.72,
    y: window.innerHeight * 0.45,
    vx: 0,
    vy: 0,
    speechTimer: null,
    lastHoverTag: ''
  };

  function sayMascot(text, durationMs) {
    if (MASCOT.docked) return;
    const sp = $('nusa-speech');
    if (!sp) return;
    sp.textContent = text;
    sp.classList.add('is-visible');
    if (MASCOT.speechTimer) clearTimeout(MASCOT.speechTimer);
    MASCOT.speechTimer = setTimeout(function () {
      sp.classList.remove('is-visible');
    }, durationMs || 2600);
  }

  function initLifelikeMascot() {
    const layer = $('nusa-mascot-layer');
    const rig = $('nusa-rig');
    const head = $('nusa-head');
    const armL = $('nusa-arm-left');
    const armR = $('nusa-arm-right');
    const shadow = $('nusa-shadow');
    const thruster = $('nusa-thruster');
    const eyelids = $('nusa-eyelids');
    const mouth = $('nusa-mouth');
    const pupils = document.querySelectorAll('.nusa-pupil-group');
    const dockBtn = $('mascot-dock-btn');
    const dockLbl = $('mascot-dock-label');
    if (!layer || !rig) return;

    let frame = 0;
    function tickMascot() {
      if (MASCOT.docked || document.visibilityState === 'hidden') {
        MASCOT.rafRunning = false;
        return;
      }
      MASCOT.rafRunning = true;
      frame++;
      // Offset cerdas agar karakter selalu di samping kursor tanpa menutupi area klik
      const offsetX = MASCOT.mouseX > window.innerWidth - 150 ? -108 : 26;
      const offsetY = MASCOT.mouseY > window.innerHeight - 150 ? -115 : 18;
      const tx = Math.max(8, Math.min(window.innerWidth - 104, MASCOT.mouseX + offsetX));
      const ty = Math.max(12, Math.min(window.innerHeight - 116, MASCOT.mouseY + offsetY));

      const ax = (tx - MASCOT.x) * 0.085;
      const ay = (ty - MASCOT.y) * 0.085;
      MASCOT.vx = (MASCOT.vx + ax) * 0.78;
      MASCOT.vy = (MASCOT.vy + ay) * 0.78;
      MASCOT.x += MASCOT.vx;
      MASCOT.y += MASCOT.vy;

      // Gerak napas lembut + kemiringan proporsional kecepatan
      const bob = Math.sin(frame * 0.065) * 4.5;
      const tilt = Math.max(-18, Math.min(18, MASCOT.vx * 1.35));
      const headTilt = Math.max(-10, Math.min(10, MASCOT.vx * 0.7));

      layer.style.transform = 'translate3d(' + MASCOT.x.toFixed(1) + 'px,' + MASCOT.y.toFixed(1) + 'px,0)';
      rig.style.transform = 'translateY(' + bob.toFixed(2) + 'px) rotate(' + tilt.toFixed(2) + 'deg)';
      if (head) head.style.transform = 'rotate(' + headTilt.toFixed(2) + 'deg)';

      // Ayunan lengan kanan & kiri yang hidup
      const swing = Math.sin(frame * 0.09) * 8 + Math.max(-22, Math.min(22, -MASCOT.vy * 1.4));
      if (armL) armL.style.transform = 'rotate(' + (10 + swing).toFixed(1) + 'deg)';
      if (armR) armR.style.transform = 'rotate(' + (-10 - swing).toFixed(1) + 'deg)';

      // Skala bayangan & pendorong jet
      const shadowScale = 1 - (bob + 4.5) * 0.025;
      if (shadow) shadow.setAttribute('rx', (25 * shadowScale).toFixed(1));
      if (thruster) thruster.setAttribute('rx', (12 + Math.abs(Math.sin(frame * 0.22)) * 3.5).toFixed(1));

      // Pelacakan pupil mata menatap tepat ke arah kursor
      const centerX = MASCOT.x + 48;
      const centerY = MASCOT.y + 38;
      const dx = MASCOT.mouseX - centerX;
      const dy = MASCOT.mouseY - centerY;
      const dist = Math.min(3.4, Math.hypot(dx, dy) / 28);
      const ang = Math.atan2(dy, dx);
      const px = (Math.cos(ang) * dist).toFixed(2);
      const py = (Math.sin(ang) * dist).toFixed(2);
      pupils.forEach(function (pg) {
        pg.setAttribute('transform', 'translate(' + px + ',' + py + ')');
      });

      requestAnimationFrame(tickMascot);
    }

    function ensureMascotLoop() {
      if (!MASCOT.docked && !MASCOT.rafRunning) {
        MASCOT.rafRunning = true;
        requestAnimationFrame(tickMascot);
      }
    }

    function syncDockState() {
      layer.classList.toggle('is-docked', MASCOT.docked);
      if (dockLbl) dockLbl.textContent = MASCOT.docked ? 'Panggil Nusa Buddy' : 'Nusa Buddy: Aktif';
      ensureMascotLoop();
    }
    syncDockState();

    if (dockBtn) {
      dockBtn.onclick = function () {
        MASCOT.docked = !MASCOT.docked;
        localStorage.setItem(LS.MASCOT_DOCK, MASCOT.docked ? '1' : '0');
        syncDockState();
        if (!MASCOT.docked) sayMascot('Halo lagi Kak! Aku siap menemani! ✨', 3000);
      };
    }

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') ensureMascotLoop();
    });

    if (!_isCoarseTouch) {
      window.addEventListener('mousemove', function (e) {
        MASCOT.mouseX = e.clientX;
        MASCOT.mouseY = e.clientY;

        // Update posisi radial spotlight (--mx, --my) jika kursor di atas kartu produk
        const pcard = e.target && e.target.closest ? e.target.closest('.pcard') : null;
        if (pcard) {
          const rect = pcard.getBoundingClientRect();
          pcard.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
          pcard.style.setProperty('--my', (e.clientY - rect.top) + 'px');
        }

        // Reaksi kontekstual karakter saat kursor berpindah elemen
        if (!MASCOT.docked && e.target && e.target.closest) {
          if (pcard && MASCOT.lastHoverTag !== 'pcard') {
            MASCOT.lastHoverTag = 'pcard';
            if (mouth) mouth.setAttribute('d', 'M53 53 Q60 61 67 53');
            sayMascot('Klik untuk lihat galeri & detailnya! ✨', 2100);
          } else if (e.target.closest('.tcard-scene') && MASCOT.lastHoverTag !== 'tcard') {
            MASCOT.lastHoverTag = 'tcard';
            sayMascot('Klik kartu untuk baca kisah lengkapnya! 🌟', 2200);
          } else if (e.target.closest('.btn-wa, #wa-float-btn') && MASCOT.lastHoverTag !== 'wa') {
            MASCOT.lastHoverTag = 'wa';
            sayMascot('Langsung terhubung ke WhatsApp CS! 💬', 2100);
          } else if (!pcard && !e.target.closest('.tcard-scene') && !e.target.closest('.btn-wa, #wa-float-btn')) {
            MASCOT.lastHoverTag = '';
            if (mouth) mouth.setAttribute('d', 'M55 54 Q60 58.5 65 54');
          }
        }
      }, { passive: true });
    } else {
      window.addEventListener('touchstart', function (e) {
        if (MASCOT.docked || !e.touches || !e.touches[0]) return;
        MASCOT.mouseX = e.touches[0].clientX;
        MASCOT.mouseY = e.touches[0].clientY;
      }, { passive: true });
    }

    // Kedipan mata alami secara acak
    function scheduleBlink() {
      const nextMs = 2400 + Math.random() * 3400;
      setTimeout(function () {
        if (!MASCOT.docked && eyelids) {
          eyelids.setAttribute('opacity', '1');
          pupils.forEach(function (p) { p.style.opacity = '0.1'; });
          setTimeout(function () {
            eyelids.setAttribute('opacity', '0');
            pupils.forEach(function (p) { p.style.opacity = '1'; });
          }, 145);
        }
        scheduleBlink();
      }, nextMs);
    }
    scheduleBlink();

    ensureMascotLoop();
    if (!MASCOT.docked) {
      setTimeout(function () { sayMascot('Halo Kak! Aku Nusa, siap menemani belanja ✨', 3600); }, 900);
    }
  }

  // ── ADMIN PORTAL: AUTENTIKASI, TELEMETRI & SHELL ────────────────────────────
  let adminPollTimer = null;

  function updateTelemetryBar() {
    const el = $('admin-telemetry');
    if (el) {
      el.textContent = (IS_DEMO ? 'Mode Simulasi Lokal' : 'Terhubung ke Google Sheets') +
        ' • Latensi Server: ' + STATE.lastMs + ' ms' +
        (STATE.queueFlag ? ' • ⚡ Antrean Notifikasi Aktif' : '');
    }
    const qBadge = $('nav-badge-queue');
    const waiting = STATE.adminData.notifCrm && STATE.adminData.notifCrm.queueStats ? STATE.adminData.notifCrm.queueStats.waiting : 0;
    if (qBadge) {
      qBadge.textContent = String(waiting);
      qBadge.classList.toggle('hidden', waiting <= 0);
    }
    const pBadge = $('nav-badge-pending');
    const pendingOrders = (STATE.adminData.orders || []).filter(function (o) { return o.status_pesanan === 'Pending'; }).length;
    if (pBadge) {
      pBadge.textContent = String(pendingOrders);
      pBadge.classList.toggle('hidden', pendingOrders <= 0);
    }
  }

  async function enterAdminPortal(bootPayload) {
    let usedCache = false;
    if (!bootPayload) {
      try {
        const rawBoot = sessionStorage.getItem(LS.ADMIN_BOOT);
        if (rawBoot) {
          bootPayload = JSON.parse(rawBoot);
          usedCache = true;
        }
      } catch (e) { /* skip */ }
    }

    if (bootPayload) {
      // 0ms Instant Open: tampilkan langsung tanpa delay
      ingestAdminBootstrap(bootPayload);
      $('view-storefront').classList.add('hidden');
      $('wa-float-wrap').classList.add('hidden');
      $('view-admin').classList.remove('hidden');
      renderAdminActiveTab();
      startAdminAdaptivePolling();

      // Bila memakai snapshot sesi, segarkan diam-diam di latar belakang
      if (usedCache) {
        apiCall('adminBootstrap', {}, 'POST').then(function (res) {
          if (res && res.success && res.data) {
            ingestAdminBootstrap(res.data);
            if (!$('view-admin').classList.contains('hidden')) renderAdminActiveTab();
          }
        }).catch(function () {});
      }
      return;
    }

    const res = await apiCall('adminBootstrap', {}, 'POST');
    if (!res.success) return;
    ingestAdminBootstrap(res.data);
    $('view-storefront').classList.add('hidden');
    $('wa-float-wrap').classList.add('hidden');
    $('view-admin').classList.remove('hidden');
    renderAdminActiveTab();
    startAdminAdaptivePolling();
  }

  function exitAdminToStorefront() {
    $('view-admin').classList.add('hidden');
    $('view-storefront').classList.remove('hidden');
    $('wa-float-wrap').classList.remove('hidden');
    renderHeroSlideshow();
    renderCategories();
    renderCatalog();
    renderTestimonials();
  }

  function ingestAdminBootstrap(d) {
    if (!d) return;
    try { sessionStorage.setItem(LS.ADMIN_BOOT, JSON.stringify(d)); } catch (e) { /* quota */ }
    if (d.settings) STATE.settings = d.settings;
    if (d.heroSlides) STATE.heroSlides = d.heroSlides;
    if (d.categories) STATE.categories = d.categories;
    if (d.products) {
      STATE.products = d.products.map(function (p) {
        if (!Array.isArray(p.images) || !p.images.length) {
          p.images = [p.gambar_url].concat(String(p.galeri_url || '').split(/[\r\n|,]+/)).map(function (u) { return String(u || '').trim(); }).filter(Boolean);
        }
        return p;
      });
    }
    if (d.testimonials) {
      STATE.adminData.testimonials = d.testimonials;
      STATE.testimonials = d.testimonials.filter(function (t) { return t.tampil === 'Ya'; });
    }
    if (d.orders) STATE.adminData.orders = d.orders;
    if (d.licenses) STATE.adminData.licenses = d.licenses;
    if (d.waLog) STATE.adminData.waLog = d.waLog;
    if (d.notifCrm) STATE.adminData.notifCrm = d.notifCrm;
    if (d.secrets) STATE.adminData.secrets = d.secrets;
    if (d.meta) STATE.adminData.meta = d.meta;
    if (d.versions) STATE.adminData.versions = d.versions;

    const btnSh = $('btn-open-sheets');
    if (btnSh) {
      if (d.meta && d.meta.spreadsheetUrl) {
        btnSh.href = d.meta.spreadsheetUrl;
        btnSh.classList.remove('hidden');
      } else {
        btnSh.classList.add('hidden');
      }
    }
    updateTelemetryBar();
  }

  function startAdminAdaptivePolling() {
    if (adminPollTimer) clearInterval(adminPollTimer);
    adminPollTimer = setInterval(async function () {
      if (!STATE.adminToken || document.visibilityState !== 'visible' || $('view-admin').classList.contains('hidden')) return;
      const v = STATE.adminData.versions || {};
      const res = await apiCall('adminSync', { vOrders: v.orders, vCatalog: v.catalog, vCrm: v.crm }, 'POST');
      if (res && res.success && res.data) {
        const d = res.data;
        let changed = false;
        if (d.orders) { STATE.adminData.orders = d.orders; STATE.adminData.licenses = d.licenses || []; STATE.adminData.waLog = d.waLog || []; changed = true; }
        if (d.products) { STATE.products = d.products; STATE.categories = d.categories || []; STATE.adminData.testimonials = d.testimonials || []; changed = true; }
        if (d.notifCrm) { STATE.adminData.notifCrm = d.notifCrm; changed = true; }
        if (d.versions) STATE.adminData.versions = d.versions;
        if (changed) { updateTelemetryBar(); renderAdminActiveTab(); }
      }
    }, 30000);
  }

  function renderAdminActiveTab() {
    const titles = {
      overview: 'Ringkasan Penjualan & Analitik',
      orders: 'Manajemen Transaksi, Bukti Transfer & Faktur',
      catalog: 'Katalog Produk Multi-Gambar, Kategori & Testimoni',
      crm: 'CRM Kontak Pelanggan & Riwayat Interaksi',
      notif: 'Pusat Notifikasi WA Fonnte, Email & Blast Massal',
      licenses: 'License Vault — Alokasi Kode Lisensi Otomatis',
      migrasi: 'Migrasi & Sinkronisasi Database Spreadsheet',
      settings: 'Pengaturan Identitas Toko, Slide Hero & Keamanan'
    };
    $('admin-page-title').textContent = titles[STATE.adminTab] || 'Admin Portal';
    document.querySelectorAll('.admin-nav-btn[data-tab]').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-tab') === STATE.adminTab);
    });

    const host = $('admin-panel-host');
    if (STATE.adminTab === 'overview') renderAdminOverview(host);
    else if (STATE.adminTab === 'orders') renderAdminOrders(host);
    else if (STATE.adminTab === 'catalog') renderAdminCatalog(host);
    else if (STATE.adminTab === 'crm') renderAdminCrm(host);
    else if (STATE.adminTab === 'notif') renderAdminNotif(host);
    else if (STATE.adminTab === 'licenses') renderAdminLicenses(host);
    else if (STATE.adminTab === 'migrasi') renderAdminMigrasi(host);
    else if (STATE.adminTab === 'settings') renderAdminSettings(host);
  }

  // ── PANEL ADMIN 1: OVERVIEW & ANALITIK ──────────────────────────────────────
  function renderAdminOverview(host) {
    const orders = STATE.adminData.orders || [];
    const paid = orders.filter(function (o) { return ['Lunas', 'Diproses', 'Selesai'].indexOf(o.status_pesanan) >= 0; });
    const revenue = paid.reduce(function (s, o) { return s + (Number(o.total_harga) || 0); }, 0);
    const pending = orders.filter(function (o) { return o.status_pesanan === 'Pending'; }).length;
    const convRate = orders.length ? Math.round((paid.length / orders.length) * 100) : 0;
    const targetOmzet = Number(STATE.settings.target_omzet_bulanan) || 36500000;
    const targetPct = Math.min(100, Math.round((revenue / targetOmzet) * 100));

    // Hitung tren harian untuk SVG Area Chart
    const days = STATE.chartRange || 30;
    const buckets = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      buckets.push({ key: key, label: d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }), val: 0 });
    }
    paid.forEach(function (o) {
      const k = String(o.tanggal_order || '').slice(0, 10);
      const b = buckets.find(function (x) { return x.key === k; });
      if (b) b.val += Number(o.total_harga) || 0;
    });

    const maxVal = Math.max.apply(null, buckets.map(function (b) { return b.val; }).concat([1000000]));
    const W = 720, H = 200, pad = 20;
    const pts = buckets.map(function (b, idx) {
      const x = pad + (idx / Math.max(1, buckets.length - 1)) * (W - pad * 2);
      const y = H - pad - (b.val / maxVal) * (H - pad * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    const areaPath = 'M ' + pad + ',' + (H - pad) + ' L ' + pts.join(' L ') + ' L ' + (W - pad) + ',' + (H - pad) + ' Z';
    const linePath = 'M ' + pts.join(' L ');

    // Top Produk
    const prodAgg = {};
    paid.forEach(function (o) {
      const nm = o.nama_produk || 'Produk';
      prodAgg[nm] = (prodAgg[nm] || 0) + (Number(o.total_harga) || 0);
    });
    const topProds = Object.keys(prodAgg).map(function (k) { return { nama: k, omzet: prodAgg[k] }; })
      .sort(function (a, b) { return b.omzet - a.omzet; }).slice(0, 5);

    host.innerHTML =
      '<div class="kpi-grid">' +
        '<div class="kpi-card"><small>Total Omzet Terbayar</small><h3 style="color:var(--primary);">Rp ' + rupiah(revenue) + '</h3>' +
          '<div style="height:6px;background:var(--surface-2);border-radius:99px;overflow:hidden;margin-top:6px;"><div style="width:' + targetPct + '%;height:100%;background:linear-gradient(90deg,#2563EB,#0EA5E9);"></div></div>' +
          '<small>' + targetPct + '% dari target Rp ' + rupiah(targetOmzet) + '</small></div>' +
        '<div class="kpi-card"><small>Total Transaksi</small><h3>' + orders.length + '</h3><small style="color:#059669;">' + paid.length + ' Pesanan Lunas/Selesai</small></div>' +
        '<div class="kpi-card"><small>Menunggu Verifikasi</small><h3 style="color:#D97706;">' + pending + '</h3><small>Perlu tindak lanjut tagihan</small></div>' +
        '<div class="kpi-card"><small>Rasio Konversi Bayar</small><h3>' + convRate + '%</h3><small>Kontak CRM: ' + ((STATE.adminData.notifCrm && STATE.adminData.notifCrm.contacts) ? STATE.adminData.notifCrm.contacts.length : 0) + ' pelanggan</small></div>' +
      '</div>' +

      '<div class="admin-overview-split">' +
        '<div class="panel-card" style="margin:0;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px;">' +
            '<div><h3 style="margin:0;font-size:1.05rem;">Grafik Tren Pendapatan</h3><small style="color:var(--muted);">Akumulasi pesanan berstatus Lunas, Diproses &amp; Selesai</small></div>' +
            '<div style="display:flex;gap:6px;">' +
              '<button type="button" class="filter-chip ' + (days === 7 ? 'is-active' : '') + '" data-chart-days="7">7 Hari</button>' +
              '<button type="button" class="filter-chip ' + (days === 30 ? 'is-active' : '') + '" data-chart-days="30">30 Hari</button>' +
            '</div>' +
          '</div>' +
          '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;overflow:visible;">' +
            '<defs><linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2563EB" stop-opacity="0.36"/><stop offset="100%" stop-color="#2563EB" stop-opacity="0.01"/></linearGradient></defs>' +
            '<path d="' + areaPath + '" fill="url(#revGrad)"/>' +
            '<path d="' + linePath + '" fill="none" stroke="#2563EB" stroke-width="3" stroke-linecap="round"/>' +
          '</svg>' +
          '<div style="display:flex;justify-content:space-between;font-size:0.74rem;color:var(--muted);margin-top:6px;">' +
            '<span>' + esc(buckets[0].label) + '</span><span>' + esc(buckets[Math.floor(buckets.length / 2)].label) + '</span><span>' + esc(buckets[buckets.length - 1].label) + '</span>' +
          '</div>' +
        '</div>' +

        '<div class="panel-card" style="margin:0;">' +
          '<h3 style="margin:0 0 12px;font-size:1.05rem;">🏆 Produk Kontribusi Tertinggi</h3>' +
          (topProds.length ? topProds.map(function (tp, ix) {
            return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--border);gap:10px;">' +
              '<div style="font-size:0.84rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (ix + 1) + '. ' + esc(tp.nama) + '</div>' +
              '<strong class="tabular" style="font-size:0.84rem;color:var(--primary);flex-shrink:0;">Rp ' + rupiah(tp.omzet) + '</strong>' +
            '</div>';
          }).join('') : '<p style="color:var(--muted);font-size:0.86rem;">Belum ada data transaksi lunas.</p>') +
        '</div>' +
      '</div>' +

      '<div class="panel-card">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
          '<h3 style="margin:0;font-size:1.05rem;">Transaksi Terbaru</h3>' +
          '<button type="button" class="btn btn-outline btn-sm" id="ov-all-orders">Lihat Semua Transaksi &#8594;</button>' +
        '</div>' +
        renderOrderTableHtml(orders.slice().reverse().slice(0, 7)) +
      '</div>';

    host.querySelectorAll('[data-chart-days]').forEach(function (b) {
      b.onclick = function () { STATE.chartRange = Number(b.getAttribute('data-chart-days')); renderAdminOverview(host); };
    });
    const btnAll = $('ov-all-orders');
    if (btnAll) btnAll.onclick = function () { STATE.adminTab = 'orders'; renderAdminActiveTab(); };
    bindOrderTableActions(host);
  }

  // ── PANEL ADMIN 2: TRANSAKSI, BUKTI TRANSFER, EKSPOR & FAKTUR PDF ───────────
  function renderOrderTableHtml(rows) {
    if (!rows.length) return '<p style="text-align:center;color:var(--muted);padding:24px 0;">Tidak ada pesanan yang cocok.</p>';
    return '<div class="table-wrap"><table class="data-table">' +
      '<thead><tr><th>ID Pesanan</th><th>Tanggal</th><th>Pelanggan</th><th>Produk</th><th>Total</th><th>Status</th><th>Aksi</th></tr></thead>' +
      '<tbody>' + rows.map(function (o) {
        return '<tr>' +
          '<td><strong class="tabular">' + esc(o.id_pesanan) + '</strong><br><small style="color:var(--muted);">' + esc(o.sumber_pesanan || '') + '</small></td>' +
          '<td>' + esc(fmtDateShort(o.tanggal_order)) + '</td>' +
          '<td><strong>' + esc(o.nama_pelanggan) + '</strong><br><small style="color:var(--muted);">+' + esc(o.no_whatsapp) + '</small></td>' +
          '<td style="max-width:240px;">' + esc(o.nama_produk) + '</td>' +
          '<td class="tabular"><strong>Rp ' + rupiah(o.total_harga) + '</strong></td>' +
          '<td>' +
            '<select class="select" data-quick-status="' + esc(o.id_pesanan) + '" style="padding:5px 8px;font-size:0.78rem;width:auto;">' +
              ['Pending', 'Lunas', 'Diproses', 'Selesai', 'Batal'].map(function (st) {
                return '<option value="' + st + '"' + (o.status_pesanan === st ? ' selected' : '') + '>' + st + '</option>';
              }).join('') +
            '</select>' +
            (o.link_bukti_transfer ? '<div style="margin-top:4px;"><span class="pill pill-Diproses" style="font-size:0.68rem;">🧾 Bukti Klien Masuk</span></div>' : '') +
          '</td>' +
          '<td><div style="display:flex;gap:6px;">' +
            '<button type="button" class="btn btn-outline btn-sm" data-open-order="' + esc(o.id_pesanan) + '">Detail</button>' +
            '<button type="button" class="btn btn-primary btn-sm" data-open-invoice="' + esc(o.id_pesanan) + '">🧾 Faktur</button>' +
          '</div></td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  function bindOrderTableActions(container) {
    container.querySelectorAll('[data-quick-status]').forEach(function (sel) {
      sel.onchange = async function () {
        const id = sel.getAttribute('data-quick-status');
        const nextSt = sel.value;
        const idx = STATE.adminData.orders.findIndex(function (x) { return x.id_pesanan === id; });
        const prevSt = idx >= 0 ? STATE.adminData.orders[idx].status_pesanan : 'Pending';
        const notify = (nextSt === 'Lunas' && STATE.settings.notif_otomatis_lunas === 'Ya') ||
                       (nextSt === 'Selesai' && STATE.settings.notif_otomatis_selesai === 'Ya');

        // Optimistic UI (0ms tanpa delay): perbarui tampilan seketika sebelum server merespons
        if (idx >= 0) STATE.adminData.orders[idx].status_pesanan = nextSt;
        updateTelemetryBar();
        toast('Status pesanan ' + id + ' → ' + nextSt + (notify ? ' (Notifikasi masuk antrean)' : ''), 'ok');

        const res = await apiCall('adminUpdateOrder', { id: id, patch: { status_pesanan: nextSt }, opts: { notify: notify } }, 'POST');
        if (res.success) {
          if (idx >= 0 && res.data && res.data.order) STATE.adminData.orders[idx] = res.data.order;
          updateTelemetryBar();
        } else {
          // Rollback bila gagal
          if (idx >= 0) STATE.adminData.orders[idx].status_pesanan = prevSt;
          sel.value = prevSt;
          updateTelemetryBar();
          toast(res.message || 'Gagal memperbarui status.', 'err');
        }
      };
    });
    container.querySelectorAll('[data-open-order]').forEach(function (b) {
      b.onclick = function () { openOrderDetailDrawer(b.getAttribute('data-open-order')); };
    });
    container.querySelectorAll('[data-open-invoice]').forEach(function (b) {
      b.onclick = function () { openOfficialInvoiceModal(b.getAttribute('data-open-invoice')); };
    });
  }

  function getFilteredAdminOrders() {
    const all = (STATE.adminData.orders || []).slice().reverse();
    const q = STATE.orderSearch.trim().toLowerCase();
    return all.filter(function (o) {
      if (STATE.orderStatusFilter !== 'ALL' && o.status_pesanan !== STATE.orderStatusFilter) return false;
      if (q) {
        const hay = (o.id_pesanan + ' ' + o.nama_pelanggan + ' ' + o.no_whatsapp + ' ' + o.nama_produk).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function renderAdminOrders(host) {
    const filtered = getFilteredAdminOrders();

    host.innerHTML =
      '<div class="panel-card">' +
        '<div class="admin-toolbar-row">' +
          '<div class="chip-list">' +
            ['ALL', 'Pending', 'Lunas', 'Diproses', 'Selesai', 'Batal'].map(function (st) {
              return '<button type="button" class="filter-chip ' + (STATE.orderStatusFilter === st ? 'is-active' : '') + '" data-ord-filter="' + st + '">' + (st === 'ALL' ? 'Semua Status' : st) + '</button>';
            }).join('') +
          '</div>' +
          '<div class="admin-toolbar-controls">' +
            '<input type="search" id="ord-search-input" class="input admin-search-input" placeholder="Cari ID, nama, WA..." value="' + esc(STATE.orderSearch) + '">' +
            '<button type="button" class="btn btn-outline btn-sm" id="btn-export-csv">⬇️ CSV</button>' +
            '<button type="button" class="btn btn-outline btn-sm" id="btn-export-xlsx">📊 Excel (.xlsx)</button>' +
          '</div>' +
        '</div>' +
        '<div id="ord-table-host">' + renderOrderTableHtml(filtered) + '</div>' +
      '</div>';

    function refreshOrderTableInPlace() {
      const tblHost = $('ord-table-host');
      if (!tblHost) return;
      const rows = getFilteredAdminOrders();
      tblHost.innerHTML = renderOrderTableHtml(rows);
      bindOrderTableActions(tblHost);
    }

    host.querySelectorAll('[data-ord-filter]').forEach(function (b) {
      b.onclick = function () {
        STATE.orderStatusFilter = b.getAttribute('data-ord-filter');
        host.querySelectorAll('[data-ord-filter]').forEach(function (chip) {
          chip.classList.toggle('is-active', chip.getAttribute('data-ord-filter') === STATE.orderStatusFilter);
        });
        refreshOrderTableInPlace();
      };
    });
    const debouncedOrderSearch = debounce(refreshOrderTableInPlace, 75);
    $('ord-search-input').oninput = function (e) {
      STATE.orderSearch = e.target.value;
      debouncedOrderSearch();
    };
    $('btn-export-csv').onclick = function () { exportOrdersCsv(getFilteredAdminOrders()); };
    $('btn-export-xlsx').onclick = function () { exportOrdersXlsx(getFilteredAdminOrders()); };
    bindOrderTableActions($('ord-table-host') || host);
  }

  // ── OPSI 3: RENDER PESAN WA MANUAL & HYBRID FALLBACK DI SISI ADMIN ─────────
  function renderOrderWaTextClient(o, tplKey) {
    const st = STATE.settings || {};
    let items = [];
    try { items = JSON.parse(o.item_json || '[]'); } catch (e) { items = []; }
    const daftarItem = items.length
      ? items.map(function (i) { return '- ' + i.nama + ' x' + i.qty + ' = Rp ' + rupiah(i.subtotal || (i.harga * i.qty)); }).join('\n')
      : ('- ' + (o.nama_produk || 'Produk') + ' = Rp ' + rupiah(o.total_harga));

    const portalUrl = window.location.origin + window.location.pathname;
    const vars = {
      nama: o.nama_pelanggan || 'Kak',
      id_pesanan: o.id_pesanan || '',
      produk: o.nama_produk || '',
      total: rupiah(o.total_harga),
      status: o.status_pesanan || 'Pending',
      tanggal: fmtDateShort(o.tanggal_order),
      nama_toko: st.nama_toko || DEMO_DB.settings.nama_toko || 'NusaStore',
      rekening: st.rekening_bank || DEMO_DB.settings.rekening_bank || 'BCA 828-091-8899 a.n. PT Nusa Digital Teknologi',
      link_qris: st.link_qris || ('Cek menu Cek Pesanan di ' + portalUrl + ' atau balas pesan ini untuk gambar QRIS resmi.'),
      batas_bayar_jam: st.batas_bayar_jam || '24',
      kunci_lisensi: o.kunci_lisensi || '(Segera diaktifkan / cek menu Cek Pesanan di website)',
      link_invoice: portalUrl,
      catatan: o.catatan || '-',
      no_wa: o.no_whatsapp || '',
      daftar_item: daftarItem
    };

    const rawTpl = st[tplKey] || DEMO_DB.settings[tplKey] || 'Halo Kak *{nama}*, berikut informasi pesanan *{id_pesanan}* ({produk}) senilai *Rp {total}*.';
    return String(rawTpl).split('\n').map(function (line) {
      return line.replace(/\{(\w+)\}/g, function (m, k) {
        return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m;
      });
    }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function openManualWaForOrder(o, tplKey, customText) {
    const cleanTarget = normPhone(o.no_whatsapp);
    if (!cleanTarget) { toast('Nomor WhatsApp pelanggan kosong.', 'err'); return; }
    const msg = customText !== undefined ? customText : renderOrderWaTextClient(o, tplKey);
    window.open('https://wa.me/' + cleanTarget + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
    toast('Membuka WhatsApp ke +' + cleanTarget + ' dengan draf pesan siap kirim!', 'ok');
  }

  function openOrderDetailDrawer(orderId) {
    const o = (STATE.adminData.orders || []).find(function (x) { return x.id_pesanan === orderId; });
    if (!o) return;
    const hasFonnte = Boolean(
      (STATE.adminData.secrets && STATE.adminData.secrets.fonnte && STATE.adminData.secrets.fonnte.ada) ||
      (STATE.adminData.notifCrm && STATE.adminData.notifCrm.config && STATE.adminData.notifCrm.config.fonnteAda)
    );
    const hasClientProof = Boolean(o.link_bukti_transfer && String(o.link_bukti_transfer).trim());
    const proofThumb = hasClientProof ? driveImgClient(o.link_bukti_transfer) : '';
    const proofFallback = hasClientProof ? driveImgFallback(o.link_bukti_transfer) : '';

    $('dad-title').textContent = 'Pesanan ' + o.id_pesanan;
    $('dad-foot').classList.add('hidden');
    $('dad-body').innerHTML =
      '<div style="display:grid;gap:12px;">' +
        '<div style="padding:12px;background:var(--surface-2);border-radius:12px;">' +
          '<div><strong>Pelanggan:</strong> ' + esc(o.nama_pelanggan) + ' (+' + esc(o.no_whatsapp) + ')</div>' +
          '<div><strong>Produk:</strong> ' + esc(o.nama_produk) + '</div>' +
          '<div><strong>Total:</strong> <span style="color:var(--primary);font-weight:800;">Rp ' + rupiah(o.total_harga) + '</span></div>' +
          '<div><strong>Status:</strong> <span id="od-status-pill" class="pill pill-' + esc(o.status_pesanan) + '">' + esc(o.status_pesanan) + '</span></div>' +
          (o.kunci_lisensi ? '<div style="margin-top:6px;"><strong>Kunci Lisensi:</strong> <code>' + esc(o.kunci_lisensi) + '</code></div>' : '') +
        '</div>' +

        '<div class="field"><label>Metode Pembayaran Klien</label>' +
          '<input id="od-metode" class="input" value="' + esc(o.metode_bayar || '') + '" placeholder="Transfer BCA / QRIS">' +
        '</div>' +
        '<div class="field"><label>Catatan Internal / Pelanggan</label>' +
          '<textarea id="od-catatan" class="textarea" rows="2">' + esc(o.catatan || '') + '</textarea>' +
        '</div>' +
        '<button type="button" class="btn btn-primary btn-sm" id="od-save-btn">💾 Simpan Perubahan</button>' +

        '<hr style="border:none;border-top:1px solid var(--border);margin:6px 0;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
          '<h4 style="margin:0;font-size:0.92rem;">🧾 Bukti Transfer dari Klien</h4>' +
          (hasClientProof
            ? '<span class="pill pill-Lunas" style="font-size:0.68rem;">✓ Bukti Diterima</span>'
            : '<span class="pill pill-Pending" style="font-size:0.68rem;">⏳ Menunggu Klien</span>') +
        '</div>' +
        (hasClientProof
          ? '<div class="client-proof-card">' +
              '<div class="client-proof-meta">' +
                '<span>👤 Pengirim: <strong>' + esc(o.nama_pelanggan) + '</strong></span>' +
                '<span>💳 Metode: <strong>' + esc(o.metode_bayar || 'Transfer / QRIS') + '</strong></span>' +
              '</div>' +
              '<div class="client-proof-preview-box">' +
                '<img src="' + esc(proofThumb) + '" data-fb="' + esc(proofFallback) + '" alt="Bukti Transfer dari Klien" id="od-proof-img-preview">' +
                '<div id="od-proof-doc-fallback" style="display:none;padding:12px;font-size:0.78rem;color:var(--muted);">📄 Bukti transfer berformat PDF / Dokumen. Klik tombol <strong>Buka Bukti Asli</strong> untuk memeriksa detail transfer klien.</div>' +
              '</div>' +
              '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                '<button type="button" class="btn btn-outline btn-sm" id="od-zoom-proof-btn" style="flex:1;justify-content:center;">🔍 Lihat Bukti Penuh</button>' +
                '<a href="' + esc(o.link_bukti_transfer) + '" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="flex:1;justify-content:center;text-align:center;">🔗 Buka Bukti Asli</a>' +
              '</div>' +
              (o.status_pesanan === 'Pending'
                ? '<button type="button" class="btn btn-wa btn-sm" id="od-verify-lunas-btn" style="width:100%;justify-content:center;">✅ Terima Bukti &amp; Verifikasi Lunas (1-Klik)</button>'
                : '') +
            '</div>'
          : '<div class="client-proof-empty">' +
              '<div style="font-size:0.81rem;color:var(--text-2);line-height:1.5;">' +
                '<strong>Belum ada bukti transfer yang dikirim oleh klien (' + esc(o.nama_pelanggan) + ').</strong><br>' +
                '<span style="color:var(--muted);font-size:0.76rem;">Bukti transfer akan otomatis tampil di sini begitu klien mengirimkannya melalui Pop-Up Pembayaran atau menu <strong>💳 Cek Pesanan</strong> di halaman utama.</span>' +
              '</div>' +
              '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                '<button type="button" class="btn btn-outline btn-sm" id="od-refresh-proof-btn" style="flex:1;justify-content:center;">🔄 Cek Bukti Masuk</button>' +
                '<button type="button" class="btn btn-primary btn-sm" id="od-ask-proof-wa-btn" style="flex:1;justify-content:center;">💬 Minta Bukti Transfer (WA)</button>' +
              '</div>' +
            '</div>') +

        '<hr style="border:none;border-top:1px solid var(--border);margin:6px 0;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">' +
          '<h4 style="margin:0;font-size:0.92rem;">💬 Kirim Tagihan &amp; Info WhatsApp</h4>' +
          (hasFonnte
            ? '<span class="pill pill-Lunas" style="font-size:0.68rem;">🟢 Fonnte Otomatis Aktif</span>'
            : '<span class="pill pill-Diproses" style="font-size:0.68rem;">📲 Mode WA Manual (Tanpa Token)</span>') +
        '</div>' +
        '<small style="color:var(--muted);font-size:0.75rem;margin-top:-6px;">' +
          (hasFonnte
            ? 'Mengirim otomatis lewat API Fonnte (otomatis beralih ke WA Web bila koneksi Fonnte kendala).'
            : 'Membuka aplikasi WhatsApp / WA Web langsung dengan pesan tagihan lengkap siap kirim (Gratis).') +
        '</small>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
          '<button type="button" class="btn btn-outline btn-sm" data-wa-tpl="template_tagihan_transfer">🏦 Tagihan Bank</button>' +
          '<button type="button" class="btn btn-outline btn-sm" data-wa-tpl="template_tagihan_qris">📱 Tagihan QRIS</button>' +
          '<button type="button" class="btn btn-outline btn-sm" data-wa-tpl="template_pengingat">⏰ Pengingat</button>' +
          '<button type="button" class="btn btn-wa btn-sm" data-wa-tpl="template_pesan_selesai">🎉 Kirim Selesai</button>' +
        '</div>' +
        (hasFonnte
          ? '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">' +
              '<button type="button" class="btn btn-ghost btn-sm" data-wa-manual="template_tagihan_transfer" style="font-size:0.74rem;border:1px dashed var(--border);">📲 WA Manual: Bank</button>' +
              '<button type="button" class="btn btn-ghost btn-sm" data-wa-manual="template_pesan_selesai" style="font-size:0.74rem;border:1px dashed var(--border);">📲 WA Manual: Selesai</button>' +
            '</div>'
          : '') +
        '<button type="button" class="btn btn-outline btn-sm" id="od-chat-direct-wa" style="width:100%;">📲 Buka Ruang Chat WA Pelanggan (+' + esc(o.no_whatsapp) + ')</button>' +

        '<div style="font-size:0.76rem;color:var(--muted);background:var(--surface-2);padding:10px;border-radius:10px;">' +
          '<strong>Riwayat Status:</strong><br>' + esc(o.riwayat_status || '-') +
        '</div>' +
        '<button type="button" class="btn btn-danger btn-sm" id="od-del-btn">🗑️ Hapus Pesanan</button>' +
      '</div>';

    $('od-save-btn').onclick = async function () {
      const nextMetode = $('od-metode').value;
      const nextCatatan = $('od-catatan').value;
      const prevMetode = o.metode_bayar;
      const prevCatatan = o.catatan;
      // Optimistic UI (0ms tanpa delay)
      o.metode_bayar = nextMetode;
      o.catatan = nextCatatan;
      toast('Detail pesanan disimpan.', 'ok');
      renderAdminActiveTab();

      const res = await apiCall('adminUpdateOrder', {
        id: o.id_pesanan,
        patch: { metode_bayar: nextMetode, catatan: nextCatatan },
        opts: {}
      }, 'POST');
      if (res.success) {
        if (res.data && res.data.order) Object.assign(o, res.data.order);
      } else {
        o.metode_bayar = prevMetode;
        o.catatan = prevCatatan;
        toast(res.message || 'Gagal menyimpan perubahan.', 'err');
      }
    };

    const zoomBtn = $('od-zoom-proof-btn');
    const prevImgEl = $('od-proof-img-preview');
    if (prevImgEl && hasClientProof) {
      prevImgEl.onerror = function () {
        const fb = prevImgEl.getAttribute('data-fb');
        if (fb && prevImgEl.src !== fb) {
          prevImgEl.src = fb;
        } else {
          prevImgEl.style.display = 'none';
          const docNote = $('od-proof-doc-fallback');
          if (docNote) docNote.style.display = 'block';
        }
      };
      prevImgEl.onclick = function () { openProofLightbox(o.link_bukti_transfer, '🧾 Bukti Transfer Klien — #' + o.id_pesanan); };
    }
    if (zoomBtn && hasClientProof) {
      zoomBtn.onclick = function () { openProofLightbox(o.link_bukti_transfer, '🧾 Bukti Transfer Klien — #' + o.id_pesanan); };
    }

    const verBtn = $('od-verify-lunas-btn');
    if (verBtn) {
      verBtn.onclick = async function () {
        const prevStatus = o.status_pesanan;
        const notify = STATE.settings.notif_otomatis_lunas === 'Ya';
        // Optimistic UI (0ms instan): langsung tandai Lunas tanpa menunggu server
        o.status_pesanan = 'Lunas';
        updateTelemetryBar();
        renderAdminActiveTab();
        openOrderDetailDrawer(o.id_pesanan);
        toast('Bukti diterima! Pesanan ' + o.id_pesanan + ' diverifikasi LUNAS.', 'ok');

        const res = await apiCall('adminUpdateOrder', {
          id: o.id_pesanan,
          patch: { status_pesanan: 'Lunas' },
          opts: { notify: notify }
        }, 'POST');
        if (res.success) {
          if (res.data && res.data.order) Object.assign(o, res.data.order);
          updateTelemetryBar();
          renderAdminActiveTab();
        } else {
          o.status_pesanan = prevStatus;
          updateTelemetryBar();
          renderAdminActiveTab();
          openOrderDetailDrawer(o.id_pesanan);
          toast(res.message || 'Gagal memverifikasi status di server.', 'err');
        }
      };
    }

    const refreshProofBtn = $('od-refresh-proof-btn');
    if (refreshProofBtn) {
      refreshProofBtn.onclick = async function () {
        refreshProofBtn.disabled = true;
        refreshProofBtn.textContent = '⏳ Mengecek...';
        const res = await apiCall('adminBootstrap', {}, 'POST');
        if (res && res.success && res.data) {
          ingestAdminBootstrap(res.data);
          renderAdminActiveTab();
          openOrderDetailDrawer(o.id_pesanan);
          const updatedOrd = (STATE.adminData.orders || []).find(function (x) { return x.id_pesanan === o.id_pesanan; });
          if (updatedOrd && updatedOrd.link_bukti_transfer) {
            toast('Bukti transfer dari klien ditemukan!', 'ok');
          } else {
            toast('Data sudah paling baru — klien belum mengirim bukti transfer.', 'info');
          }
        } else {
          refreshProofBtn.disabled = false;
          refreshProofBtn.textContent = '🔄 Cek Bukti Masuk';
          toast('Gagal menyegarkan data pesanan.', 'err');
        }
      };
    }

    const askProofWaBtn = $('od-ask-proof-wa-btn');
    if (askProofWaBtn) {
      askProofWaBtn.onclick = function () {
        const portalUrl = window.location.origin + window.location.pathname;
        const rekening = STATE.settings.rekening_bank || DEMO_DB.settings.rekening_bank || 'BCA 828-091-8899 a.n. PT Nusa Digital Teknologi';
        const msg =
          'Halo Kak *' + (o.nama_pelanggan || '') + '*, terima kasih atas pesanan Anda di *' + (STATE.settings.nama_toko || 'NusaStore') + '* 🙏\n\n' +
          'Berikut pengingat rincian pembayaran:\n' +
          '• ID Pesanan: *' + o.id_pesanan + '*\n' +
          '• Produk: ' + (o.nama_produk || '-') + '\n' +
          '• Total Tagihan: *Rp ' + rupiah(o.total_harga) + '*\n' +
          '• Rekening Resmi: *' + rekening + '*\n\n' +
          'Apabila sudah melakukan pembayaran, silakan kirim *Bukti Transfer* melalui menu *💳 Cek Pesanan* di website:\n' +
          portalUrl + '\n\natau balas langsung bukti transfernya di chat WhatsApp ini agar pesanan segera kami proses. Terima kasih! ✨';
        openManualWaForOrder(o, '', msg);
      };
    }

    $('dad-body').querySelectorAll('[data-wa-tpl]').forEach(function (b) {
      b.onclick = async function () {
        const tpl = b.getAttribute('data-wa-tpl');
        // Jika FONNTE_TOKEN belum dipasang, langsung buka WhatsApp Manual tanpa error!
        if (!hasFonnte) {
          openManualWaForOrder(o, tpl);
          return;
        }
        const res = await apiCall('adminSendWa', { orderId: o.id_pesanan, templateKey: tpl }, 'POST');
        if (res && res.success && (!res.data || res.data.ok !== false)) {
          toast(res.message || 'Pesan WhatsApp terkirim otomatis via Fonnte!', 'ok');
        } else {
          const reason = (res && res.data && res.data.detail) ? res.data.detail : ((res && res.message) || 'Fonnte belum siap');
          toast('Fonnte kendala (' + reason + ') — mengalihkan ke WhatsApp Manual...', 'info');
          openManualWaForOrder(o, tpl);
        }
      };
    });

    $('dad-body').querySelectorAll('[data-wa-manual]').forEach(function (b) {
      b.onclick = function () {
        openManualWaForOrder(o, b.getAttribute('data-wa-manual'));
      };
    });

    $('od-chat-direct-wa').onclick = function () {
      const sapaan = 'Halo Kak *' + (o.nama_pelanggan || '') + '*, kami dari *' + (STATE.settings.nama_toko || 'NusaStore') + '* terkait pesanan *' + o.id_pesanan + '* (' + o.nama_produk + '). Ada yang bisa kami bantu?';
      openManualWaForOrder(o, '', sapaan);
    };

    $('od-del-btn').onclick = async function () {
      if (!confirm('Hapus permanen pesanan ' + o.id_pesanan + '?')) return;
      const res = await apiCall('adminDeleteOrder', { id: o.id_pesanan }, 'POST');
      if (res.success) {
        STATE.adminData.orders = STATE.adminData.orders.filter(function (x) { return x.id_pesanan !== o.id_pesanan; });
        closeOverlay('drawer-admin-detail');
        toast('Pesanan dihapus.', 'ok');
        renderAdminActiveTab();
      }
    };

    openOverlay('drawer-admin-detail');
  }

  function openManualOrderModal() {
    $('mae-title').textContent = '+ Input Pesanan Manual (Chat WA / Offline)';
    $('mae-body').innerHTML =
      '<form id="form-manual-order">' +
        '<div class="form-grid-2">' +
          '<div class="field"><label>Nama Pelanggan *</label><input class="input" name="nama" required></div>' +
          '<div class="field"><label>Nomor WhatsApp *</label><input class="input" name="wa" required placeholder="0812xxxx"></div>' +
        '</div>' +
        '<div class="form-grid-2">' +
          '<div class="field"><label>Produk *</label><select class="select" name="pid">' +
            STATE.products.map(function (p) { return '<option value="' + esc(p.id_produk) + '">' + esc(p.nama_produk) + ' — Rp ' + rupiah(effPrice(p)) + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="field"><label>Qty</label><input type="number" class="input" name="qty" value="1" min="1"></div>' +
        '</div>' +
        '<div class="form-grid-2">' +
          '<div class="field"><label>Status Awal</label><select class="select" name="status"><option>Pending</option><option>Lunas</option><option>Diproses</option><option>Selesai</option></select></div>' +
          '<div class="field"><label>Sumber Pesanan</label><select class="select" name="sumber"><option>Input Admin (WA Chat)</option><option>Input Admin (Offline)</option></select></div>' +
        '</div>' +
        '<div class="form-grid-2">' +
          '<div class="field"><label>Metode Bayar</label><input class="input" name="metode_bayar" placeholder="Transfer BCA / QRIS"></div>' +
          '<div class="field"><label>Email Pelanggan (Opsional)</label><input type="email" class="input" name="email" placeholder="klien@bisnis.id"></div>' +
        '</div>' +
        '<div class="field"><label>Catatan</label><input class="input" name="catatan"></div>' +
        '<label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;margin-bottom:16px;"><input type="checkbox" name="notify" checked> Antrekan notifikasi WA/Email otomatis ke pelanggan</label>' +
        '<button type="submit" class="btn btn-primary" style="width:100%;">Simpan Pesanan</button>' +
      '</form>';

    $('form-manual-order').onsubmit = async function (ev) {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const res = await apiCall('adminCreateOrder', {
        order: {
          nama: fd.get('nama'), wa: fd.get('wa'), email: fd.get('email'),
          status: fd.get('status'), sumber: fd.get('sumber'),
          metode_bayar: fd.get('metode_bayar'), catatan: fd.get('catatan'),
          items: [{ id: fd.get('pid'), qty: Number(fd.get('qty')) || 1 }]
        },
        opts: { notify: fd.get('notify') === 'on' }
      }, 'POST');
      if (res.success) {
        if (res.data && res.data.order) STATE.adminData.orders.push(res.data.order);
        closeOverlay('modal-admin-editor');
        toast(res.message, 'ok');
        renderAdminActiveTab();
      } else toast(res.message, 'err');
    };
    openOverlay('modal-admin-editor');
  }

  function openOfficialInvoiceModal(orderId) {
    const o = (STATE.adminData.orders || []).find(function (x) { return x.id_pesanan === orderId; });
    if (!o) return;
    const st = STATE.settings;
    const sig = o.invoiceSig || 'VERIFIED';
    const verifyText = (RAW_GAS_URL ? RAW_GAS_URL + '?action=verifyInvoice&orderId=' + encodeURIComponent(o.id_pesanan) + '&sig=' + encodeURIComponent(sig) : 'NUSASTORE-OFFICIAL-' + o.id_pesanan + '-' + sig);
    const qrImgUrl = 'https://quickchart.io/qr?size=130&text=' + encodeURIComponent(verifyText);

    $('mae-title').textContent = '🧾 Faktur Resmi — ' + o.id_pesanan;
    $('mae-body').innerHTML =
      '<div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">' +
        '<button type="button" class="btn btn-primary btn-sm" id="btn-inv-print">🖨️ Cetak / Simpan PDF Lokal</button>' +
        '<button type="button" class="btn btn-wa btn-sm" id="btn-inv-drive">☁️ Arsipkan PDF ke Google Drive</button>' +
      '</div>' +
      '<div id="invoice-print-area" class="invoice-sheet">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0F172A;padding-bottom:18px;margin-bottom:20px;">' +
          '<div>' +
            '<h2 style="margin:0;color:#2563EB;font-size:1.5rem;">' + esc(st.nama_toko || 'NusaStore') + '</h2>' +
            '<div style="font-weight:700;font-size:0.9rem;">' + esc(st.nama_perusahaan || '') + '</div>' +
            '<div style="font-size:0.78rem;color:#475569;max-width:340px;">' + esc(st.alamat_toko || '') + '</div>' +
            (st.npwp ? '<div style="font-size:0.76rem;color:#475569;">NPWP: ' + esc(st.npwp) + '</div>' : '') +
          '</div>' +
          '<div style="text-align:right;">' +
            '<div style="font-size:1.3rem;font-weight:800;letter-spacing:0.06em;">INVOICE RESMI</div>' +
            '<div style="font-size:0.86rem;font-weight:700;color:#2563EB;">#' + esc(o.id_pesanan) + '</div>' +
            '<div style="font-size:0.78rem;color:#64748B;">Tanggal: ' + esc(fmtDateShort(o.tanggal_order)) + '</div>' +
            '<div style="margin-top:6px;display:inline-block;padding:3px 10px;border-radius:99px;background:#ECFDF5;color:#059669;font-weight:800;font-size:0.75rem;">STATUS: ' + esc(String(o.status_pesanan).toUpperCase()) + '</div>' +
          '</div>' +
        '</div>' +

        '<div style="margin-bottom:18px;font-size:0.86rem;">' +
          '<div style="color:#64748B;font-size:0.74rem;text-transform:uppercase;font-weight:700;">Ditagihkan Kepada:</div>' +
          '<strong>' + esc(o.nama_pelanggan) + '</strong><br>WhatsApp: +' + esc(o.no_whatsapp) +
        '</div>' +

        '<table style="width:100%;border-collapse:collapse;font-size:0.86rem;margin-bottom:20px;">' +
          '<thead><tr style="background:#0F172A;color:#FFF;"><th style="padding:10px;text-align:left;">Deskripsi Produk / Layanan</th><th style="padding:10px;text-align:center;">Qty</th><th style="padding:10px;text-align:right;">Subtotal</th></tr></thead>' +
          '<tbody><tr>' +
            '<td style="padding:12px 10px;border-bottom:1px solid #E2E8F0;"><strong>' + esc(o.nama_produk) + '</strong>' +
              (o.kunci_lisensi ? '<br><small style="color:#2563EB;">Lisensi Resmi: ' + esc(o.kunci_lisensi) + '</small>' : '') + '</td>' +
            '<td style="padding:12px 10px;border-bottom:1px solid #E2E8F0;text-align:center;">' + esc(o.qty || 1) + '</td>' +
            '<td style="padding:12px 10px;border-bottom:1px solid #E2E8F0;text-align:right;font-weight:700;">Rp ' + rupiah(o.total_harga) + '</td>' +
          '</tr></tbody>' +
        '</table>' +

        '<div style="display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap;padding-top:12px;">' +
          '<div style="display:flex;align-items:center;gap:12px;">' +
            '<img src="' + esc(qrImgUrl) + '" width="88" height="88" alt="QR Verifikasi" style="border:1px solid #E2E8F0;border-radius:8px;padding:4px;">' +
            '<div style="font-size:0.74rem;color:#475569;">' +
              '<strong>Terverifikasi Kriptografis (HMAC)</strong><br>Signature: <code>' + esc(sig) + '</code><br>' +
              'Rekening Resmi: ' + esc(st.rekening_bank || '-') +
            '</div>' +
          '</div>' +
          '<div style="text-align:right;">' +
            '<div style="font-size:0.8rem;color:#64748B;">Total Pembayaran</div>' +
            '<div style="font-size:1.5rem;font-weight:800;color:#0F172A;">Rp ' + rupiah(o.total_harga) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    $('btn-inv-print').onclick = function () { window.print(); };
    $('btn-inv-drive').onclick = async function () {
      const html = $('invoice-print-area').innerHTML;
      toast('Menyimpan Faktur PDF ke Google Drive...', 'info');
      const res = await apiCall('adminInvoicePdf', { orderId: o.id_pesanan, html: html }, 'POST');
      if (res.success) {
        toast(res.message, 'ok');
        if (res.data && res.data.url && res.data.url.indexOf('http') === 0) window.open(res.data.url, '_blank', 'noopener');
      } else toast(res.message, 'err');
    };

    openOverlay('modal-admin-editor');
  }

  function exportOrdersCsv(rows) {
    const header = ['id_pesanan', 'tanggal_order', 'nama_pelanggan', 'no_whatsapp', 'nama_produk', 'total_harga', 'status_pesanan', 'sumber_pesanan'];
    const csv = [header.join(',')].concat(rows.map(function (r) {
      return header.map(function (h) { return '"' + String(r[h] === undefined ? '' : r[h]).replace(/"/g, '""') + '"'; }).join(',');
    })).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'NusaStore_Transaksi_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    apiCall('adminSaveExport', { filename: a.download, csv: csv }, 'POST');
  }

  async function exportOrdersXlsx(rows) {
    const header = ['id_pesanan', 'tanggal_order', 'nama_pelanggan', 'no_whatsapp', 'nama_produk', 'total_harga', 'status_pesanan', 'sumber_pesanan'];
    const matrix = rows.map(function (r) { return header.map(function (h) { return r[h] === undefined ? '' : r[h]; }); });
    toast('Menyiapkan berkas Excel (.xlsx)...', 'info');
    const res = await apiCall('adminExportXlsx', { filename: 'NusaStore_Transaksi', header: header, rows: matrix }, 'POST');
    if (res.success && res.data && res.data.base64) {
      const bin = atob(res.data.base64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = res.data.name || 'NusaStore_Transaksi.xlsx';
      a.click();
      toast('Berkas Excel berhasil diunduh & diarsipkan ke Drive!', 'ok');
    } else {
      exportOrdersCsv(rows);
      toast('Mode lokal: diunduh sebagai CSV kompatibel Excel.', 'ok');
    }
  }

  // ── PANEL ADMIN 3: KATALOG MULTI-GAMBAR, KATEGORI & TESTIMONI ───────────────
  function renderAdminCatalog(host) {
    const sub = STATE.catalogSubTab || 'products';
    const allTestimonials = STATE.adminData.testimonials && STATE.adminData.testimonials.length
      ? STATE.adminData.testimonials : STATE.testimonials;

    host.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px;">' +
        '<div class="chip-list">' +
          '<button type="button" class="filter-chip ' + (sub === 'products' ? 'is-active' : '') + '" data-cat-sub="products">📦 Produk Multi-Gambar (' + STATE.products.length + ')</button>' +
          '<button type="button" class="filter-chip ' + (sub === 'categories' ? 'is-active' : '') + '" data-cat-sub="categories">🗂️ Kategori (' + STATE.categories.length + ')</button>' +
          '<button type="button" class="filter-chip ' + (sub === 'testimonials' ? 'is-active' : '') + '" data-cat-sub="testimonials">🌟 Testimoni (' + allTestimonials.length + ')</button>' +
        '</div>' +
        '<div>' +
          (sub === 'products' ? '<button type="button" class="btn btn-primary btn-sm" id="btn-new-prod">+ Tambah Produk</button>' : '') +
          (sub === 'categories' ? '<button type="button" class="btn btn-primary btn-sm" id="btn-new-cat">+ Tambah Kategori</button>' : '') +
          (sub === 'testimonials' ? '<button type="button" class="btn btn-primary btn-sm" id="btn-new-testi">+ Tambah Testimoni</button>' : '') +
        '</div>' +
      '</div>' +
      '<div id="cat-sub-body"></div>';

    host.querySelectorAll('[data-cat-sub]').forEach(function (b) {
      b.onclick = function () { STATE.catalogSubTab = b.getAttribute('data-cat-sub'); renderAdminCatalog(host); };
    });

    const body = $('cat-sub-body');
    if (sub === 'products') {
      body.innerHTML = '<div class="panel-card"><div class="table-wrap"><table class="data-table">' +
        '<thead><tr><th>Produk</th><th>Kategori</th><th>Galeri Foto</th><th>Harga Normal / Promo</th><th>Status</th><th>Aksi</th></tr></thead>' +
        '<tbody>' + STATE.products.map(function (p) {
          const imgs = p.images || [p.gambar_url];
          return '<tr>' +
            '<td><div style="display:flex;align-items:center;gap:10px;">' +
              '<img src="' + esc(imgs[0] || '') + '" style="width:46px;height:46px;border-radius:8px;object-fit:cover;" alt="">' +
              '<div><strong>' + esc(p.nama_produk) + '</strong><br><small style="color:var(--muted);">' + esc(p.id_produk) + '</small></div></div></td>' +
            '<td>' + esc(p.kategori) + '</td>' +
            '<td><span class="pill pill-Diproses">🖼️ ' + imgs.length + ' Foto Slideshow</span></td>' +
            '<td class="tabular">Rp ' + rupiah(p.harga) + (p.harga_coret ? '<br><small style="color:#059669;font-weight:700;">Promo: Rp ' + rupiah(p.harga_coret) + '</small>' : '') + '</td>' +
            '<td><span class="pill ' + (p.status_aktif === 'Nonaktif' ? 'pill-Batal' : 'pill-Lunas') + '">' + esc(p.status_aktif || 'Aktif') + '</span></td>' +
            '<td><div style="display:flex;gap:6px;">' +
              '<button type="button" class="btn btn-outline btn-sm" data-edit-prod="' + esc(p.id_produk) + '">Edit</button>' +
              '<button type="button" class="btn btn-danger btn-sm" data-del-prod="' + esc(p.id_produk) + '">Hapus</button>' +
            '</div></td>' +
          '</tr>';
        }).join('') + '</tbody></table></div></div>';

      $('btn-new-prod').onclick = function () { openProductEditorModal(null); };
      body.querySelectorAll('[data-edit-prod]').forEach(function (b) {
        b.onclick = function () { openProductEditorModal(STATE.products.find(function (x) { return x.id_produk === b.getAttribute('data-edit-prod'); })); };
      });
      body.querySelectorAll('[data-del-prod]').forEach(function (b) {
        b.onclick = async function () {
          const id = b.getAttribute('data-del-prod');
          if (!confirm('Hapus produk ' + id + '?')) return;
          const res = await apiCall('adminDeleteProduct', { id: id }, 'POST');
          if (res.success) { STATE.products = STATE.products.filter(function (x) { return x.id_produk !== id; }); toast('Produk dihapus.', 'ok'); renderAdminCatalog(host); }
        };
      });
    } else if (sub === 'categories') {
      body.innerHTML = '<div class="panel-card"><div class="table-wrap"><table class="data-table">' +
        '<thead><tr><th>ID</th><th>Nama Kategori</th><th>Subjudul</th><th>Urutan</th><th>Aksi</th></tr></thead>' +
        '<tbody>' + STATE.categories.map(function (c) {
          return '<tr><td><code>' + esc(c.id_kategori) + '</code></td><td><strong>' + esc(c.nama_kategori) + '</strong></td><td>' + esc(c.subjudul) + '</td><td>' + esc(c.urutan) + '</td>' +
            '<td><button type="button" class="btn btn-outline btn-sm" data-edit-cat="' + esc(c.id_kategori) + '">Edit</button> ' +
            '<button type="button" class="btn btn-danger btn-sm" data-del-cat="' + esc(c.id_kategori) + '">Hapus</button></td></tr>';
        }).join('') + '</tbody></table></div></div>';

      $('btn-new-cat').onclick = function () { openCategoryEditorModal(null); };
      body.querySelectorAll('[data-edit-cat]').forEach(function (b) {
        b.onclick = function () { openCategoryEditorModal(STATE.categories.find(function (x) { return x.id_kategori === b.getAttribute('data-edit-cat'); })); };
      });
      body.querySelectorAll('[data-del-cat]').forEach(function (b) {
        b.onclick = async function () {
          const id = b.getAttribute('data-del-cat');
          const res = await apiCall('adminDeleteCategory', { id: id }, 'POST');
          if (res.success) { STATE.categories = STATE.categories.filter(function (x) { return x.id_kategori !== id; }); toast('Kategori dihapus.', 'ok'); renderAdminCatalog(host); }
          else toast(res.message, 'err');
        };
      });
    } else {
      body.innerHTML = '<div class="panel-card"><div class="table-wrap"><table class="data-table">' +
        '<thead><tr><th>Pelanggan</th><th>Produk Terkait</th><th>Kutipan</th><th>Highlight Hasil</th><th>Tampil</th><th>Aksi</th></tr></thead>' +
        '<tbody>' + allTestimonials.map(function (t) {
          return '<tr>' +
            '<td><strong>' + esc(t.nama) + '</strong><br><small style="color:var(--muted);">' + esc(t.jabatan_perusahaan) + '</small></td>' +
            '<td>' + esc(t.produk_terkait) + '</td>' +
            '<td style="max-width:260px;">' + esc(t.kutipan_singkat) + '</td>' +
            '<td>' + esc(t.hasil_highlight) + '</td>' +
            '<td><span class="pill ' + (t.tampil === 'Tidak' ? 'pill-Pending' : 'pill-Lunas') + '">' + esc(t.tampil || 'Ya') + '</span></td>' +
            '<td><button type="button" class="btn btn-outline btn-sm" data-edit-testi="' + esc(t.id_testimoni) + '">Edit</button> ' +
            '<button type="button" class="btn btn-danger btn-sm" data-del-testi="' + esc(t.id_testimoni) + '">Hapus</button></td>' +
          '</tr>';
        }).join('') + '</tbody></table></div></div>';

      $('btn-new-testi').onclick = function () { openTestiEditorModal(null); };
      body.querySelectorAll('[data-edit-testi]').forEach(function (b) {
        b.onclick = function () { openTestiEditorModal(allTestimonials.find(function (x) { return x.id_testimoni === b.getAttribute('data-edit-testi'); })); };
      });
      body.querySelectorAll('[data-del-testi]').forEach(function (b) {
        b.onclick = async function () {
          const id = b.getAttribute('data-del-testi');
          const res = await apiCall('adminDeleteTestimonial', { id: id }, 'POST');
          if (res.success) {
            STATE.adminData.testimonials = allTestimonials.filter(function (x) { return x.id_testimoni !== id; });
            STATE.testimonials = STATE.adminData.testimonials.filter(function (x) { return x.tampil === 'Ya'; });
            toast('Testimoni dihapus.', 'ok');
            renderAdminCatalog(host);
          }
        };
      });
    }
  }

  function openProductEditorModal(prod) {
    const p = prod || { id_produk: '', nama_produk: '', kategori: (STATE.categories[0] && STATE.categories[0].id_kategori) || 'web-dev', harga: 500000, harga_coret: 0, gambar_url: '', galeri_url: '', badge_promo: '', status_aktif: 'Aktif', spesifikasi: '', rating: 4.9, jumlah_ulasan: 10, urutan: 1, deskripsi: '' };
    const extraGallery = p.galeri_url || ((p.images && p.images.length > 1) ? p.images.slice(1).join('\n') : '');

    $('mae-title').textContent = p.id_produk ? ('Edit Produk — ' + p.id_produk) : '+ Tambah Produk Multi-Gambar Baru';
    $('mae-body').innerHTML =
      '<form id="form-prod-editor">' +
        '<div class="form-grid-2">' +
          '<div class="field"><label>Nama Produk / Layanan *</label><input class="input" name="nama_produk" value="' + esc(p.nama_produk) + '" required></div>' +
          '<div class="field"><label>Kategori *</label><select class="select" name="kategori">' +
            STATE.categories.map(function (c) { return '<option value="' + esc(c.id_kategori) + '"' + (p.kategori === c.id_kategori ? ' selected' : '') + '>' + esc(c.nama_kategori) + '</option>'; }).join('') +
          '</select></div>' +
        '</div>' +
        '<div class="form-grid-2">' +
          '<div class="field"><label>Harga Normal (Rp) *</label><input type="number" class="input" name="harga" value="' + esc(p.harga) + '" required></div>' +
          '<div class="field"><label>Harga Promo / Diskon (Isi 0 bila tanpa diskon)</label><input type="number" class="input" name="harga_coret" value="' + esc(p.harga_coret || 0) + '"></div>' +
        '</div>' +
        '<div class="field">' +
          '<label>URL Gambar Utama (Foto #1) *</label>' +
          '<div style="display:flex;gap:8px;">' +
            '<input class="input" id="pe-main-img" name="gambar_url" value="' + esc(p.gambar_url) + '" placeholder="https://...">' +
            '<label class="btn btn-outline btn-sm" style="flex-shrink:0;cursor:pointer;">☁️ Upload Drive<input type="file" id="pe-upload-img" accept="image/*" style="display:none;"></label>' +
          '</div>' +
        '</div>' +
        '<div class="field">' +
          '<label>Galeri Gambar Tambahan untuk Auto-Slideshow (1 URL per baris — Foto #2, #3, dst.)</label>' +
          '<textarea class="textarea" id="pe-galeri-img" name="galeri_url" rows="3" placeholder="https://images.unsplash.com/...\nhttps://drive.google.com/...">' + esc(extraGallery) + '</textarea>' +
        '</div>' +
        '<div class="form-grid-2">' +
          '<div class="field"><label>Badge Promo</label><input class="input" name="badge_promo" value="' + esc(p.badge_promo) + '" placeholder="Best Seller / Hot Item"></div>' +
          '<div class="field"><label>Status Katalog</label><select class="select" name="status_aktif"><option value="Aktif"' + (p.status_aktif !== 'Nonaktif' ? ' selected' : '') + '>Aktif</option><option value="Nonaktif"' + (p.status_aktif === 'Nonaktif' ? ' selected' : '') + '>Nonaktif</option></select></div>' +
        '</div>' +
        '<div class="field"><label>Ringkasan Spesifikasi (1 baris di kartu)</label><input class="input" name="spesifikasi" value="' + esc(p.spesifikasi) + '" placeholder="Garansi Resmi • Setup Cepat • Support WA"></div>' +
        '<div class="field"><label>Deskripsi Lengkap</label><textarea class="textarea" name="deskripsi" rows="4">' + esc(p.deskripsi) + '</textarea></div>' +
        '<button type="submit" class="btn btn-primary" style="width:100%;">💾 Simpan Produk ke Katalog</button>' +
      '</form>';

    $('pe-upload-img').onchange = function (ev) {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = async function () {
        const b64 = String(rd.result || '').split(',')[1] || '';
        toast('Mengunggah foto produk ke Google Drive...', 'info');
        const res = await apiCall('adminUploadFile', { kind: 'product', base64: b64, mime: f.type, filename: f.name, refId: p.id_produk || 'BARU' }, 'POST');
        if (res.success && res.data && res.data.img) {
          if (!$('pe-main-img').value) $('pe-main-img').value = res.data.img;
          else $('pe-galeri-img').value = ($('pe-galeri-img').value ? $('pe-galeri-img').value + '\n' : '') + res.data.img;
          toast('Foto ditambahkan ke galeri produk!', 'ok');
        } else toast(res.message || 'Gagal upload', 'err');
      };
      rd.readAsDataURL(f);
    };

    $('form-prod-editor').onsubmit = async function (ev) {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const payload = {
        id_produk: p.id_produk,
        nama_produk: fd.get('nama_produk'),
        kategori: fd.get('kategori'),
        harga: Number(fd.get('harga')),
        harga_coret: Number(fd.get('harga_coret')),
        gambar_url: fd.get('gambar_url'),
        galeri_url: fd.get('galeri_url'),
        badge_promo: fd.get('badge_promo'),
        status_aktif: fd.get('status_aktif'),
        spesifikasi: fd.get('spesifikasi'),
        deskripsi: fd.get('deskripsi'),
        rating: p.rating || 4.9,
        jumlah_ulasan: p.jumlah_ulasan || 12,
        urutan: p.urutan || 1
      };
      const res = await apiCall('adminSaveProduct', { product: payload }, 'POST');
      if (res.success) {
        const saved = res.data;
        const ix = STATE.products.findIndex(function (x) { return x.id_produk === saved.id_produk; });
        if (ix >= 0) STATE.products[ix] = saved; else STATE.products.unshift(saved);
        closeOverlay('modal-admin-editor');
        toast(res.message, 'ok');
        renderAdminActiveTab();
      } else toast(res.message, 'err');
    };

    openOverlay('modal-admin-editor');
  }

  function openCategoryEditorModal(cat) {
    const c = cat || { id_kategori: '', nama_kategori: '', icon_url: '💻', subjudul: '', urutan: STATE.categories.length + 1 };
    $('mae-title').textContent = c.id_kategori ? 'Edit Kategori' : '+ Tambah Kategori';
    $('mae-body').innerHTML =
      '<form id="form-cat-editor">' +
        '<div class="field"><label>Nama Kategori *</label><input class="input" name="nama_kategori" value="' + esc(c.nama_kategori) + '" required></div>' +
        '<div class="form-grid-2">' +
          '<div class="field"><label>Ikon Emoji / Kode</label><input class="input" name="icon_url" value="' + esc(c.icon_url) + '"></div>' +
          '<div class="field"><label>Urutan</label><input type="number" class="input" name="urutan" value="' + esc(c.urutan) + '"></div>' +
        '</div>' +
        '<div class="field"><label>Subjudul Singkat</label><input class="input" name="subjudul" value="' + esc(c.subjudul) + '"></div>' +
        '<button type="submit" class="btn btn-primary" style="width:100%;">Simpan Kategori</button>' +
      '</form>';
    $('form-cat-editor').onsubmit = async function (ev) {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const res = await apiCall('adminSaveCategory', {
        category: { original_id: c.id_kategori, id_kategori: c.id_kategori, nama_kategori: fd.get('nama_kategori'), icon_url: fd.get('icon_url'), subjudul: fd.get('subjudul'), urutan: Number(fd.get('urutan')) }
      }, 'POST');
      if (res.success) {
        const saved = res.data;
        const ix = STATE.categories.findIndex(function (x) { return x.id_kategori === (c.id_kategori || saved.id_kategori); });
        if (ix >= 0) STATE.categories[ix] = saved; else STATE.categories.push(saved);
        closeOverlay('modal-admin-editor');
        toast(res.message, 'ok');
        renderAdminActiveTab();
      } else toast(res.message, 'err');
    };
    openOverlay('modal-admin-editor');
  }

  function openTestiEditorModal(testi) {
    const t = testi || { id_testimoni: '', nama: '', jabatan_perusahaan: '', avatar_url: '', produk_terkait: '', rating: 5, kutipan_singkat: '', cerita_lengkap: '', hasil_highlight: '', tanggal: '', terverifikasi: 'Ya', tampil: 'Ya' };
    $('mae-title').textContent = t.id_testimoni ? 'Edit Testimoni' : '+ Tambah Testimoni Terverifikasi';
    $('mae-body').innerHTML =
      '<form id="form-testi-editor">' +
        '<div class="form-grid-2">' +
          '<div class="field"><label>Nama Pelanggan *</label><input class="input" name="nama" value="' + esc(t.nama) + '" required></div>' +
          '<div class="field"><label>Jabatan &amp; Perusahaan</label><input class="input" name="jabatan_perusahaan" value="' + esc(t.jabatan_perusahaan) + '"></div>' +
        '</div>' +
        '<div class="form-grid-2">' +
          '<div class="field"><label>Produk Terkait</label><input class="input" name="produk_terkait" value="' + esc(t.produk_terkait) + '"></div>' +
          '<div class="field"><label>Highlight Dampak (Sisi Belakang Kartu Flip)</label><input class="input" name="hasil_highlight" value="' + esc(t.hasil_highlight) + '" placeholder="+85% Konversi Checkout"></div>' +
        '</div>' +
        '<div class="form-grid-2">' +
          '<div class="field"><label>URL Foto Avatar (Opsional)</label><input class="input" name="avatar_url" value="' + esc(t.avatar_url) + '"></div>' +
          '<div class="field"><label>Status Tampil di Landing Page</label><select class="select" name="tampil"><option value="Ya"' + (t.tampil !== 'Tidak' ? ' selected' : '') + '>Ya (Tampilkan)</option><option value="Tidak"' + (t.tampil === 'Tidak' ? ' selected' : '') + '>Tidak (Sembunyikan)</option></select></div>' +
        '</div>' +
        '<div class="field"><label>Kutipan Singkat (Sisi Depan Kartu) *</label><textarea class="textarea" name="kutipan_singkat" rows="2" required>' + esc(t.kutipan_singkat) + '</textarea></div>' +
        '<div class="field"><label>Cerita Lengkap (Tampil saat Pop-Up Diklik)</label><textarea class="textarea" name="cerita_lengkap" rows="4">' + esc(t.cerita_lengkap) + '</textarea></div>' +
        '<button type="submit" class="btn btn-primary" style="width:100%;">Simpan Testimoni</button>' +
      '</form>';

    $('form-testi-editor').onsubmit = async function (ev) {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const payload = {
        id_testimoni: t.id_testimoni, nama: fd.get('nama'), jabatan_perusahaan: fd.get('jabatan_perusahaan'),
        produk_terkait: fd.get('produk_terkait'), hasil_highlight: fd.get('hasil_highlight'),
        avatar_url: fd.get('avatar_url'), tampil: fd.get('tampil'), terverifikasi: 'Ya', rating: 5,
        kutipan_singkat: fd.get('kutipan_singkat'), cerita_lengkap: fd.get('cerita_lengkap'), tanggal: t.tanggal
      };
      const res = await apiCall('adminSaveTestimonial', { testimonial: payload }, 'POST');
      if (res.success) {
        const list = STATE.adminData.testimonials || [];
        const ix = list.findIndex(function (x) { return x.id_testimoni === res.data.id_testimoni; });
        if (ix >= 0) list[ix] = res.data; else list.unshift(res.data);
        STATE.adminData.testimonials = list;
        STATE.testimonials = list.filter(function (x) { return x.tampil === 'Ya'; });
        closeOverlay('modal-admin-editor');
        toast(res.message, 'ok');
        renderAdminActiveTab();
      } else toast(res.message, 'err');
    };
    openOverlay('modal-admin-editor');
  }

  // ── PANEL ADMIN 4: CRM KONTAK & RIWAYAT INTERAKSI (gas-notifikasi-wa-crm) ──
  function renderCrmTableRowsHtml(rows) {
    return '<div class="table-wrap"><table class="data-table">' +
      '<thead><tr><th>Nama &amp; Sumber</th><th>WhatsApp / Email</th><th>Segmen &amp; Tag</th><th>Status WA</th><th>Opt-Out</th><th>Aksi</th></tr></thead>' +
      '<tbody>' + (rows.length ? rows.map(function (k) {
        const isOpt = String(k.OptOut).toUpperCase() === 'YA';
        return '<tr>' +
          '<td><strong>' + esc(k.Nama) + '</strong><br><small style="color:var(--muted);">' + esc(k.Info || k.Sumber || '') + '</small></td>' +
          '<td class="tabular">' + (k.NoWA ? '+' + esc(k.NoWA) : '-') + '<br><small style="color:var(--muted);">' + esc(k.Email || '-') + '</small></td>' +
          '<td><span class="pill pill-Diproses">' + esc(k.Segmen || 'Prospek') + '</span>' + (k.Tag ? '<br><small style="color:var(--muted);">🏷️ ' + esc(k.Tag) + '</small>' : '') + '</td>' +
          '<td><span class="pill ' + (k.StatusWA === 'Terdaftar' ? 'pill-Terdaftar' : k.StatusWA === 'Tidak Terdaftar' ? 'pill-Batal' : 'pill-Pending') + '">' + esc(k.StatusWA || 'Belum Dicek') + '</span></td>' +
          '<td><button type="button" class="btn btn-sm ' + (isOpt ? 'btn-danger' : 'btn-outline') + '" data-crm-opt="' + esc(k.KontakID) + '" data-opt-cur="' + (isOpt ? '1' : '0') + '">' + (isOpt ? 'Opt-Out: YA' : 'Aktif') + '</button></td>' +
          '<td><div style="display:flex;gap:6px;">' +
            '<button type="button" class="btn btn-outline btn-sm" data-crm-log="' + esc(k.KontakID) + '">📋 Interaksi</button>' +
            '<button type="button" class="btn btn-outline btn-sm" data-crm-edit="' + esc(k.KontakID) + '">Edit</button>' +
          '</div></td>' +
        '</tr>';
      }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px;">Belum ada kontak pada filter ini.</td></tr>') +
      '</tbody></table></div>';
  }

  function renderAdminCrm(host) {
    const snap = STATE.adminData.notifCrm || DEMO_DB.notifCrm;
    const contacts = snap.contacts || [];
    const vipCount = contacts.filter(function (k) { return k.Segmen === 'Pelanggan VIP'; }).length;
    const regWaCount = contacts.filter(function (k) { return k.StatusWA === 'Terdaftar'; }).length;
    const optOutCount = contacts.filter(function (k) { return String(k.OptOut).toUpperCase() === 'YA'; }).length;

    function filterCrmContacts() {
      const q = STATE.crmSearch.trim().toLowerCase();
      return contacts.filter(function (k) {
        if (STATE.crmSegmenFilter !== 'ALL' && k.Segmen !== STATE.crmSegmenFilter) return false;
        if (q) {
          const hay = (k.Nama + ' ' + k.NoWA + ' ' + k.Email + ' ' + k.Tag + ' ' + k.Segmen).toLowerCase();
          if (hay.indexOf(q) < 0) return false;
        }
        return true;
      });
    }

    function bindCrmRowActions(scope) {
      scope.querySelectorAll('[data-crm-opt]').forEach(function (b) {
        b.onclick = async function () {
          const kid = b.getAttribute('data-crm-opt');
          const next = b.getAttribute('data-opt-cur') !== '1';
          const res = await apiCall('adminCrmToggleOptOut', { kontakId: kid, optOut: next }, 'POST');
          if (res.success && res.data && res.data.snapshot) STATE.adminData.notifCrm = res.data.snapshot;
          toast(res.message, res.success ? 'ok' : 'err');
          renderAdminCrm(host);
        };
      });
      scope.querySelectorAll('[data-crm-edit]').forEach(function (b) {
        b.onclick = function () {
          const c = contacts.find(function (x) { return x.KontakID === b.getAttribute('data-crm-edit'); });
          openCrmContactEditorModal(c);
        };
      });
      scope.querySelectorAll('[data-crm-log]').forEach(function (b) {
        b.onclick = function () { openCrmInteractionDrawer(b.getAttribute('data-crm-log')); };
      });
    }

    const filtered = filterCrmContacts();

    host.innerHTML =
      '<div class="kpi-grid">' +
        '<div class="kpi-card"><small>Total Kontak CRM</small><h3>' + contacts.length + '</h3><small>Multi-sumber terpadu</small></div>' +
        '<div class="kpi-card"><small>Pelanggan VIP</small><h3 style="color:var(--primary);">' + vipCount + '</h3><small>Repeat order / nilai tinggi</small></div>' +
        '<div class="kpi-card"><small>WA Tervalidasi Aktif</small><h3 style="color:#059669;">' + regWaCount + '</h3><small>Via Fonnte /validate</small></div>' +
        '<div class="kpi-card"><small>Status Opt-Out</small><h3 style="color:#D97706;">' + optOutCount + '</h3><small>Dikecualikan dari Blast WA</small></div>' +
      '</div>' +

      '<div class="panel-card">' +
        '<div class="admin-toolbar-row">' +
          '<div class="admin-toolbar-controls">' +
            '<button type="button" class="btn btn-primary btn-sm" id="btn-crm-sync">🔄 Sinkronkan dari Pesanan &amp; Newsletter</button>' +
            '<button type="button" class="btn btn-wa btn-sm" id="btn-crm-validate">✅ Validasi Nomor WA (Fonnte)</button>' +
            '<button type="button" class="btn btn-outline btn-sm" id="btn-crm-merge">🔗 Gabung Duplikat</button>' +
            '<button type="button" class="btn btn-outline btn-sm" id="btn-crm-add">+ Kontak Manual</button>' +
          '</div>' +
          '<div class="admin-toolbar-controls">' +
            '<select id="crm-segmen-sel" class="select" style="width:auto;padding:7px 12px;font-size:0.82rem;">' +
              ['ALL', 'Pelanggan VIP', 'Pembeli Aktif', 'Prospek', 'Subscriber'].map(function (sg) {
                return '<option value="' + sg + '"' + (STATE.crmSegmenFilter === sg ? ' selected' : '') + '>' + (sg === 'ALL' ? 'Semua Segmen' : sg) + '</option>';
              }).join('') +
            '</select>' +
            '<input type="search" id="crm-search-inp" class="input admin-search-input" placeholder="Cari nama, WA, tag..." value="' + esc(STATE.crmSearch) + '">' +
          '</div>' +
        '</div>' +
        '<div id="crm-table-host">' + renderCrmTableRowsHtml(filtered) + '</div>' +
      '</div>';

    function refreshCrmTableInPlace() {
      const tblHost = $('crm-table-host');
      if (!tblHost) return;
      tblHost.innerHTML = renderCrmTableRowsHtml(filterCrmContacts());
      bindCrmRowActions(tblHost);
    }

    $('crm-segmen-sel').onchange = function (e) { STATE.crmSegmenFilter = e.target.value; refreshCrmTableInPlace(); };
    const debouncedCrmSearch = debounce(refreshCrmTableInPlace, 75);
    $('crm-search-inp').oninput = function (e) { STATE.crmSearch = e.target.value; debouncedCrmSearch(); };

    $('btn-crm-sync').onclick = async function () {
      toast('Menyinkronkan kontak dari Pesanan & Newsletter...', 'info');
      const res = await apiCall('adminCrmSync', {}, 'POST');
      if (res.success && res.data && res.data.snapshot) STATE.adminData.notifCrm = res.data.snapshot;
      toast(res.message, res.success ? 'ok' : 'err');
      renderAdminCrm(host);
    };

    $('btn-crm-validate').onclick = async function () {
      toast('Memeriksa status aktif nomor WA ke server Fonnte...', 'info');
      const res = await apiCall('adminValidateWaNumbers', {}, 'POST');
      if (res.success && res.data && res.data.snapshot) STATE.adminData.notifCrm = res.data.snapshot;
      toast(res.message, res.success ? 'ok' : 'err');
      renderAdminCrm(host);
    };

    $('btn-crm-merge').onclick = async function () {
      const res = await apiCall('adminCrmMergeDuplicates', {}, 'POST');
      if (res.success && res.data && res.data.snapshot) STATE.adminData.notifCrm = res.data.snapshot;
      toast(res.message, res.success ? 'ok' : 'err');
      renderAdminCrm(host);
    };

    $('btn-crm-add').onclick = function () { openCrmContactEditorModal(null); };
    bindCrmRowActions($('crm-table-host') || host);
  }

  function openCrmContactEditorModal(contact) {
    const c = contact || { KontakID: '', Nama: '', NoWA: '', Email: '', Segmen: 'Prospek', Tag: '', OptOut: 'TIDAK', Catatan: '' };
    $('mae-title').textContent = c.KontakID ? ('Edit Kontak — ' + c.Nama) : '+ Tambah Kontak CRM';
    $('mae-body').innerHTML =
      '<form id="form-crm-contact">' +
        '<div class="form-grid-2">' +
          '<div class="field"><label>Nama Lengkap *</label><input class="input" name="Nama" value="' + esc(c.Nama) + '" required></div>' +
          '<div class="field"><label>Segmen Pelanggan</label><select class="select" name="Segmen">' +
            ['Pelanggan VIP', 'Pembeli Aktif', 'Prospek', 'Subscriber'].map(function (s) { return '<option' + (c.Segmen === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
          '</select></div>' +
        '</div>' +
        '<div class="form-grid-2">' +
          '<div class="field"><label>Nomor WhatsApp</label><input class="input" name="NoWA" value="' + esc(c.NoWA || '') + '" placeholder="0812xxxx"></div>' +
          '<div class="field"><label>Alamat Email</label><input type="email" class="input" name="Email" value="' + esc(c.Email || '') + '"></div>' +
        '</div>' +
        '<div class="form-grid-2">' +
          '<div class="field"><label>Tag (pisahkan koma)</label><input class="input" name="Tag" value="' + esc(c.Tag || '') + '" placeholder="VIP, Korporat, Repeat"></div>' +
          '<div class="field"><label>Status Opt-Out Blast</label><select class="select" name="OptOut"><option value="TIDAK"' + (c.OptOut !== 'YA' ? ' selected' : '') + '>TIDAK (Boleh Terima Info)</option><option value="YA"' + (c.OptOut === 'YA' ? ' selected' : '') + '>YA (Kecualikan dari Blast)</option></select></div>' +
        '</div>' +
        '<div class="field"><label>Catatan CRM</label><textarea class="textarea" name="Catatan" rows="3">' + esc(c.Catatan || '') + '</textarea></div>' +
        '<div style="display:flex;gap:10px;">' +
          '<button type="submit" class="btn btn-primary" style="flex:1;">💾 Simpan Kontak</button>' +
          (c.KontakID ? '<button type="button" class="btn btn-danger" id="btn-del-crm">Hapus</button>' : '') +
        '</div>' +
      '</form>';

    $('form-crm-contact').onsubmit = async function (ev) {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const res = await apiCall('adminCrmSaveContact', {
        contact: {
          KontakID: c.KontakID, Nama: fd.get('Nama'), Segmen: fd.get('Segmen'),
          NoWA: fd.get('NoWA'), Email: fd.get('Email'), Tag: fd.get('Tag'),
          OptOut: fd.get('OptOut'), Catatan: fd.get('Catatan')
        }
      }, 'POST');
      if (res.success) {
        if (res.data && res.data.snapshot) STATE.adminData.notifCrm = res.data.snapshot;
        closeOverlay('modal-admin-editor');
        toast(res.message, 'ok');
        renderAdminActiveTab();
      } else toast(res.message, 'err');
    };

    const delBtn = $('btn-del-crm');
    if (delBtn) {
      delBtn.onclick = async function () {
        if (!confirm('Hapus kontak ini dari CRM?')) return;
        const res = await apiCall('adminCrmDeleteContact', { kontakId: c.KontakID }, 'POST');
        if (res.success && res.data && res.data.snapshot) STATE.adminData.notifCrm = res.data.snapshot;
        closeOverlay('modal-admin-editor');
        renderAdminActiveTab();
      };
    }
    openOverlay('modal-admin-editor');
  }

  async function openCrmInteractionDrawer(kontakId) {
    const snap = STATE.adminData.notifCrm || DEMO_DB.notifCrm;
    const c = (snap.contacts || []).find(function (x) { return x.KontakID === kontakId; });
    if (!c) return;
    $('dad-title').textContent = '📋 Riwayat Interaksi — ' + c.Nama;
    $('dad-foot').classList.add('hidden');
    $('dad-body').innerHTML = '<p style="color:var(--muted);">Memuat log komunikasi...</p>';
    openOverlay('drawer-admin-detail');

    const res = await apiCall('adminCrmGetInteractions', { kontakId: kontakId }, 'POST');
    const logs = (res && res.success && Array.isArray(res.data)) ? res.data : [];

    $('dad-body').innerHTML =
      '<form id="form-crm-interaksi" style="padding:14px;background:var(--surface-2);border-radius:12px;margin-bottom:16px;">' +
        '<h4 style="margin:0 0 10px;font-size:0.9rem;">+ Catat Interaksi Baru</h4>' +
        '<div class="form-grid-2">' +
          '<div class="field"><label>Kanal</label><select class="select" name="Kanal"><option>WA</option><option>TELEPON</option><option>MEETING</option><option>EMAIL</option></select></div>' +
          '<div class="field"><label>Arah</label><select class="select" name="Arah"><option value="KELUAR">Keluar (Follow-Up)</option><option value="MASUK">Masuk (Pelanggan)</option></select></div>' +
        '</div>' +
        '<div class="field"><label>Ringkasan Pembicaraan *</label><textarea class="textarea" name="Ringkasan" rows="2" required placeholder="Misal: Klien setuju penawaran bundling 3 cabang..."></textarea></div>' +
        '<button type="submit" class="btn btn-primary btn-sm" style="width:100%;">Simpan Catatan Interaksi</button>' +
      '</form>' +
      '<div style="display:grid;gap:10px;">' +
        (logs.length ? logs.map(function (l) {
          return '<div style="padding:11px 13px;border:1px solid var(--border);border-radius:10px;font-size:0.83rem;">' +
            '<div style="display:flex;justify-content:space-between;margin-bottom:4px;">' +
              '<strong>' + esc(l.Kanal) + ' • ' + esc(l.Arah) + '</strong>' +
              '<small style="color:var(--muted);">' + esc(l.Tanggal) + '</small>' +
            '</div>' +
            '<div>' + esc(l.Ringkasan) + '</div>' +
          '</div>';
        }).join('') : '<p style="text-align:center;color:var(--muted);">Belum ada riwayat interaksi tercatat.</p>') +
      '</div>';

    $('form-crm-interaksi').onsubmit = async function (ev) {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const r = await apiCall('adminCrmAddInteraction', {
        interaction: { KontakID: kontakId, Kanal: fd.get('Kanal'), Arah: fd.get('Arah'), Ringkasan: fd.get('Ringkasan') }
      }, 'POST');
      if (r.success) {
        if (r.data && r.data.snapshot) STATE.adminData.notifCrm = r.data.snapshot;
        toast('Interaksi dicatat.', 'ok');
        openCrmInteractionDrawer(kontakId);
      }
    };
  }

  // ── PANEL ADMIN 5: NOTIFIKASI WA/EMAIL, SAKLAR 2 LAPIS, ANTREAN & BLAST ─────
  function renderAdminNotif(host) {
    const snap = STATE.adminData.notifCrm || DEMO_DB.notifCrm;
    const cfg = snap.config || {};
    const qStats = snap.queueStats || { total: 0, waiting: 0, sent: 0, failed: 0 };
    const matriks = cfg.matriks || {};
    const blasts = snap.blasts || [];
    const queueRecent = snap.queueRecent || [];

    host.innerHTML =
      // 1. Kredensial Fonnte & Saklar Utama
      '<div class="admin-2col-grid">' +
        '<div class="panel-card" style="margin:0;">' +
          '<h3 style="margin:0 0 8px;font-size:1.02rem;">🔐 Gateway Fonnte (Script Properties)</h3>' +
          '<p style="font-size:0.82rem;color:var(--muted);margin-bottom:12px;">Token disimpan terenkripsi di sisi server Google Apps Script (tidak pernah terekspos ke kode browser).</p>' +
          '<div style="padding:10px 12px;background:var(--surface-2);border-radius:10px;font-size:0.83rem;margin-bottom:12px;">' +
            'Status Token: <strong>' + (cfg.fonnteAda ? ('Tersimpan (' + esc(cfg.fonnteSamar) + ')') : 'Belum Diatur') + '</strong>' +
            '<span id="fonnte-dev-info" style="display:block;color:var(--muted);margin-top:4px;"></span>' +
          '</div>' +
          '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
            '<input type="password" id="inp-fonnte-token" class="input" placeholder="Tempel Token API Fonnte baru...">' +
            '<button type="button" class="btn btn-primary btn-sm" id="btn-save-fonnte">Simpan</button>' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button type="button" class="btn btn-outline btn-sm" id="btn-check-fonnte">📡 Cek Status Perangkat</button>' +
            '<button type="button" class="btn btn-wa btn-sm" id="btn-test-fonnte">📤 Kirim Pesan Uji</button>' +
          '</div>' +
        '</div>' +

        // Saklar 2 Lapis & Antrean Non-Blocking
        '<div class="panel-card" style="margin:0;">' +
          '<h3 style="margin:0 0 8px;font-size:1.02rem;">⚡ Antrean Non-Blocking &amp; Saklar Global</h3>' +
          '<div style="display:flex;gap:18px;flex-wrap:wrap;padding:10px 12px;background:var(--surface-2);border-radius:10px;margin-bottom:12px;">' +
            '<label style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:0.85rem;"><input type="checkbox" id="chk-global-wa" ' + (cfg.waAktif ? 'checked' : '') + '> Kanal WhatsApp Aktif</label>' +
            '<label style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:0.85rem;"><input type="checkbox" id="chk-global-email" ' + (cfg.emailAktif ? 'checked' : '') + '> Kanal Email Aktif <small style="color:var(--muted);">(Kuota: ' + esc(cfg.emailQuota || 0) + ')</small></label>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center;margin-bottom:12px;">' +
            '<div style="padding:8px;border-radius:10px;background:var(--primary-soft);"><strong>' + qStats.waiting + '</strong><br><small>Menunggu</small></div>' +
            '<div style="padding:8px;border-radius:10px;background:var(--wa-soft);"><strong>' + qStats.sent + '</strong><br><small>Terkirim</small></div>' +
            '<div style="padding:8px;border-radius:10px;background:var(--danger-soft);"><strong>' + qStats.failed + '</strong><br><small>Gagal</small></div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button type="button" class="btn btn-primary btn-sm" id="btn-drain-queue">⚡ Proses Antrean Sekarang</button>' +
            '<button type="button" class="btn btn-outline btn-sm" id="btn-clear-queue">🧹 Bersihkan yang Selesai</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // 2. Matriks Kejadian (Event Matrix)
      '<div class="panel-card">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
          '<h3 style="margin:0;font-size:1.02rem;">🎛️ Matriks Kejadian Otomatis (Lapis ke-2)</h3>' +
          '<button type="button" class="btn btn-primary btn-sm" id="btn-save-matriks">💾 Simpan Saklar &amp; Matriks</button>' +
        '</div>' +
        '<div class="table-wrap"><table class="data-table">' +
          '<thead><tr><th>Kejadian Transaksi (Event)</th><th>Kirim WhatsApp</th><th>Kirim Email HTML</th></tr></thead>' +
          '<tbody>' + Object.keys(matriks).map(function (evKey) {
            const m = matriks[evKey];
            return '<tr>' +
              '<td><strong>' + esc(m.label || evKey) + '</strong><br><small style="color:var(--muted);"><code>' + esc(evKey) + '</code></small></td>' +
              '<td><input type="checkbox" data-mtx-ev="' + esc(evKey) + '" data-mtx-ch="wa" ' + (m.wa ? 'checked' : '') + '> Aktif</td>' +
              '<td><input type="checkbox" data-mtx-ev="' + esc(evKey) + '" data-mtx-ch="email" ' + (m.email ? 'checked' : '') + '> Aktif</td>' +
            '</tr>';
          }).join('') + '</tbody></table></div>' +
      '</div>' +

      // 3. Broadcast / Blast WA Massal Ber-Batch
      '<div class="panel-card">' +
        '<h3 style="margin:0 0 6px;font-size:1.02rem;">📣 Kampanye Broadcast / Blast WhatsApp Massal (Anti-Ban)</h3>' +
        '<p style="font-size:0.82rem;color:var(--muted);margin-bottom:14px;">Otomatis melewati kontak berstatus <strong>Opt-Out = YA</strong> dan menyisipkan jeda acak manusiawi antar-pesan.</p>' +
        '<form id="form-create-blast" style="background:var(--surface-2);padding:16px;border-radius:14px;margin-bottom:16px;">' +
          '<div class="form-grid-2">' +
            '<div class="field"><label>Judul Kampanye *</label><input class="input" name="judul" required placeholder="Contoh: Promo Bundling Akhir Tahun"></div>' +
            '<div class="field"><label>Sasaran Segmen CRM</label><select class="select" name="segmen"><option value="SEMUA">Semua Kontak Aktif</option><option value="Pelanggan VIP">Pelanggan VIP</option><option value="Pembeli Aktif">Pembeli Aktif</option><option value="Prospek">Prospek</option></select></div>' +
          '</div>' +
          '<div class="form-grid-2">' +
            '<div class="field"><label>Ukuran Batch Pengiriman</label><select class="select" name="ukuranBatch"><option value="10">10 pesan / siklus</option><option value="20" selected>20 pesan / siklus (Rekomendasi)</option><option value="50">50 pesan / siklus</option></select></div>' +
            '<div class="field"><label>Jeda Aman Antar Pesan (3–8 Detik)</label><input type="number" class="input" name="jedaDetik" min="3" max="8" value="4"></div>' +
          '</div>' +
          '<div class="field"><label>Isi Pesan Broadcast * <small style="font-weight:400;color:var(--muted);">(Gunakan variabel {nama} dan {nama_toko})</small></label>' +
            '<textarea class="textarea" name="pesan" rows="3" required placeholder="Halo Kak {nama}, ada penawaran spesial khusus pelanggan terpilih dari {nama_toko}..."></textarea>' +
          '</div>' +
          '<button type="submit" class="btn btn-wa btn-shimmer">🚀 Jadwalkan Blast WA ke Antrean</button>' +
        '</form>' +

        (blasts.length ? (
          '<div class="table-wrap"><table class="data-table">' +
            '<thead><tr><th>ID &amp; Judul Kampanye</th><th>Sasaran</th><th>Progres</th><th>Batch / Jeda</th><th>Status</th><th>Kontrol</th></tr></thead>' +
            '<tbody>' + blasts.map(function (bl) {
              return '<tr>' +
                '<td><strong>' + esc(bl.Judul) + '</strong><br><small style="color:var(--muted);">' + esc(bl.BlastID) + ' • ' + esc(bl.Tanggal) + '</small></td>' +
                '<td>' + esc(bl.Sasaran) + '</td>' +
                '<td class="tabular"><strong>' + esc(bl.Terkirim) + ' / ' + esc(bl.Total) + '</strong> terkirim' + (bl.Gagal ? ' <small style="color:var(--danger);">(' + bl.Gagal + ' gagal)</small>' : '') + '</td>' +
                '<td>' + esc(bl.UkuranBatch) + ' / ' + esc(bl.JedaDetik) + 'd</td>' +
                '<td><span class="pill pill-' + esc(bl.Status) + '">' + esc(bl.Status) + '</span></td>' +
                '<td><div style="display:flex;gap:5px;">' +
                  (bl.Status !== 'SELESAI' && bl.Status !== 'DIHENTIKAN' ? (
                    '<button type="button" class="btn btn-outline btn-sm" data-blast-cmd="JEDA" data-bid="' + esc(bl.BlastID) + '">⏸</button>' +
                    '<button type="button" class="btn btn-outline btn-sm" data-blast-cmd="LANJUT" data-bid="' + esc(bl.BlastID) + '">▶</button>' +
                    '<button type="button" class="btn btn-danger btn-sm" data-blast-cmd="HENTIKAN" data-bid="' + esc(bl.BlastID) + '">⏹</button>'
                  ) : '-') +
                '</div></td>' +
              '</tr>';
            }).join('') + '</tbody></table></div>'
        ) : '') +
      '</div>' +

      // 4. Riwayat AntrianNotif Terbaru
      '<div class="panel-card">' +
        '<h3 style="margin:0 0 12px;font-size:1.02rem;">📨 Monitor Antrean Pengiriman Terbaru</h3>' +
        '<div class="table-wrap"><table class="data-table">' +
          '<thead><tr><th>ID Antrean</th><th>Kanal</th><th>Penerima</th><th>Event</th><th>Status</th><th>Respon</th></tr></thead>' +
          '<tbody>' + (queueRecent.length ? queueRecent.slice(0, 20).map(function (q) {
            return '<tr>' +
              '<td><code>' + esc(q.AntrianID) + '</code></td>' +
              '<td><strong>' + esc(q.Kanal) + '</strong></td>' +
              '<td>' + esc(q.NamaPenerima) + '<br><small style="color:var(--muted);">' + esc(q.Tujuan) + '</small></td>' +
              '<td>' + esc(q.Event) + '</td>' +
              '<td><span class="pill pill-' + esc(q.Status) + '">' + esc(q.Status) + '</span></td>' +
              '<td style="font-size:0.78rem;color:var(--muted);">' + esc(q.Respon || '-') + '</td>' +
            '</tr>';
          }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px;">Antrean kosong.</td></tr>') +
          '</tbody></table></div>' +
      '</div>';

    $('btn-save-fonnte').onclick = async function () {
      const val = $('inp-fonnte-token').value.trim();
      if (!val) { toast('Masukkan token Fonnte terlebih dahulu.', 'err'); return; }
      const res = await apiCall('adminSaveSecret', { key: 'FONNTE_TOKEN', value: val }, 'POST');
      if (res.success) {
        $('inp-fonnte-token').value = '';
        cfg.fonnteAda = res.data.ada;
        cfg.fonnteSamar = res.data.samar;
        toast(res.message, 'ok');
        renderAdminNotif(host);
      } else toast(res.message, 'err');
    };

    $('btn-check-fonnte').onclick = async function () {
      const res = await apiCall('adminFonnteStatus', { force: true }, 'POST');
      if (res.success && res.data && res.data.device) {
        const d = res.data.device;
        $('fonnte-dev-info').textContent = d.ok ? ('Perangkat Terhubung: ' + d.nama + ' (' + d.nomor + ') • Sisa Kuota: ' + d.kuota) : ('Perangkat belum terhubung: ' + (d.alasan || d.status));
      } else toast('Token belum diatur atau gagal dicek.', 'info');
    };

    $('btn-test-fonnte').onclick = async function () {
      const num = prompt('Masukkan nomor WhatsApp tujuan tes koneksi:', STATE.settings.nomor_wa_admin || '081288009900');
      if (!num) return;
      const res = await apiCall('adminTestFonnte', { nomor: num }, 'POST');
      toast(res.message, res.success ? 'ok' : 'err');
    };

    $('btn-save-matriks').onclick = async function () {
      const nextMatriks = {};
      Object.keys(matriks).forEach(function (k) { nextMatriks[k] = Object.assign({}, matriks[k]); });
      host.querySelectorAll('[data-mtx-ev]').forEach(function (chk) {
        const evk = chk.getAttribute('data-mtx-ev');
        const ch = chk.getAttribute('data-mtx-ch');
        if (nextMatriks[evk]) nextMatriks[evk][ch] = chk.checked;
      });
      const res = await apiCall('adminSaveNotifConfig', {
        config: {
          waAktif: $('chk-global-wa').checked,
          emailAktif: $('chk-global-email').checked,
          matriks: nextMatriks
        }
      }, 'POST');
      if (res.success) {
        snap.config = res.data;
        toast(res.message, 'ok');
      } else toast(res.message, 'err');
    };

    $('btn-drain-queue').onclick = async function () {
      toast('Memproses antrean notifikasi...', 'info');
      const res = await apiCall('adminDrainNotifQueue', { maxItems: 20 }, 'POST');
      if (res.success && res.data && res.data.snapshot) STATE.adminData.notifCrm = res.data.snapshot;
      toast(res.message, res.success ? 'ok' : 'err');
      updateTelemetryBar();
      renderAdminNotif(host);
    };

    $('btn-clear-queue').onclick = async function () {
      const res = await apiCall('adminClearDoneQueue', {}, 'POST');
      if (res.success && res.data && res.data.snapshot) STATE.adminData.notifCrm = res.data.snapshot;
      toast(res.message, 'ok');
      renderAdminNotif(host);
    };

    $('form-create-blast').onsubmit = async function (ev) {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const res = await apiCall('adminCreateBlast', {
        blast: {
          judul: fd.get('judul'),
          segmen: fd.get('segmen'),
          ukuranBatch: Number(fd.get('ukuranBatch')),
          jedaDetik: Number(fd.get('jedaDetik')),
          pesan: fd.get('pesan')
        }
      }, 'POST');
      if (res.success) {
        if (res.data && res.data.snapshot) STATE.adminData.notifCrm = res.data.snapshot;
        ev.target.reset();
        toast(res.message, 'ok');
        updateTelemetryBar();
        renderAdminNotif(host);
      } else toast(res.message, 'err');
    };

    host.querySelectorAll('[data-blast-cmd]').forEach(function (b) {
      b.onclick = async function () {
        const res = await apiCall('adminControlBlast', { blastId: b.getAttribute('data-bid'), command: b.getAttribute('data-blast-cmd') }, 'POST');
        if (res.success && res.data && res.data.snapshot) STATE.adminData.notifCrm = res.data.snapshot;
        toast(res.message, res.success ? 'ok' : 'err');
        renderAdminNotif(host);
      };
    });
  }

  // ── PANEL ADMIN 6: LICENSE VAULT ────────────────────────────────────────────
  function renderAdminLicenses(host) {
    const lics = STATE.adminData.licenses || [];
    const avail = lics.filter(function (l) { return l.status === 'Tersedia'; }).length;

    host.innerHTML =
      '<div class="admin-license-split">' +
        '<div class="panel-card" style="margin:0;">' +
          '<h3 style="margin:0 0 10px;font-size:1.02rem;">+ Tambah / Generate Kode Lisensi</h3>' +
          '<p style="font-size:0.82rem;color:var(--muted);">Kode berstatus <strong>Tersedia</strong> otomatis dialokasikan ketika pesanan produk terkait diubah menjadi <strong>Selesai</strong>.</p>' +
          '<form id="form-add-lic">' +
            '<div class="field"><label>Pilih Produk</label><select class="select" name="pid" id="lic-prod-sel">' +
              STATE.products.map(function (p) { return '<option value="' + esc(p.id_produk) + '">' + esc(p.nama_produk) + '</option>'; }).join('') +
            '</select></div>' +
            '<div class="field"><label>Daftar Kode Lisensi (1 per baris)</label><textarea class="textarea" id="lic-codes-txt" name="codes" rows="5" required placeholder="NUSA-PRO-2026-XXXXX"></textarea></div>' +
            '<div style="display:flex;gap:8px;">' +
              '<button type="button" class="btn btn-outline btn-sm" id="btn-gen-lic">🎲 Generate 5 Kode</button>' +
              '<button type="submit" class="btn btn-primary btn-sm" style="flex:1;">Simpan ke Vault</button>' +
            '</div>' +
          '</form>' +
        '</div>' +

        '<div class="panel-card" style="margin:0;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
            '<h3 style="margin:0;font-size:1.02rem;">Stok Vault (' + avail + ' Tersedia / ' + lics.length + ' Total)</h3>' +
          '</div>' +
          '<div class="table-wrap"><table class="data-table">' +
            '<thead><tr><th>Kode Lisensi</th><th>Produk</th><th>Status</th><th>Pesanan</th><th>Aksi</th></tr></thead>' +
            '<tbody>' + lics.slice().reverse().slice(0, 50).map(function (l) {
              return '<tr>' +
                '<td><code>' + esc(l.kode_lisensi) + '</code></td>' +
                '<td>' + esc(l.id_produk) + '</td>' +
                '<td><span class="pill ' + (l.status === 'Tersedia' ? 'pill-Lunas' : 'pill-Pending') + '">' + esc(l.status) + '</span></td>' +
                '<td>' + esc(l.id_pesanan || '-') + '</td>' +
                '<td>' + (l.status === 'Tersedia' ? '<button type="button" class="btn btn-danger btn-sm" data-del-lic="' + esc(l.kode_lisensi) + '">Hapus</button>' : '-') + '</td>' +
              '</tr>';
            }).join('') + '</tbody></table></div>' +
        '</div>' +
      '</div>';

    $('btn-gen-lic').onclick = function () {
      const pid = $('lic-prod-sel').value.replace(/[^A-Z0-9]/gi, '').slice(-3).toUpperCase();
      const lines = [];
      for (let i = 0; i < 5; i++) {
        lines.push('NUSA-' + pid + '-2026-' + Math.floor(10000 + Math.random() * 89999) + '-' + Math.random().toString(36).slice(2, 5).toUpperCase());
      }
      $('lic-codes-txt').value = ($('lic-codes-txt').value ? $('lic-codes-txt').value + '\n' : '') + lines.join('\n');
    };

    $('form-add-lic').onsubmit = async function (ev) {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const res = await apiCall('adminAddLicenses', { productId: fd.get('pid'), codes: fd.get('codes') }, 'POST');
      if (res.success) {
        if (res.data && res.data.licenses) STATE.adminData.licenses = res.data.licenses;
        toast(res.message, 'ok');
        renderAdminLicenses(host);
      } else toast(res.message, 'err');
    };

    host.querySelectorAll('[data-del-lic]').forEach(function (b) {
      b.onclick = async function () {
        const code = b.getAttribute('data-del-lic');
        const res = await apiCall('adminDeleteLicense', { code: code }, 'POST');
        if (res.success) {
          STATE.adminData.licenses = STATE.adminData.licenses.filter(function (x) { return x.kode_lisensi !== code; });
          toast('Kode lisensi dihapus.', 'ok');
          renderAdminLicenses(host);
        } else toast(res.message, 'err');
      };
    });
  }

  // ── PANEL ADMIN 7: MIGRASI & DELTA-SYNC DATABASE (gas-migrasi-database) ─────
  function renderAdminMigrasi(host) {
    const scan = STATE.lastMigrationScan;

    host.innerHTML =
      '<div class="panel-card">' +
        '<h3 style="margin:0 0 8px;font-size:1.08rem;">🔄 Migrasi &amp; Sinkronisasi Aman dari Spreadsheet Lama</h3>' +
        '<p style="font-size:0.86rem;color:var(--muted);margin-bottom:16px;">' +
          'Salin produk, pesanan, lisensi, dan riwayat dari spreadsheet versi lama (misalnya <code>NusaStore_GAS_v2.4</code>) ke database v3.0 dengan <strong>100% mode baca-saja pada file lama</strong>. Pencocokan dilakukan berdasarkan nama header kolom dan bersifat idempoten (aman dijalankan berulang untuk Delta-Sync sebelum cutover).' +
        '</p>' +
        '<div class="migrasi-url-row">' +
          '<input id="inp-migrasi-url" class="input" placeholder="Tempel URL penuh atau ID Google Spreadsheet versi lama..." value="' + esc(scan ? scan.sourceId : '') + '">' +
          '<button type="button" class="btn btn-primary" id="btn-migrasi-scan">🔍 1. Pindai Struktur &amp; Data (Dry-Run)</button>' +
        '</div>' +

        (scan ? (
          '<div style="padding:16px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border);">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:14px;">' +
              '<div>' +
                '<strong>Sumber Terdeteksi:</strong> ' + esc(scan.sourceName) +
                '<div style="font-size:0.8rem;color:var(--muted);">Ringkasan Dry-Run: <strong style="color:#059669;">+' + scan.summary.toInsert + ' baris baru</strong> • <strong style="color:var(--primary);">' + scan.summary.toUpdate + ' diperbarui</strong> • ' + scan.summary.unchanged + ' sudah identik</div>' +
              '</div>' +
              '<button type="button" class="btn btn-wa btn-shimmer" id="btn-migrasi-exec">🚀 2. Jalankan Sinkronisasi / Delta-Sync</button>' +
            '</div>' +

            '<div class="table-wrap"><table class="data-table">' +
              '<thead><tr><th>Pilih</th><th>Nama Sheet</th><th>Baris Sumber</th><th>Akan Ditambah</th><th>Akan Diperbarui</th><th>Sudah Sama</th><th>Sampel Pratinjau</th></tr></thead>' +
              '<tbody>' + (scan.reports || []).map(function (r) {
                return '<tr>' +
                  '<td><input type="checkbox" class="mig-sheet-chk" value="' + esc(r.sheet) + '" ' + (r.existsInSource ? 'checked' : 'disabled') + '></td>' +
                  '<td><strong>' + esc(r.sheet) + '</strong></td>' +
                  '<td>' + (r.existsInSource ? r.sourceCount : '<small style="color:var(--muted);">Tidak ada di sumber</small>') + '</td>' +
                  '<td style="color:#059669;font-weight:700;">+' + r.inserted + '</td>' +
                  '<td style="color:var(--primary);font-weight:700;">' + r.updated + '</td>' +
                  '<td>' + r.skipped + '</td>' +
                  '<td style="font-size:0.76rem;color:var(--muted);">' +
                    ((r.samples && r.samples.length) ? r.samples.map(function (s) { return '[' + esc(s.action) + '] ' + esc(s.label); }).join(', ') : '-') +
                  '</td>' +
                '</tr>';
              }).join('') + '</tbody></table></div>' +
          '</div>'
        ) : '') +
      '</div>';

    $('btn-migrasi-scan').onclick = async function () {
      const url = $('inp-migrasi-url').value.trim();
      if (!url && !IS_DEMO) { toast('Masukkan URL atau ID Spreadsheet sumber terlebih dahulu.', 'err'); return; }
      toast('Memindai spreadsheet sumber secara baca-saja (Dry-Run)...', 'info');
      const res = await apiCall('adminMigrateScan', { sourceIdOrUrl: url || 'DEMO_SOURCE_V24' }, 'POST');
      if (res.success) {
        STATE.lastMigrationScan = res.data;
        toast(res.message, 'ok');
        renderAdminMigrasi(host);
      } else toast(res.message, 'err');
    };

    const execBtn = $('btn-migrasi-exec');
    if (execBtn && scan) {
      execBtn.onclick = async function () {
        const sheets = Array.from(host.querySelectorAll('.mig-sheet-chk:checked')).map(function (c) { return c.value; });
        if (!sheets.length) { toast('Pilih minimal satu sheet.', 'err'); return; }
        if (!confirm('Jalankan sinkronisasi data dari "' + scan.sourceName + '" ke database aktif sekarang? (File lama tidak akan diubah sama sekali)')) return;
        toast('Menyalin & menyinkronkan data secara batch...', 'info');
        const res = await apiCall('adminMigrateExecute', { sourceIdOrUrl: $('inp-migrasi-url').value.trim() || scan.sourceId, sheets: sheets }, 'POST');
        if (res.success) {
          toast(res.message, 'ok');
          const boot = await apiCall('adminBootstrap', {}, 'POST');
          if (boot.success) ingestAdminBootstrap(boot.data);
          STATE.lastMigrationScan = null;
          renderAdminMigrasi(host);
        } else toast(res.message, 'err');
      };
    }
  }

  // ── PANEL ADMIN 8: PENGATURAN TOKO, SLIDE HERO & KEAMANAN ───────────────────
  function renderAdminSettings(host) {
    const st = STATE.settings;
    const slides = STATE.heroSlides || [];

    host.innerHTML =
      '<div class="admin-2col-grid">' +
        '<form id="form-store-settings" class="panel-card" style="margin:0;">' +
          '<h3 style="margin:0 0 12px;font-size:1.05rem;">🏪 Identitas Toko &amp; Pembayaran</h3>' +
          '<div class="form-grid-2">' +
            '<div class="field"><label>Nama Toko</label><input class="input" name="nama_toko" value="' + esc(st.nama_toko || '') + '"></div>' +
            '<div class="field"><label>Tagline</label><input class="input" name="tagline" value="' + esc(st.tagline || '') + '"></div>' +
          '</div>' +
          '<div class="field"><label>Nama Perusahaan (Faktur &amp; Footer)</label><input class="input" name="nama_perusahaan" value="' + esc(st.nama_perusahaan || '') + '"></div>' +
          '<div class="form-grid-2">' +
            '<div class="field"><label>WhatsApp Admin / CS</label><input class="input" name="nomor_wa_admin" value="' + esc(st.nomor_wa_admin || '') + '"></div>' +
            '<div class="field"><label>Email Kontak</label><input class="input" name="email_kontak" value="' + esc(st.email_kontak || '') + '"></div>' +
          '</div>' +
          '<div class="field"><label>Rekening Bank Tujuan Transfer</label><input class="input" name="rekening_bank" value="' + esc(st.rekening_bank || '') + '"></div>' +
          '<div class="form-grid-2">' +
            '<div class="field"><label>Diskon Badge Hero (%)</label><input type="number" class="input" name="hero_diskon" value="' + esc(st.hero_diskon || '25') + '"></div>' +
            '<div class="field"><label>Target Omzet Bulanan (Rp)</label><input type="number" class="input" name="target_omzet_bulanan" value="' + esc(st.target_omzet_bulanan || '36500000') + '"></div>' +
          '</div>' +
          '<div class="field"><label>Teks Pengumuman Topbar</label><input class="input" name="promo_topbar" value="' + esc(st.promo_topbar || '') + '"></div>' +
          '<button type="submit" class="btn btn-primary" style="width:100%;">💾 Simpan Pengaturan Toko</button>' +
        '</form>' +

        '<div class="panel-card" style="margin:0;">' +
          '<h3 style="margin:0 0 12px;font-size:1.05rem;">🛡️ Keamanan PIN &amp; Performa CacheX</h3>' +
          '<form id="form-change-pin" style="margin-bottom:20px;">' +
            '<div class="field"><label>PIN Lama (6 Digit)</label><input type="password" class="input" name="oldPin" maxlength="6" placeholder="••••••"></div>' +
            '<div class="field"><label>PIN Baru (6 Digit — Hindari angka urut/kembar)</label><input type="password" class="input" name="newPin" maxlength="6" required placeholder="••••••"></div>' +
            '<button type="submit" class="btn btn-outline" style="width:100%;">🔐 Perbarui PIN Admin</button>' +
          '</form>' +
          '<hr style="border:none;border-top:1px solid var(--border);margin:16px 0;">' +
          '<div style="display:grid;gap:10px;">' +
            '<button type="button" class="btn btn-outline" id="btn-clear-cachex">⚡ Segarkan CacheX Server (Google Sheets)</button>' +
            '<button type="button" class="btn btn-danger" id="btn-logout-all-dev">🚪 Keluarkan Semua Sesi Perangkat</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Editor Hero Slideshow
      '<div class="panel-card">' +
        '<h3 style="margin:0 0 8px;font-size:1.05rem;">🎞️ Konfigurasi Auto-Slideshow Hero Section (' + slides.length + ' Slide)</h3>' +
        '<p style="font-size:0.82rem;color:var(--muted);margin-bottom:14px;">Ubah judul, subjudul, lencana, atau URL gambar latar tiap slide yang berputar otomatis di halaman depan.</p>' +
        '<div id="hero-editor-list" style="display:grid;gap:14px;">' +
          slides.map(function (s, idx) {
            return '<div style="padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--surface-2);" data-hslide-box="' + idx + '">' +
              '<div style="font-weight:800;margin-bottom:8px;color:var(--primary);">Slide #' + (idx + 1) + '</div>' +
              '<div class="form-grid-2">' +
                '<div class="field"><label>Badge Atas</label><input class="input hs-badge" value="' + esc(s.badge || '') + '"></div>' +
                '<div class="field"><label>URL Gambar Slide</label><input class="input hs-image" value="' + esc(s.image || '') + '"></div>' +
              '</div>' +
              '<div class="field"><label>Judul Utama Slide</label><input class="input hs-title" value="' + esc(s.title || '') + '"></div>' +
              '<div class="field" style="margin-bottom:0;"><label>Subjudul</label><input class="input hs-sub" value="' + esc(s.subtitle || '') + '"></div>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<button type="button" class="btn btn-primary" style="margin-top:14px;" id="btn-save-hero-slides">💾 Simpan Semua Slide Hero</button>' +
      '</div>';

    $('form-store-settings').onsubmit = async function (ev) {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const obj = {};
      fd.forEach(function (v, k) { obj[k] = v; });
      const res = await apiCall('adminSaveSettings', { settings: obj }, 'POST');
      if (res.success) {
        if (res.data && res.data.settings) STATE.settings = res.data.settings;
        toast(res.message, 'ok');
      } else toast(res.message, 'err');
    };

    $('btn-save-hero-slides').onclick = async function () {
      const updated = slides.map(function (orig, idx) {
        const box = host.querySelector('[data-hslide-box="' + idx + '"]');
        return Object.assign({}, orig, {
          badge: box.querySelector('.hs-badge').value,
          image: box.querySelector('.hs-image').value,
          title: box.querySelector('.hs-title').value,
          subtitle: box.querySelector('.hs-sub').value
        });
      });
      const res = await apiCall('adminSaveSettings', { settings: { hero_slides_json: JSON.stringify(updated) } }, 'POST');
      if (res.success) {
        STATE.heroSlides = updated;
        toast('Slide Hero berhasil diperbarui!', 'ok');
      } else toast(res.message, 'err');
    };

    $('form-change-pin').onsubmit = async function (ev) {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const res = await apiCall('adminChangePin', { oldPin: fd.get('oldPin'), newPin: fd.get('newPin') }, 'POST');
      if (res.success) {
        if (res.data && res.data.token) {
          STATE.adminToken = res.data.token;
          sessionStorage.setItem(LS.ADMIN_TOKEN, STATE.adminToken);
        }
        ev.target.reset();
        toast(res.message, 'ok');
      } else toast(res.message, 'err');
    };

    $('btn-clear-cachex').onclick = async function () {
      const res = await apiCall('adminClearCache', {}, 'POST');
      toast(res.message || 'Cache disegarkan.', 'ok');
    };

    $('btn-logout-all-dev').onclick = async function () {
      if (!confirm('Keluarkan paksa semua perangkat yang sedang login?')) return;
      await apiCall('adminLogoutAll', {}, 'POST');
      STATE.adminToken = '';
      sessionStorage.removeItem(LS.ADMIN_TOKEN);
      sessionStorage.removeItem(LS.ADMIN_BOOT);
      exitAdminToStorefront();
      toast('Seluruh perangkat telah dikeluarkan.', 'ok');
    };
  }

  // ── INISIALISASI TEMA, EVENT DELEGATION & BOOTSTRAP ─────────────────────────
  function initTheme() {
    const saved = localStorage.getItem(LS.THEME) || 'light';
    setTheme(saved);
    const btn = $('btn-theme-toggle');
    if (btn) {
      btn.onclick = function () {
        const cur = document.documentElement.getAttribute('data-theme') || 'light';
        setTheme(cur === 'dark' ? 'light' : 'dark');
      };
    }
  }

  function setTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    localStorage.setItem(LS.THEME, mode);
    if ($('icon-sun')) $('icon-sun').classList.toggle('hidden', mode !== 'dark');
    if ($('icon-moon')) $('icon-moon').classList.toggle('hidden', mode === 'dark');
  }

  function initScrollReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }
    const vh = window.innerHeight || 800;
    const obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('is-visible');
          obs.unobserve(en.target);
        }
      });
    }, { threshold: 0.04, rootMargin: '0px 0px 40px 0px' });
    els.forEach(function (el) {
      const r = el.getBoundingClientRect();
      if (r.top < vh * 1.05) {
        el.classList.add('is-visible');
      } else {
        obs.observe(el);
      }
    });
  }

  function bindGlobalEvents() {
    // Hero Carousel
    const heroBox = $('hero-carousel');
    if (heroBox) {
      heroBox.addEventListener('mouseenter', function () { STATE.heroHover = true; });
      heroBox.addEventListener('mouseleave', function () { STATE.heroHover = false; });
    }
    if ($('hero-prev')) $('hero-prev').onclick = function () { stepHeroSlide(-1); };
    if ($('hero-next')) $('hero-next').onclick = function () { stepHeroSlide(1); };

    // Delegasi klik terpusat
    document.addEventListener('click', function (ev) {
      const t = ev.target;
      if (!t || !t.closest) return;

      // Tutup modal / drawer
      const closeBtn = t.closest('[data-close]');
      if (closeBtn) { closeOverlay(closeBtn.getAttribute('data-close')); return; }
      if (t.classList.contains('overlay') || t.classList.contains('drawer-backdrop')) {
        t.classList.add('hidden');
        return;
      }

      // Titik slide Hero
      const hDot = t.closest('[data-hero-dot]');
      if (hDot) { STATE.heroIdx = Number(hDot.getAttribute('data-hero-dot')); renderHeroSlideshow(); return; }

      // CTA Hero
      const hCta = t.closest('.hero-cta-primary');
      if (hCta) {
        const target = hCta.getAttribute('data-target') || '#products';
        if (target.indexOf('cat:') === 0) {
          STATE.filterCat = target.slice(4);
          renderCategories();
          renderCatalog();
        }
        const sec = $('products');
        if (sec) sec.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      if (t.closest('.hero-cta-wa')) {
        $('wa-chat-card').classList.remove('hidden');
        return;
      }

      // Pilih kategori
      const catPick = t.closest('[data-cat-pick]');
      if (catPick) {
        STATE.filterCat = catPick.getAttribute('data-cat-pick');
        renderCategories();
        renderCatalog();
        const sec = $('products');
        if (sec) sec.scrollIntoView({ behavior: 'smooth' });
        return;
      }

      // Panah & titik galeri pada Kartu Produk
      const stepBtn = t.closest('[data-pcard-step]');
      if (stepBtn) {
        ev.stopPropagation();
        const card = stepBtn.closest('.pcard');
        setCardSlide(card, Number(card.getAttribute('data-slide-cur') || 0) + Number(stepBtn.getAttribute('data-pcard-step')));
        return;
      }
      const gotoDot = t.closest('[data-pcard-goto]');
      if (gotoDot) {
        ev.stopPropagation();
        const card = gotoDot.closest('.pcard');
        setCardSlide(card, Number(gotoDot.getAttribute('data-pcard-goto')));
        return;
      }

      // Favorit / Wishlist
      const wishBtn = t.closest('[data-wish-toggle]');
      if (wishBtn) {
        ev.stopPropagation();
        toggleWish(wishBtn.getAttribute('data-wish-toggle'));
        return;
      }

      // Tambah keranjang & Quick buy WA
      const addBtn = t.closest('[data-add-cart]');
      if (addBtn) { addToCart(addBtn.getAttribute('data-add-cart'), 1); return; }
      const qBuy = t.closest('[data-quick-buy]');
      if (qBuy) { openProductModal(qBuy.getAttribute('data-quick-buy')); return; }

      // Buka modal detail produk
      const openProd = t.closest('[data-open-prod]');
      if (openProd) { openProductModal(openProd.getAttribute('data-open-prod')); return; }

      // Kartu Testimoni: tombol balik manual vs klik buka Pop-Up Lengkap
      const manFlip = t.closest('[data-manual-flip]');
      if (manFlip) {
        ev.stopPropagation();
        const sc = manFlip.closest('.tcard-scene');
        if (sc) sc.classList.toggle('is-flipped');
        return;
      }
      const openTestiBtn = t.closest('[data-open-testi]');
      if (openTestiBtn) {
        ev.stopPropagation();
        openTestimonialPopup(openTestiBtn.getAttribute('data-open-testi'));
        return;
      }
      const tScene = t.closest('.tcard-scene');
      if (tScene) {
        openTestimonialPopup(tScene.getAttribute('data-tid'));
        return;
      }

      // Tutup saran pencarian bila klik di luar
      if (!t.closest('.search-box') && $('search-suggest')) {
        $('search-suggest').classList.add('hidden');
      }
    });

    // Pencarian Instan + Dropdown Saran (Debounced 60ms Tanpa Lag Ketikan)
    const sInp = $('search-input');
    const sSel = $('search-cat-select');
    const sSug = $('search-suggest');
    const debouncedCatalogRender = debounce(function () { renderCatalog(); }, 60);
    if (sInp) {
      sInp.oninput = function () {
        STATE.searchQuery = sInp.value;
        debouncedCatalogRender();
        const q = sInp.value.trim().toLowerCase();
        if (q.length < 2) { sSug.classList.add('hidden'); return; }
        const matches = STATE.products.filter(function (p) {
          return (p.nama_produk + ' ' + p.spesifikasi).toLowerCase().indexOf(q) >= 0;
        }).slice(0, 5);
        if (!matches.length) { sSug.classList.add('hidden'); return; }
        sSug.innerHTML = matches.map(function (p) {
          return '<div class="suggest-item" data-sug-pid="' + esc(p.id_produk) + '">' +
            '<img src="' + esc(p.gambar_url) + '" alt="">' +
            '<div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:0.84rem;">' + esc(p.nama_produk) + '</div>' +
            '<div style="color:var(--primary);font-weight:800;font-size:0.78rem;">Rp ' + rupiah(effPrice(p)) + '</div></div>' +
          '</div>';
        }).join('');
        sSug.classList.remove('hidden');
        sSug.querySelectorAll('[data-sug-pid]').forEach(function (el) {
          el.onclick = function () { sSug.classList.add('hidden'); openProductModal(el.getAttribute('data-sug-pid')); };
        });
      };
    }
    if (sSel) {
      sSel.onchange = function () { STATE.filterCat = sSel.value; renderCategories(); renderCatalog(); };
    }
    if ($('search-submit-btn')) {
      $('search-submit-btn').onclick = function () { const s = $('products'); if (s) s.scrollIntoView({ behavior: 'smooth' }); };
    }
    if ($('btn-reset-cat')) {
      $('btn-reset-cat').onclick = function () { STATE.filterCat = 'ALL'; STATE.searchQuery = ''; if (sInp) sInp.value = ''; renderCategories(); renderCatalog(); };
    }
    if ($('sort-select')) {
      $('sort-select').onchange = function (e) { STATE.sortBy = e.target.value; renderCatalog(); };
    }

    // Header & Footer Drawer / Modal triggers
    const openTrackerFn = function () {
      if ($('wa-chat-card')) $('wa-chat-card').classList.add('hidden');
      openOrderTrackerModal('', '');
    };
    if ($('btn-open-order-tracker')) $('btn-open-order-tracker').onclick = openTrackerFn;
    if ($('top-open-tracker')) $('top-open-tracker').onclick = openTrackerFn;
    if ($('ft-open-tracker')) $('ft-open-tracker').onclick = openTrackerFn;
    if ($('wa-open-tracker-btn')) $('wa-open-tracker-btn').onclick = openTrackerFn;
    if ($('btn-open-cart')) $('btn-open-cart').onclick = function () { openCartDrawer('cart'); };
    if ($('ft-open-cart')) $('ft-open-cart').onclick = function () { openCartDrawer('cart'); };
    if ($('btn-open-wishlist')) $('btn-open-wishlist').onclick = function () { openCartDrawer('wish'); };
    if ($('btn-write-testi')) $('btn-write-testi').onclick = function () { openOverlay('modal-testimoni-submit'); };
    if ($('btn-open-review-form')) $('btn-open-review-form').onclick = function () { openOverlay('modal-testimoni-submit'); };
    if ($('btn-banner-consult')) $('btn-banner-consult').onclick = function () { $('wa-chat-card').classList.remove('hidden'); };

    // Kirim Testimoni Publik
    if ($('form-public-testi')) {
      $('form-public-testi').onsubmit = async function (ev) {
        ev.preventDefault();
        const fd = new FormData(ev.target);
        const obj = {};
        fd.forEach(function (v, k) { obj[k] = v; });
        const res = await apiCall('submitPublicTestimonial', { payload: obj }, 'POST');
        if (res.success) {
          closeOverlay('modal-testimoni-submit');
          ev.target.reset();
          if (IS_DEMO) { STATE.testimonials = DEMO_DB.testimonials; renderTestimonials(); }
          toast(res.message, 'ok');
          sayMascot('Terima kasih atas ulasannya Kak! 💖', 3200);
        } else toast(res.message, 'err');
      };
    }

    // Newsletter
    if ($('newsletter-form')) {
      $('newsletter-form').onsubmit = async function (ev) {
        ev.preventDefault();
        const em = $('nl-email-input').value.trim();
        const res = await apiCall('subscribeNewsletter', { email: em }, 'POST');
        if (res.success) { $('nl-email-input').value = ''; toast(res.message, 'ok'); }
        else toast(res.message, 'err');
      };
    }

    // Floating WhatsApp Chat
    if ($('wa-float-btn')) {
      $('wa-float-btn').onclick = function () { $('wa-chat-card').classList.toggle('hidden'); };
    }
    if ($('wa-chat-close')) {
      $('wa-chat-close').onclick = function () { $('wa-chat-card').classList.add('hidden'); };
    }
    document.querySelectorAll('.wa-quick-topic').forEach(function (b) {
      b.onclick = function () { openDirectWaChat(b.getAttribute('data-topic')); };
    });
    if ($('wa-direct-form')) {
      $('wa-direct-form').onsubmit = function (ev) {
        ev.preventDefault();
        const txt = $('wa-direct-input').value.trim();
        openDirectWaChat(txt || 'Halo Tim NusaStore, saya ingin berkonsultasi.');
        $('wa-direct-input').value = '';
      };
    }

    // Admin Portal Login & Navigasi
    const openAdminFn = function () {
      if (STATE.adminToken) { enterAdminPortal(null); return; }
      openOverlay('modal-admin-login');
      setTimeout(function () { if ($('input-admin-pin')) $('input-admin-pin').focus(); }, 100);
    };
    if ($('btn-open-admin')) $('btn-open-admin').onclick = openAdminFn;
    if ($('ft-open-admin')) $('ft-open-admin').onclick = openAdminFn;

    if ($('tab-login-pin')) {
      $('tab-login-pin').onclick = function () {
        $('tab-login-pin').classList.add('is-active');
        $('tab-login-darurat').classList.remove('is-active');
        $('form-login-pin').classList.remove('hidden');
        $('form-login-darurat').classList.add('hidden');
      };
    }
    if ($('tab-login-darurat')) {
      $('tab-login-darurat').onclick = function () {
        $('tab-login-darurat').classList.add('is-active');
        $('tab-login-pin').classList.remove('is-active');
        $('form-login-darurat').classList.remove('hidden');
        $('form-login-pin').classList.add('hidden');
      };
    }

    if ($('form-login-pin')) {
      $('form-login-pin').onsubmit = async function (ev) {
        ev.preventDefault();
        const pin = $('input-admin-pin').value.trim();
        const res = await apiCall('adminLogin', { pin: pin, withData: true }, 'POST');
        if (res.success && res.data) {
          STATE.adminToken = res.data.token;
          sessionStorage.setItem(LS.ADMIN_TOKEN, STATE.adminToken);
          $('input-admin-pin').value = '';
          closeOverlay('modal-admin-login');
          toast(res.message, 'ok');
          enterAdminPortal(res.data.boot);
        } else toast(res.message || 'PIN tidak sesuai.', 'err');
      };
    }

    if ($('form-login-darurat')) {
      $('form-login-darurat').onsubmit = async function (ev) {
        ev.preventDefault();
        const res = await apiCall('adminEmergencyLogin', {
          username: $('input-darurat-user').value.trim(),
          password: $('input-darurat-pass').value,
          withData: true
        }, 'POST');
        if (res.success && res.data) {
          STATE.adminToken = res.data.token;
          sessionStorage.setItem(LS.ADMIN_TOKEN, STATE.adminToken);
          $('input-darurat-pass').value = '';
          closeOverlay('modal-admin-login');
          toast(res.message, 'ok');
          enterAdminPortal(res.data.boot);
        } else toast(res.message || 'Gagal memulihkan akses.', 'err');
      };
    }

    document.querySelectorAll('.admin-nav-btn[data-tab]').forEach(function (b) {
      b.onclick = function () {
        STATE.adminTab = b.getAttribute('data-tab');
        renderAdminActiveTab();
      };
    });

    if ($('btn-back-storefront')) $('btn-back-storefront').onclick = exitAdminToStorefront;
    if ($('btn-admin-logout')) {
      $('btn-admin-logout').onclick = function () {
        STATE.adminToken = '';
        sessionStorage.removeItem(LS.ADMIN_TOKEN);
        sessionStorage.removeItem(LS.ADMIN_BOOT);
        exitAdminToStorefront();
        toast('Anda telah keluar dari Admin Portal.', 'info');
      };
    }
    if ($('btn-admin-refresh')) {
      $('btn-admin-refresh').onclick = async function () {
        toast('Menyegarkan data dari server...', 'info');
        const res = await apiCall('adminBootstrap', {}, 'POST');
        if (res.success) { ingestAdminBootstrap(res.data); renderAdminActiveTab(); toast('Data terbaru berhasil dimuat!', 'ok'); }
      };
    }
    if ($('btn-quick-manual-order')) {
      $('btn-quick-manual-order').onclick = openManualOrderModal;
    }
  }

  async function initApp() {
    initTheme();
    bindGlobalEvents();

    if (IS_DEMO) {
      if ($('demo-mode-banner')) $('demo-mode-banner').classList.remove('hidden');
      if ($('demo-pin-display')) $('demo-pin-display').textContent = DEMO_SESSION_PIN;
    }

    // 1. 0ms Instant First Paint (SWR): tampilkan seketika dari cache lokal ATAU katalog bawaan tanpa menunggu jaringan!
    const cached = loadJson(LS.PUB_CACHE, null);
    if (cached && cached.data && !IS_DEMO) {
      applyPublicData(cached.data);
    } else {
      applyPublicData(DEMO_DB);
    }

    initScrollReveal();
    initLifelikeMascot();

    // 2. Revalidasi segar dari REST API Google Apps Script secara non-blocking di latar belakang
    if (!IS_DEMO) {
      try {
        const fresh = await apiCall('getPublicData', {}, 'GET');
        if (fresh && fresh.success && fresh.data) {
          applyPublicData(fresh.data);
          saveJson(LS.PUB_CACHE, { ts: Date.now(), data: fresh.data });
        }
      } catch (e) {
        if (!cached) {
          toast('Koneksi server sedang padat — menampilkan katalog instan.', 'info');
        }
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
