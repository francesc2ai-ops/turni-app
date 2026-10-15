/* I miei turni — logica dell'app */
(function () {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  const GIORNI_BREVI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

  // Le sigle vengono riportate così come sono nel foglio: nome e orari sono facoltativi,
  // si aggiungono nelle impostazioni solo se servono (per i promemoria con l'ora giusta).
  const LEGENDA_BASE = {};
  const PALETTE = ['#e09b1a', '#2f7fd8', '#5b45c9', '#2e9c6a', '#d4547a', '#0f8a8a', '#a8572d', '#6a7f2a', '#8a4fb5', '#c0392b'];
  const COLORE_NORMALE = '#b9b2a4';

  /* ---------------- memoria locale ---------------- */
  const mem = {
    get(k, d) { try { const v = localStorage.getItem('turni.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('turni.' + k, JSON.stringify(v)); } catch { /* memoria piena o disattivata */ } },
  };

  const stato = {
    utente: mem.get('utente', null),
    turni: mem.get('turni', {}),            // { "2026-11": { "1": "M", ... } }
    legenda: mem.get('legenda', LEGENDA_BASE),
    opz: Object.assign({ sera: '20:00', prima: 60, normaleInizio: '', normaleFine: '' }, mem.get('opzioni', {})),
    meseVisto: null,
    bozza: null,
  };

  function salvaTutto() {
    mem.set('utente', stato.utente);
    mem.set('turni', stato.turni);
    mem.set('legenda', stato.legenda);
    mem.set('opzioni', stato.opz);
    copiaPerNotifiche();
  }

  /* ---------------- date ---------------- */
  const pad = (n) => String(n).padStart(2, '0');
  const chiaveMese = (a, m) => `${a}-${pad(m)}`;
  const giorniNelMese = (a, m) => new Date(a, m, 0).getDate();
  function oggi() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function piuGiorni(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }


  /** Turno di un giorno: null se il mese non è caricato; "giornata normale" se la cella era vuota. */
  function turnoDel(data) {
    const m = stato.turni[chiaveMese(data.getFullYear(), data.getMonth() + 1)];
    if (!m) return null;
    return m[data.getDate()] ? infoTurno(m[data.getDate()]) : giornataNormale();
  }

  function giornataNormale() {
    return { codice: '', nome: 'Giornata normale', inizio: stato.opz.normaleInizio, fine: stato.opz.normaleFine, colore: COLORE_NORMALE, normale: true };
  }

  function coloreAutomatico(c) {
    let h = 0;
    for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  /** Primo colore della tavolozza non ancora usato da un'altra sigla. */
  function coloreLibero() {
    const usati = new Set(Object.values(stato.legenda).map((t) => (t.colore || '').toLowerCase()));
    return PALETTE.find((c) => !usati.has(c)) || PALETTE[Object.keys(stato.legenda).length % PALETTE.length];
  }

  /** Come mostrare un turno: la sigla del foglio, più il nome se l'utente gliene ha dato uno. */
  function titoloTurno(t) {
    if (!t) return '';
    if (t.normale) return t.nome;
    return t.nome && t.nome !== t.codice ? `${t.codice} · ${t.nome}` : t.codice;
  }

  /* ---------------- sigle ---------------- */
  function infoTurno(codice) {
    if (!codice) return null;
    const c = String(codice).toUpperCase().trim();
    const l = stato.legenda[c];
    if (l) return { codice: c, ...l, nome: l.nome || c, colore: l.colore || coloreAutomatico(c) };
    // orario scritto direttamente: "7-14", "07:00-14:00", "7.30-14"
    const m = c.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*[-–]\s*(\d{1,2})(?:[:.](\d{2}))?$/);
    if (m) {
      const inizio = `${pad(m[1])}:${m[2] || '00'}`, fine = `${pad(m[3])}:${m[4] || '00'}`;
      return { codice: c, nome: `Turno ${inizio}–${fine}`, inizio, fine, colore: '#0f5257' };
    }
    return { codice: c, nome: c, inizio: '', fine: '', colore: coloreAutomatico(c) };
  }

  function orario(t) { return t && t.inizio && t.fine ? `${t.inizio}–${t.fine}` : ''; }

  /* ---------------- navigazione ---------------- */
  function vai(vista) {
    document.querySelectorAll('.vista').forEach((v) => (v.hidden = true));
    $('#v-' + vista).hidden = false;
    window.scrollTo(0, 0);
    if (vista === 'home') disegnaHome();
    if (vista === 'impostazioni') disegnaImpostazioni();
    if (vista === 'carica') { $('#e-carica').hidden = true; }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-vai]');
    if (b) vai(b.dataset.vai);
  });

  function avviso(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(avviso._t);
    avviso._t = setTimeout(() => (t.hidden = true), 3200);
  }

  /* ---------------- accesso ---------------- */
  const RE_UTENTE = /^[A-Za-zÀ-ÿ' ]+(\.[A-Za-zÀ-ÿ' ]+)+$/;
  function sistemaNome(s) {
    return s.trim().split('.').map((p) => p.trim().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')).join('.');
  }

  $('#f-accesso').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#i-utente').value.trim();
    if (!RE_UTENTE.test(v)) {
      $('#e-accesso').textContent = 'Scrivi nome e cognome separati da un punto, es. Mario.Rossi';
      $('#e-accesso').hidden = false;
      return;
    }
    stato.utente = sistemaNome(v);
    salvaTutto();
    vai('home');
  });

  /* ---------------- home ---------------- */
  function schedaHtml(chi, data) {
    const t = turnoDel(data);
    const el = document.createElement('div');
    if (!t) {
      el.innerHTML = `<span class="chi">${chi}</span><span class="cosa">—</span><span class="quando">Nessun turno caricato</span>`;
      return { html: el.innerHTML, colore: '' };
    }
    el.innerHTML = `<span class="chi"></span><span class="cosa"></span><span class="quando"></span>`;
    el.querySelector('.chi').textContent = chi;
    el.querySelector('.cosa').textContent = titoloTurno(t);
    el.querySelector('.quando').textContent = orario(t);
    return { html: el.innerHTML, colore: t.colore };
  }

  function disegnaHome() {
    const nome = (stato.utente || '').split('.')[0];
    $('#t-saluto').textContent = `Ciao ${nome}`;
    const o = oggi();
    $('#t-data').textContent = `${GIORNI[o.getDay()]} ${o.getDate()} ${MESI[o.getMonth()]}`;

    const s1 = schedaHtml('Oggi', o), s2 = schedaHtml('Domani', piuGiorni(o, 1));
    $('#c-oggi').innerHTML = s1.html; $('#c-oggi').style.setProperty('--colore', s1.colore || 'var(--line)');
    $('#c-domani').innerHTML = s2.html; $('#c-domani').style.setProperty('--colore', s2.colore || 'var(--line)');

    if (!stato.meseVisto) stato.meseVisto = { a: o.getFullYear(), m: o.getMonth() + 1 };
    disegnaCalendario();

    const puoNotificare = 'Notification' in window && Notification.permission === 'default';
    $('#b-notifiche').hidden = !puoNotificare;
    $('#b-calendario').disabled = !Object.keys(stato.turni).length;
  }

  function disegnaCalendario() {
    const { a, m } = stato.meseVisto;
    $('#t-mese').textContent = `${MESI[m - 1]} ${a}`;
    const dati = stato.turni[chiaveMese(a, m)] || {};
    const primo = (new Date(a, m - 1, 1).getDay() + 6) % 7; // lunedì = 0
    const n = giorniNelMese(a, m);
    const o = oggi();
    const cal = $('#cal');
    cal.innerHTML = '';
    for (let i = 0; i < primo; i++) {
      const v = document.createElement('div'); v.className = 'giorno fuori'; cal.appendChild(v);
    }
    const usate = new Set();
    for (let d = 1; d <= n; d++) {
      const b = document.createElement('button');
      b.className = 'giorno';
      if (o.getFullYear() === a && o.getMonth() + 1 === m && o.getDate() === d) b.classList.add('oggi');
      const num = document.createElement('span'); num.className = 'n'; num.textContent = d; b.appendChild(num);
      const t = infoTurno(dati[d]);
      if (t) {
        usate.add(t.codice);
        const s = document.createElement('span'); s.className = 'sigla'; s.textContent = t.codice;
        s.style.setProperty('--colore', t.colore); b.appendChild(s);
      } else {
        const s = document.createElement('span');
        if (Object.keys(dati).length) { s.className = 'normale'; s.title = 'Giornata normale'; }
        b.appendChild(s);
      }
      b.addEventListener('click', () => mostraGiorno(new Date(a, m - 1, d)));
      cal.appendChild(b);
    }
    $('#t-vuoto').hidden = Object.keys(dati).length > 0;
    const leg = $('#legenda');
    leg.innerHTML = '';
    [...usate].sort().forEach((c) => {
      const t = infoTurno(c);
      const s = document.createElement('span');
      s.innerHTML = '<i></i>';
      s.querySelector('i').style.setProperty('--colore', t.colore);
      s.append(`${titoloTurno(t)}${orario(t) ? ' ' + orario(t) : ''}`);
      leg.appendChild(s);
    });
    if (Object.keys(dati).length) {
      const s = document.createElement('span');
      s.innerHTML = '<i class="vuota"></i>';
      s.append('vuoto = giornata normale');
      leg.appendChild(s);
    }
  }

  function mostraGiorno(data) {
    const t = turnoDel(data);
    const box = $('#dettaglio');
    box.innerHTML = '<p class="sotto"></p><p class="cosa"></p><p class="quando"></p><button class="btn largo">Chiudi</button>';
    box.querySelector('.sotto').textContent = `${GIORNI[data.getDay()]} ${data.getDate()} ${MESI[data.getMonth()]} ${data.getFullYear()}`;
    box.querySelector('.cosa').textContent = t ? titoloTurno(t) : 'Turni non caricati';
    box.querySelector('.quando').textContent = t ? orario(t) : 'Carica il foglio turni di questo mese.';
    box.querySelector('button').onclick = () => (box.hidden = true);
    box.hidden = false;
  }

  $('#b-prec').onclick = () => { let { a, m } = stato.meseVisto; m--; if (m < 1) { m = 12; a--; } stato.meseVisto = { a, m }; disegnaCalendario(); };
  $('#b-succ').onclick = () => { let { a, m } = stato.meseVisto; m++; if (m > 12) { m = 1; a++; } stato.meseVisto = { a, m }; disegnaCalendario(); };
  $('#b-carica').onclick = () => vai('carica');
  $('#b-impostazioni').onclick = () => vai('impostazioni');
  $('#b-calendario').onclick = () => esportaCalendario();
  $('#b-notifiche').onclick = async () => {
    try {
      const r = await Notification.requestPermission();
      if (r === 'granted') { avviso('Notifiche attivate'); notificaDiOggi(true); }
    } catch { /* non supportato */ }
    disegnaHome();
  };

  /* ---------------- carica e leggi ---------------- */
  ['#i-excel', '#i-pdf', '#i-foto-scatta', '#i-foto-galleria'].forEach((id) => {
    $(id).addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) await leggi(f);
    });
  });

  async function leggi(file) {
    const tipo = Lettura.tipoFile(file);
    $('#e-carica').hidden = true;
    $('#attesa').hidden = false;
    $('#prog').style.width = '0';
    $('#t-attesa').textContent = tipo === 'foto' ? 'Sto leggendo la foto… può volerci qualche secondo' : 'Sto leggendo il file…';
    try {
      const r = await Lettura.leggiFile(file, (p) => { $('#prog').style.width = Math.round(p * 100) + '%'; });
      if (!r.persone || !r.persone.length) {
        throw new Error(tipo === 'foto'
          ? 'Non riesco a trovare la tabella nella foto. Riprova con una foto più dritta, vicina e ben illuminata.'
          : 'Non trovo una tabella di turni con i giorni del mese in questo file.');
      }
      apriControllo(r);
    } catch (err) {
      $('#e-carica').textContent = err.message || 'Errore durante la lettura del file.';
      $('#e-carica').hidden = false;
    } finally {
      $('#attesa').hidden = true;
    }
  }

  /* ---------------- controllo ---------------- */
  function apriControllo(r) {
    const persone = TurniParser.rankPeople(r.persone, stato.utente);
    const o = oggi();
    // mese: quello del file; altrimenti il prossimo se siamo a fine mese, sennò il corrente
    let mese = r.mese, anno = r.anno;
    if (!mese) { const d = o.getDate() >= 20 ? piuGiorni(new Date(o.getFullYear(), o.getMonth() + 1, 1), 0) : o; mese = d.getMonth() + 1; anno = anno || d.getFullYear(); }
    if (!anno) anno = o.getFullYear();
    // correzione delle letture doppie tipiche delle foto: "SS" -> "S" se "SS" non è una sigla conosciuta
    for (const p of persone) {
      for (const g of Object.keys(p.turni)) {
        const c = p.turni[g];
        if (!stato.legenda[c] && /^(.)\1+$/.test(c) && stato.legenda[c[0]]) p.turni[g] = c[0];
      }
    }
    stato.bozza = { persone, scelta: 0, mese, anno, daOcr: !!r.daOcr, turni: { ...persone[0].turni } };

    const sp = $('#s-persona');
    sp.innerHTML = '';
    persone.forEach((p, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = p.etichetta + (p.punteggio === 3 ? '  ✓' : '');
      sp.appendChild(opt);
    });
    sp.value = '0';
    sp.onchange = () => {
      stato.bozza.scelta = +sp.value;
      stato.bozza.turni = { ...persone[+sp.value].turni };
      aggiornaAvvisoControllo();
      disegnaGiorniControllo();
    };

    const sm = $('#s-mese');
    sm.innerHTML = MESI.map((n, i) => `<option value="${i + 1}">${n}</option>`).join('');
    sm.value = String(mese);
    const sa = $('#s-anno');
    const y = o.getFullYear();
    sa.innerHTML = [y - 1, y, y + 1].map((v) => `<option>${v}</option>`).join('');
    if (![y - 1, y, y + 1].includes(anno)) sa.insertAdjacentHTML('beforeend', `<option>${anno}</option>`);
    sa.value = String(anno);
    sm.onchange = () => { stato.bozza.mese = +sm.value; disegnaGiorniControllo(); };
    sa.onchange = () => { stato.bozza.anno = +sa.value; disegnaGiorniControllo(); };

    $('#d-codici').innerHTML = Object.keys(stato.legenda).map((c) => `<option value="${c}">${stato.legenda[c].nome}</option>`).join('');

    aggiornaAvvisoControllo();
    disegnaGiorniControllo();
    vai('controllo');
  }

  function aggiornaAvvisoControllo() {
    const b = stato.bozza;
    const p = b.persone[b.scelta];
    const msg = [];
    if (p.punteggio === 0) msg.push(`Non ho trovato "${stato.utente.replace('.', ' ')}" nel foglio. Scegli la tua riga dall'elenco qui sotto.`);
    else if (p.punteggio < 3) msg.push(`Ho trovato "${p.etichetta}": controlla che sia proprio tu.`);
    if (b.daOcr) msg.push('Turni letti da un\'immagine: controlla bene ogni casella prima di salvare.');
    const box = $('#a-controllo');
    box.textContent = msg.join(' ');
    box.hidden = !msg.length;
  }

  function disegnaGiorniControllo() {
    const b = stato.bozza;
    const n = giorniNelMese(b.anno, b.mese);
    const lista = $('#l-giorni');
    lista.innerHTML = '';
    for (let d = 1; d <= n; d++) {
      const data = new Date(b.anno, b.mese - 1, d);
      const cella = document.createElement('div');
      cella.className = 'cella' + (data.getDay() === 0 ? ' festivo' : '');
      cella.innerHTML = '<span class="gg"></span><input list="d-codici" maxlength="12" autocomplete="off"><span class="lab"></span>';
      cella.querySelector('.gg').textContent = `${GIORNI_BREVI[data.getDay()]} ${d}`;
      const inp = cella.querySelector('input');
      inp.setAttribute('aria-label', `Turno del giorno ${d}`);
      inp.value = b.turni[d] || '';
      const aggiorna = () => {
        const v = inp.value.toUpperCase().trim();
        if (v) b.turni[d] = v; else delete b.turni[d];
        const t = infoTurno(v);
        cella.style.setProperty('--colore', t ? t.colore : 'var(--line)');
        cella.querySelector('.lab').textContent = t ? (t.nome !== t.codice ? t.nome : '') : 'normale';
      };
      inp.addEventListener('input', aggiorna);
      aggiorna();
      lista.appendChild(cella);
    }
  }

  $('#b-salva').onclick = () => {
    const b = stato.bozza;
    const n = giorniNelMese(b.anno, b.mese);
    const turni = {};
    for (let d = 1; d <= n; d++) if (b.turni[d]) turni[d] = b.turni[d];
    if (!Object.keys(turni).length) { avviso('Non ci sono turni da salvare'); return; }
    stato.turni[chiaveMese(b.anno, b.mese)] = turni;
    // le sigle nuove compaiono nelle impostazioni, dove si può dar loro un nome e un orario
    Object.values(turni).forEach((c) => {
      const k = String(c).toUpperCase().trim();
      if (!stato.legenda[k] && !/^\d{1,2}([:.]\d{2})?\s*[-–]/.test(k)) stato.legenda[k] = { nome: '', inizio: '', fine: '', colore: coloreLibero() };
    });
    salvaTutto();
    stato.meseVisto = { a: b.anno, m: b.mese };
    stato.bozza = null;
    vai('home');
    avviso(`Turni di ${MESI[b.mese - 1]} salvati`);
  };

  /* ---------------- impostazioni ---------------- */
  function disegnaImpostazioni() {
    $('#t-utente').textContent = stato.utente;
    $('#i-sera').value = stato.opz.sera;
    $('#i-prima').value = String(stato.opz.prima);
    $('#i-norm-inizio').value = stato.opz.normaleInizio || '';
    $('#i-norm-fine').value = stato.opz.normaleFine || '';
    const box = $('#l-legenda');
    box.innerHTML = '';
    Object.entries(stato.legenda).sort(([a], [b]) => a.localeCompare(b)).forEach(([cod, t]) => {
      const r = document.createElement('div');
      r.className = 'riga-sigla';
      r.innerHTML = `
        <input class="codice" maxlength="6" aria-label="Sigla">
        <input class="nome" aria-label="Nome del turno">
        <input type="color" aria-label="Colore">
        <span></span>
        <div class="orari">
          <input type="time" class="inizio" aria-label="Inizio">
          <input type="time" class="fine" aria-label="Fine">
          <button class="icona x" aria-label="Elimina sigla">×</button>
        </div>`;
      const [ic, inome, icol] = r.querySelectorAll('input');
      ic.value = cod; inome.value = t.nome || ''; inome.placeholder = 'Nome (facoltativo)'; icol.value = t.colore || coloreAutomatico(cod);
      r.querySelector('.inizio').value = t.inizio || '';
      r.querySelector('.fine').value = t.fine || '';
      const salva = () => {
        const nuovo = ic.value.toUpperCase().trim();
        const dati = { nome: inome.value.trim(), inizio: r.querySelector('.inizio').value, fine: r.querySelector('.fine').value, colore: icol.value };
        if (!nuovo) return;
        if (nuovo !== cod) { delete stato.legenda[cod]; cod = nuovo; }
        stato.legenda[cod] = dati;
        salvaTutto();
      };
      r.querySelectorAll('input').forEach((i) => i.addEventListener('change', salva));
      r.querySelector('.x').onclick = () => { delete stato.legenda[cod]; salvaTutto(); disegnaImpostazioni(); };
      box.appendChild(r);
    });
  }
  $('#b-agg-sigla').onclick = () => {
    let c = 'NUOVA', i = 1;
    while (stato.legenda[c]) c = 'NUOVA' + ++i;
    stato.legenda[c] = { nome: '', inizio: '', fine: '', colore: '#0f5257' };
    salvaTutto(); disegnaImpostazioni();
  };
  $('#i-sera').onchange = (e) => { stato.opz.sera = e.target.value || '20:00'; salvaTutto(); };
  $('#i-prima').onchange = (e) => { stato.opz.prima = +e.target.value; salvaTutto(); };
  $('#i-norm-inizio').onchange = (e) => { stato.opz.normaleInizio = e.target.value; salvaTutto(); };
  $('#i-norm-fine').onchange = (e) => { stato.opz.normaleFine = e.target.value; salvaTutto(); };
  $('#b-cambia').onclick = () => { $('#i-utente').value = stato.utente || ''; vai('accesso'); };
  $('#b-cancella').onclick = () => {
    if (confirm('Vuoi cancellare tutti i turni salvati su questo dispositivo?')) {
      stato.turni = {}; salvaTutto(); avviso('Turni cancellati'); vai('home');
    }
  };

  /* ---------------- calendario del telefono (.ics) ---------------- */
  function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, (m) => '\\' + m).replace(/\n/g, '\\n'); }
  function ymd(d) { return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; }
  function minuti(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }

  function creaIcs() {
    const righe = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//I miei turni//IT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Turni'];
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const da = piuGiorni(oggi(), -1);
    let n = 0;
    for (const [km, giorni] of Object.entries(stato.turni)) {
      const [a, m] = km.split('-').map(Number);
      for (let g = 1; g <= giorniNelMese(a, m); g++) {
        const data = new Date(a, m - 1, g);
        if (data < da) continue; // i turni passati non servono
        const t = turnoDel(data); // le celle vuote diventano "Giornata normale"
        if (!t) continue;
        const uid = `turno-${ymd(data)}-${(stato.utente || '').toLowerCase()}@i-miei-turni`;
        righe.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp}`);
        let inizioMin;
        if (t.inizio && t.fine) {
          const fineData = minuti(t.fine) <= minuti(t.inizio) ? piuGiorni(data, 1) : data;
          righe.push(`DTSTART:${ymd(data)}T${t.inizio.replace(':', '')}00`, `DTEND:${ymd(fineData)}T${t.fine.replace(':', '')}00`);
          inizioMin = minuti(t.inizio);
        } else {
          righe.push(`DTSTART;VALUE=DATE:${ymd(data)}`, `DTEND;VALUE=DATE:${ymd(piuGiorni(data, 1))}`, 'TRANSP:TRANSPARENT');
          inizioMin = 0;
        }
        righe.push(`SUMMARY:${esc(t.normale ? 'Giornata normale' : `Turno ${titoloTurno(t)}`)}`);
        righe.push(`DESCRIPTION:${esc(`${titoloTurno(t)}${orario(t) ? ' ' + orario(t) : ''}`)}`);
        // avviso la sera prima: "Domani: ..."
        const sera = minuti(stato.opz.sera || '20:00');
        const anticipo = inizioMin + (24 * 60 - sera);
        righe.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`Domani: ${titoloTurno(t)}${orario(t) ? ' ' + orario(t) : ''}`)}`, `TRIGGER:-PT${anticipo}M`, 'END:VALARM');
        // avviso poco prima dell'inizio
        if (stato.opz.prima > 0 && t.inizio) {
          righe.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`Tra poco: ${titoloTurno(t)} ${orario(t)}`)}`, `TRIGGER:-PT${stato.opz.prima}M`, 'END:VALARM');
        }
        righe.push('END:VEVENT');
        n++;
      }
    }
    righe.push('END:VCALENDAR');
    return { testo: righe.join('\r\n') + '\r\n', n };
  }

  async function esportaCalendario() {
    const { testo, n } = creaIcs();
    if (!n) { avviso('Nessun turno da oggi in poi'); return; }
    const file = new File([testo], 'turni.ics', { type: 'text/calendar' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
        await navigator.share({ files: [file], title: 'Turni' });
        return;
      }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = 'turni.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    avviso(`${n} turni pronti: apri il file per aggiungerli al calendario`);
  }

  /* ---------------- notifiche ---------------- */
  function testoNotifica() {
    const o = oggi();
    const t1 = turnoDel(o), t2 = turnoDel(piuGiorni(o, 1));
    if (!t1 && !t2) return null;
    const desc = (t) => (t ? `${titoloTurno(t)}${orario(t) ? ' ' + orario(t) : ''}` : 'turni non caricati');
    return { titolo: `Oggi: ${desc(t1)}`, corpo: `Domani: ${desc(t2)}` };
  }

  async function notificaDiOggi(forza) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const chiave = ymd(oggi());
    if (!forza && mem.get('ultimaNotifica', '') === chiave) return;
    const n = testoNotifica();
    if (!n) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(n.titolo, { body: n.corpo, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'turno-oggi' });
      mem.set('ultimaNotifica', chiave);
    } catch { /* non supportato */ }
  }

  /** Copia dei dati leggibile dal service worker (per le notifiche in background su Android). */
  async function copiaPerNotifiche() {
    try {
      if (!('caches' in window)) return;
      const c = await caches.open('turni-dati');
      await c.put('dati.json', new Response(JSON.stringify({ turni: stato.turni, legenda: stato.legenda, opz: stato.opz }), { headers: { 'Content-Type': 'application/json' } }));
    } catch { /* ignora */ }
  }

  async function avviaServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      if ('periodicSync' in reg) {
        const p = await navigator.permissions.query({ name: 'periodic-background-sync' }).catch(() => null);
        if (p && p.state === 'granted') await reg.periodicSync.register('turno-giornaliero', { minInterval: 6 * 60 * 60 * 1000 }).catch(() => {});
      }
    } catch { /* ignora */ }
  }

  /* ---------------- avvio ---------------- */
  avviaServiceWorker();
  copiaPerNotifiche();
  if (stato.utente) { vai('home'); notificaDiOggi(false); } else vai('accesso');
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !$('#v-home').hidden) { disegnaHome(); notificaDiOggi(false); }
  });
})();
