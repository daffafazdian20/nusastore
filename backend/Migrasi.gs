/**
 * ============================================================================
 *  NusaStore v3.0 ProAPI — Modul Migrasi & Delta-Sync Database (Migrasi.gs)
 *  Berdasarkan skill: gas-migrasi-database
 *
 *  Prinsip Keamanan Data:
 *  1. 100% BACA-SAJA terhadap Spreadsheet Lama (tidak pernah menulis/mengubah sumber)
 *  2. Pencocokan berbasis NAMA HEADER (aman walau urutan kolom berbeda versi)
 *  3. Mode Pindai (Dry-Run) sebelum eksekusi nyata
 *  4. Upsert Idempoten (aman dijalankan berulang kali untuk Delta-Sync sebelum cutover)
 *  5. Melindungi status lebih maju di aplikasi baru (misal Lunas/Selesai tidak mundur ke Pending)
 * ============================================================================
 */

const MIGRASI_SCHEMA = [
  {
    name: 'Kategori',
    key: 'id_kategori',
    aliases: { nama: 'nama_kategori', ikon: 'icon_url' },
    updatable: ['nama_kategori', 'icon_url', 'subjudul', 'urutan']
  },
  {
    name: 'Produk',
    key: 'id_produk',
    aliases: { nama: 'nama_produk', gambar: 'gambar_url', promo: 'harga_coret' },
    updatable: ['nama_produk', 'kategori', 'deskripsi', 'harga', 'harga_coret', 'gambar_url', 'badge_promo', 'spesifikasi', 'rating', 'jumlah_ulasan', 'urutan', 'galeri_url']
  },
  {
    name: 'Pesanan',
    key: 'id_pesanan',
    aliases: { no_wa: 'no_whatsapp', pelanggan: 'nama_pelanggan', total: 'total_harga', status: 'status_pesanan' },
    updatable: ['nama_pelanggan', 'no_whatsapp', 'catatan', 'link_bukti_transfer', 'metode_bayar', 'kunci_lisensi', 'riwayat_status']
  },
  {
    name: 'Testimoni',
    key: 'id_testimoni',
    aliases: {},
    updatable: ['nama', 'jabatan_perusahaan', 'avatar_url', 'produk_terkait', 'rating', 'kutipan_singkat', 'cerita_lengkap', 'hasil_highlight', 'tanggal', 'terverifikasi', 'tampil']
  },
  {
    name: 'Lisensi',
    key: 'kode_lisensi',
    aliases: {},
    updatable: ['status', 'id_pesanan', 'tanggal_alokasi']
  },
  {
    name: 'Newsletter',
    key: 'email',
    aliases: {},
    updatable: ['sumber']
  },
  {
    name: 'Pengaturan',
    key: 'key',
    aliases: {},
    updatable: [] // Hanya tambah key yang belum ada agar konfigurasi v3.0 tidak tertimpa
  },
  {
    name: 'Log_WA',
    key: '__LOG_FP__', // Sidik jari gabungan kronologis
    aliases: {},
    isLog: true,
    updatable: []
  },
  {
    name: 'CRM_Kontak',
    key: 'KontakID',
    aliases: {},
    updatable: ['Nama', 'Email', 'NoWA', 'Segmen', 'Tag', 'StatusWA', 'Catatan']
  }
];

function extractSpreadsheetId_(input) {
  const s = str_(input, 400);
  if (!s) throw new Error('Masukkan URL atau ID Google Spreadsheet sumber terlebih dahulu.');
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  throw new Error('Format URL atau ID Spreadsheet tidak dikenali.');
}

/**
 * Buka spreadsheet lama secara BACA-SAJA & pastikan bukan spreadsheet aktif v3 sendiri.
 */
function openSourceSpreadsheet_(idOrUrl) {
  const srcId = extractSpreadsheetId_(idOrUrl);
  const targetId = prop_('SPREADSHEET_ID');
  if (targetId && srcId === targetId) {
    throw new Error('Spreadsheet sumber sama dengan database aktif saat ini. Pilih spreadsheet versi lama yang berbeda.');
  }
  try {
    return SpreadsheetApp.openById(srcId);
  } catch (e) {
    throw new Error('Tidak dapat membuka Spreadsheet sumber. Pastikan akun Google ini memiliki akses Lihat (Viewer) ke spreadsheet lama.');
  }
}

function readSourceSheetByHeader_(srcSs, spec) {
  const sh = srcSs.getSheetByName(spec.name);
  if (!sh) return { exists: false, rows: [] };
  const lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr < 2 || lc < 1) return { exists: true, rows: [] };

  const values = sh.getRange(1, 1, lr, lc).getValues();
  const rawHeaders = values[0].map(function (h) {
    const clean = String(h || '').trim();
    const lower = clean.toLowerCase();
    return (spec.aliases && spec.aliases[lower]) ? spec.aliases[lower] : clean;
  });

  // Peta nama header case-insensitive ke nama header kanonik HEADERS[spec.name]
  const canonicalMap = {};
  (HEADERS[spec.name] || []).forEach(function (ch) { canonicalMap[ch.toLowerCase()] = ch; });

  const mappedHeaders = rawHeaders.map(function (rh) {
    return canonicalMap[rh.toLowerCase()] || rh;
  });

  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const rawRow = values[i];
    const obj = {};
    let nonEmpty = false;
    mappedHeaders.forEach(function (h, c) {
      if (!h) return;
      const val = rawRow[c];
      if (val !== '' && val !== null && val !== undefined) nonEmpty = true;
      obj[h] = val;
    });
    if (nonEmpty) rows.push(sanitizeMigratedRow_(spec.name, obj));
  }
  return { exists: true, rows: rows };
}

function sanitizeMigratedRow_(sheetName, o) {
  const out = Object.assign({}, o);
  if (sheetName === 'Pesanan') {
    if (out.no_whatsapp !== undefined) out.no_whatsapp = normalizePhone_(out.no_whatsapp);
    if (out.total_harga !== undefined) out.total_harga = Math.round(num_(out.total_harga));
    if (out.qty !== undefined) out.qty = Math.max(1, Math.round(num_(out.qty) || 1));
  } else if (sheetName === 'Produk') {
    if (out.harga !== undefined) out.harga = Math.round(num_(out.harga));
    if (out.harga_coret !== undefined) out.harga_coret = Math.round(num_(out.harga_coret));
    if (out.gambar_url !== undefined) out.gambar_url = driveImg_(out.gambar_url);
  } else if (sheetName === 'Newsletter') {
    if (out.email !== undefined) out.email = str_(out.email, 140).toLowerCase();
  } else if (sheetName === 'CRM_Kontak') {
    if (out.NoWA !== undefined && out.NoWA !== '') out.NoWA = normalizePhone_(out.NoWA);
    if (out.Email !== undefined) out.Email = str_(out.Email, 140).toLowerCase();
  }
  return out;
}

function logFingerprint_(o) {
  const t = o.waktu instanceof Date ? o.waktu.toISOString().slice(0, 19) : String(o.waktu || '').slice(0, 19);
  return [t, String(o.id_pesanan || ''), normalizePhone_(o.nomor), String(o.template || '')].join('|');
}

function statusRank_(st) {
  const order = { Pending: 1, Diproses: 2, Lunas: 3, Selesai: 4, Batal: 0 };
  return order[String(st || '')] !== undefined ? order[String(st || '')] : 0;
}

/**
 * Rencanakan atau jalankan upsert satu sheet secara idempoten.
 */
function processSheetMigration_(srcSs, spec, dryRun) {
  const src = readSourceSheetByHeader_(srcSs, spec);
  if (!src.exists) {
    return {
      sheet: spec.name,
      existsInSource: false,
      sourceCount: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      samples: []
    };
  }

  const targetTable = readTable_(spec.name);
  const headers = targetTable.headers.length ? targetTable.headers : HEADERS[spec.name].slice();
  const H = {};
  headers.forEach(function (h, i) { H[h] = i; });

  let inserted = 0, updated = 0, skipped = 0;
  const samples = [];

  if (spec.isLog) {
    const existingSet = {};
    targetTable.rows.forEach(function (r) {
      const o = {};
      headers.forEach(function (h, i) { o[h] = r[i]; });
      existingSet[logFingerprint_(o)] = true;
    });

    const toAppend = [];
    src.rows.forEach(function (so) {
      const fp = logFingerprint_(so);
      if (existingSet[fp]) {
        skipped++;
      } else {
        existingSet[fp] = true;
        toAppend.push(rowFromObject_(headers, so));
        inserted++;
        if (samples.length < 3) samples.push({ key: String(so.id_pesanan || '-'), action: 'BARU', label: String(so.nomor || '-') });
      }
    });

    if (!dryRun && toAppend.length) {
      const merged = targetTable.rows.concat(toAppend);
      merged.sort(function (a, b) {
        const da = a[H.waktu] instanceof Date ? a[H.waktu].getTime() : Date.parse(String(a[H.waktu] || '')) || 0;
        const db = b[H.waktu] instanceof Date ? b[H.waktu].getTime() : Date.parse(String(b[H.waktu] || '')) || 0;
        return da - db;
      });
      targetTable.sheet.getRange(2, 1, merged.length, headers.length).setValues(merged);
    }

    return {
      sheet: spec.name,
      existsInSource: true,
      sourceCount: src.rows.length,
      inserted: inserted,
      updated: 0,
      skipped: skipped,
      samples: samples
    };
  }

  // Sheet ber-kunci unik (Produk, Pesanan, Kategori, Lisensi, dll.)
  const keyIdx = H[spec.key];
  const targetIndexByKey = {};
  targetTable.rows.forEach(function (r, idx) {
    const k = String(r[keyIdx] === undefined ? '' : r[keyIdx]).trim();
    if (k) targetIndexByKey[k.toLowerCase()] = idx;
  });

  const rowsWorking = targetTable.rows.map(function (r) { return r.slice(); });
  const rowsToAppend = [];
  let dirtyExisting = false;

  src.rows.forEach(function (so) {
    const rawKey = String(so[spec.key] === undefined ? '' : so[spec.key]).trim();
    if (!rawKey) { skipped++; return; }
    const normKey = rawKey.toLowerCase();

    if (targetIndexByKey[normKey] === undefined) {
      targetIndexByKey[normKey] = -1;
      rowsToAppend.push(rowFromObject_(headers, so));
      inserted++;
      if (samples.length < 3) {
        samples.push({
          key: rawKey,
          action: 'BARU',
          label: String(so.nama_produk || so.nama_pelanggan || so.nama_kategori || so.Nama || so.value || rawKey).slice(0, 60)
        });
      }
      return;
    }

    const rIdx = targetIndexByKey[normKey];
    if (rIdx < 0) { skipped++; return; }
    const curRow = rowsWorking[rIdx];
    let rowChanged = false;

    // Aturan khusus Pesanan: naikkan status hanya bila sumber lebih maju daripada target
    if (spec.name === 'Pesanan' && so.status_pesanan) {
      const curStatus = String(curRow[H.status_pesanan] || 'Pending');
      const srcStatus = String(so.status_pesanan || 'Pending');
      if (statusRank_(srcStatus) > statusRank_(curStatus)) {
        curRow[H.status_pesanan] = srcStatus;
        rowChanged = true;
      }
    }

    // Perbarui kolom updatable bila nilai sumber terisi dan berbeda, tanpa menghapus data baru yang sudah ada di target
    spec.updatable.forEach(function (col) {
      const cIdx = H[col];
      if (cIdx === undefined) return;
      const srcVal = so[col];
      if (srcVal === undefined || srcVal === null || srcVal === '') return;
      const curVal = curRow[cIdx];

      // Jangan timpa galeri_url multi-gambar di target bila sumber kosong
      if (spec.name === 'Produk' && col === 'galeri_url' && String(curVal || '').trim() !== '') return;

      if (String(plain_(curVal)) !== String(plain_(srcVal))) {
        curRow[cIdx] = srcVal;
        rowChanged = true;
      }
    });

    if (rowChanged) {
      updated++;
      dirtyExisting = true;
      if (samples.length < 3) {
        samples.push({
          key: rawKey,
          action: 'UPDATE',
          label: String(so.nama_produk || so.nama_pelanggan || rawKey).slice(0, 60)
        });
      }
    } else {
      skipped++;
    }
  });

  if (!dryRun) {
    if (dirtyExisting && rowsWorking.length) {
      targetTable.sheet.getRange(2, 1, rowsWorking.length, headers.length).setValues(rowsWorking);
    }
    if (rowsToAppend.length) {
      targetTable.sheet.getRange(targetTable.sheet.getLastRow() + 1, 1, rowsToAppend.length, headers.length).setValues(rowsToAppend);
    }
  }

  return {
    sheet: spec.name,
    existsInSource: true,
    sourceCount: src.rows.length,
    inserted: inserted,
    updated: updated,
    skipped: skipped,
    samples: samples
  };
}

/**
 * 1. Mode Pindai (Dry-Run): baca & bandingkan seluruh sheet tanpa menulis 1 sel pun.
 */
function adminMigrateScan(token, sourceIdOrUrl) {
  return guard_(token, function () {
    const srcSs = openSourceSpreadsheet_(sourceIdOrUrl);
    const reports = MIGRASI_SCHEMA.map(function (spec) {
      return processSheetMigration_(srcSs, spec, true);
    });

    let totalInsert = 0, totalUpdate = 0, totalSkip = 0;
    reports.forEach(function (r) {
      totalInsert += r.inserted;
      totalUpdate += r.updated;
      totalSkip += r.skipped;
    });

    return ok_({
      mode: 'DRY_RUN',
      sourceName: srcSs.getName(),
      sourceId: srcSs.getId(),
      sourceSheets: srcSs.getSheets().map(function (s) { return s.getName(); }),
      summary: { toInsert: totalInsert, toUpdate: totalUpdate, unchanged: totalSkip },
      reports: reports,
      scannedAt: new Date().toISOString()
    }, 'Pemindaian Dry-Run selesai. Tidak ada data yang diubah.');
  });
}

/**
 * 2. Mode Eksekusi / Delta-Sync: salin & perbarui baris ke Spreadsheet v3 secara batch.
 */
function adminMigrateExecute(token, sourceIdOrUrl, selectedSheets) {
  return guard_(token, function () {
    const srcSs = openSourceSpreadsheet_(sourceIdOrUrl);
    const filterSet = (Array.isArray(selectedSheets) && selectedSheets.length)
      ? selectedSheets.reduce(function (acc, n) { acc[String(n)] = true; return acc; }, {})
      : null;

    const specs = MIGRASI_SCHEMA.filter(function (s) { return !filterSet || !!filterSet[s.name]; });
    if (!specs.length) return fail_('Pilih minimal satu sheet untuk disinkronkan.');

    const reports = withLock_(function () {
      const out = specs.map(function (spec) {
        return processSheetMigration_(srcSs, spec, false);
      });
      bumpVer_('CATALOG');
      bumpVer_('ORDERS');
      bumpVer_('CRM');
      return out;
    });

    // Sinkronkan juga kontak pesanan baru ke CRM_Kontak secara otomatis
    try { adminCrmSync(token); } catch (e) { /* skip */ }

    let totalInsert = 0, totalUpdate = 0, totalSkip = 0;
    reports.forEach(function (r) {
      totalInsert += r.inserted;
      totalUpdate += r.updated;
      totalSkip += r.skipped;
    });

    return ok_({
      mode: 'EXECUTED',
      sourceName: srcSs.getName(),
      sourceId: srcSs.getId(),
      summary: { inserted: totalInsert, updated: totalUpdate, skipped: totalSkip },
      reports: reports,
      executedAt: new Date().toISOString()
    }, 'Sinkronisasi berhasil: ' + totalInsert + ' data baru disalin, ' + totalUpdate + ' diperbarui, ' + totalSkip + ' sudah sama.');
  });
}
