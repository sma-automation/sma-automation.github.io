# Produktliste für bestehende Kundenwebseiten

Stand: 4. November 2026. Ziel `website-v1`.

Der bisherige Shop-Button führt Besucher zum öffentlichen SMA-Shop. Die neue Produktliste zeigt dessen Produkte zusätzlich direkt auf einer bestehenden Kundenwebseite. Dafür kopiert der Kunde ein iframe samt separatem Shop-Link in einen HTML-Baustein. Es wird kein Webseiten-Baukasten eingerichtet und keine externe Webseite automatisch verändert.

## Bedienung

„Webseite & Domain“ → „Shop-Button einbauen“ → „Produktliste einbauen“ öffnet eine separate Einbauhilfe. Die freigegebene Übersicht behält ihre drei Einstiege. Die neue Hilfe zeigt eine echte Vorschau, einen aufklappbaren Einbaucode und einen Kopierbutton mit manuellem Fallback. Der einfache Shop-Button bleibt ebenfalls verfügbar.

Die Produktliste zeigt ein Produkt pro Zeile, Bild, Namen, Preis und Verfügbarkeit, höchstens zehn Produkte pro Seite. Der 640 Pixel hohe Bereich scrollt intern und passt sich der vorhandenen Breite an. „Shop öffnen“ führt in einem neuen Fenster zum vorhandenen öffentlichen Shop. Die Liste selbst enthält weder Warenkorb noch Checkout.

Die Liste lädt beim Aufruf und nach „Aktualisieren“ den aktuellen SMA-Katalog. Es gibt keine Hintergrundabfrage, Datenkopie auf der Kundenwebseite oder dauerhafte Echtzeitverbindung. Bei Fehlern verschwinden alte Preise und Bestände. Eine inzwischen leere letzte Seite führt einmalig zurück zu Seite 1. Fehlende Preise werden nicht als kostenlos und unbekannte Bestände nicht als verfügbar ausgegeben.

## Direkter Produktlink

Im **Shop → Produkte** kann der Händler bei einem aktiven Artikel im öffentlichen
Shop **Produktlink kopieren** wählen. Bei gesperrter Zwischenablage erscheint der
Link in einem markierten Feld. Der Produktname im öffentlichen Sortiment und
in der eingebetteten Liste führt ebenfalls zu dieser Artikelansicht.

Die Adresse folgt dem Muster `/app/shop.html?shop=<shop-slug>&produkt=<sma-produkt-id>`.
Der öffentliche Leseendpunkt prüft den Shopzugang und sucht nach der exakten
Produkt-ID innerhalb des Händlerkontos. Die Position in der Liste und der
Produktname dürfen sich ändern. Ein fehlender oder inaktiver Artikel zeigt
einen Hinweis und den Rückweg ins Sortiment. Die Seite übernimmt Galerie,
Beschreibung, Preis, Verfügbarkeit und Warenkorb des Händlers.
Das Öffnen eines Links löst ausschließlich den Produktabruf aus.
Bestehende Portaltexte enthalten ihren bisher gespeicherten Shop-Link.

## Anbindung und Grenzen

- Die ursprüngliche Listeneinbettung verwendete die öffentliche GET-Funktion `sma-shop-produkte` in Version 3. Dabei galten folgende Filter: öffentlicher, aktiver Shop und gültiger Zugang; Produkte nach `user_id` **und** `kunde_id` sowie `aktiv:true` begrenzt. Der zusätzliche Produktfilter ist unter `supabase/functions/sma-shop-produkte/index.ts` versioniert.
- Browseranfragen senden keine Zugangsdaten, folgen keinen Weiterleitungen und haben zehn Sekunden Zeitlimit. Shop-Slug, Seitennummer, Rückgabe-Shop, Seitengröße, Produktanzahl und Produkt-IDs werden geprüft. Ungültige oder doppelte URL-Parameter erzeugen keinen Katalogaufruf.
- Einbau- und Shopziele sind fest auf `https://sma-automation.com` begrenzt. Der Code enthält nur den öffentlichen Shop-Slug. Keine Kunden-ID, Session, Schlüssel, Trackingparameter oder Anwendungsskripte werden auf die externe Webseite kopiert.
- Produkttexte werden ausschließlich als Textknoten eingefügt. Bilder sind auf signierte URLs des vorhandenen Projekt-Buckets `sma-produktbilder` begrenzt. Die Content Security Policy erlaubt nur die benötigten lokalen Skripte/Stile, den bestehenden Produkt-Endpunkt und diesen Bildpfad. Keine Kommunikation mit dem übergeordneten Fenster und keine automatische Navigation.
- Der Dashboard-Link wird bei Zugangsentzug entfernt. Die öffentliche Einbettung verwendet weiterhin die öffentlichen Shop-Gates; ein Domainnachweis ersetzt diese nicht und wird durch die Vorschau nicht behauptet.
- Es erfolgt kein Einbau auf einer echten fremden Kundenwebseite, keine DNS-/Tarifänderung, keine Freigabe von Kauf oder Veröffentlichung. `website_connected:false` und `can_publish:false` bleiben unverändert. Hauptseite, CNAME, geschützte n8n-Workflows und PR #57 bleiben unberührt.

## Dateien

| Aufgabe | Datei |
| --- | --- |
| Öffentliche Produktliste | `app/shop-catalog.html`, `app/assets/shop-catalog.css` |
| Darstellung, Seitenwechsel, Abruf und Fehlerzustände | `app/assets/shop-catalog.mjs`, `app/assets/shop-catalog-page.mjs` |
| Öffentliche Links, Einbaucode und Antwortvalidierung | `app/assets/shop-catalog-model.mjs` |
| Separate Einbauhilfe | `app/website-catalog-test.html`, `app/assets/website-catalog-test.mjs` |
| Einstieg im bestehenden Modul | `app/assets/website-domain.mjs` |

## Prüfung

- `node --test tests/*.test.cjs`: **315 Tests bestanden**, davon sieben neue Fälle zu festen Zielen, Manipulationen, Kundenzuordnung, Pagination, unvollständigen Preisen/Beständen, Bildquellen und anonymem GET ohne Weiterleitungen.
- Browser mit vorhandener öffentlicher Testshop-API: drei Produkte mit korrekten Preisen, Verfügbarkeiten und Bildern geladen. Nur Lesezugriff; keine Änderung von Kundendaten. Mobile Liste bei 360 Pixel Breite ohne horizontalen Überlauf.
- Synthetische Browserdaten: 21 Produkte auf drei Seiten, geänderter Preis und Bestand nach Aktualisierung, Verkleinerung auf ein Produkt von der letzten Seite, leerer Katalog, Fehler mit sofortiger Entfernung alter Produkte und erfolgreiche Wiederaufnahme. Eingefügtes HTML bleibt sichtbar als Text; es entsteht kein Bild oder Eventhandler.
- Dashboard-Einstieg und Entfernen des Einbauziels nach Zugangsentzug geprüft. Ungültiger doppelter Shop-Parameter zeigt nur die Fehlermeldung. Die lokale HTTP-Vorschau markiert den Code beim nicht verfügbaren Clipboard-API-Aufruf für manuelles Kopieren.
- Deployment und abschließende HTTPS-/Einbettungsprüfung werden im zugehörigen PR festgehalten. Der lokale Aufbau ist kein Nachweis eines tatsächlichen Einbaus auf einer Kundenwebseite.

Referenzen, geprüft am 4. November 2026: [HTML iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe), [Supabase CORS](https://supabase.com/docs/guides/functions/cors), [Supabase Changelog](https://supabase.com/changelog). Keine SDK-, Datenbank- oder Serveränderung erforderlich.
