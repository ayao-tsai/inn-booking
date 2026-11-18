// 後端測試：在 Node 裡模擬 Apps Script（試算表、指令碼屬性、鎖），直接執行根目錄的 Code.gs。
// 執行：node test/server.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

class Sheet {
  constructor() { this.d = []; }
  getLastRow() { return this.d.length; }
  getLastColumn() { return Math.max(0, ...this.d.map((r) => r.length)); }
  getMaxRows() { return 1000; }
  getMaxColumns() { return 30; }
  getDataRange() { return { getValues: () => this.d.map((r) => r.slice()) }; }
  getRange(r, c, nr, nc) {
    const s = this;
    return {
      setValues(v) { v.forEach((row, i) => { s.d[r - 1 + i] = s.d[r - 1 + i] || []; row.forEach((x, j) => (s.d[r - 1 + i][c - 1 + j] = x)); }); },
      getValues() { return s.d.slice(r - 1, r - 1 + nr).map((row) => { const o = row.slice(c - 1, c - 1 + nc); while (o.length < nc) o.push(""); return o; }); },
      setNumberFormat() {}, clearContent() { s.d.length = Math.max(1, r - 1); },
    };
  }
  setFrozenRows() {} insertRowsAfter() {}
  deleteRow(i) { this.d.splice(i - 1, 1); }
}
const sheets = {};
const book = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = new Sheet()) };
const props = { TOKEN: "t" };
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => book, openById: () => book },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => (props[k] = v) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { createTextOutput: (s) => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 1 } },
  Utilities: { formatDate: (d, tz, f) => { const t = new Date(new Date(d).getTime() + (tz === "UTC" ? 0 : 8 * 3600e3)); return t.toISOString().replace("T", " ").slice(0, f.length); } },
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased() { return this; }, everyDays() { return this; }, atHour() { return this; }, create() {} }) },
  JSON, Date, Math, String, Number, Object, Array, RegExp,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL("../Code.gs", import.meta.url), "utf8"), ctx);
const post = (b) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ token: "t" }, b)) } }).s);
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const row = (o) => Object.assign({ id: 1, room: "tc202", who: "測試甲", phone: "0911000001", n: 2, from: day(-3), to: day(-5), price: 2200, deposit: 1000, src: "電話", note: "", checked: false, deleted: false, updatedAt: 10, paid: false, bookedOn: day(0), warn: "" }, o);

let r = post({ token: "wrong", action: "sync" });
assert.equal(r.ok, false, "wrong token rejected");

// 訂單：新增、修改、取消都進「歷程」
r = post({ action: "sync", rows: [row({}), row({ id: 2, room: "tc301", who: "測試乙", phone: "0911000002" })] });
assert.ok(r.ok && r.rows.length === 2, "two orders stored");
post({ action: "sync", rows: [row({ price: 2400, updatedAt: 20 })] });
post({ action: "sync", rows: [row({ id: 2, room: "tc301", deleted: true, updatedAt: 30 })] });
assert.equal(sheets["訂單"].d.length - 1, 1, "cancelled order moved out");
assert.equal(sheets["已取消"].d.length - 1, 1, "cancelled order kept in 已取消");
const acts = sheets["歷程"].d.slice(1).map((v) => v[1]).join(",");
assert.equal(acts, "新增,新增,修改,取消", "history log");
r = post({ action: "sync", rows: [row({ price: 1, updatedAt: 5 })] });
assert.equal(r.rows.find((x) => x.id === 1).price, 2400, "older write loses (last write wins)");

// 入住登記：新欄位（住宿目的、年齡、縣市、入住日）會存也會回傳
r = post({ action: "sync", checkins: [{ bookingId: 1, ts: 100, checkout: day(-5), ci: day(-3), name: "測試甲", idno: "A1", birth: "民國 80 年 1 月 1 日", phone: "0911000001", plate: "AAA-0001", addr: "臺南市中西區", note: "", companions: [{ name: "同行一", idno: "B1", birth: "民國 85 年 2 月 2 日" }], rooms: "藍徑 202", purpose: "其他", purposeNote: "探親", age: 35, city: "臺南市" }] });
const g = r.regs.find((x) => x.bookingId === "1");
assert.equal(sheets["入住登記"].d[0].length, 17, "check-in header has 17 columns");
assert.ok(g && g.purpose === "其他" && g.purposeNote === "探親" && g.age === 35 && g.city === "臺南市" && g.companions.length === 1, JSON.stringify(g));

// 分段清除：6 個月刪證件與生日、2 年只留統計
const cs = sheets["入住登記"];
cs.d.push(["90", "1", day(300), "半年前", "C1", "民國 70 年 5 月 5 日", "0922", "P", "台北市大安區", "", '[{"name":"伴","idno":"D1","birth":"民國 72 年 1 月 1 日"}]', "夕映 301"]);
cs.d.push(["91", "2", day(800), "兩年前", "E1", "民國 60 年 1 月 1 日", "0933", "Q", "高雄縣鳳山區", "", "[]", "山嵐 302"]);
ctx.purgeOld();
const half = cs.d.find((v) => v[0] === "90"), old = cs.d.find((v) => v[0] === "91");
assert.ok(half[3] === "半年前" && half[4] === "" && half[5] === "" && half[8] === "台北市大安區", "6 months: id and birthday removed, rest kept");
assert.ok(JSON.parse(half[10])[0].idno === "" && JSON.parse(half[10])[0].name === "伴", "6 months: companion id removed");
assert.ok(half[15] === "臺北市" && half[14] !== "", "6 months: city and age computed before removal");
assert.ok(old[3] === "" && old[6] === "" && old[8] === "" && old[15] === "高雄市" && old[14] !== "", "2 years: only statistics left");

// 唯讀動作
const s = post({ action: "summary" });
assert.ok(s.ok && s.total_rooms === 3 && s.this_month, "summary");
const c = post({ action: "changes", since: "2000-01-01 00:00" });
assert.ok(c.ok && c.changes.length === 4, "changes lists history");

// 縣市、年齡判斷
assert.equal(ctx.cityOf_("900屏東縣屏東市"), "屏東縣");
assert.equal(ctx.cityOf_("台中西屯"), "臺中市");
assert.equal(ctx.cityOf_("臺北縣板橋"), "新北市");
assert.equal(ctx.cityOf_("新竹"), "");
assert.equal(ctx.cityOf_("Tokyo"), "國外");
assert.equal(ctx.ageFrom_("民國 82 年 6 月 14 日", "2026-06-13"), 32);
console.log("server: all passed");
