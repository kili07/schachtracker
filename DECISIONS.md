# Entscheidungen und offene Punkte

## Entscheidungen

**07.11.2026 — Datenquelle:** Die öffentliche Schnittstelle von chess.com (`api.chess.com/pub/…`), ohne Anmeldung und ohne Schlüssel. Geprüft vor dem Bauen: Sie schickt `access-control-allow-origin: *`, der Browser darf sie also direkt abfragen — kein Proxy, kein Backend.

**07.11.2026 — Spielzeit nur aus Live-Partien:** Die Dauer einer Partie kommt aus dem PGN-Kopf (`UTCDate`+`StartTime` bis `EndDate`+`EndTime`), also der echten Zeit am Brett. Daily-Partien laufen über Tage; eine Tagessumme daraus wäre sinnlos, sie zählen deshalb mit `d = 0` und erscheinen nur als Partienzahl. Obergrenze 6 h je Partie gegen kaputte Kopfdaten.

**07.11.2026 — Taktik nur als Rekordwerte:** Die offene Schnittstelle liefert **keine Anzahl gelöster Taktiken und keinen Tagesverlauf**, nur `tactics.highest`, `tactics.lowest` und `puzzle_rush.best` (an drei Konten geprüft). Entscheidung: nur API-Werte, kein manuelles Eintragen. Die App legt bei jedem Abgleich einen Tages-Schnappschuss an und baut daraus ab Installation einen eigenen Verlauf. Ein Hinweis in der Taktik-Ansicht sagt diese Grenze offen.

**07.11.2026 — Historie zwölf Monate:** Erster Abgleich holt die letzten zwölf Monatsarchive, danach nur noch den laufenden Monat; abgeschlossene Monate ändern sich nicht mehr und werden nie neu geholt (`db.months`). In den Einstellungen auf 3 Monate oder „Alles" umstellbar. Zwölf Monate eines aktiven Kontos sind rund 860 Partien ≈ 50 KB.

**07.11.2026 — Allzeit-Ansicht bei Rating und Spielzeit:** Beide Ansichten haben einen vierten Zeitraum „Alles" (Wert 0, dieselbe Null wie bei der Historie). Die Bündelung richtet sich nach der Spanne, damit nie hunderte Striche auf 340 px stehen: Spielzeit bis drei Jahre ein Balken je Monat, darüber je Jahr; Rating bleibt bei einem Punkt je Tag, bekommt aber ab 400 Tagen Monat **und Jahr** an die Achse, sonst stünde „Nov." mehrfach darunter. „Alles" reicht nur so weit wie der gespeicherte Datensatz: steht die Historie auf 3 oder 12 Monate, sagt ein Hinweis in beiden Ansichten genau das und nennt den Weg zum vollen Verlauf. Einen „Zeitraum davor" gibt es bei „Alles" nicht, an seiner Stelle steht das Datum der ersten gespeicherten Partie.

**07.11.2026 — Rating-Knopf „12 Monate" heißt „1 Jahr":** Vier Knöpfe müssen auf ein 360-px-Handy passen. „1 Jahr" ist kürzer, sagt dasselbe und klingt wie der Spielzeit-Knopf daneben.

**07.11.2026 — Ein Punkt je Tag in der Rating-Kurve:** Pro Partie wären es über ein Jahr tausende Punkte auf 340 px. Der letzte Wert eines Tages gilt; die große Kopfzahl kommt aus `/stats` und ist damit immer der amtliche aktuelle Wert.

**07.11.2026 — Varianten getrennt:** Partien mit `rules ≠ chess` (Chess960 usw.) bekommen die Marke `x`. Sie zählen in der Spielzeit mit, aber nicht in der Rating-Kurve — sie haben bei chess.com ein eigenes Rating.

**07.11.2026 — Tagesgrenze lokal:** Tage werden nach lokaler Zeit gebildet, nicht nach UTC. Sonst rutschen Abendpartien auf den Folgetag. Der Node-Test nagelt dafür `TZ=Europe/Berlin` fest.

**07.11.2026 — Icons:** Für „Taktik" stand kein geprüftes Puzzle-Symbol zur Verfügung, deshalb **swords**. Für „Rating" **chart-line**, für „Spielzeit" **chart-column**, für den Abgleich **refresh-cw**, für „Heute" **house**. Alle Pfade unverändert aus vorhandenen, geprüften Dateien übernommen, keiner aus dem Gedächtnis geschrieben.

**07.11.2026 — Konto in der Ersteinrichtung statt im Code:** Die App wird öffentlich gestellt, jeder soll seine eigenen Daten sehen. Deshalb ist kein Benutzername eingebaut: Beim ersten Start fragt die App danach und prüft ihn gegen `…/pub/player/<name>`, bevor sie ihn speichert. Ein Kontowechsel löscht Partien, Monatsvermerke und Schnappschüsse — sonst mischten sich zwei Spieler in einer Kurve. Alle Daten bleiben im Browser des jeweiligen Besuchers, es gibt keinen Server und keine gemeinsame Ablage.

## Abweichungen vom Skill

**Netzwerkzugriff auf api.chess.com.** Der Skill verlangt „kein Netzwerk". Diese App ist eine Auswertung fremder Daten, ohne Abruf gäbe es nichts zu zeigen. Umfang der Abweichung:
- Abgerufen werden nur `…/pub/player/<name>`, `…/stats`, `…/games/archives` und die Monatsarchive. Kein Schlüssel, kein Login, nur öffentliche Daten.
- Es wird **kein Code** nachgeladen: Schriften, Icons und Skripte liegen alle im Projekt.
- Der Service Worker fasst fremde Ursprünge nicht an (`url.origin !== location.origin → return`), damit nie ein altes Rating aus dem Cache kommt.
- Der Checklisten-Grep `grep -nE "https?://" *.html *.js *.css` trifft deshalb bewusst `sync.js`.
- Ohne Netz startet die App normal und zeigt den gespeicherten Stand mit „Stand vom …".

**Kein Testdaten-Skript in `tests/`.** Statt erfundener Daten liegt ein echtes Monatsarchiv (`tests/m10.json`, Oktober 2026, 76 Partien) als Prüfstein dabei — realistischer als jede Nachbildung, und die Sollwerte wurden unabhängig von `sync.js` nachgerechnet. Die Gegenproben (leerer Speicher, kaputte Werte, ein einzelner Tag) stehen als Fälle im selben Test.

## Offen

Nur am Handy prüfbar:
- [ ] Installieren-Knopf erscheint, Chrome schickt das echte Ereignis
- [ ] Animationen laufen flüssig; mit „Bewegung reduzieren" bewegt sich nichts
- [ ] Weichzeichner der unteren Leiste beim Scrollen
- [ ] Ob Cloudflare mobilen Browsern dieselbe Antwort gibt (am Desktop geprüft; `curl` ohne Browser-Kennung bekommt eine Challenge, ein echter Browser nicht)
- [ ] Dauer des ersten Abgleichs im Mobilfunknetz (am Rechner: 12 Monate in wenigen Sekunden)

Sonstiges:
- [ ] Der Taktik-Verlauf braucht zwei Tage mit Abgleich, bevor er eine Kurve zeigt — erst dann lässt sich beurteilen, ob die Ansicht genug hergibt.
- [x] Rating-Kurve bei „Daily" geprüft — mit einem zweiten, fremden Konto (Daily-Kurve über 120 Spieltage) beim Test der Ersteinrichtung.
