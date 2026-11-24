// 海津&海町畫面測試：早餐欄位、直接選日期、住客通知格式（Playwright，不連網）
import { createRequire } from "module";
import assert from "assert";
const require = createRequire((process.env.PW_PATH || "") + "/");
const { chromium } = require("playwright");
const APP = new URL("../haijin/index.html", import.meta.url).href;
const KEY = "hjhm_data_v1";
const mk = (id, room, price, bf) => ({ id, room, who: "測試甲", phone: "0911000001", n: 2, from: "2027-01-02", to: "2027-01-03", price, deposit: 0, src: "電話", note: "", checked: false, paid: false, deleted: false, updatedAt: id, bookedOn: "2026-11-10", bf });
const rows = (bf) => [mk(1, "js203", 1900, bf), mk(2, "ht102", 1900, bf), mk(3, "js101", 3280, bf), mk(4, "js201", 3280, bf), mk(5, "ht101", 3280, bf)];
const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
try {
  for (const w of [320, 390, 1440]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(APP);
    await p.click("[data-act=tab][data-t=order]");
    assert.equal(await p.$$eval("[data-act=chip][data-c]", (e) => e.length), 0, "no date preset chips");
    assert.ok(await p.$("#o-in") && await p.$("#o-out"), "date inputs shown");
    assert.equal(await p.$$eval("[data-act=bf]", (e) => e.length), 2, "breakfast chips shown");
    await p.click("[data-act=bf][data-v='1']");
    assert.equal(await p.$eval("[data-act=bf][data-v='1']", (e) => e.getAttribute("aria-pressed")), "true");
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "no overflow " + w);
    assert.deepEqual(errs, []);
    await p.close();
  }
  for (const bf of [true, false]) {
    const p = await b.newPage({ viewport: { width: 390, height: 900 } });
    await p.addInitScript(([k, d]) => localStorage.setItem(k, JSON.stringify(d)), [KEY, rows(bf)]);
    await p.goto(APP);
    await p.click("[data-act=tab][data-t=cal]");
    for (let i = 0; i < 2; i++) { await p.click("[data-act=mon][data-d='1']"); }
    await p.click("[data-act=pick][data-d='2027-01-02']");
    const body = await p.$eval("body", (e) => e.innerText);
    assert.ok(body.includes("海津 101") || body.includes("海津 203"), "day list shows rooms");
    assert.equal(body.includes("🍳 有訂早餐"), bf, "breakfast tag on day card only when ordered");
    await p.click("[data-act=detail]");
    const msg = await p.$eval("details pre", (e) => e.textContent);
    assert.ok(msg.includes("116/01/02") && msg.includes("116/01/03"), "ROC dates");
    assert.ok(msg.includes("雙人房1900元* 2間3800元"), "two 雙人房 grouped: " + msg);
    assert.ok(msg.includes("四人房3280元* 3間9840元"), "three 四人房 grouped");
    assert.ok(msg.includes("計13640元_" + (bf ? "含早餐" : "不含早餐")), "total and breakfast text");
    assert.ok(msg.indexOf("雙人房") < msg.indexOf("四人房"), "smaller rooms first");
    assert.ok(!msg.includes("循跡") && !msg.includes("00129220279890"), "no tracover details");
    await p.close();
  }
} finally { await b.close(); }
console.log("haijin: all passed");
