# Shopify-Bestandsentwurf: Übernahme vor Spiegelung

Stand: 6. November 2026. **Vorbereiteter, unveröffentlichter Kandidat.**
Der laufende Bestandsworkflow, Shopify und die produktive Datenbank wurden in
diesem Arbeitsschritt nicht verändert. Shopify Payments bleibt im Testmodus.

## Ausgangslage

PR #80 ist zusammengeführt und live; die Testkennzeichnung im Dashboard wurde
vom Betreiber bestätigt. Die Bestellstrecke ist für diesen Schritt abgeschlossen.

Der getrennt erhaltene 515-Node-Entwurf des Kundenworkflows enthält zusätzlich
einen Bestandszweig. Dieser schrieb zuerst in `SMA_Produkte` bei n8n und rief
danach `sma_shopify_bestand_uebernehmen_v1` auf. Lehnt Supabase eine veraltete
oder unpassende Auswertung ab, war die n8n-Zeile bereits geändert. Der Zweig
nutzte außerdem nicht die Sperre des bereits laufenden Bestands-Webhooks.

Lesende Bestandsaufnahme dieser Sitzung:

- Shopify bestätigt für SMA-TEST-002 vier Stück; Supabase enthält ebenfalls vier.
- SMA-TEST-001 hat bei Shopify einen Rohbestand von -6; SMA führt ihn als null
  verfügbare Stück. Das entspricht der bestehenden Behandlung negativer Werte.
- Das Bestandsjournal enthält 17 abgeschlossene Meldungen, zuletzt zur
  Testbestellung #1010 am 5. November 2026 um 21:55:17 UTC.
- Die Definitionen der bestehenden Bestands-RPCs wurden gelesen. Es gibt in
  diesem Schritt keine Migration, Änderung an Rechten oder neue SQL-Funktion.

## Korrigierter Entwurf

`n8n/patch-inventory-draft.cjs` erstellt **nur eine lokale Kandidatendatei** aus
einem privaten Export. Es führt keine Netzwerkanfrage und keine n8n-Veröffentlichung
aus. Der private Gesamtexport mit Zugangskonfiguration gehört nicht ins Repository.

1. Die erste Shopify-Abfrage ermittelt und prüft Produkt, Variante und Inventar-ID.
   Ihr Mengenwert wird nicht gespeichert.
2. Kunde, Marktkonto und exakte HTTPS-Shopify-Domain werden gebunden. Aus der
   Workflow-/Ausführungskennung entsteht eine wiederholbare interne Lieferkennung.
3. Die vorhandene `sma_shopify_inventory_event_v1`-Sperre wird für das Konto und
   Inventarobjekt angefordert. Ein belegter oder ungültiger Zustand bricht ab;
   eine bereits abgeschlossene identische Ausführung endet ohne weitere Writes.
4. **Erst nach der Sperre** wird der Bestand erneut bei Shopify gelesen.
   Unvollständige Standortlisten, fremde Inventarobjekte, fehlende oder ungültige
   Mengen und abgelaufene Sperren werden zurückgewiesen.
5. Der vorhandene `commit`-Aufruf übernimmt den Bestand zuerst in Supabase und
   verwendet den serverseitigen Zeitpunkt des Sperrbeginns. Der Rückgabewert
   muss die aktuelle Übernahme, Kunden-/Produktzuordnung, Menge und Zeit bestätigen.
   `applied:false`, Fehler und unklare Antworten erreichen die n8n-Tabelle nicht.
6. Danach wird ausschließlich die bereits dreifach gefilterte n8n-Produktzeile
   geändert. Erst ihre passende Rückmeldung erlaubt `finish` im Journal.
   Nur ein bestätigtes Journalergebnis wird als Abschluss ausgegeben.

Die Shopify-Abfrage bleibt unverändert und wird zweimal benutzt. Es gibt keine
Shopify-Mutation, Bestellung, Erstattung oder Änderung von Zahlungs-/Versanddaten.
Neue HTTP-Aufrufe haben 15 Sekunden Timeout; automatische Node-Wiederholungen
sind im sperrenden Abschnitt deaktiviert. Die SQL-Sperre läuft nach zwei Minuten
ab. Vor Commit/Spiegelung wird ein Zeitpuffer geprüft.

Der Patch prüft Fingerabdrücke der vier ursprünglichen Bestands-Nodes und ihrer
Verbindungen, Node-Typen und eingehenden Kanten. Bei Abweichungen oder gepinnten
Daten bricht er ab. Zugangsdaten, Produktmutationen, Bestellkennzeichnung, übrige
Nodes, Einstellungen und Workflow-Metadaten werden unverändert übernommen.
Aus dem gesicherten 515-Node-Entwurf entsteht ein Kandidat mit 524 Nodes.

## Prüfung und Freigabegrenze

```sh
node --test tests/inventory-draft.test.cjs tests/shop-stock.test.cjs
git diff --check
```

40 Tests bestanden: 30 für den neuen Vertrag und Patch, zehn vorhandene
Dashboard-Bestandstests. Der synthetische Durchlauf führt die tatsächlich
eingebetteten Code-Nodes und HTTP-Body-Ausdrücke aus. Er prüft unter anderem
Kunden-/Kontobindung, Doppelaufrufe, belegte/abgelaufene Sperren, zweite Lesung,
GraphQL-Fehler, negative Mengen, Teilseiten, abgelehnte Datenbankantworten,
Spiegelungsfehler, Journalabschluss und unveränderte übrige Workflowteile.

Die wiederverwendete GraphQL-Abfrage ist gegen Admin API **2026-07** validiert.
Das bestätigt das Schema, nicht die Berechtigungen des konkreten n8n-Zugangs.
Ein exakter Vergleich des privaten Gesamtexports prüft zusätzlich, dass nur
die vorgesehenen Bestands-Nodes/-Verbindungen verändert und neun Nodes ergänzt
werden. Zugangskonfiguration und alle übrigen Inhalte bleiben gleich.

**Noch ausstehend:** Import in eine getrennte unveröffentlichte n8n-Arbeitskopie
und ein kontrollierter Ausführungstest mit dem vorhandenen n8n-Zugang. In dieser
Sitzung waren keine vorhandenen Browser-Tabs und keine n8n-Verbindung verfügbar.
Der erhaltene Originalentwurf wurde daher nicht überschrieben oder veröffentlicht.

Supabase und n8n Data Tables sind keine gemeinsame Transaktion. Ein Ausfall nach
dem Commit kann eine vorübergehend abweichende Spiegelung hinterlassen. Ein
verspäteter externer Tabellenaufruf über das Sperrende hinaus ist durch die lokalen
Tests nicht ausgeschlossen. Vor Veröffentlichung müssen Timeout, Teilfehler und
Wiederaufnahme im echten n8n-Lauf geprüft werden; ein unbekanntes Ergebnis darf
nicht durch blindes Wiederholen eines alten Tabellen-Writes repariert werden.
Eine neue vollständige Ausführung muss einen frischen Shopify-Wert lesen.
Die Sperre koordiniert diesen Zweig mit dem bestehenden Bestands-Webhook;
separate manuelle Bestandsaufträge werden durch diesen Patch nicht umgebaut.

Der 524-Node-Kandidat enthält auch ältere, hier nicht abgenommene Änderungen des
Entwurfs. **Kein vollständiger Austausch des veröffentlichten 511-Node-Workflows.**
Eine spätere Veröffentlichung benötigt den dann frischen Export, den gezielten
Vergleich mit der veröffentlichten Version und die Abnahme des gesamten
übernommenen Bestandszweigs. Dieser PR allein ist kein Live-Nachweis.

Quellen: [Shopify-Mengen und Zustände](https://shopify.dev/docs/apps/build/inventory-management-apps/manage-quantities-states),
[InventoryLevel 2026-07](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/InventoryLevel),
[n8n-Code-Kontext](https://docs.n8n.io/build/code-in-n8n/use-built-in-shortcuts.md).
