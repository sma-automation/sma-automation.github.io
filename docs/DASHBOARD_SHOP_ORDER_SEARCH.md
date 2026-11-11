# SMA Shop – Bestellungen finden

Stand: 11.11.2026. Die Kundensicht des Shop-Managements erhält
eine eigene Suche oberhalb der bestehenden Bestellliste.

## Was Kunden sehen

**Shop → Bestellungen:** Direkt unter der Überschrift stehen jetzt eine
Bestellnummernsuche, ein Marktplatzfilter, ein Filter für die
Testkennzeichnung und „Zurücksetzen“. Die Ansicht bleibt kompakt
und behält fünf Bestellungen pro Seite. Auf dem Handy stehen die
Filter untereinander, damit nichts abgeschnitten wird.

Die Suche arbeitet **serverseitig über alle berechtigt sichtbaren
Bestellungen**, nicht nur über die fünf auf der aktuellen Seite.
Die Suche akzeptiert Buchstaben, Zahlen, Leerzeichen sowie
`#`, Punkt, Schrägstrich und Bindestrich. Platzhalter- und
PostgREST-Steuerzeichen werden abgewiesen.

## Statusinformationen

- **Testbestellungen**: `ist_testbestellung = true`.
- **Nicht als Test markiert**: `ist_testbestellung = false`.
- **Teststatus ungeklärt**: `ist_testbestellung IS NULL`.

Wichtig: „Nicht als Test markiert“ ist **keine** Behauptung einer
bestätigten echten Zahlung. Zahlungs- und Lieferstatus erscheinen
weiterhin separat. Der aktuelle Testmodus bleibt bestehen.

Die Bestellanzahl und Seitennavigation richten sich nach den
serverseitigen Filtern. Neue oder aktualisierte Bestellungen werden
mit dem bestehenden automatischen Lesepoll weiterhin abgeglichen.
Der bisherige Kundenzugriff `eq('user_id',currentUserId)` plus
Supabase RLS `auth.uid()=user_id` bleibt aktiv.

## Was wir nicht ändern

Keine neuen SQL-Rechte, keine Exportfunktion, keine Bestellmutation,
keine Shopify-/Digistore24-Aktion, kein Checkout, keine neue
Zahlung und keine zusätzliche Kundendatenübertragung.

## Nachweise

`tests/shop-order-search.test.cjs` testet sichere Filter,
unbekannte Testkennzeichnungen und die mobile Oberfläche.
Die bestehenden `tests/shop-orders.test.cjs` prüfen
seitenübergreifende Suche, Neu-Laden, Polling, Teststatus und
Rücksetzen mit synthetischen Bestellungen.
