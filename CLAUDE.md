# Schachtracker

Stack, harte Regeln, Bau-Reihenfolge und Upload stehen im Skill `web-app` und gelten vorrangig. Entscheidungen und offene Punkte stehen in `DECISIONS.md`. Diese Datei hält nur fest, was an **dieser** App anders oder eigen ist.

## Richtung
Dunkles, datenfokussiertes Dashboard fürs Handy: ruhig, technisch, die Zahlen sind der Star. Keine Schachbrett-Deko, kein chess.com-Branding — die Datenquelle wird nur im Text genannt.

**Akzent:** Bernstein `--accent` (`#E8B23A` dunkel, `#8A5A00` hell), der Ton eines hellen Holzbretts. Nur für primäre Aktionen, aktive Segmente und Balken ohne Kategorie. **Standard-Theme:** dunkel.

## Eigene Dateien
| Datei | Inhalt |
|---|---|
| `sync.js` | Alles Rechnen: chess.com abrufen, Partien verdichten, auswerten. Kein DOM, deshalb in Node testbar (`node tests/sync-test.js`). |

## Abweichungen von der Vorlage in tokens.css
| Token | Zweck |
|---|---|
| `--accent`, `--accent-soft`, `--accent-line`, `--bar` | Bernstein statt Mint |
| `--c-bullet`, `--c-blitz`, `--c-rapid`, `--c-daily` | Zeitklassen in Diagramm, Legende und Verteilung. Reihenfolge wie im gestapelten Balken, mit `tools/farben.js` geprüft (normal ≥ 15, Rot-Grün ≥ 8). |
| `--tabs: 4` | vier Tabs |

Die Zustands-Tokens (`--st-low/mid/high`) bleiben wie in der Vorlage: Koralle, Sand, Mint — bewusst nicht in der Akzentfamilie, damit ein Urteil nicht wie eine Aktion aussieht.

## Eigene Bausteine
| Baustein | Wo |
|---|---|
| Gestapelte Balken (Spielzeit je Zeitklasse) | `Charts.stack()` in `charts.js`, Farben `.chart-svg .part.p-*` in `style.css` |
| Verteilungsreihe (Punkt, Name, Wert, Balken, Anteil) | `clsBreakdown()` in `app.js`, `.dist*` und `.meter > i.m-*` in `style.css` |
| Kopfzahl einer Ansicht mit Pill | `.big-row` / `.num.big` in `style.css` |
| Achsenhinweis über dem Diagramm | `axisNote()` in `app.js` |
| Zahlform Einzahl/Mehrzahl | `pl()` in `app.js` |
| Abgleich-Knopf, der sich dreht | `.icon-btn.spin` in `style.css` |

## Daten
Ein Schlüssel `schach.v1`. Eine Partie wird auf `{t, c, r, d, w, x}` verdichtet (rund 55 Byte), zwölf Monate sind damit etwa 50 KB. Die Feldnamen sind absichtlich einbuchstabig: der localStorage gehört allen Apps der Domain gemeinsam (Regel 11).

Zeitklassen heißen überall `b` (Bullet), `z` (Blitz), `r` (Rapid), `d` (Daily).
