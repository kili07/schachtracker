'use strict';
/* ═══════════════════════════════════════════════════════════════
   Schachtracker: Logik

   Gerechnet wird in sync.js (ohne DOM, in Node testbar). Diese Datei holt
   die Werte dort ab und zeichnet sie.

   Aufbau:
   1. Konstanten, Helfer, Icons
   2. Daten: Grundstruktur, Laden, Speichern, Theme
   3. Navigation und Rendern
   4. Bewegung
   5. Bausteine (Hero, Metrik-Karte, Pill, Kennwerte, Diagrammkasten)
   6. Ansichten: Heute, Rating, Spielzeit, Taktik
   7. Sheet und Dialoge
   8. Abgleich mit chess.com
   9. Einstellungen, Backup
   10. Zurück-Taste
   11. Updates, Installieren
   12. Verdrahten, Start
   ═══════════════════════════════════════════════════════════════ */

/* ── 1. Konstanten, Helfer, Icons ───────────────────────────── */
const KEY = 'schach.v1';
/* Bei jeder Änderung hochzählen: wird in den Einstellungen angezeigt, damit
   sich auf dem Handy prüfen lässt, welche Fassung wirklich läuft. */
const APP_VERSION = '1.1.1';

const THEME_KEY = 'schach.theme';
/* `bar` ist die Hintergrundfarbe des Themes und landet im
   <meta name="theme-color">, damit die Systemleiste des Handys mitzieht.
   Muss mit --bg in tokens.css übereinstimmen (einzige erlaubte feste Farbe). */
const THEMES = {
  dark:  { label: 'Dunkel', bar: '#0E1116' },
  light: { label: 'Hell',   bar: '#F4F6F8' },
};

/* Wählbare Historie in Monaten; 0 heißt „alles, was chess.com hat". */
const HIST = [3, 12, 0];
/* Zeitraum-Knöpfe in Tagen; 0 heißt „alles, was gespeichert ist" — wie bei
   HIST, damit beide Stellen dieselbe Null bedeuten. */
const RANGES_RATING = [[30, '30 Tage'], [90, '3 Monate'], [365, '1 Jahr'], [0, 'Alles']];
const RANGES_TIME = [[7, 'Woche'], [30, 'Monat'], [365, 'Jahr'], [0, 'Alles']];
/* Nach wie langer Pause beim Start von allein abgeglichen wird */
const SYNC_IDLE = 15 * 60 * 1000;

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fin = (v) => typeof v === 'number' && isFinite(v);

/* Formatierung immer über Intl, nie von Hand mit toFixed und Komma-Ersatz. */
const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nfs = new Intl.NumberFormat('de-DE', { signDisplay: 'exceptZero', maximumFractionDigits: 0 });
const dfLong = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
const dfMed = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
const dfShort = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' });
const dfMonth = new Intl.DateTimeFormat('de-DE', { month: 'short' });
/* Über ein Jahr hinaus muss das Jahr an die Beschriftung, sonst steht
   „Nov." mehrfach auf derselben Achse. */
const dfMonthYear = new Intl.DateTimeFormat('de-DE', { month: 'short', year: '2-digit' });
const tfTime = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

/* Eingaben können deutsches Komma enthalten, parseFloat allein verschluckt es. */
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };

/** Dauer als Text: unter einer Stunde in Minuten, darüber in Stunden mit
    einer Nachkommastelle. Beides ohne Sekunden — die täuschen Genauigkeit vor. */
function fmtDur(sec) {
  if (!fin(sec) || sec < 30) return '0 min';
  if (sec < 3600) return nf0.format(Math.round(sec / 60)) + ' min';
  return nf1.format(sec / 3600) + ' h';
}

/** Achse für Sekundenwerte: bis zwei Stunden in Minuten, darüber in Stunden.
    `unit` sorgt für „schöne" Achsenwerte in der angezeigten Einheit. */
function yTime(maxSec) {
  return maxSec >= 7200
    ? { unit: 3600, fmtY: (v) => (Number.isInteger(v / 3600) ? nf0 : nf1).format(v / 3600) }
    : { unit: 60, fmtY: (v) => nf0.format(v / 60) };
}

/** Ganzzahlige Prozentanteile, die sich auf 100 summieren (Methode der
    größten Reste). Einzeln gerundet kämen sonst Summen wie 101 % heraus. */
function shares(vals) {
  const sum = vals.reduce((a, b) => a + b, 0);
  if (!sum) return vals.map(() => 0);
  const exact = vals.map((v) => (v / sum) * 100);
  const out = exact.map(Math.floor);
  let rest = 100 - out.reduce((a, b) => a + b, 0);
  exact.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => { if (rest > 0) { out[i]++; rest--; } });
  return out;
}

/** Zahl mit Einheit in der richtigen Zahlform: pl(1, 'Partie', 'Partien'). */
const pl = (n, one, many) => nf0.format(n) + ' ' + (Math.abs(n) === 1 ? one : many);

/** Startzeile über einem Diagramm: in welcher Einheit die Achse steht und
    dass man ablesen kann. Ohne sie stünde die y-Achse ohne Bezug da. */
const axisNote = (yt) => `<span>${yt.unit === 3600 ? 'Stunden' : 'Minuten'} je Balken · Antippen zum Ablesen</span>`;

const dayDate = (key) => { const [y, m, d] = String(key).split('-').map(Number); return new Date(y, m - 1, d); };

/** Zeitpunkt der ältesten gespeicherten Partie. Grundlage jeder
    Allzeit-Ansicht: weiter zurück als bis hierhin gibt es nichts.
    Die Liste ist zwar sortiert, ein geladenes Backup muss es aber nicht
    sein — deshalb das Minimum statt games[0]. */
const firstGame = () => db.games.reduce((m, g) => Math.min(m, g.t), Infinity);

/** „Alles" zeigt nur, was auch gespeichert ist: die Historie in den
    Einstellungen begrenzt den Datensatz. Steht sie nicht auf „Alles", sagt
    diese Zeile offen, wo der Verlauf wirklich endet. */
const histNote = () => (db.hist
  ? hint(`„Alles" reicht so weit, wie Daten da sind: gespeichert sind die <b>letzten ${esc(pl(db.hist, 'Monat', 'Monate'))}</b>. Für den vollen Verlauf in den Einstellungen die Historie auf „Alles" stellen und abgleichen.`)
  : '');

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

/* Icons: Lucide (ISC-Lizenz, licenses/lucide-ISC.txt), Pfade unverändert
   übernommen. Neue Symbole von lucide.dev holen, nie aus dem Gedächtnis
   schreiben. Welches Symbol wofür steht, hält DECISIONS.md fest. */
const lucide = (paths, cls) => `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON = {
  check: lucide('<path d="M20 6 9 17l-5-5"/>'),
  chev:  lucide('<path d="m9 18 6-6-6-6"/>', 'chev'),
  up:    lucide('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>'),
  down:  lucide('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>'),
  info:  lucide('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
  warn:  lucide('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
  clock: lucide('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),
  swords: lucide('<path d="M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z"/><path d="m2.5 21.5 1.4-1.4"/><path d="m20.1 3.9 1.4-1.4"/><path d="M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z"/><path d="m9.6 14.4 4.8-4.8"/>'),
};

/* ── 2. Daten ───────────────────────────────────────────────── */
/** Frische Grundstruktur. Basis beim Laden und beim Backup-Import, damit
    später ergänzte Felder in alten Daten nicht fehlen.
    Die Felder sind kurz benannt, weil tausende Partien im localStorage
    liegen, den sich alle Apps der Domain teilen (sync.js, Abschnitt 1). */
const blank = () => ({
  v: 1,
  user: '',           // chess.com-Konto, in der Ersteinrichtung gesetzt; in API-Adressen klein
  games: [],          // {t, c, r, d, w, x} je Partie, aufsteigend nach t
  snaps: [],          // Taktik-Schnappschüsse, einer je Tag
  months: {},         // '2026-10': Partienzahl — fertige Monate nie neu laden
  cur: {},            // aktuelle Ratings und Bilanz je Zeitklasse aus /stats
  goals: { min: 30, games: 10 },   // Tagesziele: Minuten Spielzeit, Partien
  cls: 'z',           // zuletzt gewählte Zeitklasse
  hist: 12,           // Monate Historie
  lastSync: 0,
  lastBackup: null,
  theme: 'dark',
});

let db = blank();

/** Fremden Datensatz (aus localStorage oder Backup) auf die aktuelle Struktur
    bringen. Object.assign allein reicht nicht: es ersetzt verschachtelte
    Objekte im Ganzen, ein älteres Unterobjekt ohne ein neues Feld würde die
    Vorgabe also löschen statt ergänzen. Daten haben Vorrang vor Vorgabe. */
function normalize(src) {
  const base = blank();
  const d = Object.assign(blank(), src || {});
  delete d.meta;                                   // Kopfdaten des Backups gehören nicht in die Daten

  d.user = String(d.user || '').trim().toLowerCase();
  d.games = (Array.isArray(d.games) ? d.games : [])
    .filter((g) => g && fin(g.t) && g.c)
    .sort((a, b) => a.t - b.t);
  d.snaps = (Array.isArray(d.snaps) ? d.snaps : [])
    .filter((s) => s && s.d)
    .sort((a, b) => String(a.d).localeCompare(String(b.d)));
  if (!d.months || typeof d.months !== 'object') d.months = {};
  if (!d.cur || typeof d.cur !== 'object') d.cur = {};

  d.goals = Object.assign({}, base.goals, d.goals || {});
  if (!(d.goals.min > 0)) d.goals.min = base.goals.min;
  if (!(d.goals.games > 0)) d.goals.games = base.goals.games;
  d.goals.min = Math.min(600, Math.round(d.goals.min));
  d.goals.games = Math.min(200, Math.round(d.goals.games));

  if (HIST.indexOf(d.hist) < 0) d.hist = base.hist;
  if (Sync.CLS_ORDER.indexOf(d.cls) < 0) d.cls = base.cls;
  if (!THEMES[d.theme]) d.theme = base.theme;
  if (!fin(d.lastSync)) d.lastSync = 0;
  return d;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    db = normalize(JSON.parse(raw));
  } catch (e) { console.warn('Laden fehlgeschlagen', e); }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { toast('Speichern fehlgeschlagen!'); console.error(e); }
}

/** Theme aufs Dokument legen. Der Spiegel in THEME_KEY ist das, was das
    Startskript in index.html liest; ohne ihn flackert der Start. */
function applyTheme(t) {
  if (!THEMES[t]) t = 'dark';
  db.theme = t;
  document.documentElement.dataset.theme = t;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = THEMES[t].bar;
  try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* nicht schlimm */ }
}

/* ── 3. Navigation und Rendern ──────────────────────────────── */
const TITLES = { heute: 'Heute', rating: 'Rating', zeit: 'Spielzeit', taktik: 'Taktik' };
let view = 'heute';

/* Zustand der Ansichten (Tab, Zeitraum) liegt nicht im Datensatz, sondern in
   sessionStorage: Lädt die App wegen eines Updates neu, landet man wieder
   dort, wo man war. Ein frischer Start beginnt bei „Heute". */
const VIEW_KEY = 'schach.view';
let rRange = 90;                      // Zeitraum der Rating-Ansicht in Tagen
let tRange = 30;                      // Zeitraum der Spielzeit-Ansicht in Tagen

function saveViewState() {
  try { sessionStorage.setItem(VIEW_KEY, JSON.stringify({ view, rRange, tRange })); }
  catch (e) { /* privater Modus o.ä.: dann eben wieder „Heute" */ }
}
function restoreViewState() {
  let s;
  try { s = JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null'); } catch (e) { s = null; }
  if (!s || !TITLES[s.view]) return 'heute';
  if (RANGES_RATING.some((r) => r[0] === s.rRange)) rRange = s.rRange;
  if (RANGES_TIME.some((r) => r[0] === s.tRange)) tRange = s.tRange;
  return s.view;
}

function nav(v) {
  view = v;
  $$('.view').forEach((s) => s.classList.toggle('hidden', s.id !== 'view-' + v));
  $$('.tabbar button[data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === v));
  $('#viewTitle').textContent = TITLES[v] || '';
  window.scrollTo(0, 0);
  armBack();                    // Zurück soll auf „Heute" führen, nicht aus der App
  animNext = true;              // ein Wechsel durch den Benutzer darf animieren
  render();
}

/* Ablesefunktionen der Diagramme: Schlüssel mit 'v' gehören zur Ansicht
   (render() räumt sie ab), mit 's' zum Sheet. */
const readers = new Map();
let rid = 0;

/** Alles neu zeichnen. Bei den Datenmengen einer Handy-App ist gezieltes
    Aktualisieren unnötige Komplexität: einmal neu rendern ist schnell genug
    und kann nicht aus dem Tritt geraten. */
function render() {
  for (const k of readers.keys()) if (k[0] === 'v') readers.delete(k);
  if (view === 'heute') renderHeute();
  else if (view === 'rating') renderRating();
  else if (view === 'zeit') renderZeit();
  else if (view === 'taktik') renderTaktik();
  renderTopSub();
  if (animNext) { animNext = false; runAnims($('#view-' + view)); }
  saveViewState();
}

/** Zweite Zeile der Kopfleiste: Konto und Stand der Daten. Beim Abgleich
    zeigt sie den Fortschritt, damit der erste Sync nicht wie ein Hänger wirkt. */
function renderTopSub(text) {
  const el = $('#topSub');
  if (!el) return;
  if (text) { el.textContent = text; return; }
  if (!db.user) { el.textContent = 'Kein chess.com-Konto eingerichtet'; return; }
  const d = db.lastSync ? new Date(db.lastSync) : null;
  const heute = d && Sync.dateKey(d) === Sync.dateKey(new Date());
  el.textContent = db.user + (d ? ' · Stand ' + (heute ? tfTime.format(d) : dfMed.format(d)) : ' · noch nicht abgeglichen');
}

/* ── 4. Bewegung ────────────────────────────────────────────────
   Zahlen zählen hoch, Gauges und Balken füllen sich, in 600 ms mit
   ease-out (dieselbe Kurve wie --ease-out in tokens.css). Nur nach einem
   Wechsel durch den Benutzer, nicht wenn die App zwischendurch neu zeichnet.
   Im HTML steht immer der Endwert: Läuft nichts (reduzierte Bewegung, Seite
   im Hintergrund), stimmt die Anzeige trotzdem. */
let animNext = true;
const ANIM_MS = 600;
const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/** Zahl, die beim ersten Zeichnen hochzählt. Im HTML steht der fertige Text.
    Nur für ganze Zahlen oder eine Nachkommastelle (dec), nie für Uhrzeiten. */
function countNum(v, dec) {
  const to = dec ? Math.round(v * 10) / 10 : Math.round(v);
  return `<span data-count="${to}"${dec ? ' data-dec="1"' : ''}>${esc((dec ? nf1 : nf0).format(to))}</span>`;
}

function runAnims(root) {
  if (!root || reduceMotion() || document.hidden) return;
  root.classList.add('anim');
  // Wieder abnehmen: Neuzeichnen durch die App soll die Linien nicht erneut einblenden
  setTimeout(() => root.classList.remove('anim'), ANIM_MS + 100);
  $$('.gauge-fill, .meter > i', root).forEach((e) => e.classList.add('anim'));
  const items = $$('[data-count]', root).map((e) => ({ e, end: e.textContent, to: +e.dataset.count, dec: !!e.dataset.dec }));
  if (!items.length) return;
  const show = (it, v) => { it.e.textContent = (it.dec ? nf1 : nf0).format(v); };
  let done = false;
  const finish = () => { if (!done) { done = true; items.forEach((it) => { it.e.textContent = it.end; }); } };
  const t0 = performance.now();
  const step = (now) => {
    if (done) return;
    const p = Math.min(1, (now - t0) / ANIM_MS);
    if (p >= 1) { finish(); return; }
    const k = 1 - Math.pow(1 - p, 3);            // ease-out, wie --ease-out
    items.forEach((it) => show(it, it.to * k));
    requestAnimationFrame(step);
  };
  items.forEach((it) => show(it, 0));
  requestAnimationFrame(step);
  // Falls requestAnimationFrame nicht kommt (Tab im Hintergrund): Endwerte trotzdem setzen
  setTimeout(finish, ANIM_MS + 250);
}

/* ── 5. Bausteine ───────────────────────────────────────────── */
/** Diagramm in einen Kasten mit Ablesezeile setzen. reader(i) liefert HTML
    für Punkt i oder null. scope 's' für Diagramme im Sheet. */
function chartBox(svg, reader, initial, scope) {
  const id = (scope || 'v') + (++rid);
  if (reader) readers.set(id, reader);
  return `<div class="chart" data-cid="${id}"><div class="readout">${initial || ''}</div>${svg}</div>`;
}

function onChartPointer(e) {
  const svg = e.target.closest && e.target.closest('.chart svg[data-n]');
  if (!svg) return;
  const box = svg.closest('.chart');
  const fn = readers.get(box.dataset.cid);
  if (!fn) return;
  const r = svg.getBoundingClientRect();
  const vbw = svg.viewBox.baseVal.width || 340;
  const x = ((e.clientX - r.left) / r.width) * vbw;
  const n = +svg.dataset.n, x0 = +svg.dataset.x0, x1 = +svg.dataset.x1;
  const i = Math.max(0, Math.min(n - 1, Math.floor(((x - x0) / (x1 - x0)) * n)));
  const html = fn(i);
  if (html == null) return;
  box.querySelector('.readout').innerHTML = html;
  const c = svg.querySelector('.cursor');
  if (c) {
    const cx = x0 + ((x1 - x0) * (i + 0.5)) / n;
    c.setAttribute('x1', cx); c.setAttribute('x2', cx);
    c.classList.remove('hidden');
  }
}

/** Segmented Control für 2 bis 5 feste Optionen. */
const seg = (name, opts, cur) => `<div class="seg">${opts.map(([v, l]) =>
  `<button data-seg="${esc(name)}" data-v="${esc(v)}" class="${String(v) === String(cur) ? 'on' : ''}" aria-pressed="${String(v) === String(cur)}">${esc(l)}</button>`).join('')}</div>`;

/** Veränderung als Pill: Pfeil und Zahl, ohne Einheit (die steht am Wert).
    Grau, wenn die Richtung egal ist (dir 0) oder die Änderung unter einem
    Viertel der üblichen Schwankung liegt (noise). */
function deltaPill(d, dir, noise, unit) {
  if (!fin(d)) return '';
  if (nf0.format(Math.abs(d)) === '0') return '<span class="pill st-off" aria-label="unverändert">±0</span>';
  const st = !dir || (fin(noise) && Math.abs(d) < noise * 0.25) ? 'off' : d * dir > 0 ? 'good' : 'bad';
  const txt = nf0.format(Math.abs(d)) + (unit || '');
  return `<span class="pill st-${st}" aria-label="${esc((d > 0 ? 'plus ' : 'minus ') + txt)}">${d > 0 ? ICON.up : ICON.down}${esc(txt)}</span>`;
}

/** Hero: die eine Zahl im Halbkreis, darunter ein Wort zur Einordnung.
    `max` ist das Tagesziel, die Enden beschriften sich danach. */
function heroCard(label, value, unit, v, max, st, word) {
  return `<div class="card hero"><div class="lbl">${esc(label)}</div>
    <div class="gauge-wrap">${Charts.gauge(v, { st, max })}
      <div class="gauge-val"><span class="num${fin(v) ? '' : ' na'}">${value}${unit ? `<small>${esc(unit)}</small>` : ''}</span></div></div>
    <div class="gauge-ends"><span>0</span><span>${esc(nf0.format(max))}</span></div>
    ${word ? `<p class="hero-line">${word}</p>` : ''}</div>`;
}

/** Reihe aus bis zu drei Kennwerten unter dem Hero. */
const statsRow = (items) => `<div class="stats">${items.map((it) =>
  `<div><span class="lbl">${esc(it[0])}</span><span class="num${it[2] ? ' ' + it[2] : ''}">${it[1]}</span></div>`).join('')}</div>`;

/** Metrik-Karte: Label, Wert, Sparkline mit Pill am Ende. Öffnet beim
    Antippen die Rating-Ansicht der Zeitklasse. */
function metricCard(o) {
  const pill = fin(o.delta) ? deltaPill(o.delta, 1, o.noise) : '';
  return `<button class="mcard" data-cls="${esc(o.key)}"><span class="lbl">${esc(o.label)}</span>
    <span class="mval"><span class="num">${fin(o.v) ? countNum(o.v) : '–'}</span></span>
    <div class="mtrend">${Charts.spark(o.week, { st: o.st || 'off', w: pill ? 92 : 144 })}${pill}</div>
    ${o.sub ? `<span class="sub">${esc(o.sub)}</span>` : ''}</button>`;
}

const hint = (text, kind) => `<div class="hint${kind ? ' ' + kind : ''}">${kind === 'warn' ? ICON.warn : ICON.info}<div>${text}</div></div>`;

/** Ersteinrichtung: ohne Konto gibt es nichts zu zeigen, also fragt jede
    Ansicht an derselben Stelle danach. */
const setupView = () => `<div class="empty"><h2>Willkommen</h2>
  <p>Diese App liest Deine öffentlichen Partien bei chess.com und zeigt Spielzeit, Ratingverlauf und Taktik-Rekorde.
     Dafür braucht sie nur Deinen Benutzernamen — kein Passwort, keine Anmeldung.</p>
  <button class="btn btn-primary" data-action="user">chess.com-Konto verbinden</button></div>`;

/** Leerer Zustand, wenn das Konto steht, aber noch keine Daten da sind. */
const emptyView = (text) => `<div class="empty"><h2>Noch keine Daten</h2><p>${esc(text)}</p>
  <button class="btn btn-primary" data-action="sync">Jetzt abgleichen</button></div>`;

/** Was eine Ansicht zeigt, solange sie nichts zeigen kann — oder null. */
function leerzustand(text, bedingung) {
  if (!db.user) return setupView();
  return bedingung ? emptyView(text) : null;
}

/* ── 6. Ansichten ───────────────────────────────────────────── */
/** Partien, Tage und Serien einmal je Rendern berechnen. */
function cache() {
  const days = Sync.byDay(db.games);
  return { days, today: Sync.dateKey(new Date()) };
}

function renderHeute() {
  const el = $('#view-heute');
  const leer = leerzustand('Hol Deine Partien von chess.com, dann erscheint hier Deine Spielzeit.', !db.games.length);
  if (leer) { el.innerHTML = leer; return; }

  const { days, today } = cache();
  const t = days.get(today) || { sec: 0, n: 0, longest: 0, cls: {} };
  const minutes = Math.round(t.sec / 60);
  const goal = db.goals.min;
  const erreicht = minutes >= goal;
  /* „Unfertiges wird nicht bewertet": der heutige Tag bekommt kein Urteil
     und keinen Vergleich zum Vortag, nur „bis jetzt". */
  const word = erreicht
    ? `<b class="st-good">Tagesziel erreicht</b>`
    : `<b>bis jetzt</b> · Ziel ${esc(nf0.format(goal))} min`;

  const ser = Sync.daySeries(days, 14, new Date());
  const mittel = ser.slice(0, 13).reduce((s, d) => s + d.sec, 0) / 13;
  const vorher = Sync.daySeries(days, 28, new Date()).slice(0, 14).reduce((s, d) => s + d.sec, 0) / 14;
  const yt = yTime(Math.max.apply(null, ser.map((d) => d.sec)));
  const bars = Charts.bars(ser.map((d) => ({ label: dfShort.format(d.day), v: d.sec, cur: d.cur })), yt);
  const barsBox = chartBox(bars,
    (i) => (ser[i] ? `<b>${esc(fmtDur(ser[i].sec))}</b> ${esc(dfLong.format(ser[i].day))}`
      + (ser[i].n ? ` · ${esc(pl(ser[i].n, 'Partie', 'Partien'))}` : '') : null),
    axisNote(yt));

  const streak = Sync.streak(days, new Date());
  const spieltage = ser.filter((d) => d.n).length;
  /* Daily-Partien zählen keine Spielzeit. Ohne diesen Zusatz stünde ein
     leeres Diagramm neben dem Satz „an 5 von 14 Tagen gespielt". */
  const nurDaily = ser.filter((d) => d.n && !d.sec).length;

  el.innerHTML = heroCard('Spielzeit heute', countNum(minutes), 'min', minutes, goal,
    erreicht ? 'good' : minutes > 0 ? 'warn' : 'off', word)
    + `<div class="card">${statsRow([
      ['Partien', countNum(t.n) + `<small>/ ${esc(nf0.format(db.goals.games))}</small>`, t.n >= db.goals.games ? 'st-good' : ''],
      ['Ø je Partie', t.n ? esc(fmtDur(t.sec / t.n)) : '–'],
      ['Serie', countNum(streak) + `<small>${streak === 1 ? 'Tag' : 'Tage'}</small>`, streak > 0 ? 'st-good' : ''],
    ])}</div>`
    + `<div class="sec-h">Letzte 14 Tage</div>`
    + `<div class="card">${barsBox}
       <p class="tr-text">Im Schnitt <b>${esc(fmtDur(mittel))}</b> am Tag${
         vorher > 0 ? `, ${esc(fmtDur(Math.abs(mittel - vorher)))} ${mittel >= vorher ? 'mehr' : 'weniger'} als in den 14 Tagen davor` : ''
       }. An ${esc(nf0.format(spieltage))} von 14 Tagen gespielt${
         nurDaily ? `, an ${esc(nf0.format(nurDaily))} davon nur Daily-Partien ohne Spielzeit` : ''
       }.</p></div>`
    + `<div class="sec-h">Rating</div>${ratingCards(days)}`;
}

/** Kurzkarten je Zeitklasse mit aktuellem Rating und Entwicklung über die
    letzten sieben Spieltage. */
function ratingCards(days) {
  const cards = Sync.CLS_ORDER.map((c) => {
    const pts = Sync.ratingSeries(db.games, c, 0);
    if (!pts.length) return '';
    const week = pts.slice(-7).map((p) => p.r);
    const cur = (db.cur[c] && db.cur[c].r) || pts[pts.length - 1].r;
    const delta = week.length > 1 ? cur - week[0] : null;
    const spread = week.length > 1 ? Math.max.apply(null, week) - Math.min.apply(null, week) : 0;
    return metricCard({
      key: c, label: Sync.CLS_LABEL[c], v: cur, week, delta, noise: spread || 10,
      st: fin(delta) && delta > 0 ? 'good' : fin(delta) && delta < 0 ? 'bad' : 'off',
      sub: pl(pts.length, 'Spieltag', 'Spieltage'),
    });
  }).filter(Boolean).join('');
  return cards ? `<div class="grid2">${cards}</div>` : '';
}

function renderRating() {
  const el = $('#view-rating');
  const c = db.cls;
  const leer = leerzustand('Nach dem ersten Abgleich wächst hier Deine Rating-Kurve.', !db.games.length);
  if (leer) { el.innerHTML = leer; return; }

  // rRange 0 = alles: dann gibt es keine Untergrenze und keinen Zeitraum davor
  const from = rRange ? Math.floor(Date.now() / 1000) - rRange * 86400 : 0;
  const pts = Sync.ratingSeries(db.games, c, from);
  const info = db.cur[c] || {};
  const cur = pts.length ? pts[pts.length - 1].r : info.r;
  const delta = pts.length > 1 ? pts[pts.length - 1].r - pts[0].r : null;
  const rec = Sync.record(db.games, c, from);

  // Vergleichszeitraum gleicher Länge davor, für die Einordnung als Text
  const prev = rRange
    ? Sync.ratingSeries(db.games, c, from - rRange * 86400).filter((p) => p.t < from)
    : [];
  const mid = (a) => (a.length ? a.reduce((s, p) => s + p.r, 0) / a.length : null);
  const m0 = mid(pts), m1 = mid(prev);

  const vals = pts.map((p) => p.r);
  const spread = vals.length ? Math.max.apply(null, vals) - Math.min.apply(null, vals) : 0;
  /* Über ein Jahr hinaus trägt die Achse Monat und Jahr: bei „Alles" stünde
     sonst mehrmals derselbe Tag ohne Jahr darunter. */
  const dfAx = pts.length && (pts[pts.length - 1].t - pts[0].t) > 400 * 86400 ? dfMonthYear : dfShort;
  const svg = Charts.line({
    vals, labels: pts.map((p) => dfAx.format(dayDate(p.key))),
    fmtY: (v) => nf0.format(v), cls: 'c-' + c,
  });

  el.innerHTML = seg('cls', Sync.CLS_ORDER.map((k) => [k, Sync.CLS_LABEL[k]]), c)
    + seg('rr', RANGES_RATING, rRange)
    + `<div class="card">
        <div class="lbl">${esc(Sync.CLS_LABEL[c])} aktuell</div>
        <div class="big-row"><span class="num big">${fin(cur) ? countNum(cur) : '–'}</span>
          ${deltaPill(delta, 1, spread)}</div>
        ${chartBox(svg, (i) => (pts[i] ? `<b>${esc(nf0.format(pts[i].r))}</b> ${esc(dfLong.format(dayDate(pts[i].key)))}` : null),
    '<span>Antippen zum Ablesen</span>')}
        <p class="tr-text">${
          !fin(m0) ? 'Keine Partien in diesem Zeitraum.'
            : fin(m1)
              ? `Im Schnitt <b>${esc(nf0.format(Math.round(m0)))}</b>, ${esc(nf0.format(Math.abs(Math.round(m0 - m1))))} Punkte ${m0 >= m1 ? 'besser' : 'schlechter'} als im Zeitraum davor.`
              : rRange
                ? `Im Schnitt <b>${esc(nf0.format(Math.round(m0)))}</b> Punkte. Für einen Vergleich fehlt noch der Zeitraum davor.`
                : `Im Schnitt <b>${esc(nf0.format(Math.round(m0)))}</b> Punkte über ${esc(pl(pts.length, 'Spieltag', 'Spieltage'))}, ab dem ${esc(dfMed.format(dayDate(pts[0].key)))}.`
        }</p>
      </div>`
    + (rRange ? '' : histNote())
    + `<div class="card">${statsRow([
      ['Bestwert', fin(info.best) ? countNum(info.best) : '–'],
      ['Partien', countNum(rec.n)],
      ['Punkte', rec.n ? nf0.format(Math.round(((rec.w + rec.d / 2) / rec.n) * 100)) + '<small>%</small>' : '–'],
    ])}
      <p class="note">${
        fin(info.best)
          ? `Bestwert erreicht am ${esc(info.bestAt ? dfMed.format(new Date(info.bestAt * 1000)) : 'unbekanntem Datum')}. `
          : ''
      }Bilanz ${rRange ? 'im Zeitraum' : 'in allen gespeicherten Partien'}: ${esc(pl(rec.w, 'Sieg', 'Siege'))}, ${esc(nf0.format(rec.d))} Remis, ${esc(pl(rec.l, 'Niederlage', 'Niederlagen'))}.</p></div>`
    + (db.cur[c] && fin(db.cur[c].w)
      ? `<p class="note">Insgesamt bei chess.com: ${esc(pl(db.cur[c].w, 'Sieg', 'Siege'))}, ${esc(nf0.format(db.cur[c].d))} Remis, ${esc(pl(db.cur[c].l, 'Niederlage', 'Niederlagen'))}.</p>`
      : '');
}

function renderZeit() {
  const el = $('#view-zeit');
  const leer = leerzustand('Nach dem ersten Abgleich steht hier, wie lange Du gespielt hast.', !db.games.length);
  if (leer) { el.innerHTML = leer; return; }

  const { days } = cache();
  const now = new Date();
  const parts = (cls) => Sync.CLS_ORDER.map((c) => ({ k: c, v: (cls && cls[c]) || 0 }));

  /* Ein Balken je Tag; ab einem Jahr je Monat, bei „Alles" über drei Jahre
     je Jahr — sonst wären es hunderte Striche auf 340 px. Jeder Balken ist
     nach Zeitklasse gestapelt. */
  const first = new Date(firstGame() * 1000);
  /* Wie viele Monate „Alles" umfasst: vom Monat der ersten Partie bis jetzt.
     Mindestens einer — eine Partie mit Zeitstempel in der Zukunft (schiefe
     Uhr) käme sonst auf null Balken. */
  const spanM = tRange === 0
    ? Math.max(1, (now.getFullYear() - first.getFullYear()) * 12 + now.getMonth() - first.getMonth() + 1)
    : 12;

  let items, reader, from;
  if (tRange === 0 && spanM > 36) {
    const years = [];
    for (let y = first.getFullYear(); y <= now.getFullYear(); y++) years.push({ y, sec: 0, n: 0, cls: {} });
    const idx = new Map(years.map((b) => [b.y, b]));
    for (const g of db.games) {
      const b = idx.get(new Date(g.t * 1000).getFullYear());
      if (!b) continue;
      b.sec += g.d || 0; b.n++;
      b.cls[g.c] = (b.cls[g.c] || 0) + (g.d || 0);
    }
    from = Math.floor(new Date(years[0].y, 0, 1).getTime() / 1000);
    items = years.map((b, i) => ({ label: String(b.y), parts: parts(b.cls), cur: i === years.length - 1 }));
    reader = (i) => (years[i] ? `<b>${esc(fmtDur(years[i].sec))}</b> ${esc(String(years[i].y))}`
      + ` · ${esc(pl(years[i].n, 'Partie', 'Partien'))}${partsText(years[i].cls)}` : null);
  } else if (tRange === 0 || tRange > 90) {
    const months = [];
    for (let i = spanM - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: Sync.monthKey(d), date: d, sec: 0, n: 0, cls: {} });
    }
    const idx = new Map(months.map((m) => [m.key, m]));
    for (const g of db.games) {
      const m = idx.get(Sync.dayKey(g.t).slice(0, 7));
      if (!m) continue;
      m.sec += g.d || 0; m.n++;
      m.cls[g.c] = (m.cls[g.c] || 0) + (g.d || 0);
    }
    from = Sync.monthStart(months[0].key);
    // Über zwölf Monate hinaus gehört das Jahr an die Beschriftung
    const lbl = (d) => (spanM > 12 ? dfMonthYear : dfMonth).format(d);
    items = months.map((m, i) => ({ label: lbl(m.date), parts: parts(m.cls), cur: i === months.length - 1 }));
    reader = (i) => (months[i] ? `<b>${esc(fmtDur(months[i].sec))}</b> ${esc(dfMonth.format(months[i].date))} ${months[i].date.getFullYear()}`
      + ` · ${esc(pl(months[i].n, 'Partie', 'Partien'))}${partsText(months[i].cls)}` : null);
  } else {
    from = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (tRange - 1)).getTime() / 1000);
    const ser = Sync.daySeries(days, tRange, now);
    items = ser.map((d) => ({ label: dfShort.format(d.day), parts: parts((days.get(d.key) || {}).cls), cur: d.cur }));
    reader = (i) => (ser[i] ? `<b>${esc(fmtDur(ser[i].sec))}</b> ${esc(dfLong.format(ser[i].day))}`
      + (ser[i].n ? ` · ${esc(pl(ser[i].n, 'Partie', 'Partien'))}${partsText((days.get(ser[i].key) || {}).cls)}` : '') : null);
  }

  let total = 0, n = 0, longest = 0, prevTotal = 0;
  // Bei „Alles" gibt es keinen Zeitraum davor: prevFrom = from lässt ihn leer
  const prevFrom = tRange === 0 ? from : from - (tRange > 90 ? 365 : tRange) * 86400;
  for (const g of db.games) {
    if (g.t >= from) {
      total += g.d || 0; n++;
      if ((g.d || 0) > longest) longest = g.d;
    } else if (g.t >= prevFrom) prevTotal += g.d || 0;
  }
  let aktiv = 0;
  days.forEach((e, k) => { if (e.n && dayDate(k).getTime() / 1000 >= from) aktiv++; });

  const yt = yTime(Math.max.apply(null, items.map((it) => it.parts.reduce((a, p) => a + p.v, 0))));

  el.innerHTML = seg('tr', RANGES_TIME, tRange)
    + `<div class="card">
        <div class="lbl">Gespielt</div>
        <div class="big-row"><span class="num big">${total >= 3600 ? countNum(total / 3600, true) : countNum(total / 60)}<small>${total >= 3600 ? 'h' : 'min'}</small></span></div>
        ${chartBox(Charts.stack(items, yt), reader, axisNote(yt))}
        <p class="tr-text">${
          tRange === 0
            ? `Erste gespeicherte Partie am <b>${esc(dfMed.format(first))}</b>.`
            : prevTotal > 0
              ? `<b>${esc(fmtDur(Math.abs(total - prevTotal)))}</b> ${total >= prevTotal ? 'mehr' : 'weniger'} als im Zeitraum davor.`
              : 'Für einen Vergleich fehlt noch der Zeitraum davor.'
        }</p>
      </div>`
    + (tRange ? '' : histNote())
    + `<div class="card">${statsRow([
      ['Partien', countNum(n)],
      ['Ø je Spieltag', aktiv ? esc(fmtDur(total / aktiv)) : '–'],
      ['Längste', longest ? esc(fmtDur(longest)) : '–'],
    ])}
      <p class="note">An ${esc(pl(aktiv, 'Tag', 'Tagen'))} gespielt. Daily-Partien zählen keine Spielzeit, weil sie über Tage laufen.</p></div>`
    + `<div class="sec-h">Verteilung</div>` + clsBreakdown(Sync.clsTotals(db.games, from), from);
}

/** Zeitklassen für die Ablesezeile, nur die mit Spielzeit. */
function partsText(cls) {
  const t = Sync.CLS_ORDER.filter((c) => cls && cls[c] > 0)
    .map((c) => `${Sync.CLS_LABEL[c]} ${fmtDur(cls[c])}`).join(' · ');
  return t ? ` · ${esc(t)}` : '';
}

/** Verteilung der Spielzeit auf die Zeitklassen: Legende zum gestapelten
    Balken, mit Werten und Anteilen. Die Farbe steht nie allein. */
function clsBreakdown(cls, from) {
  const sum = Sync.CLS_ORDER.reduce((s, c) => s + (cls[c] || 0), 0);
  const counts = {};
  for (const g of db.games) if (g.t >= from) counts[g.c] = (counts[g.c] || 0) + 1;
  if (!Object.keys(counts).length) return '<div class="card"><p class="note">Keine Partien im Zeitraum.</p></div>';
  const pct = shares(Sync.CLS_ORDER.map((c) => cls[c] || 0));
  const rows = Sync.CLS_ORDER.map((c, k) => {
    const sec = cls[c] || 0, cnt = counts[c] || 0;
    if (!cnt) return '';
    const p = pct[k];
    return `<div class="dist">
      <div class="dist-h"><span class="dot d-${c}"></span><span class="grow">${esc(Sync.CLS_LABEL[c])}</span>
        <span class="num dist-v">${esc(sec ? fmtDur(sec) : pl(cnt, 'Partie', 'Partien'))}</span></div>
      <div class="meter"><i class="m-${c}" style="transform:scaleX(${sum ? Math.round((sec / sum) * 1000) / 1000 : 0})"></i></div>
      <div class="dist-s">${esc(pl(cnt, 'Partie', 'Partien'))}${sec ? ` · ${esc(nf0.format(p))} % der Spielzeit` : ' · ohne Spielzeit'}</div>
    </div>`;
  }).join('');
  return `<div class="card">${rows}</div>`;
}

function renderTaktik() {
  const el = $('#view-taktik');
  const snaps = db.snaps.filter((s) => fin(s.th));
  const last = snaps.length ? snaps[snaps.length - 1] : null;
  const first = snaps.length ? snaps[0] : null;
  const rush = db.snaps.filter((s) => fin(s.pr));
  const lastRush = rush.length ? rush[rush.length - 1] : null;

  const leer = leerzustand('Nach dem ersten Abgleich stehen hier Deine Taktik-Rekorde.', !db.lastSync);
  if (leer) { el.innerHTML = leer; return; }

  const kurve = snaps.length > 1
    ? chartBox(Charts.line({
      vals: snaps.map((s) => s.th), labels: snaps.map((s) => dfShort.format(dayDate(s.d))),
      fmtY: (v) => nf0.format(v),
    }), (i) => (snaps[i] ? `<b>${esc(nf0.format(snaps[i].th))}</b> ${esc(dfLong.format(dayDate(snaps[i].d)))}` : null),
    '<span>Antippen zum Ablesen</span>')
    : `<div class="chart-empty">Der Verlauf beginnt mit dem zweiten Tag, an dem abgeglichen wurde.</div>`;

  const neu = last && first && snaps.length > 1 && last.th > first.th;

  el.innerHTML = `<div class="card">
      <div class="lbl">Taktik-Bestwert</div>
      <div class="big-row"><span class="num big">${last ? countNum(last.th) : '–'}</span>
        ${neu ? `<span class="pill st-good">${ICON.up}${esc(nf0.format(last.th - first.th))}</span>` : ''}</div>
      <p class="note">${
        last && last.thd
          ? `Erreicht am ${esc(dfMed.format(new Date(last.thd * 1000)))}.`
          : 'Noch kein Bestwert bei chess.com hinterlegt.'
      }${last && fin(last.tl) ? ` Tiefster Wert ${esc(nf0.format(last.tl))}${last.tld ? ' am ' + esc(dfMed.format(new Date(last.tld * 1000))) : ''}.` : ''}</p>
    </div>`
    + `<div class="card">${statsRow([
      ['Puzzle Rush', lastRush ? countNum(lastRush.pr) : '–'],
      ['Versuche', lastRush && fin(lastRush.pa) ? countNum(lastRush.pa) : '–'],
      ['Treffer', lastRush && lastRush.pa ? nf0.format(Math.round((lastRush.pr / lastRush.pa) * 100)) + '<small>%</small>' : '–'],
    ])}<p class="note">Bester Puzzle-Rush-Lauf: ${
      lastRush ? `${esc(pl(lastRush.pr, 'gelöste Aufgabe', 'gelöste Aufgaben'))} in ${esc(pl(lastRush.pa, 'Versuch', 'Versuchen'))}` : 'noch keiner'
    }.</p></div>`
    + `<div class="sec-h">Verlauf der Bestwerte</div>`
    + `<div class="card">${kurve}${
      snaps.length > 1
        ? `<p class="tr-text">Seit dem ${esc(dfMed.format(dayDate(first.d)))} <b>${esc(nfs.format(last.th - first.th))}</b> Punkte.</p>`
        : ''
    }</div>`
    + hint('chess.com veröffentlicht über seine offene Schnittstelle <b>keine Anzahl gelöster Taktiken</b> und keinen Tagesverlauf — nur Bestwerte. Diese Ansicht zeigt deshalb Rekorde und zeichnet selbst mit, wie sie sich ab heute verändern.');
}

/* ── 7. Sheet und Dialoge ───────────────────────────────────── */
let sheetSaveFn = null;

function openSheet(title, html, saveFn, saveLabel) {
  armBack();                              // Zurück soll das Sheet schließen, nicht die App
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = html;
  $('#sheetBody').onclick = null;         // Handler des vorherigen Sheets verwerfen
  $('#sheetCancel').onclick = closeSheet; // ggf. überschriebenes Abbrechen zurücksetzen
  sheetSaveFn = saveFn || null;
  const btn = $('#sheetSave');
  btn.classList.toggle('hidden', !saveFn);
  btn.textContent = saveLabel || 'Sichern';
  $('#sheet').classList.remove('hidden');
  $('#scrim').classList.remove('hidden');
  $('#sheetBody').scrollTop = 0;
}

function closeSheet() {
  $('#sheet').classList.add('hidden');
  $('#scrim').classList.add('hidden');
  sheetSaveFn = null;
  for (const k of readers.keys()) if (k[0] === 's') readers.delete(k);
}

/* Ersatz für confirm() / prompt() / alert(): installierte Web-Apps
   unterdrücken die nativen Dialoge je nach Gerät kommentarlos (Regel 1).
   `back` führt zurück zum vorherigen Sheet statt alles zuzuklappen. */
function askSheet(title, text, okLabel, onOk, back, danger) {
  openSheet(title, `
    <p class="dlg-t">${esc(text)}</p>
    <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-block" id="dlgOk">${esc(okLabel)}</button>
    <button class="btn btn-block" id="dlgNo">Abbrechen</button>
  `, null);
  const zurueck = () => (back ? back() : closeSheet());
  $('#dlgOk').onclick = onOk;
  $('#dlgNo').onclick = zurueck;
  $('#sheetCancel').onclick = zurueck;
}

function infoSheet(title, text, back) {
  openSheet(title, `
    <p class="dlg-t">${esc(text)}</p>
    <button class="btn btn-primary btn-block" id="dlgOk">Verstanden</button>
  `, null);
  const zurueck = () => (back ? back() : closeSheet());
  $('#dlgOk').onclick = zurueck;
  $('#sheetCancel').onclick = zurueck;
}

/** Einzeiliger Texteingabe-Dialog. `opts`: {value, placeholder, numeric, okLabel} */
function askText(title, label, opts, onOk, back) {
  opts = opts || {};
  openSheet(title, `
    <label>${esc(label)}<input id="dlg_in"
      ${opts.numeric ? 'type="number" inputmode="decimal" step="any"' : 'autocomplete="off" autocapitalize="none" spellcheck="false"'}
      placeholder="${esc(opts.placeholder || '')}"
      value="${esc(opts.value == null ? '' : opts.value)}"></label>
    ${opts.note ? `<p class="note">${esc(opts.note)}</p>` : ''}
  `, () => onOk($('#dlg_in').value), opts.okLabel || 'Übernehmen');
  if (back) $('#sheetCancel').onclick = back;
  const inp = $('#dlg_in');
  inp.focus(); inp.select && inp.select();
  inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); sheetSaveFn && sheetSaveFn(); } };
}

/* ── 8. Abgleich mit chess.com ──────────────────────────────── */
let syncing = false;

/** Daten holen. `manual` steuert nur, wie gesprächig die App ist: beim
    automatischen Abgleich im Hintergrund soll kein Toast aufpoppen. */
async function doSync(manual) {
  if (syncing) return;
  if (!db.user) { if (manual) askUser(); return; }
  syncing = true;
  $('#btnSync').classList.add('spin');
  try {
    const res = await Sync.run({
      user: db.user, hist: db.hist, have: db.months,
      onProgress: (i, n, text) => renderTopSub('Abgleich: ' + text),
    });
    Sync.apply(db, res);
    save();
    animNext = true;
    render();
    if (manual) toast('Abgleich fertig');
  } catch (e) {
    renderTopSub();
    if (manual) infoSheet('Abgleich fehlgeschlagen', e.message || String(e));
    else toast(e.message || 'Abgleich fehlgeschlagen');
  } finally {
    syncing = false;
    $('#btnSync').classList.remove('spin');
    renderTopSub();
  }
}

/** Benutzername setzen. Der Name wird gegen die API geprüft, bevor er
    gespeichert wird — ein Tippfehler würde sonst jeden Abgleich abbrechen. */
function askUser(back) {
  askText('chess.com-Konto', 'Benutzername', {
    value: db.user, placeholder: 'Dein Name bei chess.com', okLabel: 'Prüfen',
    note: 'Genau so, wie er bei chess.com im Profil steht. Groß- und Kleinschreibung ist gleichgültig. Es werden nur öffentliche Daten gelesen, kein Passwort.',
  }, async (v) => {
    const name = String(v || '').trim().toLowerCase();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    if (name === db.user) { closeSheet(); return; }
    openSheet('chess.com-Konto', '<p class="dlg-t"><span class="spinner"></span> Name wird geprüft …</p>', null);
    try {
      await Sync.getJSON(Sync.BASE + encodeURIComponent(name));
    } catch (e) {
      infoSheet('Name nicht übernommen', e.message || String(e), () => askUser(back));
      return;
    }
    /* Anderes Konto heißt andere Partien: alles Alte muss weg, sonst mischen
       sich zwei Spieler in einer Kurve. */
    db.user = name;
    db.games = []; db.months = {}; db.snaps = []; db.cur = {}; db.lastSync = 0;
    save();
    closeSheet();
    render();
    doSync(true);
  }, back);
}

/* ── 9. Einstellungen, Backup ───────────────────────────────── */
function openSettings() {
  const last = db.lastBackup ? dfLong.format(new Date(db.lastBackup)) : 'noch nie';
  const stand = db.lastSync ? dfLong.format(new Date(db.lastSync)) + ', ' + tfTime.format(new Date(db.lastSync)) : 'noch nie';
  openSheet('Einstellungen', `
    <div class="lbl">chess.com</div>
    <button class="btn btn-block" id="btnUser">Konto: ${esc(db.user || 'nicht gesetzt')}</button>
    <button class="btn btn-block" id="btnSyncNow">Jetzt abgleichen</button>
    <p class="note">Letzter Abgleich: ${esc(stand)}. Gespeichert sind ${esc(pl(db.games.length, 'Partie', 'Partien'))}.</p>

    <div class="lbl" style="margin-top:var(--s3)">Historie</div>
    ${seg('hist', [[3, '3 Monate'], [12, '12 Monate'], [0, 'Alles']], db.hist)}
    <p class="note">Beim Erweitern lädt der nächste Abgleich die fehlenden Monate nach, beim Verkleinern fallen alte Partien weg.</p>

    <div class="lbl" style="margin-top:var(--s3)">Tagesziele</div>
    <button class="btn btn-block" id="btnGoalMin">Spielzeit: ${esc(nf0.format(db.goals.min))} min</button>
    <button class="btn btn-block" id="btnGoalGames">Partien: ${esc(nf0.format(db.goals.games))}</button>

    <div class="lbl" style="margin-top:var(--s3)">Darstellung</div>
    ${seg('theme', Object.keys(THEMES).map((k) => [k, THEMES[k].label]), db.theme)}

    <div class="lbl" style="margin-top:var(--s3)">Backup</div>
    <p class="dlg-t">Deine Daten liegen nur auf diesem Gerät. „Browserdaten löschen" entfernt sie ohne Vorwarnung, deshalb regelmäßig ein Backup sichern. Letztes Backup: ${esc(last)}.</p>
    <button class="btn btn-block" id="btnExport">Backup speichern</button>
    <button class="btn btn-block" id="btnImport">Backup laden</button>
    <input type="file" id="fileImport" accept="application/json,.json" class="hidden">

    <div class="lbl" style="margin-top:var(--s3)">App</div>
    <button class="btn btn-block hidden" id="btnInstall">App installieren</button>
    <button class="btn btn-block" id="btnUpdate">Nach Update suchen</button>
    <button class="btn btn-danger btn-block" id="btnWipe">Alle Daten löschen</button>
    <p class="note">Version ${esc(APP_VERSION)} · Daten von chess.com (öffentliche Schnittstelle)</p>
  `, null);
  $('#sheetBody').onclick = (e) => {
    const t = e.target.closest('[data-seg="theme"]');
    if (t) { applyTheme(t.dataset.v); save(); openSettings(); return; }
    const h = e.target.closest('[data-seg="hist"]');
    if (h) {
      db.hist = +h.dataset.v;
      save(); openSettings();
      doSync(true);
    }
  };
  $('#btnUser').onclick = () => askUser(openSettings);
  $('#btnSyncNow').onclick = () => { closeSheet(); doSync(true); };
  $('#btnGoalMin').onclick = () => askText('Tagesziel Spielzeit', 'Minuten pro Tag',
    { value: db.goals.min, numeric: true }, (v) => {
      const n = Math.round(num(v));
      if (!(n > 0)) { toast('Bitte eine Zahl über 0'); return; }
      db.goals.min = Math.min(600, n); save(); openSettings(); animNext = true; render();
    }, openSettings);
  $('#btnGoalGames').onclick = () => askText('Tagesziel Partien', 'Partien pro Tag',
    { value: db.goals.games, numeric: true }, (v) => {
      const n = Math.round(num(v));
      if (!(n > 0)) { toast('Bitte eine Zahl über 0'); return; }
      db.goals.games = Math.min(200, n); save(); openSettings(); animNext = true; render();
    }, openSettings);
  $('#btnExport').onclick = exportBackup;
  $('#btnImport').onclick = () => $('#fileImport').click();
  $('#fileImport').onchange = (e) => importBackup(e.target.files[0]);
  $('#btnInstall').onclick = installApp;
  $('#btnUpdate').onclick = checkUpdate;
  $('#btnWipe').onclick = () => askSheet('Alle Daten löschen?',
    'Partien, Taktik-Schnappschüsse und Einstellungen werden entfernt. Der nächste Abgleich holt die Partien wieder von chess.com — die selbst mitgeschriebenen Taktik-Werte sind dann aber verloren.',
    'Löschen', () => {
      db = blank();
      applyTheme(db.theme);
      save(); closeSheet(); animNext = true; render(); toast('Daten gelöscht');
    }, openSettings, true);
  syncInstall();
}

function exportBackup() {
  db.lastBackup = new Date().toISOString();
  save();
  /* Der gesamte Datensatz wandert unverändert in die Datei. `meta` steht nur
     als Kopfzeile davor und wird beim Import wieder entfernt (normalize).
     Geheimnisse gibt es hier keine: die chess.com-Schnittstelle ist offen. */
  const payload = Object.assign({
    meta: { app: 'Schachtracker', appVersion: APP_VERSION, format: db.v, exported: db.lastBackup },
  }, db);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `schach-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Backup gespeichert');
}

function importBackup(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || !Array.isArray(d.games)) throw new Error('Die Datei ist kein Backup dieser App.');
      const stand = d.meta && d.meta.exported ? ` vom ${dfLong.format(new Date(d.meta.exported))}` : '';
      askSheet('Backup laden',
        `Das Backup${stand} enthält ${pl(d.games.length, 'Partie', 'Partien')}`
        + `${Array.isArray(d.snaps) ? ` und ${pl(d.snaps.length, 'Taktik-Schnappschuss', 'Taktik-Schnappschüsse')}` : ''}. `
        + 'Deine jetzigen Daten werden dabei ersetzt.',
        'Laden', () => {
          db = normalize(d);              // ergänzt Fehlendes, wirft `meta` weg
          applyTheme(db.theme);
          save(); closeSheet(); animNext = true; render(); toast('Backup geladen');
        }, openSettings);
    } catch (e) { infoSheet('Import fehlgeschlagen', e.message, openSettings); }
  };
  r.readAsText(file);
}

/* ── 10. Zurück-Taste ───────────────────────────────────────────
   Ohne Zutun beendet ein einziger Druck auf Zurück die installierte App.
   Deshalb liegt ein zusätzlicher Verlaufseintrag („Wächter") über der App:
   Zurück landet bei uns statt beim System. Der Druck schließt der Reihe
   nach, was offen ist (Sheet, Unterseite), und baut den Wächter wieder auf.
   Auf „Heute" kommt ein Hinweis (leaveHint). Zusammenspiel ist fummelig und
   erprobt: nur mit Bedacht ändern. */
let guardUp = false;

function pushGuard() {
  if (guardUp) return;
  guardUp = true;
  try { history.pushState({ g: 1 }, ''); } catch (e) { guardUp = false; }
}

/** Vor allem, was die Zurück-Taste abfangen soll: Sheet öffnen, Seite wechseln. */
function armBack() { pushGuard(); }

/** Zurück auf der Übersicht: Hinweis statt Dialog. Ein „Verlassen"-Knopf
    kann die installierte App nicht schließen: history.back() vom ersten
    Verlaufseintrag aus tut nichts, window.close() blockt der Browser, sobald
    der Verlauf mehr als einen Eintrag hat. Nur die System-Zurückgeste selbst
    beendet die App. Deshalb bleibt der Wächter hier unten, und der nächste
    Zurück-Druck schließt die App. Tippt man stattdessen in die App, steht der
    Wächter wieder (Antippen zählt als Nutzeraktion; ohne sie überspringt
    Chrome den Eintrag beim Zurückgehen). In der Dashboard-Vorschau nichts tun,
    dann verkleinert das Dashboard die App. */
function leaveHint(msg) {
  if (window.__dashboard) return;
  toast(msg || 'Zum Verlassen nochmal zurück wischen');
  document.addEventListener('pointerdown', pushGuard, { once: true });
}

function wireBack() {
  pushGuard();
  window.addEventListener('popstate', () => {
    guardUp = false;

    // Über den Abbrechen-Knopf, nicht closeSheet: verschachtelte Sheets haben
    // dort ihren Rückweg zum vorherigen Sheet hinterlegt.
    if (!$('#sheet').classList.contains('hidden')) { $('#sheetCancel').click(); pushGuard(); return; }
    if (view !== 'heute') { nav('heute'); pushGuard(); return; }

    leaveHint();
  });
}

/* ── 11. Updates, Installieren ──────────────────────────────── */
/** Welche APP_VERSION liegt im Offline-Cache? Das ist die Fassung, die beim
    nächsten Laden ausgeliefert wird, nicht zwingend die laufende. */
async function cachedVersion() {
  if (!('caches' in window)) return null;
  for (const k of await caches.keys()) {
    if (!k.startsWith('schach-')) continue;     // Caches der anderen Apps auf der Domain
    const c = await caches.open(k);
    const res = (await c.match('./app.js')) || (await c.match('app.js'));
    if (!res) continue;
    const m = (await res.text()).match(/APP_VERSION\s*=\s*'([^']+)'/);
    if (m) return m[1];
  }
  return null;
}

/** Lädt neu, wenn im Cache eine andere Fassung liegt als die laufende. Die
    Sperre in sessionStorage verhindert eine Endlosschleife, falls das
    Neuladen die Version wider Erwarten nicht ändert. */
let reloading = false;
async function applyIfNewer(announce) {
  if (reloading) return false;
  const cv = await cachedVersion();
  if (!cv || cv === APP_VERSION) return false;
  if (sessionStorage.getItem('schach.reload') === cv) return false;   // schon versucht
  if (!$('#sheet').classList.contains('hidden')) {                    // Formular offen
    toast(`Version ${cv} bereit: App neu starten`);
    return true;
  }
  reloading = true;
  sessionStorage.setItem('schach.reload', cv);
  if (announce) toast(`Version ${cv} wird geladen …`);
  setTimeout(() => location.reload(), announce ? 700 : 0);
  return true;
}

function wireUpdates() {
  if (!('serviceWorker' in navigator)) return;

  /* Auf 'controllerchange' ist kein Verlass: aktualisiert sich dieselbe
     Registrierung, bleibt das Ereignis aus. Verlässlich ist der
     Zustandswechsel des neuen Workers auf 'activated'. */
  const watch = (w) => {
    if (!w) return;
    if (w.state === 'activated') { applyIfNewer(false); return; }
    w.addEventListener('statechange', () => {
      if (w.state === 'activated') applyIfNewer(false);
    });
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => applyIfNewer(false));

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      watch(reg.installing); watch(reg.waiting);
      reg.addEventListener('updatefound', () => watch(reg.installing));
      navigator.serviceWorker.ready.then(() => applyIfNewer(false));
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    }).catch(() => {});
  });
}

/** Knopf „Nach Update suchen". Findet reg.update() eine neue Fassung,
    übernimmt der Wächter aus wireUpdates() das Neuladen. */
async function checkUpdate() {
  if (!('serviceWorker' in navigator)) { toast('Updates werden hier nicht unterstützt'); return; }
  closeSheet();
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      await reg.update();
      if (reg.installing || reg.waiting) { toast('Update wird geladen …'); return; }
    }
  } catch (e) { /* offline: dann gilt der vorhandene Cache */ }
  if (!(await applyIfNewer(true))) toast(`Version ${APP_VERSION} ist aktuell`);
}

/* Eigener Installieren-Knopf statt Chrome-Menü: Chrome 154 bis 157 meldet dort
   „bereits installiert", sobald irgendeine andere App auf derselben Domain
   installiert ist (crbug.com/568841400). beforeinstallprompt prüft pro App.
   Chrome schickt das Ereignis nur, solange die App installierbar ist; der
   Knopf verschwindet also von selbst. */
let installEvt = null;

/** Knopf ein- oder ausblenden. Das Ereignis kommt oft erst ein paar Sekunden
    nach dem Laden, unter Umständen bei schon offenen Einstellungen. */
function syncInstall() {
  const b = $('#btnInstall');
  if (b) b.classList.toggle('hidden', !installEvt);
}

function wireInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();             // keine eigene Leiste von Chrome, der Knopf reicht
    installEvt = e;
    syncInstall();
  });
  window.addEventListener('appinstalled', () => {
    installEvt = null;
    syncInstall();
    toast('Schachtracker ist installiert');
  });
}

async function installApp() {
  const e = installEvt;
  if (!e) return;
  installEvt = null;                // prompt() geht nur einmal pro Ereignis
  syncInstall();
  e.prompt();
  await e.userChoice.catch(() => {});
}

/* ── 12. Verdrahten, Start ──────────────────────────────────── */
/** Klicks per Delegation am body, nicht einzeln pro gerenderter Zeile.
    Klicks im Sheet behandelt das Sheet selbst (#sheetBody.onclick). */
function wire() {
  document.body.addEventListener('click', (e) => {
    if (e.target.closest('#sheet')) return;
    const n = e.target.closest('[data-nav]'); if (n) { nav(n.dataset.nav); return; }
    const s = e.target.closest('[data-seg]');
    if (s) {
      if (s.dataset.seg === 'cls') db.cls = s.dataset.v;
      else if (s.dataset.seg === 'rr') rRange = +s.dataset.v;
      else if (s.dataset.seg === 'tr') tRange = +s.dataset.v;
      save(); animNext = true; render(); return;
    }
    const c = e.target.closest('[data-cls]');
    if (c) { db.cls = c.dataset.cls; save(); nav('rating'); return; }
    const a = e.target.closest('[data-action]');
    if (a && a.dataset.action === 'sync') { doSync(true); return; }
    if (a && a.dataset.action === 'user') { askUser(); return; }
  });
  // Diagramme ablesen: Antippen und Ziehen mit dem Finger, mit der Maus schon beim Drüberfahren
  document.addEventListener('pointerdown', onChartPointer);
  document.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'mouse') onChartPointer(e); });
  $('#btnSync').onclick = () => doSync(true);
  $('#btnSettings').onclick = openSettings;
  $('#sheetCancel').onclick = closeSheet;
  $('#scrim').onclick = () => $('#sheetCancel').click();   // wie Abbrechen, mit Rückweg verschachtelter Sheets
  $('#sheetSave').onclick = () => sheetSaveFn && sheetSaveFn();
}

load();
applyTheme(db.theme);
wire();
wireBack();
nav(restoreViewState());

/* Bittet den Browser, den Speicher nicht bei Platzmangel wegzuräumen. */
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

wireUpdates();
wireInstall();

/* Erster Start ohne Konto: gleich danach fragen — die Begrüßung in der
   Ansicht bleibt dahinter stehen, falls der Dialog weggewischt wird.
   Sonst von allein abgleichen, wenn die Daten älter als eine Viertelstunde
   sind. Offline bleibt es beim gespeicherten Stand. */
if (!db.user) askUser();
else if (Date.now() - db.lastSync > SYNC_IDLE && navigator.onLine !== false) doSync(false);
