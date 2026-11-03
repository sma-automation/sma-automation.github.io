# Dauerhafte Provider-Ergebnisse und sichere Wiederaufnahme

Stand 3. November 2026, Fortsetzung von PR #57. **Datenbankjournal installiert; Dispatcher und API-Anschluss sind als geprüfte Vorlagen vorbereitet, noch nicht live verbunden. Kein Social-Media-Upload, kein Posting und keine Upload-Testfreigabe.**

## Installiert und nachgewiesen

`publication_provider_attempt_journal_v1` installiert drei private Tabellen und den ausschließlich serviceberechtigten RPC `sma_publication_provider_v1`. Pro freigegebenem Auftrag existiert höchstens ein Versuch. Die vorhandene Veröffentlichungsreservierung bindet zusätzlich Kunde, Datei, Revision, Plattform und Zielkonto. Ein Fingerabdruck bindet Eigentümer, gespeicherten Text, Optionen, Zielkonto und die konkrete Zustimmung.

Vor jeder Provider-Anfrage werden Sequenz und Anfrage-UUID atomar gespeichert. Nur diese Anfrage darf ihr Ergebnis schreiben. Abgelaufene Leases erlauben keine zweite Initialisierung. Ein verspäteter Response darf noch dieselbe unersetzte Anfrage abschließen; nach einer neueren Übernahme wird er abgewiesen. Die Übergänge speichern ausschließlich normalisierte Ergebnisse, keine rohen Fehlermeldungen oder Tokens. Die sensible Upload-Session-URL bleibt in der privaten Versuchstabelle und wird aus dem Ereignisjournal entfernt.

`publication_provider_permissions_v1` ist ein zusätzlicher, auf den Auftrag und dessen Fingerabdruck begrenzter Freigabeschalter. Er ist leer. Weder Kundenrollen noch die service_role können dort Freigaben schreiben. Diese technische Sperre darf erst nach ausdrücklicher Freigabe eines konkreten Uploadtests administrativ gesetzt werden. Sie ersetzt keine Kundenbestätigung oder Medienprüfung.

## Verhalten bei Unterbrechungen

| Vorliegender Stand | Nächster erlaubter Schritt |
| --- | --- |
| Initialisierung gesendet, Antwort unbekannt, keine Session/Provider-ID | Manuell klären; kein erneutes Init |
| YouTube-Dateitransfer unklar | Leere Status-PUT zur gespeicherten Session |
| YouTube bestätigt Teilmenge | Nach erneuter Freigabe-/Dateiprüfung exakt ab dem bestätigten Byte fortsetzen |
| YouTube liefert Video-ID | Authentifizierte Abfrage von Video-, Kanal-, Verarbeitungs- und Sichtbarkeitsstatus |
| TikTok liefert Publish-ID, Transfer unklar | Authentifizierte Statusabfrage desselben Vorgangs; kein blindes Wiederholen des Chunks |
| Session abgelaufen | Stoppen und klären; kein automatischer neuer Upload |
| Privat/nicht gelistet fertig | Abgeschlossen, ohne öffentlichen Erfolg zu behaupten |
| TikTok öffentlich fertig, öffentliche ID fehlt | Öffentliche Verfügbarkeit unbekannt; späterer Status kann IDs ergänzen |

Bei TikTok werden bestätigte öffentliche IDs vereinigt. Eine spätere leere Antwort löscht sie nicht. Int64-IDs werden vor dem JSON-Parsing als exakte Strings erhalten. Abgeschlossene Ergebnisse werden nicht durch verspätete Zwischenstände überschrieben. Kontoprüfung und mindestens zehn Sekunden Abstand begrenzen Statusaufrufe. Es gibt keinen automatischen Polling- oder Upload-Retry-Loop.

## Vorbereiteter n8n-Anschluss

`provider-dispatch-workflow.json` hat 29 Nodes und ausschließlich einen internen Execute-Workflow-Einstieg. Ein Aufruf bearbeitet maximal eine journalgebundene Provider-Anfrage. Vor Schreibanfragen werden die bestehenden Konto-/Ordnerzuordnungen, aktuellen Drive-Metadaten, vollständigen Bytes mit SHA-256, unveränderten gespeicherten Texte, Medienchecks, Nutzerbestätigungen und der zusätzliche Testschalter geprüft. Das Konto wird über den bestehenden internen Workflow `LR2Qng41OIYuVHAR` geprüft; Zugangsdaten bleiben flüchtig in n8n.

Die Vorlage enthält getrennte HTTP-Nodes für Metadaten, Dateitransfer und Status. Redirects und automatische HTTP-Wiederholungen sind aus. Upload-Session-URLs sind auf dokumentierte HTTPS-Hosts/Pfade begrenzt; unbekannte Hosts werden abgewiesen. TikTok-Upload-URLs erhalten keinen Konto-Bearer. YouTube-Teilübertragung verwendet nur die geprüften restlichen Bytes. `provider-upload-plan.cjs` erhält Titel und Caption unverändert.

Der Dispatcher wurde **noch nicht in n8n importiert oder mit dem Auftragsworker verbunden**. Seine Tests sind lokale synthetische Tests sowie SQL-Tests, keine echten Provider-Aufrufe. Die neue Vergleichs-Arbeitskopie ist bereits importiert. Der Nutzer hat das Speichern deaktivierter Ausführungsdatenspeicherung und der Zeitlimits ausdrücklich freigegeben: 270 Sekunden für die Vergleichszustellung, 600 Sekunden für den Providerweg. Der anschließende Zugriff und das Zurücksetzen der Browsersteuerung scheiterten jeweils an einer Zeitüberschreitung; das Speichern ist nicht nachgewiesen. Die bestehende aktive API und der bestehende Ausführungsworker wurden nicht ersetzt. Nach Wiederherstellung des Zugriffs sind die bereits freigegebenen Einstellungen zu speichern und die Exporte/Verbindungen zu prüfen; keine erneute Einstellungsfreigabe nötig. Diese Freigabe umfasst keinen echten Uploadtest. Ein Einbau allein darf keine Testfreigabe erzeugen.

## Validierung

- 313 Node-Tests bestanden, einschließlich Workflow-Kanten, fehlender Freigaben, Session-URL-Grenzen, exakter Texte, Binärrest und Int64-IDs.
- Vergleichs-/Auftrags-/Creator-/Provider-SQL lokal mit PGlite 0.5.14/PostgreSQL 18 bestanden.
- Vergleich mit Delivery-Queue und Provider-Journal zusätzlich auf der produktiven PostgreSQL-17-Instanz geprüft: ausschließlich synthetische Fixtures, vollständig zurückgerollt. Medien-Stubs im isolierten Provider-Zustandsautomatentest existieren nur innerhalb der Testtransaktion; die Originalfunktions-Hashes sind danach unverändert.
- Nach Abschluss: 0 freigegebene Aufträge, 0 Veröffentlichungsreservierungen, 0 Provider-Testfreigaben, 0 Versuche, 0 Providerereignisse, 0 Vergleichs-Queueeinträge.
- Keine neue Sicherheitsberater-Warnung. Vier erwartete INFO-Hinweise für private Servicetabellen mit RLS und ohne Kundenpolicies; Kundenrollen haben keine direkten Rechte. [Hinweisbeschreibung](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

```sh
python3 n8n/publishing/build-provider-dispatch.py
node --test tests/*.test.cjs
node tests/run-publication-delivery-sql.mjs
```

## Medienblocker und verbleibende Abnahme

Sightengine wird weiterhin mit `VIDEO_PLAN_REQUIRED` abgewiesen. Der lokale Adapter hält Videomoderation bewusst gesperrt, nachdem der vorherige echte Diensttest fehlenden Planzugriff gemeldet hatte. Die aktuelle offizielle FAQ bestätigt: Videomoderation gehört nicht zum kostenlosen Plan. In dieser Sitzung wurde kein neuer kostenpflichtiger Diensttest und kein Tarifwechsel ausgelöst. Einzelne Vorschaubilder oder eine Nutzerbestätigung werden nicht als vollständige Video-Sicherheitsprüfung umgedeutet.

Die noch offenen Text-Rückfragen, die vollständige Medienprüfung, das sichere Speichern/Veröffentlichen der neuen n8n-Verbindungen und anschließend ein ausdrücklich freigegebener echter Uploadtest sind separate verbleibende Schritte. Meta, geschützte Originalworkflows, Oberfläche, Schrift und Serverumbau bleiben unverändert. Webseite und Domain wurden nicht begonnen.

Primärquellen, am 03.11.2026 geprüft:

- [YouTube: Resumable Uploads](https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol)
- [TikTok: Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post)
- [TikTok: Media Transfer](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide)
- [TikTok: Statusabfrage](https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status)
- [Sightengine: Grenzen des kostenlosen Plans](https://www.sightengine.com/faq/do-you-offer-a-free-trial)
