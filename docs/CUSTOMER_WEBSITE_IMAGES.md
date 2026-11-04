# Eigene Bilder für SMA-Kundenwebseiten

Stand: 4. November 2026. Aufbauend auf der bereits live geprüften Gestaltung aus PR #71 (`website-v1`, Ausgangscommit `f09a230`). **Implementiert und lokal geprüft; noch keine Bereitstellung oder Produktionsänderung.** Die nächste Freigabe betrifft die unten beschriebene Datenbank-, Edge- und Oberflächenänderung. Der bestehende private SHK-Testentwurf bleibt unverändert.

## Kundenablauf

Unter **Webseite bearbeiten → Gestaltung** gibt es zwei kompakte Bildfelder: **Firmenlogo** und **Startseitenbild**. Der Bereich bleibt beim Öffnen zugeklappt; Schrift und übrige Oberfläche bleiben erhalten.

1. „Logo auswählen“ beziehungsweise „Bild auswählen“ öffnet die Dateiauswahl. Zulässig sind PNG, JPEG und WebP bis 5 MB und 32 Millionen Bildpunkte. Der Browser dekodiert und verkleinert das Bild und erzeugt eine neue Bilddatei. Originaldatei und EXIF-Daten werden nicht hochgeladen; ein neu erzeugtes JPEG-Farbprofil kann erhalten bleiben.
2. Das Logo wird als PNG mit höchstens 512 Pixeln an der längsten Seite gespeichert, mit Transparenz. Das Startseitenbild wird als JPEG mit höchstens 1600 Pixeln und weißem Hintergrund gespeichert. Jede gespeicherte Datei ist auf 2 MB begrenzt. Startseitenbilder erscheinen mittig in einem 4:3-Ausschnitt; eine optionale Bildbeschreibung dient als Alternativtext.
3. Die Auswahl wird zunächst privat hochgeladen. Erst **Änderungen speichern** übernimmt ihre ID gemeinsam mit den Texten in den Entwurf. Die bisherige Auswahl bleibt bei einem fehlgeschlagenen Upload erhalten. Während der Verarbeitung sind Speichern und Veröffentlichen gesperrt. Ein Dateiauswahldialog oder Upload löst keine Webseitenveröffentlichung aus.
4. **Entfernen** entfernt die Auswahl aus dem Formular. Nach dem Speichern fehlt sie im Entwurf; beim Startseitenbild wird wieder das Hausmotiv verwendet. Ein bereits veröffentlichter Stand behält seine bisherigen Bilder bis zur ausdrücklichen Aktualisierung oder Offline-Schaltung.

Die Bild-ID-Felder `logo_image_id` und `hero_image_id` sowie `hero_image_alt` sind optional. Alte Inhalte bleiben gültig. Alte Schreibanfragen ohne diese Felder erhalten gespeicherte Bildbezüge; fremde oder nicht abgeschlossene Uploads können nicht gespeichert oder veröffentlicht werden. Schon geöffnete alte Browserfassungen müssen nach Bereitstellung neu geladen werden, weil ihre Inhaltsprüfung neue Felder noch nicht kennt.

## Privater Speicher und öffentlicher Stand

- Neuer privater Bucket **`sma-webseitenbilder`**, ausschließlich PNG/JPEG, höchstens 2 MB je Objekt. Der vorhandene Produktbild-Bucket wird nicht verändert. Eine restriktive Storage-Regel sperrt direkte Zugriffe durch `anon` und `authenticated`, auch wenn später eine breite erlaubende Regel hinzukommt.
- `sma_private.website_images_v1` speichert Besitzer, Kunde, UUID, MIME-Typ, Größe, Abmessungen, SHA-256 und Lebenszyklus. RLS ist aktiv; direkte Tabellenrechte sind entzogen. Nur der servicegeschützte RPC `sma_website_image_service_v1` ist für die Edge-Funktion aufrufbar.
- Der neue Endpunkt **`sma-website-image`** authentifiziert private GET/POST-Anfragen serverseitig. Uploads benötigen eine bestehende eigene Webseite und aktiven Delta-Zugang. Private Bilder bleiben für den bestehenden Besitzer auch nach Zugangsablauf lesbar.
- Öffentliche Bildabrufe müssen zusätzlich die konkrete Seiten-ID nennen. Der Server erlaubt nur Bilder im ausdrücklich veröffentlichten Snapshot, bei weiterhin passender Besitzerzuordnung und aktivem Zugang. Ein ungenutztes Startseitenbild ist nicht öffentlich, wenn ein anderes Motiv gewählt ist. Nach dem Download wird die Berechtigung nochmals geprüft. Kein Fallback auf den privaten Entwurf.
- Objektpfade werden ausschließlich aus geprüfter UUID und festgelegter Dateiendung gebildet. Keine frei eingegebenen URLs, keine signierten URLs im Browser und kein öffentlicher Bucket. Auslieferung mit `no-store`, festem Bildtyp und `nosniff`; im Browser werden kurzlebige Blob-URLs verwendet und beim Wechsel wieder freigegeben. Bereits angezeigte oder heruntergeladene öffentliche Kopien können naturgemäß nicht zurückgerufen werden.
- Die Serverprüfung begrenzt Bytezahl, Dauer und Abmessungen, prüft PNG-Chunks/CRC und JPEG-Segmente sowie den SHA-256-Abgleich. Sie ist **eine Strukturprüfung, kein vollständiger serverseitiger Pixeldecoder und keine Inhaltsmoderation**. EXIF, Kommentare, SVG, fremde Metadatenmarker und überlange Farbprofile werden abgewiesen. Die vollständige Bilddekodierung und Neucodierung erfolgen im Browser.
- Wiederholte Anfragen mit derselben UUID und denselben Metadaten sind idempotent. Storage-Dateien werden nicht überschrieben. Ein vorhandenes Objekt wird bei einem wiederholten Upload durch seinen Digest abgeglichen. Kontowechsel vor/nach Verarbeitung und Upload sowie verspätete Miniaturansichten dürfen keine fremden oder entfernten Bilder wieder ins Formular einsetzen.

## Begrenzung und Aufräumen

Pro Kunde sind höchstens zwölf neue Uploadreservierungen pro Stunde und 24 nicht gelöschte Bildkopien erlaubt; unterbrochene Uploads zählen mit. Der normale Kunde benötigt je ein Logo und Startseitenbild sowie gegebenenfalls die bisherigen öffentlichen Kopien.

Bei einem späteren Upload werden bis zu zwölf mindestens 24 Stunden alte Kopien bereinigt, die weder im aktuellen Entwurf noch im veröffentlichten Snapshot referenziert sind. Die Datenbank markiert sie unter derselben Kundensperre wie das Speichern zunächst als `deleting`; ab dann können sie nicht erneut angehängt werden. Erst nach erfolgreichem Storage-Löschen werden sie als `deleted` markiert. Fehlgeschlagenes Aufräumen wird bei einem späteren Upload erneut versucht. Ohne weitere Uploads läuft kein geplanter Löschauftrag. Es wird kein zusätzlicher kostenpflichtiger Dienst gebucht; tatsächliche Speichernutzung bleibt im bestehenden Supabase-Projekt.

## Prüfung und Grenzen

- **381 Node-Tests bestanden**: 362 bestehende plus 19 Bildtests für echte PNG/JPEG-Dateien, Farbprofile, defekte/zu große Daten, Lesezeitlimit, Konvertierung, Authentifizierung, Accountbindung, Wiederholung, konkurrierende Objektinhalte, öffentliche Leseberechtigung und erneute Prüfung nach dem Download.
- **Zehn neue DOM-Szenarien bestanden**: Auswahl/Speichern/Wiederaufruf, Textschutz, Entfernen, laufender Upload, Kontowechsel, fehlgeschlagener Ersatz, verspätete Miniaturansichten, Blob-Lebenszyklus, sichere Alternativtexte und getrennte öffentliche/private Abrufe.
- Alle bisherigen Webseiten-, Gestaltung-, Firmenprofil- und WordPress-DOM-Prüfungen bestanden, darunter die zwölf bereits vorhandenen Vorschauaktualisierungs-Szenarien.
- Lokales PostgreSQL/PGlite: Service-/Direktrechte, Besitzer und aktive Pakete, unveränderliche Reservierung, fremde Bildabrufe, private/öffentliche Snapshots, alte Inhalte und Schreibanfragen, sichere Bereinigung, Uploadlimits, Offline-Schaltung/Besitzerwechsel und restriktive Storage-Policy. Alle Fixtures zurückgerollt. Die lokale Storage-Tabelle prüft die SQL-Rechte; sie ersetzt keinen echten Storage-API-Durchlauf.
- Deno-Typprüfung für den neuen Edge-Einstieg und `git diff --check` bestanden.
- Browserprüfung mit echten Produktionsmodulen, synthetischem transparentem PNG-Logo und WebP-Startseitenbild: Auswahl, tatsächliche Canvas-Neucodierung, anschließende Server-Strukturprüfung, lokales Speichern und erneutes Laden samt sichtbaren Bildern. Browser-JPEGs enthalten ein ICC-Farbprofil; die zunächst zu strenge Ablehnung wurde behoben und durch einen Regressionstest ergänzt. Die private Kontositzung und Speicherung waren in diesem Lauf simuliert; die Bildkopien lagen ausschließlich im lokalen Prüfspeicher.
- Zwei 390-Pixel-Handyrahmen: 375 Pixel nutzbare Breite und 375 Pixel Inhaltsbreite. Desktop: 1348 Pixel für beides. Kein horizontaler Überlauf; Logo und Startseitenbild vollständig dekodiert. Die letzte WebP-Wiederholung verwendete einen lokalen Prüfbutton mit derselben Datei und demselben Dateifeld, nachdem der Dateidialog der Browsersteuerung minutenlang benötigte.

![Lokale mobile Prüfung mit fiktivem Logo und Startseitenbild](evidence/customer-website-images-2026-11-04.jpg)

```sh
node --test tests/*.test.cjs
node tests/run-customer-websites-sql.mjs
node tests/run-customer-website-images-dom.mjs
for testfile in tests/run-*-dom.mjs; do node "$testfile"; done
deno check supabase/functions/sma-website-image/index.ts
git diff --check
```

Ein echter Supabase-Storage-/Edge-Durchlauf ist **noch offen** und kann erst nach freigegebener Bereitstellung geprüft werden. Es wurde kein Produktionsbild hochgeladen, keine Datenbankmigration installiert und keine Kundenwebseite veröffentlicht.

## Bereitstellung nach Freigabe

1. Bestehenden privaten Entwurf und veröffentlichten Zustand lesend sichern/abgleichen. In einer Migration zuerst `supabase/sql/customer-website-images.sql`, danach die aktualisierte `supabase/sql/customer-websites.sql` installieren. Im bestehenden Projekt ist die Webseitentabelle bereits vorhanden. Die Installation verändert keinen gespeicherten Webseiteninhalt.
2. `supabase/functions/sma-website-image/index.ts` samt lokalen Imports bereitstellen. **`verify_jwt=false`** ist für den öffentlichen Bildpfad und Publishable-Key erforderlich; private Aufrufe werden innerhalb der Funktion über `/auth/v1/user` geprüft. Sie benötigt nur die vorhandenen serverseitigen `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`. Keine neuen Kunden-Credentials oder Browserzugänge.
3. Erst danach den PR nach `website-v1` übernehmen und die geänderten versionierten Oberflächenmodule ausliefern. Die neue Oberfläche darf nicht vor SQL und Edge freigeschaltet werden.
4. Angemeldeten privaten Test durchführen: synthetisches Logo/Bild hochladen, Entwurf speichern, Vorschau neu laden, anonymen Bildzugriff weiterhin abweisen, anschließend alte Gestaltung/Bildauswahl wiederherstellen. Entwurf und Firmenprofil bleiben privat. Öffentliche Freigabe nur mit gesondertem Auftrag; lokale Snapshot-Tests sind keine Freigabe für eine reale Veröffentlichung.

Ein Zurückrollen muss die bereits gespeicherten optionalen Bildfelder weiter akzeptieren. Bucket und Bildtabelle nicht als Rollback löschen; zuerst den Uploadweg sperren oder vorwärts korrigieren und vorhandene Referenzen lesbar halten.

PR #70 und #71 sind abgeschlossen und live. PR #69 bleibt separat offen: lokaler WordPress-/MariaDB-Test bestanden, keine externe Testseite vorhanden und weiterhin nur Produktbereich, keine Firmenprofiltexte. PR #57 bleibt separat. Eigene Kundendomains benötigen weiterhin eine konkrete freigegebene Anbindung. Sightengine: `VIDEO_PLAN_REQUIRED`; Meta und Serverumbau später.
