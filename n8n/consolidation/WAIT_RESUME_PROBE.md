# Native Wait/Resume: synthetische Engine-Probe und Auftragsvertrag

Stand: 16. November 2026. **Zwölf Offline-Tests und drei native manuelle
Engine-Proben auf n8n Cloud 2.47.7 bestanden.** Pro Probe wurden vier Ereignisse
unter derselben Execution-ID angenommen. Es gab keine Geschäftseffekte und
keine produktive Datei-Auftragsintegration. Die manuellen Proben beweisen weder
Abrechnungszähler noch eine garantierte Cloud-Aufbewahrung über Stunden oder Tage.

## Zweck und Dateien

Die Probe soll in **einem bereits vorhandenen, unveröffentlichten QA-Workflow**
zeigen, ob vier HTTP-Fortsetzungen dieselbe native `execution.id` behalten. Es
werden keine Dateien hochgeladen und keine Provider angesprochen. Alle Daten
sind fest erfunden. Der Graph besitzt 14 Knoten: Manual Trigger, Initialisierung
und vier Folgen aus Wait, Prüfung und HTTP-Antwort. Es gibt keine Credentials,
ausgehenden HTTP-Knoten, Unterworkflows, Zeitpläne oder Fehlerworkflows.

| Datei | Inhalt |
| --- | --- |
| `wait-resume-probe.workflow.json` | Native Wait-1.1-Probe mit explizitem Workflow-Timeout von 120 Sekunden |
| `wait-resume-probe.inherited-timeout.workflow.json` | Gleicher Graph; `settings.executionTimeout` fehlt vollständig |
| `wait-resume-probe.cjs` | Deterministischer Generator und exakt der in Code-Knoten eingebettete Prüfcode |
| `wait-resume-probe.test.cjs` | Zwölf gezielte Offline-Tests einschließlich der tatsächlichen Code-Knoten |

Beide Varianten haben eine eigene unveränderliche Auftragsfrist von zehn
Minuten. Jeder Wait endet spätestens zu diesem Zeitpunkt; der anschließende
Code weist abgelaufene oder fehlende Ereignisse zurück. Die Variante ohne
Timeout-Feld **erbt die Instanzeinstellung**. Sie verspricht keine unbegrenzte
Cloud-Laufzeit. Beide Dateien sind generisch, ohne Workflow-ID und mit
`active: false`; sie dürfen ausschließlich in dem vorher gesicherten bestehenden
QA-Editor verwendet werden, nicht zum Anlegen eines weiteren Workflows.

```sh
node n8n/consolidation/wait-resume-probe.cjs --write-fixtures
node --test n8n/consolidation/wait-resume-probe.test.cjs
```

Der Generator schreibt nur diese beiden lokalen JSON-Dateien. Die Tests prüfen
Serialisierbarkeit, gespeicherte Zustandsreferenzen, Execution-/Datei-/Revisions-
und Phasenbindung, Replay-Abweisung, ausdrückliche Freigabe und Fristen. Sie
modellieren keine n8n-Engine und keine tatsächliche HTTP-Zustellung.

## Offizielle Grundlage und beobachtetes Timeout-Verhalten

Die [Wait-Dokumentation](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait/)
beschreibt das Speichern und Fortsetzen einer Ausführung sowie mehrere
aufeinanderfolgende Wait-Knoten. Ein eigener Webhook-Suffix trennt die Phasen.
`Limit Wait Time` setzt die Ausführung nach der Frist fort; es ersetzt deshalb
nicht unsere Prüfung auf ein gültiges, rechtzeitiges Ereignis. Teil-Ausführungen
ändern den Resume-Kontext. Die Probe wird daher immer vom Manual Trigger
gestartet, niemals mit „Execute step“ mitten im Graphen.

Die [Workflow-Einstellungen](https://docs.n8n.io/workflows/settings/) nennen eine
planabhängige maximale Timeout-Einstellung für n8n Cloud. Die installierte
Version wurde in Help → About als **2.47.7** gelesen. Eine Kontogarantie für
langfristig pausierte Ausführungen ist dadurch nicht belegt. Die Variablen der
[Self-hosting-Seite](https://docs.n8n.io/hosting/configuration/configuration-examples/execution-timeout/)
sind keine Konfigurationsanweisung für dieses Cloud-Konto.

Der offizielle, zur Installation passende Tag `n8n@2.47.7` erklärt den
beobachteten HTTP-Pfad: In
[`workflow-runner.ts`](https://github.com/n8n-io/n8n/blob/n8n%402.47.7/packages/cli/src/workflow-runner.ts)
wird vergangene Zeit nur abgezogen, wenn `data.startedAt` ein `Date` ist
(gelesener Blob `b23458ebcdcda8d0b31e93133b4a8bc22de1ac2c`).
[`waiting-webhooks.ts`](https://github.com/n8n-io/n8n/blob/n8n%402.47.7/packages/cli/src/webhooks/waiting-webhooks.ts)
und
[`webhook-helpers.ts`](https://github.com/n8n-io/n8n/blob/n8n%402.47.7/packages/cli/src/webhooks/webhook-helpers.ts)
geben beim HTTP-Resume dieselbe vorhandene Execution weiter, aber kein
`startedAt` in den neuen Runner-Daten. Die separat verwaltete Startzeit in
`active-executions.ts` wird dort nicht hineinkopiert. Es wurde keine spezielle
generelle Timeout-Ausnahme nur für manuelle Ausführungen gefunden.

Fall B nahm den ersten Resume nach über 134 Sekunden trotz bestätigtem
120-Sekunden-Setting an. Das passt zu diesem HTTP-Pfad und widerlegt hier einen
einfachen 120-Sekunden-Wandzeitabbruch. Es ist keine Zusage über Timer-Resume,
andere Ausführungsmodi, Abrechnung oder Cloud-Retention. Deshalb bleiben die
eigene absolute Auftragsfrist und die ursprünglichen aktiven Fristen jeder
einzelnen Fachoperation erforderlich.

Das Wait-Schema wurde außerdem mit dem vorhandenen Meta-Wait-Knoten und dem
offiziellen [Wait-Quellcode](https://github.com/n8n-io/n8n/blob/n8n%402.47.7/packages/nodes-base/nodes/Wait/Wait.node.ts)
abgeglichen. Der lokale Meta-Export wurde nicht in diese Fixture kopiert. Die
Frist jedes Wait liest ausdrücklich den vorangehenden gespeicherten Code-Zustand;
sie hängt nicht vom Ausgabeformat des Respond-to-Webhook-Knotens ab.

## Manuelle Durchführung in einem bestehenden QA-Workflow

Als mögliches Ziel nennt das Inventar vom 16.11.2026 den unveröffentlichten
synthetischen Test `9XKreTHHGR3Agtwd`. Das ist kein aktueller Statusnachweis.
Vor der Änderung den bestehenden Workflow in der UI öffnen, seine
Unveröffentlichtheit bestätigen und die vollständige Definition einschließlich
Einstellungen sichern. Keine produktive ID für die Probe verwenden.

1. Im vorhandenen QA-Editor die alten Knoten entfernen und genau eine Fixture
   importieren. Es müssen anschließend genau 14 verbundene Knoten vorhanden
   sein. Manche UI-Importe hängen Knoten an; eine solche Kombination nicht
   ausführen. Die ursprüngliche Workflow-ID muss erhalten bleiben. Nicht
   veröffentlichen.
2. Einstellungen separat kontrollieren: kein Fehlerworkflow, manuelle
   Ausführungen speichern, Timeout entsprechend der Variante. Ein Import der
   Knoten allein ist kein Beleg, dass Einstellungen übernommen wurden. Bei der
   zweiten Variante prüfen, dass kein alter expliziter Timeout stehen bleibt.
   Installierte n8n-Version und sichtbare Cloud-Grenze im Prüfprotokoll notieren.
3. Den gesamten Workflow einmal manuell starten. Die neue Execution-ID aus der
   Ausführungsansicht notieren. In `Probe - initialize` enthält
   `next_request.body` ausschließlich die benötigten synthetischen Daten.
4. Warten, bis `Probe - wait 1` tatsächlich wartet. Seine aktuell angezeigte
   native Resume-URL verwenden. Eine gegebenenfalls vorhandene Signatur und
   den Suffix vollständig erhalten. Falls die UI nur die Basis-Resume-URL zeigt,
   gehört `/probe-1` vor einen möglichen Query-String. Keine URL raten.
5. Mit dem vorhandenen manuellen HTTP-Werkzeug genau einen `POST` mit
   `Content-Type: application/json` und genau diesem JSON-Body an diese URL
   senden. Es ist ausschließlich der eigene n8n-Resume-Endpunkt. Die Fixture
   selbst ruft keinen HTTP-Endpunkt auf. Erwartet wird eine geprüfte JSON-Quittung
   mit `accepted_count: 1` und der ursprünglichen Execution-ID.
6. Erst wenn `Probe - wait 2` wartet, das vorherige identische Ereignis noch
   einmal an die **alte** URL senden. Es darf keinen zweiten akzeptierten Schritt
   und keinen neuen Workflow-Start geben. HTTP-Status tatsächlich aufzeichnen;
   die konkrete Ablehnung ist versionsabhängig. Die aktuelle Phase muss warten
   bleiben. Eine 2xx-Transportantwort allein gilt nicht als Phasenbestätigung.
7. Für die weiteren Phasen jeweils `next_request.body` aus `Probe - accept 1`,
   `2` bzw. `3` verwenden und an die **jeweils aktuelle** Wait-URL senden. Nicht
   mehrere Resume-Requests parallel absetzen. Die dritte Anfrage enthält die
   ausdrückliche synthetische Freigabe `approved: true`.
8. Nach Phase vier müssen `accepted_count: 4`, `same_execution: true`,
   `complete: true` und vier identische `observed_execution_ids` vorliegen.
   Die Ausführungsansicht muss eine abgeschlossene Hauptausführung zeigen.
   Eine erneute Zustellung nach Abschluss darf keine weitere Arbeit beginnen.
9. Erst nach Abschluss oder bewusstem Stoppen aller Probe-Ausführungen die
   gesicherte QA-Definition wiederherstellen. Den Workflow unveröffentlicht
   lassen. Runtime-Resume-URLs und mögliche Signaturen nicht in Git,
   Screenshots für den Bericht oder Chat-Nachrichten übernehmen.

Ein fehlerhafter Body am **aktuellen** Resume-Endpunkt wird erst nach dem
nativen Aufwecken im Code erkannt und beendet diese synthetische Ausführung.
Er wird nicht als erfolgreiche Leerlauf-Antwort behandelt. Das ist bewusst
geschlossenes Fehlerverhalten, keine vollständige produktive Zustellgarantie.
Die produktive Weiterleitung muss solche Anfragen vorher abweisen.

### Drei kleine Engine-Fälle

| Fall | Variante und Aktion | Erforderlicher Befund |
| --- | --- | --- |
| A: Fortsetzung + Replay | 120-Sekunden-Variante; vier gültige Phasen innerhalb der Frist, Replay der alten URL zwischen zwei Phasen | Eine native Hauptausführung, vier akzeptierte Ereignisse, unveränderte Execution-ID, kein Phasensprung beim Replay |
| B: explizite Timeout-Grenze | Neue manuelle Ausführung derselben 120-Sekunden-Variante; vor dem ersten Resume über 120 Sekunden warten, dann Zustand prüfen und gegebenenfalls einmal fortsetzen | Tatsächlichen Timeout-/Fortsetzungsstatus protokollieren; bei Ablauf keine akzeptierte Freigabe. Dieser Fall prüft die Cloud-Semantik, kein vorausgesetztes Ergebnis |
| C: geerbte Einstellung | Nach Ende von B dieselbe bestehende QA-ID mit der Variante ohne Timeout-Feld verwenden; vor dem ersten Resume ebenfalls über 120 Sekunden warten, dann die vier Phasen innerhalb von zehn Minuten abschließen | Belegen, ob und wie die geerbte Cloud-Einstellung die Fortsetzung erlaubt. Ein Erfolg nach zwei Minuten beweist keine erlaubte Wartezeit über Stunden oder Tage |

Die Zeitmessung beginnt beim Start der jeweiligen Ausführung. Die zehnminütige
eigene Frist wird durch weitere Antworten niemals verlängert. Einen weiterhin
wartenden Test am Ende ausdrücklich stoppen. Der Ablauf einer eigenen Frist
sowie fehlende/späte Antworten sind offline geprüft; ein zusätzlicher
zehnminütiger Engine-Lauf ist nur nötig, wenn dabei ein konkretes Runtime-Risiko
offenbleibt.

### Ergebnisprotokoll der nativen Fälle

Die bestehende QA-ID war `9XKreTHHGR3Agtwd` und blieb unveröffentlicht. Nach A/B/C
zeigte die UI keine aktiven Ausführungen. Der UI-Import ersetzte Graph und Namen,
**übernahm aber nicht die Workflow-Einstellungen**. Die Einstellungen wurden
deshalb separat in der UI gespeichert und durch Exporte unabhängig bestätigt:
`executionTimeout:120` plus manuelle Speicherung für A/B, fehlendes
`executionTimeout` plus manuelle Speicherung für C. Der Graph blieb gleich.

Alle Uhrzeiten am 16.11.2026 in UTC:

| Fall | Execution | Initialisierung | Erster verzögerter Resume | Letzte Quittung | Native UI |
| --- | --- | --- | --- | --- | --- |
| A, 120s | 7098 | 16:05:56.833 | Innerhalb der Frist | 16:07:30.834 | Succeeded, 1m35.818s |
| B, 120s | 7099 | 16:08:04.161 | 16:10:18.674, HTTP200 | 16:12:41.437 | Succeeded, 4m39.005s |
| C, Timeoutfeld fehlt | 7100 | 16:16:23.875 | 16:18:59.095 | 16:19:24.874 | Succeeded, 3m2.869s |

Jeder Fall lieferte vier angenommene Phasen, vier identische
`observed_execution_ids` und `complete:true`. In Fall A ergab der Replay von
`probe-1` während Phase 2 HTTP404. Der Replay von `probe-4` nach Abschluss ergab
HTTP409. Keine weitere Hauptausführung entstand dadurch. Die echten nativen
Resume-URLs enthielten eine Signatur; sie bleiben außerhalb der Repo-Dateien.

Das neutrale private Prüfprotokoll liegt unter
`/workspace/shared/sma-five-workflows-20261116/wait-resume-engine-evidence.json`.
Zum Zeitpunkt dieses A/B/C-Protokolls stand die Wiederherstellung des
ursprünglichen QA-Graphs noch aus; sie folgt auf die getrennte synthetische
Dispatcherprobe und ist kein hier behaupteter Abschluss.

| Nachweis | Stand |
| --- | --- |
| Offline-Prüfungen | 12 Tests bestanden |
| Bestehende QA-ID, Sicherung und aktiver Status | Bestätigt; unveröffentlicht, nach A/B/C keine aktiven Ausführungen |
| n8n-Version und wirksame Timeout-Einstellung | 2.47.7; beide Varianten separat exportiert |
| Fälle A / B / C: Execution-ID, Start-/Resume-Zeiten, Ergebnis | Drei erfolgreiche native Läufe, siehe Tabelle |
| Native Ausführung bleibt bei allen vier Fortsetzungen dieselbe | Für alle drei manuellen Fälle bestätigt |
| Alte/abgeschlossene Resume-Anfrage bewirkt keinen neuen Start | HTTP404 bzw. HTTP409 beobachtet |
| Quota-/Abrechnungsbeleg für produktive Starts | Durch diese manuelle Probe nicht erbracht |

## Kleinster sicherer Vertrag für einen echten Datei-Auftrag

Dieser Abschnitt ist ein Entwurf, keine implementierte SQL-/Edge-Schnittstelle.
Er benutzt die bestehende Cloud und die vorhandene Supabase-Instanz. Die fünf
geplanten Fachworkflows bleiben bestehen; interne Operationen benötigen keine
zusätzlichen veröffentlichten Workflows. Die native Engine-Probe und die
wirksame erlaubte Lebensdauer sind Voraussetzungen für die Umsetzung.

### Zustände und Grenzen

Ein Auftrag besitzt `job_id`, authentifizierten Eigentümer, `file_id`, Revision,
Hash des unveränderlichen Medien-/Text-/Zielpakets, `execution_id`, `phase`,
Phasenzähler, absolute Auftragsfrist und Status je ausgewähltem Portal. Derselbe
Auftrag umfasst alle ausgewählten Ziele aus YouTube, TikTok, Instagram und
Facebook. Startschlüssel und Paket-Hash verhindern ein versehentliches zweites
Anlegen desselben Auftrags.

| Zustand | Eingang und Prüfung | Fortsetzung innerhalb der Hauptausführung |
| --- | --- | --- |
| Upload ausstehend | Geschützter Abschlussbeleg für genau diesen Upload, Eigentümer und Revision; kein vom Browser frei behaupteter Drive-Pfad | Medien intern prüfen und benötigte Arbeit vorbereiten |
| Bearbeitung | Entwürfe und Ansichten über authentifizierte Datenzugriffe; endgültig gespeicherte Revision und vollständiges Zielpaket wählen | Eine gezielte Änderung fortsetzen; nicht jeder Tastendruck oder jedes Ansichts-Polling |
| Freigabe ausstehend | Gesonderte ausdrückliche Freigabe des exakten Pakets; Accountbindung und Pflichtentscheidungen je Portal müssen passen | Auftrag verriegeln, vor Versand unveränderte Revision und Gültigkeit erneut prüfen |
| Versand / Verarbeitung | Pro Portal eigener Operationsbeleg; verifizierter Status oder begrenzte interne Statusabfrage | Init, Upload, Status und gegebenenfalls Cover intern ausführen; kein regulärer Browser-Webhook je Einzelschritt |
| Fertig / teilweise fehlgeschlagen / abgelaufen / abgebrochen | Dauerhaftes Ergebnis; Portalfehler getrennt sichtbar | Keine weitere Veröffentlichung; spätere echte Änderungen erfordern einen neuen expliziten Auftrag |

Zwischen Bearbeitung und Freigabe darf eine Revision nicht stillschweigend
ausgetauscht werden. Eine Änderung entwertet eine frühere Freigabe. Vor Beginn
des Provider-Versands darf der vorhandene Auftrag zur Bearbeitung zurückkehren;
das braucht eine neue Phase und ein neues Ticket. Nach einem begonnenen Versand
wird dasselbe Paket nicht umgeschrieben. Abbruch/Timeout stoppt weitere Schritte,
kann aber einen bereits vom Provider akzeptierten Beitrag nicht rückgängig machen.

### Privates serverseitiges Resume-Ticket

1. Der Browser sendet eine authentifizierte, fachliche Aktion mit `job_id`,
   erwarteter Revision/Phase und Idempotenzschlüssel an die vorhandene
   serverseitige Grenze. Er erhält keine n8n-Resume-URL, Signatur,
   Provider-Credentials oder frei nutzbare interne Operation.
2. Eine private serverseitige Zuordnung bindet ein kryptografisch zufälliges
   Einmalticket an Eigentümer, Auftrag, Execution-ID, Phase, Phasenzähler,
   Paket-Hash und Ablaufzeit. Der rohe Resume-Endpunkt bleibt ausschließlich
   serverseitig zugänglich. Datenzugriffe des Kunden dürfen ihn nicht lesen.
3. Eine atomare Zustandsprüfung akzeptiert nur die erlaubte nächste Aktion.
   Ein Ereignisschlüssel mit gleichem Inhalt liefert denselben gespeicherten
   Beleg; derselbe Schlüssel mit verändertem Inhalt wird abgewiesen. Erst danach
   wird ein Zustellauftrag dauerhaft gespeichert. Verbrauch des Tickets und
   HTTP-Zustellung sind keine gemeinsame Transaktion und müssen getrennt
   protokolliert werden.
4. Ein begrenzter Zusteller nimmt ausschließlich den gespeicherten eigenen
   n8n-Endpunkt und die zugehörige Phase. Eine vom Browser übermittelte Ziel-URL
   ist unzulässig. Er setzt die bestehende Ausführung fort. Der erste Code-/RPC-
   Schritt nach Wait prüft Ticket, Frist und Paket nochmals atomar, bevor eine
   Provideroperation beginnen darf. Ein zukünftiges Phasenticket ist nicht
   automatisch die Erlaubnis, seine Phase zu überspringen.
5. Vorzeitige Ereignisse werden gespeichert, bis der passende Wait bereit ist.
   Verlorene HTTP-Antworten lösen zunächst einen Abgleich des gespeicherten
   Ereignis-/Operationsbelegs aus. Kein unbeschränktes Wiederholen und kein
   erneuter Hauptstart „zur Sicherheit“. Derselbe alte Suffix/Phasenzähler darf
   niemals eine spätere Wait-Phase bedienen. Ein endlicher Zustellversuch mit
   Lease, Backoff und Deadline ist Teil des Vertrags.
6. Status-Callbacks werden nur verwendet, wo der Provider sie tatsächlich
   unterstützt und sie verifiziert werden können. Sie werden dedupliziert,
   gespeichert und passend fortgesetzt. Sonst fragt die bereits laufende
   Hauptausführung begrenzt intern ab. Eine normale neue Webhook-Ausführung pro
   Statusabfrage oder pro Portal erfüllt das Budgetziel nicht.

Die Einstellung ohne zusätzliche Authentisierung der rein synthetischen Fixture
ist kein produktives Sicherheitsmodell. Der echte Resume-Weg braucht serverseitige
Authentisierung und die Einmal-/Phasenprüfung. „Genau einmal“ über Datenbank,
n8n und fremde Provider hinweg wird nicht behauptet: Ein eindeutiges
Operationsjournal und Abgleich nach unklaren Antworten verhindern insbesondere
blind wiederholte Veröffentlichungen.

### Ressourcen, Fristen und noch fehlende Teile

Für jede aktive Operation gelten eigene feste HTTP-/Rechenfristen, ein Maximum
für Versuche, begrenzte Payloadgrößen und begrenzte parallele Providerarbeit.
Die absolute Auftragsfrist bleibt unabhängig vom Workflow-Timeout. Sie muss
unter die praktisch bestätigte Cloud-Lebensdauer passen. Keine unbegrenzte
Retry-Schleife; kein vorsorglicher neuer Workflow-Start bei jeder Abfrage.

Die Probe prüft keinerlei echten Upload- oder Veröffentlichungsadapter. Im
bisherigen neuen Dispatch-Pfad sind YouTube/TikTok und ihre Journalübergänge
vorhanden; Instagram/Facebook müssen vor einem Vier-Portal-Versprechen ebenfalls
in denselben Freigabe-, Journal- und Ergebnisvertrag integriert und kontrolliert
werden. Alte deaktivierte Meta-Zweige sind dafür kein Erfolgsnachweis.

Ein erfolgreicher Engine-Test würde die native Fortsetzung belegen. Er würde
noch nicht alle heutigen zusätzlichen Aufrufe für Uploadstart/-abschluss,
Originale, Vorschaubilder, Accountprüfungen und Textgenerierung beseitigen. Der
gesamte Kundenweg muss diese Aktionen tatsächlich direkt oder als interne
Operationen abwickeln, bevor „ein Hauptstart pro Datei“ belastbar ist. Medien-
und Datenbankressourcen, monatliche globale Aufgaben, Fehlerbehandlung und
zusätzliche Kundenaktionen gehören weiterhin in die Budgetrechnung.
