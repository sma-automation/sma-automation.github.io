const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const loaded=import('../n8n/publishing/gallery-private-server-runner.mjs');
const safe=()=>({
 same_login_role:true,can_login:true,superuser:false,bypass_rls:false,
 create_role:false,create_db:false,inherited_reader:true,
 can_read_snapshot:true,may_touch_gallery_jobs:false,
 may_touch_media_catalog:false,may_touch_storage_catalog:false,
 session_read_only:true
});

test('private gallery worker only allows a LOGIN that inherits the narrow reader role',async()=>{
 const {assertGalleryDbRolePreflight}=await loaded;
 assert.equal(assertGalleryDbRolePreflight(safe()),true);
 const unsafeVariants=[
  ['same_login_role',false],['can_login',false],['superuser',true],
  ['bypass_rls',true],['create_role',true],['create_db',true],
  ['inherited_reader',false],['can_read_snapshot',false],
  ['may_touch_gallery_jobs',true],['may_touch_media_catalog',true],
  ['may_touch_storage_catalog',true],['session_read_only',false]
 ];
 for(const [key,value] of unsafeVariants){
  assert.throws(()=>assertGalleryDbRolePreflight({...safe(),[key]:value}),
   /PRIVATE_GALLERY_DB_ROLE_UNSAFE/,key);
 }
 assert.throws(()=>assertGalleryDbRolePreflight(null),/PRIVATE_GALLERY_DB_ROLE_UNSAFE/);
 assert.throws(()=>assertGalleryDbRolePreflight({}),/PRIVATE_GALLERY_DB_ROLE_UNSAFE/);
});

test('read-only SQL gate is called before the first gallery snapshot',async()=>{
 const source=readFileSync('n8n/publishing/gallery-private-server-runner.mjs','utf8');
 const roleCheck=source.indexOf('assertGalleryDbRolePreflight(access.rows[0]);');
 const mediaStart=source.indexOf('  const result=await runGalleryPrivateServerReadOnly({');
 assert(roleCheck>0&&mediaStart>roleCheck,'role must be verified before any file access');
 assert.match(source,/await db[.]query\('SET default_transaction_read_only = on'\)/);
 assert.match(source,/pg_has_role\(current_user,'sma_gallery_snapshot_reader','USAGE'\)/);
 assert.match(source,/r[.]rolbypassrls as bypass_rls/);
 assert.match(source,/r[.]rolcanlogin as can_login/);
 assert.match(source,/has_table_privilege\(current_user,'storage[.]objects'/);
 assert.doesNotMatch(source,/SET ROLE service_role|SET ROLE postgres|ALTER ROLE/i);
});

test('private DB role SQL never provisions a login, password, or storage permissions',()=>{
 const sql=readFileSync('supabase/sql/gallery-worker-snapshot-reader-role.sql','utf8');
 assert.match(sql,/create role sma_gallery_snapshot_reader\s+nologin/);
 assert.match(sql,/grant execute on function sma_private[.]gallery_worker_snapshot_v1\(uuid\)\s+to sma_gallery_snapshot_reader/);
 assert.doesNotMatch(sql,/create role [^\n]+ login|alter role|grant (select|insert|update|delete) on/i);
 assert.doesNotMatch(sql,/(grant|alter|create)[\s\S]*?password\s*'/i);
});
