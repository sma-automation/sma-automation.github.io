# Gespeicherte Portaltexte im Publisher vorbereiten

Fortsetzung: [Zielkonto und Portalberechtigungen](ACCOUNT_VERIFICATION.md) – Anschlusskorrektur veröffentlicht, echte YouTube-/TikTok-Kontoprüfungen erfolgreich; PR #46 zusammengeführt und Dashboard v23 live abgenommen. Beide Testaufträge wurden ohne finale Zustimmung storniert.

Stand der Portaltext-Integration nach PR #43: 3. November 2026. Die separate n8n-Arbeitskopie **SMA – Kunden-Publishing – Portaltext-Anbindung V1**, ID `JZwPbzCpgIByxk94`, liest die ausgewählte gespeicherte Textversion über die [Übergabeprüfung](PUBLISHER_HANDOFF.md) und bereitet die passenden Textfelder für die vorhandenen Publisher vor. Diese Stufe ist noch keine produktive Verbindung zum Social-Media-Upload.

**Fortsetzung:** Der [Dashboard-Auftrag mit Zielkonto, finaler Bestätigung und Doppelauftragsperre](PUBLICATION_ORDERS.md) bindet diese Vorbereitung inzwischen an eine separate Ausführungsprüfung. Dafür wird die unveränderte Arbeitskopie als interner Unterworkflow veröffentlicht; die 160 Bestands-Knoten bleiben deaktiviert. Die unten dokumentierten 250 Tests und der inaktive Abschlussexport beziehen sich auf den Stand von PR #43.

## Ablauf und bestehende Workflows

Der neue interne Einstieg prüft genau eine Auswahl, ruft `LxayneKkUusok0Q8` als Unterworkflow auf, wartet auf dessen echte Datenbankantwort, bildet die Textfelder ab und gibt den Freigabestand zurück. Fünf aktive Nodes enden bei dieser Rückgabe. Es gibt keine Verbindung von diesem Weg zu einem Upload oder einer Veröffentlichung.

Grundlage war ein frischer Export von `qwdTLh2rVmMkwhxb`, Version `0a15ba7a-c01d-4031-b7c3-f4fe04554f1e`. Das Original wurde ausschließlich gelesen. Der Generator entfernt in der Kopie die 17 bisherigen Einstiege und deaktiviert alle 160 verbleibenden Bestands-Nodes. Die Kopie enthält insgesamt 165 Nodes. Die geschützten Originale `GHBsYQcyt0JLFvRP`, `LeeH7IigyGRRUuxS` und `qwdTLh2rVmMkwhxb` bleiben unverändert; es wurden keine Zugangsdaten, Berechtigungen oder Abonnements geändert.

## Exakte Textzuordnung

`publisher-text.cjs` übernimmt nur eine erfolgreiche, versionsgebundene Antwort mit weiterhin gesperrtem Upload und gesperrter Veröffentlichung. Eine andere Auswahl, leere Texte, fehlende Freigabeblocker oder ein unerwarteter Antworttyp werden abgewiesen. Es gibt keinen Ersatztitel, keine erneute Generierung, keine Kürzung und keinen zusätzlich angehängten Shop-Link.

| Kanal und Medium | Vorbereitete Provider-Felder |
| --- | --- |
| YouTube, Video | `snippet.title` = gespeicherter Titel; `snippet.description` = gespeicherte Caption |
| Instagram, Bild oder Video | `caption` = gespeicherte Caption |
| Facebook, Bild | `message` = gespeicherte Caption |
| Facebook, Video | `description` = gespeicherte Caption |
| TikTok, Video | `post_info.title` = gespeicherte Caption |

Die Caption enthält die gespeicherten Absätze, Hashtags und genau einen geprüften Shop-Link. Interne Prüfhinweise werden nicht in Provider-Textfelder übernommen. YouTube- und TikTok-Bildrouten werden abgewiesen. Die passenden Parameter der sechs bestehenden Provider-Nodes sowie `Kundendaten – Publishing` sind in der inaktiven Kopie angepasst. Sonstige Provider-Einstellungen und Credential-Verweise wurden übernommen, nicht neu festgelegt.

`ok:true` und `stage:publisher_preparation` bestätigen nur die Vorbereitung. `can_upload:false`, `can_publish:false` und alle offenen Prüf-/Freigabepunkte bleiben erhalten. Die Provider-Nodes sind angepasst, aber weder aktiviert noch über den neuen Einstieg erreichbar.

## Betrieb und Reproduktion

`build-publisher-integration.py` erzeugt die private Arbeitskopie aus dem bestehenden Export und den beiden geprüften Text-/Übergabekernen. Geänderte Quell-Templates werden abgewiesen, statt unbekannte Parameter zu überschreiben. Der Generator lässt eine Ausgabe innerhalb des Repositorys nicht zu: Vollständige Alt-Exporte enthalten private Provider-Konfiguration und gehören nicht ins öffentliche Git.

```sh
python n8n/publishing/build-publisher-integration.py \
  --source /private/customer-workflow.json \
  --output /private/publisher-integration.json
node --test tests/publisher-integration.test.cjs
node --test tests/*.test.cjs
```

Die n8n-Kopie speichert weder erfolgreiche, fehlgeschlagene noch manuelle Ausführungsdaten oder Zwischenstände. Laufzeit höchstens 90 Sekunden, Aufruf nur durch Workflows desselben Eigentümers, kein MCP-Zugriff. Diese Einstellungen müssen nach einem UI-Import separat gesetzt und durch einen Export kontrolliert werden, da der Import sie nicht zuverlässig übernimmt.

## Validierung und verbleibende Arbeit

250 Node-Tests bestehen. Die sechs neuen Tests prüfen alle unterstützten Textzuordnungen, unveränderte Unicode-Zeichen und Absätze, interne Hinweise außerhalb öffentlicher Felder, fehlende oder manipulierte Freigaben, die tatsächlich gepatchten n8n-Ausdrücke und das Fehlen eines ausführbaren Uploadpfads. Der synthetische Quellworkflow bleibt beim Generieren unverändert.

Die Live-Prüfung verwendete vorhandene Kundenentwürfe nach tatsächlicher Aktualisierung des Dateikatalogs im angemeldeten Dashboard. **YouTube, Instagram, Facebook und TikTok** durchliefen jeweils den vollständigen neuen n8n-Vorbereitungsweg einschließlich Aufruf des Unterworkflows und echter Supabase-Abfrage. Die kanalspezifischen Caption-Felder entsprachen zeichengetreu den gespeicherten Captions; YouTube übernahm auch den Titel exakt. Jedes Ergebnis enthielt `ok:true`, `stage:publisher_preparation`, `can_upload:false` und `can_publish:false`. Nur die ausgewählte Eingabe war für den manuellen Test angeheftet; Datenbankantwort und Unterworkflow-Ergebnis wurden nicht simuliert. Anschließend wurden die Eingabe gelöst und die sichtbaren Ausführungsdaten bereinigt. Kundendaten und vollständige Texte werden nicht im Repository gespeichert.

Abschlussexport: Version `ea52f644-e982-45cf-847d-4965466c5e84`, `active:false`, leere `pinData`, 165 Nodes. Code, Provider-Parameter, Credential-Verweise, Deaktivierungen und Einstellungen entsprechen der erzeugten Kopie. n8n entfernt beim Speichern die Standardwerte `source:database` und `mode:once` des Unterworkflow-Aufrufs sowie leere Verbindungslisten; sämtliche tatsächlichen Kanten entsprechen der Vorlage. Der erfolgreiche Live-Aufruf bestätigt die gespeicherte Unterworkflow-Verbindung.

Vor einem produktiven Posting fehlen weiterhin die vertrauenswürdige Bindung an den Dashboard-Auftrag, aktuelle Datei-/Byteprüfung, konkrete Zielkonten und ihre Rechte, vollständige Inhalts-/Medienfreigabe, erforderliche Sichtbarkeitsentscheidungen sowie ein transaktionales Veröffentlichungsjournal gegen Doppelpostings und für Teilfehler. Erst anschließend kann ein geprüfter Ausführungspfad angeschlossen werden. **Die Bestands-Nodes dürfen nicht pauschal aktiviert werden:** Ihre bisherigen Einstiege wurden aus der Arbeitskopie entfernt; die Kunden-, Datei- und Kontozuordnung muss beim späteren Anschluss ausdrücklich neu gebunden und geprüft werden.

Die freigegebene Galerie, Schrift und separate Beitragsvorschau bleiben erhalten. Kein Serverumbau ist Teil dieses Schritts.

## Provider-Grundlagen

Geprüfte Primärquellen: [YouTube videos.insert](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert), [TikTok Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post), [Meta Instagram API](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), [Meta SDK – Page](https://github.com/meta/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py), [Meta SDK – IGUser](https://github.com/meta/facebook-python-business-sdk/blob/main/facebook_business/adobjects/iguser.py), [n8n Execute Sub-workflow](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow/). Diese Feldprüfung belegt keine Portalübertragung und ersetzt weder Kontoprüfung noch Medienabnahme.

### Produktlinks in neuen Videoentwürfen

Bei der Zuordnung eines neuen Portaltexts zu einem Video prüft SMA den Produktkontext der Dateiversion. Ein eindeutiger aktiver Artikel im öffentlichen Shop desselben Kunden erhält den Direktlink mit `&produkt=<sma_produkt_id>`. Ein bestätigtes privates Produktprofil braucht dafür genau einen aktiven Artikel mit demselben vollständigen Namen. Bei fehlender oder mehrdeutiger Zuordnung verwendet der Entwurf die Shop-Startseite.

Die Dateizuordnung speichert Artikelkennung und fertigen Beitragstext. Bearbeiten und erneutes Öffnen verwenden diese gespeicherte Auswahl. Die interne Übergabe prüft die aktuelle Erreichbarkeit des Katalogeintrags und den exakten Link im gespeicherten Text. Bei einem zurückgezogenen Artikel kann der Kunde das Linkziel im vorhandenen Entwurf korrigieren. Die bisherige Shop-Adresse in der Auftragsbindung bleibt mit vorhandenen Aufträgen kompatibel.

Der isolierte Durchlauf mit `node tests/run-publication-draft-product-links-sql.mjs` prüft die vier Portaltexte auf Deutsch und Englisch bis zu den vorbereiteten Textfeldern.

### Shopartikel bei mehreren Treffern wählen

Unter **Inhalt und Ziel** kann der Kunde einen Shopartikel für einen neuen Videoentwurf auswählen, wenn mehrere Produkte zum Dateistand passen. Das Feld enthält die passenden, öffentlich erreichbaren Artikel des eigenen Shops. Name und SKU unterscheiden Varianten. Bei identischen Angaben zeigt SMA zusätzlich die Artikelkennung. Ohne Auswahl kann der Kunde die Datei selbst beschreiben und den allgemeinen Shop-Link verwenden.

Magic Effect und die manuelle Texterstellung verwenden die Angaben des gewählten Artikels. Beim Zuordnen des fertigen Entwurfs gleicht SMA Artikelkennung, Produktangaben und aktuelle Treffer erneut ab. Ist der Artikel entfallen oder haben sich seine Angaben geändert, fordert SMA eine neue Auswahl an. Eine erfolgreich gespeicherte Zuordnung behält ihren Produktlink beim Bearbeiten und erneuten Öffnen. Die Auswahl für einen neuen Entwurf ändert keinen vorhandenen Auftrag.

### Video ohne erkannten Artikel

Unter **Inhalt und Ziel → Artikel aus meinem Shop zuordnen** kann der Kunde bei einem Video ohne Produkttreffer seinen öffentlichen Shop durchsuchen. Produktname, SKU oder SMA-Artikelnummer sind suchbar. Eine leere Suche zeigt das Sortiment in Gruppen von zehn. Erst die Wahl im Artikelfeld übernimmt die Angaben für den neuen Entwurf.

Die Katalogsuche verwendet den vorhandenen authentifizierten Datei-RPC. Vor der Textvorbereitung und bei der Dateizuordnung prüft SMA Kundenkonto, Dateistand und Artikel erneut. Liegt inzwischen eine automatische Produktzuordnung vor, greift die normale Produkterkennung und der Kunde muss die geänderte Auswahl prüfen. Bleibt das Artikelfeld leer, ist der allgemeine Shop-Link weiterhin möglich. Die Kundenwahl ist eine Angabe für den Textentwurf. Medienprüfung und Auftragsfreigabe laufen über ihre bisherigen Schritte.

### Linkziel im gespeicherten Videoentwurf korrigieren

Unter **Linkziel bearbeiten** kann der Kunde die Shop-Startseite verwenden oder einen Shopartikel übernehmen. Dafür gelten die vorhandenen Regeln für erkannte Artikel, mehrere passende Treffer und die Katalogsuche. Die Vorschau zeigt die Änderung sofort. Mit **Linkänderung verwerfen** kehrt der Kunde zum gespeicherten Ziel zurück. **Entwurf speichern** speichert das Ziel zusammen mit eventuellen Änderungen an Titel, Text und Hashtags.

Eine reine Linkkorrektur aktualisiert ausschließlich die Dateizuordnung des jeweiligen Portals. Die Revision einer gemeinsam verwendeten Textvorlage bleibt erhalten. Der bisherige Auftrag behält seine gespeicherte Bindung. Eine geänderte Zuordnung muss der Kunde für einen neuen Auftrag erneut prüfen. Die ursprünglichen Quellenangaben bleiben beim Entwurf. Beim Wiederöffnen zeigt die Artikelauswahl den gespeicherten Artikel, sofern er weiterhin verfügbar ist.
