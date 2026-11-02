# inn-booking

民宿訂房小幫手（循跡文旅）。App 在 `tracover/`；多人同步設定見 `tracover/同步設定說明.md`。

本儲存庫只含程式，不含任何訂單或旅客資料。

## 房況摘要（唯讀，給生活指揮所等外部系統）

對同步網址 POST（`Content-Type: text/plain`）：

```json
{"token":"<同步密碼>","action":"summary","today":"2026-11-02"}
```

`today` 可省略（預設台北今天）。回傳今天入住／退房、今晚與明晚空房、本月與未來 30 天的住房率與預估營收。這個動作不會修改任何資料。

Cloudflare Worker 範例：

```js
export default {
  async fetch(req, env) {
    const r = await fetch(env.INN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: env.INN_TOKEN, action: 'summary' }),
    });
    return new Response(await r.text(), { headers: { 'Content-Type': 'application/json' } });
  },
};
```
`INN_URL`、`INN_TOKEN` 設為 Worker 的環境變數（密碼不要寫進前端網頁）。
