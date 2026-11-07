# Schachtracker

Eine kleine Web-App fürs Handy, die den eigenen Schachfortschritt bei chess.com sichtbar macht: **tägliche Spielzeit**, **Ratingverlauf** und **Taktik-Rekorde**. Installierbar als PWA, läuft offline mit dem zuletzt geholten Stand.

## Was sie zeigt

| Ansicht | Inhalt |
|---|---|
| **Heute** | Spielzeit des Tages gegen das Tagesziel im Halbkreis, Partien, Ø je Partie, Serie an Spieltagen, die letzten 14 Tage als Balken, aktuelles Rating je Zeitklasse |
| **Rating** | Kurve je Zeitklasse (Bullet, Blitz, Rapid, Daily) über 30 Tage, 3 Monate, ein Jahr oder **alles**, mit Bestwert, Bilanz und Einordnung gegen den Zeitraum davor |
| **Spielzeit** | Woche, Monat, Jahr oder **alles** als gestapelte Balken nach Zeitklasse, Summe, Ø je Spieltag, längste Partie und die Verteilung auf die Zeitklassen |
| **Taktik** | Taktik-Bestwert mit Datum, tiefster Wert, bester Puzzle-Rush-Lauf und der selbst mitgeschriebene Verlauf dieser Rekorde |

Antippen eines Diagramms liest den Wert an dieser Stelle ab.

**Alles** zeigt den gesamten gespeicherten Verlauf: in der Spielzeit ein Balken je Monat, ab drei Jahren je Jahr. Wie weit es zurückreicht, hängt an der **Historie** in den Einstellungen — steht sie auf 3 oder 12 Monate, sagt die Ansicht das offen und nennt den Weg zum vollen Verlauf.

## Daten

Alles kommt aus der **öffentlichen Schnittstelle von chess.com** — ohne Anmeldung, ohne Passwort, nur öffentliche Daten zu einem Benutzernamen. Die App speichert die verdichteten Partien im Browser (`localStorage`); es gibt keinen Server, nichts verlässt das Gerät.

Zwei Grenzen der Schnittstelle, die man kennen sollte:
- **Gelöste Taktiken** veröffentlicht chess.com nicht — weder als Anzahl noch als Tagesverlauf. Die App zeigt deshalb die Rekordwerte und schreibt ab der Installation selbst mit, wie sie sich verändern.
- **Daily-Partien** (Fernschach) laufen über Tage und zählen deshalb keine Spielzeit, sondern nur als Partien.

## Einrichten

1. Beim ersten Start fragt die App nach dem **chess.com-Benutzernamen** und prüft ihn sofort. Danach holt sie die letzten zwölf Monate; spätere Abgleiche nur noch den laufenden Monat.
2. Tagesziele für Spielzeit und Partien nach Geschmack setzen (Zahnrad).
3. Konto wechseln oder Historie ändern geht jederzeit in den Einstellungen.

Jeder Besucher trägt seinen eigenen Namen ein und sieht seine eigenen Daten; gespeichert wird nur im Browser des jeweiligen Geräts.

Abgeglichen wird beim Start von allein, wenn der letzte Abgleich mehr als eine Viertelstunde her ist, und jederzeit über den Knopf oben rechts.

## Installieren

In Chrome auf dem Handy öffnen → Einstellungen der App → **App installieren**. Danach startet sie wie eine normale App, ohne Adressleiste und offline.

## Backup

Die Daten liegen nur auf diesem Gerät; „Browserdaten löschen" entfernt sie ohne Vorwarnung. In den Einstellungen gibt es **Backup speichern** und **Backup laden**. Die Partien ließen sich zwar jederzeit neu von chess.com holen, die mitgeschriebenen Taktik-Werte aber nicht.

## Entwickeln

```bash
python3 -m http.server 8137    # http://localhost:8137
node tests/sync-test.js        # Rechenlogik gegen ein echtes Monatsarchiv
node tools/farben.js '#F5A3C0' '#9FD86A' '#67C2E8' '#8E8BD8'
```

Kein Build, keine Abhängigkeiten. `tools/` und `tests/` werden nicht hochgeladen.
