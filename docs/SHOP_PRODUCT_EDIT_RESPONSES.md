# Produktbearbeitung: bestätigte Speicherung und klare Antworten

Stand: 6. November 2026. **74 automatisierte Tests bestanden. Der neue private
534-Node-Kandidat ist nicht importiert oder veröffentlicht. Der echte äußere
HTTP-/Anmeldedurchlauf bleibt offen.**

## Behobene Lücke im Kandidaten

Nach der bestätigten Data-Table-Bearbeitung liefen die Supabase-Spiegelung und
die Erfolgsmeldung bisher vom selben Ausgang ab. Die Erfolgsmeldung war dadurch
nicht ausdrücklich von einer geprüften Supabase-Rückgabe abhängig. Die neuen
Bestands-/Versionskonflikte hätten außerdem nur den allgemeinen n8n-Fehler
ausgelöst.

`n8n/patch-inventory-edit-responses.cjs` wird nach dem bisherigen
[Bestandsschutz der Schreibwege](SHOP_INVENTORY_WRITERS.md) angewendet:

- Bekannte Eingabefehler und Konflikte erhalten gezielte Antworten. Unerwartete
  Identitäts-, Konfigurations- und Programmfehler werden nicht als Erfolg behandelt.
- Vor dem ersten Write wird die vorhandene Supabase-Kundenzuordnung über denselben
  Zugang gelesen. Genau eine Zuordnung muss zur authentifizierten n8n-Kundenkennung
  passen. Das berücksichtigt die bestehenden unterschiedlichen Kundenkennungen
  in n8n und Supabase, ohne Rechte oder Datenbankfunktionen zu ändern.
- Die Data-Table-Bearbeitung behält ihre vier gemeinsamen Identitäts-/Versionsfilter.
  Erst eine bestätigte neue Zeilenversion erreicht die Supabase-Spiegelung.
- Shopify-Metadaten senden **kein Bestandsfeld** an Supabase. Dadurch können sie
  auch dann keinen alten Bestand zurückschreiben, wenn inzwischen ein neuer
  kanonischer Bestand vorliegt. Für reine SMA-Produkte bleibt das Bestandsfeld erhalten.
- Erfolg folgt ausschließlich nach einer einzelnen, passenden Supabase-Rückgabe:
  Kundenkennung, Benutzerkennung, Produktkennung und alle gesendeten Metadaten
  müssen stimmen. Ein SMA-Bestand muss ebenfalls passen. Ein neuerer bestätigter
  Shopify-Bestand darf von der zuvor gelesenen n8n-Menge abweichen.
- Leere, widersprüchliche oder fehlgeschlagene Supabase-Rückgaben führen zu einer
  festen Fehlermeldung ohne Providerdetails. Beide HTTP-Nodes haben 15 Sekunden
  Timeout und keine automatischen Wiederholungen.

| Fall | HTTP-Antwort |
| --- | --- |
| Kein freigeschalteter Kundenzugang | Bestehende 403-Antwort unverändert |
| Produkt nicht im Kundenbestand gefunden | Bestehende 404-Antwort unverändert |
| Ungültige Bestandsmenge | 400, `PRODUCT_EDIT_STOCK_INVALID` |
| Shopify-Bestand direkt in der Produktbearbeitung ändern | 409, `SHOPIFY_STOCK_USE_STOCK_ORDER` |
| Produktzeile wurde inzwischen geändert | 409, `PRODUCT_EDIT_CONFLICT_RELOAD_REQUIRED` |
| Supabase-Spiegelung fehlt oder ist nicht bestätigt | 502, `PRODUCT_EDIT_MIRROR_NOT_CONFIRMED`, neu laden und gespeicherten Stand prüfen |
| Beide Speicherschritte bestätigt | Bestehende 200-Erfolgsmeldung |

Eine 502-Antwort bedeutet keinen Rollback: Der Data-Table-Schritt kann bereits
gespeichert sein. Es gibt weiterhin keine verteilte Transaktion oder automatische
Reparaturschleife. Der Kunde muss frisch lesen, bevor er erneut bearbeitet.

## Umfang und Nachweise

Der neue Kandidat hat **534 Nodes**: drei Nodes des bisherigen 527-Node-Kandidaten
werden geändert und sieben ergänzt. Gegenüber der veröffentlichten 511-Node-Basis
bleiben 506 Nodes vollständig unverändert; insgesamt werden fünf bestehende Nodes
geändert und 23 ergänzt. Authentifizierung, Paketprüfung, bisherige 403-/404-/200-
Antworten, vorhandene Zugangsreferenzen und Workflow-Einstellungen bleiben erhalten.
Der separate 42-Node-Bestands-Webhook und die geprüfte 57-Node-QA-Kopie sind unverändert.

Der [bereinigte Abgleichbericht](evidence/shop-product-edit-responses-pr81.json)
enthält die betroffenen Namen und Quellenprüfsummen. Private Gesamtexporte gehören
nicht ins Repository. Parameter, Typversionen, Ausführungsoptionen und Verbindungen
werden vor der Transformation gegen den erwarteten Stand geprüft; abweichende,
deaktivierte, doppelte oder gepinnte Quellen werden zurückgewiesen.

```sh
node n8n/patch-inventory-edit-responses.cjs \
  WRITERS_PRIVATE.json NEW_RESPONSES_PRIVATE.json

node --test tests/inventory-edit-responses.test.cjs \
  tests/inventory-writers.test.cjs tests/inventory-draft.test.cjs \
  tests/inventory-integration.test.cjs tests/shop-stock.test.cjs
git diff --check
```

**74 Tests bestanden.** Elf zusätzliche Tests führen die erzeugten Code-Nodes,
Ausdrücke und tatsächlichen Verbindungen mit simulierten Data-Table-/HTTP-Antworten
aus. Sie prüfen Zugangssperren, Produktabgrenzung, 400-/409-Antworten vor Writes,
Kundenzuordnung, beide Speicherbestätigungen, neueren Shopify-Bestand sowie leere,
fehlerhafte und fremde Supabase-Rückgaben. Das ist kein echter HTTP-Ende-zu-Ende-Test.

## Offener Live-Test

Die sichere n8n-Anmeldung wurde übermittelt. Die Zielseite kehrte mit
`sessionExpired=true` zur Anmeldung zurück; auch ein frischer Tab auf der
n8n-Zieladresse zeigte die Anmeldung. Daher gab es in dieser Sitzung keinen
Import, keine neue n8n-Ausführung und keine Veröffentlichung. Der bereits
dokumentierte 57-Node-Echtlauf bleibt gültig für seinen damaligen Umfang.

Sobald die n8n-Sitzung wieder nutzbar ist:

1. Aktive und erhaltene Entwurfsversionen frisch exportieren und abgleichen.
2. Den isolierten äußeren Test-Einstieg mit bestehender Kundenauthentifizierung
   auf `kunde_3182` und `SMA-TEST-002` begrenzen; Ausführungsdaten nicht speichern.
3. Ungültigen Zugang, fremdes/unbekanntes Produkt, abgewiesene Mengenänderung und
   mengenunveränderte Bearbeitung über HTTP prüfen. Antworten und beide Speicher
   unabhängig kontrollieren. Keine Shopify-Mutation, Bestellung oder Veröffentlichung.
4. Erst nach diesem Nachweis den integrierten Kundenworkflow und Bestands-Webhook
   zur Übernahme bereitstellen. Der geschützte 515-Node-Originalentwurf bleibt erhalten.

Der vorhandene Shop-Manager liest über Supabase und nutzt Bestandsaufträge. Er
ruft diesen älteren n8n-Produktbearbeitungsendpunkt derzeit nicht auf; dieser
Prüfstand ist daher auch keine neue Dashboard-UI-Abnahme.

Technische Referenzen: [n8n Respond to Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook)
und [n8n Node-Einstellungen](https://docs.n8n.io/build/understand-workflows/workflow-components/work-with-nodes.md).
