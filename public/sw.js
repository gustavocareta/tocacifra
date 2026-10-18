// Service worker: guarda o "casco" do app para abrir sem internet. Os dados ficam no localStorage (ver app.js).
// Caminhos relativos: o app funciona na raiz (servidor local) e em subpasta (GitHub Pages: /tocacifra/).
const CACHE = 'tocacifra-shell-v7';
const SHELL = [
  './', 'app.js', 'chords.js', 'diagrams.js', 'tuner.js', 'pedal.js', 'filters.js', 'theme.js', 'errors.js', 'importer-core.js',
  'backend.js', 'backend-node.js', 'backend-supabase.js', 'config.js', 'vendor/supabase.js',
  'style.css', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // so o proprio site; API do servidor local e chamadas ao Supabase (outro dominio) passam direto
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  // rede primeiro (pega atualizacoes); sem rede, usa o cache
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r ?? caches.match('./'))),
  );
});
