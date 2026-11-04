/**
 * 訂房小幫手 — Google 試算表同步（Google Apps Script）
 * 貼到「試算表 → 擴充功能 → Apps Script」，依說明部署為網頁應用程式。
 * 資料表：「訂單」「入住登記」會自動建立。
 */
var BOOK_HEAD = ['id', 'room', 'who', 'phone', 'n', 'from', 'to', 'price', 'deposit', 'src', 'note', 'checked', 'deleted', 'updatedAt', 'paid', 'bookedOn', 'warn'];
var CI_HEAD = ['bookingId', 'ts', 'checkout', 'name', 'idno', 'birth', 'phone', 'plate', 'addr', 'note', 'companions', 'rooms'];
// 房間清單（唯讀「房況摘要」用）：k 要和 App 裡的房間代號一致
var ROOMS_ = [
  { k: 'tc202', name: '藍徑 202', cap: 2 },
  { k: 'tc301', name: '夕映 301', cap: 4 },
  { k: 'tc302', name: '山嵐 302', cap: 4 }
];
var KEEP_DAYS = 183; // 民宿管理辦法第 28 條：登記資料保存 6 個月

function sheet_(name, head) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s = ss.getSheetByName(name);
  if (!s) {
    s = ss.insertSheet(name);
    s.getRange(1, 1, 1, head.length).setValues([head]);
    s.setFrozenRows(1);
    // 全部存成純文字，避免日期、電話被試算表自動轉換
    s.getRange(1, 1, s.getMaxRows(), head.length).setNumberFormat('@');
  } else if (s.getLastColumn() < head.length) {
    // 之後新增欄位時，自動補上標題列
    s.getRange(1, 1, 1, head.length).setValues([head]);
    s.getRange(1, 1, s.getMaxRows(), head.length).setNumberFormat('@');
  }
  return s;
}

function d_(v) {
  return v instanceof Date ? Utilities.formatDate(v, 'Asia/Taipei', 'yyyy-MM-dd') : String(v);
}

function put_(sh, rec) {
  var r = sh.getRange(sh.getLastRow() + 1, 1, 1, rec.length);
  r.setNumberFormat('@');
  r.setValues([rec]);
}

function ph_(v) {
  var s = String(v == null ? '' : v).replace(/\D/g, '');
  return s && s.charAt(0) !== '0' ? '0' + s : s;
}

var HIST_HEAD = ['時間', '動作', 'id', '房間', '姓名', '電話', '入住', '退房', '房價', '訂金', '改了什麼'];
var FIELDS_ = [['room', 1], ['who', 2], ['phone', 3], ['n', 4], ['from', 5], ['to', 6], ['price', 7], ['deposit', 8], ['src', 9], ['note', 10], ['checked', 11], ['paid', 14], ['bookedOn', 15], ['warn', 16]];
function cs2_() { return sheet_('已取消', BOOK_HEAD); }
function hist_() { return sheet_('歷程', HIST_HEAD); }
function pad_(v) { v = v.slice(); while (v.length < BOOK_HEAD.length) v.push(''); return v; }
function write_(sh, head, rows) {
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, sh.getMaxColumns()).clearContent();
  if (!rows.length) return;
  if (sh.getMaxRows() < rows.length + 1) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
  var rg = sh.getRange(2, 1, rows.length, head.length);
  rg.setNumberFormat('@'); rg.setValues(rows);
}
function diff_(a, b) {
  a = pad_(a); b = pad_(b);
  var names = { room: '房間', who: '姓名', phone: '電話', n: '人數', from: '入住', to: '退房', price: '房價', deposit: '訂金', src: '管道', note: '備註', checked: '登記', paid: '尾款', bookedOn: '預訂日', warn: '注意' };
  var out = [];
  FIELDS_.forEach(function (f) {
    var x = f[0] === 'from' || f[0] === 'to' ? d_(a[f[1]]) : String(a[f[1]]);
    var y = f[0] === 'from' || f[0] === 'to' ? d_(b[f[1]]) : String(b[f[1]]);
    if (f[0] === 'phone') { x = ph_(x); y = ph_(y); }
    if (x !== y) out.push(['who', 'phone', 'note', 'warn'].indexOf(f[0]) >= 0 ? names[f[0]] + '已更改' : names[f[0]] + '：' + x + ' → ' + y);
  });
  return out.join('；');
}
function log_(now, act, v, ch) {
  return [now, act, String(v[0]), v[1], v[2], ph_(v[3]), d_(v[5]), d_(v[6]), String(v[7]), String(v[8]), ch];
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return out_({ ok: true, msg: '訂房小幫手同步服務運作中' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var body = JSON.parse(e.postData.contents);
    var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token) return out_({ ok: false, error: '還沒在指令碼設定密碼（TOKEN）' });
    if (body.token !== token) return out_({ ok: false, error: '密碼不對' });

    if (body.action === 'summary') return out_(summary_(body.today));
    if (body.action === 'changes') return out_(changes_(body.since));

    var bs = sheet_('訂單', BOOK_HEAD);
    var cs = sheet_('入住登記', CI_HEAD);
    if (bs.getLastColumn() < BOOK_HEAD.length) {
      bs.getRange(1, 1, 1, BOOK_HEAD.length).setValues([BOOK_HEAD]);
      bs.getRange(1, 1, bs.getMaxRows(), BOOK_HEAD.length).setNumberFormat('@');
    }
    var props = PropertiesService.getScriptProperties();
    if (body.keep !== undefined) props.setProperty('KEEP_RETURNING', body.keep ? '1' : '');
    // 旅客要求刪除：依電話清掉入住登記
    var fg = (body.forget || []).map(ph_).filter(Boolean);
    if (fg.length) {
      var fd = cs.getDataRange().getValues();
      for (var q = fd.length - 1; q >= 1; q--) {
        if (fg.indexOf(ph_(fd[q][6])) >= 0) cs.deleteRow(q + 1);
      }
      var hs0 = hist_(), hd = hs0.getDataRange().getValues();
      for (var q2 = hd.length - 1; q2 >= 1; q2--) {
        if (fg.indexOf(ph_(hd[q2][5])) >= 0) hs0.deleteRow(q2 + 1);
      }
    }

    // ---- 訂單：以 id 合併，updatedAt 較新的蓋過舊的 ----
    // 「訂單」只放目前有效的訂單（現況）；取消的搬到「已取消」；每次新增／修改／取消都記在「歷程」
    var live = {}, gone = {};
    bs.getDataRange().getValues().slice(1).forEach(function (v) { if (v[0] !== '') (v[12] === '1' || v[12] === 1 ? gone : live)[String(v[0])] = v; });
    cs2_().getDataRange().getValues().slice(1).forEach(function (v) { if (v[0] !== '') gone[String(v[0])] = v; });
    var logs = [];
    var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
    (body.rows || []).forEach(function (r) {
      var id = String(r.id), ts = Number(r.updatedAt) || 0;
      var old = live[id] || gone[id] || null;
      if (old && ts < (Number(old[13]) || 0)) return; // 別人較新
      if (r.deleted) {
        if (live[id]) {
          var g = live[id].slice(); while (g.length < BOOK_HEAD.length) g.push('');
          g[12] = '1'; g[13] = String(ts || Date.now());
          gone[id] = g; delete live[id];
          logs.push(log_(now, '取消', g, ''));
        } else if (gone[id]) { gone[id][13] = String(ts || Date.now()); }
        return;
      }
      var rec = toRow_(r);
      if (live[id]) {
        var ch = diff_(live[id], rec);
        if (ch) logs.push(log_(now, '修改', rec, ch));
      } else if (gone[id]) {
        logs.push(log_(now, '復原', rec, ''));
      } else {
        logs.push(log_(now, '新增', rec, ''));
      }
      delete gone[id];
      live[id] = rec;
    });
    var liveRows = Object.keys(live).map(function (k) { return pad_(live[k]); })
      .sort(function (x, y) { return (d_(x[5]) + x[1]) < (d_(y[5]) + y[1]) ? -1 : 1; });
    var goneRows = Object.keys(gone).map(function (k) { return pad_(gone[k]); });
    write_(bs, BOOK_HEAD, liveRows);
    write_(cs2_(), BOOK_HEAD, goneRows);
    if (logs.length) {
      var hs = hist_();
      var hr = hs.getRange(hs.getLastRow() + 1, 1, logs.length, HIST_HEAD.length);
      hr.setNumberFormat('@'); hr.setValues(logs);
    }

    // ---- 入住登記：新增一筆就記一筆（同 bookingId + ts 不重複）----
    var seen = {};
    var cdata = cs.getDataRange().getValues();
    for (var j = 1; j < cdata.length; j++) seen[cdata[j][0] + '|' + cdata[j][1]] = 1;
    (body.checkins || []).forEach(function (c) {
      var key = c.bookingId + '|' + c.ts;
      if (seen[key]) return;
      put_(cs, [
        String(c.bookingId), String(c.ts), c.checkout || '', c.name || '', c.idno || '', c.birth || '',
        c.phone || '', c.plate || '', c.addr || '', c.note || '', JSON.stringify(c.companions || []), c.rooms || ''
      ]);
      seen[key] = 1;
    });

    // ---- 入住登記：每個 bookingId 回傳最新一筆，讓每支手機都看得到 ----
    var latest = {};
    cs.getDataRange().getValues().slice(1).forEach(function (v) {
      var id = String(v[0]);
      if (!latest[id] || Number(v[1]) > Number(latest[id][1])) latest[id] = v;
    });
    var regs = Object.keys(latest).map(function (k) {
      var v = latest[k], comp = [];
      try { comp = JSON.parse(v[10] || '[]'); } catch (e) {}
      return { bookingId: k, ts: Number(v[1]), checkout: d_(v[2]), name: String(v[3]), idno: String(v[4]), birth: String(v[5]),
        phone: ph_(v[6]), plate: String(v[7]), addr: String(v[8]), note: String(v[9]), companions: comp, rooms: String(v[11]) };
    });

    // ---- 回傳全部訂單 ----
    var rows = liveRows.concat(goneRows).map(fromRow_);
    return out_({ ok: true, rows: rows, regs: regs });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ---- 唯讀房況摘要：給生活指揮所用，不會改任何資料 ----
function addDay_(iso, n) {
  var p = iso.split('-');
  return Utilities.formatDate(new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)), 'UTC', 'yyyy-MM-dd');
}
function range_(rows, from, to) { // 區間 [from, to) 的賣出房晚、房價、訂金
  var nights = 0, rev = 0, dep = 0, avail = 0, d;
  for (d = from; d < to; d = addDay_(d, 1)) avail += ROOMS_.length;
  rows.forEach(function (b) {
    var s = b.from > from ? b.from : from, e = b.to < to ? b.to : to, n = 0;
    for (d = s; d < e; d = addDay_(d, 1)) n++;
    if (n > 0) { nights += n; rev += n * b.price; dep += b.deposit; }
  });
  return { from: from, to: to, nights_sold: nights, nights_available: avail,
    occupancy: avail ? Math.round(nights / avail * 1000) / 10 : 0,
    revenue_estimate: rev, deposit_received: dep, balance_due: Math.max(0, rev - dep) };
}
function summary_(todayIn) {
  var today = /^\d{4}-\d{2}-\d{2}$/.test(String(todayIn || '')) ? todayIn : Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  var rows = sheet_('訂單', BOOK_HEAD).getDataRange().getValues().slice(1)
    .map(fromRow_).filter(function (b) { return !b.deleted && b.room; });
  var label = {}; ROOMS_.forEach(function (r) { label[r.k] = r.name; });
  function groups(list) {
    var m = {}, out = [];
    list.forEach(function (b) {
      var k = [b.who, b.phone, b.from, b.to].join('|');
      if (!m[k]) { m[k] = { who: b.who || '', warn: b.warn || '', source: b.src || '', guests: 0, rooms: [], from: b.from, to: b.to, checked_in: true }; out.push(m[k]); }
      m[k].guests += b.n; m[k].rooms.push(label[b.room] || b.room); if (!b.checked) m[k].checked_in = false;
    });
    return out;
  }
  var ins = groups(rows.filter(function (b) { return b.from === today; }));
  var outs = groups(rows.filter(function (b) { return b.to === today; }));
  var stay = rows.filter(function (b) { return b.from <= today && today < b.to; });
  var used = {}; stay.forEach(function (b) { used[b.room] = 1; });
  var tomorrow = addDay_(today, 1);
  var usedT = {}; rows.forEach(function (b) { if (b.from <= tomorrow && tomorrow < b.to) usedT[b.room] = 1; });
  var ms = today.slice(0, 8) + '01', y = +today.slice(0, 4), mo = +today.slice(5, 7);
  var me = Utilities.formatDate(new Date(Date.UTC(y, mo, 1)), 'UTC', 'yyyy-MM-dd');
  var mm = range_(rows, ms, me); mm.month = today.slice(0, 7);
  return {
    ok: true, today: today, generated_at: Date.now(), total_rooms: ROOMS_.length,
    today_checkins: ins, today_checkouts: outs,
    occupied_tonight: ROOMS_.filter(function (r) { return used[r.k]; }).map(function (r) { return r.name; }),
    empty_tonight: ROOMS_.filter(function (r) { return !used[r.k]; }).map(function (r) { return r.name; }),
    empty_tomorrow: ROOMS_.filter(function (r) { return !usedT[r.k]; }).map(function (r) { return r.name; }),
    this_month: mm,
    next_30_days: range_(rows, today, addDay_(today, 30))
  };
}

function toRow_(r) {
  return [
    String(r.id), r.room || '', r.who || '', r.phone || '', String(r.n || 0), r.from || '', r.to || '',
    String(r.price || 0), String(r.deposit || 0), r.src || '', r.note || '',
    r.checked ? '1' : '', r.deleted ? '1' : '', String(r.updatedAt || Date.now()), r.paid ? '1' : '', r.bookedOn || '', r.warn || ''
  ];
}

function fromRow_(v) {
  return {
    id: Number(v[0]), room: v[1], who: v[2], phone: ph_(v[3]), n: Number(v[4]) || 0,
    from: d_(v[5]), to: d_(v[6]), price: Number(v[7]) || 0, deposit: Number(v[8]) || 0,
    src: v[9], note: v[10], checked: v[11] === '1' || v[11] === 1, deleted: v[12] === '1' || v[12] === 1,
    updatedAt: Number(v[13]) || 0, paid: v[14] === '1' || v[14] === 1,
    bookedOn: v[15] ? d_(v[15]) : '', warn: v[16] ? String(v[16]) : ''
  };
}

/** 每天自動執行：超過 6 個月的住客個資清掉 */
function purgeOld() {
  var cut = Utilities.formatDate(new Date(Date.now() - KEEP_DAYS * 864e5), 'Asia/Taipei', 'yyyy-MM-dd');
  var keepRet = PropertiesService.getScriptProperties().getProperty('KEEP_RETURNING') === '1';
  var cs = sheet_('入住登記', CI_HEAD);
  var cd = cs.getDataRange().getValues();
  for (var i = cd.length - 1; i >= 1; i--) {
    if (d_(cd[i][2]) && d_(cd[i][2]) < cut) cs.deleteRow(i + 1);
  }
  // 訂單、已取消：姓名電話備註依設定清掉；已取消的舊單直接刪
  [sheet_('訂單', BOOK_HEAD), cs2_()].forEach(function (bs) {
    var bd = bs.getDataRange().getValues();
    for (var j = bd.length - 1; j >= 1; j--) {
      var to = d_(bd[j][6]);
      if (!to || to >= cut) continue;
      if (bd[j][12] === '1' || bd[j][12] === 1) { bs.deleteRow(j + 1); continue; }
      if ((!keepRet && (bd[j][2] || bd[j][3])) || bd[j][10]) {
        if (!keepRet) bs.getRange(j + 1, 3, 1, 2).setValues([['', '']]);
        bs.getRange(j + 1, 11, 1, 1).setValues([['']]);
        bs.getRange(j + 1, 14, 1, 1).setValues([[String(Date.now())]]);
      }
    }
  });
  // 歷程：超過期限的整列刪掉（含姓名電話）；開啟保留回流客時只留 6 個月內
  var hs = hist_(), hd = hs.getDataRange().getValues();
  for (var k = hd.length - 1; k >= 1; k--) {
    var hday = String(hd[k][0]).slice(0, 10);
    if (hday && hday < cut) hs.deleteRow(k + 1);
  }
}

/** 只要執行一次：啟用每天凌晨自動清除 */
function enableAutoPurge() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'purgeOld') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('purgeOld').timeBased().everyDays(1).atHour(3).create();
}

// ---- 唯讀異動清單：給生活指揮所用，從「歷程」撈出指定時間之後的新增 / 取消 / 修改 ----
function changes_(sinceIn) {
  var since = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(String(sinceIn || '')) ? String(sinceIn) : '1970-01-01 00:00:00';
  var label = {}; ROOMS_.forEach(function (r) { label[r.k] = r.name; });
  var sh = hist_(), out = [];
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, HIST_HEAD.length).getValues().forEach(function (v) {
      var t = String(v[0]);
      if (t < since || ['新增', '取消', '復原', '修改'].indexOf(v[1]) < 0) return;
      out.push({ time: t, action: v[1], room: label[v[3]] || String(v[3]), who: String(v[4]), from: d_(v[6]), to: d_(v[7]), price: Number(v[8]) || 0, note: String(v[10] || '') });
    });
  }
  return { ok: true, since: since, changes: out };
}
