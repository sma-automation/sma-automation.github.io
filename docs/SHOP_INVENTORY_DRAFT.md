# Shopify-Bestandsentwurf: Übernahme vor Spiegelung

Stand: 6. November 2026 (Europe/Vienna). **Echter n8n-Normallauf sowie Abbruch,
HTTP-Timeout und Wiederaufnahme bestanden; Kandidat weiterhin unveröffentlicht.** Der laufende Bestandsworkflow und der
erhaltene 515-Node-Entwurf wurden nicht verändert. Im Prüflauf wurden für
SMA-TEST-002 dieselben vier Stück in Supabase und n8n bestätigt. Einschließlich
beider Wiederaufnahmetests wurden drei Journalmeldungen ergänzt; alle 20
Meldungen sind abgeschlossen. Shopify Payments bleibt im Testmodus.

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
- Vor dem Prüflauf enthielt das Bestandsjournal 17 abgeschlossene Meldungen, zuletzt zur
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

45 Tests bestanden: 35 für Vertrag, Patch und isolierten Prüflauf, zehn vorhandene
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

## Echter manueller Prüflauf

Nach erneuter Prüfung war die bestehende n8n-Anmeldung verfügbar; eine neue
Anmeldung war nicht nötig. Der frisch exportierte Originalentwurf stimmte in
allen Feldern exakt mit dem gesicherten 515-Node-Export überein.

`n8n/build-inventory-draft-qa.cjs` erstellt daraus einen **privaten** Prüflauf mit
26 Nodes. Er verwendet die bestehenden n8n-Zugänge, einen manuellen Trigger und
den korrigierten Bestandszweig. Vor dem Commit bindet ein zusätzlicher Wächter
Kunde, Konto, Shop, Variante, Produkt, SKU und den bestätigten Bestand von vier
Stück. Andere Produkte oder Mengen brechen ab. Der zweite Claim verwendet im
selben Lauf dieselbe Lieferkennung und muss `duplicate` / `done` liefern.

Getrennte n8n-Arbeitskopie: **QA – Shopify Bestandsentwurf – PR81**,
ID `iVy7hpNBjDLxV1Ro`, gespeichert und nicht veröffentlicht. Der Prüflauf hat
keinen Webhook-/Zeittrigger und enthält keine Shopify-Mutation.

Der echte Lauf am **5. November 2026, 23:41:28 UTC** (6. November, 00:41 Uhr Wien)
lief vollständig erfolgreich durch:

- Bestehender Shopify-Zugang und beide Bestandsabfragen funktionieren.
- Supabase bestätigt `applied:true`, vier Stück und den serverseitigen
  Erfassungszeitpunkt `2026-11-05T23:41:28.149654Z`.
- Die nachgelagerte n8n-Spiegelung wurde bestätigt; `finish` setzt die Meldung
  um `23:41:28.668319Z` auf `done`.
- Der identische zweite Claim liefert `duplicate` / `done`; er schreibt den
  Bestand kein zweites Mal.
- Unabhängige SQL-Nachprüfung: 18 abgeschlossene Meldungen insgesamt,
  genau ein Versuch für die neue Meldung, Bestand vier, keine laufende Sperre.
- Rückexport: alle 26 Nodes, ausführbarer Code, HTTP-Parameter und Verbindungen
  entsprechen dem Prüfkandidaten. n8n entfernt lediglich implizite Code-Defaults
  und die leere Ausgangsliste des End-Nodes.

Der Dateiimport übernimmt in dieser n8n-Oberfläche **keine allgemeinen
Workflow-Einstellungen**. Diese wurden deshalb im getrennten QA-Workflow
anschließend gesetzt: Timeout 90 Sekunden, künftige manuelle/erfolgreiche/
fehlgeschlagene Ausführungsdaten nicht dauerhaft speichern. Der erste erfolgreiche
Lauf verwendete noch die n8n-Standardeinstellungen. Keine Rohdaten oder
Zugangskonfiguration werden ins Repository übernommen.

Für die Wiederholung nach Import stets zuerst die Workflow-Einstellungen
kontrollieren; die JSON-Angaben allein reichen dafür nicht aus.

![n8n-Abschluss mit vier Stück und erkanntem Doppelaufruf](evidence/shop-inventory-qa-pr81.jpg)

## Abbruch, Sperre und Wiederaufnahme

Der QA-Generator unterstützt ausdrücklich begrenzte Fehlerfälle:
`after_commit` bricht nach bestätigter Supabase-Übernahme vor der n8n-Spiegelung
ab; `timeout_read` setzt ausschließlich beim zweiten Shopify-Abruf das HTTP-Zeitlimit
auf eine Millisekunde. Ohne Fehlerfall bleiben alle HTTP-Zeitlimits bei 15 Sekunden.
Der Workflow-Timeout bleibt 90 Sekunden. Fehlerfälle benötigen eine eigene UUID
als `caseId`; ungültige Einstellungen werden zurückgewiesen.

Für denselben QA-Fall bleibt die interne Lieferkennung über neue Ausführungen
gleich. Die Wiederaufnahme startet **am manuellen Trigger**, nimmt eine neue
Sperre und liest Shopify neu. Sie setzt nicht bei einem alten Tabellen-Write fort.
Das ist eine manuell geprüfte Wiederaufnahme, keine neu eingebaute automatische
Fehlerbehebung im produktiven Workflow. Der Produktionspatch erhält keine
Fehlerschalter und keine feste QA-Kennung.

Echter Test am 6. November 2026 (alle folgenden Zeiten UTC):

| Prüffall | Beobachtung |
| --- | --- |
| Abbruch nach Commit, 00:03:01 | `QA_EXPECTED_AFTER_COMMIT`; n8n-Spiegelung und `finish` werden nicht ausgeführt. Journal `processing`, Versuch 1, Supabase `applied:true`, Bestand vier. |
| Sofortiger Neustart | `LEASE_NOT_ACQUIRED`; keine erneute Übernahme, kein weiterer Journalversuch. |
| Wiederaufnahme nach Sperrablauf, 00:05:22 | Derselbe Journaleintrag wird mit Versuch 2 abgeschlossen; neuer Erfassungszeitpunkt `00:05:22.334673Z`, passende Spiegelung, anschließend `duplicate` / `done`. |
| HTTP-Timeout, 00:07:11 | Zweiter Shopify-Abruf endet mit `ECONNABORTED`, `timeout of 1ms exceeded`. Journal ohne Commit-Ergebnis; Supabase-Erfassungszeit bleibt `00:05:22.334673Z`. |
| Wiederaufnahme nach HTTP-Timeout, 00:09:17 | Normaler HTTP-Timeout von 15 Sekunden wiederhergestellt; derselbe Vorgang endet nach frischer Lesung im zweiten Versuch erfolgreich, anschließend `duplicate` / `done`. |

Zwischenstände wurden über die n8n-Ausgabe und unabhängige SQL-Abfragen
kontrolliert. Es werden keine Sperren per SQL gelöscht oder künstlich vorzeitig
freigegeben. Beide Fehlerfälle beziehen sich ausschließlich auf SMA-TEST-002.

Abschlusskontrolle: beide Fälle `done`, jeweils `attempts:2`, insgesamt 20
abgeschlossene Meldungen und keine laufende Sperre. Supabase bestätigt weiterhin
vier Stück und `2026-11-06T00:09:16.805255Z` als letzten Erfassungszeitpunkt.
Die Fehlerauslösung und feste Fallkennung wurden danach ausgeschaltet; der
gespeicherte QA-Workflow verwendet wieder die normale Ausführungskennung und
15 Sekunden HTTP-Timeout. Ein frischer Rückexport bestätigt alle 26 Node-Parameter,
Zugangsreferenzen, Verbindungen und die gespeicherten Laufzeiteinstellungen gegen
den normalen QA-Generator. Der Workflow bleibt manuell und unveröffentlicht.

![Kontrollierter Abbruch vor der n8n-Spiegelung](evidence/shop-inventory-after-commit-pr81.jpg)

![Erfolgreicher Abschluss nach Zeitüberschreitung und Wiederaufnahme](evidence/shop-inventory-recovered-pr81.jpg)

## Noch offene Freigabegrenze

Supabase und n8n Data Tables sind keine gemeinsame Transaktion. Ein Ausfall nach
dem Commit kann eine vorübergehend abweichende Spiegelung hinterlassen. Ein
verspäteter externer Tabellenaufruf über das Sperrende hinaus ist durch die lokalen
Tests und die beiden kontrollierten Echtläufe nicht ausgeschlossen. Die geprüften
Abbrüche und Wiederaufnahmen sind abgeschlossen; ein unbekanntes Ergebnis darf
nicht durch blindes Wiederholen eines alten Tabellen-Writes repariert werden.
Eine neue vollständige Ausführung muss einen frischen Shopify-Wert lesen.
Die Sperre koordiniert diesen Zweig mit dem bestehenden Bestands-Webhook;
separate manuelle Bestandsaufträge werden durch diesen Patch nicht umgebaut.
Eine produktive automatische Wiederaufnahme mit dauerhaftem Auftragsbezug und
eine Absicherung verspäteter Data-Table-Antworten sind nicht Teil dieses QA-Schritts.

Der 524-Node-Kandidat enthält auch ältere, hier nicht abgenommene Änderungen des
Entwurfs. **Kein vollständiger Austausch des veröffentlichten 511-Node-Workflows.**
Eine spätere Veröffentlichung benötigt den dann frischen Export, den gezielten
Vergleich mit der veröffentlichten Version und die Abnahme des gesamten
übernommenen Bestandszweigs. Der erfolgreiche isolierte Lauf ist kein Nachweis
für eine produktive Veröffentlichung des gesamten Kundenworkflows.

Quellen: [Shopify-Mengen und Zustände](https://shopify.dev/docs/apps/build/inventory-management-apps/manage-quantities-states),
[InventoryLevel 2026-07](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/InventoryLevel),
[n8n-Code-Kontext](https://docs.n8n.io/build/code-in-n8n/use-built-in-shortcuts.md).
