# SMA Dashboard – Datei finden und direkt öffnen

Stand: 11.11.2026. Umsetzung der ersten Navigationsverbesserung ohne neue Kundenrechte, APIs oder Browser-Tabs.

## Was sich im bestehenden Dashboard ändert

Unter **Veröffentlichung → Dateien** stehen oberhalb der vorhandenen Galerie ein Suchfeld
**„Datei suchen …“** und ein Filter **„Alle Portale / YouTube / TikTok / Instagram / Facebook“**.

- Die Suche arbeitet direkt auf der bereits für das angemeldete Kundenkonto geladenen Dateiliste.
- Suchbegriffe können Teile des Dateinamens sein, auch bei Bindestrichen, Unterstrichen, Groß-/Kleinschreibung und Umlauten.
- Während der Eingabe zeigt die Galerie nur passende Dateien. Eine kurze Trefferzahl bleibt sichtbar.
- Die vorhandenen zehn Dateien pro Seite bleiben erhalten – die Seitennavigation berücksichtigt nun die gefilterten Treffer, nicht den gesamten Katalog.
- Jede gefundene Datei besitzt den Button **„Im Portal öffnen“**. Er öffnet den vorhandenen Optimierungsbereich für die jeweilige Datei im **gleichen Dashboard-Tab**. Der gewählte Portalfilter bestimmt dabei das Portal; bei „Alle Portale“ wird nach Möglichkeit die bestehende Portalzuordnung verwendet.
- Die bisherigen Dateikacheln, Vorschaubilder, Dateidetails, Texte, Shop-Links und Sicherheitsprüfungen bleiben erhalten.

Zusätzlich gibt es in der bestehenden Sidebar direkt beim Upload-Einstieg **„Dateien suchen“**.
Der Button verwendet die vorhandene Navigation und aktiviert den Datei-Reiter; kein neues Fenster oder Link wird geöffnet.

## Technische Grenzen

Die Suche ist **nur eine clientseitige Ansicht** über `sma_publication_files_v1('list')`, die bereits auf Eigentümer und Kunde beschränkt ist. Sie ändert weder das Suchergebnis im Backend noch Drive-Zugriffsrechte, schafft keine neue übergreifende Kundensuche und speichert keinen Suchbegriff im Browser-Speicher.

**„Im Portal öffnen“** übernimmt ausschließlich die bestehende Datei-ID in den bisherigen Optimierer. Es startet **keine** automatische Freigabe, keinen Social-Upload, keine Musik-Abbuchung und keinen Provideraufruf.

Falls eine gesuchte Datei nicht im geladenen Kundenordner-Katalog enthalten ist, kann die Suche sie nicht finden; dann bleibt **„Dateien aktualisieren“** der vorhandene sichere Weg zum echten Google-Drive-Abgleich.

## Weitere Navigationsarbeit

Die neue Dateisuche ist der erste Schritt. Eine spätere übergreifende Suche nach Aufträgen, Bestellungen, Kundendateien und Shop-Produkten soll getrennt und nur mit berechtigten, serverseitigen Suchfunktionen folgen. Keine zusätzlichen Datenquellen werden in dieser Stufe erschlossen.

## Prüfung

`tests/dashboard-file-search.test.cjs` deckt Suchausdrücke, Portalfilter, Datenschutz, gefilterte Paginierung und die direkte Editorroute ab. Die vorhandenen Dashboard-, History-, Kapitel- und Veröffentlichungs-Regressionstests bleiben aktiv.
