# SMA-Warenkorb an Shopify anbinden

Stand: 5. November 2026.

Der öffentliche SMA-Warenkorb kann nach der serverseitigen Prüfung zur Shopify-Kasse
des zugeordneten Händlers wechseln. Der Betreiber hat die Einrichtung ohne zusätzliche
Buchungen freigegeben und Shopify Payments ausdrücklich auf Testmodus gestellt.
Es wird kein Tarif, Zusatzdienst oder Zahlungsanbieter neu gebucht.

## Freigabe

- `app/shop.html`: bestehender Checkout-Schalter eingeschaltet.
- `sma-shop-checkout/index.ts`: globale Freigabe als versionierter Betriebsschalter
  `CHECKOUT_RELEASE_ENABLED`. Dieser ersetzt die bisherige Umgebungsvariable
  `SMA_CHECKOUT_LIVE_ENABLED`; ein Deployment enthält dadurch den vollständigen
  reproduzierbaren Freigabestand. Die Umgebungsvariable wird nicht mehr ausgewertet.
- Unabhängig davon bleibt `sma_shopify_konten.aktiv` zwingend. Nur die vorhandene
  Zuordnung für `sma-testkunde` / `6r0d8z-cd.myshopify.com` wird freigegeben.
- Besitzer, aktiver Kundenstatus, öffentlich sichtbarer Shop, Produkte, Varianten,
  Bestand, Preise, Währung und exaktes Shopify-Ziel werden weiterhin serverseitig
  geprüft. Ein Request oder URL-Parameter kann die Freigaben nicht ersetzen.

Shopify verwaltet den Zahlungsmodus. SMA setzt diesen nicht und kann ihn mit den
vorhandenen API-Berechtigungen nicht auslesen. `modus: shopify_live` im bestehenden
Antwortformat bezeichnet die Weiterleitung zur echten Shopify-Kasse, nicht den
Test-/Echtgeldstatus des dortigen Zahlungsanbieters. Das Erzeugen eines Links und
das Öffnen der Kasse erzeugen keine bezahlte Bestellung.

Die vorhandenen Bestellrückmeldungen und der automatische Bestellabgleich bleiben
unverändert. Eine Weiterleitung ist kein Nachweis für einen abgeschlossenen Kauf.
Vor echten Verkäufen sind insbesondere die vorhandenen Testprodukte und die
Händlereinstellungen separat zu prüfen. Eine spätere Testmodus-Abschaltung bei
Shopify ist keine automatische Folge dieser Änderung.

## Prüfung

58 vorhandene Tests für öffentlichen Checkout, internen Warenkorbtest, Warenkorb,
Bestände und Bestellanzeige bestanden vor der Freigabe. Der UI-Test kann den
Freigabeschalter weiterhin in beiden Zuständen prüfen, unabhängig vom ausgelieferten
Standard. Die fachlichen Prüfungen im Checkout-Handler werden nicht verändert.

Der Abgleich vor dem Testkauf bestätigte den Preis 39,90 EUR und sechs verfügbare Stück
für SMA-TEST-002. Der negative Bestand des älteren SMA-TEST-001 wird im SMA-Katalog
als nicht verfügbar behandelt. Der letzte Bestellabgleich war erfolgreich mit neun
unveränderten Bestellungen und ohne Konflikte.

## Vollständiger Testkauf und Bestellanzeige

Bestellung **#1010** wurde am 5. November 2026 um 21:55:09 UTC über die
Shopify-Kasse abgeschlossen: zwei Stück SMA-TEST-002 (79,80 EUR) zuzüglich
5,99 EUR Versand, insgesamt **85,79 EUR**. Die Admin API bestätigt `test: true`
und `PAID`; es war keine echte Zahlung. Der Betreiber hat den Testabschluss
selbst ausgeführt. Der Testmodus bleibt eingeschaltet.

Die Bestellung erreichte `sma_bestellungen` um 21:55:15.826713 UTC und war nach
rund sieben Sekunden vollständig übernommen. Der Bestand sank von sechs auf
vier Stück; Shopify, SMA und der öffentliche Katalog stimmen überein. Der
anschließende Screenshot aus dem angemeldeten SMA-Dashboard bestätigt #1010,
85,79 EUR sowie „Bezahlt“ und „Noch nicht versendet“. Damit ist auch die
Sichtprüfung abgeschlossen; eine erneute Anmeldung ist dafür nicht nötig.

Der automatische Abgleich vom 5. November 2026, 22:07:05 UTC, bestätigt zehn
unveränderte Bestellungen ohne Konflikte. Der anschließende lesende Vergleich
aller zehn Bestellungen bestätigt identische
Zahlungs- und Versandstatus in Shopify und SMA. Darunter ist die bereits erfüllte
Bestellung #1006. Es wurde keine zusätzliche Bestellung, Erstattung oder
Versandaktion ausgelöst. Erstattungen und spätere Statusänderungen werden durch
die vorhandenen Tests für Bestellanzeige, Quellzeitstempel und Abgleich abgedeckt;
eine echte Erstattung wurde in diesem Durchlauf nicht ausgeführt.

Die deutsche Versandstatus-Anzeige deckt nun auch `FULFILLMENT_NOT_REQUIRED`,
`OPEN`, `PENDING_FULFILLMENT` und `REQUEST_DECLINED` ab, die der Abgleich bereits
akzeptiert. Vorher erschienen diese vier Werte als „Lieferstatus unbekannt“.
Unbekannte zukünftige Werte bleiben ausdrücklich unbekannt. Datenübernahme,
Shopify-Zugriffe und Zahlungsmodus werden durch diese Anzeigekorrektur nicht geändert.

Alle 33 vorhandenen JavaScript-Prüfungen für Bestellanzeige und Bestellabgleich
bestanden nach der Korrektur; `git diff --check` war ebenfalls fehlerfrei.

Referenz für die Statusbedeutung:
https://shopify.dev/docs/api/admin-graphql/2026-07/enums/OrderDisplayFulfillmentStatus

## Rückbau

Für den einzelnen Shop `sma_shopify_konten.aktiv=false` setzen. Für alle Shops
`CHECKOUT_RELEASE_ENABLED=false` setzen und `sma-shop-checkout` erneut bereitstellen.
Bei Bedarf zusätzlich den UI-Schalter deaktivieren. Bereits geöffnete Shopify-Kassen
werden dadurch nicht widerrufen. Produkte, Bestellungen und Lagerbestände werden
dabei nicht verändert.
