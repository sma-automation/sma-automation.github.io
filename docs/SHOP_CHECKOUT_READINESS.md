# SMA – Öffentlichen Shop vor Kundenübergabe prüfen

Stand: 18.11.2026. **Nur-Lesen-Prüfung für Betreiber**, keine Freigabe für Kauf, Zahlung oder Bestandänderung.

## Aufruf

Die Datei [`supabase/sql/shop-checkout-readiness-readonly.sql`](../supabase/sql/shop-checkout-readiness-readonly.sql)
als **einen SELECT** im privaten Supabase-SQL-Editor ausführen. Nicht als öffentliches RPC,
Edge Function oder Dashboard-Abfrage bereitstellen. Kein Kundenkonto auswählen,
kein Shop-Token angeben und keine n8n-Execution starten.

Die Ausgabe enthält nur aggregierte Zahlen und feste Zustandskennungen. Sie liest die
bestehenden Tabellen `sma_kunden`, `sma_shopify_konten` und `sma_produkte`
und verändert weder sie noch Shopify.

## Was der Check belegt

- Berechtigte öffentlich geschaltete SMA-Shops (aktiv und bezahlt oder Demo)
  mit syntaktisch gültiger, eindeutiger öffentlicher Shop-Kennung. Eine zweite
  gleichnamige öffentliche Shopzeile ist ein Problem für die Lese-API.
- Genau ein aktives Shopify-Konto pro Shop und plausible Shop-Domain.
- Für aktive Shopify-Produkte: UUID, zum Konto passende `https://*.myshopify.com/cart/VARIANTE:MENGE`-Adresse,
  eindeutige Variante, vollständiger Preis in ganzen Cent, dreistellige Währung,
  positiv gespeicherter Bestand im sicheren Ganzzahlbereich.
- Produkte ohne diese Voraussetzungen werden nicht als lokal kaufbereit gezählt.
  Nullbestand ist ein zulässiger, klar ausgewiesener Grund für Nichtverfügbarkeit.
- Die Regeln folgen dem vorhandenen serverseitigen Checkout-Handler
  [`supabase/functions/sma-shop-checkout/handler.ts`](../supabase/functions/sma-shop-checkout/handler.ts).
  Der SQL-Abgleich ist bewusst konservativ, aber kein vollständiger Aufruf dieses Handlers.

`SOME_PRODUCTS_HAVE_VALID_LOCAL_CHECKOUT_METADATA_NOT_E2E` bedeutet lediglich,
dass lokal mindestens ein Produkt die geprüften Bedingungen erfüllt.
`NO_VALID_LOCAL_CHECKOUT_PRODUCT` benötigt Daten-/Kontoprüfung.
`NO_PUBLIC_ELIGIBLE_SHOP` bedeutet, dass kein dafür berechtigtes öffentliches Shopkonto existiert.

## Was ausdrücklich offen bleibt

**Der SQL-Bericht aktiviert keine Kasse und beweist keinen erfolgreichen Checkout.**
Die Felder `shopify_payment_or_stock_e2e` und `live_checkout_release` bleiben
`NOT_VERIFIED_BY_THIS_QUERY`; `allows_new_checkout` bleibt `false`.

Eine echte Shop-Abnahme umfasst separat:

1. Den produktiven Stand des öffentlichen Leseendpunkts `sma-shop-produkte`
   sowie des Checkout-Handlers `sma-shop-checkout` gegen den freigegebenen
   GitHub-Code abgleichen (inklusive `verify_jwt`-/Origin-Regeln).
2. Die beiden getrennten Veröffentlichungsschalter im öffentlichen
   `app/shop.html` (`CHECKOUT_PUBLIC_ENABLED`) und im Checkout-Edge-
   Einstieg (`CHECKOUT_RELEASE_ENABLED`) bewusst kontrollieren.
   **Nicht** aufgrund eines grünen SQL-Berichts automatisch umstellen.
3. Die tatsächliche Shopify-Bestandslage, Produktvariante und das Händlerkonto
   bestätigen; SMA-Datenbankbestände sind keine unabhängige Shopify-Lesebestätigung.
4. Einen ausgewählten, ausdrücklich genehmigten **Testkauf** mit dem vorgesehenen
   Shopify-Testverfahren durchgehen; ohne Genehmigung nur lesende Kontrollen.
   Keine echte Zahlung oder Testbestellung durch diese SQL-Prüfung auslösen.
5. Shopify → SMA Bestellwebhook → korrekte Testkennzeichnung → Bestandsanzeige
   → Wiederholung/Deduplizierung dokumentieren; keine Live-Daten mutieren,
   wenn ausschließlich der Codevergleich freigegeben wurde.

Zum Gesamtstart gehören außerdem die **aktiv veröffentlichte n8n-Zahlungsstrecke**
und ein tatsächlich erreichbarer Kundenordner bei Google Drive. Für beide existieren
gesonderte Prüfer. Ein positives Shop-Ergebnis darf deren Nachweise niemals ersetzen.

## Für die externe Technikübergabe

Die Fachperson erhält die Commit-ID, Supabase-Edge-Versionsnummern,
das zeitlich datierte **aggregierte** SQL-Ergebnis und gesonderte
Kunden-/Shopify-/n8n-/Drive-E2E-Nachweise. Zugangsdaten und Exportdateien mit
Kundendaten ausschließlich sicher, nicht in GitHub, Chat oder CI veröffentlichen.
Vor der Servermigration alte und neue Webhook-Ziele, DNS-/Callback-Adressen,
Rückfallpfad und eine Wiederherstellungsprobe festhalten.

Ein einmalig grünes Ergebnis ist keine dauerhafte Freigabe: Vor dem ersten
Kundenstart und nach jeder Bestands-, Konto- oder Domainumstellung erneut lesen.
