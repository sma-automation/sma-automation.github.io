import {blake3} from '@noble/hashes/blake3.js';
// Same content-addressing convention as Cloudflare's deploy-helpers hashFile.
export function hashContent(text,name){
 const bytes=new TextEncoder().encode(text),base64=btoa(String.fromCharCode(...bytes)),extension=name.includes('.')?name.split('.').at(-1):'';
 return Array.from(blake3(new TextEncoder().encode(base64+extension)),b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
}
