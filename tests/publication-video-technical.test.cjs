const test=require('node:test'),assert=require('node:assert/strict');
const {technicalEvidence}=require('../n8n/publishing/video-evidence.cjs');
const t=require('./video-technical-fixture.cjs');
test('technical evidence requires exact typed fields, complete decoding and bounded frame observations',()=>{
 assert.equal(technicalEvidence(t,'no_audio_stream'),t);
 for(const patch of [{decode:'partial'},{decode:true},{schema:'old'},{frame_rate_den:0},{frame_rate_num:NaN},{decoded_frames:0},{decoded_frames:14401},{width_px:4097},{max_frame_interval_us:1},{min_frame_interval_us:null},{video_bit_rate_bps:-1},{extra:true},{audio_codec:'aac'},{audio_channels:2}])assert.throws(()=>technicalEvidence({...t,...patch},'no_audio_stream'));
 for(const key of Object.keys(t)){const copy={...t};delete copy[key];assert.throws(()=>technicalEvidence(copy,'no_audio_stream'));}
 const single={...t,decoded_frames:1,min_frame_interval_us:null,max_frame_interval_us:null};assert.equal(technicalEvidence(single,'no_audio_stream'),single);
 assert.throws(()=>technicalEvidence({...single,min_frame_interval_us:40000},'no_audio_stream'));
});
test('unknown audio bitrate is preserved; a real audio stream needs codec, channels and sample rate',()=>{
 const audio={...t,audio_codec:'aac',audio_channels:2,audio_sample_rate_hz:48000};
 assert.equal(technicalEvidence(audio,'extracted'),audio);
 for(const patch of [{audio_codec:null},{audio_channels:0},{audio_sample_rate_hz:null},{audio_sample_rate_hz:'48000'},{audio_bit_rate_bps:Infinity}])assert.throws(()=>technicalEvidence({...audio,...patch},'extracted'));
});
