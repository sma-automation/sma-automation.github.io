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

## Direkter n8n-Cloud-Leseabgleich ohne Exportdatei (Ergänzung 18.11.2026)

Zusätzlich zum Offline-Exportprüfer steht jetzt ein **rein lesender** Prüfaufruf
bereit. Er verwendet genau einen GET auf die n8n-Cloud-API für den bekannten
Zahlungsworkflow und ruft weder dessen Webhook noch eine n8n-Execution auf.
Er verändert keine Kundendaten, Credits, Tickets oder Zahlungen.

Ein bestehender berechtigter n8n-API-Schlüssel wird **nur in der privaten
Betreiberumgebung** unter SMA_N8N_READ_API_KEY bereitgestellt; nicht im
Chat, Repository, Shell-Befehl, CI-Artefakt oder in Protokollen speichern.

~~~sh
node n8n/package-payment/audit-live-worker.cjs
node --test tests/live-published-payment-worker-audit.test.cjs
~~~

Der feste Aufruf liest ausschließlich die n8n-Cloud-API per GET für
Workflow 8v2wcz5lh0yUf3sw. Ohne API-Schlüssel meldet er
N8N_READ_API_KEY_REQUIRED **ohne einen Netzaufruf**. HTTP-Fehler,
Weiterleitungen, Abweichungen der Workflow-ID, nicht bestätigte Aktivversionen
und unvollständige Knotengraphen schlagen fehl. Ein Lesezeitlimit von zwölf
Sekunden und eine Antwortgrößengrenze von zwölf MiB sind integriert.
Antworten und Credential-Referenzen werden ausschließlich im Arbeitsspeicher
ausgewertet, nicht ausgegeben oder gespeichert. Der Prüfbericht enthält nur
feste Fehlercodes und Freigabewerte, niemals das zurückgelieferte Workflow-JSON.

**Wichtig:** Die öffentliche n8n-API kann den **neueren Editorentwurf**
zurückgeben. activeVersionId allein ist daher **kein Beweis**, dass diese
Nodes veröffentlicht sind. Der Direktprüfer verwendet denselben strengen
Vertragsvergleich wie der Offline-Prüfer und akzeptiert den Top-Level-Graphen
nur, wenn versionId mit activeVersionId übereinstimmt. Ist der Entwurf neuer
oder die aktive Versionsstruktur nicht enthalten, lautet das Ergebnis
PUBLISHED_PAYMENT_CONTRACT_REVIEW_REQUIRED. Dann ausschließlich die aktive
Version separat über die berechtigte n8n-Versionsansicht abrufen und mit
audit-published-worker.cjs in der privaten Betreiberumgebung prüfen.

Auch ein positives Ergebnis lautet ausdrücklich
ACTIVE_PAYMENT_GRAPH_STRUCTURALLY_MATCHES_NOT_E2E; es berechtigt nicht zu
Kundenaktivierung oder Checkout und ersetzt weder die tatsächliche Drive-
Berechtigung noch den ersten Kunden-/Mollie-End-to-End-Test. Bei fehlendem
API-Zugang ist **keine** aktive Version bestätigt; das neue Werkzeug darf
nicht als Ersatzbeleg aus GitHub heraus ausgeführt oder simuliert werden.

Offizielle Grundlage: n8n Public API Authentifizierung und API-Referenz
(https://docs.n8n.io/api/authentication/ und
https://docs.n8n.io/api/api-reference/).
