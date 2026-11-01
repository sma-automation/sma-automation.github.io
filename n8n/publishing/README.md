# Portaltext-Vorschau V1

Erste, isolierte Ausbaustufe zu Issue #11. Jede vorhandene Portal-Kachel im authentifizierten Veröffentlichungsbereich erhält einen Button „Optimieren“. Er öffnet ein kompaktes Fenster nur für das gewählte Portal. Beschreibung, Zielgruppe und Ziel liefern das Ausgangsmaterial; es wird noch keine Kundendatei gelesen. Die Vorschau ist ausdrücklich `can_publish: false` und ist nicht mit einem Upload-Pfad verbunden.

Pro ausgewähltem Portal werden Titel/Einstieg, eigener Beitragstext, höchstens drei relevante Hashtags und konkrete Prüfhinweise erstellt. Das sind redaktionelle Grenzen, keine vollständige Prüfung sämtlicher Portalregeln. Fakten, Rechte, Werbe-/KI-Kennzeichnung, Medienformat und die Nutzbarkeit des Links müssen in folgenden Ausbaustufen geprüft werden. Reichweite oder Ranking werden nicht garantiert.

Der Shop-Link wird ausschließlich aus dem aktiven, berechtigten Kundenkonto in Supabase bestimmt. Er wird nach der Modellantwort angehängt und bei jeder Bearbeitung serverseitig neu eingesetzt. Affiliate-Provisionen, Attribution und Profil-Link-Konfiguration gehören nicht zu dieser Stufe.

## Komponenten

- `app/dashboard.html`: ergänzt die bestehenden Portal-Kacheln um „Optimieren“ und öffnet einen begrenzten Dialog. Vorhandene Dashboard-, OAuth- und Abmeldefunktionen bleiben erhalten.
- `app/publication-preview.html` und `app/assets/publication-preview.js`: mobile Oberfläche, jeweils letzte Vorschau des gewählten Portals laden, Titel/Text bearbeiten und mit Versionsprüfung speichern. Bestehende gemeinsame Vorschauen bleiben lesbar; Änderungen an einem Portal erhalten die anderen Texte.
- `supabase/sql/publication-preview.sql`: private Tabellen, authentifizierte RPC mit Eigentümerprüfung sowie ausschließlich serverseitig aufrufbare Abschluss-RPC. RLS und fehlende direkte Client-Tabellenrechte sind beabsichtigt.
- `prepare-preview.cjs`: Eingabe-, Modell- und Ausgabevalidierung. OpenAI Responses mit bestehender SMA-Verbindung, `store:false`, strengem JSON-Schema. Nur die Inhaltsangaben werden an das Modell übermittelt, keine Kunden-ID, Shop-Adresse oder Sitzung.
- `preview-workflow.json`: Export des separaten aktiven n8n-Workflows `9dNstQ4E2uXpZ18Z`. Enthält Credential-Referenzen, keine Credential-Geheimnisse. `build-workflow.py` erzeugt einen neuen Importentwurf aus dem geprüften Kern; nicht blind über eine aktive Version importieren.

## Betrieb und Schutz vor doppelten Anfragen

Ein UUID-Schlüssel identifiziert genau eine Eingabe. Wiederholungen liefern denselben gespeicherten Status, ohne einen zweiten Modellaufruf. Pro Benutzer darf nur eine Anfrage gleichzeitig laufen. Mindestabstand 30 Sekunden, höchstens 20 neue Anfragen pro Stunde; technische Schutzgrenzen, kein Paketversprechen. Ein abgelaufener Auftrag kann beim Lesen als fehlgeschlagen markiert werden. Ein neuer Versuch verwendet einen neuen Schlüssel.

Der Webhook prüft den Bearer-Header und lässt Supabase die Benutzeridentität validieren. CORS erlaubt die SMA-Domain. Alle Modell-/Netzwerkfehler liefern generische Meldungen; keine Rohantwort oder Sitzung geht an den Client. Eine gültige Server-Lease und unveränderte Berechtigung/Shop-Zuordnung sind für den Abschluss nötig. Bearbeitungen benötigen die aktuelle Revision.

n8n-Import übernimmt Workflow-Einstellungen nicht zuverlässig: vor Aktivierung in der UI Fehler- und Erfolgsausführungen, manuelle Ausführungen und Fortschrittsspeicherung auf **Do not save** setzen; Timeout 150 Sekunden. Mit erneutem Export überprüfen. Der neue Workflow verändert weder den veröffentlichten Kundenassistenten noch dessen vorhandenen Bestandsentwurf.

## Prüfung

`node --test tests/*.test.cjs` umfasst Generator- und Frontendtests, einschließlich Mehrfachklicks, deaktivierter Sitzung, Versionkonflikten, Shop-Link-Erhalt, unvollständiger Modellantworten und unerlaubter Ausgaben. `tests/publication-preview.sql` wird als Transaktion mit Rollback ausgeführt und prüft Berechtigungen, Eigentümer, Idempotenz, Lease und Bearbeitung. Keine Testbestellung und kein Social-Post wird erzeugt.

Quellen für die API-Verwendung: https://developers.openai.com/api/docs/guides/migrate-to-responses und https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-langchain.openai/text-operations/ . YouTube-Beschreibungen werden zusätzlich nach UTF-8-Bytes, TikTok-Texte nach UTF-16-Einheiten begrenzt. Die Prüfung der aktuellen vollständigen Portalvorgaben bleibt Bestandteil der Medien-/Veröffentlichungsadapter.

## Live-Prüfstand vom 01.11.2026

Pages-Deployment und Anmeldung im echten SMA-Dashboard geprüft. Vier Portaltexte wurden in zwei Live-Durchläufen erfolgreich erstellt; der abschließende Lauf mit den engeren Ausgabegrenzen benötigte rund zehn Sekunden. Titelbearbeitung wurde gespeichert (Revision 2) und nach Neuladen wiederhergestellt; in jeder gespeicherten Caption blieb genau ein eigener Shop-Link erhalten.

Ein erster Modelllauf wurde von der Fehlerbehandlung abgefangen; seine genaue Ursache wurde bei damals generischer Fehlererfassung nicht gespeichert. Daraus wird kein behobener Modellfehler behauptet. Die Ausgabegrenzen werden nun zusätzlich im JSON-Schema vorgegeben. Für spätere Fehler speichert ausschließlich die private Auftragstabelle eine fest erlaubte Kategorie; Rohfehler, Sitzungen und Modellantworten werden nicht als Diagnose persistiert. Ablehnungen oder ungültige Ausgaben können weiterhin auftreten und erzeugen keine veröffentlichbare Vorschau.

Aktiver n8n-Stand: `a239be17-7071-4e88-9de2-355e818b7e10`, 14 Knoten, keine Pins; sämtliche Inhaltsprotokolle aus, Timeout 150 Sekunden. Weitere technische Umsetzung bleibt in Issue #11 offen, insbesondere tatsächliche Dateianalyse, plattformspezifische Medien-/Metadatenprüfung und Übernahme des freigegebenen Textstands in die Upload-Adapter.

Portal-Oberfläche (01.11.2026): Gemeinsame ausklappbare Kachel entfernt. Vier Buttons in den bestehenden Kacheln; Dialog maximal 680 × 700 px, zusätzlich an den Bildschirm begrenzt, mit eigenem Scrollbereich. Inhalt/Ziel bei vorhandenem Text eingeklappt; neue Generierung nur für das gewählte Portal. `tests/publication-portal-scope.sql` prüft getrennte letzte Vorschauen und Kundentrennung unter der authenticated-Rolle.

## Dateizuordnung V1 (01.11.2026)

`SMA – Dateizuordnung – Kundenordner V1` (`Tta5irg2Z3DiCGy4`) synchronisiert ausschließlich Metadaten aus den beiden serverseitig zugeordneten Drive-Kundenordnern. POST `sma-publication-files-v1` prüft die SMA-Sitzung, reserviert einen kurzen Auftrag, kontrolliert die eindeutige Kunden-/E-Mail-Zuordnung und verwendet das bestehende Credential „Google Drive account 3“. Keine Dateien werden hochgeladen, verschoben, öffentlich freigegeben oder veröffentlicht. Inhalts-/Sitzungsprotokolle aus, 120 Sekunden Laufzeitlimit.

Im Dashboard: Datei auswählen, danach „Optimieren“ beim Portal. Alternativ im kompakten Portal-Fenster die Datei auswählen. Ein neuer Text wird nach der Erzeugung genau dieser Datei und diesem Portal zugeordnet. Vorhandene allgemeine Texte bleiben als „Allgemeine Textvorlage · ohne Datei“ erreichbar. Dateigebundene Texte werden nicht als allgemeine letzte Vorlage geladen. Speichern prüft die Zuordnungsrevision und bewahrt den Shop-Link. Die Liste zeigt maximal zehn Dateien je Seite und den Zuordnungsstatus je Portal.

Datenbank: zuerst `publication-preview.sql`, anschließend `publication-files.sql` anwenden. Das zweite Skript enthält auch den aktualisierten Vorlagenfilter. Private Tabellen mit RLS, keine direkten Rechte für Browserrollen. Ein eigener RPC erlaubt nur eigene Dateien und Texte; Katalogabschluss und Publisher-Abfrage sind ausschließlich für service_role. Der Drive-ID-/Versionsstand wird mit der Textrevision gespeichert. Geänderte/entfernte Dateien, unvollständige Metadaten, fremde Eigentümer und parallele Änderungen werden abgewiesen. Katalogdaten müssen zum Schreiben höchstens 15 Minuten alt sein. Der Publisher muss unmittelbar vor einer Übertragung die aktuelle Drive-Datei erneut prüfen und deren Revision übergeben.

`public.sma_publication_assignment_v1(customer_id, drive_file_id, asset_revision, platform)` liefert den ausdrücklich zugeordneten Textstand, niemals einen beliebigen neuesten Portaltext. **`can_publish:false` bleibt bestehen:** Das ist der Vertrag zur Übernahme in die Publisher, noch keine angeschlossene Upload-/Veröffentlichungskette. Dateiinhalt, finale Medienprüfung, Zielkonto und Freigabe müssen separat ergänzt werden. Die bestehenden Haupt- und Produktionsworkflows wurden nicht verändert.

Grenzen: Metadaten von höchstens 1000 Bild-/Videodateien in den beiden direkten Kundenordnern pro Abgleich. Eine weitere Seite oder eine unvollständige Drive-Suche erzeugt einen klaren Fehler und überschreibt den letzten vollständigen Katalog nicht. Unterordner werden nicht rekursiv durchsucht. YouTube/TikTok unterstützen in dieser Stufe nur Videozuordnungen.

Prüfungen: `node --test tests/publication-page.test.cjs tests/publication-file-catalog.test.cjs tests/publication-preview.test.cjs` (23 Tests); `tests/publication-files.sql` prüft zwei getrennte Dateien, fremden Zugriff, getrennte Portale, Speichern, Versionskonflikte, service_role-Publisher-Vertrag und Rollenrechte mit anschließendem Rollback. Keine Testdatei wird in einen automatisch überwachten Drive-Ordner gelegt. Supabase-Advisor: keine neue Warnung zu dieser Erweiterung; private Tabellen ohne Browser-Policies sind bewusst nur über die kontrollierten RPCs erreichbar. Bereits bestehende Warnungen zu anderen Funktionen/Passwortschutz bleiben außerhalb dieser Änderung.

Referenzen: https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list und https://developers.google.com/workspace/drive/api/reference/rest/v3/files ; https://supabase.com/docs/guides/database/functions und https://supabase.com/docs/guides/database/postgres/row-level-security .

## Technische Medienvorprüfung

Die Dateizuordnung hat jetzt einen eigenen Abschnitt „Medienprüfung“ je Portal. Er zeigt gemeldetes Format, Größe, Auflösung und Videolänge sowie erkannte Probleme und noch offene Prüfungen. Keine automatische Freigabe oder Übernahme alter Sicherheitsresultate. Umfang, Quellen, SQL-Deployment und Tests stehen in [MEDIA_PRECHECK.md](MEDIA_PRECHECK.md).

## Visuelle Dateiprüfung

Die separate versionsgebundene Sicherheitsprüfung ist in [CONTENT_REVIEW.md](CONTENT_REVIEW.md) beschrieben. Sie nutzt vorhandene Sightengine-Credentials, liefert ein gemeinsames Prüfergebnis für alle Portal-Kacheln und erteilt keine Veröffentlichungsfreigabe. Nach der Medienvorprüfung muss `supabase/sql/publication-content-review.sql` als jüngster Funktionsstand angewandt werden.
