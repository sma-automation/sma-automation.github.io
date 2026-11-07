# Dashboard-Auftrag und gebundene Freigabe

## Aktueller Anschlussstand – 6. November 2026

Die folgenden Abschnitte dokumentieren die historischen Schritte vom
3. November. Ihre damaligen offenen Punkte sind durch spätere Arbeiten teilweise
erledigt: Interner Inhaltsabgleich, Providerjournal und Dispatcher sind laut
dem weiterhin separat offenen [PR #57](https://github.com/sma-automation/sma-automation.github.io/pull/57)
technisch angeschlossen. Coverübergabe und History-Anzeige sind in
[PORTAL_COVER_HANDOFF.md](../../docs/PORTAL_COVER_HANDOFF.md) und
[PUBLICATION_COVER_HISTORY.md](../../docs/PUBLICATION_COVER_HISTORY.md) dokumentiert.

Die konkreten YouTube-/TikTok-Textfragen sind nach gespeicherten Korrekturen
und erneutem echtem Vergleich abgeschlossen: beide aktuellen Bindungen
`consistent_with_evidence`, ohne Rückfragen. Hashtags sind über den normalen
Editor bearbeitbar. Bereitstellung und Nachweis:
[PORTAL_TEXT_CORRECTIONS.md](../../docs/PORTAL_TEXT_CORRECTIONS.md).

**Persönlicher Prüfweg:** [MANUAL_MEDIA_REVIEW.md](../../docs/MANUAL_MEDIA_REVIEW.md)
ergänzt eine ausdrücklich gewählte, auftragsgebundene Kundenselbstauskunft für
die fehlende vollständige visuelle/semantische Prüfung. Technische Nachweise,
Portaltextvergleich und gesonderte Veröffentlichungsfreigabe bleiben nötig.
Keine echte persönliche Bestätigung wurde durch die Umsetzung abgegeben.
**Fortsetzung am 07.11.2026:** Die Assistenzsichtung des 10-s-Originals ist
abgeschlossen. Der vorhandene 3-s-Coverexport wurde separat lokal dekodiert und
gesichtet. Eigene Portaltexte und technische FFmpeg-Nachweise sind für beide
Portale gespeichert. Der separate Portaltextvergleich ist offen.
Konkreter Testtext, Dateibindung, Prüfgrenzen und Reihenfolge:
[PROVIDER_COVER_ACCEPTANCE.md](../../docs/PROVIDER_COVER_ACCEPTANCE.md).
Persönliche Kundenerklärung, ausdrückliche Auftragsfreigabe und gesonderte
Provider-/Covergenehmigung fehlen weiterhin. Die automatische Sightengine-
Videoprüfung (`VIDEO_PLAN_REQUIRED`) bleibt unverfügbar; die Assistenzsichtung
und der persönliche Nachweis sind keine automatischen Vollprüfungen.
Der konkrete [Videoprüfschritt](../../docs/VIDEO_REVIEW_NEXT_STEP.md) wurde
am 06.11.2026 wegen der Vorgabe ohne zusätzliche Kosten zurückgestellt.
Sightengine bleibt kostenlos; keine ausstehende Buchungsentscheidung und kein
bezahlter Ersatzdienst. Technischer Anschluss, drei bestehende Sperren,
späterer Abnahmeablauf und die getrennte semantische Prüfung sind dort festgehalten.
Alle 9 Aufträge unverändert; 0 Operatorfreigaben, Provider- und Coverversuche.
Bestandsprüfung abgeschlossen. PR #57/#69 separat offen, unveröffentlichte
n8n-Originalentwürfe und Shopify-Testmodus erhalten; keine kostenpflichtigen
Änderungen freigegeben.

## Historischer Ausgangsstand – 3. November 2026

Fortsetzung: [Zielkonto und Portalberechtigungen](ACCOUNT_VERIFICATION.md) – Kontoprüfungen und Anschlusskorrektur sind live abgeschlossen. Die getrennten Medienbestätigungen aus #53 sind veröffentlicht und im echten TikTok-Vorbereitungsdialog geprüft.

Stand: 3. November 2026. Diese Erweiterung verbindet den angemeldeten Dashboard-Benutzer, seine konkrete Datei-/Textversion, das tatsächliche n8n-Zielkonto und seine ausdrückliche Freigabe mit der vorhandenen Publisher-Arbeitskopie. Der Ausführungsweg endet weiterhin bei einer protokollierten Prüfung: **kein Provider-Upload und kein Social-Media-Posting**.

## Komponenten

| Aufgabe | Datei / n8n-ID |
| --- | --- |
| Dashboard-Dialog und wiederholbare API-Anfragen | `app/assets/publication-order.mjs` |
| Authentifizierter Eingang | `RdtCqCWRi7P4W7B0` · `publication-order-api-workflow.json` |
| Interne Ausführungsprüfung | `zLlhr1I1vKm2AiiU` · `publication-order-execution-workflow.json` |
| Bestehende Publisher-Arbeitskopie | `JZwPbzCpgIByxk94` |
| Bestehende gespeicherte Textübergabe | `LxayneKkUusok0Q8` |
| Aufträge, Bestätigungen, Reservierung und Leasing | `supabase/sql/publication-orders.sql` |

POST `/webhook/sma-publication-order-v1` akzeptiert `{action,input}` mit `prepare`, `approve` oder `get`. Der Kunden-JWT wird bei jedem Aufruf von Supabase geprüft. Der Client sendet weder Kunden-ID, Drive-ID noch Konto-ID. Die serviceberechtigte n8n-Abfrage ist erst nach der Eigentümerprüfung erreichbar. Antworten enthalten keine Provider-Zugangsdaten oder interne Kundenbindung.

Die geschützten Originale `GHBsYQcyt0JLFvRP`, `LeeH7IigyGRRUuxS` und `qwdTLh2rVmMkwhxb` werden nicht geändert. Alle 160 alten Knoten in der Publisher-Kopie bleiben deaktiviert. Der neue interne Pfad erreicht nur die fünf bereits geprüften Vorbereitungsknoten.

## Ablauf

1. In der bestehenden Beitragsvorschau öffnet „Freigabe vorbereiten“ einen zusätzlichen Dialog. Galerie, Navigation, Schrift und die bisherigen Optimierungsfunktionen bleiben erhalten. Ungespeicherte Änderungen verhindern einen Auftrag.
2. Der Kunde wählt Sichtbarkeit und die erforderlichen kanalbezogenen Kennzeichnungen ausdrücklich. Es gibt keine vorausgewählte Veröffentlichungseinstellung.
3. `prepare` speichert die exakte Datei-, Zuordnungs- und Textversion samt Shop-Link. n8n liest das Zielkonto ausschließlich aus der eindeutig zugeordneten aktiven Kundenzeile. Name und ID werden vor der Bestätigung angezeigt, ebenso der gespeicherte Beitrag und die ausgewählten Einstellungen.
4. `approve` benötigt ein nicht vorausgewähltes Bestätigungsfeld und den auftragsspezifischen Freigabetoken. Eigentümer, aktiver Zugang, Dateikatalog und unveränderte Zuordnung werden erneut geprüft. Die Vorbereitung läuft nach 30 Minuten ab.
5. Eine Datenbanktransaktion reserviert `(Kunde, Datei, Dateiversion, Portal, Zielkonto)`. Eine andere Anfrage-ID oder ein veränderter Text umgeht diese Reservierung nicht. Ein verlorener API-Response erzeugt keinen zweiten freigegebenen Auftrag.
6. Der interne Worker übernimmt nur eine Auftrags-ID und erhält eine exklusive Lease. Er prüft Kontoidentität und Kundenordner erneut, liest die aktuelle Drive-Version samt Prüfsumme und ruft dann die vorhandene Portaltext-Arbeitskopie mit der serverseitig gespeicherten Bindung auf.
7. `finish_check` akzeptiert nur die aktuelle Lease, prüft die gespeicherte Bindung erneut und erhält alle offenen Medienprüfungen. Fehlende Kontoberechtigungsprüfung bleibt ausdrücklich ein Blocker. `can_upload` und `can_publish` bleiben immer `false`.

Die Auftragsreservierung wird bei Fehlern oder Zeitüberschreitungen nicht freigegeben. Eine abgelaufene Lease darf nur die idempotente Leseprüfung erneut starten. Eine Provider-Übertragung ist damit noch nicht implementiert. Es gibt bewusst keinen automatischen Neuversuch für einen Provider-Upload.

## Betrieb

Die additive Migration `publication_orders_bound_approval_v1` ist in SMA-Supabase angewendet. Beide privaten Tabellen haben RLS und keine direkten Rechte für `anon` oder `authenticated`. Der Kunden-RPC erzwingt `auth.uid()`. Der Worker-RPC ist ausschließlich für `service_role` ausführbar.

Die n8n-Version verlangt veröffentlichte Unterworkflows beim Veröffentlichen eines Elternworkflows. Die reine Übergabeprüfung und die bisher unveröffentlichte Publisher-Arbeitskopie wurden deshalb als interne Abhängigkeiten veröffentlicht. Dies aktiviert keine deaktivierten Provider-Knoten und erzeugt keinen zusätzlichen öffentlichen Trigger.

Die neuen Workflows haben 15 bzw. 14 Knoten, leere `pinData`, keine Speicherung erfolgreicher, fehlgeschlagener oder manueller Nutzdaten und 150 Sekunden Laufzeitlimit. Ausführungsfortschritte werden nicht gespeichert; Unterworkflow-Aufrufe sind auf denselben Eigentümer beschränkt; MCP ist deaktiviert. Nach n8n-UI-Import die Einstellungen ausdrücklich setzen: der Import übernimmt sie nicht zuverlässig. Im Abschlussexport entfernt n8n die Standardwerte `source:database`, `mode:once` und gegebenenfalls `saveExecutionProgress:false`.

```sh
python n8n/publishing/build-publication-orders.py --worker-id zLlhr1I1vKm2AiiU
node --test tests/*.test.cjs
```

Die beiden JSON-Dateien enthalten nur Workflowcode, öffentliche Projektangaben und vorhandene Credential-Referenzen. Private Gesamtexporte werden nicht ins öffentliche Repository übernommen.

## Validierung und Grenzen

262 Node-Tests bestehen. Die neuen Fälle prüfen unter anderem Authentifizierung, alle vier Zielkontotypen, fremde/mehrdeutige Konten, geänderte Drive-Dateien, exakte gespeicherte Texte, ausschließlich lesende Workflowkanten, verlorene Antworten, doppelte Anfragen, ausdrückliche Zustimmung sowie ungespeicherte Änderungen und Abmeldung im Dashboard.

`tests/publication-orders.sql` wurde gegen die echte Datenbank innerhalb von `BEGIN`/`ROLLBACK` ausgeführt. Synthetische Testdaten wurden nicht behalten. Geprüft wurden Eigentümerisolation, fehlende Bestätigung, zweite Anfrage-ID für denselben Veröffentlichungsschlüssel, Lease-Wiederholungen, unveränderte Text-/Dateiversionen, nicht löschbare Medienblocker und Rollenrechte. Auch die komplette Migration wurde zuerst zusammen mit diesen Tests zurückgerollt und anschließend sauber angewendet.

Der Live-Test im angemeldeten Dashboard hat den vorhandenen YouTube-Entwurf samt realem Zielkonto erfolgreich als `prepared` gebunden. `approved_at` blieb leer. Ein direkter Übernahmeversuch dieses noch nicht freigegebenen Auftrags wurde mit `FINAL_APPROVAL_REQUIRED` abgewiesen. Es wurde keine Zustimmung im Namen des Kunden erteilt. Der vollständige Workerweg nach einer echten Kundenfreigabe wurde in diesem Schritt nicht live ausgeführt; seine einzelnen Regeln und Fehlerpfade sind durch die Node-/SQL-Tests abgedeckt. Anonyme Anfragen an den aktiven Webhook liefern eine gesperrte, bereinigte Fehlerantwort.

Weiterhin erforderlich vor einem tatsächlichen Posting: vollständige Byte-/Medien-/Inhaltsprüfung, aktuelle Providerberechtigungen und kontospezifische Vorgaben (einschließlich TikTok-Creator-Optionen), sowie ein einzelner kontrollierter Upload-Dispatcher mit Provider-Belegen und Behandlung unklarer Übertragungsergebnisse. Das vorhandene Journal reserviert Aufträge, es ist noch kein vollständiges Provider-Ergebnisjournal. Die alten Publisher-Knoten dürfen deshalb nicht pauschal eingeschaltet werden. Serverumbau bleibt außerhalb dieses Schritts.


## Medienbestätigungen und TikTok-Hinweise – 3. November 2026

Die allgemeine Zustimmungsbox allein genügt für neue Freigaben nicht mehr. Der bestehende Dialog verlangt zusätzlich drei nicht vorausgewählte Bestätigungen: vollständige Datei samt Ton/Einblendungen und gespeichertem Beitrag geprüft, erforderliche Medien-/Personenrechte vorhanden sowie Musik-/Tonrechte vorhanden oder entsprechende Inhalte nicht enthalten. Das sind **Erklärungen des Benutzers**, keine automatische Sicherheits- oder Rechteprüfung.

Für TikTok kommt immer die verlinkte Music Usage Confirmation hinzu. Bei Werbung für Dritte muss zusätzlich die Branded Content Policy ausdrücklich bestätigt werden. Die Werbungsauswahl startet ausgeschaltet; nach Aktivierung sind eigene Marke, Dritte oder beide möglich. Die daraus folgende Kennzeichnung wird angezeigt. Werbung für Dritte und „Nur ich“ werden wechselseitig gesperrt. Kommentare, Duett und Stitch starten als nicht angekreuzte „erlauben“-Checkboxen; vom Konto deaktivierte Funktionen bleiben gesperrt. Die API erhält weiterhin die bisherigen booleschen `disable_*`- und `brand_*`-Felder.

`approve.input.review` enthält ausschließlich `policy_version: media-consent-2026-11-03.1` und fünf streng typisierte Bestätigungen. Die Datenbank prüft das vollständige geschlossene Schema gegen das gespeicherte Portal und die Werbeauswahl. Fehlende, falsche, fremde oder alte Bestätigungen liefern `FINAL_APPROVAL_REQUIRED`, einen bereits vom veröffentlichten n8n-API-Workflow erlaubten Fehlercode. Erneute identische Anfragen bleiben idempotent. Frühere Freigaben ohne diese Bestätigungen werden weder ergänzt noch als neue Bestätigung behandelt; der Worker übernimmt sie nicht.

`approval_review` wird atomar mit `approved_at` gespeichert. Benutzer, Datei-/Textrevision, Zielkonto und Portaloptionen sind bereits unveränderliche Bestandteile derselben Auftragszeile. Der Browser kann weder Eigentümer noch Zeitstempel vorgeben. Die Kundenrollen erhalten keine direkten Tabellenrechte; die neue private Validierungsfunktion ist nicht direkt durch Kunden aufrufbar.

Die Auftragsantwort enthält jetzt die aktuelle gebundene Medienprüfung. Der Dialog zeigt offene automatische Prüfungen bereits vor der finalen Zustimmung. Bei geändertem oder nicht mehr verfügbarem Dateistand zeigt er den konkreten Fehler und sperrt den Knopf. Jede neue Antwort bzw. jedes Wiederöffnen setzt die Bestätigungen zurück.

**Unverändert offen:** Sightengine-Videozugriff (`VIDEO_PLAN_REQUIRED`), automatischer vollständiger Inhalts-/Portaltextnachweis, Meta-Berechtigungen, abschließende Portalprofile sowie Upload-Dispatcher und Provider-Ergebnisjournal. Keine Bestätigung entfernt einen dieser automatischen Blocker; `can_upload` und `can_publish` bleiben false. Es wird kein kostenpflichtiger Plan aktiviert. Kein n8n-Workflowcode, keine Credential-Referenz, kein geschütztes Original und kein gespeicherter Kundenbeitrag wird geändert.

Validierung: 286 Node-Tests bestanden. Die SQL-Prüfreihen verwenden jetzt zusätzlich die vollständigen aktuellen Inhalts-/Video-/Medienprofile. Beide lokalen SQL-Reihen bestanden unter PGlite 0.5.14 / PostgreSQL 18.6 mit Rollback. Neue Fälle prüfen fehlende/falsche/alte Erklärungen, Musik-/Werbevarianten, unveränderte Medienblocker, identische Wiederholung, alte Freigaben, Kontosperren, Terminalzustände und Rollenrechte. Oberfläche: ausschließlich die benötigten Felder innerhalb des bestehenden Dialogs; dessen CSS sowie die freigegebene Schrift- und Layoutdatei bleiben bytegleich. Cacheversionen: Dashboard v28, Vorschau-JS v27, Auftragsmodul v5.

Quelle für die TikTok-Oberfläche, am 03.11.2026 geprüft: https://developers.tiktok.com/docs/en/content-sharing-guidelines. Die dort verlinkten Bedingungen werden als offizielle Ziele angeboten; ihr Inhalt wird nicht als juristisch geprüft behauptet.

Migration `publication_order_media_confirmations_20261103` ist angewendet. Beide SQL-Prüfreihen bestanden anschließend auch auf der produktiven PostgreSQL-17-Instanz mit ausschließlich synthetischen, zurückgerollten Datensätzen. Vor der Änderung stimmten alle fünf vorhandenen Auftragsfunktionen im Quelltext-Hash mit dem Repository überein. Der Sicherheitsberater meldet keine neue Warnung für diese Änderung; bestehende Hinweise bleiben separat offen.

## Live-Abnahme der Medienbestätigungen – 3. November 2026

PR #53 ist zusammengeführt; GitHub-Pages-Lauf `41677922971` war erfolgreich. Im angemeldeten Dashboard wurde mit dem bestehenden TikTok-Video ein separater Testauftrag bis `prepared` durchlaufen. Zielkonto, gespeicherter Beitrag, Sichtbarkeit „Nur ich“, deaktivierte Interaktionen und ausgeschaltete Werbung wurden korrekt angezeigt. Die drei Medienbestätigungen, die verlinkte TikTok-Musikbestätigung und die finale Zustimmung waren leer; „Veröffentlichung freigeben“ blieb deaktiviert. Die Ansicht wurde auch visuell geprüft. Es wurden keine Erklärungen oder Bedingungen im Namen des Nutzers bestätigt.

Nach der Prüfung wurde ausschließlich dieser Testauftrag unter Prüfung von Eigentümer, `state=prepared`, fehlender Zustimmung, fehlender Lease und fehlendem Journaleintrag auf `cancelled` gesetzt. `approved_at` und `approval_review` blieben null. Keine finale Freigabe, kein Provider-Upload und kein Posting wurden ausgelöst. Der Branded-Content-Bestätigungszweig ist durch die automatischen Tests abgedeckt; dieser echte Vorbereitungsauftrag verwendete keine Werbung.

### Dateiabgleich: erfolgreiche Wiederholungsprüfung, Ursache noch offen

Die erste Live-Abnahme war bei der Aktualisierung des Dateikatalogs zweimal fehlgeschlagen. Nach ausdrücklicher Freigabe des Nutzers wurde eine isolierte, unveröffentlichte n8n-Diagnose einmal ausgeführt. Sie las ausschließlich die vorhandene Kunden-/Ordnerzuordnung, die Zugriffsmetadaten beider Drive-Ordner und die Dateimetadaten. Ergebnis: `ok:true`, zwei Dateien; keine Datei wurde verändert. Ausführungsdaten wurden nicht gespeichert, die flüchtige Ergebnisanzeige anschließend geleert. Die Diagnose besitzt keinen Upload-, Publish- oder Datenbank-Schreibknoten.

Der Export des aktiven Katalogworkflows `Tta5irg2Z3DiCGy4` stimmte bei allen 18 Knotenparametern, Credential-Referenzen, Fehlerpfaden und Verbindungen mit der Repository-Vorlage überein. Der ursprüngliche Workflow blieb unverändert. Die bisherigen Datenbankaufrufe hatten HTTP 200 geliefert; das allein ist kein Nachweis eines erfolgreichen fachlichen Abgleichs.

Der erneute echte Klick auf „Dateien aktualisieren“ war erfolgreich. Die Datenbank bestätigte Abschluss am **03.11.2026 um 18:26:52 MEZ**, zwei verfügbare Dateien und keine offene Lease. Danach gelang die oben beschriebene Auftragsvorbereitung. Eine konkrete Ursache der früheren Fehlschläge ist damit **nicht nachgewiesen**; es wurde keine vermeintliche Fehlerkorrektur oder Tarifänderung vorgenommen.

### Verbleibende Grenzen

- Sightengine meldet für die visuelle Videoprüfung weiterhin `VIDEO_PLAN_REQUIRED`.
- Bei dieser Abnahme blieb der allgemeine Medienhinweis `TIKTOK_CREATOR_LIMIT` trotz separatem Kontonachweis offen. Die anschließende Korrektur und ihre Grenzen sind im folgenden Abschnitt dokumentiert.
- Vollständiger Inhalts-/Portaltextnachweis, übrige Portalprofile, Meta-Berechtigungen sowie Upload-Dispatcher und Provider-Ergebnisjournal bleiben offen.

Die Abnahme bestätigt die Vorbereitung und die gesperrte Zustimmung. Sie ist keine Abnahme einer tatsächlichen Veröffentlichung. Für diesen Dokumentationsnachtrag wurde kein Anwendungscode geändert; die 286 bestandenen Node-Tests und beide SQL-Prüfreihen aus #53 bleiben der geprüfte Implementierungsstand.

## Kontogebundener TikTok-Mediencheck – 3. November 2026

`sma_private.publication_order_media_v1` verbindet jetzt ausschließlich im konkreten Auftrag den vorhandenen Mediencheck `TIKTOK_CREATOR_LIMIT` mit dem aktuellen Kontonachweis. Ziel-ID und Quellrevision, Berechtigungen, Sichtbarkeit, kontoseitig gesperrte Interaktionen und Werbeauswahl müssen die bestehende Kontovalidierung bestehen. Die gemeldete positive Videolänge darf die vom Creator-Endpunkt gelieferte Höchstdauer nicht überschreiten. Die separate technische Byteprüfung bleibt erforderlich.

Fehlende, abgelaufene oder fremde Nachweise sowie unzulässige Optionen lassen den Check auf `pending`. Eine bekannte zu lange Dauer ergibt `fail`; exakt die erlaubte Höchstdauer ist zulässig. Fehlende oder ungültige Dauer wird nicht als bestanden behandelt. Die allgemeine Datei-/Portalprüfung bleibt ohne konkreten Auftrag weiterhin offen. Kein anderer Mediencheck, keine Empfehlung und kein Dateifakt wird entfernt oder umgedeutet.

Die Auftragsansicht wertet den gespeicherten Nachweis bei jedem Abruf erneut aus. `finish_check` verwendet ausschließlich den neuen Kontonachweis der aktuellen Ausführung. Ein früher bestandener Vorbereitungsnachweis ersetzt keinen fehlenden Worker-Nachweis. Das Worker-Ergebnis speichert nur gültige Nachweise zum unveränderten Zielkonto; bei fehlgeschlagener Prüfung wird der vorherige Nachweis nicht weiter als aktuelles Ergebnis angezeigt. Zusätzliche Worker-Blocker, Inhalts-/Rechteprüfungen, exklusive Lease und Doppelveröffentlichungsschutz bleiben wirksam. `can_upload` und `can_publish` bleiben false.

Migration `publication_order_tiktok_creator_evidence_20261103` ist angewendet. Vorher wurden die Quelltext-Hashes der bestehenden Auftragsansicht, Workerfunktion und Kontovalidierung mit dem Repository abgeglichen. Geändert wurden nur die neue private Hilfsfunktion sowie die Auftragsansicht und Workerfunktion. Keine neue öffentliche API, keine zusätzlichen Kundenrollenrechte, keine Änderungen an n8n, Credential-Referenzen, UI-Dateien, Schrift oder Layout.

Validierung: 286 Node-Tests bestanden. Alle drei SQL-Prüfreihen (`publication-accounts`, `publication-orders`, `publication-order-creator`) bestanden lokal unter PGlite/PostgreSQL 18 sowie als zurückgerollte Kandidatenprüfung auf der produktiven PostgreSQL-17-Instanz. Die neue Creator-Prüfreihe bestand nach der Migration nochmals gegen die installierten Funktionen. Alle Fixtures sind synthetisch und vollständig zurückgerollt. Die neuen Fälle decken Ablauf/Fremdziel/Optionen, exakte Dauergrenze, fehlende Dauer, unveränderte übrige Medienchecks, frische Worker-Nachweise, fehlende Nachweise trotz früherem Erfolg, unzulässige Worker-Ziele, Lease-Replay und Rollenrechte ab. Keine neue Sicherheitsberater-Warnung.

Live-Abnahme am 03.11.2026 um **18:43 MEZ**: Im angemeldeten TikTok-Dialog wurde ein neuer, nicht freigegebener Testauftrag bis `prepared` angelegt. Frischer Kontonachweis mit 3600 Sekunden Höchstdauer; `TIKTOK_CREATOR_LIMIT=pass`. Der bisherige falsche Kontohinweis erschien nicht mehr unter „Offene Medienprüfungen“; visuelle Sicherheitsprüfung und semantischer Inhalts-/Portaltextabgleich blieben sichtbar. Alle Bestätigungen blieben leer, die finale Freigabe war deaktiviert. Danach wurde ausschließlich dieser Testauftrag unter Eigentümer-/Status-/Lease-/Journalprüfung storniert. Keine echte Zustimmung, kein Provider-Upload, kein Posting und keine Tarifänderung. Der Worker-Abschluss wurde mit synthetischen SQL-Fällen geprüft, nicht durch eine echte Kundenfreigabe ausgelöst.

Weiter offen: Sightengine `VIDEO_PLAN_REQUIRED`, vollständiger Inhalts-/Portaltextnachweis, weitere Portalprofile und Meta-Berechtigungen sowie Upload-Dispatcher und Provider-Ergebnisjournal.

Anschließend wurde der [gemeinsame Dateiabruf für YouTube und TikTok](DUAL_CHANNEL_REHEARSAL.md) mit echten Drive-Bytes und den beiden gespeicherten Kanaltexten erfolgreich geprüft. Der separate Lesetest erstellt keine Freigabe und führt keinen Provider-Upload aus.

Primärquelle, am 03.11.2026 geprüft: https://developers.tiktok.com/docs/en/content-posting-api-reference-query-creator-info.
