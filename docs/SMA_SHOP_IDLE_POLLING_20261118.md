# SMA – Shop-Abfragen nur bei sichtbarem Bereich

Stand: 18.11.2026. Vorbereitung und Quellcodeabnahme, **noch keine gemessene Live-Einsparung**.

## Ausgangsbefund aus echten Supabase-Zugriffsprotokollen

In einem 24-Stunden-Abgleich wurden folgende GET-Anfragen mit
`supabase-js/2.119.0; runtime=web` und Browser-User-Agent erfasst:

| Ressource | Aufrufe |
| --- | ---: |
| `sma_bestellungen` | 2.058 |
| `sma_produkte` | 1.038 |
| `sma_bestandsauftraege` | 1.037 |

Zusätzlich wurden 72 POSTs zu `sma_order_reconcile_v1` mit n8n-User-Agent beobachtet.
Diese Werte stammen aus unterschiedlichen Quellen und sind **nicht**
als 4.100 kostenpflichtige n8n-Executions zu interpretieren.
Ein Teil der Bestellabfragen liefert HTTP 206 (PostgREST-Teilergebnis
bei Range/Count), nicht automatisch einen Backendfehler. Die Logzahlen
sind eine Momentaufnahme des gesamten beobachteten Browsersystems und
keine direkt abrechenbare Kundeneinzelmetrik.

## Ursache und Änderung

In `app/shop-manager.html` wurde der Bestellstatus bei offenem
Shop-Dokument etwa alle 15 Sekunden abgefragt, der Bestand etwa alle
30 Sekunden, selbst wenn die jeweils andere Unterseite ausgewählt war.
Ein über das übergeordnete SMA-Dashboard per CSS ausgeblendetes
Shop-iframe kann zudem weiter `document.hidden === false` sehen.

Die Korrektur beschränkt **automatische Leseabfragen** auf den aktuell
sichtbaren Shop-Unterbereich und kontrolliert zusätzlich die
sichtbaren iframe-Vorfahren. Wechsel auf „Produkte“ bzw. „Bestellungen“
und Wiedererscheinen des übergeordneten Dashboard-Kapitels lösen
einmalig die Aktualisierung des nun sichtbaren Bereichs aus.
Im Hintergrund werden keine zusätzlichen Timer oder externen
Anfragen benötigt, um die ausgeblendete iframe-Anzeige zu beobachten.

Die unabhängig laufenden Auftrags- und Bestands-Worker, Webhooks,
Benutzereingaben, Speicheroperationen und serverseitigen
Berechtigungsregeln sind **nicht geändert**. Ungespeicherte
Bestandsentwürfe, geladene Bestelllisten, die Pagination und die
Benutzerfilter bleiben beim Reiterwechsel erhalten. Ein nach dem
Ausblenden eintreffendes altes Poll-Ergebnis darf den aktuellen
Produktstand nicht überschreiben.

## Prüfungen und nachfolgende Live-Messung

```sh
node --test tests/shop-orders.test.cjs tests/shop-stock.test.cjs
```

Die Regressionen simulieren ausgeblendete Unterreiter, ein CSS-verstecktes
Dashboard-iframe, Rückkehr zu einer sichtbaren Ansicht und ein
verspätet eintreffendes Ergebnis. Sie nutzen nur synthetische
Supabase-Doubles, keine echten Bestellungen oder Bestandsänderungen.

Für eine nachprüfbare Ersparnis ist nach Bereitstellung derselbe
Log-Abgleich mit vergleichbarer realer Nutzungsdauer zu wiederholen.
Aus der früheren Tageszahl allein kann keine prozentuale
Reduktion behauptet werden. Dieser Patch betrifft zunächst
Supabase-GET-Traffic – die 10.000 monatlichen **n8n**-Executions müssen
weiterhin separat anhand echter Workflow-Starts bemessen werden.
