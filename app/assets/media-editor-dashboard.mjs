// Replace only the inactive Content Optimizer placeholder, preserving its outer card and chapter.
export function mountMediaEditorEntry({doc,href}){
 const panel=doc.querySelector('#sma-content-panel-optimizer');if(!panel)return {destroy(){}};
 const card=panel.querySelector('.card');if(!card)return {destroy(){}};
 const original=[...card.childNodes],create=(tag,text)=>{const e=doc.createElement(tag);e.textContent=text;return e;};
 const heading=create('div','Bearbeitungsentwurf');heading.className='card-title';
 const text=create('p','Format, Bildausschnitt, Texteinblendung und Video-Einstellungen vorbereiten. Gespeicherte Änderungen findest du in der History.');
 const note=create('p','Vorschau und Entwurfsspeicherung sind verfügbar. Medienexport und zusätzliche Musik folgen separat.');note.className='muted';
 const link=create('a','Bearbeitungsentwurf öffnen →');link.href=href;link.target='_blank';link.rel='noopener';link.className='primary';link.style.cssText='display:inline-block;padding:12px 18px;border-radius:9px;background:#4a60d8;color:white;text-decoration:none;font:inherit';
 card.replaceChildren(heading,text,link,note);return {destroy(){card.replaceChildren(...original);}};
}
