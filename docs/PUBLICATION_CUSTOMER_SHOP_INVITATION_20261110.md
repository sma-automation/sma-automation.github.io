# SMA · Automatische Kundeneinladung in jedem neu erstellten Beitrag

Stand: 10. November 2026. Dies ergänzt den bestehenden funktionierenden Portaltext- und Shop-Link-Weg für YouTube, TikTok, Instagram und Facebook.

## Gewünschtes Kundenverhalten

SMA ergänzt bei **jeder neu erstellten oder überarbeiteten Portaltextfassung** eine persönliche Einladung direkt im Beitragstext, gefolgt vom bereits authentifiziert zugeordneten öffentlichen Kunden-Shop-Link in der vollständigen Caption.

Deutsch:

> Schau doch mal in meinem Shop vorbei!

Englisch:

> Feel free to visit my shop!

Die Caption enthält weiterhin genau den automatisch zugeordneten, auf dem öffentlichen Kundenkonto basierenden SMA-Shop-Link, beispielsweise `https://sma-automation.com/app/shop.html?shop=<kundenspezifischer-slug>`. Produktentwürfe behalten ihren validierten Produktpfad `&produkt=<gültige-produkt-id>`. Die KI darf weder einen Shop-Link noch eine fremde URL erfinden.

## Shop statt unveröffentlichter Webseite

Die aktuell vorhandene Test-Kundenwebseite hat **keinen** öffentlichen veröffentlichten Snapshot. Sie darf folglich nicht als öffentlichen Social-Media-Link auftauchen, selbst wenn die Domain bereits verifiziert wurde. SMA nutzt deshalb den **öffentlichen Kundenshop** als sichere Standard-Zieladresse. Ein späterer Wechsel zu einer tatsächlich veröffentlichten und kundenverifizierten Webseite benötigt einen getrennten, explizit getesteten Ziel-Link-Workflow; diese Änderung behauptet diesen Wechsel noch nicht.

## Technischer Schutz

- Die n8n-Textaufbereitung (`n8n/publishing/prepare-preview.cjs`) ergänzt den Satz **nach** der inhaltlichen Generierung. Das KI-Modell erfindet keine Call-to-Action-Fakten und keine Kundendomain. Die Inline-CTA wird bei der 1200-Zeichen-Grenze überprüft.
- Die vorhandene, in GitHub gespeicherte `preview-workflow.json` enthält die analogen Code-Node-Quellen. Sie wird im bestehenden n8n-Produktionsworkflow **nicht automatisch überschrieben**.
- Die Migration `20261110155400_publication_shop_invitation_v1.sql` ergänzt einen privaten BEFORE-Trigger auf `sma_private.publication_previews_v1`. Er normalisiert nur neu abgeschlossene oder explizit geänderte Portalvorschauen mit korrektem, kundenbezogenem Schlusslink. Kein Rückschreiben in alte freigegebene Aufträge; kein nachträglicher Sammelimport historischer Captions.
- Die bestehende `sma_publication_preview_finish_v1` gibt nun den durch den Trigger tatsächlich gespeicherten Preview-Snapshot zurück. Sonst könnte der n8n-Webhook einen veralteten Text ohne CTA anzeigen, obwohl die Datenbank bereits korrekt wäre.
- Bei bereits vorhandener CTA gibt es **keine Doppelung**. Der Link bleibt pro Caption genau einmal erhalten. Ein gültiger Produktlink wird nicht durch einen allgemeinen Shop-Link ersetzt.
- Wird beim manuellen Bearbeiten der CTA-Satz entfernt, ergänzt die Datenbank ihn wieder bei der erfolgreichen Speicherung. Eine überlange Einzeleingabe wird nicht abgeschnitten; der Satz wird dann ausschließlich in der vollständigen Caption ergänzt.
- Unplausible oder fremde Caption-Links werden nicht durch die Normalisierung verdeckt.
- `can_publish:false`, Media-/Rechteprüfung, Anbieter-/Operatorfreigaben und alle vorhandenen Kunden- und Provider-Sperren bleiben unverändert. Die Einladung ist keine Veröffentlichungsgenehmigung.

## Abnahmekriterien

1. Vier Portaltexte in Deutsch/Englisch erhalten jeweils die Einladung, mit nur einem geprüften SMA-Kundenlink.
2. Separate Kunden behalten getrennte URLs; kein Browserparameter kann das Ziel überschreiben.
3. Nach einer Textänderung, einer neuen Variante oder Produktlink-Zuordnung bleiben Einladung und richtiger Link bestehen.
4. Mehrfache Datenbankupdates erzeugen nicht mehrere Einladungen; ältere gespeicherte Texte und Aufträge werden beim Ausrollen nicht verändert.
5. Auf Handy und Desktop sind Vorschau, Texteditor und Ergebnistext konsistent. Die bestehende Druck-/Längenbegrenzung bleibt aktiv.
6. Die echte Auslieferung umfasst GitHub-CI, SQL-Test und nach freigegebener Migration eine read-only-Liveprüfung. n8n-Stamm wird nicht ungefragt aktiviert oder geändert.

## Was diese Erweiterung nicht tut

Sie veröffentlicht keine Webseite, keinen Social-Media-Beitrag und keinen Shopartikel. Sie erstellt weder eine Bezahltransaktion noch ein künstliches Mediengutachten. Sie löst die noch offenen YouTube-/TikTok-Freigaben nicht automatisch.
