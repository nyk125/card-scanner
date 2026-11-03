// Keeps the app working offline and turns contact.vcf?d=... into a real vCard file,
// which iPhone opens as a "Create New Contact" screen.
const VERSION = "card-scanner-v2";
const SHELL = ["./", "index.html", "app.js", "parser.js", "sheets.js", "vendor/xlsx.mini.min.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function fromB64url(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  if (url.origin === self.location.origin && url.pathname.endsWith("/contact.vcf") && url.searchParams.has("d")) {
    const body = fromB64url(url.searchParams.get("d"));
    const name = (url.searchParams.get("n") || "").replace(/[^A-Za-z0-9 .-]/g, "").trim() || "contact.vcf";
    e.respondWith(new Response(body, { headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `inline; filename="${name}"`,
    } }));
    return;
  }
  if (e.request.method !== "GET") return;

  // Text-reader files: cache first, they only change with a new app version.
  if (url.origin === self.location.origin && url.pathname.includes("/ocr/")) {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }

  // App files: network first so updates arrive, cache when offline.
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))));
  }
});
