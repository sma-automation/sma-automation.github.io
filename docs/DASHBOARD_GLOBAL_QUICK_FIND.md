# SMA – Globale Schnellnavigation und Dateisuche

Stand: 11. November 2026. Zweiter Dashboard-Navigationsschritt nach PR #235.

## Kundensicht

Im bestehenden Dashboard-Kopf steht eine schmale Aktion **„Suche“**. Ein Klick
öffnet ein kompaktes Suchfenster **innerhalb des aktuellen Dashboards** – kein neuer
Tab, keine Anmeldung, keine externe Webseite. Mit **Strg+K** bzw. **Cmd+K**
kann der Kunde die Suche ebenfalls öffnen; **Esc** schließt sie wieder.

Gesucht werden:
- die vorhandenen, für das Konto tatsächlich sichtbaren Bereiche, darunter
  Übersicht, Veröffentlichung, Dateien, History, Social Media, Content,
  Musikbibliothek, Shop, Webseite und Einstellungen;
- die **bereits geladenen** Kundendateien nach Dateinamen, sobald mindestens
  zwei Zeichen eingegeben wurden.

Ein Treffer für einen Bereich verwendet die **originale Sidebar-Navigation**.
Ein Treffer für Dateien öffnet den vorhandenen Optimierer mit genau der bereits
berechtigten Datei. Alle Schritte bleiben im selben Dashboard.

## Sicherheit und Grenzen

Die Suche arbeitet ausschließlich mit den momentan sichtbaren
Navigationspunkten und der bestehenden, nutzerspezifischen Dateiliste
von `sma_publication_files_v1('list')`. Sie lädt keine Daten einer
anderen Person und öffnet keine neuen Backend-Endpunkte. Nicht
verfügbare oder gesperrte Paketbereiche werden nicht als Ziel
angeboten, wenn deren Navigation nicht vorhanden ist.

Es gibt **keine** automatische Veröffentlichung, keine Freigabe, keinen
Provideraufruf, keine Musik-Credit-Abbuchung und keine neuen Kosten.

Die Suche umfasst in dieser Stufe **Bereichsnamen und Dateinamen**,
nicht die Inhalte sämtlicher Bestellungen, Aufträge, Texte oder
Supportnachrichten. Eine echte übergreifende Inhaltsuche benötigt später
eigene serverseitige, kundengebundene Suchfunktionen und Rechteprüfungen.
Das hier ist bewusst kein irreführendes Versprechen einer Volltextsuche.

## Technische Umsetzung

- `app/assets/dashboard-quick-find.mjs`: eigenständige kleine Suchoberfläche,
  ohne Network-Requests oder Browserspeicher;
- `app/dashboard.html`: bindet die Suche an den vorhandenen authentifizierten
  Dateikatalog und die tatsächlichen Sidebar-Klickpfade;
- `tests/dashboard-global-quick-find.test.cjs`: überprüft Bereichssuche,
  Dateifund, Dialog, Escape, Datenisolation und unveränderte Navigation.

Nach einem Kontowechsel oder Abmelden werden die Suchoberfläche,
Listener und Treffer vollständig entfernt.

## Reihenfolge weiterer UI-Arbeit

Die nächsten sinnvollen Bereiche sind einheitliche Suche/Filter in
History und Bestellungen, bessere Statusanzeigen für laufende Aktionen
und kurze, mobile Hauptseiten. Die Navigation soll dabei die vorhandenen
Kapitelreiter mit feinem Unterstrich beibehalten; keine zusätzlichen
langen Tabellen oder doppelten Beschreibungen.


## Ergänzung: Auftrags- und Bestellsuche direkt erreichen (11.11.2026)

Ab zwei eingegebenen Zeichen bietet die globale Suche zusätzlich
**„In Aufträgen suchen“** und **„In Bestellungen suchen“** an,
sofern die entsprechende Dashboard-Seite für das Konto vorhanden ist.
Diese beiden Aktionen übernehmen den Suchtext in die jeweils bestehende
Suche, öffnen den passenden Reiter und zeigen das zugehörige Eingabefeld.

- History nutzt ausschließlich den bereits installierten,
  kundenbezogenen `sma_publication_history_find_v1`-RPC.
- Shop nutzt ausschließlich die vorhandenen Bestellnummernfilter
  mit dem bereits bestehenden `user_id`- und RLS-Schutz.
- Ungültige Shop-Suchzeichen werden nicht ungeprüft weitergereicht;
  stattdessen wird nur das Suchfeld geöffnet.
- Ist eine eingebettete Shop-Seite noch nicht geladen, bleibt die
  globale Suche mit einem Hinweis offen. Es entstehen keine weiteren
  Berechtigungen, Datenkopien, Zahlungen oder Veröffentlichungen.

Die Suchtreffer für Aufträge und Bestellungen werden **nicht** im
globalen Dialog gespeichert, sondern ausschließlich innerhalb der
bestehenden, geschützten Fachansichten abgerufen.
