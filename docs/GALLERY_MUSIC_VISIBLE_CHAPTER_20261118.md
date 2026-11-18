# SMA – Galerie-Musik nur im aktiven Kundenbereich abfragen

Stand: 18.11.2026. Ergänzung zum [vorherigen Fix gegen Hintergrund-Tabs](GALLERY_MUSIC_HIDDEN_TAB_READS_20261118.md).

## Gefundene Doppelbelastung

Die eigentliche Dashboard-Seite (`app/dashboard.html`) lädt den
Galerie-Musikworker direkt beim Aufbau der Dateiansicht. Der Worker kann
weiter im Hintergrund mit Supabase `sma_gallery_music_v1` abgleichen,
wenn der Kunde im gleichen sichtbaren Browser-Tab stattdessen den Shop,
die Übersicht oder einen anderen Bereich verwendet. Das Ausblenden eines
Dashboard-Kapitels setzt `document.hidden` im Browser nicht auf
`true`; die frühere Pausenfunktion gegen Hintergrund-Tabs allein
reicht hier also nicht aus.

Die Portaloptimierung hat zwei Betriebsarten:

- **Im Dashboard eingebettet:** `publication-preview.js` erzeugt
  bewusst keinen zweiten Musikworker; der äußere Dashboard-Worker
  übernimmt die Arbeit.
- **Als eigene Browserseite:** Die Portaloptimierung startet
  ihren eigenen Musikworker, mit dem zuletzt verbesserten
  Hintergrund-Tab-Schutz.

Deshalb darf der äußere Worker während der aktiven Galerie oder einer
eingebetteten Optimierung weiterlaufen. Auf anderen Dashboard-Kapiteln
und im nur geöffneten Portal-Verbindungskapitel muss er seine
unbenutzten `claim`-Abfragen pausieren.

## Eingebaute Korrektur

Die kleine, browserlokale Gate-Funktion
`app/assets/gallery-music-view-gate.mjs` beobachtet relevante
Klassen-, `hidden`- und Sichtbarkeitsänderungen. Bei einem
**tatsächlichen** Wechsel von nicht sichtbar zu sichtbar weckt sie
den bestehenden Worker einmal, **außer** wenn die Dateiliste gerade
neu geladen wird, ein Fehler erneut geprüft wird oder ein Ordnerabgleich
läuft. Diese Vorgänge dürfen keine zweite Musik-Statusabfrage erzeugen. Unveränderte DOM-Änderungen lösen
keine weiteren Aufträge aus. Sie selbst verwendet **keinen Timer,
keinen Netzwerkaufruf und kein Kunden-Credential**.

`app/dashboard.html` gibt den sichtbaren Kapitelstatus an den
Worker weiter. Die einmalige Galerielisten-Aktualisierung nach einem tatsächlich
abgeschlossenen Musikauftrag bleibt auch bei einem zwischenzeitlichen
Kapitelwechsel erhalten. Gespart werden Leerlauf-Abfragen, nicht die
Bestätigung einer gespeicherten Datei. Bereits beanspruchte Aufträge und bestätigte
Upload-Receipts werden unverändert zu Ende geführt.

`app/assets/publication-preview.js` verwendet jetzt die aktuelle
Version des Workers auch im eigenständigen Editor.
Versionsparameter verhindern, dass ältere browserseitig gecachte
Module die Verbesserung verdecken.

## Abgrenzung

- **Keine neuen n8n-Workflows**, kein zusätzlicher n8n-Start,
  keine Änderung an Cron- oder Zahlungsabläufen.
- Der bestehende minütliche Supabase-Musikzeitplan bleibt aktiv und
  ruft n8n nur auf, wenn die serverseitige Auswahl einen Auftrag hat.
- Keine Veröffentlichung, keine Musikguthabenbuchung, keine Änderung
  an Freigabe-, Dateirevisions- oder Eigentümerprüfungen.
- Eine nachgewiesene Verringerung der Supabase-Browser-RPCs kann erst
  durch vergleichbare Live-Protokolle nach Bereitstellung festgestellt
  werden. Dieser Fix ist nicht als Einsparung bei den **10.000
  abgerechneten n8n-Executions** zu zählen.

## Offline-Prüfung

```sh
node --test tests/gallery-music-view-gate.test.cjs tests/gallery-music.test.cjs
```

Die Regressionen verwenden ausschließlich synthetische RPC-Antworten
und fiktive Kapitel-Sichtbarkeitszustände. Sie belegen das Aussetzen
und Wiederaufnehmen von Leerlaufabrufen, nicht einen tatsächlichen
Musik-Provider-End-to-End-Durchlauf.

## Nachtrag: Versteckte Galerie nicht nach abgeschlossener Vertonung laden (18.11.2026)

Ein schon beanspruchter Musikauftrag wird bei Kapitel- oder Tabwechsel wie bisher
bis zum gespeicherten Upload-/Server-Receipt zu Ende geführt. **Neu:** Ist der
Kundenbereich beim Abschluss verborgen, löst der Browser keine sofortige
`sma_publication_files_v1('list')`-Abfrage aus. Er merkt sich genau eine fällige
Aktualisierung; bei der nächsten sichtbaren Rückkehr lädt er zuerst den
Dateikatalog und fragt erst danach nach weiterer fälliger Vertonung. Auch mehrere
Kapitelwechsel duplizieren diese nachgeholte Aktualisierung nicht.

Ein weiteres doppeltes Polling entfällt: Die `onComplete`-Ladung aus dem
Musikworker weckt ihn **nicht** während seiner eigenen Drain-Schleife neu.
Der laufende Worker führt seinen vorhandenen Folge-Claim selbst aus. Normale
Galerie-Einstiege, manuelles Aktualisieren und neue Musikfreigaben behalten die
bisherige Wecklogik. Bei Logout/Accountwechsel zerstört die bestehende
Worker-Entsorgung die vorgemerkte Aktualisierung ohne Datenübernahme.

Die Regression deckt ein während der Quelllesung verborgenes Kapitel,
bestätigte Speicherung, Null Reloads im Hintergrund, exakt einen nachgeholten
Reload und mehrfachen Sichtbarkeitswechsel ab. Der Fix ändert keine n8n-
Workflows, Serverzeitpläne, Kundendaten, Bezahl- oder Veröffentlichungsrechte.
Er vermeidet unnötige **Supabase-RPCs**; eine Einsparung bei abgerechneten
n8n-Starts ist damit nicht belegt.
