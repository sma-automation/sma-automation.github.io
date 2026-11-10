# SMA – Beitragstext direkt aus der geöffneten Dateivorschau vorbereiten

Stand: 10. November 2026. Fokus: kontrollierter privater YouTube-Test mit dem bereits hochgeladenen 10-Sekunden-Testvideo; dieselbe Bedienung gilt für passende Bilder und Videos in den vier Portaloptimierungen.

## Ausgangslage

Die SMA-Dateigalerie, Metadaten und große Portalvorschau sind funktionsfähig. Das neutrale 10-Sekunden-Testvideo ist im kundengebundenen Dateikatalog verfügbar; Breite, Höhe, Dauer, Größe und SHA-256 sind erfasst. Die letzte rein lesende Supabase-Prüfung ergab keine YouTube-Zuordnung und keinen YouTube-Auftrag für diese Testdateien. Der bisherige Vorschauhinweis führte lediglich über „Zum Texteditor“ in das nächste Kapitel. Kunden mussten dort den Magic Effect separat suchen und aktivieren.

## Bedienung

- Wenn ein gültiges Medienformat, vollständige Videometadaten und eine prüfbare Dateikennung vorliegen **und für die Datei noch kein Portalbeitrag gespeichert ist**, erscheint in der **großen Dateivorschau** der Button **„✨ Magic Effect · Beitragstext erstellen“**.
- Der Button startet **erst nach einem bewussten Kundenklick** die bereits vorhandene, kundengebundene Magic-Effect-Strecke. Sie prüft den aktuellen Drive-Dateistand, eine eventuell schon bestätigte Inhaltsanalyse, Shop-/Produktzuordnung und generiert anschließend einen Portalentwurf mit Titel, Text, Hashtags und Shop-Link. Ein schon vorhandener gültiger Analysebefund kann ohne erneute Analyse wiederverwendet werden.
- Direkt daneben bleibt **„Inhalt selbst beschreiben“** als Alternative sichtbar. Diese öffnet das vorhandene Eingabefeld ohne Anbieteranfrage.
- Ist eine Datei für die automatisierte Erkennung ungeeignet oder fehlen noch Metadaten, bleibt der bisherige Weg **„Zum Texteditor“**. Der Benutzer wird dadurch nicht zu einer ungeprüften Analyse verleitet.
- Unfertige eigene Eingaben werden **niemals ungefragt ersetzt**; der bereits vorhandene Änderungs-/Ersetzungsdialog bleibt maßgeblich.
- Der resultierende Portalbeitrag ist nur ein **Entwurf**, ausdrücklich **keine** Upload-, Betreiber- oder Veröffentlichungsfreigabe. Er muss vom Kunden gelesen und bestätigt werden; YouTube-Privatsphäre und Rechte werden erst im getrennten Freigabedialog geprüft.

## Technische Grenzen

Keine Änderung an Magic-Effect-Anbieterworkflow, API-Keys, Datenbanktabellen, Operatorrechten, Kundenaufträgen oder Provider-Transporten. Das neue UI macht lediglich die **bestehende** Funktion über einen direkten und erkennbar aktiven Kundenklick zugänglich. Keine Analyse und kein Upload werden durch das bloße Öffnen einer Vorschau ausgelöst.

## Testumfang

- Tatsächliche Codepfade in `tests/publication-page.test.cjs`: geeignete YouTube-Datei zeigt den Button; die Vorschau selbst startet keine Netzwerkanfrage; ein Kundenklick übernimmt den vorhandenen verifizierten Befund, erzeugt genau einen dem richtigen Video zugeordneten Entwurf und startet keinen Upload/Veröffentlichungsauftrag. Eigene ungespeicherte Texte erfordern die ausdrückliche Ersetzungswahl.
- `tests/optimizer-workspace.test.cjs`: manuelle Alternative bleibt erreichbar, fokussiert die Eingabe und wird ausgeblendet, wenn nur der normale Editorweg verfügbar ist.
- `tests/run-optimizer-layout.mjs`: beide Vorschauaktionen müssen in YouTube-, TikTok-, Instagram- und Facebook-Ansichten von 320 px bis Desktop ohne horizontales Scrollen funktionieren.
- Vollständige vorhandene Repository-, SQL-, Musik-, Cover- und Dashboard-Tests vor Merge.

Das ist **kein** echter YouTube- oder TikTok-Uploadtest. Eine Live-Bereitstellung des UI-Codes setzt eine erfolgreiche CI und bestätigtes GitHub-Pages-Deployment voraus. Der geschützte n8n-Stamm sowie PR #57, #69 und #185 bleiben unverändert.
