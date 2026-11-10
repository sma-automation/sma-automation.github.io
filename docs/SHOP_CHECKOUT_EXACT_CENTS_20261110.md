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

Die Funktion `sma-shop-checkout` wird durch den GitHub-Merge **nicht** automatisch in Supabase bereitgestellt. Eine spätere Deployment-Prüfung muss den ausgelieferten Funktionsstand gesondert belegen. Bestehende Betreiberfreigaben und der Shopify-Testmodus werden unverändert belassen.

## Prüfungen

`tests/public-checkout.test.cjs` ergänzt Grenzfälle und mehrere Warenkorbpositionen; bestehende Repository- und GitHub-Actions-Tests laufen unverändert. Es wird nur ein isolierter GitHub-Branch vor der Zusammenführung geändert. Keine Kontenanmeldung oder n8n-Arbeitskopie benötigt.
