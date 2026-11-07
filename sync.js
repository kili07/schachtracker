'use strict';
/* ═══════════════════════════════════════════════════════════════
   Schachtracker: chess.com-Daten holen und verdichten

   Kein DOM, keine Anzeige: diese Datei rechnet nur. Dadurch läuft sie in
   Node und ist ohne Browser testbar (tests/sync-test.js).

   Aufbau:
   1. Konstanten und kleine Helfer
   2. PGN: Dauer einer Partie
   3. Eine Partie verdichten
   4. Abrufen (fetch) und Zusammenführen
   5. Auswerten: Tage, Reihen, Serien

   Was die öffentliche API hergibt, steht in DECISIONS.md. Kurz:
   Spielzeit und Rating kommen aus den Monatsarchiven, Taktik nur als
   Rekordwerte aus /stats.
   ═══════════════════════════════════════════════════════════════ */

const Sync = (() => {

const BASE = 'https://api.chess.com/pub/player/';

/* Zeitklassen als ein Buchstabe: der Datensatz liegt im localStorage, den
   sich alle Apps der Domain teilen (~5 MB), deshalb jedes Feld so kurz wie
   möglich. Eine Partie braucht so rund 55 Byte. */
const CLS = { bullet: 'b', blitz: 'z', rapid: 'r', daily: 'd' };
const CLS_ORDER = ['b', 'z', 'r', 'd'];
const CLS_LABEL = { b: 'Bullet', z: 'Blitz', r: 'Rapid', d: 'Daily' };
/* Schlüssel in /stats je Zeitklasse (nur Standardschach, Varianten zählen
   dort eigene Ratings und bleiben hier außen vor). */
const STATS_KEY = { b: 'chess_bullet', z: 'chess_blitz', r: 'chess_rapid', d: 'chess_daily' };

/* Dauer wird nur für Live-Partien gezählt. Bei Daily liefen Partien über
   Tage, eine Tagessumme daraus wäre sinnlos (Entscheidung in DECISIONS.md). */
const LIVE = ['b', 'z', 'r'];
/* Obergrenze je Partie: länger als sechs Stunden ist keine Live-Partie,
   sondern ein Fehler in den Kopfdaten. Dann lieber kappen als die
   Tagessumme sprengen. */
const MAX_DUR = 6 * 3600;

/* Ergebnisse von chess.com, die ein Remis bedeuten. Alles andere außer
   'win' ist eine Niederlage (resigned, checkmated, timeout, abandoned …). */
const DRAWS = ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'];

const fin = (v) => typeof v === 'number' && isFinite(v);
const pad = (n) => String(n).padStart(2, '0');

/** Lokaler Tagesschlüssel zu einem Unix-Zeitstempel (Sekunden).
    Lokal, nicht UTC: sonst rutschen Abendpartien auf den Folgetag. */
function dayKey(ts) {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Tagesschlüssel eines Date-Objekts. */
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Monatsschlüssel '2026-11' eines Date-Objekts. */
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

/** Monatsschlüssel um n Monate verschieben. */
function shiftMonth(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return monthKey(d);
}

/** Erster Moment eines Monats als Unix-Zeitstempel (lokal). */
function monthStart(key) {
  const [y, m] = key.split('-').map(Number);
  return Math.floor(new Date(y, m - 1, 1).getTime() / 1000);
}

/* ── 2. PGN: Dauer einer Partie ─────────────────────────────── */
/** Kopfzeilen des PGN. Nur der Anfang wird gelesen: die Zugliste ist lang
    und bei 1 000 Partien kostet ein Durchlauf über alles merklich Zeit. */
function headers(pgn) {
  const out = {};
  const head = String(pgn || '').slice(0, 1400);
  const re = /\[(\w+) "([^"]*)"\]/g;
  let m;
  while ((m = re.exec(head))) out[m[1]] = m[2];
  return out;
}

/** '2026.10.01' + '18:57:50' → Unix-Sekunden. Die Kopfdaten sind UTC
    (Header `Timezone "UTC"`), für eine Dauer ist die Zone ohnehin gleich. */
function stamp(date, time) {
  if (!date || !time) return NaN;
  const d = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return NaN;
  return Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], +t[3]) / 1000;
}

/** Dauer einer Partie in Sekunden: vom ersten Zug bis zum Ende.
    Das ist die Zeit, die wirklich am Brett vergangen ist (beide Seiten),
    nicht die Bedenkzeit des Zeitformats. */
function duration(pgn) {
  const h = headers(pgn);
  const s = stamp(h.UTCDate, h.StartTime);
  const e = stamp(h.EndDate || h.UTCDate, h.EndTime);
  if (!fin(s) || !fin(e)) return 0;
  let d = e - s;
  if (d < 0) d += 86400;            // über Mitternacht, aber ohne EndDate
  if (d < 0) return 0;
  return Math.min(d, MAX_DUR);
}

/* ── 3. Eine Partie verdichten ──────────────────────────────── */
const outcome = (r) => (r === 'win' ? 'w' : DRAWS.indexOf(r) >= 0 ? 'd' : 'l');

/** Eine Partie der API auf das gespeicherte Format bringen:
    {t: Endzeit (s), c: Zeitklasse, r: Rating danach, d: Dauer (s),
     w: 'w'|'d'|'l', x: 1 bei Variante}
    `user` muss klein geschrieben sein. Liefert null, wenn die Partie nicht
    zu diesem Spieler gehört oder keine Endzeit hat. */
function parseGame(g, user) {
  if (!g || !fin(g.end_time)) return null;
  const w = g.white || {}, b = g.black || {};
  const me = String(w.username || '').toLowerCase() === user ? w
    : String(b.username || '').toLowerCase() === user ? b : null;
  if (!me) return null;
  const c = CLS[g.time_class] || 'z';
  const rec = {
    t: g.end_time,
    c,
    r: fin(me.rating) ? me.rating : 0,
    d: c === 'd' ? 0 : duration(g.pgn),
    w: outcome(me.result),
  };
  // Varianten (Chess960, King of the Hill …) haben eigene Ratings und
  // gehören nicht in die Rating-Kurve; Spielzeit zählt sie mit.
  if (g.rules && g.rules !== 'chess') rec.x = 1;
  return rec;
}

/** Monatsarchiv → Liste verdichteter Partien, aufsteigend nach Zeit. */
function parseMonth(data, user) {
  const games = (data && data.games) || [];
  const out = [];
  for (const g of games) {
    const rec = parseGame(g, String(user || '').toLowerCase());
    if (rec) out.push(rec);
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Taktik-Schnappschuss aus /stats. Mehr gibt die öffentliche API nicht
    her: keine Anzahl gelöster Taktiken, kein Tagesverlauf. */
function snapshot(stats, day) {
  const t = (stats && stats.tactics) || {};
  const p = (stats && stats.puzzle_rush && stats.puzzle_rush.best) || {};
  const s = { d: day };
  if (fin(t.highest && t.highest.rating)) { s.th = t.highest.rating; s.thd = t.highest.date; }
  if (fin(t.lowest && t.lowest.rating)) { s.tl = t.lowest.rating; s.tld = t.lowest.date; }
  if (fin(p.score)) { s.pr = p.score; s.pa = p.total_attempts; }
  return s;
}

/** Aktuelle Ratings und Bilanz je Zeitklasse aus /stats, klein gehalten:
    {z: {r, best, bestAt, w, l, d}} */
function current(stats) {
  const out = {};
  for (const c of CLS_ORDER) {
    const s = stats && stats[STATS_KEY[c]];
    if (!s) continue;
    const o = {};
    if (s.last && fin(s.last.rating)) o.r = s.last.rating;
    if (s.best && fin(s.best.rating)) { o.best = s.best.rating; o.bestAt = s.best.date; }
    if (s.record) { o.w = s.record.win | 0; o.l = s.record.loss | 0; o.d = s.record.draw | 0; }
    if (Object.keys(o).length) out[c] = o;
  }
  return out;
}

/* ── 4. Abrufen und Zusammenführen ──────────────────────────── */
/** Welche Monate liegen im Fenster? `hist` = Zahl der Monate, 0 = alles.
    Der laufende Monat kommt immer mit, auch wenn er noch nicht im Archiv
    steht (chess.com legt ihn erst mit der ersten Partie an). */
function monthsInWindow(archives, hist, now) {
  const keys = (archives || []).map((u) => {
    const m = /(\d{4})\/(\d{2})\/?$/.exec(String(u));
    return m ? `${m[1]}-${m[2]}` : null;
  }).filter(Boolean);
  const cur = monthKey(now || new Date());
  if (keys.indexOf(cur) < 0) keys.push(cur);
  keys.sort();
  if (!hist) return keys;
  const from = shiftMonth(cur, -(hist - 1));
  return keys.filter((k) => k >= from);
}

/** Älteste Zeit, die im Fenster bleibt. 0 = alles behalten. */
function cutoff(hist, now) {
  if (!hist) return 0;
  return monthStart(shiftMonth(monthKey(now || new Date()), -(hist - 1)));
}

function apiError(status, url) {
  const e = new Error(
    status === 404 ? 'Benutzername nicht gefunden.'
      : status === 429 ? 'chess.com bremst gerade (zu viele Anfragen). Später erneut versuchen.'
        : status === 403 ? 'chess.com hat die Anfrage abgewiesen (403).'
          : `chess.com antwortete mit HTTP ${status}.`);
  e.status = status;
  e.url = url;
  return e;
}

/** Eine API-Anfrage. Mit Zeitlimit: ohne AbortController hängt ein
    `fetch` im Mobilfunknetz beliebig lange und der Sync wirkt eingefroren. */
async function getJSON(url) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), 20000) : null;
  let res;
  try {
    res = await fetch(url, { signal: ctl ? ctl.signal : undefined, cache: 'no-store' });
  } catch (e) {
    throw new Error(e && e.name === 'AbortError'
      ? 'Zeitüberschreitung bei chess.com.' : 'Keine Verbindung zu chess.com.');
  } finally { if (timer) clearTimeout(timer); }
  if (!res.ok) throw apiError(res.status, url);
  return res.json();
}

/** Zwei Listen verdichteter Partien vereinen. Schlüssel ist Endzeit plus
    Zeitklasse; frische Werte gewinnen (ein Rating kann nachträglich
    korrigiert werden). */
function merge(oldGames, fresh) {
  const seen = new Map();
  for (const g of (oldGames || [])) seen.set(g.t + g.c, g);
  for (const g of (fresh || [])) seen.set(g.t + g.c, g);
  return Array.from(seen.values()).sort((a, b) => a.t - b.t);
}

/** Den kompletten Sync fahren. Liefert ein Ergebnis, das `apply()` in den
    Datensatz einträgt — diese Funktion verändert nichts von außen.
    o: { user, hist, have: {Monat: Anzahl}, onProgress(fertig, gesamt, text) } */
async function run(o) {
  const user = String(o.user || '').trim().toLowerCase();
  if (!user) throw new Error('Kein Benutzername gesetzt.');
  const hist = o.hist | 0;
  const have = o.have || {};
  const prog = o.onProgress || function () {};
  const now = new Date();
  const curMonth = monthKey(now);
  const u = BASE + encodeURIComponent(user);

  prog(0, 3, 'Profil');
  await getJSON(u);                                  // prüft den Namen (404)
  prog(1, 3, 'Werte');
  const stats = await getJSON(u + '/stats');
  prog(2, 3, 'Archiv');
  const arch = (await getJSON(u + '/games/archives')).archives || [];

  const keys = monthsInWindow(arch, hist, now);
  /* Abgeschlossene Monate ändern sich nicht mehr: einmal geladen, nie
     wieder. Der laufende Monat wird bei jedem Sync neu geholt. */
  const todo = keys.filter((k) => k === curMonth || !have[k]);
  const months = {};
  for (let i = 0; i < todo.length; i++) {
    const k = todo[i];
    prog(i, todo.length, `Monat ${i + 1} von ${todo.length}`);
    const [y, m] = k.split('-');
    // Serielle Abrufe: chess.com beantwortet Bündel paralleler Anfragen mit 429.
    months[k] = parseMonth(await getJSON(`${u}/games/${y}/${m}`), user);
  }
  prog(todo.length, todo.length, 'fertig');

  return {
    user,
    hist,
    curMonth,
    months,
    cur: current(stats),
    snap: snapshot(stats, dateKey(now)),
    cutoff: cutoff(hist, now),
    when: Date.now(),
  };
}

/** Ergebnis eines Syncs in den Datensatz eintragen. Trennt sauber zwischen
    Holen (run) und Ändern (hier), damit sich das Eintragen ohne Netz testen
    lässt. */
function apply(db, res) {
  db.user = res.user;
  db.cur = res.cur;

  let games = db.games || [];
  for (const k of Object.keys(res.months)) {
    if (k === res.curMonth) {
      /* Laufender Monat: alte Partien dieses Monats zuerst weg. Sonst
         blieben abgebrochene oder gelöschte Partien für immer stehen. */
      const from = monthStart(k);
      games = games.filter((g) => g.t < from);
    }
    games = merge(games, res.months[k]);
    if (k !== res.curMonth) db.months[k] = res.months[k].length;
  }

  // Fenster beschneiden: Partien und Monatsvermerke außerhalb fliegen raus
  if (res.cutoff) {
    games = games.filter((g) => g.t >= res.cutoff);
    const fromKey = dayKey(res.cutoff).slice(0, 7);
    for (const k of Object.keys(db.months)) if (k < fromKey) delete db.months[k];
  }
  db.games = games;

  /* Taktik: ein Schnappschuss je Tag, der letzte des Tages gilt. Daraus
     wächst ab Installation ein Verlauf, den die API selbst nicht liefert. */
  const snaps = (db.snaps || []).filter((s) => s.d !== res.snap.d);
  snaps.push(res.snap);
  snaps.sort((a, b) => String(a.d).localeCompare(String(b.d)));
  db.snaps = snaps;

  db.lastSync = res.when;
  return db;
}

/* ── 5. Auswerten ───────────────────────────────────────────── */
/** Partien nach lokalem Tag bündeln.
    Map 'YYYY-MM-DD' → {sec, n, live, longest, cls: {b,z,r,d}} */
function byDay(games) {
  const map = new Map();
  for (const g of games || []) {
    const k = dayKey(g.t);
    let e = map.get(k);
    if (!e) { e = { sec: 0, n: 0, live: 0, longest: 0, cls: { b: 0, z: 0, r: 0, d: 0 } }; map.set(k, e); }
    e.n++;
    e.sec += g.d || 0;
    e.cls[g.c] = (e.cls[g.c] || 0) + (g.d || 0);
    if (LIVE.indexOf(g.c) >= 0) e.live++;
    if ((g.d || 0) > e.longest) e.longest = g.d || 0;
  }
  return map;
}

/** Lückenlose Tagesreihe von vor n Tagen bis heute.
    → [{key, label, sec, n, cur}] (cur = heute, noch nicht fertig) */
function daySeries(map, n, now) {
  const base = now ? new Date(now) : new Date();
  const today = dateKey(base);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
    const k = dateKey(d);
    const e = map.get(k);
    out.push({ key: k, day: d, sec: e ? e.sec : 0, n: e ? e.n : 0, cur: k === today });
  }
  return out;
}

/** Summen je Zeitklasse über einen Zeitraum ab `fromTs`. */
function clsTotals(games, fromTs) {
  const out = { b: 0, z: 0, r: 0, d: 0 };
  for (const g of games || []) if (g.t >= fromTs) out[g.c] = (out[g.c] || 0) + (g.d || 0);
  return out;
}

/** Rating-Verlauf einer Zeitklasse: ein Punkt je Tag (letztes Rating des
    Tages). Pro Partie wären es über ein Jahr tausende Punkte auf 340 px —
    ein Tag ist die feinste Auflösung, die man noch unterscheiden kann.
    Varianten (x) bleiben außen vor, sie haben ein eigenes Rating. */
function ratingSeries(games, c, fromTs) {
  const byDate = new Map();
  for (const g of games || []) {
    if (g.c !== c || g.x || !g.r) continue;
    if (fromTs && g.t < fromTs) continue;
    const k = dayKey(g.t);
    const e = byDate.get(k);
    if (!e || g.t >= e.t) byDate.set(k, { t: g.t, r: g.r, key: k });
  }
  return Array.from(byDate.values()).sort((a, b) => a.t - b.t);
}

/** Bilanz einer Zeitklasse ab `fromTs`: {w, d, l, n} */
function record(games, c, fromTs) {
  const out = { w: 0, d: 0, l: 0, n: 0 };
  for (const g of games || []) {
    if (g.c !== c || g.x) continue;
    if (fromTs && g.t < fromTs) continue;
    out[g.w] = (out[g.w] || 0) + 1;
    out.n++;
  }
  return out;
}

/** Tage in Folge mit mindestens einer Partie, rückwärts ab heute. Hat heute
    noch niemand gespielt, zählt die Serie bis gestern weiter — der Tag ist
    ja noch nicht vorbei. */
function streak(map, now) {
  const base = now ? new Date(now) : new Date();
  let n = 0;
  const has = (d) => { const e = map.get(dateKey(d)); return !!(e && e.n); };
  const day = (i) => new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
  let i = has(day(0)) ? 0 : 1;
  for (; ; i++) {
    if (!has(day(i))) break;
    n++;
  }
  return n;
}

return {
  // Konstanten
  CLS, CLS_ORDER, CLS_LABEL, STATS_KEY, LIVE, BASE, MAX_DUR,
  // Zeit
  dayKey, dateKey, monthKey, shiftMonth, monthStart, cutoff, monthsInWindow,
  // Verdichten
  headers, stamp, duration, parseGame, parseMonth, snapshot, current, merge,
  // Netz
  getJSON, run, apply,
  // Auswerten
  byDay, daySeries, clsTotals, ratingSeries, record, streak,
};
})();

if (typeof module === 'object' && module.exports) module.exports = Sync;
