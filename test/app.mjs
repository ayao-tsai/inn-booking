// 畫面測試：用 Playwright 打開 tracover/index.html，同步網址改成假的後端（記得住推上來的訂單與登記）。
// 執行：PW_PATH=$(npm root -g)/playwright node test/app.mjs
// 資料全是假資料。時間固定在 2026-11-15 15:00（台北）。
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || "playwright");
const APP = new URL("../tracover/index.html", import.meta.url).href;
const KEY = "tracover_data_v1";

const R = (id, room, who, phone, n, from, to, price, src, extra = {}) => Object.assign({ id, room, who, phone, n, from, to, price, deposit: 0, src, note: "", checked: false, deleted: false, updatedAt: id, paid: false, bookedOn: "2026-10-20", warn: "" }, extra);
function server() {
  const rows = [
    R(1, "tc301", "測試甲", "0911000001", 3, "2026-11-05", "2026-11-07", 3200, "電話", { checked: true }),
    R(2, "tc202", "測試乙", "0911000002", 2, "2026-11-15", "2026-11-16", 2200, "Booking.com"),
    R(3, "tc302", "測試甲", "0911000001", 3, "2026-11-15", "2026-11-17", 3800, "LINE"),
  ];
  const regs = [
    { bookingId: "1", ts: Date.parse("2026-11-05T15:00:00+08:00"), checkout: "2026-11-07", ci: "2026-11-05", name: "測試甲", idno: "A100000001", birth: "民國 82 年 6 月 14 日", phone: "0911000001", plate: "TST-0001", addr: "台北市大安區", note: "", companions: [{ name: "同行一", idno: "", birth: "" }], rooms: "夕映 301", purpose: "旅遊", purposeNote: "", age: 33, city: "臺北市" },
    { bookingId: "90", ts: 1, checkout: "2026-11-10", name: "測試丙", idno: "", birth: "", phone: "0911000003", plate: "", addr: "中正路 1 號", note: "", companions: [], rooms: "", purpose: "出差", purposeNote: "", age: 41, city: "", ci: "2026-11-09" },
  ];
  const sent = [];
  return {
    rows, regs, sent,
    handle(body) {
      (body.rows || []).forEach((x) => { const i = rows.findIndex((y) => y.id === x.id); if (i >= 0) rows[i] = { ...rows[i], ...x }; else rows.push(x); });
      (body.checkins || []).forEach((c) => {
        sent.push(c);
        const i = regs.findIndex((g) => g.bookingId === String(c.bookingId));
        const g = { ...c, bookingId: String(c.bookingId) };
        if (i >= 0) regs[i] = g; else regs.push(g);
      });
      return { ok: true, rows, regs };
    },
  };
}

async function open(b, W, H) {
  const srv = server();
  const c = await b.newContext({ viewport: { width: W, height: H } });
  const p = await c.newPage();
  const errors = [];
  p.on("pageerror", (x) => errors.push(x.message));
  await p.route("https://x.test/exec", (r) => r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(srv.handle(JSON.parse(r.request().postData() || "{}"))) }));
  await p.clock.install({ time: new Date("2026-11-15T15:00:00+08:00") });
  await p.goto(APP); await p.clock.resume();
  await p.evaluate((k) => localStorage.setItem(k + "_sync", JSON.stringify({ url: "https://x.test/exec", token: "t", last: 0 })), KEY);
  await p.reload(); await p.clock.resume(); await p.waitForTimeout(1200);
  return { p, c, srv, errors };
}
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const regsOf = (p) => p.evaluate((k) => JSON.parse(localStorage.getItem(k + "_reg") || "{}"), KEY);

const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
try {
  // ---- 手機：房況、回流客帶入、住宿目的、登記卡片、來客分析、補填縣市 ----
  {
    const { p, c, srv, errors } = await open(b, 390, 844);
    assert.match(await p.textContent("#view"), /今天入住/, "calendar day card");
    assert.equal(await overflow(p), 0, "390 calendar no overflow");

    await p.click('[data-act=checkin][data-id="3"]'); await p.waitForTimeout(300);
    assert.equal(await p.locator('[data-act=prefill][data-id="1"]').count(), 1, "returning-guest banner");
    await p.click('[data-act=prefill][data-id="1"]'); await p.waitForTimeout(300);
    assert.equal(await p.inputValue("#c-plate"), "TST-0001", "plate brought in");
    assert.equal(await p.inputValue("#c-id"), "A100000001", "id brought in");
    assert.match(await p.textContent("#view"), /帶入：姓名、證件號碼、生日、車牌、地址、住宿目的、同行旅客 1 位/, "confirmation card");
    await p.click('[data-act=purpose][data-v="其他"]'); await p.waitForTimeout(200);
    await p.fill("#c-pnote", "探親");
    await p.click("[data-act=finish]"); await p.waitForTimeout(1500);
    const g = (await regsOf(p))["3"];
    assert.ok(g && g.purpose === "其他" && g.purposeNote === "探親" && g.age === 33 && g.city === "臺北市" && g.ci === "2026-11-15", JSON.stringify(g));
    const up = srv.sent.find((x) => x.bookingId === 3);
    assert.ok(up && up.ci === "2026-11-15" && up.purpose === "其他", "check-in pushed with new fields");

    await p.locator('[data-act=detail][data-id="3"]').first().click(); await p.waitForTimeout(300);
    assert.match(await p.textContent("#view"), /其他（探親）/, "purpose shown in registration card");

    await p.click("[data-act=tab][data-t=checkin]"); await p.waitForTimeout(200);
    await p.click('[data-act=tab][data-t=cal]'); await p.waitForTimeout(200);
    await p.click('[data-act=checkin][data-id="2"]'); await p.waitForTimeout(300);
    assert.equal(await p.locator("[data-act=prefill]").count(), 0, "no banner for a new guest");

    await p.click("[data-act=tab][data-t=guests]"); await p.click("[data-act=gp][data-v=a]"); await p.waitForTimeout(300);
    const t = await p.textContent("#view");
    assert.match(t, /3 組客人/, "guest count");
    assert.match(t, /無法判斷/, "unknown county row");
    assert.equal(await overflow(p), 0, "390 guests no overflow");
    await p.click("[data-act=fixcity]"); await p.waitForTimeout(200);
    await p.selectOption('[data-city="90"]', "屏東縣"); await p.waitForTimeout(1200);
    assert.equal((await regsOf(p))["90"].city, "屏東縣", "manual county saved");
    assert.ok(srv.sent.some((x) => x.bookingId === 90 && x.city === "屏東縣"), "manual county pushed");

    await p.setViewportSize({ width: 320, height: 700 }); await p.waitForTimeout(300);
    for (const tab of ["cal", "rev", "guests"]) { await p.click(`[data-act=tab][data-t=${tab}]`); await p.waitForTimeout(200); assert.equal(await overflow(p), 0, "320 " + tab + " no overflow"); }
    assert.deepEqual(errors, [], "no page errors (phone)");
    await c.close();
  }
  // ---- 電腦版：側邊選單、整頁新增訂單、鍵盤切月份 ----
  {
    const { p, c, srv, errors } = await open(b, 1440, 900);
    assert.equal(await p.locator(".nbrand").isVisible(), true, "desktop sidebar");
    await p.keyboard.press("ArrowRight"); await p.waitForTimeout(200);
    assert.match(await p.textContent(".hdr .t b"), /12 月/, "arrow key changes month");
    await p.keyboard.press("ArrowLeft");
    await p.click("[data-act=tab][data-t=order]"); await p.waitForTimeout(300);
    assert.equal(await p.locator("#o-name").isVisible(), true, "one-page form on desktop");
    await p.click("[data-act=chip][data-c=custom]"); await p.waitForTimeout(200);
    await p.fill("#o-in", "2026-12-01"); await p.waitForTimeout(200);
    await p.click('[data-act=room][data-k="tc202"]');
    await p.fill("#o-name", "測試丁"); await p.fill("#o-phone", "0911000004");
    for (const x of await p.$$("[data-in=price]")) await x.fill("2500");
    await p.click("[data-act=save]"); await p.waitForTimeout(1500);
    assert.ok(srv.rows.some((x) => x.who === "測試丁" && x.from === "2026-12-01" && x.room === "tc202"), "new order synced");
    for (const tab of ["cal", "rev", "guests"]) { await p.click(`[data-act=tab][data-t=${tab}]`); await p.waitForTimeout(200); assert.equal(await overflow(p), 0, "1440 " + tab + " no overflow"); }
    assert.deepEqual(errors, [], "no page errors (desktop)");
    await c.close();
  }
  console.log("app: all passed");
} catch (e) {
  console.error("FAIL", e.message); process.exitCode = 1;
} finally {
  await b.close();
}
