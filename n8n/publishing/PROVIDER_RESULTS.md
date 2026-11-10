# Dauerhafte Provider-Ergebnisse und sichere Wiederaufnahme

## Quellabgleich nach PR #195 – 10. November 2026

Seit der Cover-Erweiterung vom 06.11.2026 ruft die veröffentlichte Auftrags-API
`RdtCqCWRi7P4W7B0` den separaten **47-Node-Provider-/Coverworkflow**
`JaidX5YeKl6ZTqjQ` auf. Die ältere **29-Node-Providerkopie**
`JPtiMBrudXLxxSrz` bleibt unverändert erhalten, ist aber nicht mehr das dokumentierte
Ziel des API-Nodes `Providerweg im Hintergrund`.

Nach Übernahme der alten PR-#57-Quellen durch PR #195 am 10.11.2026 war der
Repository-Export `publication-order-api-workflow.json` noch auf die ältere
29-Node-Kopie eingestellt. Die Quellangleichung setzt ausschließlich dessen
Subworkflow-ID auf `JaidX5YeKl6ZTqjQ` und sichert den Verweis im Node-Test ab.
Keine vorhandenen HTTP-Nodes, Kanten, Berechtigungen oder Freigaben werden geändert.
Das aktualisierte JSON ist **keine** neue n8n-Bereitstellung und soll nicht
ungeprüft in den veröffentlichten Workflow importiert werden.

Reproduzierbare Quellerzeugung mit aktuellem Cover-Ziel **nur in einer isolierten
Arbeitskopie** (der Generator schreibt API- und Worker-Exporte; beide vor
einem Import gegen den installierten Export vergleichen):

```sh
python3 n8n/publishing/build-publication-orders.py --worker-id zLlhr1I1vKm2AiiU --account-id LR2Qng41OIYuVHAR --comparison-delivery-id ZFO9NSh5nHSn3ues --provider-dispatch-id JaidX5YeKl6ZTqjQ
```

Die nachfolgenden Abschnitte beschreiben weiterhin den historischen
Provider-only-Betriebsstand vom 03.11.2026.

Stand 3. November 2026, Fortsetzung von PR #57. **Datenbankjournal und interne n8n-Anschlüsse sind installiert und veröffentlicht. Automatischer Inhaltsabgleich für YouTube und TikTok live geprüft. Kein Social-Media-Upload, kein Posting und keine Upload-Testfreigabe.**

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

## Veröffentlichter n8n-Anschluss

`provider-dispatch-workflow.json` hat 29 Nodes und ausschließlich einen internen Execute-Workflow-Einstieg. Ein Aufruf bearbeitet maximal eine journalgebundene Provider-Anfrage. Vor Schreibanfragen werden die bestehenden Konto-/Ordnerzuordnungen, aktuellen Drive-Metadaten, vollständigen Bytes mit SHA-256, unveränderten gespeicherten Texte, Medienchecks, Nutzerbestätigungen und der zusätzliche Testschalter geprüft. Das Konto wird über den bestehenden internen Workflow `LR2Qng41OIYuVHAR` geprüft; Zugangsdaten bleiben flüchtig in n8n.

Die Vorlage enthält getrennte HTTP-Nodes für Metadaten, Dateitransfer und Status. Redirects und automatische HTTP-Wiederholungen sind aus. Upload-Session-URLs sind auf dokumentierte HTTPS-Hosts/Pfade begrenzt; unbekannte Hosts werden abgewiesen. TikTok-Upload-URLs erhalten keinen Konto-Bearer. YouTube-Teilübertragung verwendet nur die geprüften restlichen Bytes. `provider-upload-plan.cjs` erhält Titel und Caption unverändert.

Der Dispatcher **`JPtiMBrudXLxxSrz`** ist importiert und veröffentlicht. Die Auftrags-API **`RdtCqCWRi7P4W7B0`** (32 Nodes) ruft ihn nach der bereits gesendeten Dashboard-Antwort ausschließlich für `checked`-Aufträge aus `approve` oder `get` auf. Ein erneutes „Status erneut laden“ nimmt den bestehenden journalgebundenen Vorgang auf. Pro Aufruf bleibt es bei höchstens einer Provideroperation; kein automatischer Dauerlauf und keine neue Veröffentlichung bei unbekanntem Ausgang. `prepared`, `blocked`, `cancelled` und Kontolesen starten keinen Providerweg. Der Dispatcher bekommt ausschließlich die Auftrags-ID.

Beide Folgeaufrufe laufen nach der Antwort mit `waitForSubWorkflow:true`. Der entkoppelte Aufruf lieferte im Live-Test die Vergleichsaufgabe nicht aus; der geprüfte Ersatz hält die interne Ausführung offen, während das Dashboard seine Antwort bereits erhalten hat. API und Dispatcher haben das genehmigte Limit von 600 Sekunden. Keine Speicherung von Ausführungsdaten oder Fortschritt; gleiche Eigentümer, MCP aus. Die HTTP-/Codeparameter, Credential-Referenzen und Kanten der Exporte entsprechen den Vorlagen. n8n lässt bekannte Standardfelder (`source:database`, `mode:once`, `sendBody:false`, Binärfeld `data`) im Export weg.

Die vorhandene Worker-Kopie `zLlhr1I1vKm2AiiU`, Publisher-Kopie und geschützten Originale wurden nicht verändert. Alle 23 bisherigen API-Nodes sind unverändert. Temporäre Diagnoseeingaben wurden entfernt. Die separate Upload-Testfreigabetabelle bleibt leer.

**Abnahmegrenze:** Der neue Inhaltsabgleich ist mit echten Vorbereitungsaufträgen nachgewiesen. Provider-Zustandsübergänge und Wiederaufnahme sind durch synthetische Node-/SQL-Tests abgesichert, aber der tatsächliche HTTP-Uploadweg wurde ausdrücklich noch nicht ausgeführt. Ein Statusabruf kann nach späterer Freigabe eine einzelne nächste Operation anstoßen; es gibt noch keinen unbeaufsichtigten Upload-Dauerlauf. Ein abgeschlossenes internes Providerergebnis ist keine bereits abgenommene öffentliche History-/Erfolgsdarstellung im Dashboard.

## Validierung

- 314 Node-Tests bestanden, einschließlich Workflow-Kanten, fehlender Freigaben, Session-URL-Grenzen, exakter Texte, Binärrest und Int64-IDs.
- Vergleichs-/Auftrags-/Creator-/Provider-SQL lokal mit PGlite 0.5.14/PostgreSQL 18 bestanden.
- Vergleich mit Delivery-Queue und Provider-Journal zusätzlich auf der produktiven PostgreSQL-17-Instanz geprüft: ausschließlich synthetische Fixtures, vollständig zurückgerollt. Medien-Stubs im isolierten Provider-Zustandsautomatentest existieren nur innerhalb der Testtransaktion; die Originalfunktions-Hashes sind danach unverändert.
- Live-Anschluss: YouTube per erneutem Abruf und TikTok direkt bei Vorbereitung automatisch abgeglichen, vorhandener Cache unverändert. Zwei Testaufträge anschließend storniert. 0 freigegebene Aufträge, Veröffentlichungsreservierungen, Provider-Testfreigaben, Provider-Versuche und Providerereignisse. Zwei abgeschlossene Vergleichs-Queueeinträge bleiben als Nachweis erhalten.
- Keine neue Sicherheitsberater-Warnung. Vier erwartete INFO-Hinweise für private Servicetabellen mit RLS und ohne Kundenpolicies; Kundenrollen haben keine direkten Rechte. [Hinweisbeschreibung](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

```sh
python3 n8n/publishing/build-provider-dispatch.py
node --test tests/*.test.cjs
node tests/run-publication-delivery-sql.mjs
```

## Medienblocker und verbleibende Abnahme

Sightengine wird weiterhin mit `VIDEO_PLAN_REQUIRED` abgewiesen. Der lokale Adapter hält Videomoderation bewusst gesperrt, nachdem der vorherige echte Diensttest fehlenden Planzugriff gemeldet hatte. Die aktuelle offizielle FAQ bestätigt: Videomoderation gehört nicht zum kostenlosen Plan. In dieser Sitzung wurde kein neuer kostenpflichtiger Diensttest und kein Tarifwechsel ausgelöst. Einzelne Vorschaubilder oder eine Nutzerbestätigung werden nicht als vollständige Video-Sicherheitsprüfung umgedeutet.

Die noch offenen Text-Rückfragen, die vollständige Medienprüfung, ein ausdrücklich freigegebener echter Uploadtest und danach die fachliche Abnahme der tatsächlichen Providerantworten sind separate verbleibende Schritte. Meta, geschützte Originalworkflows, Oberfläche, Schrift und Serverumbau bleiben unverändert. Webseite und Domain wurden nicht begonnen.

Primärquellen, am 03.11.2026 geprüft:

- [YouTube: Resumable Uploads](https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol)
- [TikTok: Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post)
- [TikTok: Media Transfer](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide)
- [TikTok: Statusabfrage](https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status)
- [Sightengine: Grenzen des kostenlosen Plans](https://www.sightengine.com/faq/do-you-offer-a-free-trial)
