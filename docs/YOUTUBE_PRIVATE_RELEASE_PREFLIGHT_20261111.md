# SMA – Privater YouTube-Test: wiederholbarer Nur-Lesen-Abnahmecheck

**Stand: 13. November 2026, Österreich.** Kein Kunde und kein Upload wird durch
diesen Prüfbericht freigegeben.

## Zweck

`supabase/sql/youtube-private-release-preflight-readonly.sql` führt **eine einzige
lesende SELECT-Abfrage** in der berechtigten internen Supabase-SQL-Ansicht aus.
Sie durchsucht vorbereitete YouTube-Aufträge, bindet den SMA-Dateikatalog
über Eigentümer und exakte Revision, ruft die vorhandene stabile Medienvorprüfung
und Freigabefrist-Prüfung auf und zählt gespeicherte Provider-Berechtigungs-
und Versuchseinträge.

Seit Version 2 enthält `checked_private_youtube` zusätzlich die bereits geprüften
privaten YouTube-Aufträge. `order_counts` und `media_check` beziehen sich weiterhin
auf vorbereitete Aufträge. Ein geprüfter Auftrag kann eine gespeicherte Kundenfreigabe
und gleichzeitig null Übertragungsversuche haben. Die Betreiberfreigabe zählt nur
bei passendem Auftragsfingerabdruck als aktuell oder abgelaufen. Die Kontoprüfung
wertet den gespeicherten Nachweis für das gewählte Ziel aus.

Versuche und Ereignisse werden je Auftrag gezählt. Mehrere Ereignisse für eine
Übertragung zählen einmal. `portal_confirmed_private` verwendet denselben
bestätigten Privatstatus wie die Kunden-History.

Am 13.11.2026 um 12:51 Uhr (Wien) ergab die Leseprüfung drei vorbereitete
YouTube-Aufträge und einen geprüften privaten Auftrag. Für diesen waren die
Kundenfreigabe und eine abgelaufene, passende Betreiberberechtigung gespeichert.
Die Zähler für aktuelle Kontonachweise, aktuelle Betreiberberechtigungen,
Übertragungsversuche, Ereignisse und bestätigte private Ergebnisse standen bei null.

Die Ausgabe enthält nur **aggregierte Zahlen, technische Prüfstatus und
standardisierte Prüfcode-Namen**, niemals Auftrag-, Kunde-, Datei- oder
Zielkonto-Kennungen, Textentwürfe, Zugangsdaten oder Videobytes. Es wird keine
neue RPC, Browserfunktion, n8n-Aktivierung oder externe Providerabfrage angelegt.

## Live-Nur-Lesen-Ergebnis vom 11.11.2026

| Prüfschritt | Ergebnis |
| --- | ---: |
| Vorbereitete YouTube-Aufträge | 1 |
| Davon als privat gewählt | 1 |
| Im SMA-Katalog verfügbare Datei | 1 |
| Passende gespeicherte Dateirevision | 1 |
| Innerhalb 15 Minuten verifizierter Dateikatalog-Eintrag | 0 |
| Aktives serverseitiges Freigabefenster | 0 |
| Persönliche bestätigte Freigaben | 0 |
| Aufträge mit Betreiber-Providerberechtigung | 0 |
| Aufträge mit Provider-Versuchseintrag | 0 |
| Technische YouTube-Teilprüfungen | 4 bestanden, 4 offen, 0 fehlgeschlagen |

Die konkreten offenen Medien-Prüfcodes sind
`FILE_REFRESH_REQUIRED`, `CONTENT_REVIEW_PENDING`,
`SEMANTIC_REVIEW_PENDING` und `PUBLICATION_APPROVAL_PENDING`.
Der andere Code `FILE_CHANGED` wird bei bloß abgelaufenem
Dateikatalog-Nachweis **nicht** mehr behauptet (Migration
`20261111211712_publication_assignment_stale_file_reason_20261111`).

**Wichtige Grenze:** Identische *gespeicherte* SHA-Dateirevisionen
sind kein frischer Beweis, dass die Google-Drive-Videobytes unverändert sind.
Eine vergangene, gültige Kontoabfrage beweist keine aktuelle YouTube-OAuth-Berechtigung.
Ein einzelner gespeicherter Provider-Berechtigungseintrag ersetzt niemals
die Prüfung des aktuellen Auftrags-Fingerprints. Der Bericht enthält daher
explizit `allows_upload=false`, `allows_publication=false`,
`initiates_checkout=false` und
`provider_e2e=NOT_VERIFIED_BY_THIS_QUERY`.

## Nächster **bewusst auszuführender** Testweg

1. Im angemeldeten **SMA-Dashboard → Veröffentlichung → Datei** beim
   betreffenden Video **Dateien aktualisieren**. Der vorhandene
   Google-Drive-Katalogdienst muss den exakten Inhalt erneut autorisiert
   prüfen. Nicht anhand dieses Berichts selbst Zeitstempel setzen.
2. Unter **History → Aufträge** den vorbereiteten YouTube-Test aufrufen.
   Nur der Kontoinhaber kann **Vorbereitung neu starten** auswählen und
   damit die Zielkontooptionen neu abrufen. Der alte Auftrag bleibt
   unangetastet, seine abgelaufene Frist darf nicht stillschweigend
   verlängert werden.
3. Der Kunde prüft die tatsächlich ausgesuchte Originaldatei einschließlich
   Bild, Ton, Marken-/Werbe-/KI-Hinweisen und alle gespeicherten
   Portaltexte. Nur bei zutreffenden Aussagen und vorhandenen
   Nutzungsrechten darf er die konkrete persönliche Erklärung abgeben.
   Die dokumentierte manuelle visuelle/semantische Prüfung ersetzt
   weder die Sightengine-Vollanalyse noch eine Betreiberfreigabe.
4. **Getrennt und ausdrücklich** muss der SMA-Betreiber den konkreten,
   neu gebundenen privaten YouTube-Test samt Provider-/Cover-Fingerprint
   freigeben. Ohne diese zusätzliche Berechtigung kein echter Upload.
   Auch „privat“ ist ein echter Provider-Upload.

Die bereits abgelaufene Vorbereitung wird **nicht automatisch**
neu erstellt. Sightengine bleibt auf dem aktuellen kostenlosen Tarif;
`VIDEO_PLAN_REQUIRED` wird nicht durch eine kostenpflichtige Option umgangen.

## Tests und Betrieb

`tests/youtube-private-release-preflight-readonly.test.cjs` schützt den
Nur-Lesen-Vertrag, die datensparsame Ausgabe, die echte Revisionsbindung,
die verwendeten Prüfquellen und die Sperren gegen Upload/Publikation.

Die SQL-Abfrage wurde am 11.11.2026 an der verbundenen, bestehenden
Produktionsdatenbank **ohne Schreibzugriff** ausgeführt. Ihr Ergebnis ist
eine Momentaufnahme: besonders `verified_last_15m` wird nach einer
Arbeitspause häufig wieder null. Die Prüfung kann jederzeit wiederholt
werden, ohne Kundenstatus oder Medienprüfung zu ändern.

Referenzen: [Privater YouTube-Test](YOUTUBE_PRIVATE_TEST_READINESS.md),
[Dateinachweis-Korrektur](PUBLICATION_ASSIGNMENT_FRESHNESS_REPAIR.md),
[Persönliche Medienprüfung](MANUAL_MEDIA_REVIEW.md),
[Gesamt-Startcheck](SMA_LAUNCH_READINESS_20261201.md).
