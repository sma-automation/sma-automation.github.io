# SMA – Tatsächlich veröffentlichte n8n-Zahlungsstrecke vor dem ersten Kunden prüfen

Stand: 18.11.2026. **Offline-Bestandsprüfung, keine Inbetriebnahme.**

## Warum dieser Vergleich benötigt wird

Das GitHub-Werkzeug `n8n/package-payment/build-worker.cjs` erzeugt
den erwarteten Zahlungsdienst. Die auf Supabase produktiv installierte
Edge Function `sma-package-payment` wurde am 18.11.2026 als Version 7
gelesen: Die drei installierten Programmdateien stimmen **bytegenau**
mit `website-v1` überein. Das beweist aber nicht, dass der separat bei
n8n **veröffentlichte** Zahlungsworkflow die passenden Knoten hat.

Gerade bei einem neuen Kunden muss der n8n-Weg folgende Kette erhalten:

`sma-paket-dienst-v1` → validiertes einmaliges Ticket → feste Operation
`activate` → **Ordnerzuordnung vor Aktivierung prüfen** → bedingt gesicherte
`SMA_Kunden`-Änderung → begrenzte Antwort an die private Zahlungsfunktion.

Die notwendige `account`-Antwort muss die **beiden verschiedenen**
`upload_folder_id`- und `processing_folder_id`-Werte aus exakt
der zugeordneten Kundenzeile enthalten. Ein vorhandener String ist
noch kein Google-Drive-Berechtigungsnachweis.

Die produktiv gespeicherte n8n-Aktivversion ist **noch nicht separat
gelesen oder verglichen**. Ein im Repository gebauter Kandidat,
ein grüner GitHub-Test oder ein erfolgreicher Webhook-HTTP-Status
schließen diese Lücke nicht.

## Neuer fail-closed Offline-Prüfer

```sh
node n8n/package-payment/audit-published-worker.cjs /private/AKTIVE_N8N_VERSION.json
node --test tests/published-package-worker-audit.test.cjs
```

Die Eingabe muss eine **frische, tatsächlich veröffentlichte n8n-
Workflowantwort** mit `active=true`, `activeVersionId` und
entweder `versionId=activeVersionId` für denselben aktiven Graphen
oder `activeVersion.versionId=activeVersionId` mit den tatsächlichen
Aktivversions-Knoten und Verbindungen enthalten. Ein gewöhnlicher
Editorentwurf ohne aktive Versionsbelege genügt absichtlich nicht.

Der Prüfer vergleicht ausschließlich den bekannten Zahlungsdienstvertrag
mit dem vorhandenen GitHub-Generator. Er verlangt u. a.:

- unveränderte Einmal- und Folgezahlungs-Webhooks samt Response-Mode;
- alle ursprünglichen Ticket-, Mollie-, Kunden- und Antwort-Knoten;
- exakte feste Operationsrouten ohne zusätzlichen Umweg zur Aktivierung;
- originale Codeprüfungen und `SMA_Kunden`-Filter für Konto-/Paket-/
  Kundenordnerbindung und Zugangstoken;
- dieselbe Datentabelle in den Kundenoperationen sowie konsistente,
  voneinander getrennte Referenzen für Händler- und Datenbankzugang.

Abweichende, fehlende, unvollständige oder nicht als veröffentlicht
nachgewiesene Graphen liefern
`PUBLISHED_PAYMENT_CONTRACT_REVIEW_REQUIRED` und Exit-Code 1.
Ein strukturell passender Aktivgraph liefert
`ACTIVE_PAYMENT_GRAPH_STRUCTURALLY_MATCHES_NOT_E2E` mit Exit-Code 0.

**Wichtig:** Auch bei Exit-Code 0 bleiben `allows_checkout`,
`activates_customer`, `real_customer_e2e_verified`,
`mollie_payment_verified`, `drive_folder_access_verified` und
`billed_n8n_executions_measured` ausdrücklich `false`.
Der Prüfer startet keinen Zahlungsvorgang und erteilt keine Freigabe.

## Sicherheit und Grenzen

Die JSON-Eingabe bleibt **ausschließlich in der privaten Betreiberumgebung**:
nicht in Chat, GitHub, CI-Artifacts oder öffentliche Logs hochladen.
Exporte können vertrauliche Credential-Referenzen oder kundenbezogene
Konfiguration enthalten. Der Prüfer begrenzt die Eingabe auf 12 MiB,
macht **keinen** Netzwerkaufruf und gibt ausschließlich feste Fehlercodes
aus, niemals Tokens, Dateiinhalte, Kundenkennungen oder Geheimnisse.

Der Vergleich ist bewusst streng. Ein später bewusst in eines der fünf
SMA-Zielworkflows konsolidierter oder umbenannter Zahlungsgraph muss
mit einem **gesondert geprüften neuen Contract** abgenommen werden;
eine abweichende aktive Variante wird nicht durch bloß ähnliches
Verhalten freigegeben.

Danach fehlen für die erste echte Kundenfreigabe weiterhin:
eine eindeutig bestätigte neue Supabase-/n8n-Kontozuordnung,
die tatsächlich zugänglichen kundeneigenen Google-Drive-Eingangs-
und Verarbeitungsordner, ein bestätigter sicherer Erstzahlungspfad
und ein kompletter berechtigter Kunden-End-to-End-Durchlauf.
Dafür weiterhin `docs/ONBOARDING_FOLDER_PREFLIGHT.md` und
`docs/SMA_LAUNCH_READINESS_20261201.md` verwenden.

Keine Zugangsdaten anfordern oder speichern, keine Workflowversion
veröffentlichen, keine Datenbankmigration, keine Zahlungen,
Medienuploads, Freigaben oder Beiträge auslösen.
