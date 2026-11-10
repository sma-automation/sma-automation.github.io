# Shopify-Warenkorb: Preisprüfung auf exakte Cent

Stand: 10. November 2026 – isolierte, rückwärtskompatible Änderung im öffentlichen Checkout-Handler. Keine n8n-, Shopify-, Supabase-Datenbank- oder Zahlungsmodusänderung.

## Anlass

Das Live-Feld `public.sma_produkte.preis` ist PostgreSQL `numeric` ohne feste Skala. Der bislang eingesetzte Ausdruck `Math.round(Number(preis)*100)` konnte einen versehentlich gespeicherten Preis wie `39.999` stillschweigend in 40,00 EUR verwandeln. Ein angezeigter Preis mit Bruchteilen eines Cents darf keine Checkout-Freigabe erzeugen.

## Änderung

- Erlaubt sind nur nichtnegative, endliche dezimale Preise mit exakter Centauflösung. Beispiele: 39.9, `39.90`, `39.9000` und 0.01.
- Nachkommastellen jenseits des zweiten Dezimalplatzes müssen ausnahmslos null sein. 39.999, `10.005`, wissenschaftliche Notation, Booleans und Dezimalwerte außerhalb sicherer Ganzzahl-Cents werden abgelehnt.
- Der Warenkorb rechnet weiterhin vollständig in Integer-Cents, prüft sichere Summen, Produktbesitz, Bestand, Variante, Shop-Domain und die beiden Checkout-Freigaben. Shopify berechnet den Endpreis/Versand eigenständig.
- Fehler liefern 409 und **keine Checkout-URL**; es wird weder ein Kauf noch eine Bestellung erzeugt.

## Bestehende Daten und Grenzen

Rein lesende Supabase-Prüfung: Nur **ein** aktiver/verfügbarer Shopify-Artikel, Preis **39,90 EUR**, kein aktiver Artikel mit unzulässigen Nachkommastellen. Das historische Bestelljournal enthält zehn Bestellungen: sechs offizielle Shopify-Tests und vier als `test:false` klassifizierte ältere Einträge. Diese Klassifikation war bereits am 5. November dokumentiert und wird durch diese Änderung nicht berührt.

Der GitHub-Merge allein stellt keine Edge Function bereit. Die Änderung wurde am 10.11.2026 **separat und bewusst** mit dem verbundenen Supabase-Werkzeug als `sma-shop-checkout` Version 6 bereitgestellt und anschließend anhand der zurückgelesenen Quelltexte abgenommen. Die bestehenden Betreiberfreigaben und der Shopify-Zahlungsmodus wurden nicht geändert.

## Prüfungen

`tests/public-checkout.test.cjs` ergänzt Grenzfälle und mehrere Warenkorbpositionen; bestehende Repository- und GitHub-Actions-Tests laufen unverändert. Es wird nur ein isolierter GitHub-Branch vor der Zusammenführung geändert. Keine Kontenanmeldung oder n8n-Arbeitskopie benötigt.


## Produktivabnahme – 10. November 2026

- Supabase-Projekt: `bnvnmdxosbnuzedokqgh`; Funktion `sma-shop-checkout` **ACTIVE, Version 6**, `verify_jwt=false` wie zuvor. Diese Konfiguration ist für das bereits öffentlich nutzbare Checkout-Vorbereitungs-API vorgesehen und wurde nicht gelockert.
- Vorheriger **Version-5-Export** wurde gelesen: `index.ts` und `handler.ts` stimmten bytegenau mit dem GitHub-Stand vor PR #186 überein. Alte Preise wurden noch mit `Math.round(price * 100)` umgerechnet.
- Version 6 wurde ausschließlich aus `website-v1` / Merge `fc2fe97a13e2341054784bf4a676f09a67933a40` erstellt und mit beiden UTF-8-Dateien `index.ts` und `handler.ts` über die Supabase-Edge-Funktion-Schnittstelle bereitgestellt.
- **Rückleseprüfung nach Deployment:** Beide ausgelieferten Dateien stimmen bytegenau mit dem gerade getesteten GitHub-Stand überein. `exactCents` ist vorhanden; die alte Rundungsstelle fehlt. Der globale Checkout-Schalter, die eigenständige Händlerfreigabe, die erlaubten CORS-Ursprünge und `verify_jwt=false` sind unverändert.
- **GitHub-Actions-Abnahme für PR #186:** 716 Node-Tests erfolgreich, 0 fehlgeschlagen. Dashboard-Navigation und die vollständige Publication-History-Prüfung erfolgreich. Zusätzlich haben die bestehenden Musik-/Cover-SQL-Prüfungen bestanden.
- **Rein lesender Datenbankabgleich nach Deployment:** 10 unveränderte Shopify-Bestellungen (6 `ist_testbestellung=true`, 4 `false`), genau ein aktiver und bestandsführender Shopify-Artikel, keine aktiven Artikel mit fehlerhafter Centauflösung und 0 Social-Media-Uploadfreigaben.
- Kein Checkout wurde gestartet, kein externer Shopify-Link aufgerufen, keine Bestellung ausgelöst, kein Bestand geändert, keine Zahlung vorgenommen. Es wurde auch kein n8n-Workflow verändert.

### Verbleibende Grenzen

Die Bestätigung `ACTIVE` und der exakte Quellcodevergleich belegen den ausgerollten Funktionsstand. **Ein tatsächlicher neuer Shopify-Kassiervorgang wurde nicht durchgeführt.** Ein späterer autorisierter End-to-End-Test muss die jeweils aktuellen Zahlungsmethoden und den Testmodus beim Händler separat kontrollieren. Das Vorbereitungs-API erzeugt lediglich den Shopify-Warenkorb-Link und keine Zahlung.

### Sofortiger Rückbau

Bei einem unerwarteten Laufzeitproblem die zuvor gesicherte Version-5-Funktion mit dem ursprünglichen `index.ts` und `handler.ts` aus Commit `1bff58c1b894bdca5b83d8e941b21087b928bc8c` erneut bereitstellen; `verify_jwt=false`, Dateinamen, Entry-Point und Release-/Händlerfreigaben beibehalten. **Keine** Tabelle zurücksetzen und keine Kundenbestellung löschen.
