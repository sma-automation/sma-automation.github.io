export const hashtagMessage='Bitte höchstens drei unterschiedliche Hashtags mit je 1–50 Buchstaben, Ziffern oder Unterstrichen eingeben. Mit Leerzeichen trennen; leer lassen entfernt alle Hashtags.';

export function parseHashtags(value) {
 if(typeof value!=='string'||value.length>1000)throw Error(hashtagMessage);
 const tags=value.trim()?value.trim().split(/\s+/u).map(tag=>tag.replace(/^#/u,'').normalize('NFC')):[];
 if(tags.length>3||tags.some(tag=>[...tag].length<1||[...tag].length>50||!/^[_\p{L}\p{N}]+$/u.test(tag))||new Set(tags.map(tag=>tag.toLocaleLowerCase('de'))).size!==tags.length)throw Error(hashtagMessage);
 return tags;
}

export function addHashtagField(doc,card,platform,tags) {
 const box=doc.createElement('div');box.className='field';
 const label=doc.createElement('label');label.htmlFor=platform+'-hashtags';label.textContent='Hashtags';
 const input=doc.createElement('input');input.id=label.htmlFor;input.dataset.field='hashtags';input.maxLength=1000;input.value=tags.map(tag=>'#'+tag).join(' ');
 const hint=doc.createElement('p');hint.className='note';hint.id=platform+'-hashtags-hint';hint.textContent='Bis zu drei Hashtags, mit Leerzeichen getrennt. Leer lassen entfernt alle.';
 input.setAttribute('aria-describedby',hint.id);box.append(label,input,hint);card.append(box);return input;
}
