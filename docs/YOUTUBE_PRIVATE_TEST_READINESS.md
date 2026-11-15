# SMA – Privater YouTube-Test: gesicherte Kundenfreigabe

Stand: 11. November 2026. **Nur eine kompakte Statusanzeige und
ein strengerer Freigabeschutz. Kein Upload, keine Kundenbestätigung.**

## Reale Ausgangslage (nur lesend geprüft)

Der vorhandene vorbereitete private YouTube-Testauftrag hat weiterhin
`approved_at = null` und `visibility = private`. Die bereits gespeicherte
Kontoabfrage lief am **7. November 2026** ab. Die serverseitige Freigabeansicht meldet weiterhin
`approval_window.status = expired`. Der **historische** zusätzliche
Fehler `FILE_CHANGED` war für die abgelaufene Katalogprüfung zu ungenau:
Die am 11.11.2026 installierte Migration
`20261111211712_publication_assignment_stale_file_reason_20261111`
unterscheidet seitdem `FILE_REFRESH_REQUIRED` (abgelaufener Dateinachweis)
von `FILE_CHANGED` (ungleiche gespeicherte Dateirevision).
Der erneute, rein lesende [YouTube-Abnahmecheck](YOUTUBE_PRIVATE_RELEASE_PREFLIGHT_20261111.md)
belegt eine passende gespeicherte Revision, aber keinen aktuellen
Google-Drive-Nachweis und keine neue Kontoprüfung. Damit ist weiterhin
keine belastbare Freigabe für einen Testupload vorhanden.

Ein Privatvideo ist bei YouTube **trotzdem ein echter Upload**.
Eine Kundenbestätigung, eine unabhängige Betreiber-Testfreigabe
und die tatsächlich erforderlichen Medien-/Rechteprüfungen
dürfen nicht mit einem erfolgreichen technischen Test ersetzt werden.

## Änderung

Im unveränderten Freigabedialog `app/assets/publication-order.mjs`
erscheint bei einem **vorbereiteten YouTube-Auftrag mit der
Sichtbarkeit Privat** eine kompakte vierzeilige Info:

1. Ist die Kontoprüfung und serverseitige Freigabefrist noch aktuell?
2. Ist der Dateistand unverändert, beziehungsweise welche
   Medien-/Inhaltsprüfungen sind noch offen?
3. Die persönliche Inhalts-, Bild-, Ton- und Rechtebestätigung
   muss vom Kunden selbst kommen.
4. Eine **separate SMA-Betreiberfreigabe** ist vor jedem
   echten Upload erforderlich.

Die neue Anzeige führt keine Aktion aus, erzeugt keinen
Prüfbeleg und meldet grundsätzlich **keine Uploadfreigabe**.
Sie übernimmt weder Kanal-IDs noch Captions in die Statusliste.
Andere Kanäle und öffentliche/nicht gelistete YouTube-Beiträge
erhalten diese besondere Privat-Testliste nicht.

Das bisherige Ablaufdatum wird außerdem nun **fehlersicher**
behandelt: Ist der serverseitige `approval_window` für einen
vorbereiteten Auftrag fehlend, ungültig, abgelaufen oder nicht
`active`, bleibt „Veröffentlichung freigeben“ deaktiviert,
und der Browser startet keine `approve`-Anfrage.
Die Datenbank war zuvor bereits der eigentliche Sicherheitsanker;
die Oberfläche schließt nun dieselbe Lücke.

## Grenzen

- Kein Eintrag in `publication_provider_permissions_v1`.
- Keine Änderung an bestehenden Aufträgen, Optionen, Dateien,
  Mediennachweisen, Benutzerrechten oder Musikguthaben.
- Kein HTTP-Aufruf an YouTube, TikTok, Google Drive oder n8n
  während der Tests; nur synthetische JavaScript-Daten.
- Kein Ersatz für die tatsächliche vollständig bestätigte
  Video-Sicherheitsprüfung (Sightengine meldet weiterhin
  `VIDEO_PLAN_REQUIRED`), Nutzungsrechte oder ausdrückliche
  Entscheidung des Kontoinhabers.
- Der Nutzer muss einen privaten Auftrag bei abgelaufener
  Konto-/Dateiprüfung später ausdrücklich neu vorbereiten.
  Das geschieht nicht automatisch und nicht durch diese Änderung.

## Testabdeckung

`tests/publication-private-youtube-preflight.test.cjs` prüft
Privat-Kanalfilter, auftragsgebundene Medienrevision,
fehlende und abgelaufene Freigabefristen, sichtbare
zwei unabhängige Blocker und das Ausbleiben jeder
`approve`-Netzwerkanfrage bei ungültigem Ablauf.

`tests/publication-order-dialog.test.cjs` prüft,
dass die Warnung dem Kunden im vorhandenen
Freigabefenster angezeigt wird, ohne eine Zustimmung
oder einen Provider-Aufruf auszulösen.
