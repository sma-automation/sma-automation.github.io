# Getrenntes Kundenwebseiten-Testpaket

**Nur lokal vorbereitet; noch nicht bereitgestellt.** Das Paket zeigt auf genau einem konfigurierten HTTPS-Host die ausdrücklich veröffentlichte SMA-Seite. Es enthält weder Dashboard noch Auth-Client, gespeicherte Kundentexte oder eigene Bilddateien. Die bestehenden Renderer, Datenprüfungen, Produktanzeige und das unveränderte Stylesheet werden über eine feste Dateiliste übernommen.

## Lokal erstellen

Im Repository, mit Node.js wie für die vorhandenen Tests:

```sh
node hosting/customer-website/build.mjs \
  --origin https://test.sma-automation.com \
  --site f931c608-a7fd-40df-9762-574c39301849 \
  --out /workspace/scratch/a78a6f92ec7a/sma-domain-package
```

Das Ausgabeziel muss leer oder noch nicht vorhanden sein. Der Befehl erstellt **17 statische Dateien** und führt keine Netzwerk-, DNS-, Hosting- oder Veröffentlichungsaktion aus. Die angegebene Seiten-ID gehört zum vorhandenen privaten SHK-Testentwurf. Eine gespeicherte ID macht den Entwurf nicht öffentlich. Bei erneutem Erstellen ein neues leeres Ausgabeziel wählen. Auf anderen Arbeitsrechnern nur den Ausgabepfad anpassen.

`binding.mjs` enthält ausschließlich Ziel-Origin und Seiten-ID. Aufrufe über andere Hosts (einschließlich `*.pages.dev`), andere Pfade oder mit beliebigen Queryparametern bleiben gesperrt. Erlaubt sind `/` und `/index.html`, einschließlich normaler Sprungmarken. `?preview=1` wird niemals an den bestehenden Vorschaucontroller weitergereicht. Diese browserseitige Zuordnung ist keine Zugriffskontrolle für geheime Daten und kein vollständiges Domainregister: Die eigentliche Veröffentlichungsprüfung bleibt im öffentlichen Backend.

`404.html` verhindert den standardmäßigen SPA-Fallback von Cloudflare Pages. `_headers` setzt unter anderem `no-store`, eine restriktive Content Security Policy und `noindex`; `robots.txt` sperrt Suchmaschinen zusätzlich. Diese Angaben sind keine Zugangssperre. Der Test ist nur auf veröffentlichte Inhalte ausgelegt. Nach einer Browser-Zurück-Wiederherstellung lädt die öffentliche Seite neu und prüft den aktuellen Snapshot.

## Bild-Endpunkt: gesondert freizuschaltende Zuordnung

Die Änderung an `sma-website-image` ist ebenfalls **noch nicht bereitgestellt**. Ohne die neue Umgebungsvariable bleibt jeder zusätzliche Origin gesperrt. Der vorgeschlagene Wert für den später ausdrücklich freigegebenen Test lautet:

```json
{"https://test.sma-automation.com":"f931c608-a7fd-40df-9762-574c39301849"}
```

Variablenname: `SMA_WEBSITE_PUBLIC_ORIGINS`. Der Wert enthält keine Zugangsdaten. Vor dem späteren Setzen mit `publicWebsiteOrigins` aus `supabase/functions/sma-website-image/handler.mjs` validieren. Ungültiges JSON oder ungültige Zuordnungen verhindern absichtlich den Start der neuen Funktionsinstanz; deshalb einen ungeprüften Wert nicht auf dem bestehenden Endpunkt ausprobieren. Die fehlende Variable entspricht `{}`. Höchstens 100 exakte HTTPS-Origins, keine Wildcards, Pfade, Zugangsdaten oder zusätzlichen Ports. Diese Grenze ist keine Zusage für das spätere Mehrkundenhosting.

Die Erweiterung erlaubt vom jeweiligen Origin nur öffentliche `GET`-Anfragen mit der zugeordneten `site`-ID und passende `OPTIONS`-Vorprüfungen mit `apikey`. Private Lesezugriffe, Uploads, andere Seiten-IDs und Authorization-Header bleiben dort gesperrt. Der bestehende SMA-Origin behält seine bisherigen privaten Operationen. Vor und nach dem Storage-Download prüft weiterhin dieselbe Datenbankfunktion, ob das Bild zum veröffentlichten Seitenstand gehört. Weder RLS noch Datenbankfunktionen oder Bucket-Öffentlichkeit werden verändert.

## Spätere Bereitstellung – noch nicht ausgeführt

1. Nutzerfreigabe für das konkrete Testprojekt, den Bild-Endpunkt, den IONOS-Eintrag und gegebenenfalls einen zeitlich begrenzten öffentlichen Inhaltstest einholen. Einen vorhandenen Cloudflare-Zugang verwenden oder die Kontoanlage separat klären; keine kostenpflichtigen Optionen buchen.
2. Nur das erzeugte Paket in ein getrenntes Cloudflare-Pages-Projekt im Free-Tarif übernehmen. Nicht das gesamte Repository und nicht die lokalen Browserfixtures hochladen. Der konkrete Projektname ist noch offen.
3. Die getestete Bildfunktion bereitstellen und ausschließlich die freigegebene Origin-/Seiten-Zuordnung setzen. Keine SQL-Migration erforderlich. Ein Zurücknehmen der Zuordnung auf `{}` sperrt die zusätzlichen Bild-Origins wieder.
4. Die Testdomain zunächst im Pages-Projekt zuordnen, danach ausschließlich den `test`-CNAME bei IONOS auf das tatsächlich erhaltene Projektziel setzen. Bestehenden Repository-`CNAME`, Hauptdomain und Nameserver beibehalten. SMA-Domainnachweis und Hostingbindung bleiben getrennte Vorgänge.
5. Echtes HTTPS, Root-Zuordnung, Browser-CORS, Offline-Sperre und freigegebene eigene Bilder abnehmen. Erst dieser Durchlauf belegt die reale Domainverbindung. Einen freigegebenen Testentwurf anschließend wieder offline nehmen. Beim Rückbau zuerst den Test-CNAME entfernen, dann die Hostingbindung aufheben.

Siehe [Machbarkeitsprüfung](../../docs/CUSTOMER_WEBSITE_DOMAIN_HOSTING.md) und [lokalen Prüfbericht](../../docs/CUSTOMER_WEBSITE_DOMAIN_PACKAGE.md).
