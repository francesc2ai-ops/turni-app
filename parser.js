/*
 * Lettore dei turni.
 * Trasforma il contenuto di un foglio turni (Excel, PDF o foto) in un elenco
 * di persone, ognuna con i propri turni giorno per giorno.
 *
 * Due ingressi:
 *  - parseGrid(griglia)  -> per Excel/CSV: una tabella di celle (righe x colonne)
 *  - parseWords(parole)  -> per PDF e foto: parole con le loro coordinate
 *
 * Entrambi restituiscono { persone: [{ etichetta, turni: {giorno: codice} }], mese, anno }.
 * Funziona sia nel browser (window.TurniParser) sia in Node (per i test).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TurniParser = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MESI_NOMI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
    'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

  /* ---------- testo ---------- */

  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /** "Maria.De Luca" -> ["maria", "de", "luca"] */
  function nameTokens(utente) {
    return norm(String(utente || '').replace(/[._]/g, ' ')).split(' ').filter(Boolean);
  }

  /**
   * Quanto un'etichetta (es. "ROSSI MARIO") corrisponde all'utente.
   * 3 = nome e cognome; 2 = cognome + iniziale; 1 = solo cognome; 0 = no.
   */
  function scoreName(etichetta, tokens) {
    const words = norm(etichetta).split(' ').filter(Boolean);
    if (!words.length || !tokens.length) return 0;
    const has = (t) => words.includes(t);
    if (tokens.every(has)) return 3;
    const [nome, ...cognome] = tokens;
    if (cognome.length && cognome.every(has)) {
      if (words.some((w) => w.length <= 2 && w[0] === nome[0])) return 2;
      return 1;
    }
    return 0;
  }

  function looksLikeName(s) {
    return /[A-Za-zÀ-ÿ]{2,}/.test(String(s || ''));
  }

  /* ---------- giorni e codici ---------- */

  /** Riconosce un numero di giorno in una cella: 1, "01", "lun 3", "3 L", "3/11", una data. */
  function dayOf(v) {
    if (v instanceof Date) return isNaN(v) ? null : v.getDate();
    if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 31 ? v : null;
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    let m = s.match(/^(?:[A-Za-zÀ-ÿ]{1,4}\.?\s*)?(\d{1,2})(?:\s*[A-Za-zÀ-ÿ]{1,4}\.?)?$/);
    if (!m) m = s.match(/^(\d{1,2})[/\-.]\d{1,2}(?:[/\-.]\d{2,4})?$/);
    if (!m) return null;
    const d = parseInt(m[1], 10);
    return d >= 1 && d <= 31 ? d : null;
  }

  /** Per le intestazioni lette da foto: "l" "I" "|" spesso sono "1", "O" è "0". */
  function dayOfOcr(text) {
    const s = String(text || '').trim().replace(/^[#*.,:;'"]+|[#*.,:;'"]+$/g, '');
    if (/^[0-9lI|O]{1,2}$/.test(s) && /\d/.test(s)) {
      return dayOf(s.replace(/[lI|]/g, '1').replace(/O/g, '0'));
    }
    return dayOf(s);
  }

  /** Ripulisce il contenuto di una cella turno: "  m " -> "M". Vuoto se non è un turno. */
  function cleanCode(v) {
    if (v == null || v instanceof Date) return '';
    if (typeof v === 'number') {
      // Orari Excel (frazioni di giorno) o numeri: li teniamo come testo semplice
      if (!Number.isFinite(v)) return '';
      v = String(v);
    }
    let s = String(v).toUpperCase()
      .replace(/[|[\]{}()_'"`´‘’“”~*]/g, '')
      .replace(/\s+/g, ' ').trim();
    s = s.replace(/^[.,;:\-–]+|[.,;:\-–]+$/g, '').trim();
    if (!s) return '';
    if (/^\d{3,}$/.test(s)) return ''; // totali ore, matricole...
    return s;
  }

  /* ---------- mese e anno ---------- */

  function detectMonthYear(text) {
    const words = norm(text).split(' ');
    let mese = null, anno = null;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      let idx = MESI_NOMI.indexOf(w);
      if (idx < 0) {
        const b = MESI_BREVI.indexOf(w);
        // le abbreviazioni valgono solo se seguite da un anno (es. "nov 2026"): "mar" può essere martedì
        if (b >= 0 && /^20[2-4]\d$/.test(words[i + 1] || '')) idx = b;
      }
      if (idx >= 0 && mese == null) {
        mese = idx + 1;
        if (/^20[2-4]\d$/.test(words[i + 1] || '')) anno = parseInt(words[i + 1], 10);
      }
    }
    if (anno == null) {
      const m = String(text || '').match(/\b(20[2-4]\d)\b/);
      if (m) anno = parseInt(m[1], 10);
    }
    return { mese, anno };
  }

  /* ---------- sequenza dei giorni nell'intestazione ---------- */

  /**
   * Da elementi ordinati per posizione [{pos, day}], trova la sequenza crescente
   * di giorni più lunga (gestisce celle vuote e numeri spuri).
   */
  function bestDayRun(items) {
    const n = items.length;
    if (!n) return [];
    const len = new Array(n).fill(1), prev = new Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i; j++) {
        if (items[j].day < items[i].day && items[j].pos < items[i].pos && len[j] + 1 > len[i]) {
          len[i] = len[j] + 1; prev[i] = j;
        }
      }
    }
    let best = 0;
    for (let i = 1; i < n; i++) if (len[i] > len[best]) best = i;
    const run = [];
    for (let i = best; i >= 0; i = prev[i]) run.unshift(items[i]);
    // la sequenza deve essere "compatta": niente salti enormi tra i giorni
    const span = run[run.length - 1].day - run[0].day + 1;
    if (span > run.length * 1.6 + 2) return [];
    return run;
  }

  /* ---------- EXCEL: griglia di celle ---------- */

  function cellText(v) {
    if (v == null) return '';
    if (v instanceof Date) return '';
    return String(v).trim();
  }

  function transpose(grid) {
    const rows = grid.length;
    const cols = grid.reduce((m, r) => Math.max(m, (r || []).length), 0);
    const out = [];
    for (let c = 0; c < cols; c++) {
      const row = [];
      for (let r = 0; r < rows; r++) row.push((grid[r] || [])[c]);
      out.push(row);
    }
    return out;
  }

  function findGridHeader(grid) {
    let best = null;
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r] || [];
      const items = [];
      for (let c = 0; c < row.length; c++) {
        const d = dayOf(row[c]);
        if (d != null) items.push({ pos: c, day: d, raw: row[c] });
      }
      if (items.length < 7) continue;
      const run = bestDayRun(items);
      if (run.length >= 7 && (!best || run.length > best.run.length)) best = { row: r, run };
    }
    if (!best) return null;
    // se l'intestazione contiene vere date, da lì ricaviamo mese e anno
    const dates = best.run.map((x) => x.raw).filter((x) => x instanceof Date && !isNaN(x));
    if (dates.length) {
      const mid = dates[Math.floor(dates.length / 2)];
      best.mese = mid.getMonth() + 1;
      best.anno = mid.getFullYear();
    }
    return best;
  }

  function parseGridOneWay(grid) {
    const h = findGridHeader(grid);
    if (!h) return null;
    const firstCol = h.run[0].pos;
    const persone = [];
    for (let r = 0; r < grid.length; r++) {
      if (r === h.row) continue;
      const row = grid[r] || [];
      const etichetta = row.slice(0, firstCol).map(cellText).filter(Boolean).join(' ').trim();
      if (!looksLikeName(etichetta)) continue;
      const turni = {};
      let n = 0;
      for (const { pos, day } of h.run) {
        const c = cleanCode(row[pos]);
        if (c) { turni[day] = c; n++; }
      }
      if (n === 0) continue;
      persone.push({ etichetta, turni });
    }
    return { persone, mese: h.mese || null, anno: h.anno || null, giorni: h.run.length };
  }

  /** Griglia Excel -> persone. Prova sia "nomi nelle righe" sia "nomi nelle colonne". */
  function parseGrid(grid) {
    const a = parseGridOneWay(grid);
    const b = parseGridOneWay(transpose(grid));
    const score = (x) => (x ? x.persone.length * 100 + x.giorni : -1);
    const best = score(b) > score(a) ? b : a;
    if (!best) return { persone: [], mese: null, anno: null };
    if (!best.mese) {
      const t = detectMonthYear(grid.map((r) => (r || []).map(cellText).join(' ')).join(' '));
      best.mese = t.mese; best.anno = best.anno || t.anno;
    }
    return best;
  }

  /* ---------- PDF e FOTO: parole con coordinate ---------- */

  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  }

  /** Raggruppa le parole in righe in base alla posizione verticale. */
  function groupLines(words) {
    const ws = words
      .filter((w) => String(w.text || '').trim())
      .map((w) => ({ ...w, xc: (w.x0 + w.x1) / 2, yc: (w.y0 + w.y1) / 2, h: Math.max(1, w.y1 - w.y0) }))
      .sort((a, b) => a.yc - b.yc);
    const tol = Math.max(2, median(ws.map((w) => w.h)) * 0.55);
    const lines = [];
    for (const w of ws) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(w.yc - last.yc) <= tol) {
        last.words.push(w);
        last.yc = last.words.reduce((s, x) => s + x.yc, 0) / last.words.length;
      } else {
        lines.push({ yc: w.yc, words: [w] });
      }
    }
    for (const l of lines) l.words.sort((a, b) => a.xc - b.xc);
    return lines;
  }

  /** Retta x = a + b * giorno, stimata dalle posizioni dei numeri nell'intestazione. */
  function fitColumns(run) {
    const n = run.length;
    const mx = run.reduce((s, r) => s + r.day, 0) / n;
    const my = run.reduce((s, r) => s + r.pos, 0) / n;
    let num = 0, den = 0;
    for (const r of run) { num += (r.day - mx) * (r.pos - my); den += (r.day - mx) ** 2; }
    const b = den ? num / den : 1;
    return { a: my - b * mx, b };
  }

  function findLineHeader(lines) {
    let best = null;
    lines.forEach((line, i) => {
      const items = [];
      for (const w of line.words) {
        const d = dayOfOcr(w.text);
        if (d != null) items.push({ pos: w.xc, day: d });
      }
      if (items.length < 5) return;
      const run = bestDayRun(items);
      if (run.length >= 5 && (!best || run.length > best.run.length)) best = { index: i, run };
    });
    if (!best) return null;
    const fit = fitColumns(best.run);
    if (fit.b <= 0) return null;
    best.fit = fit;
    best.firstDay = best.run[0].day;
    // le ultime colonne a volte non vengono lette: ammettiamo fino al 31 (il mese taglia il resto)
    best.lastDay = 31;
    return best;
  }

  /**
   * Dalle foto il lettore a volte unisce le lettere di caselle vicine ("PN" al posto di "P" "N").
   * Se una parola è larga più di una casella, la spezziamo in parti uguali.
   */
  function splitAcrossCells(w, colWidth) {
    const text = String(w.text).trim();
    const width = w.x1 - w.x0;
    // k caselle coperte: la prima lettera sta nella prima, poi una casella in più ogni colWidth
    const k = Math.min(text.length, Math.max(1, Math.round((width - 0.4 * colWidth) / colWidth) + 1));
    if (k < 2 || /\d[.:]\d|-/.test(text)) return [{ text, xc: w.xc }];
    const letter = Math.max(0.2 * colWidth, width - (k - 1) * colWidth);
    const per = text.length / k;
    const parts = [];
    for (let i = 0; i < k; i++) {
      const piece = text.slice(Math.round(i * per), Math.round((i + 1) * per));
      if (piece) parts.push({ text: piece, xc: w.x0 + letter / 2 + i * colWidth });
    }
    return parts;
  }

  /** Correzioni tipiche del lettore su sigle di una lettera. */
  function fixOcrCode(text) {
    return String(text)
      .replace(/^[$§5]$/, 'S')
      .replace(/^[$§]/, 'S')
      .replace(/[&@#!?§$]/g, '');
  }

  function parsePage(words) {
    const lines = groupLines(words);
    const h = findLineHeader(lines);
    if (!h) return null;
    const { a, b } = h.fit;
    const labelLimit = a + b * (h.firstDay - 0.5);
    const persone = [];
    lines.forEach((line, i) => {
      if (i === h.index) return;
      const label = [];
      const turni = {};
      let n = 0;
      for (const w of line.words) {
        if (w.xc < labelLimit) { label.push(String(w.text).trim()); continue; }
        for (const part of splitAcrossCells(w, b)) {
          const day = Math.round((part.xc - a) / b);
          if (day < 1 || day > 31 || day > h.lastDay) continue;
          const c = cleanCode(fixOcrCode(part.text));
          if (!c) continue;
          turni[day] = turni[day] ? turni[day] + ' ' + c : c;
          n++;
        }
      }
      const etichetta = label.join(' ').replace(/[^A-Za-zÀ-ÿ' .\-]/g, '').replace(/\s+/g, ' ').trim();
      if (!n || !looksLikeName(etichetta)) return;
      persone.push({ etichetta, turni });
    });
    return { persone, giorni: h.run.length };
  }

  /**
   * Parole -> persone. words: [{ text, x0, y0, x1, y1, page }]
   * Ogni pagina è letta per conto suo (ognuna ha la sua intestazione).
   */
  function parseWords(words) {
    const pages = new Map();
    for (const w of words) {
      const p = w.page || 1;
      if (!pages.has(p)) pages.set(p, []);
      pages.get(p).push(w);
    }
    const persone = [];
    let giorni = 0;
    for (const ws of pages.values()) {
      const r = parsePage(ws);
      if (r) { persone.push(...r.persone); giorni = Math.max(giorni, r.giorni); }
    }
    const t = detectMonthYear(words.map((w) => w.text).join(' '));
    return { persone, mese: t.mese, anno: t.anno, giorni };
  }

  /** Ordina le persone trovate dalla più alla meno somigliante all'utente. */
  function rankPeople(persone, utente) {
    const tokens = nameTokens(utente);
    return persone
      .map((p, i) => ({ ...p, indice: i, punteggio: scoreName(p.etichetta, tokens) }))
      .sort((x, y) => y.punteggio - x.punteggio || x.indice - y.indice);
  }

  return {
    norm, nameTokens, scoreName, dayOf, cleanCode, detectMonthYear,
    parseGrid, parseWords, groupLines, rankPeople, MESI_NOMI,
  };
});
