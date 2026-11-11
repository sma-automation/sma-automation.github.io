# SMA – Privater Galerie-Worker: sicheres PostgreSQL-Dienstkonto

Stand: 11.11.2026. Dieser Schritt ergänzt die bereits zusammengeführte
Server-Anbindung PR #227. **Nicht produktiv installiert.**

## Bestätigte Grenze

Im bestehenden Supabase-Projekt wurde *lesend* festgestellt:
- Die private Funktion \`sma_private.gallery_worker_snapshot_v1(uuid)\` ist installiert.
- \`service_role\` besitzt \`EXECUTE\`, aber \`rolcanlogin = false\`.
- \`postgres\` kann sich anmelden, besitzt jedoch \`rolbypassrls = true\`.
- Weder das geplante \`sma_gallery_snapshot_reader\`-Gruppenrecht noch ein
  eigenes Worker-Login sind bisher vorhanden.

Ein echtes Passwort für \`service_role\` gibt es deshalb nicht als normales
PostgreSQL-Dienstkonto. Der **Supabase-Service-Key ist keine PG-Anmeldung**.
Mit einem großen \`postgres\`-Administratorkonto zu arbeiten wäre unnötig
riskant und ist im neuen Runner verboten.

## Neue Implementierung ohne Live-Änderung

- \`supabase/sql/gallery-worker-snapshot-reader-role.sql\` erzeugt
  ausschließlich die **NOLOGIN-Gruppenrolle**
  \`sma_gallery_snapshot_reader\`, ohne Superuser-/BYPASSRLS-
  oder Tabellenrechte. Einzige Berechtigung: \`USAGE\` auf dem privaten
  Schema und \`EXECUTE\` auf genau dem Galerie-Snapshot.
- Der private Runner prüft im bereits read-only geschalteten
  PostgreSQL-Login vor **jedem** Lauf: tatsächliches LOGIN, vererbtes
  Gruppenrecht, \`EXECUTE\` auf dem Snapshot, keine administrativen
  Privilegien, keine direkten SELECT/INSERT/UPDATE/DELETE-Rechte auf
  Galerieaufträge, Medienkatalog oder Storage-Metadaten.
- Fehlt etwas oder ist die Anmeldung zu mächtig, endet der Lauf mit
  \`PRIVATE_GALLERY_DB_ROLE_UNSAFE\`. Kein Medien-Download beginnt.

Die Gruppe kann sich selbst **nicht** anmelden. Sie wird nicht an
\`authenticated\`, \`anon\`, \`service_role\` oder öffentliche Nutzer
weitergegeben. Kein neuer Browser-RPC, keine Dashboard-Berechtigung.

## Späterer privater Serverbetrieb (nur nach gesonderter Betreiberfreigabe)

1. Die Rollen-SQL im vorgesehenen Supabase-Projekt installieren und
   Berechtigungen unabhängig überprüfen.
2. Ein **dediziertes PostgreSQL-LOGIN** auf dem autorisierten
   Serverweg mit einem vom Betreiber generierten starken Passwort
   einrichten. Das Passwort ausschließlich in der privaten
   Secret-Verwaltung generieren/übernehmen; niemals in Chat,
   GitHub, Logs, Screenshots oder Migrationsdateien verwenden.
3. Diesem LOGIN nur das vererbte Gruppenrecht
   \`sma_gallery_snapshot_reader\` gewähren. Kein \`service_role\`-
   Gruppenmitglied, kein \`BYPASSRLS\`, kein \`CREATEDB\`, kein
   \`CREATEROLE\`; keine sonstigen Tabellenrechte.
4. Das geprüfte Server-Login als \`SMA_GALLERY_PG_URL\` verwenden,
   mit validierter TLS-Zertifikatskette. FFmpeg/FFprobe und vorhandene
   Drive-/Storage-Zugänge bleiben zusätzliche Voraussetzungen.
5. **Einen** internen Auftrag im Nur-Lesen-Modus prüfen. Snapshot
   vor und nach Medienprüfung lesen; den Live-Datenbestand
   danach unverändert kontrollieren. Kein Dauerbetrieb.

## Unverändert gesperrt

Keine automatische Medienregistrierung, keine Provider-Uploads,
keine Social-Media-Posts, keine Musikcredits, keine Bestellungen
und keine Änderungen am laufenden n8n- oder Kunden-Dashboard.

Der echte serverseitige E2E-Lauf ist noch nicht erfolgt. Die
GitHub-Tests verwenden eigene isolierte synthetische Rollen
und können keine vorhandenen produktiven Serverzugänge bestätigen.
