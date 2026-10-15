/*
 * Lettura dei file: Excel, PDF e foto.
 * Tutto avviene sul dispositivo: i file non vengono inviati a nessun server.
 * Le librerie (SheetJS, pdf.js, Tesseract) vengono scaricate solo quando servono.
 */
(function () {
  'use strict';

  const LIB = {
    xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    pdf: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs',
    pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs',
    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  };

  const loaded = {};
  function loadScript(url) {
    if (!loaded[url]) {
      loaded[url] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = resolve;
        s.onerror = () => { delete loaded[url]; reject(new Error('Impossibile scaricare un componente. Controlla la connessione.')); };
        document.head.appendChild(s);
      });
    }
    return loaded[url];
  }

  /* ---------------- EXCEL ---------------- */

  async function leggiExcel(file) {
    await loadScript(LIB.xlsx);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const risultati = [];
    for (const nome of wb.SheetNames) {
      const grid = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: '' });
      const r = TurniParser.parseGrid(grid);
      if (!r.mese) {
        const t = TurniParser.detectMonthYear(nome);
        r.mese = t.mese; r.anno = r.anno || t.anno;
      }
      r.foglio = nome;
      if (r.persone.length) risultati.push(r);
    }
    if (!risultati.length) return { persone: [], mese: null, anno: null };
    // più fogli: uniamo le persone, il mese lo prende dal primo che lo indica
    const out = { persone: [], mese: null, anno: null };
    for (const r of risultati) {
      const pref = risultati.length > 1 ? `[${r.foglio}] ` : '';
      for (const p of r.persone) out.persone.push({ ...p, etichetta: pref + p.etichetta, mese: r.mese, anno: r.anno });
      out.mese = out.mese || r.mese;
      out.anno = out.anno || r.anno;
    }
    return out;
  }

  /* ---------------- PDF ---------------- */

  let pdfjs = null;
  async function caricaPdfJs() {
    if (!pdfjs) {
      pdfjs = await import(LIB.pdf);
      pdfjs.GlobalWorkerOptions.workerSrc = LIB.pdfWorker;
    }
    return pdfjs;
  }

  /** Divide un blocco di testo PDF ("M P N") in parole con la loro posizione stimata. */
  function spezzaItem(it, page, pageHeight) {
    const [, , , , e, f] = it.transform;
    const h = Math.abs(it.height || it.transform[3] || 10);
    const y1 = pageHeight - f, y0 = y1 - h;
    const str = it.str;
    const out = [];
    const re = /\S+/g;
    let m;
    const cw = str.length ? it.width / str.length : 0;
    while ((m = re.exec(str))) {
      out.push({ text: m[0], x0: e + m.index * cw, x1: e + (m.index + m[0].length) * cw, y0, y1, page });
    }
    return out;
  }

  async function leggiPdf(file, onProgress) {
    const lib = await caricaPdfJs();
    const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const words = [];
    const daLeggereConOcr = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const pw = [];
      for (const it of tc.items) if (it.str && it.str.trim()) pw.push(...spezzaItem(it, p, vp.height));
      if (pw.length >= 20) words.push(...pw);
      else daLeggereConOcr.push(page); // PDF scansionato: è un'immagine
    }
    let res = TurniParser.parseWords(words);
    if (daLeggereConOcr.length && res.persone.length === 0) {
      // PDF fatto da scansione: lo trasformiamo in immagine e lo leggiamo come una foto
      const all = [];
      let i = 0;
      for (const page of daLeggereConOcr) {
        const vp = page.getViewport({ scale: 3 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const pagina = ++i;
        const w = await ocrCanvas(c, (x) => onProgress && onProgress((pagina - 1 + x) / daLeggereConOcr.length));
        all.push(...w.map((x) => ({ ...x, page: pagina })));
      }
      res = TurniParser.parseWords(all);
      res.daOcr = true;
    }
    return res;
  }

  /* ---------------- FOTO ---------------- */

  async function leggiFoto(file, onProgress) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    const words = await ocrCanvas(c, onProgress);
    const res = TurniParser.parseWords(words);
    res.daOcr = true;
    return res;
  }

  /**
   * Prepara la foto per la lettura:
   * 1. la porta a una dimensione fissa e in bianco e nero
   * 2. separa l'inchiostro dallo sfondo anche con luce non uniforme
   * 3. la raddrizza se è storta
   * 4. cancella le linee della tabella, che confondono il lettore
   */
  function preparaImmagine(src) {
    const LATO = 2400;
    const s = LATO / Math.max(src.width, src.height);
    let W = Math.round(src.width * s), H = Math.round(src.height * s);
    let c = document.createElement('canvas');
    c.width = W; c.height = H;
    let ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, W, H);

    let ink = inchiostro(ctx.getImageData(0, 0, W, H), W, H);

    const ang = angoloStorto(ink, W, H);
    if (Math.abs(ang) > 0.1) {
      const r = document.createElement('canvas');
      r.width = W; r.height = H;
      const rctx = r.getContext('2d', { willReadFrequently: true });
      rctx.fillStyle = '#fff'; rctx.fillRect(0, 0, W, H);
      rctx.translate(W / 2, H / 2);
      rctx.rotate((ang * Math.PI) / 180);
      rctx.drawImage(c, -W / 2, -H / 2);
      c = r; ctx = rctx;
      ink = inchiostro(ctx.getImageData(0, 0, W, H), W, H);
    }

    togliLinee(ink, W, H, Math.round(W * 0.025));

    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const octx = out.getContext('2d');
    const img = octx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const v = ink[i] ? 0 : 255;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  /** Pixel "inchiostro": più scuri della media locale (soglia adattiva con immagine integrale). */
  function inchiostro(imgData, W, H) {
    const d = imgData.data;
    const g = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    const I = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) {
        row += g[y * W + x];
        I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row;
      }
    }
    const R = 25;
    const ink = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1);
        const sum = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
        const mean = sum / ((x1 - x0) * (y1 - y0));
        ink[y * W + x] = g[y * W + x] < mean - 18 ? 1 : 0;
      }
    }
    return ink;
  }

  /** Angolo (gradi) che rende le righe del testo più "orizzontali". */
  function angoloStorto(ink, W, H) {
    const pts = [];
    for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) if (ink[y * W + x]) pts.push(x - W / 2, y - H / 2);
    if (pts.length < 100) return 0;
    let best = 0, bestVar = -1;
    const bins = Math.ceil((W + H) / 4) + 4;
    for (let a = -6; a <= 6.001; a += 0.25) {
      const t = (a * Math.PI) / 180, sn = Math.sin(t), cs = Math.cos(t);
      const hist = new Float64Array(bins);
      for (let i = 0; i < pts.length; i += 2) {
        const yy = pts[i] * sn + pts[i + 1] * cs;
        hist[Math.round(yy / 4) + (bins >> 1)]++;
      }
      let m = 0;
      for (const v of hist) m += v;
      m /= bins;
      let v2 = 0;
      for (const v of hist) v2 += (v - m) * (v - m);
      if (v2 > bestVar) { bestVar = v2; best = a; }
    }
    return best;
  }

  /** Cancella le linee orizzontali e verticali più lunghe di L pixel (la griglia della tabella). */
  function togliLinee(ink, W, H, L) {
    const linea = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      let start = -1;
      for (let x = 0; x <= W; x++) {
        const on = x < W && ink[y * W + x];
        if (on && start < 0) start = x;
        if (!on && start >= 0) {
          if (x - start >= L) for (let k = start; k < x; k++) linea[y * W + k] = 1;
          start = -1;
        }
      }
    }
    for (let x = 0; x < W; x++) {
      let start = -1;
      for (let y = 0; y <= H; y++) {
        const on = y < H && ink[y * W + x];
        if (on && start < 0) start = y;
        if (!on && start >= 0) {
          if (y - start >= L) for (let k = start; k < y; k++) linea[k * W + x] = 1;
          start = -1;
        }
      }
    }
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (linea[i] || linea[i - 1] || linea[i + 1] || linea[i - W] || linea[i + W]) ink[i] = 0;
      }
    }
  }

  async function ocrCanvas(canvas, onProgress) {
    await loadScript(LIB.tesseract);
    const pulita = preparaImmagine(canvas);
    const worker = await Tesseract.createWorker('ita', 1, {
      logger: (m) => { if (m.status === 'recognizing text' && onProgress) onProgress(m.progress); },
    });
    try {
      await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
      const { data } = await worker.recognize(pulita, {}, { blocks: true, text: false });
      return paroleDaTesseract(data);
    } finally {
      await worker.terminate();
    }
  }

  function paroleDaTesseract(data) {
    let words = data.words;
    if (!words || !words.length) {
      words = [];
      for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) words.push(...(l.words || []));
    }
    return words
      .filter((w) => w.text && w.text.trim())
      .map((w) => ({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, page: 1 }));
  }

  /* ---------------- ingresso unico ---------------- */

  function tipoFile(file) {
    const n = (file.name || '').toLowerCase();
    const t = file.type || '';
    if (t === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
    if (t.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/.test(n)) return 'foto';
    if (/\.(xlsx|xlsm|xls|ods|csv)$/.test(n) || /sheet|excel|csv/.test(t)) return 'excel';
    return 'sconosciuto';
  }

  async function leggiFile(file, onProgress) {
    const tipo = tipoFile(file);
    if (tipo === 'excel') return { tipo, ...(await leggiExcel(file)) };
    if (tipo === 'pdf') return { tipo, ...(await leggiPdf(file, onProgress)) };
    if (tipo === 'foto') return { tipo, ...(await leggiFoto(file, onProgress)) };
    throw new Error('Formato non riconosciuto. Usa un file Excel, un PDF o una foto.');
  }

  window.Lettura = { leggiFile, tipoFile };
})();
