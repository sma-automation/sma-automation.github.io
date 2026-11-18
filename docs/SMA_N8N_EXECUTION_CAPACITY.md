# SMA – n8n-Ausführungskapazität vor dem Kundenstart

Stand: 18.11.2026. **Planungswerkzeug, kein Nachweis des tatsächlichen n8n-Verbrauchs.**

## Warum der Grenzwert wichtig ist

Für den derzeit mitgeteilten Cloud-Rahmen gelten **10.000 abgerechnete
Workflow-Ausführungen pro Monat**. Das ist keine Begrenzung der Kundenzahl:
Die mögliche Kundenzahl ergibt sich aus der tatsächlichen Häufigkeit
abgerechneter Ereignisse, dem Medienvolumen und einer bewusst eingeplanten
Reserve. Fünf statt 26 aktivierte Workflow-IDs sparen allein keine
abgerechneten Starts. Einzelne Nodes und native Subworkflow-Aufrufe dürfen
nicht pauschal als neue kostenpflichtige Starts gezählt werden; maßgeblich
sind die tatsächlichen Abrechnungsereignisse des gebuchten n8n-Tarifs.

Der genannte Planfall **20 Kunden × 3 Dateien täglich × 30 Tage** ergibt
**1.800 Dateien im Monat**. Bei hypothetisch 26 abgerechneten Starts pro
Datei wären das **46.800 Starts**, ohne weitere Aufrufe. Die 26 sind
**kein neu erhobener Messwert** und müssen am aktuellen Kundenablauf
überprüft werden.

## Offline rechnen, ohne eine n8n-Execution auszulösen

Das integrierte Werkzeug benötigt nur Node.js. Es ruft weder n8n,
Supabase noch irgendeinen Provider auf und speichert keine Kundendaten.

```sh
node n8n/consolidation/execution-budget.cjs \
  --customers 20 --files-per-day 3 --days 30 \
  --executions-per-file 26 \
  --monthly-limit 10000 --reserve 2000 \
  --monthly-fixed 0 --daily-fixed 0 --daily-per-customer 0
```

Die **2.000 Ausführungen Reserve** sind eine vorsichtige
Planungsannahme, keine Vorgabe des Anbieters. Bei 8.000
verfügbaren Starts nach dieser Reserve können 1.800 monatliche Dateien
höchstens **4 abgerechnete Starts je Datei** beanspruchen, wenn wirklich
keine anderen Kosten entstehen. In der Praxis verringern Login,
Katalogabfragen, Statusaufrufe, Provider-Rückrufe, Wiederholungen und
tägliche Basislast dieses Budget weiter.

Für 31 Tage und eine niedrigere, hypothetische Rate von 4 Starts
je Datei ergibt das Werkzeug **7.440 Starts allein für Medien**.
Kommen beispielsweise monatlich 100 feste, täglich 5 feste und
täglich 1 zusätzliche Ausführung je Kunde hinzu, sind es
**8.315 Starts**. Das überschreitet die geplanten 8.000, selbst
wenn die nominelle Obergrenze von 10.000 noch nicht erreicht ist.

## Eingaben und Grenzen

- `--customers`: beliebige positive Kundenzahl; **keine eingebaute Grenze bei 20**.
- `--files-per-day`: geplante Dateien je Kunde und Kalendertag.
- `--days`: 1 bis 31 Tage; bei Januar sind 31 relevant.
- `--executions-per-file`: **abgerechnete externe Starts** für einen
  vollständigen Medienweg, nicht Anzahl der Nodes.
- `--monthly-fixed`, `--daily-fixed`, `--daily-per-customer`: alle
  sonstigen geschätzten, tatsächlich abgerechneten Starts, insbesondere
  regelmäßige Arbeit, Logins, Katalog, Provider-Rückrufe und Retries.
- `--monthly-limit`, `--reserve`: Tarifrahmen und freie Reserve.

Das JSON zeigt `estimatedExecutions`, `headroomAfterReserve`,
`maxExecutionsPerFile`, `customerCapacityAtTheseRates` und
`status`. Es gibt absichtlich immer
`verifiedAgainstActualN8nUsage:false` aus: **Keiner dieser
Werte bescheinigt einen echten End-to-End-Lauf oder die aktuelle
Abrechnung.** Eine fehlende Nebenlast wird nicht automatisch gemessen.
`WITHIN_MODELLED_BUDGET` bedeutet nur, dass die eingegebenen
Annahmen rechnerisch passen.

## Welche tatsächlichen Kosten zuerst aufnehmen?

Für **eine freigegebene, isolierte Testdatei** die Zahl der in der
n8n-Abrechnung gezählten Starts vom Kunden-Upload bis zum korrekt
abgeschlossenen Ergebnis notieren, getrennt nach Zugang,
Dateikatalog/Thumbnails, Analyse, Textbearbeitung, Versand,
Provider-Rückmeldung und Wiederholung. Provider-Veröffentlichung ist
dafür **nicht automatisch freigegeben**: Bei fehlender expliziter
Betreiberfreigabe nur bis zum sicheren Vorbereitungsschritt messen.

Danach die tägliche Basislast bei geschlossenem Dashboard ermitteln.
Schließlich den Monatsplan mit 20, 40 und 100 Kunden bei gleicher
echter Ereignisrate rechnen; höhere Tarife sind eine spätere
Geschäftsentscheidung, **kein Grund, heute ohne Freigabe zu kaufen**.

Priorität haben **weniger externe Starts**, nicht kosmetisch weniger
Workflow-IDs: nur bei echter Arbeit auslösen, schon laufende Jobs
wiederverwenden, Zeitplan ohne fällige Arbeit beenden, Katalog/
Vorschaubilder bündeln, nach Netzwerkfehlern dieselbe Auftragskennung
verwenden und unnötige Poll-Webhooks vermeiden. Keiner dieser Schritte
darf Zahlungs-, Eigentümer-, Inhalts- oder Provider-Freigaben umgehen.

## Regression

```sh
node --test tests/n8n-execution-budget.test.cjs
```

Die Tests decken 20/60 Kunden, 30/31 Tage, Reserve, sonstige Last,
sichere Ganzzahlarithmetik, den genauen Kapazitätsrand und fehlerhafte
Eingaben ab. Es gibt keine Kundenoperation und keinen neuen
automatisch gestarteten Workflow.


## Beobachtete Shopify-Abgleich-Basislast – 18.11.2026

Der veröffentlichte stündliche Kontrollabgleich
`SMA – Shopify Bestellabgleich V1` ist separat dokumentiert in
[`n8n/ORDER_RECONCILIATION.md`](../n8n/ORDER_RECONCILIATION.md).
Der Workflow startet nach Zeitplan einmal je Stunde und kann
innerhalb **derselben** Ausführung weitere fällige Marktkonten über
seine vorhandene `claim → complete/fail → claim`-Schleife bearbeiten.
Daher ist seine Kundenzahl nicht auf die Zahl seiner täglichen
Schedule-Starts begrenzt. Sein 8-Minuten-Limit und die
Shopify-Seiten-/Rate-Limits begrenzen trotzdem den Durchsatz je Lauf.

Die aktuellen Supabase-Gatewaylogs wurden über 24 Stunden geprüft:
**stabil drei POSTs zu `sma_order_reconcile_v1` je Stunde**,
alle mit HTTP 200. Dies passt zum typischen Ablauf
`claim → complete → abschließender leerer claim` beim derzeit
einen aktivierten Konto. Drei HTTP-/Supabase-RPC-Aufrufe sind
**nicht** drei kostenpflichtige n8n-Executions. Bei 24
tatsächlich berechneten stündlichen Starts pro Kalendertag
entspräche der laufende Kontrollabgleich allein rechnerisch
**720 n8n-Starts bei 30 Tagen** bzw. **744 bei 31 Tagen**.
Dies ist eine auf dem veröffentlichten Schedule beruhende
*Planungsannahme*, kein Auszug aus n8ns Rechnungszähler.
Manuelle Ausführungen, weitere n8n-Workflows und
Wiederholungen können das reale Budget erhöhen.

Wichtig vor größerer Kundenzahl: tatsächliche n8n-Abrechnung und
Durchsatz je Kundenkonto unter der vorhandenen 8-Minuten-Grenze
separat messen; keinen aus RPC-Zahlen erfundenen Monatsverbrauch
oder eine feste 20-Kunden-Grenze verwenden.
