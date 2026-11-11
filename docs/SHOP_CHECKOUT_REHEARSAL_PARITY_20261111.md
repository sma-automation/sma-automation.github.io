# SMA – Interner Checkout-Test: gleiche Cent- und Variantenregeln wie die öffentliche Kasse

Stand: **11. November 2026**, sicherer Testweg vor der Kernabnahme am 1. Dezember.

## Bestätigte Abweichung

Die öffentliche Edge Function `sma-shop-checkout` benutzt seit Version 6 den
strengen Parser `exactCents`: Preise mit Bruchteilen eines Cents werden
abgelehnt, statt unbemerkt auf Cent gerundet zu werden.

Der davon getrennte, angemeldete und **rein lesende** Testweg
`sma-shop-checkout-test` verwendete bisher noch `Math.round(price*100)`.
Er ließ außerdem gespeicherte Cart-URLs mit ungültiger Variantenziffer
oder angehängter Mengenangabe `:0` durch. Der Test konnte dadurch einen
technisch inkorrekten Warenkorb als erfolgreich melden, obwohl die öffentliche
Kasse dieselben Angaben sperrt.

## Korrektur

- Der Test-Handler nutzt exakt denselben `exactCents`-Algorithmus wie der
  öffentliche Checkout; auch nachgestellte Nullstellen in numerischen
  Datenbankwerten (z. B. `12.3000`) bleiben korrekt zulässig.
- Die gespeicherte Shopify-Variantenzuordnung ist wie im Live-Handler nur mit
  positiver Variante und positiver URL-Menge gültig; fremde Hosts, URL-Anhänge
  und andere Sicherheitsregeln bleiben gesperrt.
- Ein noch nicht freigegebener Händler darf weiterhin den rein technischen
  Warenkorbtest durchführen. Die Serverantwort benennt aber ausdrücklich,
  dass die **öffentliche Händlerfreigabe fehlt**. Das Dashboard zeigt dafür
  keinen grünen Erfolgsstatus. Ein freigegebener Händler behält die bisherige
  Erfolgsanzeige.
- Regressionstests decken ungültige Preise, mehrere Positionen, gültige
  Centbeträge, Varianten-Nullen und deaktivierte Händlerkonten ab.

## Betriebsgrenze

**Keine Zahlungs- oder Bestelltransaktion:** Der interne Test liefert immer
`modus: dry_run`, `checkout_url: null` und `zahlung_ausgeloest: false`.
Er nutzt weiterhin den angemeldeten Nutzerkontext, greift nur lesend auf
die zugeordneten SMA-Daten zu und führt keine neue Shopify-Abfrage aus.
Die öffentliche Checkout-Funktion, ihre Betreiber-/Händlerfreigaben,
Produktpreise, Bestände, Kundenpakete und n8n-Workflows bleiben unverändert.

Der verbundene Shopify-Admin-GraphQL-Zugang bestätigt für den SMA-Testshop
die allgemeine Checkout-Unterstützung, **nicht** aber den aktuellen Status
von Shopify Payments im Testmodus. `shopifyPaymentsAccount` ist ohne die
erforderlichen `read_shopify_payments`- bzw.
`read_shopify_payments_accounts`-Scopes nicht lesbar. Vergangene
Bestellungen mit `test:true` beweisen den heutigen Modus nicht.

**Vor einem weiteren Zahlungs-E2E** die Einstellung rein visuell in Shopify
unter **Einstellungen → Zahlungen → Shopify Payments → Verwalten → Testmodus**
prüfen. Es wird kein Testkauf, keine Tarifänderung und keine neue
Berechtigung automatisch ausgeführt.

## Technische Abnahme

- `tests/checkout-rehearsal.test.cjs`: Handler-, Eigentümer- und
  Sicherheitsprüfungen, einschließlich neuer Preis-/Variantenregeln.
- `tests/checkout-page.test.cjs`: kein grünes Freigabesignal für Händler
  ohne öffentliche Shopberechtigung.
- `tests/public-checkout.test.cjs`: unveränderte Referenzregeln
  der öffentlichen Kasse.

Ein GitHub-Merge aktualisiert **nicht** von selbst die Supabase-Edge-Funktion.
Bei einer getrennt kontrollierten Bereitstellung ist ausschließlich
`sma-shop-checkout-test` mit weiterhin `verify_jwt=true` zu aktualisieren.
Die produktive Funktion `sma-shop-checkout` darf nicht dabei ersetzt werden.
