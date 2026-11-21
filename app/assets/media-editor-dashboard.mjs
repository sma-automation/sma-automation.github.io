// Replace only the inactive Content Optimizer placeholder, preserving its outer card and chapter.
export function mountMediaEditorEntry({doc,href}){
 const panel=doc.querySelector('#sma-content-panel-optimizer');if(!panel)return {destroy(){}};
 const card=panel.querySelector('.card');if(!card)return {destroy(){}};
 const original=[...card.childNodes];
 function create(tag,de,en){
  const el=doc.createElement(tag);el.dataset.de=de;el.dataset.en=en;
  el.textContent=doc.documentElement.lang==='en'?en:de;return el;
 }
 const heading=create('div','Bearbeitungsentwurf','Editing draft');heading.className='card-title';
 const text=create('p','Format, Bildausschnitt, Text und Video-Einstellungen bearbeiten. Änderungen findest du auf History.','Edit the format, crop, text and video settings. You can find your changes in History.');
 const link=create('a','Bearbeitungsentwurf öffnen →','Open editing draft →');link.href=href;link.target='_blank';link.rel='noopener';link.className='primary';link.style.cssText='display:inline-block;padding:12px 18px;border-radius:9px;background:#4a60d8;color:white;text-decoration:none;font:inherit';
 card.replaceChildren(heading,text,link);return {destroy(){card.replaceChildren(...original);}};
}
