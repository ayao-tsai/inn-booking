/**
 * 訂房小幫手 — Google 試算表同步（Google Apps Script）
 * 貼到「試算表 → 擴充功能 → Apps Script」，依說明部署為網頁應用程式。
 * 資料表：「訂單」「入住登記」會自動建立。
 */
var BOOK_HEAD = ['id', 'room', 'who', 'phone', 'n', 'from', 'to', 'price', 'deposit', 'src', 'note', 'checked', 'deleted', 'updatedAt'];
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

    // ---- 訂單：以 id 合併，updatedAt 較新的蓋過舊的 ----
    var data = bs.getDataRange().getValues();
    var index = {}; // id -> 列號(1 起算)
    var current = {}; // id -> updatedAt
    for (var i = 1; i < data.length; i++) {
      index[String(data[i][0])] = i + 1;
      current[String(data[i][0])] = Number(data[i][13]) || 0;
    }
    (body.rows || []).forEach(function (r) {
      var id = String(r.id);
      if (id in index && (Number(r.updatedAt) || 0) < current[id]) return; // 別人較新
      var old = id in index ? data[index[id] - 1] : null;
      var rec = r.deleted && old ? old.slice() : toRow_(r);
      if (r.deleted) {
        rec[12] = '1';
        rec[13] = String(r.updatedAt || Date.now());
      }
      if (id in index) {
        bs.getRange(index[id], 1, 1, BOOK_HEAD.length).setValues([rec]);
        data[index[id] - 1] = rec;
      } else {
        put_(bs, rec);
        data.push(rec);
        index[id] = data.length;
      }
      current[id] = Number(rec[13]) || 0;
    });

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
    var all = bs.getDataRange().getValues();
    var rows = [];
    for (var k = 1; k < all.length; k++) rows.push(fromRow_(all[k]));
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
    r.checked ? '1' : '', r.deleted ? '1' : '', String(r.updatedAt || Date.now())
  ];
}

function fromRow_(v) {
  return {
    id: Number(v[0]), room: v[1], who: v[2], phone: String(v[3]), n: Number(v[4]) || 0,
    from: d_(v[5]), to: d_(v[6]), price: Number(v[7]) || 0, deposit: Number(v[8]) || 0,
    src: v[9], note: v[10], checked: v[11] === '1' || v[11] === 1, deleted: v[12] === '1' || v[12] === 1,
    updatedAt: Number(v[13]) || 0
  };
}

/** 每天自動執行：超過 6 個月的住客個資清掉 */
function purgeOld() {
  var cut = Utilities.formatDate(new Date(Date.now() - KEEP_DAYS * 864e5), 'Asia/Taipei', 'yyyy-MM-dd');
  var cs = sheet_('入住登記', CI_HEAD);
  var cd = cs.getDataRange().getValues();
  for (var i = cd.length - 1; i >= 1; i--) {
    if (d_(cd[i][2]) && d_(cd[i][2]) < cut) cs.deleteRow(i + 1);
  }
  var bs = sheet_('訂單', BOOK_HEAD);
  var bd = bs.getDataRange().getValues();
  for (var j = bd.length - 1; j >= 1; j--) {
    var to = d_(bd[j][6]);
    if (to && to < cut) {
      if (bd[j][12] === '1') { bs.deleteRow(j + 1); continue; } // 已取消的舊訂單直接刪
      if (bd[j][2] || bd[j][3] || bd[j][10]) {
        // 只留日期、房間、金額；姓名、電話、備註清掉
        bs.getRange(j + 1, 3, 1, 2).setValues([['', '']]);
        bs.getRange(j + 1, 11, 1, 1).setValues([['']]);
        bs.getRange(j + 1, 14, 1, 1).setValues([[String(Date.now())]]);
      }
    }
  }
}

/** 只要執行一次：啟用每天凌晨自動清除 */
function enableAutoPurge() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'purgeOld') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('purgeOld').timeBased().everyDays(1).atHour(3).create();
}
