import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import {installWordpressFixture} from './sql-runtime/wordpress-fixture.mjs';
const db=new PGlite();
try{
 await installWordpressFixture(db);
 for(const name of ['website-connection','website-provider','wordpress-tickets','wordpress-sync']){
  const results=await db.exec(await readFile(new URL('./'+name+'.sql',import.meta.url),'utf8'));
  console.log(results.at(-1).rows[0].result);
 }
 const residue=await db.query('select (select count(*) from public.sma_kunden)+(select count(*) from vault.secrets) as count');
 if(Number(residue.rows[0].count)!==0)throw new Error('SQL fixtures did not roll back');
}catch(e){console.error(e.message,e.where||'');process.exitCode=1;}finally{await db.close();}
