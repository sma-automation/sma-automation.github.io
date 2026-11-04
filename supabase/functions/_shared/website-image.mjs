// The browser re-encodes uploads; the server accepts only bounded PNG/JPEG data.
export const imageMaxBytes=2_000_000;
const fail=()=>{throw Object.assign(new Error('IMAGE_FORMAT'),{code:'IMAGE_FORMAT'});};
const dims=(width,height,mime)=>{if(!width||!height||width>1600||height>1600||width*height>2_560_000)fail();return {width,height,mime};};
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function inspectWebsiteImage(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<24||bytes.length>imageMaxBytes)fail();
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)){
  let at=8,info=null,data=false,ended=false;
  while(at+12<=bytes.length){
   const size=view.getUint32(at),end=at+12+size;if(end>bytes.length)fail();
   const type=String.fromCharCode(...bytes.subarray(at+4,at+8));
   if(crc32(bytes.subarray(at+4,at+8+size))!==view.getUint32(at+8+size))fail();
   if(!info&&type!=='IHDR')fail();
   if(type==='IHDR'){
    if(info||size!==13||bytes[at+16]!==8||![0,2,3,4,6].includes(bytes[at+17])||bytes[at+18]||bytes[at+19]||bytes[at+20])fail();
    info=dims(view.getUint32(at+8),view.getUint32(at+12),'image/png');
   }else if(type==='IDAT'){if(!size)fail();data=true;}
   else if(type==='IEND'){if(size||!data||end!==bytes.length)fail();ended=true;}
   else if(!['sRGB','gAMA','cHRM','pHYs','PLTE','tRNS'].includes(type))fail();
   at=end;
  }
  if(!ended||at!==bytes.length)fail();return info;
 }
 if(bytes[0]===255&&bytes[1]===216){
  let at=2,info=null,scan=false;
  while(at<bytes.length){
   if(bytes[at++]!==255)fail();while(bytes[at]===255)at++;const marker=bytes[at++];
   if(marker===217){if(!scan||!info||at!==bytes.length)fail();return info;}
   if(![192,194,196,219,221,218,224,226].includes(marker)||at+2>bytes.length)fail();
   const length=view.getUint16(at);if(length<2||at+length>bytes.length)fail();
   if(marker===192||marker===194){if(info||length<8||bytes[at+2]!==8)fail();info=dims(view.getUint16(at+5),view.getUint16(at+3),'image/jpeg');}
   if(marker===224&&(length<7||String.fromCharCode(...bytes.subarray(at+2,at+7))!=='JFIF\0'))fail();
   if(marker===226){
    // Canvas JPEGs may include one bounded ICC color profile; EXIF/comments stay forbidden.
    if(length<144||length>16384||String.fromCharCode(...bytes.subarray(at+2,at+14))!=='ICC_PROFILE\0'||bytes[at+14]!==1||bytes[at+15]!==1||view.getUint32(at+16)!==length-16||String.fromCharCode(...bytes.subarray(at+52,at+56))!=='acsp')fail();
   }
   at+=length;
   if(marker===218){
    if(!info)fail();scan=true;
    while(at<bytes.length){if(bytes[at]!==255){at++;continue;}const next=bytes[at+1];if(next===0||next>=208&&next<=215){at+=2;continue;}break;}
   }
  }
 }
 fail();
}
export async function boundedImageBody(response,{timeoutMs=15000}={}){
 const length=response.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>imageMaxBytes))throw Object.assign(Error('IMAGE_SIZE'),{code:'IMAGE_SIZE'});
 const reader=response.body?.getReader();if(!reader)fail();const parts=[];let size=0,timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('UNAVAILABLE')),timeoutMs);});
 try{while(true){const {done,value}=await Promise.race([reader.read(),timeout]);if(done)break;size+=value.length;if(size>imageMaxBytes)throw Object.assign(Error('IMAGE_SIZE'),{code:'IMAGE_SIZE'});parts.push(value);}}
 finally{clearTimeout(timer);reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}return bytes;
}
export async function imageDigest(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
