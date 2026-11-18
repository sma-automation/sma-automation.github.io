# SMA – Tatsächlich veröffentlichte n8n-Zahlungsstrecke vor dem ersten Kunden prüfen

Stand: 18.11.2026. **Offline-Bestandsprüfung, keine Inbetriebnahme.**

## Warum dieser Vergleich benötigt wird

Das GitHub-Werkzeug `n8n/package-payment/build-worker.cjs` erzeugt
den erwarteten Zahlungsdienst. Die auf Supabase produktiv installierte
Edge Function `sma-package-payment` wurde am 18.11.2026 als Version 9
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

## Übergabe: fest gebundene Webhook-Ziele und Signatur-Schlüssel (18.11.2026)

Der installierte Einstieg `supabase/functions/sma-package-payment/index.ts`
verwendet **zwei feste n8n-Cloud-Webhook-Ziele** für den Paketdienst und die
Folgezahlung. Bei einer späteren privaten Servermigration sind diese URLs
nicht automatisch auf den neuen Server umgestellt. Ein DNS-Wechsel der
öffentlichen Website allein ersetzt die beiden Zieladressen nicht.
Die Zielworkflows müssen vor einer koordinierten Umschaltung mit der
**tatsächlich veröffentlichten n8n-Aktivversion** und allen Antwortfeldern
verglichen sein; eine ungetestete URL-Änderung kann die Zahlungskette
unterbrechen.

Die signierten Mollie-Rückruflinks verwenden einen HMAC-Schlüssel, der im
derzeitigen Einstieg aus `SUPABASE_SERVICE_ROLE_KEY` abgeleitet wird.
Eine Rotation dieses Schlüssels ohne Übergangskonzept macht **bereits
ausgegebene** Rückruf-Proofs ungültig. Vor einem Schlüssel- oder
Backendwechsel muss der Betreiber offene Erstzahlungen, Folgezahlungen,
laufende Leasing-/Ticket-Zustände und ausstehende Provider-Rückrufe erfassen.
Die sichere Migration benötigt entweder unveränderte gültige Proofs bis zur
Abarbeitung oder eine gesondert getestete, eng begrenzte Schlüsselübergangs-
Verifikation. Den Schlüssel selbst niemals in Chat, Export, Repository,
CI-Protokoll oder Übergabedokument kopieren.

Die eng begrenzte Eingabeprüfung für **angemeldete** Kunden in PR #380
verändert weder die signierten Mollie- und Schedule-Routen noch die
existierenden HMAC-Proofs oder n8n-Ziele. Dieser Codecheck ist kein
Ersatz für eine Aktivversions- und Zahlungsverifikationsprobe.

## Direkter n8n-Cloud-Leseabgleich der veröffentlichten Version (18.11.2026)

Der Direktprüfer `n8n/package-payment/audit-live-worker.cjs` verwendet die
**offizielle n8n Public API** ausschließlich zum Lesen. Damit ist er auch
bei einem neueren, **unveröffentlichten Editorentwurf** nutzbar.

Mit einem vorhandenen, berechtigten und ausschließlich in der **privaten
Betreiberumgebung** gesetzten `SMA_N8N_READ_API_KEY`:

```sh
node n8n/package-payment/audit-live-worker.cjs
node --test tests/live-published-payment-worker-audit.test.cjs
```

Bei fehlendem Schlüssel beendet sich das Werkzeug **ohne Netzwerkaufruf**
mit `N8N_READ_API_KEY_REQUIRED`. Den Schlüssel weder in den Chat noch in
Repository, Shell-Argumente, Protokolle oder CI-Artefakte kopieren.

Drei auf den bekannten Zahlungsworkflow beschränkte **GET**-Abrufe sind
möglich, mit einem gemeinsamen Timeout von 12 Sekunden und maximal 12 MiB
pro Antwort:

1. `GET /api/v1/workflows/8v2wcz5lh0yUf3sw`: veröffentlichte
   `activeVersionId` und richtige Workflow-ID feststellen; einen archivierten
   oder nicht veröffentlichten Workflow zurückweisen. Das alte Feld
   `active` ist laut n8n-API inzwischen veraltet.
2. `GET /api/v1/workflows/8v2wcz5lh0yUf3sw/versions/{activeVersionId}`:
   **genau diese** veröffentlichte Version auslesen. Die unabhängigen
   `workflowId`- und `versionId`-Werte müssen übereinstimmen. Nodes und
   Verbindungen werden mit dem bisherigen strengen
   `audit-published-worker.cjs`-Vertrag verglichen. Ein neuer Editorentwurf
   wird ausdrücklich **nicht** als aktive Version geprüft.
3. `GET /api/v1/workflows/8v2wcz5lh0yUf3sw`: unveränderte aktive
   Versionsbindung nochmals prüfen. Bei Wechsel oder Archivierung wird der
   Bericht verworfen. Ein späterer Workflow-Wechsel erfordert einen neuen Check.

Fehlende Berechtigungen für den Versionsabruf, gekürzte Credential-Referenzen,
nicht unterstützte API-Routen, Abweichungen und Zeitüberschreitungen liefern
**kein positives Prüfergebnis**. Gegebenenfalls muss die tatsächlich
veröffentlichte Version in der privaten n8n-Betreiberumgebung separat über
die Versionsansicht exportiert und mit dem Offline-Prüfer abgeglichen werden.
Die Versions-API ist von der n8n-Instanz und deren verfügbaren Funktionen
abhängig; sie wird nicht durch einen Editorentwurf ersetzt.

JSON-Antworten und Referenzen bleiben nur im Arbeitsspeicher; der Prüfer
gibt keine Credentials oder Graphen aus. Es gibt **keine** Workflow-
Execution, keinen Webhook-Aufruf, keine Zahlung, keine Kundenaktivierung und
keine Freigabe. Selbst bei einem strukturellen Treffer bleibt der Status
`ACTIVE_PAYMENT_GRAPH_STRUCTURALLY_MATCHES_NOT_E2E`. Drive-Zugriff,
Zahlungsnachweis, kostenpflichtige n8n-Starts und Kunden-End-to-End-Prüfung
bleiben separat offen.

n8n-Quellen: [API-Authentifizierung](https://docs.n8n.io/api/authentication/)
und [Public-API-Referenz](https://docs.n8n.io/api/api-reference/).
