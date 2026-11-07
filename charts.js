'use strict';
/* ═══════════════════════════════════════════════════════════════
   Schachtracker: Diagramme als inline-SVG

   Jede Funktion bekommt fertige Zahlen und liefert einen SVG-Text. Keine
   Farben im Code: alles läuft über Klassen, die style.css mit Tokens
   einfärbt. Die Farbe einer Reihe kommt als Klasse an das SVG und steht
   dort als --cc bereit.

   Gezeichnet wird in einem festen Koordinatensystem (Breite 340); das SVG
   skaliert per viewBox auf die Kartenbreite.

   Antippen: Diagramme mit Datenreihe tragen data-n, data-x0 und data-x1.
   app.js rechnet daraus den angetippten Punkt aus (onChartPointer).
   ═══════════════════════════════════════════════════════════════ */

const Charts = (() => {

const W = 340;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fin = (v) => typeof v === 'number' && isFinite(v);
const r1 = (v) => Math.round(v * 10) / 10;

/* Verläufe brauchen eine id, die im ganzen Dokument eindeutig ist. */
let gid = 0;
function areaDef() {
  const id = 'ag' + (++gid);
  return { id, def: `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="ag0"/><stop offset="1" class="ag1"/></linearGradient></defs>` };
}

function scale(d0, d1, p0, p1) {
  const k = (p1 - p0) / ((d1 - d0) || 1);
  return (v) => p0 + (v - d0) * k;
}

/** „Schöne" Achsenwerte: 1, 2 oder 5 mal einer Zehnerpotenz, höchstens
    n + 1 Stück, aber nie nur einer. `unit` rechnet vorher um (3600 für
    Stunden bei Werten in Sekunden). */
function ticks(lo, hi, n, unit) {
  if (!fin(lo) || !fin(hi)) return [];
  const u = unit || 1;
  lo /= u; hi /= u; n = n || 4;
  if (hi === lo) { hi = lo + 1; lo = lo - 1; }
  const p = Math.pow(10, Math.floor(Math.log10((hi - lo) / n)));
  const cands = [];
  for (const q of [p / 10, p, p * 10, p * 100]) for (const m of [1, 2, 5]) cands.push(q * m);
  const count = (s) => Math.floor(hi / s + 1e-9) - Math.ceil(lo / s - 1e-9) + 1;
  let i = cands.findIndex((s) => count(s) <= n + 1);
  if (i < 0) i = cands.length - 1;
  if (count(cands[i]) < 2 && i > 0) i--;
  const step = cands[i], out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-6; v += step) out.push(+(v * u).toFixed(10));
  return out;
}

/** Jede wievielte Beschriftung, damit sich Texte nicht überlappen. */
function labelEvery(labels, step) {
  if (!labels.length) return 1;
  const w = Math.max(...labels.map((l) => String(l || '').length)) * 5.4 + 6;
  return Math.max(1, Math.ceil(w / step));
}

/** x einer Achsenbeschriftung so verschieben, dass sie nicht über den Rand
    des viewBox ragt. Ohne das verliert die letzte Beschriftung ihr Ende. */
function labelX(x, text) {
  const half = String(text == null ? '' : text).length * 2.7 + 1;
  return Math.max(half, Math.min(W - half, x));
}

/** Wertebereich einer oder mehrerer Reihen, mit etwas Luft oben und unten. */
function extent(arrs, zero) {
  let lo = Infinity, hi = -Infinity;
  for (const a of arrs) for (const v of a || []) if (fin(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (lo === Infinity) return null;
  if (zero) lo = Math.min(0, lo);
  const padv = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1;
  return [zero && lo === 0 ? 0 : lo - padv, hi + padv];
}

/** Linienzug; null unterbricht die Linie (Lücke statt erfundener Verbindung). */
function path(xs, ys) {
  let d = '', open = false;
  for (let i = 0; i < ys.length; i++) {
    if (!fin(ys[i]) || !fin(xs[i])) { open = false; continue; }
    d += (open ? 'L' : 'M') + r1(xs[i]) + ' ' + r1(ys[i]);
    open = true;
  }
  return d;
}

/** Fläche unter einem Linienzug bis zur Grundlinie, je Abschnitt ohne Lücke eine. */
function areaPath(xs, ys, base) {
  let out = '', seg = [];
  const flush = () => {
    if (seg.length > 1) {
      out += 'M' + seg.map((i) => `${r1(xs[i])} ${r1(ys[i])}`).join('L')
        + `L${r1(xs[seg[seg.length - 1]])} ${r1(base)}L${r1(xs[seg[0]])} ${r1(base)}Z`;
    }
    seg = [];
  };
  for (let i = 0; i < ys.length; i++) { if (fin(ys[i]) && fin(xs[i])) seg.push(i); else flush(); }
  flush();
  return out;
}

/** Balken mit gerundetem Ende oben (Radius r) und eckig an der Grundlinie. */
function barPath(x, y, w, h, r) {
  if (!(w > 0) || !(h > 0)) return '';
  r = Math.min(r == null ? 4 : r, w / 2, h);
  return `M${r1(x)} ${r1(y + h)}V${r1(y + r)}A${r1(r)} ${r1(r)} 0 0 1 ${r1(x + r)} ${r1(y)}`
    + `H${r1(x + w - r)}A${r1(r)} ${r1(r)} 0 0 1 ${r1(x + w)} ${r1(y + r)}V${r1(y + h)}Z`;
}

const endDot = (x, y) => `<circle class="end-dot" cx="${r1(x)}" cy="${r1(y)}" r="4"/>`;

function yAxis(yt, y, x0, x1, fmtY) {
  // Beschriftungen, die oben über den Rand ragen würden, weglassen
  return yt.filter((v) => y(v) >= 4).map((v) => `<line class="grid" x1="${x0}" x2="${x1}" y1="${r1(y(v))}" y2="${r1(y(v))}"/>`
    + `<text class="ax" x="${x0 - 6}" y="${r1(y(v)) + 3}" text-anchor="end">${esc(fmtY(v))}</text>`).join('');
}

/* ── Halbkreis ──────────────────────────────────────────────── */
/** Gauge von 0 bis o.max als oberer Halbkreis. Nur die Bögen; die Zahl setzt
    app.js als HTML darüber, damit sie aus CSS ihre Schrift bekommt. o.st
    färbt den Bogen. Der Verlauf läuft vom blassen Anfang bis zur Spitze des
    Bogens, auch bei kleinen Werten endet er also kräftig. --len trägt die
    Bogenlänge für die Füll-Animation. */
function gauge(v, o) {
  o = o || {};
  const max = o.max || 100, w = 248, sw = 14;
  const r = (w - sw) / 2, cx = w / 2, cy = r + sw / 2, h = Math.ceil(cy + sw / 2);
  const p = fin(v) ? Math.max(0, Math.min(1, v / max)) : 0;
  const len = Math.PI * r;
  const d = `M${sw / 2} ${cy}A${r} ${r} 0 0 1 ${w - sw / 2} ${cy}`;
  const tip = cx - r * Math.cos(Math.PI * p);
  const id = 'gg' + (++gid);
  let s = `<svg class="gauge st-${esc(o.st || 'off')}" viewBox="0 0 ${w} ${h}" aria-hidden="true">`
    + `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${sw / 2}" y1="0" x2="${r1(Math.max(sw, tip + sw / 2))}" y2="0">`
    + '<stop offset="0" class="gs0"/><stop offset="1" class="gs1"/></linearGradient></defs>'
    + `<path class="gauge-track" d="${d}"/>`;
  if (p > 0) {
    s += `<path class="gauge-fill" d="${d}" stroke="url(#${id})" style="--len:${r1(len)}"`
      + ` stroke-dasharray="${r1(len)}" stroke-dashoffset="${r1(len * (1 - p))}"/>`;
  }
  return s + '</svg>';
}

/* ── Sparkline ──────────────────────────────────────────────── */
/** Kleine Linie für Metrik-Karten. Linie leise, der letzte Punkt in der Farbe
    seines Zustands (o.st); o.band = [lo, hi] als Streifen (Normalbereich);
    o.partial: letzter Wert unfertig, hohler Punkt. o.w: Breite in px. */
function spark(vals, o) {
  o = o || {};
  const w = o.w || 136, h = o.h || 36;
  const ex = extent([vals, o.band || []]);
  if (!ex || vals.filter(fin).length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
  const x = scale(0, vals.length - 1, 5, w - 5), y = scale(ex[0], ex[1], h - 5, 5);
  const xs = vals.map((_, i) => x(i)), ys = vals.map((v) => (fin(v) ? y(v) : null));
  let last = ys.length - 1;
  while (last >= 0 && ys[last] == null) last--;
  const band = o.band && fin(o.band[0]) && fin(o.band[1])
    ? `<rect class="band" x="0" width="${w}" y="${r1(y(o.band[1]))}" height="${r1(Math.max(1, y(o.band[0]) - y(o.band[1])))}" rx="3"/>` : '';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true">${band}`
    + `<path class="ln" d="${path(xs, ys)}"/>`
    + (last >= 0 ? `<circle class="end st-${esc(o.st || 'off')}${o.partial ? ' partial' : ''}" cx="${r1(xs[last])}" cy="${r1(ys[last])}" r="3.5"/>` : '')
    + '</svg>';
}

/* ── Linie mit Verlaufsfläche ───────────────────────────────── */
/** o: { vals, labels, lo, hi, fmtY, h, zero, unit, cls }; lo/hi: Normalband je Punkt */
function line(o) {
  const h = o.h || 180, x0 = 36, x1 = W - 8, top = 10, bot = h - 20;
  const n = o.vals.length;
  const ex = extent([o.vals, o.lo, o.hi], o.zero);
  if (!ex || o.vals.filter(fin).length < 2) return '<div class="chart-empty">Keine Werte im Zeitraum</div>';
  const step = (x1 - x0) / n, x = (i) => x0 + step * (i + 0.5);
  const y = scale(ex[0], ex[1], bot, top);
  const xs = o.vals.map((_, i) => x(i));
  const yv = (arr) => arr.map((v) => (fin(v) ? y(v) : null));
  const ys = yv(o.vals);
  const a = areaDef();
  let s = `<svg class="chart-svg${o.cls ? ' ' + esc(o.cls) : ''}" viewBox="0 0 ${W} ${h}" data-n="${n}" data-x0="${x0}" data-x1="${x1}">${a.def}`;
  s += yAxis(ticks(ex[0], ex[1], 4, o.unit), y, x0, x1, o.fmtY || String);
  s += `<path class="area" fill="url(#${a.id})" d="${areaPath(xs, ys, bot)}"/>`;
  // Das Normalband über der Fläche, sonst ginge es in ihr unter
  if (o.lo && o.hi) {
    const lo = yv(o.lo), hi = yv(o.hi);
    let d = '', seg = [];
    const flush = () => {
      if (seg.length > 1) d += 'M' + seg.map((i) => `${r1(xs[i])} ${r1(hi[i])}`).join('L')
        + 'L' + seg.slice().reverse().map((i) => `${r1(xs[i])} ${r1(lo[i])}`).join('L') + 'Z';
      seg = [];
    };
    for (let i = 0; i < n; i++) { if (lo[i] != null && hi[i] != null) seg.push(i); else flush(); }
    flush();
    s += `<path class="band" d="${d}"/>`;
  }
  s += `<path class="ln-main" d="${path(xs, ys)}"/>`;
  let li = n - 1;
  while (li >= 0 && ys[li] == null) li--;
  if (li >= 0) s += endDot(xs[li], ys[li]);
  const labels = o.labels || [];
  const every = labelEvery(labels, step);
  labels.forEach((l, i) => {
    // Von hinten zählen: die letzte Beschriftung steht immer da
    if ((n - 1 - i) % every === 0) s += `<text class="ax" x="${r1(labelX(x(i), l))}" y="${h - 4}" text-anchor="middle">${esc(l)}</text>`;
  });
  s += `<line class="cursor hidden" x1="0" x2="0" y1="${top}" y2="${bot}"/>`;
  return s + '</svg>';
}

/* ── Balken ─────────────────────────────────────────────────── */
/** items: [{ label, v, cur }]; cur hebt den laufenden Zeitraum hervor. */
function bars(items, o) {
  o = o || {};
  const h = o.h || 160, x0 = 36, x1 = W - 4, top = 16, bot = h - 20;
  const ex = extent([items.map((it) => it.v)], true);
  if (!ex || !items.length) return '<div class="chart-empty">Keine Werte im Zeitraum</div>';
  const y = scale(0, ex[1], bot, top);
  const step = (x1 - x0) / items.length, bw = Math.min(24, step * 0.66);
  let s = `<svg class="chart-svg" viewBox="0 0 ${W} ${h}" data-n="${items.length}" data-x0="${x0}" data-x1="${x1}">`;
  s += yAxis(ticks(0, ex[1], 3, o.unit), y, x0, x1, o.fmtY || String);
  const every = labelEvery(items.map((it) => it.label), step), last = items.length - 1;
  items.forEach((it, i) => {
    const cx = x0 + step * (i + 0.5);
    if (fin(it.v) && it.v > 0) {
      s += `<path class="bar${it.cur ? ' cur' : ''}" d="${barPath(cx - bw / 2, y(it.v), bw, Math.max(0.5, bot - y(it.v)), Math.min(4, bw / 2))}"/>`;
    }
    if ((last - i) % every === 0) s += `<text class="ax${it.cur ? ' cur' : ''}" x="${r1(labelX(cx, it.label))}" y="${h - 4}" text-anchor="middle">${esc(it.label)}</text>`;
  });
  s += `<line class="cursor hidden" x1="0" x2="0" y1="${top}" y2="${bot}"/>`;
  return s + '</svg>';
}

/* ── Gestapelte Balken ──────────────────────────────────────── */
/** items: [{ label, parts: [{k, v}], cur }] — die Teile von unten nach oben.
    `k` wird zur Klasse `p-<k>` am Teil, die style.css mit dem Token der
    Kategorie einfärbt. Zwischen den Teilen 2 px Fuge, nur der oberste Teil
    ist oben gerundet; der laufende Zeitraum (cur) ist blasser, weil er noch
    nicht fertig ist. */
function stack(items, o) {
  o = o || {};
  const h = o.h || 160, x0 = 36, x1 = W - 4, top = 16, bot = h - 20;
  const totals = items.map((it) => (it.parts || []).reduce((s, p) => s + (fin(p.v) ? p.v : 0), 0));
  const ex = extent([totals], true);
  if (!ex || !items.length) return '<div class="chart-empty">Keine Werte im Zeitraum</div>';
  const y = scale(0, ex[1], bot, top);
  const step = (x1 - x0) / items.length, bw = Math.min(24, step * 0.66);
  let s = `<svg class="chart-svg" viewBox="0 0 ${W} ${h}" data-n="${items.length}" data-x0="${x0}" data-x1="${x1}">`;
  s += yAxis(ticks(0, ex[1], 3, o.unit), y, x0, x1, o.fmtY || String);
  const every = labelEvery(items.map((it) => it.label), step), last = items.length - 1;
  items.forEach((it, i) => {
    const cx = x0 + step * (i + 0.5), x = cx - bw / 2;
    const parts = (it.parts || []).filter((p) => fin(p.v) && p.v > 0);
    let acc = 0;
    parts.forEach((p, j) => {
      const yBot = y(acc), yTop = y(acc + p.v);
      acc += p.v;
      const isTop = j === parts.length - 1;
      const yy = yTop + (isTop ? 0 : 2);              // Fuge sitzt über dem Teil
      const hh = Math.max(0.5, yBot - yy);
      const cls = `part p-${esc(p.k)}${it.cur ? ' cur' : ''}`;
      s += isTop
        ? `<path class="${cls}" d="${barPath(x, yy, bw, hh, Math.min(4, bw / 2))}"/>`
        : `<rect class="${cls}" x="${r1(x)}" y="${r1(yy)}" width="${r1(bw)}" height="${r1(hh)}"/>`;
    });
    if ((last - i) % every === 0) s += `<text class="ax${it.cur ? ' cur' : ''}" x="${r1(labelX(cx, it.label))}" y="${h - 4}" text-anchor="middle">${esc(it.label)}</text>`;
  });
  s += `<line class="cursor hidden" x1="0" x2="0" y1="${top}" y2="${bot}"/>`;
  return s + '</svg>';
}

return { gauge, spark, line, bars, stack, ticks, esc };
})();

if (typeof module === 'object' && module.exports) module.exports = Charts;
