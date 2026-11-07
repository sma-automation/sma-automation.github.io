import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

export async function checkExportReference({db,load,first,probe,save}) {
  await db.exec(await readFile(new URL('./export-reference-comparison-baseline.sql',import.meta.url),'utf8'));
  const files=await load('publication-files.sql');
  await db.exec(files.slice(files.indexOf('create or replace function public.sma_publication_assignment_v1'),files.indexOf('-- Keep general templates separate')));
  const magic=await load('publication-video-magic.sql');
  await db.exec(magic.slice(0,magic.indexOf('create or replace function sma_private.publication_video_magic_request_v1')));
  await db.exec(await load('publication-export-reference.sql'));
  const shop='https://sma-automation.com/app/shop.html?shop=sample';
  await db.exec("alter table public.sma_kunden add column shop_oeffentlich boolean default true, add column shop_slug text default 'sample'");
  const media=await first("select to_jsonb(f) value from sma_private.publication_files_v1 f");
  const expected={title:'Ein kurzer Test',body:'Das Gerät an der Tür.',caption:'Das Gerät an der Tür.\n\n🛒 Zum Shop: '+shop,hashtags:[],review_notes:[]};
  const measured={...probe,content_observations:{source:'assisted_viewing',visual:'Ein Gerät an der Tür.',frames_viewed:90}};
  await save(measured);
  await db.query(`update sma_private.publication_editor_exports_v1 set local_probe=local_probe||jsonb_build_object('text_reference',
   jsonb_build_object('source','reviewed_export_reference_v1','asset_revision',local_probe->>'asset_revision',
   'evidence_hash',encode(sha256(convert_to(local_probe::text,'UTF8')),'hex'),'draft',$1::jsonb))`,[JSON.stringify(expected)]);
  for (const platform of ['youtube','tiktok']) {
    const d={...expected,platform};
    const id=await first(`insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url,status,preview)
      values(gen_random_uuid(),$1,1,'{}',$2,'completed',$3) returning id value`,[media.user_id,shop,JSON.stringify({drafts:[d]})]);
    await db.query('insert into sma_private.publication_assignments_v1(asset_id,platform,preview_id,preview_revision,asset_revision,draft) values($1,$2,$3,1,$4,$5)',[media.id,platform,id,media.revision,JSON.stringify(d)]);
    const binding={version:1,asset_id:media.id,asset_revision:media.revision,customer_id:1,drive_file_id:media.drive_file_id,
      assignment_revision:1,preview_revision:1,preview_id:id,media_kind:'video',shop_url:shop,platform};
    const rpc=(action,b=binding)=>first('select public.sma_publication_comparison_v1($1,$2) value',[action,JSON.stringify(b)]);
    assert.equal((await rpc('get')).state,'unreviewed');
    const started=await rpc('start');
    assert.equal(started.result?.verdict,'consistent_with_evidence');
    assert.equal(started.result.scope,'reviewed_export_reference_v1');
    assert.equal(started.can_publish,false);
    assert.deepEqual((await rpc('start')).result,started.result);
    assert.equal((await rpc('get',{...binding,preview_revision:2})).code,'ASSIGNMENT_CHANGED');
    for (const edit of [{title:'Andere Aussage'},{body:'Ein anderer Inhalt.'},{caption:d.caption+'!'}, {hashtags:['extra']}, {review_notes:['Offene Frage']}]) {
      await db.exec('begin');
      await db.query('update sma_private.publication_assignments_v1 set draft=$1, revision=2 where platform=$2',[JSON.stringify({...d,...edit}),platform]);
      assert.equal((await rpc('get',{...binding,assignment_revision:2})).state,'unreviewed');
      assert.equal((await rpc('start',{...binding,assignment_revision:2})).result.verdict,'insufficient_evidence');
      await db.exec('rollback');
    }
    await db.exec('begin');
    await db.exec("update sma_private.publication_editor_exports_v1 set local_probe=jsonb_set(local_probe,'{content_observations,visual}',to_jsonb('Neue Beobachtung'::text))");
    assert.equal((await rpc('get')).code,'VIDEO_EVIDENCE_REQUIRED');
    await db.exec('rollback');
  }
  assert.equal(await first("select count(*)::int value from sma_private.publication_comparisons_v1 where state='completed'"),2);
  assert.equal(await first("select has_function_privilege('authenticated','sma_private.publication_export_reference_v1(sma_private.publication_files_v1)','execute') value"),false);
}
