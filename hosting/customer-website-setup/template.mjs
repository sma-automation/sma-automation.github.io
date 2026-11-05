import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {publicAssets} from '../customer-website/build.mjs';
// Deterministic, public renderer only. No recursive copy and no customer data.
const files={};
for(const name of publicAssets)files['assets/'+name]=await readFile(new URL('../../app/assets/'+name,import.meta.url),'utf8');
for(const name of ['index.html','page.mjs','404.html','_headers','robots.txt'])files[name]=await readFile(new URL('../customer-website/'+name,import.meta.url),'utf8');
const version=createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0,20);
await writeFile(new URL('../../supabase/functions/sma-website-setup/template.json',import.meta.url),JSON.stringify({version,files}));
console.log(JSON.stringify({publicTemplateFiles:Object.keys(files).length,version}));
