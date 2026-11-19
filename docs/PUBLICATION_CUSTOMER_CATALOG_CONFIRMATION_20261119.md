# SMA – Kundenbestätigte Shopify-Produktzuordnung

Stand: 19.11.2026. Fokus: Testkunde `kunde_3182`, Hotel-Türgriff-Video, `SMA-TEST-002`.

## Problem
Die Videoanalyse erkennt ein kundeneigenes Produktprofil ("Mobiler Türgriff fürs Hotel"). Der aktuell gültige Shopify-Artikel heißt aber "SMA Testprodukt 2". Der ursprüngliche Offer-Service akzeptiert für automatisch erstellte Produktvorschläge nur exakt gleiche Namen. Eine pauschale Umbenennung des öffentlichen Shopify-Produkts würde Daten im Shop verändern und könnte Kunden irreführen.

## Abgesicherte Ergänzung
- Ein neues privates Feld am vorhandenen Produktprofil speichert die **ausdrücklich bestätigte** Katalog-Artikelzeile.
- `public.sma_publication_catalog_confirm_v1(asset,revision,product_id)` akzeptiert nur die Kundenidentität der Sitzung, eine vorhandene aktive Video-Dateiversion, eine abgeschlossene hashgebundene Medienanalyse, genau ein zugehöriges Produktprofil und einen aktuell gültigen Shopify-Kaufartikel **desselben Kunden**.
- Ein erneutes Bestätigen derselben Auswahl ändert nichts. Die RPC erteilt keine Publikationsfreigabe.
- Der bestehende Katalog-Lesepfad lässt für ein bereits erkanntes Produkt ohne Katalogzuordnung eine Artikelsuche zu. Der Kunde muss die Zuordnung **per Klick** bestätigen. Das verändert nicht den gespeicherten Portaltext.
- Die bestehende Produkterkennung bevorzugt die bestätigte Zuordnung; ein nicht mehr verfügbarer oder fremder Artikel wird nicht stillschweigend durch einen anderen ersetzt.
- Der vorhandene Angebotsservice erzeugt erst danach ein validiertes Shopify-Angebot; YouTube und TikTok übernehmen den Link nur über die bestehenden, revisionsgebundenen und getrennt bestätigten Abläufe.

## Isolierter Live-DB-Test (BEGIN/ROLLBACK)
Ausgeführt mit Kunden-/Video- und Shopify-Testdaten, **ohne dauerhafte Änderung**:
1. Vor Bestätigung: `NO_UNIQUE_CATALOG_MATCH`, 0 Angebote.
2. Nach einmaliger Bestätigung von `SMA-TEST-002`: `OFFER_OPTIONS`, genau 1 validiertes Shopify-Angebot.
3. Zweite identische Bestätigung: `changed:false`.
4. Falsche Artikel-ID: `PRODUCT_LINK_UNAVAILABLE`. Falsche Medienrevision: `FILE_CHANGED`.
5. Lesen des Katalogs vorher: `ok:true`. YouTube/TikTok-Einzelzuordnungen und Provider-Handoff nach simuliertem Metadaten-Refresh: `ok:true`, richtige `product_id`, `can_publish:false`, Medienstatus `needs_review`.

## Betriebsgrenzen
Die Änderung ist ein GitHub-Entwurf und **nicht auf Supabase ausgerollt**. In n8n wurde kein Workflow verändert, keine Execution angestoßen, keine Datei verschoben und nichts an Social-Media-Providern veröffentlicht. Shopify-Artikelname/-Preis/-Bestand bleiben unverändert.

Die vollständige Abnahme erfordert weiterhin einen frischen und autorisierten Google-Drive-Dateistand, Sicht-/Inhaltsprüfung, revisionsgebundene Kundenauswahl und -freigabe. Für einen produktiven Post ist weiterhin eine gesonderte ausdrückliche Autorisierung nötig.
