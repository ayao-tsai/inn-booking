/**
 * 訂房小幫手 — Google 試算表同步（Google Apps Script）
 * 貼到「試算表 → 擴充功能 → Apps Script」，依說明部署為網頁應用程式。
 * 資料表：「訂單」「入住登記」會自動建立。
 */
var BOOK_HEAD = ['id', 'room', 'who', 'phone', 'n', 'from', 'to', 'price', 'deposit', 'src', 'note', 'checked', 'deleted', 'updatedAt', 'paid'];
var CI_HEAD = ['bookingId', 'ts', 'checkout', 'name', 'idno', 'birth', 'phone', 'plate', 'addr', 'note', 'companions', 'rooms'];
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
var FIELDS_ = [['room', 1], ['who', 2], ['phone', 3], ['n', 4], ['from', 5], ['to', 6], ['price', 7], ['deposit', 8], ['src', 9], ['note', 10], ['checked', 11], ['paid', 14]];
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
  var names = { room: '房間', who: '姓名', phone: '電話', n: '人數', from: '入住', to: '退房', price: '房價', deposit: '訂金', src: '管道', note: '備註', checked: '登記', paid: '尾款' };
  var out = [];
  FIELDS_.forEach(function (f) {
    var x = f[0] === 'from' || f[0] === 'to' ? d_(a[f[1]]) : String(a[f[1]]);
    var y = f[0] === 'from' || f[0] === 'to' ? d_(b[f[1]]) : String(b[f[1]]);
    if (f[0] === 'phone') { x = ph_(x); y = ph_(y); }
    if (x !== y) out.push(['who', 'phone', 'note'].indexOf(f[0]) >= 0 ? names[f[0]] + '已更改' : names[f[0]] + '：' + x + ' → ' + y);
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

    // ---- 回傳全部訂單 ----
    var rows = liveRows.concat(goneRows).map(fromRow_);
    return out_({ ok: true, rows: rows });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function toRow_(r) {
  return [
    String(r.id), r.room || '', r.who || '', r.phone || '', String(r.n || 0), r.from || '', r.to || '',
    String(r.price || 0), String(r.deposit || 0), r.src || '', r.note || '',
    r.checked ? '1' : '', r.deleted ? '1' : '', String(r.updatedAt || Date.now()), r.paid ? '1' : ''
  ];
}

function fromRow_(v) {
  return {
    id: Number(v[0]), room: v[1], who: v[2], phone: ph_(v[3]), n: Number(v[4]) || 0,
    from: d_(v[5]), to: d_(v[6]), price: Number(v[7]) || 0, deposit: Number(v[8]) || 0,
    src: v[9], note: v[10], checked: v[11] === '1' || v[11] === 1, deleted: v[12] === '1' || v[12] === 1,
    updatedAt: Number(v[13]) || 0, paid: v[14] === '1' || v[14] === 1
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
