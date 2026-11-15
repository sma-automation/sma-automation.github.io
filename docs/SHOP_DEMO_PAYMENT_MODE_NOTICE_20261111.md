# SMA – Hinweis zum Zahlungs-Testmodus im Demo-Shop

Stand: 11. November 2026.

## Hintergrund

SMA-Demofreischaltung (`demo_delta_aktiv`) und der **Shopify-Payments-Testmodus**
sind zwei unterschiedliche Einstellungen. Die SMA-Funktion
`sma-shop-checkout` ist aktiv und erzeugt nach geschützter Prüfung
Shopify-Warenkorb-Links. Das Feld `modus: shopify_live` bedeutet
**Weiterleitung zur regulären Shopify-Kasse**, nicht automatisch
eine Echtgeld- oder Testzahlung.

Die Betreiberfreigabe und die am 5. November nachgewiesene
Shopify-Testbestellung sind in `docs/SHOP_CHECKOUT_RELEASE.md` und
`docs/SHOP_ORDER_TEST_MODE.md` dokumentiert. Der **heutige**
Zahlungsmodus lässt sich mit den vorhandenen SMA-Schnittstellen
nicht erneut verifizieren. Aus vergangenem Teststatus wird deshalb
keine aktuelle Aussage abgeleitet.

## Änderung im Händler-Dashboard

Nur für ein Kundenkonto mit `demo_delta_aktiv=true` erscheint in
**Shop** ein kompakter, rein informativer Satz:
> SMA-Demo ist aktiv. Ob Shopify Payments aktuell im Testmodus ist,
> kann SMA nicht automatisch prüfen. Vor einem Testkauf bitte im
> Shopify-Admin kontrollieren.

Der Hinweis liegt in derselben kurzen Shop-Ansicht oberhalb der
vorhandenen Produkt-/Bestellreiter-Inhalte. Er erzeugt weder ein
neues Kapitel noch eine Bestellaktion. Bezahlte Kunden ohne Demo
sehen ihn nicht.

Die Anzeige nutzt ausschließlich das bereits abgerufene
`sma_kunden.demo_delta_aktiv`. Sie liest keine Zahlungsdaten,
fragt keine weiteren Konten ab und verändert weder Checkout
noch Bestand, Bestellstatus, Paketrechte oder Shopify-Einstellungen.

## Lesender Abgleich (11. November)

Das angeschlossene Testprodukt `SMA-TEST-002` stimmt in SMA und Shopify
bei Preis (39,90 EUR), Bestand (4) und Variantenzuordnung überein.
Sein SMA-Konto ist ein Demo-Konto, dessen Paket-Zahlung nicht
bestätigt ist. Dieser Abgleich prüft **nicht** den aktuellen
Shopify-Payments-Testmodus und löst **keinen** Warenkorb oder Kauf aus.

## Abnahme

`tests/shop-demo-payment-notice.test.cjs` prüft Text,
Sichtbarkeitsbedingungen, bereits vorhandene Datenbindung und
das Fehlen eines zusätzlichen Checkout-/Netzwerkwegs.
Die vorhandenen Checkout- und Shop-Regressionen bleiben unverändert.
