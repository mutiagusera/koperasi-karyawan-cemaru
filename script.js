
/* ============================================================
   KOPERASI PT. CEMARU LESTARI — APLIKASI KASIR SEDERHANA
   Data disimpan di localStorage browser (tanpa server)
   ============================================================ */

const DB_KEY = 'koperasiCemaruLestariData_v1';
const DB_KEY_LAMA = 'warungBerkahData_v1';

let db = {
  barang: [],      // {id, nama, kategori, hargaBeli, hargaJual, stok, satuan, stokMin}
  transaksi: [],    // {id, waktu, pelanggan, jenis:'cash'|'hutang', items:[{barangId,nama,qty,hargaJual,hargaBeli}], total, modal, diterima}
  pembayaranHutang: [], // {id, waktu, pelanggan, jumlah}
  stokLog: [],      // {id, waktu, barangId, nama, jenis:'masuk'|'keluar', jumlah, keterangan}
  sampah: []        // {id, tipe, waktuHapus, data} - tempat sampah untuk undo hapus (maks 30 terbaru)
};

function pastikanStrukturDB(){
  // Jaga-jaga untuk data lama (backup sebelum fitur ini ada) yang belum punya field 'sampah'
  if(!Array.isArray(db.barang)) db.barang = [];
  if(!Array.isArray(db.transaksi)) db.transaksi = [];
  if(!Array.isArray(db.pembayaranHutang)) db.pembayaranHutang = [];
  if(!Array.isArray(db.stokLog)) db.stokLog = [];
  if(!Array.isArray(db.sampah)) db.sampah = [];
  // Jaga-jaga untuk data lama yang belum punya field 'satuanTurunan' (fitur satuan turunan)
  db.barang.forEach(b=>{ if(!Array.isArray(b.satuanTurunan)) b.satuanTurunan = []; });
}

function loadDB(){
  let raw = localStorage.getItem(DB_KEY);
  if(!raw){
    // Migrasi dari key lama (versi sebelum rebranding ke "Koperasi")
    const rawLama = localStorage.getItem(DB_KEY_LAMA);
    if(rawLama){
      raw = rawLama;
      localStorage.setItem(DB_KEY, rawLama);
      localStorage.removeItem(DB_KEY_LAMA);
    }
  }
  if(raw){
    try{ db = JSON.parse(raw); }catch(e){ console.error('Gagal load data', e); }
  }
  pastikanStrukturDB();
}
function saveDB(){
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}
function escHtml(v){
  return String(v==null?'':v).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// Dipakai khusus untuk menyisipkan JSON mentah ke dalam atribut onclick='...' (single-quoted).
// Meng-escape SEMUA karakter yang berarti khusus di HTML (&, <, >, ') supaya nama barang/pelanggan
// yang mengandung karakter tsb (mis. "Kopi & Gula") tidak merusak parsing HTML / tombol Struk.
function escHtmlAttr(v){
  return String(v==null?'':v).replace(/[&<>']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;'}[c]));
}
function uid(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}
function rupiah(n){
  n = Math.round(n||0);
  return 'Rp ' + n.toLocaleString('id-ID');
}
function fmtWaktu(iso){
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}) + ' ' + d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
}
function todayStr(){
  return tanggalLokal(new Date());
}
// Ambil tanggal (YYYY-MM-DD) dalam ZONA WAKTU LOKAL perangkat, bukan UTC.
// Penting: t.waktu disimpan sebagai ISO string (UTC). Memakai .slice(0,10) langsung
// pada ISO string akan mengambil tanggal UTC, yang di Indonesia (UTC+7/+8/+9) bisa
// terpaut hingga beberapa jam dari tanggal lokal — transaksi dini hari (00:00-06:59 WIB
// misalnya) bisa salah tercatat sebagai tanggal "kemarin" pada dashboard & laporan.
function tanggalLokal(waktu){
  const d = (waktu instanceof Date) ? waktu : new Date(waktu);
  const tahun = d.getFullYear();
  const bulan = String(d.getMonth()+1).padStart(2,'0');
  const tgl = String(d.getDate()).padStart(2,'0');
  return tahun+'-'+bulan+'-'+tgl;
}
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>t.classList.remove('show'), 2600);
}

/* ============ NAMA PELANGGAN (normalisasi) ============
   Supaya "Bu Siti" dan "bu siti " dianggap pelanggan yang sama. */
function rapikanSpasi(s){
  return String(s||'').trim().replace(/\s+/g,' ');
}
function daftarNamaPelangganCanonical(){
  const map = new Map();
  db.transaksi.filter(t=>t.jenis==='hutang').forEach(t=>{
    const key = rapikanSpasi(t.pelanggan).toLowerCase();
    if(key && !map.has(key)) map.set(key, rapikanSpasi(t.pelanggan));
  });
  db.pembayaranHutang.forEach(p=>{
    const key = rapikanSpasi(p.pelanggan).toLowerCase();
    if(key && !map.has(key)) map.set(key, rapikanSpasi(p.pelanggan));
  });
  return map;
}
function resolveNamaPelanggan(input){
  const rapi = rapikanSpasi(input);
  const key = rapi.toLowerCase();
  const map = daftarNamaPelangganCanonical();
  return map.has(key) ? map.get(key) : rapi;
}
function migrasiNormalisasiPelanggan(){
  const canonical = new Map();
  function canon(nama){
    const rapi = rapikanSpasi(nama);
    const key = rapi.toLowerCase();
    if(!key) return rapi;
    if(!canonical.has(key)) canonical.set(key, rapi);
    return canonical.get(key);
  }
  let berubah = false;
  db.transaksi.forEach(t=>{
    if(t.jenis==='hutang'){
      const baru = canon(t.pelanggan);
      if(baru!==t.pelanggan){ t.pelanggan = baru; berubah = true; }
    }
  });
  db.pembayaranHutang.forEach(p=>{
    const baru = canon(p.pelanggan);
    if(baru!==p.pelanggan){ p.pelanggan = baru; berubah = true; }
  });
  if(berubah) saveDB();
}

/* ============ PROTEKSI PIN (untuk aksi berbahaya/permanen) ============ */
const PIN_KEY = 'koperasiCemaruLestariPIN_v1';
const PIN_KEY_LAMA = 'warungBerkahPIN_v1';
function migrasiPINLama(){
  if(localStorage.getItem(PIN_KEY)===null && localStorage.getItem(PIN_KEY_LAMA)!==null){
    localStorage.setItem(PIN_KEY, localStorage.getItem(PIN_KEY_LAMA));
    localStorage.removeItem(PIN_KEY_LAMA);
  }
}
function cekPINAksi(namaAksi){
  const pinTersimpan = localStorage.getItem(PIN_KEY);
  if(!pinTersimpan){
    const baru = prompt('Belum ada PIN keamanan. Buat PIN 4-6 digit untuk melindungi aksi "'+namaAksi+'" dan aksi berbahaya lainnya:');
    if(baru===null) return false;
    if(!/^\d{4,6}$/.test(baru)){ showToast('PIN harus 4-6 digit angka. Aksi dibatalkan.'); return false; }
    const ulang = prompt('Ketik ulang PIN untuk konfirmasi:');
    if(ulang!==baru){ showToast('PIN tidak cocok. Aksi dibatalkan.'); return false; }
    localStorage.setItem(PIN_KEY, baru);
    showToast('PIN berhasil dibuat. Simpan baik-baik.');
    return true;
  }
  const input = prompt('Masukkan PIN untuk konfirmasi aksi "'+namaAksi+'":');
  if(input===null) return false;
  if(input!==pinTersimpan){ showToast('PIN salah. Aksi dibatalkan.'); return false; }
  return true;
}

/* ============ AKUN ADMIN & LOGIN ============
   Login diperlukan setiap kali membuka aplikasi di tab/browser baru
   (status login disimpan di sessionStorage, hilang saat tab ditutup). */
const ADMIN_KEY = 'koperasiCemaruLestariAdmin_v1';
const SESI_LOGIN_KEY = 'koperasiCemaruLestariSesi_v1';
const ADMIN_USERNAME_DEFAULT = 'admin';
const ADMIN_PASSWORD_DEFAULT = 'admin123';

async function hashTeks(teks){
  const data = new TextEncoder().encode(String(teks));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function getAdmin(){
  const raw = localStorage.getItem(ADMIN_KEY);
  if(!raw) return null;
  try{ return JSON.parse(raw); }catch(e){ return null; }
}
function saveAdmin(admin){
  localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
}
async function pastikanAdminAwal(){
  if(!getAdmin()){
    const passwordHash = await hashTeks(ADMIN_PASSWORD_DEFAULT);
    saveAdmin({ nama:'Administrator', username:ADMIN_USERNAME_DEFAULT, passwordHash });
  }
}

function isLoggedIn(){
  return sessionStorage.getItem(SESI_LOGIN_KEY) === '1';
}
function setLoggedIn(status){
  if(status) sessionStorage.setItem(SESI_LOGIN_KEY, '1');
  else sessionStorage.removeItem(SESI_LOGIN_KEY);
}

function tampilkanApp(){
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appRoot').style.display = 'flex';
}
function tampilkanLoginScreen(){
  document.getElementById('appRoot').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
}

async function prosesLogin(e){
  e.preventDefault();
  const usernameInput = document.getElementById('loginUsername').value.trim();
  const passwordInput = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  const admin = getAdmin();
  if(!admin){
    errEl.textContent = 'Data akun admin tidak ditemukan. Muat ulang halaman.';
    errEl.style.display = 'block';
    return false;
  }
  const hashInput = await hashTeks(passwordInput);
  if(usernameInput === admin.username && hashInput === admin.passwordHash){
    errEl.style.display = 'none';
    setLoggedIn(true);
    document.getElementById('formLogin').reset();
    tampilkanApp();
    renderAdminBar();
    tickClock();
    renderDashboard();
    renderDaftarKategori();
    renderDaftarPelangganDatalist();
  } else {
    errEl.textContent = 'Username atau password salah.';
    errEl.style.display = 'block';
  }
  return false;
}

function logoutAdmin(){
  if(!confirm('Yakin ingin keluar dari akun admin?')) return;
  setLoggedIn(false);
  tampilkanLoginScreen();
}

function renderAdminBar(){
  const admin = getAdmin();
  const el = document.getElementById('adminNameDisplay');
  if(el && admin) el.textContent = admin.nama;
}

function renderFormProfilAdmin(){
  const admin = getAdmin();
  if(!admin) return;
  document.getElementById('adm_nama').value = admin.nama;
  document.getElementById('adm_username').value = admin.username;
}

function simpanProfilAdmin(e){
  e.preventDefault();
  const nama = document.getElementById('adm_nama').value.trim();
  const username = document.getElementById('adm_username').value.trim();
  if(!nama){ showToast('Nama admin wajib diisi'); return false; }
  if(!username){ showToast('Username wajib diisi'); return false; }
  const admin = getAdmin();
  admin.nama = nama;
  admin.username = username;
  saveAdmin(admin);
  renderAdminBar();
  showToast('Profil admin berhasil diperbarui');
  return false;
}

async function gantiPasswordAdmin(e){
  e.preventDefault();
  const lama = document.getElementById('adm_pass_lama').value;
  const baru = document.getElementById('adm_pass_baru').value;
  const ulang = document.getElementById('adm_pass_ulang').value;
  const admin = getAdmin();
  const hashLama = await hashTeks(lama);
  if(hashLama !== admin.passwordHash){ showToast('Password lama salah'); return false; }
  if(baru.length < 4){ showToast('Password baru minimal 4 karakter'); return false; }
  if(baru !== ulang){ showToast('Konfirmasi password baru tidak cocok'); return false; }
  admin.passwordHash = await hashTeks(baru);
  saveAdmin(admin);
  document.getElementById('formGantiPassword').reset();
  showToast('Password berhasil diganti. Gunakan password baru saat login berikutnya.');
  return false;
}

/* ============ SAMPAH / UNDO HAPUS ============ */
const MAKS_SAMPAH = 30;
function buangKeSampah(tipe, data, ringkasan){
  db.sampah.unshift({id:uid(), tipe, ringkasan, waktuHapus:new Date().toISOString(), data});
  if(db.sampah.length > MAKS_SAMPAH) db.sampah.length = MAKS_SAMPAH;
}
function renderSampah(){
  const tbody = document.getElementById('tblSampah');
  if(!tbody) return;
  if(db.sampah.length===0){
    tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><span class="icon">🗑️</span>Sampah kosong</div></td></tr>';
    return;
  }
  const labelTipe = {barang:'Barang', transaksi:'Transaksi', pembayaran:'Pembayaran Hutang', stokLog:'Riwayat Stok'};
  tbody.innerHTML = db.sampah.map(s=>`<tr>
    <td>${fmtWaktu(s.waktuHapus)}</td>
    <td>${labelTipe[s.tipe]||s.tipe}</td>
    <td>${escHtml(s.ringkasan)}</td>
    <td>
      <button class="btn btn-outline btn-sm" onclick="pulihkanSampah('${s.id}')">↺ Pulihkan</button>
      <button class="btn btn-danger btn-sm" onclick="hapusPermanenSampah('${s.id}')">Hapus Permanen</button>
    </td>
  </tr>`).join('');
}
function hapusPermanenSampah(id){
  if(!confirm('Hapus item ini secara permanen dari sampah? Tidak bisa dipulihkan lagi.')) return;
  db.sampah = db.sampah.filter(x=>x.id!==id);
  saveDB();
  renderSampah();
  showToast('Item dihapus permanen dari sampah');
}
function pulihkanSampah(id){
  const s = db.sampah.find(x=>x.id===id);
  if(!s){ showToast('Item sampah tidak ditemukan'); return; }
  if(s.tipe==='barang'){
    db.barang.push(s.data);
  } else if(s.tipe==='transaksi'){
    const t = s.data;
    t.items.forEach(it=>{
      const b = db.barang.find(x=>x.id===it.barangId);
      if(b){
        b.stok -= it.qty;
        if(b.stok < 0) b.stok = 0; // jaga-jaga: cegah stok minus jika stok sudah berubah sejak transaksi ini dihapus
      }
    });
    db.transaksi.push(t);
  } else if(s.tipe==='pembayaran'){
    db.pembayaranHutang.push(s.data);
  } else if(s.tipe==='stokLog'){
    const log = s.data;
    const b = db.barang.find(x=>x.id===log.barangId);
    if(b){
      if(log.jenis==='masuk') b.stok += log.jumlah;
      else { b.stok -= log.jumlah; if(b.stok < 0) b.stok = 0; }
    }
    db.stokLog.push(log);
  }
  db.sampah = db.sampah.filter(x=>x.id!==id);
  saveDB();
  renderSampah();
  renderDaftarBarang(); renderDaftarHutang(); renderRiwayatTransaksi();
  renderRiwayatBayar(); renderRiwayatStok(); renderDashboard();
  renderDaftarKategori();
  showToast('Item berhasil dipulihkan');
}

/* ============ NAVIGATION ============ */
const titles = {
  dashboard:['Dashboard','Ringkasan koperasi hari ini'],
  'barang-tambah':['Tambah Barang','Daftarkan barang baru ke gudang koperasi'],
  'barang-daftar':['Daftar & Edit Barang','Kelola seluruh barang yang dijual'],
  'jual-cash':['Penjualan Cash','Catat transaksi yang dibayar langsung'],
  'jual-hutang':['Penjualan Hutang','Catat transaksi yang dibayar nanti'],
  'riwayat-transaksi':['Riwayat Transaksi','Semua transaksi cash dan hutang'],
  'daftar-hutang':['Daftar Hutang','Rekap hutang per pelanggan'],
  'bayar-hutang':['Pembayaran Hutang','Catat pelanggan yang membayar hutang'],
  'riwayat-bayar':['Riwayat Pembayaran','Riwayat pelunasan hutang'],
  'stok-masuk':['Stok Masuk','Tambahkan stok barang yang baru datang'],
  'stok-keluar':['Stok Keluar','Catat barang yang keluar bukan dari penjualan'],
  'riwayat-stok':['Riwayat Stok','Seluruh pergerakan stok barang'],
  'lap-penjualan':['Laporan Penjualan','Rekap penjualan koperasi'],
  'lap-hutang':['Laporan Hutang','Rekap hutang seluruh pelanggan'],
  'lap-stok':['Laporan Stok','Kondisi stok seluruh barang'],
  'lap-untung':['Laporan Keuntungan','Estimasi keuntungan koperasi'],
  'backup':['Backup & Restore','Cadangkan dan pulihkan data koperasi'],
  'sampah':['Sampah (Undo Hapus)','Pulihkan data yang baru saja dihapus'],
  'akun-admin':['Akun Admin','Kelola profil dan keamanan akun admin'],
};

function showSection(target, el){
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.getElementById('sec-'+target).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  if(el) el.classList.add('active');
  document.getElementById('pageTitle').textContent = titles[target][0];
  document.getElementById('pageSubtitle').textContent = titles[target][1];
  toggleSidebar(false);
  renderAllForSection(target);
  window.scrollTo(0,0);
}

function renderAllForSection(target){
  switch(target){
    case 'dashboard': renderDashboard(); break;
    case 'barang-daftar': renderDaftarBarang(); break;
    case 'jual-cash': renderQuickPickCash(); renderCart('cash'); break;
    case 'jual-hutang': renderQuickPickHutang(); renderCart('hutang'); renderDaftarPelangganDatalist(); break;
    case 'riwayat-transaksi': renderRiwayatTransaksi(); break;
    case 'daftar-hutang': renderDaftarHutang(); break;
    case 'bayar-hutang': renderSelectPelangganHutang(); break;
    case 'riwayat-bayar': renderRiwayatBayar(); break;
    case 'stok-masuk': renderSelectBarangStok('masukBarang'); break;
    case 'stok-keluar': renderSelectBarangStok('keluarBarang'); break;
    case 'riwayat-stok': renderRiwayatStok(); break;
    case 'lap-penjualan': renderLaporanPenjualan(); break;
    case 'lap-hutang': renderLaporanHutang(); break;
    case 'lap-stok': renderLaporanStok(); break;
    case 'lap-untung': renderLaporanUntung(); break;
    case 'backup': renderBackupInfo(); break;
    case 'sampah': renderSampah(); break;
    case 'akun-admin': renderFormProfilAdmin(); break;
  }
}

function toggleSidebar(forceOpen){
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebarOverlay');
  const root = document.getElementById('appRoot');

  if(window.innerWidth > 760){
    // Desktop: button toggles the icon-only collapsed rail.
    // Ignore programmatic "close" calls (e.g. fired after clicking a nav item),
    // those are only meant for the mobile slide-in menu.
    if(forceOpen === false) return;
    root.classList.toggle('sidebar-collapsed');
    return;
  }

  // Mobile: slide-in menu with overlay
  if(forceOpen===undefined) forceOpen = !sb.classList.contains('open');
  sb.classList.toggle('open', forceOpen);
  ov.classList.toggle('show', forceOpen);
}

window.addEventListener('resize', function(){
  const root = document.getElementById('appRoot');
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebarOverlay');
  if(!root || !sb || !ov) return;
  if(window.innerWidth <= 760){
    root.classList.remove('sidebar-collapsed');
  } else {
    sb.classList.remove('open');
    ov.classList.remove('show');
  }
});

/* ============ CLOCK ============ */
function tickClock(){
  const now = new Date();
  const dateEl = document.getElementById('clockDate');
  const timeEl = document.getElementById('clockTime');
  if(dateEl) dateEl.textContent = now.toLocaleDateString('id-ID',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  if(timeEl) timeEl.textContent = now.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'}) + ' WIB';
  const yEl = document.getElementById('footerYear');
  if(yEl) yEl.textContent = now.getFullYear();
}
setInterval(tickClock,1000);
tickClock();

/* ============ SATUAN TURUNAN (konversi satuan, contoh: 1 karung = 5 kg) ============
   barang.satuan       = satuan dasar, dipakai untuk menyimpan stok (mis. "kg")
   barang.satuanTurunan = [{id, nama, isi, harga}], "isi" = berapa satuan dasar dalam 1 satuan turunan ini
                          (mis. karung isi 5 -> 1 karung = 5 kg). "harga" boleh kosong (null) supaya
                          dihitung otomatis dari harga jual satuan dasar x isi. */
function roundQty(n){
  // Bulatkan ke 3 desimal untuk hindari sisa pembulatan angka desimal (mis. satuan ons = 0.1 kg)
  return Math.round((Number(n)||0) * 1000) / 1000;
}
function daftarSatuanUntukJual(b){
  const dasar = { key:'base', nama: b.satuan || 'pcs', isi:1, hargaJual: b.hargaJual, hargaBeli: b.hargaBeli };
  const turunan = (b.satuanTurunan||[]).map(t=>{
    const isi = Number(t.isi)||1;
    const hargaJual = (t.harga!=null && t.harga!=='') ? Number(t.harga) : Math.round(b.hargaJual*isi);
    return { key: t.id, nama: t.nama, isi, hargaJual, hargaBeli: b.hargaBeli*isi };
  });
  return [dasar, ...turunan];
}
function getSatuanJualByKey(b, key){
  return daftarSatuanUntukJual(b).find(u=>u.key===key) || daftarSatuanUntukJual(b)[0];
}
function serializeSatuanTurunan(list){
  return (list||[]).map(t=>{
    const isi = Number(t.isi)||0;
    const hargaBagian = (t.harga!=null && t.harga!=='') ? (':'+Math.round(Number(t.harga))) : '';
    return t.nama+':'+isi+hargaBagian;
  }).join(', ');
}
function parseSatuanTurunanInput(str){
  return String(str||'').split(',').map(s=>s.trim()).filter(Boolean).map(s=>{
    const bagian = s.split(':').map(x=>x.trim());
    const nama = bagian[0];
    const isi = Number(bagian[1])||0;
    const harga = (bagian[2]!==undefined && bagian[2]!=='') ? Math.max(0, Number(bagian[2])||0) : null;
    if(!nama || isi<=0) return null;
    return { id: uid(), nama, isi, harga };
  }).filter(Boolean);
}

/* ============ BARANG ============ */
function tambahBarang(e){
  e.preventDefault();
  const nama = document.getElementById('b_nama').value.trim();
  if(!nama){ showToast('Nama barang wajib diisi'); return false; }
  const hargaBeli = Math.max(0, Number(document.getElementById('b_hargabeli').value)||0);
  const hargaJual = Math.max(0, Number(document.getElementById('b_hargajual').value)||0);
  const stok = Math.max(0, roundQty(document.getElementById('b_stok').value));
  const stokMin = Math.max(0, roundQty(document.getElementById('b_stokmin').value)||5);
  if(hargaJual < hargaBeli){
    if(!confirm('Harga jual (Rp '+hargaJual.toLocaleString('id-ID')+') lebih rendah dari harga beli (Rp '+hargaBeli.toLocaleString('id-ID')+'). Barang ini akan rugi setiap terjual. Tetap simpan?')) return false;
  }
  const satuanTurunan = bacaBarisSatuanTurunan('listSatuanTurunanBaru');
  const item = {
    id: uid(),
    nama,
    kategori: rapikanSpasi(document.getElementById('b_kategori').value) || 'Umum',
    hargaBeli,
    hargaJual,
    stok,
    satuan: document.getElementById('b_satuan').value.trim() || 'pcs',
    stokMin,
    satuanTurunan,
  };
  db.barang.push(item);
  saveDB();
  document.getElementById('formTambahBarang').reset();
  document.getElementById('listSatuanTurunanBaru').innerHTML = '';
  renderDaftarKategori();
  showToast('Barang "'+nama+'" berhasil ditambahkan');
  return false;
}

/* ============ BARIS SATUAN TURUNAN DI FORM TAMBAH BARANG ============ */
function tambahBarisSatuanTurunan(containerId){
  const wrap = document.getElementById(containerId);
  if(!wrap) return;
  const row = document.createElement('div');
  row.className = 'st-row';
  row.innerHTML = `
    <input type="text" class="st-nama" placeholder="Nama satuan, contoh: karung">
    <input type="number" class="st-isi" min="0" step="any" placeholder="Isi (kg), contoh: 5">
    <input type="number" class="st-harga" min="0" placeholder="Harga jual (opsional)">
    <button type="button" class="btn btn-danger btn-sm" onclick="this.closest('.st-row').remove()">Hapus</button>
  `;
  wrap.appendChild(row);
}
function bacaBarisSatuanTurunan(containerId){
  const wrap = document.getElementById(containerId);
  if(!wrap) return [];
  return [...wrap.querySelectorAll('.st-row')].map(row=>{
    const nama = rapikanSpasi(row.querySelector('.st-nama').value);
    const isi = Number(row.querySelector('.st-isi').value)||0;
    const hargaRaw = row.querySelector('.st-harga').value;
    const harga = hargaRaw==='' ? null : Math.max(0, Number(hargaRaw)||0);
    if(!nama || isi<=0) return null;
    return { id: uid(), nama, isi, harga };
  }).filter(Boolean);
}

function renderDaftarKategori(){
  const dl = document.getElementById('daftarKategori');
  if(!dl) return;
  const set = new Set(db.barang.map(b=>rapikanSpasi(b.kategori)).filter(Boolean));
  dl.innerHTML = [...set].sort().map(k=>`<option value="${escHtml(k)}"></option>`).join('');
}

function renderDaftarBarang(){
  const q = (document.getElementById('cariBarang')?.value || '').toLowerCase();
  const tbody = document.getElementById('tblDaftarBarang');
  const list = db.barang.filter(b=>b.nama.toLowerCase().includes(q));
  if(list.length===0){
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><span class="icon">📦</span>Belum ada barang. Tambahkan dari menu "Tambah Barang".</div></td></tr>';
    return;
  }
  tbody.innerHTML = list.map(b=>{
    const low = b.stok <= b.stokMin;
    return `<tr>
      <td><strong>${escHtml(b.nama)}</strong></td>
      <td>${escHtml(b.kategori)}</td>
      <td>${rupiah(b.hargaBeli)}</td>
      <td>${rupiah(b.hargaJual)}</td>
      <td>${b.stok} ${escHtml(b.satuan)} ${low?'<span class="badge badge-low">Menipis</span>':''}</td>
      <td>${escHtml(b.satuan)}${(b.satuanTurunan&&b.satuanTurunan.length)?'<br><span class="helper-text">+ '+b.satuanTurunan.map(t=>escHtml(t.nama)+' ('+t.isi+' '+escHtml(b.satuan)+')').join(', ')+'</span>':''}</td>
      <td>
        <button class="btn btn-outline btn-sm" onclick="editBarangPrompt('${b.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="hapusBarang('${b.id}')">Hapus</button>
      </td>
    </tr>`;
  }).join('');
}

function editBarangPrompt(id){
  const b = db.barang.find(x=>x.id===id);
  if(!b) return;
  const nama = prompt('Nama barang:', b.nama); if(nama===null) return;
  const kategori = prompt('Kategori:', b.kategori); if(kategori===null) return;
  const hargaBeli = prompt('Harga beli (Rp):', b.hargaBeli); if(hargaBeli===null) return;
  const hargaJual = prompt('Harga jual (Rp):', b.hargaJual); if(hargaJual===null) return;
  const stok = prompt('Stok saat ini (dalam satuan dasar):', b.stok); if(stok===null) return;
  const satuan = prompt('Satuan dasar (dipakai untuk stok):', b.satuan); if(satuan===null) return;
  const stokMin = prompt('Stok minimum (batas peringatan):', b.stokMin); if(stokMin===null) return;
  const satuanTurunanStr = prompt(
    'Satuan turunan (opsional). Format: nama:isi:harga, pisahkan dengan koma.\n'+
    'Contoh: karung:5:25000, ons:0.1\n'+
    '("isi" = berapa satuan dasar ('+satuan.trim()+') dalam 1 satuan ini. "harga" boleh dikosongkan supaya dihitung otomatis)\n'+
    'Kosongkan semua untuk tidak memakai satuan turunan.',
    serializeSatuanTurunan(b.satuanTurunan)
  );
  if(satuanTurunanStr===null) return;

  const hbBaru = Math.max(0, Number(hargaBeli)||0);
  const hjBaru = Math.max(0, Number(hargaJual)||0);
  if(hjBaru < hbBaru){
    if(!confirm('Harga jual (Rp '+hjBaru.toLocaleString('id-ID')+') lebih rendah dari harga beli (Rp '+hbBaru.toLocaleString('id-ID')+'). Barang ini akan rugi setiap terjual. Tetap simpan?')) return;
  }
  b.nama = nama.trim() || b.nama;
  b.kategori = rapikanSpasi(kategori) || b.kategori;
  b.hargaBeli = hbBaru;
  b.hargaJual = hjBaru;
  b.stok = Math.max(0, roundQty(stok));
  b.satuan = satuan.trim() || b.satuan;
  b.stokMin = Math.max(0, roundQty(stokMin)||5);
  b.satuanTurunan = parseSatuanTurunanInput(satuanTurunanStr);
  saveDB();
  renderDaftarBarang();
  renderDaftarKategori();
  showToast('Barang "'+b.nama+'" berhasil diperbarui');
}

function hapusBarang(id){
  const b = db.barang.find(x=>x.id===id);
  if(!b) return;
  if(!confirm('Hapus barang "'+b.nama+'"? Riwayat transaksi terkait tidak akan terhapus. (Bisa dipulihkan lewat menu Sampah)')) return;
  buangKeSampah('barang', b, b.nama);
  db.barang = db.barang.filter(x=>x.id!==id);
  saveDB();
  renderDaftarBarang();
  renderDaftarKategori();
  showToast('Barang "'+b.nama+'" dihapus. Bisa dipulihkan lewat menu Sampah.');
}

/* ============ CART (shared logic for cash & hutang) ============
   carts[type] = { 'barangId|unitKey': {barangId, unitKey, label, isi, hargaJual, hargaBeli, qtyUnit} }
   - qtyUnit = jumlah dalam satuan yang dipilih (mis. 2 karung, atau 3 ons)
   - isi     = konversi ke satuan dasar (mis. karung isi 5 -> 1 karung = 5 kg)
   Barang yang sama bisa punya lebih dari satu baris di keranjang jika dijual dalam satuan berbeda
   (mis. 2 kg lepas + 1 karung), stok dicek gabungan supaya tidak kejual melebihi stok. */
let carts = { cash:{}, hutang:{} };

function renderQuickPickCash(){ renderQuickPick('cariJualCash','quickPickCash','cash'); }
function renderQuickPickHutang(){ renderQuickPick('cariJualHutang','quickPickHutang','hutang'); }

function renderQuickPick(inputId, gridId, type){
  const q = (document.getElementById(inputId)?.value || '').toLowerCase();
  const grid = document.getElementById(gridId);
  const list = db.barang.filter(b=>b.nama.toLowerCase().includes(q));
  if(list.length===0){
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><span class="icon">📦</span>Belum ada barang tersedia</div>';
    return;
  }
  grid.innerHTML = list.map(b=>{
    const units = daftarSatuanUntukJual(b);
    const unitSelectHtml = units.length>1 ? `
      <select class="qp-unit" id="qpUnit_${type}_${b.id}" onclick="event.stopPropagation()">
        ${units.map(u=>`<option value="${u.key}">per ${escHtml(u.nama)} (${rupiah(u.hargaJual)})</option>`).join('')}
      </select>` : '';
    return `
    <div class="quick-item-card">
      <button type="button" class="quick-item" onclick="addToCart('${type}','${b.id}')">
        <span class="qn">${escHtml(b.nama)}</span>
        <span class="qp">${rupiah(b.hargaJual)} / ${escHtml(b.satuan)}</span>
        <span class="qs">Stok: ${b.stok} ${escHtml(b.satuan)}</span>
      </button>
      ${unitSelectHtml}
    </div>`;
  }).join('');
}

function totalBaseQtyDiKeranjang(cart, barangId, kecualiKey){
  return Object.keys(cart).reduce((s,k)=>{
    const l = cart[k];
    if(l.barangId!==barangId || k===kecualiKey) return s;
    return s + l.qtyUnit*l.isi;
  }, 0);
}

function addToCart(type, barangId){
  const b = db.barang.find(x=>x.id===barangId);
  if(!b) return;
  const selEl = document.getElementById('qpUnit_'+type+'_'+barangId);
  const unitKey = selEl ? selEl.value : 'base';
  const unit = getSatuanJualByKey(b, unitKey);
  const cart = carts[type];
  const key = barangId+'|'+unit.key;
  const sudahDipakai = totalBaseQtyDiKeranjang(cart, barangId, null);
  if(roundQty(sudahDipakai + unit.isi) > b.stok + 1e-9){
    showToast('Stok "'+b.nama+'" tidak cukup (sisa '+b.stok+' '+b.satuan+')');
    return;
  }
  if(cart[key]) cart[key].qtyUnit += 1;
  else cart[key] = { barangId, unitKey:unit.key, label:unit.nama, isi:unit.isi, hargaJual:unit.hargaJual, hargaBeli:unit.hargaBeli, qtyUnit:1 };
  renderCart(type);
}

function changeQty(type, key, delta){
  const cart = carts[type];
  const line = cart[key];
  if(!line) return;
  const b = db.barang.find(x=>x.id===line.barangId);
  if(!b){ delete cart[key]; renderCart(type); return; }
  const qtyBaru = roundQty(line.qtyUnit + delta);
  if(qtyBaru <= 0){ delete cart[key]; renderCart(type); return; }
  const basePakaiLain = totalBaseQtyDiKeranjang(cart, line.barangId, key);
  if(roundQty(basePakaiLain + qtyBaru*line.isi) > b.stok + 1e-9){
    showToast('Stok "'+b.nama+'" tidak cukup (sisa '+b.stok+' '+b.satuan+')');
    return;
  }
  line.qtyUnit = qtyBaru;
  renderCart(type);
}

// Dipakai saat pembeli mengetik langsung jumlahnya di keranjang (mendukung angka desimal,
// contoh: beli setengah ons -> ketik 0.5).
function setQty(type, key, valueStr){
  const cart = carts[type];
  const line = cart[key];
  if(!line){ renderCart(type); return; }
  const b = db.barang.find(x=>x.id===line.barangId);
  if(!b){ delete cart[key]; renderCart(type); return; }
  const qtyBaru = roundQty(valueStr);
  if(qtyBaru <= 0){ delete cart[key]; renderCart(type); return; }
  const basePakaiLain = totalBaseQtyDiKeranjang(cart, line.barangId, key);
  if(roundQty(basePakaiLain + qtyBaru*line.isi) > b.stok + 1e-9){
    const maksTampil = roundQty((b.stok - basePakaiLain) / line.isi);
    showToast('Stok "'+b.nama+'" tidak cukup (maks '+Math.max(maksTampil,0)+' '+line.label+')');
    renderCart(type);
    return;
  }
  line.qtyUnit = qtyBaru;
  renderCart(type);
}

function kosongkanCart(type){
  carts[type] = {};
  renderCart(type);
}

function renderCart(type){
  const cart = carts[type];
  // Bersihkan otomatis item keranjang yang barangnya sudah dihapus dari Daftar Barang
  // (mencegah error saat proses pembayaran / data transaksi tidak valid)
  Object.keys(cart).forEach(key=>{ if(!db.barang.find(x=>x.id===cart[key].barangId)) delete cart[key]; });
  const containerId = type==='cash' ? 'cartCash' : 'cartHutang';
  const totalId = type==='cash' ? 'totalCash' : 'totalHutang';
  const container = document.getElementById(containerId);
  const keys = Object.keys(cart);
  if(keys.length===0){
    container.innerHTML = '<div class="empty-state"><span class="icon">🛒</span>Keranjang masih kosong</div>';
    document.getElementById(totalId).textContent = rupiah(0);
    if(type==='cash') hitungKembalianCash();
    return;
  }
  let total = 0;
  container.innerHTML = keys.map(key=>{
    const line = cart[key];
    const b = db.barang.find(x=>x.id===line.barangId);
    if(!b) return '';
    const subtotal = line.qtyUnit * line.hargaJual;
    total += subtotal;
    return `<div class="cart-line">
      <span class="nm">${escHtml(b.nama)}<br><span style="font-weight:400;color:var(--ink-soft);font-size:11.5px;">${rupiah(line.hargaJual)} / ${escHtml(line.label)}</span></span>
      <div class="qty-control">
        <button type="button" onclick="changeQty('${type}','${key}',-1)">−</button>
        <input type="number" class="qty-input" step="any" min="0" value="${line.qtyUnit}" onchange="setQty('${type}','${key}',this.value)" onclick="this.select()">
        <button type="button" onclick="changeQty('${type}','${key}',1)">+</button>
      </div>
      <span style="min-width:80px;text-align:right;font-weight:700;">${rupiah(subtotal)}</span>
    </div>`;
  }).join('');
  document.getElementById(totalId).textContent = rupiah(total);
  if(type==='cash') hitungKembalianCash();
}

function hitungKembalianCash(){
  const cart = carts.cash;
  let total = 0;
  Object.keys(cart).forEach(key=>{ total += cart[key].qtyUnit * cart[key].hargaJual; });
  const diterima = Number(document.getElementById('cashDiterima').value)||0;
  const kembali = diterima - total;
  document.getElementById('kembalianCash').textContent = 'Kembalian: ' + rupiah(Math.max(kembali,0)) + (kembali<0 ? '  (kurang '+rupiah(-kembali)+')' : '');
}

// Susun item transaksi dari satu baris keranjang. "qty"/"hargaJual"/"hargaBeli" tetap dalam
// SATUAN DASAR (supaya semua perhitungan stok & laporan yang sudah ada tidak perlu diubah),
// sedangkan "satuan"/"isi"/"qtyTampil" dipakai khusus untuk tampilan struk & riwayat.
function itemDariBarisKeranjang(line, b){
  const qty = roundQty(line.qtyUnit * line.isi); // dalam satuan dasar
  const hargaJualDasar = line.isi ? (line.hargaJual / line.isi) : line.hargaJual; // per satuan dasar
  return {
    barangId: line.barangId, nama: b.nama, qty,
    hargaJual: hargaJualDasar, hargaBeli: b.hargaBeli,
    satuan: line.label, isi: line.isi, qtyTampil: line.qtyUnit
  };
}

function prosesCash(){
  const cart = carts.cash;
  Object.keys(cart).forEach(key=>{ if(!db.barang.find(x=>x.id===cart[key].barangId)) delete cart[key]; });
  const keys = Object.keys(cart);
  if(keys.length===0){ showToast('Keranjang masih kosong'); return; }
  let total = 0, modal = 0;
  const items = keys.map(key=>{
    const line = cart[key];
    const b = db.barang.find(x=>x.id===line.barangId);
    total += line.qtyUnit * line.hargaJual;
    modal += line.qtyUnit * line.hargaBeli;
    return itemDariBarisKeranjang(line, b);
  });
  const diterima = Number(document.getElementById('cashDiterima').value)||0;
  if(diterima < total){
    if(!confirm('Uang diterima kurang dari total. Lanjutkan transaksi?')) return;
  }
  // kurangi stok (dalam satuan dasar)
  items.forEach(it=>{
    const b = db.barang.find(x=>x.id===it.barangId);
    if(b) b.stok = roundQty(b.stok - it.qty);
  });
  const trx = {
    id:uid(), waktu:new Date().toISOString(), pelanggan:'Umum', jenis:'cash',
    items, total, modal, diterima
  };
  db.transaksi.push(trx);
  saveDB();
  carts.cash = {};
  document.getElementById('cashDiterima').value='';
  renderCart('cash');
  renderQuickPickCash();
  showReceipt(trx);
  showToast('Transaksi cash berhasil disimpan');
}

function prosesHutang(){
  const namaInput = document.getElementById('namaPelangganHutang').value.trim();
  if(!namaInput){ showToast('Nama pelanggan wajib diisi'); return; }
  const nama = resolveNamaPelanggan(namaInput);
  const cart = carts.hutang;
  Object.keys(cart).forEach(key=>{ if(!db.barang.find(x=>x.id===cart[key].barangId)) delete cart[key]; });
  const keys = Object.keys(cart);
  if(keys.length===0){ showToast('Keranjang masih kosong'); return; }
  let total = 0, modal = 0;
  const items = keys.map(key=>{
    const line = cart[key];
    const b = db.barang.find(x=>x.id===line.barangId);
    total += line.qtyUnit * line.hargaJual;
    modal += line.qtyUnit * line.hargaBeli;
    return itemDariBarisKeranjang(line, b);
  });
  items.forEach(it=>{
    const b = db.barang.find(x=>x.id===it.barangId);
    if(b) b.stok = roundQty(b.stok - it.qty);
  });
  const trx = {
    id:uid(), waktu:new Date().toISOString(), pelanggan:nama, jenis:'hutang',
    items, total, modal, diterima:0
  };
  db.transaksi.push(trx);
  saveDB();
  carts.hutang = {};
  document.getElementById('namaPelangganHutang').value='';
  renderCart('hutang');
  renderQuickPickHutang();
  renderDaftarPelangganDatalist();
  showReceipt(trx);
  showToast('Hutang untuk "'+nama+'" berhasil dicatat');
}

function showReceipt(trx){
  const html = `
    <h3>KOPERASI PT. CEMARU LESTARI</h3>
    <div class="center">${fmtWaktu(trx.waktu)}</div>
    <hr>
    ${trx.items.map(it=>`<div class="line"><span>${escHtml(it.nama)} x${it.qtyTampil ?? it.qty}${it.satuan?(' '+escHtml(it.satuan)):''}</span><span>${rupiah(it.qty*it.hargaJual)}</span></div>`).join('')}
    <hr>
    <div class="line"><strong>TOTAL</strong><strong>${rupiah(trx.total)}</strong></div>
    ${trx.jenis==='cash' ? `
      <div class="line"><span>Diterima</span><span>${rupiah(trx.diterima)}</span></div>
      <div class="line"><span>Kembali</span><span>${rupiah(Math.max(trx.diterima-trx.total,0))}</span></div>
    ` : `<div class="line"><span>Status</span><span>HUTANG (${escHtml(trx.pelanggan)})</span></div>`}
    <hr>
    <div class="center">Terima kasih telah berbelanja 🙏</div>
    <button class="btn btn-outline" style="width:100%;margin-top:14px;" onclick="closeReceipt()">Tutup</button>
  `;
  document.getElementById('receiptContent').innerHTML = html;
  document.getElementById('receiptModalBg').classList.add('show');
}
function closeReceipt(){
  document.getElementById('receiptModalBg').classList.remove('show');
}

function showReceiptBayar(p, sisaSebelum, kembalian){
  const sisaSesudah = Math.max(sisaSebelum - p.jumlah, 0);
  const html = `
    <h3>KOPERASI PT. CEMARU LESTARI</h3>
    <div class="center">Bukti Pembayaran Hutang<br>${fmtWaktu(p.waktu)}</div>
    <hr>
    <div class="line"><span>Pelanggan</span><span>${escHtml(p.pelanggan)}</span></div>
    <div class="line"><span>Sisa Hutang Sebelum</span><span>${rupiah(sisaSebelum)}</span></div>
    <div class="line"><strong>Dibayar</strong><strong>${rupiah(p.jumlah)}</strong></div>
    ${kembalian>0 ? `<div class="line"><span>Kembalian</span><span>${rupiah(kembalian)}</span></div>` : ''}
    <hr>
    <div class="line"><strong>Sisa Hutang Sekarang</strong><strong>${rupiah(sisaSesudah)}</strong></div>
    <hr>
    <div class="center">${sisaSesudah<=0?'Hutang LUNAS. Terima kasih 🙏':'Terima kasih atas pembayarannya 🙏'}</div>
    <button class="btn btn-outline" style="width:100%;margin-top:14px;" onclick="closeReceipt()">Tutup</button>
  `;
  document.getElementById('receiptContent').innerHTML = html;
  document.getElementById('receiptModalBg').classList.add('show');
}

function renderDaftarPelangganDatalist(){
  const dl = document.getElementById('daftarPelanggan');
  if(!dl) return;
  const map = daftarNamaPelangganCanonical();
  dl.innerHTML = [...map.values()].sort().map(n=>`<option value="${escHtml(n)}"></option>`).join('');
}

/* ============ RIWAYAT TRANSAKSI ============ */
function renderRiwayatTransaksi(){
  const dari = document.getElementById('filterTrxDari').value;
  const sampai = document.getElementById('filterTrxSampai').value;
  const jenis = document.getElementById('filterTrxJenis').value;
  let list = [...db.transaksi].sort((a,b)=>new Date(b.waktu)-new Date(a.waktu));
  if(dari) list = list.filter(t=>tanggalLokal(t.waktu) >= dari);
  if(sampai) list = list.filter(t=>tanggalLokal(t.waktu) <= sampai);
  if(jenis) list = list.filter(t=>t.jenis===jenis);

  const tbody = document.getElementById('tblRiwayatTransaksi');
  if(list.length===0){
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><span class="icon">🧾</span>Belum ada transaksi pada rentang ini</div></td></tr>';
    return;
  }
  tbody.innerHTML = list.map(t=>{
    const untung = t.total - t.modal;
    const itemStr = t.items.map(i=>{
      const aktif = db.barang.some(b=>b.id===i.barangId);
      return escHtml(i.nama)+' x'+(i.qtyTampil ?? i.qty)+(i.satuan?(' '+escHtml(i.satuan)):'') + (aktif?'':' <span class="badge badge-low" title="Barang ini sudah dihapus dari Daftar Barang">tidak aktif</span>');
    }).join(', ');
    return `<tr>
      <td>${fmtWaktu(t.waktu)}</td>
      <td>${escHtml(t.pelanggan)}</td>
      <td>${t.jenis==='cash' ? '<span class="badge badge-ok">Cash</span>' : '<span class="badge badge-belum">Hutang</span>'}</td>
      <td>${itemStr}</td>
      <td>${rupiah(t.total)}</td>
      <td>${rupiah(untung)}</td>
      <td>
        <button class="btn btn-outline btn-sm" onclick='showReceipt(${escHtmlAttr(JSON.stringify(t))})'>Struk</button>
        <button class="btn btn-outline btn-sm" onclick="editTransaksiPrompt('${t.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="hapusTransaksi('${t.id}')">Hapus</button>
      </td>
    </tr>`;
  }).join('');
}

/* ============ EDIT & HAPUS TRANSAKSI ============ */
function editTransaksiPrompt(id){
  const t = db.transaksi.find(x=>x.id===id);
  if(!t){ showToast('Transaksi tidak ditemukan'); return; }

  let pelanggan = t.pelanggan;
  if(t.jenis==='hutang'){
    const p = prompt('Nama pelanggan:', t.pelanggan);
    if(p===null) return;
    pelanggan = p.trim() ? resolveNamaPelanggan(p) : t.pelanggan;
  }

  const newItems = [];
  for(const it of t.items){
    const b = db.barang.find(x=>x.id===it.barangId);
    const isi = it.isi || 1; // konversi ke satuan dasar (1 kalau item lama / dijual per satuan dasar)
    const satuanLabel = it.satuan || (b ? b.satuan : '') || '';
    const qtyTampilLama = it.qtyTampil ?? it.qty;
    const stokTersediaDasar = b ? (b.stok + it.qty) : null; // satuan dasar
    const stokTersediaTampil = stokTersediaDasar!=null ? roundQty(stokTersediaDasar/isi) : null;
    const infoStok = b ? ` (maks ${stokTersediaTampil} ${satuanLabel})` : ' (barang sudah dihapus dari daftar)';
    const qtyStr = prompt('Jumlah "'+it.nama+'" per '+satuanLabel+infoStok+':\nIsi 0 untuk menghapus item ini dari transaksi.', qtyTampilLama);
    if(qtyStr===null) return; // batal, tidak ada perubahan
    const qtyTampilBaru = Math.max(0, roundQty(qtyStr));
    if(qtyTampilBaru===0) continue;
    const qtyBaru = roundQty(qtyTampilBaru * isi); // satuan dasar
    if(b && qtyBaru > stokTersediaDasar + 1e-9){
      showToast('Stok "'+it.nama+'" tidak cukup (maks '+stokTersediaTampil+' '+satuanLabel+')');
      return;
    }
    // Pakai harga yang tercatat SAAT TRANSAKSI ITU TERJADI (it.hargaJual/it.hargaBeli),
    // bukan harga barang saat ini. Kalau memakai harga sekarang, mengedit jumlah pada
    // transaksi lama akan diam-diam mengubah nilai historis (omset & untung) setiap kali
    // harga barang pernah berubah sejak transaksi itu dibuat — merusak akurasi laporan.
    newItems.push({
      barangId: it.barangId,
      nama: it.nama,
      qty: qtyBaru,
      hargaJual: it.hargaJual,
      hargaBeli: it.hargaBeli,
      satuan: satuanLabel,
      isi,
      qtyTampil: qtyTampilBaru
    });
  }

  if(newItems.length===0){
    if(!confirm('Semua item dihapus dari transaksi ini. Hapus seluruh transaksi?')) return;
    hapusTransaksi(id, true);
    return;
  }

  const totalBaru = newItems.reduce((s,i)=>s+i.qty*i.hargaJual,0);

  let diterima = t.diterima;
  if(t.jenis==='cash'){
    const dStr = prompt('Uang diterima (Rp):\nTotal baru: '+rupiah(totalBaru), t.diterima);
    if(dStr===null) return;
    diterima = Number(dStr)||0;
  }

  // kembalikan stok lama, lalu terapkan stok baru
  t.items.forEach(old=>{
    const b = db.barang.find(x=>x.id===old.barangId);
    if(b) b.stok += old.qty;
  });
  newItems.forEach(ni=>{
    const b = db.barang.find(x=>x.id===ni.barangId);
    if(b) b.stok -= ni.qty;
  });

  t.pelanggan = pelanggan;
  t.items = newItems;
  t.total = totalBaru;
  t.modal = newItems.reduce((s,i)=>s+i.qty*i.hargaBeli,0);
  if(t.jenis==='cash') t.diterima = diterima;

  saveDB();
  renderRiwayatTransaksi();
  renderDaftarBarang();
  renderDaftarHutang();
  renderLaporanHutang();
  renderLaporanStok();
  renderDashboard();
  showToast('Transaksi berhasil diperbarui');
}

function hapusTransaksi(id, skipConfirm){
  const t = db.transaksi.find(x=>x.id===id);
  if(!t){ showToast('Transaksi tidak ditemukan'); return; }
  if(!skipConfirm && !confirm('Hapus transaksi ini? Stok barang akan dikembalikan seperti sebelum transaksi. (Bisa dipulihkan lewat menu Sampah)')) return;
  if(!cekPINAksi('Hapus Transaksi')) return;
  buangKeSampah('transaksi', t, (t.jenis==='cash'?'Cash':'Hutang '+t.pelanggan)+' — '+rupiah(t.total));
  t.items.forEach(it=>{
    const b = db.barang.find(x=>x.id===it.barangId);
    if(b) b.stok += it.qty;
  });
  db.transaksi = db.transaksi.filter(x=>x.id!==id);
  saveDB();
  renderRiwayatTransaksi();
  renderDaftarBarang();
  renderDaftarHutang();
  renderLaporanHutang();
  renderLaporanStok();
  renderDashboard();
  renderSampah();
  showToast('Transaksi berhasil dihapus, stok dikembalikan. Bisa dipulihkan lewat menu Sampah.');
}

/* ============ HUTANG ============ */
function getHutangPerPelanggan(){
  const map = {}; // nama -> {total, dibayar}
  db.transaksi.filter(t=>t.jenis==='hutang').forEach(t=>{
    if(!map[t.pelanggan]) map[t.pelanggan] = {total:0, dibayar:0};
    map[t.pelanggan].total += t.total;
  });
  db.pembayaranHutang.forEach(p=>{
    if(!map[p.pelanggan]) map[p.pelanggan] = {total:0, dibayar:0};
    map[p.pelanggan].dibayar += p.jumlah;
  });
  return map;
}

function renderDaftarHutang(){
  const map = getHutangPerPelanggan();
  const tbody = document.getElementById('tblDaftarHutang');
  const names = Object.keys(map).filter(n=>map[n].total>0);
  if(names.length===0){
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><span class="icon">💳</span>Belum ada hutang tercatat</div></td></tr>';
    return;
  }
  tbody.innerHTML = names.map(n=>{
    const d = map[n];
    const sisa = d.total - d.dibayar;
    const lunas = sisa <= 0;
    return `<tr>
      <td><strong class="link-nama" style="cursor:pointer;text-decoration:underline;" onclick="showDetailPelanggan(decodeURIComponent('${encodeURIComponent(n).replace(/'/g,'%27')}'))" title="Klik untuk lihat rincian">${escHtml(n)}</strong></td>
      <td>${rupiah(d.total)}</td>
      <td>${rupiah(d.dibayar)}</td>
      <td>${rupiah(Math.max(sisa,0))}</td>
      <td>${lunas ? '<span class="badge badge-lunas">Lunas</span>' : '<span class="badge badge-belum">Belum Lunas</span>'}</td>
    </tr>`;
  }).join('');
}

function showDetailPelanggan(nama){
  const trxList = db.transaksi.filter(t=>t.jenis==='hutang' && t.pelanggan===nama).sort((a,b)=>new Date(a.waktu)-new Date(b.waktu));
  const bayarList = db.pembayaranHutang.filter(p=>p.pelanggan===nama).sort((a,b)=>new Date(a.waktu)-new Date(b.waktu));
  const totalHutang = trxList.reduce((s,t)=>s+t.total,0);
  const totalBayar = bayarList.reduce((s,p)=>s+p.jumlah,0);
  const sisa = Math.max(totalHutang-totalBayar,0);

  const gabungan = [
    ...trxList.map(t=>({waktu:t.waktu, tipe:'Hutang Baru', ket:t.items.map(i=>escHtml(i.nama)+' x'+i.qty).join(', '), nilai:t.total, tanda:'+'})),
    ...bayarList.map(p=>({waktu:p.waktu, tipe:'Pembayaran', ket:'-', nilai:p.jumlah, tanda:'-'}))
  ].sort((a,b)=>new Date(a.waktu)-new Date(b.waktu));

  const rows = gabungan.map(g=>`<div class="line"><span>${fmtWaktu(g.waktu)} — ${g.tipe}${g.ket!=='-' ? ' ('+g.ket+')' : ''}</span><span>${g.tanda}${rupiah(g.nilai)}</span></div>`).join('');

  const html = `
    <h3>RINCIAN HUTANG</h3>
    <div class="center">${escHtml(nama)}</div>
    <hr>
    ${rows || '<div class="center">Belum ada riwayat</div>'}
    <hr>
    <div class="line"><span>Total Hutang</span><span>${rupiah(totalHutang)}</span></div>
    <div class="line"><span>Total Dibayar</span><span>${rupiah(totalBayar)}</span></div>
    <div class="line"><strong>Sisa Hutang</strong><strong>${rupiah(sisa)}</strong></div>
    <hr>
    <button class="btn btn-outline" style="width:100%;margin-top:14px;" onclick="closeReceipt()">Tutup</button>
  `;
  document.getElementById('receiptContent').innerHTML = html;
  document.getElementById('receiptModalBg').classList.add('show');
}

function renderSelectPelangganHutang(){
  const map = getHutangPerPelanggan();
  const sel = document.getElementById('bayarPelanggan');
  const names = Object.keys(map).filter(n=> (map[n].total - map[n].dibayar) > 0);
  if(names.length===0){
    sel.innerHTML = '<option value="">Tidak ada hutang aktif</option>';
    document.getElementById('infoSisaHutang').value = rupiah(0);
    return;
  }
  sel.innerHTML = names.map(n=>`<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('');
  updateInfoSisaHutang();
}

function updateInfoSisaHutang(){
  const nama = document.getElementById('bayarPelanggan').value;
  const map = getHutangPerPelanggan();
  const sisa = nama && map[nama] ? (map[nama].total - map[nama].dibayar) : 0;
  document.getElementById('infoSisaHutang').value = rupiah(Math.max(sisa,0));
  hitungKembalianHutang();
}

function hitungKembalianHutang(){
  const nama = document.getElementById('bayarPelanggan').value;
  const map = getHutangPerPelanggan();
  const sisa = nama && map[nama] ? Math.max(map[nama].total - map[nama].dibayar, 0) : 0;
  const diterima = Number(document.getElementById('jumlahBayarHutang').value)||0;
  const kembali = diterima - sisa;
  document.getElementById('kembalianHutang').textContent = 'Kembalian: ' + rupiah(Math.max(kembali,0));
}

function prosesBayarHutang(){
  const nama = document.getElementById('bayarPelanggan').value;
  const diterima = Math.max(0, Number(document.getElementById('jumlahBayarHutang').value)||0);
  if(!nama){ showToast('Pilih pelanggan terlebih dahulu'); return; }
  if(diterima<=0){ showToast('Jumlah bayar harus lebih dari 0'); return; }
  const map = getHutangPerPelanggan();
  const sisa = Math.max(map[nama].total - map[nama].dibayar, 0);
  const jumlahTercatat = Math.min(diterima, sisa);
  const kembalian = diterima - jumlahTercatat;
  const p = {id:uid(), waktu:new Date().toISOString(), pelanggan:nama, jumlah:jumlahTercatat};
  db.pembayaranHutang.push(p);
  saveDB();
  document.getElementById('jumlahBayarHutang').value='';
  renderSelectPelangganHutang();
  showReceiptBayar(p, sisa, kembalian);
  if(kembalian>0){
    showToast('Hutang "'+nama+'" lunas ('+rupiah(jumlahTercatat)+'). Kembalian untuk pelanggan: '+rupiah(kembalian));
  } else {
    showToast('Pembayaran dari "'+nama+'" sebesar '+rupiah(jumlahTercatat)+' tersimpan');
  }
}

function renderRiwayatBayar(){
  const tbody = document.getElementById('tblRiwayatBayar');
  const q = (document.getElementById('cariRiwayatBayar')?.value || '').toLowerCase();
  let list = [...db.pembayaranHutang].sort((a,b)=>new Date(b.waktu)-new Date(a.waktu));
  if(q) list = list.filter(p=>p.pelanggan.toLowerCase().includes(q));
  if(list.length===0){
    tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><span class="icon">💰</span>Belum ada riwayat pembayaran</div></td></tr>';
    return;
  }
  tbody.innerHTML = list.map(p=>`<tr>
    <td>${fmtWaktu(p.waktu)}</td><td>${escHtml(p.pelanggan)}</td><td>${rupiah(p.jumlah)}</td>
    <td>
      <button class="btn btn-outline btn-sm" onclick="editPembayaranPrompt('${p.id}')">Edit</button>
      <button class="btn btn-danger btn-sm" onclick="hapusPembayaran('${p.id}')">Hapus</button>
    </td>
  </tr>`).join('');
}

function editPembayaranPrompt(id){
  const p = db.pembayaranHutang.find(x=>x.id===id);
  if(!p){ showToast('Data pembayaran tidak ditemukan'); return; }
  const jumlahStr = prompt('Jumlah pembayaran (Rp) untuk "'+p.pelanggan+'":', p.jumlah);
  if(jumlahStr===null) return;
  const jumlah = Number(jumlahStr)||0;
  if(jumlah<=0){ showToast('Jumlah harus lebih dari 0'); return; }
  p.jumlah = jumlah;
  saveDB();
  renderRiwayatBayar();
  renderDaftarHutang();
  renderLaporanHutang();
  renderDashboard();
  showToast('Pembayaran hutang berhasil diperbarui');
}

function hapusPembayaran(id){
  const p = db.pembayaranHutang.find(x=>x.id===id);
  if(!p){ showToast('Data pembayaran tidak ditemukan'); return; }
  if(!confirm('Hapus riwayat pembayaran dari "'+p.pelanggan+'" sebesar '+rupiah(p.jumlah)+'? (Bisa dipulihkan lewat menu Sampah)')) return;
  buangKeSampah('pembayaran', p, p.pelanggan+' — '+rupiah(p.jumlah));
  db.pembayaranHutang = db.pembayaranHutang.filter(x=>x.id!==id);
  saveDB();
  renderRiwayatBayar();
  renderDaftarHutang();
  renderLaporanHutang();
  renderDashboard();
  renderSampah();
  showToast('Riwayat pembayaran dihapus. Bisa dipulihkan lewat menu Sampah.');
}

/* ============ STOK ============ */
function renderSelectBarangStok(selectId){
  const sel = document.getElementById(selectId);
  if(db.barang.length===0){
    sel.innerHTML = '<option value="">Belum ada barang</option>';
    return;
  }
  sel.innerHTML = db.barang.map(b=>`<option value="${b.id}">${escHtml(b.nama)} (stok: ${b.stok} ${escHtml(b.satuan)})</option>`).join('');
  // ID pasangan select satuan mengikuti pola "masukBarang"->"masukSatuan" / "keluarBarang"->"keluarSatuan"
  const satuanSelectId = selectId.replace('Barang','Satuan');
  renderSatuanPilihanStok(selectId, satuanSelectId);
}

function renderSatuanPilihanStok(barangSelectId, satuanSelectId){
  const barangSel = document.getElementById(barangSelectId);
  const satuanSel = document.getElementById(satuanSelectId);
  if(!barangSel || !satuanSel) return;
  const b = db.barang.find(x=>x.id===barangSel.value);
  if(!b){ satuanSel.innerHTML = ''; return; }
  const units = daftarSatuanUntukJual(b);
  satuanSel.innerHTML = units.map(u=>`<option value="${u.key}">${escHtml(u.nama)}${u.isi!==1?' (= '+u.isi+' '+escHtml(b.satuan)+')':''}</option>`).join('');
}

function prosesStokMasuk(e){
  e.preventDefault();
  const id = document.getElementById('masukBarang').value;
  const b = db.barang.find(x=>x.id===id);
  if(!b){ showToast('Pilih barang terlebih dahulu'); return false; }
  const unit = getSatuanJualByKey(b, document.getElementById('masukSatuan').value);
  const jumlahTampil = Number(document.getElementById('masukJumlah').value)||0;
  const ket = document.getElementById('masukKet').value.trim();
  if(jumlahTampil<=0){ showToast('Jumlah harus lebih dari 0'); return false; }
  const jumlahDasar = roundQty(jumlahTampil * unit.isi);
  b.stok = roundQty(b.stok + jumlahDasar);
  db.stokLog.push({
    id:uid(), waktu:new Date().toISOString(), barangId:id, nama:b.nama, jenis:'masuk',
    jumlah: jumlahDasar, keterangan:ket||'-',
    satuanAsli: unit.nama, jumlahAsli: jumlahTampil, isiAsli: unit.isi
  });
  saveDB();
  document.getElementById('formStokMasuk').reset();
  renderSelectBarangStok('masukBarang');
  showToast('Stok "'+b.nama+'" bertambah '+jumlahTampil+' '+unit.nama+(unit.isi!==1?(' (= '+jumlahDasar+' '+b.satuan+')'):''));
  return false;
}

function prosesStokKeluar(e){
  e.preventDefault();
  const id = document.getElementById('keluarBarang').value;
  const b = db.barang.find(x=>x.id===id);
  if(!b){ showToast('Pilih barang terlebih dahulu'); return false; }
  const unit = getSatuanJualByKey(b, document.getElementById('keluarSatuan').value);
  const jumlahTampil = Number(document.getElementById('keluarJumlah').value)||0;
  const alasan = document.getElementById('keluarAlasan').value;
  if(jumlahTampil<=0){ showToast('Jumlah harus lebih dari 0'); return false; }
  const jumlahDasar = roundQty(jumlahTampil * unit.isi);
  if(jumlahDasar > b.stok + 1e-9){ showToast('Jumlah keluar melebihi stok yang ada'); return false; }
  b.stok = roundQty(b.stok - jumlahDasar);
  db.stokLog.push({
    id:uid(), waktu:new Date().toISOString(), barangId:id, nama:b.nama, jenis:'keluar',
    jumlah: jumlahDasar, keterangan:alasan,
    satuanAsli: unit.nama, jumlahAsli: jumlahTampil, isiAsli: unit.isi
  });
  saveDB();
  document.getElementById('formStokKeluar').reset();
  renderSelectBarangStok('keluarBarang');
  showToast('Stok "'+b.nama+'" berkurang '+jumlahTampil+' '+unit.nama+(unit.isi!==1?(' (= '+jumlahDasar+' '+b.satuan+')'):'')+' ('+alasan+')');
  return false;
}

function renderRiwayatStok(){
  const tbody = document.getElementById('tblRiwayatStok');
  const q = (document.getElementById('cariRiwayatStok')?.value || '').toLowerCase();
  let list = [...db.stokLog].sort((a,b)=>new Date(b.waktu)-new Date(a.waktu));
  if(q) list = list.filter(s=>s.nama.toLowerCase().includes(q));
  if(list.length===0){
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><span class="icon">📦</span>Belum ada pergerakan stok</div></td></tr>';
    return;
  }
  tbody.innerHTML = list.map(s=>{
    const jumlahStr = (s.jumlahAsli!=null && s.satuanAsli)
      ? s.jumlahAsli+' '+escHtml(s.satuanAsli)+(s.isiAsli && s.isiAsli!==1 ? ' <span class="helper-text">(= '+s.jumlah+')</span>' : '')
      : s.jumlah;
    return `<tr>
    <td>${fmtWaktu(s.waktu)}</td>
    <td>${escHtml(s.nama)}</td>
    <td>${s.jenis==='masuk' ? '<span class="badge badge-ok">Masuk</span>' : '<span class="badge badge-low">Keluar</span>'}</td>
    <td>${jumlahStr}</td>
    <td>${escHtml(s.keterangan)}</td>
    <td>
      <button class="btn btn-outline btn-sm" onclick="editStokLogPrompt('${s.id}')">Edit</button>
      <button class="btn btn-danger btn-sm" onclick="hapusStokLog('${s.id}')">Hapus</button>
    </td>
  </tr>`;
  }).join('');
}

function editStokLogPrompt(id){
  const log = db.stokLog.find(x=>x.id===id);
  if(!log){ showToast('Riwayat stok tidak ditemukan'); return; }
  const b0 = db.barang.find(x=>x.id===log.barangId);
  const jumlahStr = prompt('Jumlah stok '+(log.jenis==='masuk'?'masuk':'keluar')+' untuk "'+log.nama+'" (dalam satuan dasar'+(b0?' - '+b0.satuan:'')+'):', log.jumlah);
  if(jumlahStr===null) return;
  const jumlahBaru = Math.max(0, roundQty(jumlahStr));
  if(jumlahBaru<=0){ showToast('Jumlah harus lebih dari 0'); return; }

  const b = db.barang.find(x=>x.id===log.barangId);
  if(b){
    // Hitung ulang dari awal: batalkan efek lama, lalu terapkan efek baru,
    // dan pastikan hasil akhirnya tidak pernah minus (baik untuk jenis masuk maupun keluar).
    // Sebelumnya kode ini hanya mengecek kecukupan stok untuk jenis 'keluar' saja,
    // sehingga mengedit jumlah "stok masuk" menjadi lebih kecil bisa membuat stok jadi minus
    // jika sebagian barang itu sudah terlanjur terjual/keluar.
    const stokSetelahRevert = log.jenis==='masuk' ? (b.stok - log.jumlah) : (b.stok + log.jumlah);
    const stokAkhir = log.jenis==='masuk' ? (stokSetelahRevert + jumlahBaru) : (stokSetelahRevert - jumlahBaru);
    if(stokAkhir < 0){
      showToast('Perubahan ini akan membuat stok "'+log.nama+'" menjadi minus. Perubahan dibatalkan.');
      return;
    }
    b.stok = stokAkhir;
  }
  log.jumlah = jumlahBaru;
  // Hapus info satuan asli karena jumlah sudah diedit langsung dalam satuan dasar
  delete log.satuanAsli; delete log.jumlahAsli; delete log.isiAsli;
  saveDB();
  renderRiwayatStok();
  renderDaftarBarang();
  renderLaporanStok();
  renderDashboard();
  showToast('Riwayat stok berhasil diperbarui');
}

function hapusStokLog(id){
  const log = db.stokLog.find(x=>x.id===id);
  if(!log){ showToast('Riwayat stok tidak ditemukan'); return; }
  if(!confirm('Hapus riwayat stok "'+log.nama+'" ('+(log.jenis==='masuk'?'masuk':'keluar')+' '+log.jumlah+')? Stok barang akan disesuaikan kembali. (Bisa dipulihkan lewat menu Sampah)')) return;
  buangKeSampah('stokLog', log, log.nama+' — '+(log.jenis==='masuk'?'masuk':'keluar')+' '+log.jumlah);
  const b = db.barang.find(x=>x.id===log.barangId);
  if(b){
    if(log.jenis==='masuk') b.stok -= log.jumlah; else b.stok += log.jumlah;
    if(b.stok<0) b.stok = 0;
  }
  db.stokLog = db.stokLog.filter(x=>x.id!==id);
  saveDB();
  renderRiwayatStok();
  renderDaftarBarang();
  renderLaporanStok();
  renderDashboard();
  renderSampah();
  showToast('Riwayat stok dihapus, stok barang disesuaikan. Bisa dipulihkan lewat menu Sampah.');
}

/* ============ DASHBOARD ============ */
function renderDashboard(){
  const today = todayStr();
  const trxHariIni = db.transaksi.filter(t=>tanggalLokal(t.waktu)===today);
  const omsetHariIni = trxHariIni.reduce((s,t)=>s+t.total,0);
  const untungHariIni = trxHariIni.reduce((s,t)=>s+(t.total-t.modal),0);

  document.getElementById('stOmsetHariIni').textContent = rupiah(omsetHariIni);
  document.getElementById('stTrxHariIni').textContent = trxHariIni.length + ' transaksi';
  document.getElementById('stUntungHariIni').textContent = rupiah(untungHariIni);

  const map = getHutangPerPelanggan();
  let hutangAktif = 0, jmlPelangganHutang = 0;
  Object.keys(map).forEach(n=>{
    const sisa = map[n].total - map[n].dibayar;
    if(sisa>0){ hutangAktif += sisa; jmlPelangganHutang++; }
  });
  document.getElementById('stHutangAktif').textContent = rupiah(hutangAktif);
  document.getElementById('stJmlPelangganHutang').textContent = jmlPelangganHutang + ' pelanggan';

  const stokMenipis = db.barang.filter(b=>b.stok<=b.stokMin);
  document.getElementById('stStokMenipis').textContent = stokMenipis.length;

  // transaksi terbaru
  const terbaru = [...db.transaksi].sort((a,b)=>new Date(b.waktu)-new Date(a.waktu)).slice(0,6);
  const tbTrx = document.getElementById('tblTrxTerbaru');
  tbTrx.innerHTML = terbaru.length ? terbaru.map(t=>`<tr>
    <td>${fmtWaktu(t.waktu)}</td><td>${escHtml(t.pelanggan)}</td>
    <td>${t.jenis==='cash'?'Cash':'Hutang'}</td><td>${rupiah(t.total)}</td>
  </tr>`).join('') : `<tr><td colspan="4"><div class="empty-state">
    <div class="empty-icon-circle"><svg class="icon-svg"><use href="#ic-cart"/></svg></div>
    <div class="empty-title">Belum ada transaksi</div>
    <div class="empty-sub">Transaksi terbaru akan muncul di sini.</div>
  </div></td></tr>`;

  const tbStok = document.getElementById('tblStokMenipis');
  tbStok.innerHTML = stokMenipis.length ? stokMenipis.slice(0,6).map(b=>`<tr>
    <td>${escHtml(b.nama)}</td><td>${b.stok} ${escHtml(b.satuan)}</td>
  </tr>`).join('') : `<tr><td colspan="2"><div class="empty-state">
    <div class="empty-icon-circle"><svg class="icon-svg"><use href="#ic-box"/></svg></div>
    <div class="empty-title">Stok semua barang aman</div>
    <div class="empty-sub">Tidak ada stok yang berada di bawah batas minimum.</div>
  </div></td></tr>`;
}

/* ============ LAPORAN ============ */
let periodeAktif = { penjualan:'harian', untung:'harian' };

function setPeriodeLaporan(jenis, periode, el){
  periodeAktif[jenis] = periode;
  el.parentElement.querySelectorAll('.pill-tab').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  if(jenis==='penjualan') renderLaporanPenjualan();
  if(jenis==='untung') renderLaporanUntung();
}

function filterByPeriode(list, periode){
  const today = todayStr();
  const thisMonth = today.slice(0,7);
  if(periode==='harian') return list.filter(t=>tanggalLokal(t.waktu)===today);
  if(periode==='bulanan') return list.filter(t=>tanggalLokal(t.waktu).slice(0,7)===thisMonth);
  return list;
}

function renderLaporanPenjualan(){
  const periode = periodeAktif.penjualan;
  const list = filterByPeriode(db.transaksi, periode).sort((a,b)=>new Date(b.waktu)-new Date(a.waktu));
  const omset = list.reduce((s,t)=>s+t.total,0);
  document.getElementById('lapPenjualanOmset').textContent = rupiah(omset);
  document.getElementById('lapPenjualanJumlah').textContent = list.length;
  document.getElementById('lapPenjualanRata').textContent = rupiah(list.length ? omset/list.length : 0);

  const tbody = document.getElementById('tblLapPenjualan');
  tbody.innerHTML = list.length ? list.map(t=>`<tr>
    <td>${fmtWaktu(t.waktu)}</td><td>${escHtml(t.pelanggan)}</td>
    <td>${t.jenis==='cash'?'Cash':'Hutang'}</td><td>${rupiah(t.total)}</td>
  </tr>`).join('') : '<tr><td colspan="4"><div class="empty-state">Tidak ada data pada periode ini</div></td></tr>';
}

function renderLaporanHutang(){
  const map = getHutangPerPelanggan();
  let totalHutang=0, totalDibayar=0;
  Object.values(map).forEach(d=>{ totalHutang+=d.total; totalDibayar+=d.dibayar; });
  document.getElementById('lapHutangTotal').textContent = rupiah(totalHutang);
  document.getElementById('lapHutangDibayar').textContent = rupiah(totalDibayar);
  document.getElementById('lapHutangSisa').textContent = rupiah(Math.max(totalHutang-totalDibayar,0));

  const tbody = document.getElementById('tblLapHutang');
  const names = Object.keys(map);
  tbody.innerHTML = names.length ? names.map(n=>{
    const d = map[n]; const sisa = d.total-d.dibayar;
    return `<tr>
      <td>${escHtml(n)}</td><td>${rupiah(d.total)}</td><td>${rupiah(d.dibayar)}</td>
      <td>${rupiah(Math.max(sisa,0))}</td>
      <td>${sisa<=0?'<span class="badge badge-lunas">Lunas</span>':'<span class="badge badge-belum">Belum Lunas</span>'}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="5"><div class="empty-state">Belum ada data hutang</div></td></tr>';
}

function renderLaporanStok(){
  const tbody = document.getElementById('tblLapStok');
  if(db.barang.length===0){
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">Belum ada barang</div></td></tr>';
    return;
  }
  tbody.innerHTML = db.barang.map(b=>{
    const low = b.stok<=b.stokMin;
    return `<tr>
      <td>${escHtml(b.nama)}</td><td>${b.stok} ${escHtml(b.satuan)}</td><td>${b.stokMin}</td>
      <td>${low?'<span class="badge badge-low">Menipis</span>':'<span class="badge badge-ok">Aman</span>'}</td>
      <td>${rupiah(b.stok*b.hargaBeli)}</td>
    </tr>`;
  }).join('');
}

function renderLaporanUntung(){
  const periode = periodeAktif.untung;
  const list = filterByPeriode(db.transaksi, periode).sort((a,b)=>new Date(b.waktu)-new Date(a.waktu));
  const omset = list.reduce((s,t)=>s+t.total,0);
  const modal = list.reduce((s,t)=>s+t.modal,0);
  document.getElementById('lapUntungOmset').textContent = rupiah(omset);
  document.getElementById('lapUntungModal').textContent = rupiah(modal);
  document.getElementById('lapUntungLaba').textContent = rupiah(omset-modal);

  const tbody = document.getElementById('tblLapUntung');
  tbody.innerHTML = list.length ? list.map(t=>`<tr>
    <td>${fmtWaktu(t.waktu)}</td><td>${rupiah(t.total)}</td><td>${rupiah(t.modal)}</td><td>${rupiah(t.total-t.modal)}</td>
  </tr>`).join('') : '<tr><td colspan="4"><div class="empty-state">Tidak ada data pada periode ini</div></td></tr>';
}

/* ============ BACKUP & RESTORE ============ */
const BACKUP_KEY = 'koperasiCemaruLestariLastBackup_v1';
const BACKUP_KEY_LAMA = 'warungBerkahLastBackup_v1';
function migrasiBackupKeyLama(){
  if(localStorage.getItem(BACKUP_KEY)===null && localStorage.getItem(BACKUP_KEY_LAMA)!==null){
    localStorage.setItem(BACKUP_KEY, localStorage.getItem(BACKUP_KEY_LAMA));
    localStorage.removeItem(BACKUP_KEY_LAMA);
  }
}

function pad2(n){ return n.toString().padStart(2,'0'); }
function namaFileBackup(ext){
  const d = new Date();
  const tgl = d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate())+'_'+pad2(d.getHours())+pad2(d.getMinutes());
  return 'koperasi-cemaru-lestari-backup_'+tgl+'.'+ext;
}
function unduhFile(filename, content, mime){
  const blob = new Blob([content], {type: mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}
function tandaiBackupTerakhir(){
  localStorage.setItem(BACKUP_KEY, new Date().toISOString());
}
function renderBackupInfo(){
  document.getElementById('bkJmlBarang').textContent = db.barang.length;
  document.getElementById('bkJmlTransaksi').textContent = db.transaksi.length;
  document.getElementById('bkJmlBayar').textContent = db.pembayaranHutang.length;
  document.getElementById('bkJmlStokLog').textContent = db.stokLog.length;
  const last = localStorage.getItem(BACKUP_KEY);
  document.getElementById('bkInfoTerakhir').textContent = last
    ? 'Backup terakhir: ' + fmtWaktu(last)
    : 'Belum pernah backup sejak data ini dibuat.';
}

function exportJSON(){
  const payload = {
    aplikasi: 'Koperasi PT. Cemaru Lestari',
    versi: 1,
    diekspor: new Date().toISOString(),
    data: db
  };
  unduhFile(namaFileBackup('json'), JSON.stringify(payload, null, 2), 'application/json');
  tandaiBackupTerakhir();
  renderBackupInfo();
  showToast('Backup JSON berhasil diunduh');
}

function escXml(v){
  return String(v==null?'':v).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
}
function xmlSheet(nama, header, rows){
  let out = '<Worksheet ss:Name="'+escXml(nama)+'"><Table>';
  out += '<Row>'+header.map(h=>'<Cell><Data ss:Type="String">'+escXml(h)+'</Data></Cell>').join('')+'</Row>';
  rows.forEach(r=>{
    out += '<Row>'+r.map(c=>{
      const isNum = typeof c === 'number';
      return '<Cell><Data ss:Type="'+(isNum?'Number':'String')+'">'+escXml(c)+'</Data></Cell>';
    }).join('')+'</Row>';
  });
  out += '</Table></Worksheet>';
  return out;
}
function exportExcel(){
  const sheetBarang = xmlSheet('Barang',
    ['Nama','Kategori','Harga Beli','Harga Jual','Stok','Satuan','Stok Minimum'],
    db.barang.map(b=>[b.nama,b.kategori||'-',b.hargaBeli,b.hargaJual,b.stok,b.satuan||'-',b.stokMin])
  );
  const sheetTransaksi = xmlSheet('Transaksi',
    ['Waktu','Pelanggan','Jenis','Total','Modal','Diterima'],
    db.transaksi.map(t=>[fmtWaktu(t.waktu),t.pelanggan||'-',t.jenis,t.total,t.modal,t.diterima||0])
  );
  const sheetBayar = xmlSheet('Pembayaran Hutang',
    ['Waktu','Pelanggan','Jumlah'],
    db.pembayaranHutang.map(p=>[fmtWaktu(p.waktu),p.pelanggan,p.jumlah])
  );
  const sheetStok = xmlSheet('Riwayat Stok',
    ['Waktu','Barang','Jenis','Jumlah','Keterangan'],
    db.stokLog.map(s=>[fmtWaktu(s.waktu),s.nama,s.jenis,s.jumlah,s.keterangan||'-'])
  );

  // Sheet ringkasan keuntungan: total harian
  const perHari = {}; // 'YYYY-MM-DD' -> {omset, modal}
  db.transaksi.forEach(t=>{
    const tgl = tanggalLokal(t.waktu);
    if(!perHari[tgl]) perHari[tgl] = {omset:0, modal:0};
    perHari[tgl].omset += t.total;
    perHari[tgl].modal += t.modal;
  });
  const tglUrut = Object.keys(perHari).sort();
  const totalOmsetSemua = db.transaksi.reduce((s,t)=>s+t.total,0);
  const totalModalSemua = db.transaksi.reduce((s,t)=>s+t.modal,0);
  const sheetUntung = xmlSheet('Ringkasan Keuntungan',
    ['Tanggal','Omset','Modal','Keuntungan'],
    [
      ...tglUrut.map(tgl=>[tgl, perHari[tgl].omset, perHari[tgl].modal, perHari[tgl].omset-perHari[tgl].modal]),
      ['TOTAL', totalOmsetSemua, totalModalSemua, totalOmsetSemua-totalModalSemua]
    ]
  );

  const xml = '<?xml version="1.0"?>'+
    '<?mso-application progid="Excel.Sheet"?>'+
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" '+
    'xmlns:o="urn:schemas-microsoft-com:office:office" '+
    'xmlns:x="urn:schemas-microsoft-com:office:excel" '+
    'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'+
    sheetBarang + sheetTransaksi + sheetBayar + sheetStok + sheetUntung +
    '</Workbook>';
  unduhFile(namaFileBackup('xls'), xml, 'application/vnd.ms-excel');
  showToast('File Excel berhasil diunduh (cek folder Download)');
}

function importJSON(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = function(ev){
    let parsed;
    try{
      parsed = JSON.parse(ev.target.result);
    }catch(err){
      showToast('File tidak valid / bukan format JSON yang benar');
      e.target.value = '';
      return;
    }
    const data = parsed && parsed.data ? parsed.data : parsed;
    if(!data || !Array.isArray(data.barang) || !Array.isArray(data.transaksi)){
      showToast('Struktur data dalam file ini tidak dikenali');
      e.target.value = '';
      return;
    }
    if(!confirm('Pulihkan data dari file ini akan MENGGANTI seluruh data yang ada sekarang ('+db.barang.length+' barang, '+db.transaksi.length+' transaksi, dll). Lanjutkan?')) {
      e.target.value = '';
      return;
    }
    db = {
      barang: data.barang || [],
      transaksi: data.transaksi || [],
      pembayaranHutang: data.pembayaranHutang || [],
      stokLog: data.stokLog || [],
      sampah: data.sampah || []
    };
    pastikanStrukturDB();
    migrasiNormalisasiPelanggan();
    saveDB();
    e.target.value = '';
    showToast('Data berhasil dipulihkan dari backup');
    renderBackupInfo();
    renderDaftarKategori();
    renderAllForSection('backup');
  };
  reader.onerror = function(){
    showToast('Gagal membaca file');
    e.target.value = '';
  };
  reader.readAsText(file);
}

/* ============ RESET DATA ============ */
function resetAllData(){
  if(!confirm('Yakin ingin menghapus SEMUA data koperasi (barang, transaksi, hutang, stok)? Tindakan ini tidak dapat dibatalkan dan TIDAK bisa dipulihkan lewat menu Sampah.')) return;
  if(!cekPINAksi('Reset Semua Data')) return;
  if(!confirm('Konfirmasi terakhir: data akan dihapus permanen sekarang. Lanjutkan?')) return;
  localStorage.removeItem(DB_KEY);
  db = { barang:[], transaksi:[], pembayaranHutang:[], stokLog:[], sampah:[] };
  showToast('Semua data telah dihapus');
  renderAllForSection('dashboard');
  showSection('dashboard', document.querySelector('.nav-item.dash'));
}

/* ============ INIT ============ */
function seedContohData(){
  if(db.barang.length>0) return; // jangan timpa data yang sudah ada
  db.barang = [
    {id:uid(), nama:'Indomie Goreng', kategori:'Makanan Instan', hargaBeli:3000, hargaJual:3500, stok:120, satuan:'bungkus', stokMin:5},
    {id:uid(), nama:'Beras 5kg', kategori:'Sembako', hargaBeli:58000, hargaJual:63000, stok:14, satuan:'karung', stokMin:3},
    {id:uid(), nama:'Telur Ayam', kategori:'Sembako', hargaBeli:2200, hargaJual:2700, stok:53, satuan:'butir', stokMin:20},
    {id:uid(), nama:'Air Mineral 600ml', kategori:'Minuman', hargaBeli:2500, hargaJual:3500, stok:100, satuan:'botol', stokMin:10},
    {id:uid(), nama:'Gula Pasir 1kg', kategori:'Sembako', hargaBeli:14000, hargaJual:16000, stok:20, satuan:'kg', stokMin:5},
    {id:uid(), nama:'Mie Soto', kategori:'Makanan Instan', hargaBeli:2500, hargaJual:3000, stok:50, satuan:'bungkus', stokMin:5},
    {id:uid(), nama:'Ajinomoto', kategori:'Bumbu Masak', hargaBeli:2700, hargaJual:3000, stok:20, satuan:'pcs', stokMin:5},
  ];
  saveDB();
}

async function initApp(){
  migrasiPINLama();
  migrasiBackupKeyLama();
  await pastikanAdminAwal();

  loadDB();
  if(db.barang.length===0 && db.transaksi.length===0){
    seedContohData();
  }
  migrasiNormalisasiPelanggan();
  renderAdminBar();

  if(isLoggedIn()){
    tampilkanApp();
    tickClock();
    renderDashboard();
    renderDaftarKategori();
    renderDaftarPelangganDatalist();
  } else {
    tampilkanLoginScreen();
  }
}
initApp();
