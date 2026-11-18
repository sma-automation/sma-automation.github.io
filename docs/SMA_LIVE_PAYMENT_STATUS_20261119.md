# SMA – Zahlungs- und Startübergabe (19.11.2026)

**Ziel:** technische Kernfertigstellung möglichst 25.–26.11.2026; erster autorisierter Kundenstart am 01.12.2026. GitHub-Regressionen sind **keine** reale Kunden-E2E-Abnahme.

## Bestätigter technischer Stand

- Produktrepository: `sma-automation/sma-automation.github.io`, Branch `website-v1`.
- **PR #409** „Fail closed on unpaid pending renewals after Mollie subscription stops“ zusammengeführt; Produkt-Merge-Commit **`fa54cebd7d518ac93a1a3fb90f39fb84671f2b98`**.
- Alle drei vorgeschalteten PR-Prüfungen erfolgreich, einschließlich Dashboard, Veröffentlichung und Musik-Concurrency. Ein erstes fehlgeschlagenes Testszenario wurde vor dem Merge durch Korrektur des erwarteten Kalenderdatums berichtigt.
- Das bestehende Supabase-Projekt `bnvnmdxosbnuzedokqgh` stellt **`sma-package-payment` Version 11, ACTIVE** bereit. Die drei Dateien `index.ts`, `handler.mjs` und `renewal.mjs` wurden direkt aus der aktiven Edge Function zurückgelesen und sind **bytegenau** mit `website-v1` identisch. `verify_jwt=false` blieb unverändert; der Einstieg prüft weiterhin die für ihn vorgesehenen Authentifizierungs-/Rückrufbeweise.
- Sicherheitskorrektur in Version 11: Wenn die Mollie-Subscription `canceled`, `suspended` oder `completed` ist, reicht eine bloß `open`/`pending`/`authorized` Folgezahlung nicht mehr aus, um einen **nicht gedeckten** aktiven Kundenstatus unbegrenzt zu erhalten. Vorher bestätigte, unerstattete bezahlte Zeiträume werden weiter berücksichtigt. Es wurden **keine** echten Zahlungen, n8n-Ausführungen oder Kundenmutationen zum Test ausgelöst.
- Produktiver SQL-Leseabgleich vor Deployment: **0 Paketbuchungen**, **0 zahlende Website-Konten**. Weiterhin **4 Website-Konten**, davon **3 Demo-Konten**, **0 neue Onboarding-Profile**, **1 berechtigtes Konto ohne n8n-Referenz** (möglicherweise Legacy). Der separate automatische Erstbuchungsschalter stand auf **EIN**; er wurde nicht verändert. Die fünf `sma_package_*`-RPCs dürfen per SQL-Privilegien nur `service_role` ausführen, weder `anon` noch `authenticated`.
  
## Offene kritische n8n-Zahlungsabnahme

Die n8n Public API wurde **nur** über die bestehende geschützte, manuell gestartete GitHub-Actions-GET-only-Aktion gelesen, zuletzt am 18.11.2026 in Run **#7 / 44417364826**. Kein weiterer n8n-Lauf wurde ausgelöst.

- Veröffentlichter Workflow `8v2wcz5lh0yUf3sw`: **391 Nodes**, **410 MAIN-Verbindungen**, beide Webhook-Eingänge eindeutig.
- Erstzahlung: **17** erreichbare Nodes; Folgezahlung: **9**. Zusammen sind alle 26 Nodes dem öffentlichen Zahlungstemplate **topologisch** zuordenbar; dies ist **keine semantische oder operative Freigabe**.
- Ergebnis des zuletzt geprüften Aktivgraphen: **`PAYMENT_NODE_LOGIC_MISMATCH`**, nicht bestanden.
- Sichere feste Diagnosen aus Run #7: **`N06_CODE`**, **`N14_FILTERS`**, **`N15_FILTERS`**, **`N17_FILTERS`**, **`N23_FILTERS`**, **`N24_CODE`**. N11/N13/N22 HTTP-Methoden-Unterschiede verschwanden nach Behandlung der dokumentierten GET-Standardeinstellung.
- Die vier Data-Table-Filter meldeten unter anderem `INVALID_FILTER_FORMAT` und den fehlenden erwarteten `ROW_ID`-Marker. Das ist **kein Beweis**, dass die veröffentlichten Filter tatsächlich keine alternative gesicherte Zeilenidentität verwenden; die konkreten veröffentlichten Parametereinstellungen wurden **nicht** offengelegt oder semantisch abgenommen. Ebenso sind die tatsächlichen Code-Änderungen N06/N24 nicht geprüft.
- Keine pauschalen Filteränderungen, Node-Umbenennungen oder sofortige Live-Publikation vor Beleg der wirksamen Kunden- und Ordnerbindung. Der n8n-Live-Graph wurde **nicht** verändert.

## Startblocker / Abnahmegrenze

1. Den **tatsächlich veröffentlichten** n8n-Zahlungscode und die vier Kunden-Data-Table-Filter privat semantisch prüfen und absichern; ohne bestätigte Änderung keinen Live-Payment-Start.
2. Google Drive `account 3` ist mit n8n verbunden, aber dessen **tatsächliche Google-Dienstidentität** und Lese-/Schreibrechte für **`01 Upload – Eingang`** und **`02 Verarbeitung`** wurden noch nicht nachgewiesen. Eine andere Google-Drive-Connector-Identität ersetzt diese Prüfung nicht.
3. Eindeutig zugeordnetes, berechtigtes Kunden-Testkonto; **ein kompletter autorisierter E2E** vom Upload bis zum korrekten Dashboard-/Freigabeergebnis, mit getrennten Berechtigungen für eine eventuelle Social-Veröffentlichung.
4. n8n-Cloud **tatsächlich abgerechnete** Executions je vollständiger Datei und Basislast messen; gespeicherte Ausführungen und theoretische Node-Zahlen sind kein Billing-Beleg.
5. Kundenmusik-E2E erst nach freigegebenem Master **und passender AAC**; private Testtöne nicht als Kundenmusik veröffentlichen.
6. Für reale Erstbuchungen bleibt der Nachweis der n8n- und Google-Drive-Rechte **vor** dem ersten Checkout zwingend. Kein reales Mollie-Checkout oder Kundenstart auf Basis eines rein grünen GitHub-/Supabase-Codechecks.

## Bedienzugänge und unveränderte Verbote

- **Direkt nutzbar:** GitHub- und Supabase-Verbindung.
- **Nicht direkt nutzbar:** die grafische Oberfläche der bereits geöffneten n8n-Browser-Tabs. TinyFish-Browserautomatisierung ist ohne Guthaben nicht verfügbar; keine Aufladung vornehmen. Bestehende GitHub-Actions-Leseprüfung nur **manuell** und nur mit Sicherheitszweck nutzen, nicht repetitiv ohne geänderte Erkenntnis.
- **Keine** echten Zahlungen, n8n-Executions, Social-Media-Posts, Kundenaktivierungen, Käufe, neuen Tarife oder Produktivfreigaben ohne ausdrückliche Freigabe.
- Freigegebene Github/Supabase-Code- und Testarbeiten dürfen autonom und kostenschonend fortgeführt werden. Bei neuer Sitzung diese Datei, den letzten `website-v1`-Commit und die aktive Edge-Version zuerst überprüfen.

**Fazit:** Der isolierte Abo-Folgezahlungs-Fehler wurde in GitHub korrigiert und live als Supabase-Version 11 implementiert. **Der n8n-Zahlungsweg und der erste echte Kunden-E2E bleiben Startblocker.**
