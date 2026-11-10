# SMA – Textvarianten sofort sichtbar und bedienbar (10.11.2026)

## Gemeldetes Problem

Nach PR #191 funktioniert die wiederholte Texterstellung: In der realen Datenbank wurden mehrere voneinander abweichende fertige YouTube-Textfassungen für das 10-Sekunden-Testvideo nachgewiesen; später wurde eine Fassung ausdrücklich übernommen. Die Kundensicht war dennoch irreführend: Der Vorschlag und die drei Auswahlaktionen standen erst **unterhalb** des langen bisherigen Titels, Beitragstextes, der Hashtags und der Prüfdetails. Ohne Scrollen wirkte der Button wirkungslos.

## Korrektur

- Die **neue Textvariante** mit Titel, Text, Hashtags, **„Variante übernehmen“**, **„Weitere Variante erstellen“** und **„Verwerfen“** wird jetzt **oberhalb des bisher gespeicherten Texteditors** dargestellt.
- Nach erfolgreicher Erzeugung wechselt der bestehende Ablauf zur Inhaltsansicht, scrollt automatisch zum Vorschlag und fokussiert die Überschrift. Ein Wiederholungsklick funktioniert weiterhin ohne neue Videoanalyse.
- Bei einem weiteren Klick innerhalb der serverseitigen Schutzfrist (**30 Sekunden**, höchstens **20 pro Stunde**) erscheint der Fehler direkt im Variantenbereich. Der bisherige Kandidat bleibt sichtbar und kann übernommen werden; sein Titel/Text wird nicht gelöscht.
- Die bisherige Datei-/Portalzuordnung bleibt bis **„Variante übernehmen“** unverändert. Bestehende Änderungen, Konflikte, Kundenzuordnung und Publikationssperren bleiben wie vor der Korrektur geschützt.
- Die normale Galerie, das Uploadfenster und alle freigegebenen Kapitelreiter bleiben unverändert.

## Abnahme

- `tests/optimizer-workspace.test.cjs`: Kandidat ist vor dem gespeicherten Entwurf, Scroll- und Fokus-Verhalten funktionieren, Ratelimit-Meldung wird sichtbar und bei Verwerfen zurückgesetzt.
- `tests/publication-page.test.cjs`: Nach einer fertigen Textgenerierung erfolgt der Sichtbarkeitswechsel; eine zurückgewiesene Wiederholung belässt die vorherige Variante sichtbar und meldet die Wartezeit.
- `tests/run-optimizer-layout.mjs`: Die neue Position und die Aktionsbuttons passen ohne horizontales Scrollen in alle vier Portalansichten einschließlich schmaler Mobilansichten.
- Gesamte Test-/Provider-/Musik-/SQL-Suiten über GitHub Actions.

Keine neue Providerfreigabe, kein Upload, keine Veröffentlichung, keine zusätzlichen Kosten- oder Tarifänderungen. **Das ist eine tatsächliche UI-/Bedienkorrektur; der echte Backend-Nachweis der unterschiedlichen Texte liegt bereits vor.**
