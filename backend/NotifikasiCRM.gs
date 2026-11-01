/**
 * ============================================================================
 *  NusaStore v3.0 ProAPI — Modul Notifikasi WA/Email & CRM Kontak (NotifikasiCRM.gs)
 *  Berdasarkan skill: gas-notifikasi-wa-crm + gas-scale-turbo + gas-rahasia-script-properties
 *
 *  Fitur Utama:
 *  1. Antrean Notifikasi Non-Blocking (Sheet AntrianNotif + Trigger 1 Menit)
 *  2. Saklar 2 Lapis: Global (WA / Email) + Matriks Kejadian (Event Matrix)
 *  3. Pengiriman WhatsApp Fonnte + Email HTML Responsif (MailApp)
 *  4. Blast WA Massal Ber-Batch (10/20/50) + Jeda Acak Anti-Ban (3–8 Detik)
 *  5. Validasi Nomor WA Aktif via Fonnte (/validate) + Kepatuhan Opt-Out
 *  6. CRM Kontak Multi-Sumber (Sinkron Pesanan & Newsletter, Gabung Duplikat, Log Interaksi)
 * ============================================================================
 */

const DEFAULT_NOTIF_MATRIKS = {
  PESANAN_BARU: { label: 'Pesanan Baru Masuk (Checkout Web)', wa: true, email: true },
  TAGIHAN_TERBIT: { label: 'Tagihan / Instruksi Pembayaran', wa: true, email: true },
  PEMBAYARAN_LUNAS: { label: 'Konfirmasi Pembayaran Lunas', wa: true, email: true },
  PESANAN_SELESAI: { label: 'Pesanan Selesai + Lisensi & Faktur', wa: true, email: true },
  PENGINGAT_BAYAR: { label: 'Pengingat Pembayaran Jatuh Tempo', wa: true, email: false }
};

function ensureNotifProps_() {
  if (!prop_('NOTIF_WA_AKTIF')) setProp_('NOTIF_WA_AKTIF', '1');
  if (!prop_('NOTIF_EMAIL_AKTIF')) setProp_('NOTIF_EMAIL_AKTIF', '1');
  if (!prop_('NOTIF_MATRIKS')) setProp_('NOTIF_MATRIKS', JSON.stringify(DEFAULT_NOTIF_MATRIKS));
}

function getNotifConfig_() {
  ensureNotifProps_();
  let matriks = DEFAULT_NOTIF_MATRIKS;
  try {
    const parsed = JSON.parse(prop_('NOTIF_MATRIKS') || '{}');
    matriks = Object.assign({}, DEFAULT_NOTIF_MATRIKS, parsed);
  } catch (e) { /* gunakan default */ }

  let emailQuota = 0;
  try { emailQuota = MailApp.getRemainingDailyQuota(); } catch (e) { emailQuota = 100; }

  return {
    waAktif: prop_('NOTIF_WA_AKTIF', '1') === '1',
    emailAktif: prop_('NOTIF_EMAIL_AKTIF', '1') === '1',
    matriks: matriks,
    emailQuota: emailQuota,
    antrianAda: prop_('ANTRIAN_ADA') === '1',
    fonnteAda: !!prop_('FONNTE_TOKEN'),
    fonnteSamar: samarkan_(prop_('FONNTE_TOKEN'))
  };
}

/**
 * Pasang time-driven trigger setiap 1 menit untuk prosesAntrianNotif tanpa duplikasi.
 */
function pasangTriggerNotif() {
  const fnName = 'prosesAntrianNotif';
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === fnName) return { installed: true, existing: true };
  }
  ScriptApp.newTrigger(fnName).timeBased().everyMinutes(1).create();
  return { installed: true, existing: false };
}

// ============================================================================
//  1. ANTREAN NON-BLOCKING & PEMBANGUN PESAN TRANSAKSIONAL
// ============================================================================
function isAllowedChannel_(eventKey, kanal) {
  const cfg = getNotifConfig_();
  if (kanal === 'WA' && !cfg.waAktif) return false;
  if (kanal === 'EMAIL' && !cfg.emailAktif) return false;
  if (!eventKey || eventKey === 'BLAST_WA' || eventKey === 'MANUAL') return true;
  const rule = cfg.matriks[eventKey];
  if (!rule) return true;
  return kanal === 'WA' ? !!rule.wa : !!rule.email;
}

function kirimNotif_(item) {
  return kirimNotifBatch_([item]);
}

function kirimNotifBatch_(items) {
  if (!Array.isArray(items) || !items.length) return 0;
  const ts = fmtDate_(now_(), 'yyyy-MM-dd HH:mm:ss');
  const validRows = [];

  // Cek daftar OptOut untuk pesan non-transaksional / promosi
  const optOutSet = {};
  try {
    toObjects_(readTable_(SH.CRM_KONTAK)).forEach(function (k) {
      if (String(k.OptOut).toUpperCase() === 'YA') {
        if (k.NoWA) optOutSet[normalizePhone_(k.NoWA)] = true;
        if (k.Email) optOutSet[String(k.Email).toLowerCase()] = true;
      }
    });
  } catch (e) { /* abaikan */ }

  items.forEach(function (it) {
    if (!it || !it.Pesan) return;
    const kanal = String(it.Kanal || 'WA').toUpperCase();
    const ev = String(it.Event || 'MANUAL');
    if (!isAllowedChannel_(ev, kanal)) return;

    let tujuan = '';
    if (kanal === 'WA') {
      tujuan = normalizePhone_(it.Tujuan);
      if (!validPhone_(tujuan)) return;
    } else if (kanal === 'EMAIL') {
      tujuan = str_(it.Tujuan, 140).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(tujuan)) return;
    } else {
      return;
    }

    const isBlastOrPromo = ev === 'BLAST_WA' || !!it.BlastID;
    if (isBlastOrPromo && optOutSet[tujuan]) return;

    validRows.push({
      AntrianID: 'Q-' + Date.now().toString(36).toUpperCase() + '-' + acak_(4, '0123456789ABCDEF'),
      Kanal: kanal,
      Tujuan: tujuan,
      NamaPenerima: str_(it.NamaPenerima, 80),
      Subjek: str_(it.Subjek, 160),
      Pesan: str_(it.Pesan, 12000),
      Event: ev,
      RefID: str_(it.RefID, 40),
      BlastID: str_(it.BlastID, 40),
      Status: 'MENUNGGU',
      Percobaan: 0,
      Respon: '',
      DibuatPada: ts,
      DikirimPada: ''
    });
  });

  if (!validRows.length) return 0;

  withLock_(function () {
    const sh = sheet_(SH.ANTRIAN_NOTIF);
    const headers = headersOf_(sh);
    const matrix = validRows.map(function (o) { return rowFromObject_(headers, o); });
    sh.getRange(sh.getLastRow() + 1, 1, matrix.length, headers.length).setValues(matrix);
    setProp_('ANTRIAN_ADA', '1');
    bumpVer_('CRM');
  });
  return validRows.length;
}

function buildHtmlEmail_(st, title, recipientName, summaryHtml, ctaLabel, ctaUrl) {
  const toko = str_(st.nama_toko || 'NusaStore', 80);
  const perusahaan = str_(st.nama_perusahaan || 'PT Nusa Digital Teknologi', 100);
  const btn = (ctaLabel && ctaUrl)
    ? '<p style="margin:24px 0"><a href="' + ctaUrl + '" style="background:#2563EB;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">' + ctaLabel + '</a></p>'
    : '';
  return '<div style="font-family:Inter,Arial,sans-serif;background:#F8FAFC;padding:28px 14px;color:#0F172A">' +
    '<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden">' +
    '<div style="background:linear-gradient(135deg,#0F172A,#1E3A8A);padding:22px 26px;color:#FFFFFF">' +
    '<div style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:#38BDF8;font-weight:700">' + toko + ' Official Notification</div>' +
    '<h2 style="margin:6px 0 0;font-size:20px">' + title + '</h2></div>' +
    '<div style="padding:24px 26px;font-size:14px;line-height:1.65;color:#334155">' +
    '<p style="margin-top:0">Halo <strong>' + recipientName + '</strong>,</p>' +
    summaryHtml + btn +
    '<hr style="border:none;border-top:1px solid #E2E8F0;margin:22px 0">' +
    '<p style="font-size:12px;color:#64748B;margin:0">' + perusahaan + '<br>Butuh bantuan cepat? Hubungi WhatsApp CS: +' + (st.nomor_wa_admin || '') + '</p>' +
    '</div></div></div>';
}

function extractEmailFromOrder_(order, emailOverride) {
  if (emailOverride && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailOverride)) return emailOverride.toLowerCase();
  const m = String(order.catatan || '').match(/([^\s@|]+@[^\s@|]+\.[^\s@|]{2,})/);
  if (m) return m[1].toLowerCase();
  // Cari dari CRM_Kontak berdasarkan nomor WA
  const wa = normalizePhone_(order.no_whatsapp);
  const found = toObjects_(readTable_(SH.CRM_KONTAK)).filter(function (k) { return normalizePhone_(k.NoWA) === wa && k.Email; })[0];
  return found ? String(found.Email).toLowerCase() : '';
}

function enqueueOrderEvent_(eventKey, order, emailOverride, linkInvoice) {
  const st = readSettings_();
  const vars = orderVars_(order, st, linkInvoice || '');
  const batch = [];

  let tplKey = 'template_tagihan_transfer';
  let subject = '[' + st.nama_toko + '] Pesanan ' + order.id_pesanan;
  let emailTitle = 'Informasi Pesanan ' + order.id_pesanan;

  if (eventKey === 'PESANAN_BARU' || eventKey === 'TAGIHAN_TERBIT') {
    tplKey = 'template_tagihan_transfer';
    subject = '[' + st.nama_toko + '] Tagihan Pesanan ' + order.id_pesanan + ' — Rp ' + vars.total;
    emailTitle = 'Tagihan Pesanan ' + order.id_pesanan;
  } else if (eventKey === 'PEMBAYARAN_LUNAS') {
    tplKey = 'template_pesan_lunas';
    subject = '[' + st.nama_toko + '] Pembayaran Lunas — ' + order.id_pesanan;
    emailTitle = 'Pembayaran Diterima & Lunas';
  } else if (eventKey === 'PESANAN_SELESAI') {
    tplKey = 'template_pesan_selesai';
    subject = '[' + st.nama_toko + '] Pesanan Selesai & Lisensi — ' + order.id_pesanan;
    emailTitle = 'Pesanan Selesai & Bukti Kepemilikan';
  } else if (eventKey === 'PENGINGAT_BAYAR') {
    tplKey = 'template_pengingat';
    subject = '[' + st.nama_toko + '] Pengingat Pembayaran ' + order.id_pesanan;
    emailTitle = 'Pengingat Pembayaran Pesanan';
  }

  const waMsg = renderTemplate_(st[tplKey] || '', vars);
  if (waMsg && validPhone_(normalizePhone_(order.no_whatsapp))) {
    batch.push({
      Kanal: 'WA',
      Tujuan: order.no_whatsapp,
      NamaPenerima: order.nama_pelanggan,
      Subjek: subject,
      Pesan: waMsg,
      Event: eventKey,
      RefID: order.id_pesanan
    });
  }

  const email = extractEmailFromOrder_(order, emailOverride);
  if (email) {
    const summaryHtml = '<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px 16px;margin:14px 0">' +
      '<div><strong>ID Pesanan:</strong> ' + order.id_pesanan + '</div>' +
      '<div><strong>Produk/Layanan:</strong> ' + order.nama_produk + '</div>' +
      '<div><strong>Total:</strong> Rp ' + vars.total + '</div>' +
      '<div><strong>Status:</strong> ' + order.status_pesanan + '</div>' +
      (order.kunci_lisensi ? '<div><strong>Kunci Lisensi:</strong> <code>' + order.kunci_lisensi + '</code></div>' : '') +
      (st.rekening_bank && order.status_pesanan === 'Pending' ? '<div style="margin-top:8px"><strong>Rekening Tujuan:</strong> ' + st.rekening_bank + '</div>' : '') +
      '</div>';
    const htmlBody = buildHtmlEmail_(st, emailTitle, order.nama_pelanggan, summaryHtml,
      linkInvoice ? 'Unduh Faktur Resmi (PDF)' : 'Hubungi CS via WhatsApp',
      linkInvoice || ('https://wa.me/' + st.nomor_wa_admin));
    batch.push({
      Kanal: 'EMAIL',
      Tujuan: email,
      NamaPenerima: order.nama_pelanggan,
      Subjek: subject,
      Pesan: htmlBody,
      Event: eventKey,
      RefID: order.id_pesanan
    });
  }

  return kirimNotifBatch_(batch);
}

// ============================================================================
//  2. WORKER PENGURAS ANTREAN (TRIGGER 1 MENIT / TOMBOL MANUAL)
// ============================================================================
function prosesAntrianNotif(opsi) {
  opsi = opsi || {};
  // Fast exit tanpa menyentuh Spreadsheet bila antrean kosong (gas-scale-turbo)
  if (!opsi.force && prop_('ANTRIAN_ADA') !== '1') {
    return { processed: 0, sent: 0, failed: 0, remaining: 0, fastExit: true };
  }

  const cache = CacheService.getScriptCache();
  if (cache.get('notif_worker_lease')) {
    return { processed: 0, sent: 0, failed: 0, busy: true };
  }
  cache.put('notif_worker_lease', '1', 55);

  const t0 = Date.now();
  const maxItems = Math.min(40, Math.max(1, num_(opsi.maxItems) || 15));

  try {
    const t = readTable_(SH.ANTRIAN_NOTIF);
    if (!t.rows.length) {
      setProp_('ANTRIAN_ADA', '0');
      return { processed: 0, sent: 0, failed: 0, remaining: 0 };
    }
    const H = {};
    t.headers.forEach(function (h, i) { H[h] = i; });

    // Baca status kampanye BlastWA agar item yang dijeda/dihentikan tidak dikirim
    const blastTable = readTable_(SH.BLAST_WA);
    const blastH = {};
    blastTable.headers.forEach(function (h, i) { blastH[h] = i; });
    const blastMap = {};
    blastTable.rows.forEach(function (r, idx) {
      const bid = String(r[blastH.BlastID] || '');
      if (bid) blastMap[bid] = { idx: idx, row: r, status: String(r[blastH.Status] || '') };
    });

    let processed = 0, sent = 0, failed = 0, remaining = 0;
    let lo = -1, hi = -1;
    let blastDirty = false;
    const waLogs = [];

    for (let i = 0; i < t.rows.length; i++) {
      const r = t.rows[i];
      const st = String(r[H.Status] || '');
      if (st !== 'MENUNGGU' && st !== 'COBA_LAGI') continue;

      const bid = String(r[H.BlastID] || '');
      if (bid && blastMap[bid]) {
        const bst = blastMap[bid].status;
        if (bst === 'DIJEDA') { remaining++; continue; }
        if (bst === 'DIHENTIKAN') {
          r[H.Status] = 'DIBATALKAN';
          r[H.Respon] = 'Kampanye blast dihentikan admin';
          if (lo < 0) lo = i;
          hi = i;
          continue;
        }
      }

      // Batasi waktu jalan worker maks 42 detik agar tidak kena batas waktu GAS
      if (processed >= maxItems || (Date.now() - t0) > 42000) {
        remaining++;
        continue;
      }

      // Jeda acak manusiawi 3–8 detik untuk pesan Blast WA massal (mulai pesan ke-2)
      if (bid && processed > 0) {
        const baseDelay = blastMap[bid] ? Math.max(3, Math.min(8, num_(blastMap[bid].row[blastH.JedaDetik]) || 4)) : 4;
        const jitterMs = Math.round((baseDelay + Math.random() * 2.2) * 1000);
        if ((Date.now() - t0) + jitterMs > 44000) {
          remaining++;
          continue;
        }
        Utilities.sleep(jitterMs);
      }

      const kanal = String(r[H.Kanal] || 'WA');
      const tujuan = String(r[H.Tujuan] || '');
      const subjek = String(r[H.Subjek] || '');
      const pesan = String(r[H.Pesan] || '');
      const refId = String(r[H.RefID] || '');
      const percobaan = num_(r[H.Percobaan]) + 1;
      let okSend = false, respNote = '', httpCode = 0, msgId = '';

      if (kanal === 'WA') {
        const tk = prop_('FONNTE_TOKEN');
        if (!tk) {
          okSend = false;
          respNote = 'FONNTE_TOKEN belum diatur';
        } else {
          try {
            const resp = UrlFetchApp.fetch(APP.FONNTE_URL, {
              method: 'post',
              headers: { Authorization: tk },
              muteHttpExceptions: true,
              payload: { target: tujuan, message: pesan, countryCode: '62' }
            });
            httpCode = resp.getResponseCode();
            const b = JSON.parse(resp.getContentText() || '{}');
            okSend = httpCode === 200 && b.status === true;
            msgId = Array.isArray(b.id) ? b.id.join(',') : String(b.id || '');
            respNote = okSend ? 'Terkirim (' + (b.process || 'ok') + ')' : redaksi_(String(b.reason || b.detail || ('HTTP ' + httpCode)));
          } catch (err) {
            respNote = redaksi_(err.message);
          }
        }
        waLogs.push({
          waktu: now_(),
          id_pesanan: refId || bid || '-',
          nomor: tujuan,
          template: String(r[H.Event] || 'antrean').toLowerCase(),
          status: okSend ? 'TERKIRIM' : 'GAGAL',
          http_code: httpCode,
          message_id: msgId,
          ringkasan_pesan: pesan.replace(/\s+/g, ' ').slice(0, 180)
        });
      } else if (kanal === 'EMAIL') {
        try {
          if (MailApp.getRemainingDailyQuota() <= 0) {
            okSend = false;
            respNote = 'Kuota harian MailApp habis';
          } else {
            MailApp.sendEmail({
              to: tujuan,
              subject: subjek || 'Notifikasi Resmi NusaStore',
              htmlBody: pesan
            });
            okSend = true;
            respNote = 'Email terkirim';
          }
        } catch (err) {
          respNote = redaksi_(err.message);
        }
      }

      r[H.Percobaan] = percobaan;
      r[H.Respon] = respNote.slice(0, 240);
      if (okSend) {
        r[H.Status] = 'TERKIRIM';
        r[H.DikirimPada] = fmtDate_(now_(), 'yyyy-MM-dd HH:mm:ss');
        sent++;
        try {
          if (kanal === 'WA') crmTouchInteractionByPhone_(tujuan, 'WA', 'KELUAR', pesan.replace(/\s+/g, ' ').slice(0, 140), refId || bid);
        } catch (e2) { /* skip */ }
      } else if (percobaan >= 3 || respNote.indexOf('FONNTE_TOKEN belum') === 0) {
        r[H.Status] = 'GAGAL';
        failed++;
      } else {
        r[H.Status] = 'COBA_LAGI';
        remaining++;
      }

      if (bid && blastMap[bid]) {
        const br = blastMap[bid].row;
        if (okSend) br[blastH.Terkirim] = num_(br[blastH.Terkirim]) + 1;
        else if (r[H.Status] === 'GAGAL') br[blastH.Gagal] = num_(br[blastH.Gagal]) + 1;
        if (num_(br[blastH.Terkirim]) + num_(br[blastH.Gagal]) >= num_(br[blastH.Total])) {
          br[blastH.Status] = 'SELESAI';
          br[blastH.SelesaiPada] = fmtDate_(now_(), 'yyyy-MM-dd HH:mm:ss');
        } else if (br[blastH.Status] === 'MENUNGGU') {
          br[blastH.Status] = 'BERJALAN';
        }
        blastDirty = true;
      }

      if (lo < 0) lo = i;
      hi = i;
      processed++;
    }

    withLock_(function () {
      if (lo >= 0) {
        t.sheet.getRange(lo + 2, 1, hi - lo + 1, t.headers.length).setValues(t.rows.slice(lo, hi + 1));
      }
      if (blastDirty && blastTable.rows.length) {
        blastTable.sheet.getRange(2, 1, blastTable.rows.length, blastTable.headers.length).setValues(blastTable.rows);
      }
      if (waLogs.length) {
        const lSh = sheet_(SH.LOG_WA);
        const lH = headersOf_(lSh);
        const lRows = waLogs.map(function (o) { return rowFromObject_(lH, o); });
        lSh.getRange(lSh.getLastRow() + 1, 1, lRows.length, lH.length).setValues(lRows);
        bumpVer_('ORDERS');
      }
      setProp_('ANTRIAN_ADA', remaining > 0 ? '1' : '0');
      bumpVer_('CRM');
    });

    return { processed: processed, sent: sent, failed: failed, remaining: remaining };
  } finally {
    cache.remove('notif_worker_lease');
  }
}

// ============================================================================
//  3. ADMIN ENDPOINTS: KONFIGURASI NOTIFIKASI, ANTREAN & BLAST WA MASSAL
// ============================================================================
function getNotifCrmSnapshot_() {
  const contacts = toObjects_(readTable_(SH.CRM_KONTAK));
  const queueAll = toObjects_(readTable_(SH.ANTRIAN_NOTIF));
  const blasts = toObjects_(readTable_(SH.BLAST_WA)).reverse();
  const interactions = toObjects_(readTable_(SH.CRM_INTERAKSI)).slice(-120).reverse();

  let qWaiting = 0, qSent = 0, qFailed = 0;
  queueAll.forEach(function (q) {
    if (q.Status === 'MENUNGGU' || q.Status === 'COBA_LAGI') qWaiting++;
    else if (q.Status === 'TERKIRIM') qSent++;
    else if (q.Status === 'GAGAL') qFailed++;
  });

  return {
    config: getNotifConfig_(),
    queueStats: { total: queueAll.length, waiting: qWaiting, sent: qSent, failed: qFailed },
    queueRecent: queueAll.slice(-100).reverse(),
    blasts: blasts.slice(0, 40),
    contacts: contacts,
    interactions: interactions
  };
}

function adminNotifCrmBootstrap(token) {
  return guard_(token, function () {
    return ok_(getNotifCrmSnapshot_());
  });
}

function adminSaveNotifConfig(token, cfg) {
  return guard_(token, function () {
    cfg = cfg || {};
    if (cfg.waAktif !== undefined) setProp_('NOTIF_WA_AKTIF', cfg.waAktif ? '1' : '0');
    if (cfg.emailAktif !== undefined) setProp_('NOTIF_EMAIL_AKTIF', cfg.emailAktif ? '1' : '0');
    if (cfg.matriks && typeof cfg.matriks === 'object') {
      const clean = {};
      Object.keys(DEFAULT_NOTIF_MATRIKS).forEach(function (k) {
        const src = cfg.matriks[k] || DEFAULT_NOTIF_MATRIKS[k];
        clean[k] = {
          label: DEFAULT_NOTIF_MATRIKS[k].label,
          wa: !!src.wa,
          email: !!src.email
        };
      });
      setProp_('NOTIF_MATRIKS', JSON.stringify(clean));
    }
    bumpVer_('CRM');
    return ok_(getNotifConfig_(), 'Pengaturan saklar & matriks notifikasi disimpan.');
  });
}

function adminDrainNotifQueue(token, maxItems) {
  return guard_(token, function () {
    const res = prosesAntrianNotif({ force: true, maxItems: maxItems || 15 });
    return ok_({ result: res, snapshot: getNotifCrmSnapshot_() },
      'Pemrosesan antrean selesai: ' + res.sent + ' terkirim, ' + res.failed + ' gagal, ' + res.remaining + ' tersisa.');
  });
}

function adminClearDoneQueue(token) {
  return guard_(token, function () {
    const kept = withLock_(function () {
      const t = readTable_(SH.ANTRIAN_NOTIF);
      const H = {};
      t.headers.forEach(function (h, i) { H[h] = i; });
      const active = t.rows.filter(function (r) {
        const st = String(r[H.Status] || '');
        return st === 'MENUNGGU' || st === 'COBA_LAGI';
      });
      if (t.sheet.getLastRow() > 1) {
        t.sheet.getRange(2, 1, t.sheet.getLastRow() - 1, t.headers.length).clearContent();
      }
      if (active.length) {
        t.sheet.getRange(2, 1, active.length, t.headers.length).setValues(active);
      }
      setProp_('ANTRIAN_ADA', active.length > 0 ? '1' : '0');
      bumpVer_('CRM');
      return active.length;
    });
    return ok_({ remaining: kept, snapshot: getNotifCrmSnapshot_() }, 'Riwayat antrean selesai dibersihkan.');
  });
}

function adminCreateBlast(token, b) {
  return guard_(token, function () {
    b = b || {};
    const judul = str_(b.judul, 120);
    const tplPesan = str_(b.pesan, 3500);
    const segmen = str_(b.segmen || 'SEMUA', 60);
    const tagFilter = str_(b.tag || '', 60).toLowerCase();
    const hanyaTerdaftar = !!b.hanyaTerdaftar;
    const ukuranBatch = [10, 20, 50].indexOf(num_(b.ukuranBatch)) >= 0 ? num_(b.ukuranBatch) : 20;
    const jedaDetik = Math.max(3, Math.min(8, Math.round(num_(b.jedaDetik) || 4)));

    if (judul.length < 3) return fail_('Judul kampanye Blast WA minimal 3 karakter.');
    if (tplPesan.length < 10) return fail_('Isi pesan Blast WA minimal 10 karakter.');

    const st = readSettings_();
    const contacts = toObjects_(readTable_(SH.CRM_KONTAK));
    const targets = contacts.filter(function (k) {
      if (String(k.OptOut).toUpperCase() === 'YA') return false;
      const wa = normalizePhone_(k.NoWA);
      if (!validPhone_(wa)) return false;
      if (segmen && segmen !== 'SEMUA' && String(k.Segmen) !== segmen) return false;
      if (tagFilter && String(k.Tag || '').toLowerCase().indexOf(tagFilter) < 0) return false;
      if (hanyaTerdaftar && String(k.StatusWA) === 'Tidak Terdaftar') return false;
      return true;
    });

    if (!targets.length) {
      return fail_('Tidak ada kontak penerima yang memenuhi kriteria (atau seluruhnya berstatus Opt-Out).');
    }

    const blastId = 'BL-' + Utilities.formatDate(now_(), APP.TZ, 'yyyyMMdd') + '-' + acak_(4, '0123456789ABCDEF');
    const ts = fmtDate_(now_(), 'yyyy-MM-dd HH:mm:ss');

    const blastRec = {
      BlastID: blastId,
      Judul: judul,
      Pesan: tplPesan,
      Sasaran: segmen + (tagFilter ? ' (Tag: ' + tagFilter + ')' : ''),
      Total: targets.length,
      Terkirim: 0,
      Gagal: 0,
      UkuranBatch: ukuranBatch,
      JedaDetik: jedaDetik,
      Status: 'MENUNGGU',
      DibuatOleh: 'Admin Portal',
      Tanggal: ts,
      SelesaiPada: ''
    };

    withLock_(function () {
      appendObject_(sheet_(SH.BLAST_WA), blastRec);
    });

    const queueItems = targets.map(function (k) {
      const rendered = tplPesan
        .replace(/\{nama\}/gi, k.Nama || 'Kak')
        .replace(/\{segmen\}/gi, k.Segmen || '')
        .replace(/\{nama_toko\}/gi, st.nama_toko || 'NusaStore');
      return {
        Kanal: 'WA',
        Tujuan: k.NoWA,
        NamaPenerima: k.Nama,
        Subjek: judul,
        Pesan: rendered,
        Event: 'BLAST_WA',
        RefID: k.KontakID,
        BlastID: blastId
      };
    });

    const queued = kirimNotifBatch_(queueItems);
    return ok_({ blast: blastRec, queued: queued, snapshot: getNotifCrmSnapshot_() },
      'Kampanye "' + judul + '" berhasil dijadwalkan untuk ' + queued + ' kontak penerima.');
  });
}

function adminControlBlast(token, blastId, command) {
  return guard_(token, function () {
    const cmd = String(command || '').toUpperCase();
    const mapStatus = { JEDA: 'DIJEDA', LANJUT: 'BERJALAN', HENTIKAN: 'DIHENTIKAN' };
    const nextStatus = mapStatus[cmd];
    if (!nextStatus) return fail_('Perintah kontrol blast tidak valid.');

    const updated = withLock_(function () {
      const n = updateWhere_(SH.BLAST_WA,
        function (o) { return String(o.BlastID) === String(blastId); },
        function (o) {
          o.Status = nextStatus;
          if (cmd === 'HENTIKAN') o.SelesaiPada = fmtDate_(now_(), 'yyyy-MM-dd HH:mm:ss');
          return o;
        }
      );
      if (cmd === 'HENTIKAN') {
        updateWhere_(SH.ANTRIAN_NOTIF,
          function (q) { return String(q.BlastID) === String(blastId) && (q.Status === 'MENUNGGU' || q.Status === 'COBA_LAGI'); },
          function (q) { q.Status = 'DIBATALKAN'; q.Respon = 'Dihentikan oleh Admin'; return q; }
        );
      } else if (cmd === 'LANJUT') {
        setProp_('ANTRIAN_ADA', '1');
      }
      bumpVer_('CRM');
      return n;
    });

    if (!updated) return fail_('Kampanye Blast tidak ditemukan.');
    return ok_({ blastId: blastId, status: nextStatus, snapshot: getNotifCrmSnapshot_() }, 'Status kampanye diubah menjadi ' + nextStatus + '.');
  });
}

// ============================================================================
//  4. VALIDASI NOMOR WA FONNTE (/validate) & MANAJEMEN CRM KONTAK
// ============================================================================
function adminValidateWaNumbers(token, kontakIds) {
  return guard_(token, function () {
    const tk = prop_('FONNTE_TOKEN');
    if (!tk) return fail_('Simpan FONNTE_TOKEN terlebih dahulu untuk memvalidasi nomor WhatsApp.');

    const all = toObjects_(readTable_(SH.CRM_KONTAK));
    let candidates = Array.isArray(kontakIds) && kontakIds.length
      ? all.filter(function (k) { return kontakIds.indexOf(k.KontakID) >= 0; })
      : all.filter(function (k) { return !k.StatusWA || k.StatusWA === 'Belum Dicek'; });

    candidates = candidates.filter(function (k) { return validPhone_(normalizePhone_(k.NoWA)); }).slice(0, 50);
    if (!candidates.length) return fail_('Tidak ada nomor WA yang perlu dicek.');

    const phoneList = candidates.map(function (k) { return normalizePhone_(k.NoWA); });
    let registeredSet = {};
    try {
      const r = UrlFetchApp.fetch(APP.FONNTE_VALIDATE_URL, {
        method: 'post',
        headers: { Authorization: tk },
        muteHttpExceptions: true,
        payload: { target: phoneList.join(','), countryCode: '62' }
      });
      const b = JSON.parse(r.getContentText() || '{}');
      if (b.status === false) return fail_('Fonnte menolak validasi: ' + redaksi_(String(b.reason || 'Error')));
      (b.registered || []).forEach(function (num) { registeredSet[normalizePhone_(num)] = true; });
    } catch (e) {
      return fail_('Gagal menghubungi server Fonnte: ' + redaksi_(e.message));
    }

    const idMap = {};
    candidates.forEach(function (k) {
      const norm = normalizePhone_(k.NoWA);
      idMap[k.KontakID] = registeredSet[norm] ? 'Terdaftar' : 'Tidak Terdaftar';
    });

    const ts = fmtDate_(now_(), 'yyyy-MM-dd HH:mm');
    withLock_(function () {
      updateWhere_(SH.CRM_KONTAK,
        function (o) { return idMap[o.KontakID] !== undefined; },
        function (o) {
          o.StatusWA = idMap[o.KontakID];
          o.CekWAAt = ts;
          o.DiperbaruiPada = ts;
          return o;
        }
      );
      bumpVer_('CRM');
    });

    const okCount = Object.keys(idMap).filter(function (id) { return idMap[id] === 'Terdaftar'; }).length;
    return ok_({ checked: candidates.length, registered: okCount, snapshot: getNotifCrmSnapshot_() },
      candidates.length + ' nomor selesai dicek: ' + okCount + ' terdaftar aktif di WhatsApp.');
  });
}

function crmUpsertFromOrder_(order, emailHint) {
  const wa = normalizePhone_(order.no_whatsapp);
  if (!validPhone_(wa)) return;
  const email = extractEmailFromOrder_(order, emailHint);
  const ts = fmtDate_(now_(), 'yyyy-MM-dd HH:mm:ss');

  withLock_(function () {
    const t = readTable_(SH.CRM_KONTAK);
    const H = {};
    t.headers.forEach(function (h, i) { H[h] = i; });
    let matchIdx = -1;
    for (let i = 0; i < t.rows.length; i++) {
      if (normalizePhone_(t.rows[i][H.NoWA]) === wa) { matchIdx = i; break; }
    }
    if (matchIdx >= 0) {
      const r = t.rows[matchIdx];
      if (!r[H.Nama] && order.nama_pelanggan) r[H.Nama] = order.nama_pelanggan;
      if (!r[H.Email] && email) { r[H.Email] = email; r[H.EmailValid] = 'YA'; }
      r[H.RefID] = order.id_pesanan || r[H.RefID];
      r[H.DiperbaruiPada] = ts;
      t.sheet.getRange(matchIdx + 2, 1, 1, t.headers.length).setValues([r]);
    } else {
      appendObject_(t.sheet, {
        KontakID: 'KTK-' + acak_(6, '0123456789ABCDEF'),
        Nama: order.nama_pelanggan || 'Pelanggan Web',
        Email: email || '',
        NoWA: wa,
        Segmen: PAID_STATUS.indexOf(order.status_pesanan) >= 0 ? 'Pembeli Aktif' : 'Prospek',
        Sumber: 'Pesanan',
        RefID: order.id_pesanan || '',
        Tag: 'Checkout Web',
        StatusWA: 'Belum Dicek',
        CekWAAt: '',
        EmailValid: email ? 'YA' : 'BELUM',
        OptOut: 'TIDAK',
        Catatan: '',
        JumlahPesan: 0,
        TerakhirDihubungi: '',
        Info: order.nama_produk || '',
        DibuatPada: ts,
        DiperbaruiPada: ts
      });
    }
    bumpVer_('CRM');
  });
}

function crmUpsertFromNewsletter_(email) {
  email = str_(email, 120).toLowerCase();
  if (!email) return;
  const ts = fmtDate_(now_(), 'yyyy-MM-dd HH:mm:ss');
  withLock_(function () {
    const t = readTable_(SH.CRM_KONTAK);
    const H = {};
    t.headers.forEach(function (h, i) { H[h] = i; });
    for (let i = 0; i < t.rows.length; i++) {
      if (String(t.rows[i][H.Email] || '').toLowerCase() === email) return;
    }
    appendObject_(t.sheet, {
      KontakID: 'KTK-' + acak_(6, '0123456789ABCDEF'),
      Nama: email.split('@')[0],
      Email: email,
      NoWA: '',
      Segmen: 'Subscriber',
      Sumber: 'Newsletter',
      RefID: '',
      Tag: 'Newsletter',
      StatusWA: 'Belum Dicek',
      CekWAAt: '',
      EmailValid: 'YA',
      OptOut: 'TIDAK',
      Catatan: '',
      JumlahPesan: 0,
      TerakhirDihubungi: '',
      Info: 'Langganan Footer Etalase',
      DibuatPada: ts,
      DiperbaruiPada: ts
    });
    bumpVer_('CRM');
  });
}

function crmTouchInteractionByPhone_(phone, kanal, arah, ringkasan, refId) {
  const norm = normalizePhone_(phone);
  if (!norm) return;
  const ts = fmtDate_(now_(), 'yyyy-MM-dd HH:mm:ss');
  let targetKontakId = '';

  updateWhere_(SH.CRM_KONTAK,
    function (o) { return normalizePhone_(o.NoWA) === norm; },
    function (o) {
      targetKontakId = o.KontakID;
      o.JumlahPesan = num_(o.JumlahPesan) + 1;
      o.TerakhirDihubungi = ts;
      o.DiperbaruiPada = ts;
      return o;
    }
  );
  if (targetKontakId) {
    appendObject_(sheet_(SH.CRM_INTERAKSI), {
      InteraksiID: 'INT-' + acak_(6, '0123456789ABCDEF'),
      KontakID: targetKontakId,
      Kanal: kanal || 'WA',
      Arah: arah || 'KELUAR',
      Ringkasan: str_(ringkasan, 220),
      RefID: str_(refId, 40),
      Oleh: 'Sistem',
      Tanggal: ts
    });
  }
}

/**
 * Sinkronisasi multi-sumber idempoten dari Pesanan & Newsletter ke CRM_Kontak
 * tanpa menimpa Tag, Catatan, atau OptOut yang sudah diisi Admin.
 */
function adminCrmSync(token) {
  return guard_(token, function () {
    const orders = readOrders_();
    const newsletters = toObjects_(readTable_(SH.NEWSLETTER));
    const ts = fmtDate_(now_(), 'yyyy-MM-dd HH:mm:ss');

    const stats = withLock_(function () {
      const t = readTable_(SH.CRM_KONTAK);
      const H = {};
      t.headers.forEach(function (h, i) { H[h] = i; });
      const byPhone = {}, byEmail = {};

      t.rows.forEach(function (r, idx) {
        const p = normalizePhone_(r[H.NoWA]);
        const em = String(r[H.Email] || '').toLowerCase();
        if (p) byPhone[p] = idx;
        if (em) byEmail[em] = idx;
      });

      // Hitung frekuensi order per nomor WA untuk menentukan segmen otomatis
      const orderAgg = {};
      orders.forEach(function (o) {
        const p = normalizePhone_(o.no_whatsapp);
        if (!validPhone_(p)) return;
        if (!orderAgg[p]) orderAgg[p] = { count: 0, paidCount: 0, spent: 0, latest: o };
        orderAgg[p].count++;
        if (PAID_STATUS.indexOf(o.status_pesanan) >= 0) {
          orderAgg[p].paidCount++;
          orderAgg[p].spent += num_(o.total_harga);
        }
        orderAgg[p].latest = o;
      });

      let added = 0, updated = 0;
      const newRows = [];

      Object.keys(orderAgg).forEach(function (p) {
        const agg = orderAgg[p];
        const o = agg.latest;
        const autoSegmen = (agg.paidCount >= 2 || agg.spent >= 5000000)
          ? 'Pelanggan VIP'
          : agg.paidCount >= 1 ? 'Pembeli Aktif' : 'Prospek';
        const infoRingkas = agg.count + ' pesanan • Total Rp ' + rupiah_(agg.spent);

        if (byPhone[p] !== undefined) {
          const r = t.rows[byPhone[p]];
          if (!r[H.Nama] && o.nama_pelanggan) r[H.Nama] = o.nama_pelanggan;
          if (!r[H.Segmen] || r[H.Segmen] === 'Prospek') r[H.Segmen] = autoSegmen;
          r[H.Info] = infoRingkas;
          r[H.RefID] = o.id_pesanan;
          r[H.DiperbaruiPada] = ts;
          updated++;
        } else {
          const kid = 'KTK-' + acak_(6, '0123456789ABCDEF');
          newRows.push(rowFromObject_(t.headers, {
            KontakID: kid,
            Nama: o.nama_pelanggan || 'Pelanggan',
            Email: '',
            NoWA: p,
            Segmen: autoSegmen,
            Sumber: 'Pesanan',
            RefID: o.id_pesanan,
            Tag: agg.paidCount >= 2 ? 'Repeat Order' : 'Katalog Web',
            StatusWA: 'Belum Dicek',
            CekWAAt: '',
            EmailValid: 'BELUM',
            OptOut: 'TIDAK',
            Catatan: '',
            JumlahPesan: 0,
            TerakhirDihubungi: '',
            Info: infoRingkas,
            DibuatPada: ts,
            DiperbaruiPada: ts
          }));
          added++;
        }
      });

      newsletters.forEach(function (nl) {
        const em = String(nl.email || '').toLowerCase();
        if (!em || byEmail[em] !== undefined) return;
        byEmail[em] = -1;
        newRows.push(rowFromObject_(t.headers, {
          KontakID: 'KTK-' + acak_(6, '0123456789ABCDEF'),
          Nama: em.split('@')[0],
          Email: em,
          NoWA: '',
          Segmen: 'Subscriber',
          Sumber: 'Newsletter',
          RefID: '',
          Tag: 'Newsletter',
          StatusWA: 'Belum Dicek',
          CekWAAt: '',
          EmailValid: 'YA',
          OptOut: 'TIDAK',
          Catatan: '',
          JumlahPesan: 0,
          TerakhirDihubungi: '',
          Info: 'Subscriber Footer',
          DibuatPada: ts,
          DiperbaruiPada: ts
        }));
        added++;
      });

      if (updated > 0 && t.rows.length) {
        t.sheet.getRange(2, 1, t.rows.length, t.headers.length).setValues(t.rows);
      }
      if (newRows.length) {
        t.sheet.getRange(t.sheet.getLastRow() + 1, 1, newRows.length, t.headers.length).setValues(newRows);
      }
      bumpVer_('CRM');
      return { added: added, updated: updated };
    });

    return ok_({ stats: stats, snapshot: getNotifCrmSnapshot_() },
      'Sinkronisasi CRM selesai: ' + stats.added + ' kontak baru ditambahkan, ' + stats.updated + ' kontak diperbarui.');
  });
}

function adminCrmSaveContact(token, c) {
  return guard_(token, function () {
    c = c || {};
    const nama = str_(c.Nama, 80);
    const wa = c.NoWA ? normalizePhone_(c.NoWA) : '';
    const email = str_(c.Email, 120).toLowerCase();
    if (nama.length < 2) return fail_('Nama kontak minimal 2 karakter.');
    if (wa && !validPhone_(wa)) return fail_('Nomor WhatsApp tidak valid.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail_('Format email tidak valid.');
    if (!wa && !email) return fail_('Isi minimal Nomor WhatsApp atau Email.');

    const ts = fmtDate_(now_(), 'yyyy-MM-dd HH:mm:ss');
    let id = str_(c.KontakID, 30);

    withLock_(function () {
      const sh = sheet_(SH.CRM_KONTAK);
      const headers = headersOf_(sh);
      const r = id ? findRow_(sh, id) : -1;
      if (r > 0) {
        const base = sh.getRange(r, 1, 1, headers.length).getValues()[0];
        const patch = {
          Nama: nama,
          Email: email,
          NoWA: wa,
          Segmen: str_(c.Segmen || 'Prospek', 50),
          Tag: str_(c.Tag, 160),
          OptOut: String(c.OptOut).toUpperCase() === 'YA' ? 'YA' : 'TIDAK',
          Catatan: str_(c.Catatan, 600),
          EmailValid: email ? 'YA' : 'BELUM',
          DiperbaruiPada: ts
        };
        sh.getRange(r, 1, 1, headers.length).setValues([rowFromObject_(headers, patch, base)]);
      } else {
        id = 'KTK-' + acak_(6, '0123456789ABCDEF');
        appendObject_(sh, {
          KontakID: id,
          Nama: nama,
          Email: email,
          NoWA: wa,
          Segmen: str_(c.Segmen || 'Prospek', 50),
          Sumber: 'Input Manual',
          RefID: '',
          Tag: str_(c.Tag, 160),
          StatusWA: 'Belum Dicek',
          CekWAAt: '',
          EmailValid: email ? 'YA' : 'BELUM',
          OptOut: String(c.OptOut).toUpperCase() === 'YA' ? 'YA' : 'TIDAK',
          Catatan: str_(c.Catatan, 600),
          JumlahPesan: 0,
          TerakhirDihubungi: '',
          Info: 'Ditambahkan manual oleh Admin',
          DibuatPada: ts,
          DiperbaruiPada: ts
        });
      }
      bumpVer_('CRM');
    });

    return ok_({ kontakId: id, snapshot: getNotifCrmSnapshot_() }, 'Kontak "' + nama + '" berhasil disimpan.');
  });
}

function adminCrmDeleteContact(token, kontakId) {
  return guard_(token, function () {
    return withLock_(function () {
      const sh = sheet_(SH.CRM_KONTAK);
      const r = findRow_(sh, kontakId);
      if (r < 0) return fail_('Kontak tidak ditemukan.');
      sh.deleteRow(r);
      bumpVer_('CRM');
      return ok_({ kontakId: kontakId, snapshot: getNotifCrmSnapshot_() }, 'Kontak dihapus dari CRM.');
    });
  });
}

function adminCrmToggleOptOut(token, kontakId, optOut) {
  return guard_(token, function () {
    const val = optOut ? 'YA' : 'TIDAK';
    const ts = fmtDate_(now_(), 'yyyy-MM-dd HH:mm:ss');
    const n = withLock_(function () {
      const c = updateWhere_(SH.CRM_KONTAK,
        function (o) { return String(o.KontakID) === String(kontakId); },
        function (o) { o.OptOut = val; o.DiperbaruiPada = ts; return o; }
      );
      bumpVer_('CRM');
      return c;
    });
    if (!n) return fail_('Kontak tidak ditemukan.');
    return ok_({ kontakId: kontakId, optOut: val, snapshot: getNotifCrmSnapshot_() },
      val === 'YA' ? 'Kontak ditandai Opt-Out (dikecualikan dari Blast WA).' : 'Kontak diaktifkan kembali untuk menerima informasi.');
  });
}

function adminCrmMergeDuplicates(token) {
  return guard_(token, function () {
    const mergedCount = withLock_(function () {
      const t = readTable_(SH.CRM_KONTAK);
      if (t.rows.length < 2) return 0;
      const H = {};
      t.headers.forEach(function (h, i) { H[h] = i; });
      const seenPhone = {}, seenEmail = {};
      const kept = [];
      let merged = 0;

      t.rows.forEach(function (r) {
        const p = normalizePhone_(r[H.NoWA]);
        const em = String(r[H.Email] || '').toLowerCase();
        let target = null;
        if (p && seenPhone[p]) target = seenPhone[p];
        else if (em && seenEmail[em]) target = seenEmail[em];

        if (!target) {
          if (p) r[H.NoWA] = p;
          kept.push(r);
          if (p) seenPhone[p] = r;
          if (em) seenEmail[em] = r;
        } else {
          // Gabungkan atribut yang kosong & pertahankan OptOut='YA' bila salah satu YA
          if (!target[H.Email] && em) { target[H.Email] = em; seenEmail[em] = target; }
          if (!target[H.NoWA] && p) { target[H.NoWA] = p; seenPhone[p] = target; }
          if (String(r[H.OptOut]).toUpperCase() === 'YA') target[H.OptOut] = 'YA';
          if (r[H.Tag] && String(target[H.Tag]).indexOf(String(r[H.Tag])) < 0) {
            target[H.Tag] = [target[H.Tag], r[H.Tag]].filter(Boolean).join(', ');
          }
          if (r[H.Catatan] && String(target[H.Catatan]).indexOf(String(r[H.Catatan])) < 0) {
            target[H.Catatan] = [target[H.Catatan], r[H.Catatan]].filter(Boolean).join(' | ');
          }
          target[H.JumlahPesan] = num_(target[H.JumlahPesan]) + num_(r[H.JumlahPesan]);
          merged++;
        }
      });

      if (merged > 0) {
        if (t.sheet.getLastRow() > 1) {
          t.sheet.getRange(2, 1, t.sheet.getLastRow() - 1, t.headers.length).clearContent();
        }
        if (kept.length) {
          t.sheet.getRange(2, 1, kept.length, t.headers.length).setValues(kept);
        }
        bumpVer_('CRM');
      }
      return merged;
    });

    return ok_({ merged: mergedCount, snapshot: getNotifCrmSnapshot_() },
      mergedCount > 0 ? mergedCount + ' kontak duplikat berhasil digabungkan dengan rapi.' : 'Tidak ditemukan kontak duplikat.');
  });
}

function adminCrmAddInteraction(token, it) {
  return guard_(token, function () {
    it = it || {};
    const kid = str_(it.KontakID, 30);
    const ringkasan = str_(it.Ringkasan, 400);
    if (!kid || ringkasan.length < 3) return fail_('Pilih kontak dan isi ringkasan interaksi.');
    const ts = fmtDate_(now_(), 'yyyy-MM-dd HH:mm:ss');
    const rec = {
      InteraksiID: 'INT-' + acak_(6, '0123456789ABCDEF'),
      KontakID: kid,
      Kanal: str_(it.Kanal || 'CATATAN', 20).toUpperCase(),
      Arah: str_(it.Arah || 'KELUAR', 20).toUpperCase(),
      Ringkasan: ringkasan,
      RefID: str_(it.RefID, 40),
      Oleh: 'Admin',
      Tanggal: ts
    };
    withLock_(function () {
      appendObject_(sheet_(SH.CRM_INTERAKSI), rec);
      updateWhere_(SH.CRM_KONTAK,
        function (o) { return String(o.KontakID) === kid; },
        function (o) { o.TerakhirDihubungi = ts; o.DiperbaruiPada = ts; return o; }
      );
      bumpVer_('CRM');
    });
    return ok_({ interaction: rec, snapshot: getNotifCrmSnapshot_() }, 'Catatan interaksi pelanggan tersimpan.');
  });
}

function adminCrmGetInteractions(token, kontakId) {
  return guard_(token, function () {
    const all = toObjects_(readTable_(SH.CRM_INTERAKSI))
      .filter(function (i) { return String(i.KontakID) === String(kontakId); })
      .reverse();
    return ok_(all);
  });
}
