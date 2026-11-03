var C='app-v18-tracover';
var ASSETS=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];
self.addEventListener('install',function(e){e.waitUntil(caches.open(C).then(function(c){return c.addAll(ASSETS)}).then(function(){return self.skipWaiting()}))});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==C}).map(function(k){return caches.delete(k)}))}).then(function(){return self.clients.claim()}))});
self.addEventListener('fetch',function(e){
  var u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.hostname==='script.google.com'||u.hostname.indexOf('googleusercontent.com')>=0)return;
  // 辨識程式與語言檔很大且不會變：先用快取；其餘（頁面本身）先連網拿最新版，連不上才用快取
  if(u.origin===location.origin&&u.pathname.indexOf('/ocr/')>=0){
    e.respondWith(caches.match(e.request).then(function(r){return r||fetch(e.request).then(function(res){if(res&&res.ok){var cp=res.clone();caches.open(C).then(function(c){c.put(e.request,cp)})}return res})}));return;
  }
  e.respondWith(fetch(e.request).then(function(res){if(res&&(res.ok||res.type==='opaque')){var cp=res.clone();caches.open(C).then(function(c){c.put(e.request,cp)})}return res}).catch(function(){return caches.match(e.request)}));
});
