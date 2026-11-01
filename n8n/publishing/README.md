# Portaltext-Vorschau V1

Erste, isolierte Ausbaustufe zu Issue #11. Der authentifizierte Veröffentlichungsbereich erhält eine aufklappbare Textvorschau. Beschreibung, Zielgruppe und Ziel liefern das Ausgangsmaterial; es wird noch keine Kundendatei gelesen. Die Vorschau ist ausdrücklich `can_publish: false` und ist nicht mit einem Upload-Pfad verbunden.

Pro ausgewähltem Portal werden Titel/Einstieg, eigener Beitragstext, höchstens drei relevante Hashtags und konkrete Prüfhinweise erstellt. Das sind redaktionelle Grenzen, keine vollständige Prüfung sämtlicher Portalregeln. Fakten, Rechte, Werbe-/KI-Kennzeichnung, Medienformat und die Nutzbarkeit des Links müssen in folgenden Ausbaustufen geprüft werden. Reichweite oder Ranking werden nicht garantiert.

Der Shop-Link wird ausschließlich aus dem aktiven, berechtigten Kundenkonto in Supabase bestimmt. Er wird nach der Modellantwort angehängt und bei jeder Bearbeitung serverseitig neu eingesetzt. Affiliate-Provisionen, Attribution und Profil-Link-Konfiguration gehören nicht zu dieser Stufe.

## Komponenten

- `app/dashboard.html`: fügt eine optionale Vorschau in den authentifizierten Veröffentlichungsbereich ein. Vorhandene Dashboard-, OAuth- und Abmeldefunktionen bleiben erhalten.
- `app/publication-preview.html` und `app/assets/publication-preview.js`: mobile Oberfläche, letzte Vorschau laden, Titel/Text bearbeiten und mit Versionsprüfung speichern.
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
