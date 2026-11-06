export const MUSIC_MAX_BYTES=8000000;
export function readMusicSetting(m){
 if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).length!==6||Object.keys(m).some(k=>!['name','sha256','size_bytes','mime_type','volume','start_ms'].includes(k))||typeof m.name!=='string'||!m.name||Array.from(m.name).length>180||/[\u0000-\u001f\u007f]/.test(m.name)||! /^[a-f0-9]{64}$/.test(m.sha256)||!['audio/mpeg','audio/wav'].includes(m.mime_type)||!Number.isInteger(m.size_bytes)||m.size_bytes<12||m.size_bytes>MUSIC_MAX_BYTES||!Number.isInteger(m.volume)||m.volume<0||m.volume>100||!Number.isInteger(m.start_ms)||m.start_ms<0||m.start_ms>=600000)throw Error('MUSIC_INVALID');
 return Object.fromEntries(['name','sha256','size_bytes','mime_type','volume','start_ms'].map(k=>[k,m[k]]));
}
export async function musicHash(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');}
export async function inspectMusic(file){
 if(!file||file.size<12||file.size>MUSIC_MAX_BYTES||typeof file.name!=='string')throw Error('MUSIC_INVALID');
 const bytes=new Uint8Array(await file.arrayBuffer()),ascii=(start,end)=>String.fromCharCode(...bytes.slice(start,end));
 const mime=ascii(0,4)==='RIFF'&&ascii(8,12)==='WAVE'?'audio/wav':ascii(0,3)==='ID3'||bytes[0]===255&&(bytes[1]&224)===224?'audio/mpeg':null;
 return readMusicSetting({name:file.name,sha256:await musicHash(bytes),size_bytes:bytes.length,mime_type:mime,volume:25,start_ms:0});
}
export async function verifyMusicBytes(blob,setting){const m=readMusicSetting(setting);if(!blob||blob.size!==m.size_bytes||await musicHash(await blob.arrayBuffer())!==m.sha256)throw Error('MUSIC_REQUIRED');return blob;}
export function verifyMusicProbe(probe,setting){
 const m=readMusicSetting(setting),streams=probe?.streams,a=streams?.filter(s=>s.codec_type==='audio'),duration=Number(probe?.format?.duration)*1000;
 if(!Array.isArray(streams)||a.length!==1||streams.some(s=>s.codec_type!=='audio'&&!(s.codec_type==='video'&&s.disposition?.attached_pic===1))||!Number.isFinite(duration)||duration<=m.start_ms||duration>600000||!Number.isInteger(a[0].channels)||a[0].channels<1||a[0].channels>2||!Number.isFinite(Number(a[0].sample_rate))||Number(a[0].sample_rate)<8000||Number(a[0].sample_rate)>96000||!(m.mime_type==='audio/mpeg'?a[0].codec_name==='mp3':String(a[0].codec_name).startsWith('pcm_')))throw Error('MUSIC_INVALID');
 return {duration_ms:Math.round(duration)};
}
