# 🚀 Panduan Lengkap Instalasi, Deploy GitHub Pages & Migrasi Database — NusaStore v3.0 ProAPI

Selamat datang di **NusaStore v3.0 ProAPI**! Aplikasi ini dibangun dengan arsitektur modern **Decoupled Frontend + Serverless JSON REST API**:
- **Frontend Statis (`/frontend`)**: Di-hosting gratis, cepat, dan ber-SSL penuh di **GitHub Pages** (atau Vercel / Netlify / Blogger).
- **Backend REST API (`/backend`)**: Berjalan di **Google Apps Script (GAS)** menggunakan Google Sheets sebagai database, Google Drive sebagai penyimpanan berkas/faktur PDF, serta Fonnte API + MailApp untuk notifikasi otomatis.

---

## 📁 Struktur Folder Proyek

```text
NusaStore_v3_ProAPI/              <-- Akar Repositori GitHub Pages (/ root)
├── index.html                    <-- Halaman utama Storefront + Admin Portal SPA
├── css/
│   └── style.css                 <-- Desain responsif, animasi berkilau, flip 3D & Dark Mode
├── js/
│   ├── config.js                 <-- HANYA berisi GAS_URL (Zero Literal Secrets!)
│   └── app.js                    <-- Logika SPA, REST Client, CRM, Migrasi & Karakter Hidup
├── .nojekyll                     <-- Bypass Jekyll agar GitHub Pages tayang instan
├── .gitignore                    <-- Mengabaikan folder backend/ dari GitHub publik
├── backend/                      <-- KHUSUS BACKEND GOOGLE APPS SCRIPT (Lokal saja)
│   ├── appsscript.json           <-- Konfigurasi V8, Timezone Asia/Jakarta & OAuth Scopes
│   ├── Kode.gs                   <-- Router REST API (doGet/doPost), Keamanan HMAC & CacheX
│   ├── NotifikasiCRM.gs          <-- Antrean Non-Blocking WA/Email, Blast WA & CRM Kontak
│   └── Migrasi.gs                <-- Utilitas Pindai (Dry-Run) & Sinkronisasi Database Lama
└── PANDUAN_DEPLOY_LENGKAP.md     <-- Dokumen panduan ini
```

> **Penting:** Folder `frontend/` sengaja bersih dari file `.gs` maupun rahasia apa pun agar aman 100% diunggah ke repositori publik GitHub Pages.

---

## 🛠️ TAHAP 1: Setup Backend di Google Apps Script

1. Buka [https://script.google.com](https://script.google.com) lalu klik **New Project (Proyek Baru)**.
2. Beri nama proyek: **`NusaStore_v3_Backend`**.
3. Aktifkan tampilan file manifes:
   - Klik ikon **Project Settings (⚙️ Pengaturan Proyek)** di bilah kiri.
   - Centang kotak **"Show 'appsscript.json' manifest file in editor"**.
4. Kembali ke menu **Editor (`< >`)**, lalu salin isi ke-4 file dari folder `backend/`:
   - Klik `appsscript.json` → ganti seluruh isinya dengan isi `backend/appsscript.json`.
   - Klik `Code.gs` (atau ubah namanya menjadi `Kode.gs`) → ganti seluruh isinya dengan isi `backend/Kode.gs`.
   - Klik tombol **`+` → Script**, beri nama `NotifikasiCRM` → tempel seluruh isi `backend/NotifikasiCRM.gs`.
   - Klik tombol **`+` → Script**, beri nama `Migrasi` → tempel seluruh isi `backend/Migrasi.gs`.
   - Tekan **Ctrl + S** untuk menyimpan semua file.
5. **Jalankan Auto-Setup Database & Kredensial Awal (1x Saja)**:
   - Buka file `Kode.gs`, pada dropdown daftar fungsi di toolbar atas pilih **`setupAppEnvironment`**, lalu klik **Run (Jalankan)**.
   - Klik **Review Permissions** → pilih akun Google Anda → klik **Advanced** → **Go to NusaStore_v3_Backend (unsafe)** → **Allow**.
   - **PENTING — CATAT PIN & SANDI DARURAT:** Lihat panel **Execution Log (Log Eksekusi)** di bagian bawah layar. Anda akan melihat:
     - Link **Spreadsheet Database** (`Database_NusaStore` berisi 13 sheet otomatis)
     - **PIN ADMIN AWAL (6 digit acak)** — *hanya ditampilkan satu kali karena langsung di-hash di Script Properties!*
     - **Username & Sandi Akses Darurat** — simpan di tempat aman sebagai cadangan pemulihan.
6. **Deploy sebagai Web App REST API**:
   - Klik tombol biru **Deploy** (kanan atas) → **New deployment**.
   - Klik ikon roda gigi di samping *Select type* → pilih **Web app**.
   - Isi konfigurasi berikut secara persis:
     - **Description**: `NusaStore ProAPI v3.0`
     - **Execute as**: **Me** *(email Anda)*
     - **Who has access**: **Anyone** *(Siapa saja — wajib agar frontend GitHub Pages dapat mengakses API publik tanpa blokir CORS)*
   - Klik **Deploy**, lalu salin **Web app URL** yang berakhiran `/exec`.

---

## 🔗 TAHAP 2: Hubungkan URL Backend ke Frontend

1. Buka file `frontend/js/config.js` menggunakan VS Code / Notepad.
2. Tempel URL `/exec` tadi ke dalam `GAS_URL`:

```javascript
window.NUSASTORE_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbx_TEMPEL_ID_DEPLOYMENT_ANDA_DI_SINI/exec'
};
```

3. Simpan file `frontend/js/config.js`.

---

## 🌐 TAHAP 3: Deploy Frontend ke GitHub Pages (Ramah Pemula)

### A. Buat Repositori Baru di GitHub
1. Masuk ke [https://github.com/new](https://github.com/new).
2. Isi **Repository name**: misalnya `nusastore`.
3. Pilih **Public** (agar GitHub Pages gratis).
4. **Jangan** centang *Add a README file* dulu supaya tidak bentrok saat push pertama.
5. Klik **Create repository**.

### B. Buat Personal Access Token (PAT) sebagai Pengganti Password Git
Sejak 2021, GitHub tidak lagi menerima password akun biasa di terminal. Buat token sekali:
1. Buka **GitHub → Settings** (klik foto profil kanan atas) → scroll paling bawah di kiri → **Developer settings**.
2. Klik **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**.
3. Isi *Note*: `Deploy NusaStore`, pilih *Expiration*: `90 days`, lalu centang kotak **`repo`**.
4. Klik **Generate token** di paling bawah, lalu **salin kode `ghp_...`** yang muncul.

### C. Push Folder `frontend` lewat Terminal
Buka terminal PowerShell dan arahkan **langsung ke dalam folder `frontend`** (supaya `index.html` berada tepat di akar repositori!):

```powershell
cd "c:\Users\Daffa Fazdian\OneDrive\Dokumen\Aplikasi & Skill\12. ANTIGRAVITY\Aplikasi\3. Toko Website\NusaStore_v3_ProAPI\frontend"

git init
git add .
git commit -m "Rilis perdana NusaStore v3.0 ProAPI"
git branch -M main
git remote add origin https://github.com/USERNAME_GITHUB_ANDA/nusastore.git
git push -u origin main
```

> Saat muncul jendela login / permintaan kredensial di terminal:
> - **Username**: ketik username GitHub Anda.
> - **Password**: tempel kode **Personal Access Token (`ghp_...`)** tadi (bukan password login GitHub!).

### D. Aktifkan GitHub Pages
1. Buka halaman repositori Anda di GitHub → klik tab **Settings** → menu kiri **Pages**.
2. Pada bagian **Build and deployment → Source**, pilih **Deploy from a branch**.
3. Pilih branch **`main`** dan folder **`/ (root)`**, lalu klik **Save**.
4. Tunggu sekitar 1–2 menit, segarkan halaman, dan centang **Enforce HTTPS**.
5. Website Anda resmi tayang di: `https://USERNAME_GITHUB_ANDA.github.io/nusastore/` 🎉

### E. Cara Update Tampilan di Kemudian Hari
Setiap kali Anda mengedit file di dalam `frontend/`, cukup jalankan 3 perintah ini:
```powershell
git add .
git commit -m "Update tampilan katalog"
git push
```

---

## 🔄 TAHAP 4: Cara Migrasi Data dari Spreadsheet Lama (v2.4 → v3.0)

Jika Anda sudah memiliki data produk, pesanan, atau lisensi di spreadsheet lama (`NusaStore_GAS_v2.4`), Anda **tidak perlu copy-paste manual** dan **file lama tidak akan disentuh/diubah sedikit pun**:

1. Buka website baru Anda → klik **🔐 Admin Portal** di pojok kanan atas → masukkan **PIN 6 Digit** dari log setup.
2. Pilih menu kiri **🔄 Migrasi Database**.
3. Tempel **URL penuh** (atau Spreadsheet ID) dari Google Sheets versi lama Anda.
4. Klik tombol **🔍 1. Pindai Struktur & Data (Dry-Run)**:
   - Sistem membaca berdasarkan nama header kolom dan menampilkan tabel pratinjau berapa baris **Baru**, **Diperbarui**, dan **Sudah Sama** di tiap sheet tanpa menulis data apa pun.
5. Jika sudah sesuai, klik **🚀 2. Jalankan Sinkronisasi / Delta-Sync**.
   - Anda bebas menekan tombol ini lagi kapan saja sebelum berpindah penuh (*cutover*) untuk menyalin pesanan baru yang mungkin baru masuk di toko lama (*idempotent upsert*).

---

## 💬 TAHAP 5: Aktivasi WhatsApp Fonnte, Email & Blast CRM

1. Daftar / masuk ke dashboard [https://fonnte.com](https://fonnte.com), hubungkan perangkat WhatsApp toko Anda, lalu salin **Token Device**.
2. Di **Admin Portal NusaStore** → buka menu **💬 WA, Email & Blast**:
   - Tempel token pada kolom **Gateway Fonnte** → klik **Simpan** (token diamankan di `Script Properties` server dan selalu disamarkan menjadi `ABCD••••••xyz`).
   - Klik **📡 Cek Status Perangkat** dan **📤 Kirim Pesan Uji**.
   - Atur **Saklar Global (WA / Email)** dan **Matriks Kejadian** sesuai kebutuhan.
3. Buka menu **👥 CRM & Pelanggan**:
   - Klik **🔄 Sinkronkan dari Pesanan & Newsletter** untuk mengelompokkan pelanggan otomatis.
   - Klik **✅ Validasi Nomor WA (Fonnte)** untuk mengecek nomor mana yang terdaftar aktif di WhatsApp sebelum mengirim kampanye Blast WA.

---

## ❓ Pemecahan Masalah Umum (Troubleshooting)

| Gejala | Penyebab Umum | Solusi Cepat |
| :--- | :--- | :--- |
| Muncul tulisan **404 File not found** di GitHub Pages | Folder yang di-push adalah folder induk, bukan isi folder `frontend/` | Pastikan `index.html` berada tepat di root repositori GitHub, bukan di dalam subfolder lagi |
| Gagal `git push` (**403 Permission denied / Invalid password**) | Memakai password biasa, bukan PAT | Buat Personal Access Token (classic) dengan centang `repo`, gunakan kode `ghp_...` sebagai password |
| Katalog gagal memuat dari GAS (**Failed to fetch / CORS**) | Saat deploy GAS, *Who has access* disetel *Only myself* atau kode backend diubah tapi belum *New deployment / Manage deployments* | Di editor GAS → **Deploy → Manage deployments → Edit (ikon pensil) → Version: New version → Who has access: Anyone → Deploy** |
| Lupa PIN 6 Digit Admin | PIN lupa dicatat | Masuk dengan tab **Akses Darurat**, atau buka editor GAS → jalankan fungsi `resetPinAdmin()` lalu lihat PIN baru di Execution Log |
