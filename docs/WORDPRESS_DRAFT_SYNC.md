# WordPress-Produktentwurf mit dauerhafter Wiederaufnahme

Stand: 4. November 2026. Migration `wordpress_durable_product_draft_sync_v1` und Edge-Endpoint `sma-wordpress-sync` Version 1 sind bereitgestellt. Der neue Kundeneinstieg baut auf der bestehenden WordPress-Freigabe auf. Es ist weiterhin **keine externe WordPress-Webseite verbunden**; kein realer Produktentwurf wurde angelegt. Ein positiver Ende-zu-Ende-Test mit WordPress/MySQL und dessen Erweiterungen bleibt offen.

## Kundenablauf

Unter **Webseite & Domain → Webseite einrichten → WordPress verbinden** wird zunächst der vorhandene Anschluss freigegeben und geprüft. Erst bei bestätigter Verbindung erscheint **Produktbereich erzeugen**. Dieser Klick erstellt einen eigenen WordPress-Seitenentwurf „Produkte“, ohne Codekopieren und ohne vorhandene Seiten zu ersetzen. Eine bloße Statusabfrage oder Verbindungsprüfung startet keinen Schreibauftrag.

Nach Erfolg zeigt SMA das gespeicherte Ergebnis und **Entwurf in WordPress öffnen**. Ein erneuter Klick nach einer verlorenen Browserantwort liefert denselben Erfolg, ohne eine weitere Seite zu erstellen. Bei einer Unterbrechung bleibt **Einrichtung fortsetzen** am ursprünglichen Auftrag. Ein noch laufender Auftrag kann über **Stand laden** geprüft werden. Es gibt keine unbegrenzten Hintergrundwiederholungen.

Der Produktbereich enthält den bereits geprüften SMA-Katalog-Shortcode. Produkte, Bilder, Preise und Verfügbarkeit werden beim Aufruf aus dem zugeordneten öffentlichen SMA-Shop geladen; keine zweite Produktpflege in WordPress. Dieser Schritt überträgt keine Firmenprofil-, Impressums- oder anderen Seitentexte auf externe Webseiten. Das zentrale Firmenprofil bleibt mit Dashboard und SMA-eigenem Webseitenentwurf verbunden. Die Veröffentlichung des externen Produktentwurfs ist eine eigene Aktion in WordPress.

## Dauerhafter Auftrag

`sma_private.wordpress_sync_jobs_v1` speichert einen Auftrag je freigegebenem Verbindungsvorgang: Besitzer, genaue Zieladresse, Shop, einmalige Befehls-UUID, erwartete WordPress-Revision, vorherige Seiten-ID, Ergebnis, sichere Fehlerkennung und Arbeitsreservierung. Es werden keine Zugangsdaten in der Auftragstabelle gespeichert. Alte Vorgänge bleiben dokumentiert, sind nach Wechsel der Verbindung aber nicht mehr über die Kundenoberfläche zugänglich.

1. Der Edge-Endpoint prüft die Bearer-Sitzung über Supabase Auth. Kunden können weder Benutzer, Zieladresse, Seiten-ID noch Inhalt vorgeben. Der Browser übergibt nur die Aktion und die geladene Verbindungskennung.
2. Die serverseitige RPC prüft die aktuelle eindeutige Kundenzuordnung, aktiven Delta-Zugang, Vorbereitung, exakt passende dauerhafte Bridge-Verbindung, vorhandenes Vault-Secret und öffentlichen Shop. Sperrreihenfolge: Kunde → Vorbereitung → Verbindungsanfrage → Verbindung → Auftrag.
3. Eine zweiminütige Reservierung verhindert parallele Arbeiter. Der erste Lauf liest den WordPress-Stand über `inspect` und speichert die Ausgangsrevision **vor** dem Schreibaufruf. Unmittelbar vor dem Senden wird die aktuelle Bindung nochmals geprüft.
4. Der Server signiert ausschließlich `sync_draft`. Befehls-UUID und erwartete Revision kommen aus dem gespeicherten Auftrag. Nach einem unklaren Ergebnis wird niemals eine neue Ausgangsrevision übernommen. Wiederaufnahme verwendet dieselbe UUID und Revision mit frischer Signatur. Der WordPress-Baustein liefert den vorhandenen Erfolg zurück.
5. Das Ergebnis muss Ziel, Verbindung, Shop, Entwurfsstatus, genaue Folgerevision und gegebenenfalls bisherige Seiten-ID bestätigen. Erst dann wird es dauerhaft gespeichert. Ein verspäteter Fehler kann einen gespeicherten Erfolg nicht zurücksetzen. Eine verlorene Abschlussantwort kann wiederholt oder über Status geladen werden.

Fehlgeschlagene Netzwerkaufrufe behalten die ursprüngliche Absicht und erhalten eine kurze Wiederholpause. Ein abgelaufener Arbeiter kann über dieselbe Absicht ersetzt werden. Fremdänderungen, veröffentlichte/gelöschte Seiten, Rechteentzug, nicht transaktionale Tabellen, Inhaltsfilter oder widersprüchliche Antworten stoppen den Auftrag. SMA erstellt in diesen Fällen keine Ersatzseite. Der vorhandene PHP-Baustein und sein installierbares ZIP bleiben unverändert.

Ein bereits abgesendeter Befehl kann bei zeitgleichem Widerruf noch auf der zuvor freigegebenen Seite eintreffen. Die Abschlussprüfung meldet ihn dann nicht als Erfolg einer neuen Verbindung. Zum sofortigen Entzug auf WordPress-Seite bleibt dort „Verbindung trennen“ erforderlich. Ein gespeichertes erfolgreiches Ergebnis bezeichnet den bestätigten Stand zum Abschlusszeitpunkt, keine fortlaufende Prüfung späterer manueller WordPress-Änderungen.

## Sicherheit und Prüfung

- Auftragstabelle mit RLS, ohne Direktrechte für Browser- oder Servicerollen. RPC nur für die Servicerolle; die Edge-Funktion prüft die Sitzung selbst (`verify_jwt:false` wie beim vorhandenen Verbindungsendpoint).
- Vault-Schlüssel ausschließlich im Serverprozess. Kundenantworten enthalten weder Schlüssel, Arbeitsreservierung noch interne Befehls-UUID. Der Bearbeitungslink wird ausschließlich aus der gebundenen Webadresse und bestätigten numerischen Seiten-ID gebildet.
- Vorhandener begrenzter Netzwerkadapter mit geprüftem öffentlichen IPv4-Ziel, DNS-Kette, an IP gebundenem Socket und TLS-Namensprüfung. Keine Redirects. Nur der neue Sync-Endpoint akzeptiert zusätzlich eng begrenzte bekannte WordPress-409/403-Fehler; andere Inhalte bleiben generische Netzwerkfehler.
- **359 Node-Tests bestanden**, darunter Wiederaufnahme nach bereits ausgeführtem Remote-Befehl, keine doppelte Seite, alte Revision, fremde Antwort, Bindungswechsel, nicht autorisierte Aufrufer, sichere Links und Abbau bei Kontowechsel.
- Lokale PostgreSQL-Tests für Direktrechte, Bindung, UUID, Reservierungen, Wiederholpause, unveränderliche Ausgangsrevision, mehrfachen Abschluss, verspätete Fehler, blockierte Aufträge und Shopwechsel. Vorhandene Verbindungs-/Vault-/Ticket-Fälle bestehen ebenfalls; alle Fixtures zurückgerollt.
- **66 PHP-/OpenSSL-Prüfungen** für vorhandenen Baustein und Adapter bestanden. WordPress-Speicher und APIs sind hier Doubles, kein echter MySQL-Last-/Nebenläufigkeitstest.
- DOM-Prüfungen bestätigen expliziten Erstellungsbutton, keine impliziten Schreibvorgänge, korrekten Ergebnislink, gesperrte Aktionen, Widerruf und verworfene verspätete Antworten. Bestehende Firmenprofil-/Webseiten-DOM-Prüfungen bestanden. Lokale Browserprüfung auf Desktop und im 390-Pixel-Handyrahmen ohne horizontalen Überlauf.
- Deno-Typprüfung für neuen Sync- und bestehenden Verbindungsendpoint bestanden. Native Datenbankprüfung: RLS aktiv, RPC für `anon`/`authenticated` gesperrt, fehlender Benutzer wird abgewiesen, **0 echte Aufträge**. Advisor nur beabsichtigtes `INFO rls_enabled_no_policy` für die neue private Tabelle ohne Direktrechte.
- Live-HTTP-Prüfung: fehlende und ungültige Bearer-Sitzungen erhalten 401 `AUTH_REQUIRED`; fremde Browserherkunft erhält 403 `ORIGIN_REJECTED`.

```sh
node --test tests/*.test.cjs
node tests/run-website-provider-sql.mjs
node tests/run-wordpress-bridge.mjs
node tests/run-wordpress-dom.mjs
node tests/run-wordpress-sync-dom.mjs
npm exec --yes --package=deno@2.9.6 -- deno check supabase/functions/sma-wordpress-sync/index.ts supabase/functions/sma-wordpress-connect/index.ts
```

Nächste externe Abnahme: eine konkret freigegebene WordPress-Testseite verbinden, einmaligen Produktentwurf erzeugen, echte TLS-/MySQL-/Plugin-Nebenwirkungen und Darstellung prüfen. Keine Hostingbuchung, Tarifänderung, Domain-/DNS-Änderung oder Veröffentlichung wurde ausgeführt.
