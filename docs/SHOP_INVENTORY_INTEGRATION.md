# Gezielte Übernahme des Bestandszweigs

Stand: 6. November 2026. **Abgleich abgeschlossen, privater Kandidat erstellt;
noch kein Import und keine Veröffentlichung des integrierten Kundenworkflows.**

Der anschließende [gemeinsame Bestandsschutz](SHOP_INVENTORY_WRITERS.md) erweitert
diesen Basiskandidaten auf 527 Nodes und ergänzt den separaten Bestands-Webhook.
63 Tests und der gemeinsame echte Prüflauf bestehen; die vollständige
Kundenablauf-Abnahme und produktive Übernahme stehen noch aus.

Die anschließende [Antwortprüfung der Produktbearbeitung](SHOP_PRODUCT_EDIT_RESPONSES.md)
führt zum privaten 534-Node-Kandidaten mit 74 automatisierten Tests. Der äußere
Live-Durchlauf ist weiterhin offen; die Anmeldung an n8n blieb zuletzt nicht bestehen.

## Frische Ausgangsversionen

Die n8n-Versionshistorie bestätigt weiterhin:

- Veröffentlicht: `68d295c6-c07f-4fdc-8395-528d4a92b3d6`, **511 Nodes**,
  „Bestellungen – Shopify-Teststatus V1“.
- Erhaltener Entwurf: `5927ba8a-b235-42cc-b13f-abf800a3e146`, **515 Nodes**.

Beide Fassungen wurden erneut aus der Historie heruntergeladen. Nodes,
Verbindungen und Einstellungen entsprechen den gesicherten Ausgangsfassungen.
Ein Historienexport enthält neben den ausgewählten Nodes im obersten
`versionId`-Feld die Kennung des aktuellen Entwurfs. Der neue Generator prüft
deshalb die aktive Versionskennung **und** deren Nodes/Verbindungen gegeneinander,
bevor er die veröffentlichte Basis auswählt. Serverseitige Historien-, Konto- und
Berechtigungsmetadaten werden nicht in die Importdatei übernommen.

## Tatsächlicher Änderungsumfang

`n8n/prepare-inventory-integration.cjs` erzeugt den Kandidaten aus der frisch
veröffentlichten Fassung und übernimmt gezielt den bereits geprüften Bestandszweig.
Das Skript arbeitet ausschließlich lokal.

| Bereich | Änderung im Kandidaten |
| --- | --- |
| Bestand | 13 Nodes aus dem korrigierten Entwurf ergänzt; Ergebnis: 524 Nodes. |
| Vorhandene Nodes | 510 von 511 vollständig unverändert. |
| `SMA – Supabase – Produkt spiegeln` | Nur das Feld `bestand` aus dem allgemeinen Produkt-Upsert entfernt. Alle übrigen Parameter und Zugangskonfigurationen bleiben gleich. |
| `SMA – Produkt – Shopify Sync – Externe Produkt-ID vorhanden?` | Bestandszweig am vorhandenen „Produkt existiert“-Ausgang ergänzt. Aktualisieren-/Erstellen-Pfade bleiben erhalten. |
| Shopify-Produktmutation | Bleibt exakt auf dem veröffentlichten Stand; die zusätzliche Inventar-Rückgabe des alten Entwurfs wird nicht benötigt und nicht übernommen. |
| Bestell-Nodes | Testkennzeichnung und Positionen der veröffentlichten Fassung bleiben unverändert. |

Die allgemeine Produktspiegelung sendete bisher den Bestand aus der am Anfang
gelesenen n8n-Produktzeile mit. Dieser Wert gehört nicht in die parallele
Metadatenaktualisierung. Das Weglassen dieses einzelnen Feldes ist bereits im
erhaltenen Entwurf vorgesehen und wird gezielt übernommen.

Die bestehende Datenbank enthält außerdem bereits
`sma_shopify_stock_owner_guard_v1`: Ein bestätigter Shopify-Bestand wird gegen
ältere Bestandswerte ohne neueren Erfassungszeitpunkt geschützt. Dieser Trigger
wurde nur gelesen, nicht geändert. Der Spaltenstandard für neue Datensätze ist
weiterhin null verfügbare Stück (`0`). Es gibt keine Migration oder neue Rechte.

## Nachweis und Reproduktion

Der bereinigte [Abgleichbericht](evidence/shop-inventory-integration-pr81.json)
enthält Versionskennungen, Prüfsummen, die ergänzten Node-Namen und den exakten
Änderungsumfang. Private Gesamtexporte und Kandidatendateien enthalten
Zugangskonfiguration und gehören nicht ins Repository.

```sh
node n8n/prepare-inventory-integration.cjs \
  PUBLISHED_PRIVATE.json DRAFT_PRIVATE.json \
  NEW_INTEGRATION_PRIVATE.json NEW_SUMMARY.json
node --test tests/inventory-integration.test.cjs tests/inventory-draft.test.cjs tests/shop-stock.test.cjs
git diff --check
```

**53 Tests bestanden.** Die zusätzlichen Integrationstests prüfen die Auswahl
der tatsächlichen veröffentlichten Version, unveränderte bestehende Nodes,
unveränderte Zugänge/Einstellungen, unveränderte Produktmutationen, den gezielten
Verbindungswechsel und den Abbruch bei abweichenden Abhängigkeiten oder
unerwarteten Feldern. Gepinnte Daten, doppelte Node-IDs und bereits übernommene
Bestandszweige werden zurückgewiesen.

Der erzeugte Kandidat wurde außerdem gegen den vollständigen privaten Export
geprüft. Er enthält keine QA-Fehlerschalter, keine festen QA-Fallkennungen und
keine zusätzlichen Produktmutationen. Die bisherigen echten Normallauf-,
Abbruch-, Sperr- und Wiederaufnahmenachweise stehen in
[SHOP_INVENTORY_DRAFT.md](SHOP_INVENTORY_DRAFT.md).

## Verbleibender Schritt

Die gezielte Kandidatenerstellung enthält jetzt auch den `updatedAt`-Vergleich
im Tabellen-Update. Der echte 30-Node-Prüflauf weist einen erneut gesendeten
alten Write ab; ein frischer Abruf bestätigt unveränderte Zeilenversion und
Bestand. Eine leere Antwort endet ausdrücklich als Konflikt und erreicht
keinen Journalabschluss.

Vor produktiver Übernahme bleiben der frische Abgleich und die gemeinsame
Absicherung der weiteren Bestands-Writer (separater Bestands-Webhook,
Produktbearbeitung, Initialimport) sowie die Abnahme des integrierten
Kundenablaufs offen. Die neue Bedingung schützt den ergänzten Zweig; sie ist
noch kein Nachweis für alle parallelen Schreibwege. Die manuell geprüfte
Wiederaufnahme ist keine automatische Reparaturfunktion.
Die aktive Fassung und der separate Originalentwurf bleiben erhalten;
Shopify Payments bleibt im Testmodus.

Referenz zur bestehenden Upsert-Schnittstelle:
[PostgREST Tables and Views](https://docs.postgrest.org/en/stable/references/api/tables_views.html).
