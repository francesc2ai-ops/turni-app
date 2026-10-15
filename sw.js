/* Service worker: fa funzionare l'app anche senza rete e gestisce le notifiche. */
const VERSIONE = 'turni-v2';
const FILE_APP = ['./', 'index.html', 'styles.css', 'app.js', 'parser.js', 'lettura.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSIONE).then((c) => c.addAll(FILE_APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSIONE && k !== 'turni-dati' && k !== 'turni-librerie').map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // file dell'app: prima la rete (per avere gli aggiornamenti), se manca usa la copia salvata
    e.respondWith(
      fetch(req).then((res) => {
        const copia = res.clone();
        caches.open(VERSIONE).then((c) => c.put(req, copia));
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
    );
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    // librerie per leggere Excel, PDF e foto: una volta scaricate restano salvate
    e.respondWith(
      caches.open('turni-librerie').then((c) => c.match(req).then((r) => r || fetch(req).then((res) => {
        if (res.ok) c.put(req, res.clone());
        return res;
      })))
    );
  }
});

/* Notifica giornaliera in background (Android con app installata) */
const pad = (n) => String(n).padStart(2, '0');
async function notificaGiornaliera() {
  const c = await caches.open('turni-dati');
  const r = await c.match('dati.json');
  if (!r) return;
  const { turni, legenda, opz = {} } = await r.json();
  const oggi = new Date();
  const chiave = `${oggi.getFullYear()}${pad(oggi.getMonth() + 1)}${pad(oggi.getDate())}`;
  const gia = await c.match('ultima-notifica');
  if (gia && (await gia.text()) === chiave) return;
  const desc = (d) => {
    const mese = turni[`${d.getFullYear()}-${pad(d.getMonth() + 1)}`];
    if (!mese) return 'turni non caricati';
    const cod = mese[d.getDate()];
    if (!cod) return 'Giornata normale' + (opz.normaleInizio && opz.normaleFine ? ` ${opz.normaleInizio}–${opz.normaleFine}` : '');
    const t = legenda[cod] || {};
    const titolo = t.nome && t.nome !== cod ? `${cod} · ${t.nome}` : cod;
    return t.inizio && t.fine ? `${titolo} ${t.inizio}–${t.fine}` : titolo;
  };
  const domani = new Date(oggi.getFullYear(), oggi.getMonth(), oggi.getDate() + 1);
  await self.registration.showNotification(`Oggi: ${desc(oggi)}`, { body: `Domani: ${desc(domani)}`, icon: 'icons/icon-192.png', tag: 'turno-oggi' });
  await c.put('ultima-notifica', new Response(chiave));
}

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'turno-giornaliero') e.waitUntil(notificaGiornaliera());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => (list[0] ? list[0].focus() : self.clients.openWindow('./'))));
});
