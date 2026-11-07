'use strict';
// Classic, self-contained MP4. Preserve the entire video track and every original
// media offset. Add only the AAC samples that the movie's presentation requires.
const LIMIT=24000000, RATE=48000, PRIMING=1024;
function invalid(){throw Error('BACKGROUND_UNSUPPORTED');}
function boxes(buf,start=0,end=buf.length){
 const result=[];
 while(start<end){
  if(result.length>=10000||end-start<8)invalid();
  const size=buf.readUInt32BE(start),type=buf.toString('latin1',start+4,start+8);
  if(size<8||size>end-start)invalid();
  result.push({type,start,end:start+size,body:start+8});start+=size;
 }
 return result;
}
function single(list,type){const found=list.filter(b=>b.type===type);if(found.length!==1)invalid();return found[0];}
function children(buf,b){return boxes(buf,b.body,b.end);}
function inside(buf,b,offset,length){if(offset<0||b.body+offset+length>b.end)invalid();return b.body+offset;}
function u32(n){const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;}
function box(type,...parts){return Buffer.concat([u32(8+parts.reduce((n,p)=>n+p.length,0)),Buffer.from(type,'ascii'),...parts]);}
function full(type,flags,...parts){return box(type,u32(flags),...parts);}
function timing(buf,b){
 const v=buf[inside(buf,b,0,1)];
 if(v!==0&&v!==1)invalid();
 const scale=buf.readUInt32BE(inside(buf,b,v?20:12,4));
 const ticks=v?Number(buf.readBigUInt64BE(inside(buf,b,24,8))):buf.readUInt32BE(inside(buf,b,16,4));
 if(!scale||!Number.isSafeInteger(ticks)||ticks<1||ticks>0xffffffff||ticks/scale>60.001)invalid();
 return {scale,ticks};
}
function inspectVideo(buf){
 if(!Buffer.isBuffer(buf)||buf.length<12||buf.length>LIMIT)invalid();
 const top=boxes(buf);if(top[0]?.type!=='ftyp'||top.some(b=>!['ftyp','moov','mdat','free','skip','wide'].includes(b.type)))invalid();
 const moov=single(top,'moov'),m=children(buf,moov);
 if(m.some(b=>b.type==='mvex'))invalid();
 const tracks=m.filter(b=>b.type==='trak').map(trak=>{
  const t=children(buf,trak),mdia=children(buf,single(t,'mdia')),handler=single(mdia,'hdlr');
  return {t,mdia,kind:buf.toString('ascii',inside(buf,handler,8,4),handler.body+12)};
 });
 if(tracks.some(t=>t.kind==='soun'))return {state:'audio_present'};
 if(tracks.length!==1||tracks[0].kind!=='vide')invalid();
 const mvhd=single(m,'mvhd'),clock=timing(buf,mvhd),track=tracks[0],tkhd=single(track.t,'tkhd');
 const version=buf[inside(buf,tkhd,0,1)];if(version>1)invalid();
 const trackId=buf.readUInt32BE(inside(buf,tkhd,version?20:12,4));
 if(!trackId||trackId>=0xfffffffd)invalid();
 const minf=children(buf,single(track.mdia,'minf')),stbl=children(buf,single(minf,'stbl'));
 const dref=single(children(buf,single(minf,'dinf')),'dref');
 const refs=boxes(buf,inside(buf,dref,8,0),dref.end);
 if(refs.length!==1||refs[0].type!=='url '||buf.readUInt32BE(inside(buf,refs[0],0,4))!==1)invalid();
 const stsd=single(stbl,'stsd'),desc=boxes(buf,inside(buf,stsd,8,0),stsd.end);
 if(desc.length!==1||!['avc1','avc3','hvc1','hev1'].includes(desc[0].type))invalid();
 const offsets=stbl.filter(b=>['stco','co64'].includes(b.type));
 if(offsets.length!==1)invalid();
 const o=offsets[0],count=buf.readUInt32BE(inside(buf,o,4,4)),width=o.type==='stco'?4:8;
 const data=top.filter(b=>b.type==='mdat');
 if(!count||count>100000||data.length!==1||o.end-o.body!==8+width*count)invalid();
 for(let i=0;i<count;i++){
  const pos=o.body+8+width*i;
  const at=width===4?buf.readUInt32BE(pos):Number(buf.readBigUInt64BE(pos));
  if(at<data[0].body||at>=data[0].end)invalid();
 }
 return {state:'silent',moov,mvhd,clock,trackId:trackId+1};
}
function aacSamples(audio,count){
 if(!Buffer.isBuffer(audio)||audio.length>1500000||count>2820)invalid();
 const frames=[];let offset=0;
 while(frames.length<count){
  if(offset+7>audio.length)invalid();
  const h=audio.subarray(offset,offset+7);
  const length=((h[3]&3)<<11)|(h[4]<<3)|(h[5]>>5);
  if(h[0]!==255||h[1]!==0xf1||h[2]>>6!==1||((h[2]>>2)&15)!==3||
     (((h[2]&1)<<2)|(h[3]>>6))!==2||(h[6]&3)!==0||length<=7||offset+length>audio.length)invalid();
  frames.push(audio.subarray(offset+7,offset+length));offset+=length;
 }
 return frames;
}
function audioTrack(id,ticks,samples,offset){
 const matrix=Buffer.from('000100000000000000000000000000000001000000000000000000000000000040000000','hex');
 const tkhd=full('tkhd',3,Buffer.alloc(8),u32(id),u32(0),u32(ticks),Buffer.alloc(12),Buffer.from([1,0,0,0]),matrix,Buffer.alloc(8));
 const edts=box('edts',full('elst',0,u32(1),u32(ticks),u32(PRIMING),u32(65536)));
 const mdhd=full('mdhd',0,Buffer.alloc(8),u32(RATE),u32(samples.length*1024),Buffer.from([0x55,0xc4,0,0]));
 const hdlr=full('hdlr',0,u32(0),Buffer.from('soun'),Buffer.alloc(12),Buffer.from('SMA Audio\0'));
 // MPEG-4 AudioSpecificConfig 0x1190 = AAC-LC, 48 kHz, two channels.
 const esds=full('esds',0,Buffer.from('0319000100041140150000000001f4000001f40005021190060102','hex'));
 const entry=Buffer.alloc(28);entry.writeUInt16BE(1,6);entry.writeUInt16BE(2,16);entry.writeUInt16BE(16,18);entry.writeUInt32BE(RATE*65536,24);
 const sizes=Buffer.alloc(samples.length*4);samples.forEach((s,i)=>sizes.writeUInt32BE(s.length,i*4));
 const stbl=box('stbl',full('stsd',0,u32(1),box('mp4a',entry,esds)),full('stts',0,u32(1),u32(samples.length),u32(1024)),
  full('stsc',0,u32(1),u32(1),u32(samples.length),u32(1)),full('stsz',0,u32(0),u32(samples.length),sizes),full('stco',0,u32(1),u32(offset)));
 const dinf=box('dinf',full('dref',0,u32(1),full('url ',1)));
 return box('trak',tkhd,edts,box('mdia',mdhd,hdlr,box('minf',full('smhd',0,u32(0)),dinf,stbl)));
}
function soundtrackMP4(video,audio){
 const v=inspectVideo(video);if(v.state!=='silent')return v;
 const frames=aacSamples(audio,Math.ceil((v.clock.ticks/v.clock.scale*RATE+PRIMING)/1024));
 const track=audioTrack(v.trackId,v.clock.ticks,frames,video.length+8);
 const header=Buffer.from(video.subarray(v.moov.body,v.moov.end));
 header.writeUInt32BE(v.trackId+1,v.mvhd.end-v.moov.body-4);
 const moov=box('moov',header,track),audioData=box('mdat',...frames);
 if(video.length+audioData.length+moov.length>LIMIT)invalid();
 const output=Buffer.concat([video,audioData,moov]);
 // Videodata stays in place, even with fast-start sources. Reclaim the old
 // metadata area as a free box; only the new movie header remains active.
 output.write('free',v.moov.start+4,'ascii');output.fill(0,v.moov.body,v.moov.end);
 return {state:'rendered',bytes:output};
}
module.exports={inspectVideo,soundtrackMP4};
