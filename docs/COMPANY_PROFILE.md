# Gemeinsame Firmendaten

Stand: 4. November 2026.

Unter **Webseite & Domain → Webseite einrichten → Firmendaten bearbeiten** öffnet sich ein eigener, kompakter Arbeitsbereich. Derselbe Einstieg wird im vorhandenen Einstellungsbereich ergänzt, sofern dessen `page-settings`-Container vorhanden ist. Die drei Einträge der Webseitenübersicht und die Dashboard-Schrift bleiben erhalten. Direkte Adresse: `app/company-profile.html`; die vorhandene SMA-Anmeldung wird weiterverwendet.

Der Kunde pflegt 16 Felder: vollständiger Firmenname, Rechtsform, Branche, Vertretung, Straße, Hausnummer/Zusatz, PLZ, Ort/Firmensitz, Land, öffentliche E-Mail, Telefon, öffentliche Ansprechperson, Erreichbarkeitszeiten, UID/Umsatzsteuer-ID, Register-/Firmenbuchnummer und Registergericht. Nur der Firmenname ist Pflicht. Bereits selbst eingegebene Webseiten-Kontaktdaten werden als Vorschlag übernommen; eine vorhandene Freitextadresse wird zur Zuordnung in strukturierte Felder angezeigt. Anmelde-E-Mail und Kontoname werden weder importiert noch überschrieben.

## Einmal speichern

`sma_private.company_profiles_v1` speichert genau ein Profil je Kunde. Dashboard und SMA-Webseitenentwurf lesen dieses Profil. Im Webseiteneditor sind Firmenname und die drei Kontaktfelder bei vorhandenem Profil schreibgeschützt und mit der zentralen Bearbeitung verknüpft. Auch manipulierte Schreibanfragen können keine abweichenden Kopien dieser Felder speichern. Ansprechpartner, Erreichbarkeit und optionale Firmenangaben erscheinen im Webseitenrenderer ebenfalls aus dem Profil.

Beim Wiederaufruf aktualisiert sich das Dashboard. Ein offener Webseiteneditor lädt beim Zurückkehren den neuen Profilstand, sofern keine ungespeicherten Textänderungen vorliegen. Unsichere alte Schreibstände werden durch die serverseitige Profilrevision zurückgewiesen. Das vermeidet verlorene Eingaben und unbemerkte Veröffentlichung zwischenzeitlich geänderter Firmendaten.

Ein öffentliches SMA-Webangebot bleibt auf dem ausdrücklich veröffentlichten Stand. **Öffentliche Webseite aktualisieren** speichert Website und Firmenprofil gemeinsam als Snapshot. Ein anschließendes Speichern im Firmenprofil verändert automatisch den privaten Entwurf, nicht den öffentlichen Snapshot. Die Vorschau enthält den aktuellen privaten Profilstand. Offline-Schalten löscht auch den öffentlichen Firmen-Snapshot.

Das zentrale Profil verändert keine bestehenden externen Webseiten. Deren Anbieteranschluss bleibt ein eigener Weg; der bisherige WordPress-Schritt prüft weiterhin nur den Lesezugriff. Es gibt keine versteckte DNS-, Tarif-, Domainkauf-, Zahlungs- oder Social-Media-Aktion. `sma_kunden.kunde_email`, Login und geschützte n8n-Kundenzuordnungen bleiben unverändert. Individuelle Impressums- und Datenschutztexte bleiben gesondert bearbeitbar.

## Zugriff und Migration

Migration `shared_company_profiles_v1`: zuerst `supabase/sql/company-profiles.sql`, danach die aktualisierte `customer-websites.sql`. Bei einer Neuinstallation zuvor `website-domain-preparation.sql` für das private Schema laden. Die Migration wurde im Projekt installiert; sie fügt ausschließlich die Profiltabelle, Funktionen und zwei Website-Snapshot-Spalten hinzu. Keine echten Kundenprofile wurden angelegt oder geändert.

Die Profiltabelle verwendet RLS ohne Direktrechte für `anon`, `authenticated` oder `service_role`. Die öffentliche RPC `sma_company_profile_v1` ist nur für angemeldete Benutzer ausführbar. Der private Definer mit leerem Suchpfad prüft eine eindeutige Kundenzuordnung, den bisherigen Besitzer und aktive Berechtigung. Aktive zahlungsbestätigte Kunden aller Pakete sowie der vorhandene Demo-Zugang dürfen ihre Firmendaten pflegen; die Webseitenfunktionen bleiben Delta-gebunden. Lesen des eigenen Profils bleibt nach Ablauf möglich.

Die Sperrreihenfolge ist Kunde → Firmenprofil → Webseite. Profilrevision und Request-UUID sichern konkurrierende Änderungen und Wiederholungen nach verlorener Antwort. Die Website verlangt beim Speichern und Veröffentlichen die tatsächlich geladene Profilrevision. Ein Besitzerwechsel gibt weder das vorige Profil noch dessen Entwurf frei. Alle Texte werden als Text gerendert, ohne vom Kunden geliefertes HTML.

## Prüfung

- 350 Node-Tests bestanden, einschließlich Profilvalidierung, Adressbildung, Request-Wiederholung, Kontowechsel und Profilrevision beim Website-Schreiben.
- Lokale PostgreSQL-Prüfungen für Rollen, Pflicht-/Maximalfelder, E-Mail, fremde Kunden, Alpha/Delta-Zugriff, Revisionen, Wiederholung, private automatische Übernahme, getrennte öffentliche Snapshots und Besitzerwechsel. Sämtliche Testdaten zurückgerollt. Auch alte Website-Fälle bestanden.
- DOM-Prüfungen für alle 16 Eingaben, Speicherung, Profilanzeige im Dashboard, Entfernen bei Besitzerwechsel/Abbau, schreibgeschützte gemeinsame Websitefelder, Schutz ungespeicherter Texte und sichere Ausgabe.
- Lokale Browserprüfung mit fiktiven Daten auf Desktop und im 390-Pixel-Handyrahmen; kein horizontaler Überlauf (375 Pixel nutzbare Innenbreite).
- Native Datenbankprüfung: sitzungsloser Profilaufruf `AUTH_REQUIRED`, anonyme Ausführung und direkte Tabellenrechte verweigert, RLS aktiv. Die neue Tabelle erzeugt lediglich den beabsichtigten Advisor-INFO-Hinweis `rls_enabled_no_policy`, da sämtliche Direktrechte fehlen.
- Kein authentifizierter Browser-Speichervorgang mit echten Kundendaten; positive Schreibabläufe wurden mit isolierten Fixtures geprüft.

```sh
node --test tests/*.test.cjs
node tests/run-customer-websites-sql.mjs
node tests/run-company-profile-dom.mjs
node tests/run-customer-website-dom.mjs
node tests/run-wordpress-dom.mjs
```
