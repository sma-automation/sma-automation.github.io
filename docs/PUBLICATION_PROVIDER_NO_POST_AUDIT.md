# SMA – Offline-Prüfung der YouTube-/TikTok-/Cover-Freigabekette

**Stand:** 11. November 2026. Keine Live-Provider-Anfrage, keine
Veröffentlichung und keine Änderung bestehender n8n-Workflows.

## Geprüfter tatsächlicher Anschluss

Der nachträglich übernommene Provider-/Coverweg verwendet derzeit die
47-Node-Kopie `JaidX5YeKl6ZTqjQ`. Die veröffentlichte
Dashboard-Auftrags-API `RdtCqCWRi7P4W7B0` ruft genau diese Kopie auf
und nicht die ältere 29-Node-Kopie
`JPtiMBrudXLxxSrz`. Die alte PR #57 wurde geschlossen und
nicht selbst zusammengeführt; spätere Änderungen übernahmen ihren
erforderlichen Inhalt. Die Dokumentation vom 3. November ist deshalb
nicht mehr als aktueller Branch-Status zu lesen.

Aus dem aktuellen Supabase-Lesestand:
- **10 Aufträge** insgesamt: 9 storniert, 1 vorbereitet
- **0 Provider-Testfreigaben**
- **0 Provider-Anfrageversuche**
- **0 registrierte technische Galerie-Nachweise**

Der vorbereitete Auftrag ist ausdrücklich **keine** Zustimmung
des Kunden und löst keinen Provider-Upload aus.

## Neue unabhängige Sicherheitskontrolle

`tests/publication-provider-no-post-graph.test.cjs` rekonstruiert
ausschließlich offline den **wirklichen generierten 47-Node-Workflow**
aus dem versionierten Ausgangsexport und `patch-provider-cover.py`.

Die Tests prüfen für alle drei Provider-HTTP-Knoten und den
YouTube-Cover-Upload:
- interner Unterworkflow statt öffentlichem Webhook/Zeitplan
- Kontenprüfung, Auftragsbindung und Reservierung vor jedem Transfer
- für Cover die verifizierte Coverdatei, ihre Revision und
  separate `cover_begin`-Reservierung
- keine automatischen HTTP-Wiederholungen oder Weiterleitungen
- nachgeschalteter Aufruf ausschließlich bei gespeicherten
  `checked`-Aufträgen und Aktion `approve` oder `get`
- synthetisch eingeschleuste Umgehung muss vom Graph-Prüfer
  **erkannt** werden.

Diese statische Graphprüfung kann **keine echten Provider-Zugänge,
Kundenfreigaben oder einen Netzwerkupload belegen**. Sie ergänzt
die bestehenden synthetischen SQL-, Media-, Cover- und HTTP-Tests,
statt sie zu ersetzen.

## Weiter bestehende Voraussetzungen für einen echten Upload

Die Sichtengine-Videoanalyse liefert weiterhin
`VIDEO_PLAN_REQUIRED`. Es fehlt außerdem die ausdrückliche
Kundenfreigabe für genau das Video und Zielkonto sowie eine
gesonderte administrative Freigabe für einen Provider-Test.
Vor einer realen Videoübertragung wären außerdem Kontorechte,
eine aktuelle Originaldatei- und Coverrevision, Rechts-/Werbe-
und KI-Kennzeichnungen und die unveränderten Portaltexte erneut
zu prüfen. Kein Testfall in diesem PR setzt eine dieser Freigaben.

## Datenschutz und Betrieb

Keine Token, Dateibytes oder Kundencaptions im Repository.
Die neue Prüfreihe verwendet ausschließlich synthetische
Anfragen und bestehende, bereits veröffentlichte Exportdefinitionen.
Keine Datenbankmigration, n8n-Bereitstellung oder Änderung am
SMA-Dashboard.
