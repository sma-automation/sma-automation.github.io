import assert from 'node:assert/strict';

export async function checkProductComparison({db,first,load,output,profile}){
  await db.exec(await load('publication-product-comparison.sql'));
  await db.exec('begin');
  const digest=output.revision.split(':')[1];
  await db.query(`insert into sma_private.publication_magic_results_v1(asset_id,asset_revision,policy_version,
    user_id,customer_id,n8n_kunde_id,kunde_email,status,content_sha256,result)
    select $1,$2,'magic-video-2026-11-03.1',$3,1,'fixture','fixture@example.test','completed',$4,
      jsonb_build_object('audio_status','transcribed','observations','["Ein rotes Gerät an der Tür"]'::jsonb,
        'evidence',jsonb_build_object('source_sha256',$4::text,'source_size_bytes',$5::bigint,'technical',e.local_probe->'technical'))
    from sma_private.publication_editor_exports_v1 e where media_asset_id=$1`,[output.id,output.revision,output.user_id,digest,output.size_bytes]);
  const platforms=['youtube','tiktok'];
  for(const platform of platforms){
    const binding=await first(`select binding value from sma_private.publication_comparisons_v1 where binding->>'platform'=$1 limit 1`,[platform]);
    const rpc=(action,lease=null,result=null)=>first('select public.sma_publication_comparison_v1($1,$2,$3,$4) value',[action,binding,lease,result]);
    const result=(start,scope)=>({scope,policy_version:start.policy_version,source_fingerprint:start.source_fingerprint,
      verdict:'consistent_with_evidence',issues:[],can_upload:false,can_publish:false});
    // A source profile for the parent alone cannot validate this original-video comparison.
    const ordinary=await rpc('start');
    assert.equal(ordinary.state,'processing');assert.equal(ordinary.product_context,null);
    assert.equal((await rpc('finish',ordinary.lease_id,result(ordinary,'assisted_video_and_product_facts'))).code,'INVALID_RESULT');
    assert.equal((await rpc('finish',ordinary.lease_id,result(ordinary,'stored_video_observations_ocr_transcript'))).state,'completed');
    await db.query('insert into sma_private.publication_product_sources_v1 values(1,$1,$2,$3)',[output.user_id,digest,profile]);
    const start=await rpc('start');assert.equal(start.product_context.name,'Hotelgriff');
    assert.notEqual(start.source_fingerprint,ordinary.source_fingerprint);
    const assessed=result(start,'assisted_video_and_product_facts');
    assert.equal((await rpc('finish',start.lease_id,{...assessed,can_publish:true})).code,'INVALID_RESULT');
    assert.equal((await rpc('finish',start.lease_id,assessed)).state,'completed');
    assert.deepEqual((await rpc('get')).result,assessed);
    const baseMedia={asset_id:output.id,asset_revision:output.revision,checks:[],can_publish:false};
    const media=await first('select sma_private.publication_comparison_media_v1($1,$2,$3) value',[binding,start.draft,baseMedia]);
    assert.equal(media.checks[0].status,'pass');assert.match(media.checks[0].message,/Assistenzprüfung/);assert.equal(media.can_publish,false);
    await db.query("update sma_private.publication_product_profiles_v1 set purpose=purpose||' Ergänzt.' where id=$1",[profile]);
    assert.equal((await rpc('get')).state,'unreviewed');
    await db.query('delete from sma_private.publication_product_sources_v1 where sha256=$1',[digest]);
  }
  for(const role of ['anon','authenticated']){
    assert.equal(await first("select has_function_privilege($1,'sma_private.publication_comparison_product_v1(sma_private.publication_files_v1)','execute') value",[role]),false);
  }
  await db.exec('rollback');
  console.log('Product comparison passed for both portals, evidence revisions, scoped results and unchanged upload permissions.');
}
