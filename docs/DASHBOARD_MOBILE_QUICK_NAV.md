# SMA – Mobile Schnellnavigation

Stand: 11. November 2026. Ergänzung zur globalen Suche,
Dateisuche, Bestellsuche und vollständigen History-Suche.

Auf Handybreite bis 700 px erscheint **nur dann**, wenn das
Dashboard nicht bereits eine eigene mobile Navigationsleiste besitzt,
eine kompakte untere Leiste mit den tatsächlich verfügbaren
Schnellzielen:

**Start · Dateien · Aufträge · Shop · Suche**

Nicht enthaltene oder nicht freigeschaltete Paketbereiche
erscheinen nicht. Die Seite erhält am unteren Rand ausreichend
Platz, damit die Leiste keine Bedienelemente überdeckt.
Bei größeren Bildschirmbreiten bleibt die bestehende
Sidebar- und Kapitel-Navigation unverändert.

Jeder Button verwendet dieselben authentifizierten
Sidebar-Klickaktionen wie das vorhandene Dashboard.
**Dateien** öffnet den bisherigen Veröffentlichung-Reiter
„Dateien“ einschließlich Suchfeld.
**Aufträge** öffnet „History → Aufträge“.
**Suche** zeigt das vorhandene globale Suchfenster.
Es werden weder neue Ansichten aufgebaut noch Formulare
kopiert, gespeichert oder ohne Kundenfreigabe ausgeführt.

Die Leiste wird nicht zusätzlich eingeblendet, wenn das
Dashboard bereits `nav.mobile-nav` oder
`[data-mobile-navigation]` enthält. Bei Abmelden,
Kontowechsel oder Dashboard-Neuladen werden alle
Listener, Stile und die Leiste entfernt.

## Grenzen

Kein eigener Netzwerkzugriff, keine neue Anmeldung,
keine Veröffentlichung, keine Bestell- oder Zahlungsaktion,
keine Änderung der n8n-/Supabase-API und keine Musik-Credits.

## Nachweis

`tests/dashboard-mobile-nav.test.cjs` prüft die
sichtbaren Ziele, fehlende Paketbereiche, vorhandene
mobile Navigation, sichere Routen, Entfernung bei
Neuladen und das Fehlen jeder Datennetzwerkfunktion.

## Ergänzung: aktiven Bereich automatisch markieren

Die mobile Leiste erkennt jetzt die tatsächlich sichtbare
Dashboard-Seite. Wechselt ein Kunde **über die Sidebar, die globale
Suche oder die bestehende Navigation**, aktualisiert die Leiste ihren
blauen Auswahlzustand automatisch.

Im Veröffentlichungsbereich wird **Dateien** nur als aktiv angezeigt,
wenn der vorhandene Kapitelreiter „Dateien“ tatsächlich ausgewählt ist.
Wird zu „Portale“ gewechselt, erhält „Dateien“ keine irreführende Markierung.

Die Zustandsbeobachtung betrifft nur bestehende Seiten und den
vorhandenen Datei-Kapitelreiter. Sie führt **keine zusätzlichen
Netzwerkaufrufe** aus und wird beim Dashboard-Abmelden vollständig
abgebaut. Der bestehende Shop, die History und alle Kundenrechte
bleiben unverändert.
