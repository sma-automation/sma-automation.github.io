import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readDomainBinding} from '../../app/assets/customer-website-domain-model.mjs';

const source=new URL('../../app/assets/',import.meta.url);
export const publicAssets=Object.freeze([
 'customer-website-domain-model.mjs','customer-website-domain-view.mjs','customer-website-public-api.mjs',
 'customer-website-view.mjs','customer-website-model.mjs','customer-website-render.mjs','customer-website.css',
 'company-profile-model.mjs','website-domain-model.mjs','shop-catalog-model.mjs','shop-catalog.mjs'
]);
// Explicit allowlist: never recursively copy the repository, dashboard or test fixtures.
export async function buildCustomerWebsite({origin,siteId,out}){
 const binding=readDomainBinding({origin,siteId});
 if(origin==='https://sma-automation.com'||typeof out!=='string'||!out.trim())throw Error('INVALID_BUILD_TARGET');
 const directory=resolve(out);
 try{if((await readdir(directory)).length)throw Error('OUTPUT_NOT_EMPTY');}catch(e){if(e.code!=='ENOENT')throw e;}
 const entries=await Promise.all([
  ...publicAssets.map(async name=>['assets/'+name,await readFile(new URL(name,source))]),
  ...['index.html','page.mjs','404.html','_headers','robots.txt'].map(async name=>[name,await readFile(new URL(name,import.meta.url))])
 ]);
 entries.push(['binding.mjs','export const binding=Object.freeze('+JSON.stringify(binding)+');\n']);
 for(const [name,content] of entries){const path=resolve(directory,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,content,{flag:'wx'});}
 return {directory,files:entries.map(([name])=>name).sort(),binding};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const args=process.argv.slice(2),options={};
 if(args.length!==6||args.some((value,i)=>i%2===0&&!['--origin','--site','--out'].includes(value))||new Set(args.filter((_,i)=>i%2===0)).size!==3)throw Error('Usage: node hosting/customer-website/build.mjs --origin https://test.example.com --site UUID --out EMPTY_DIRECTORY');
 for(let i=0;i<args.length;i+=2)options[args[i].slice(2)]=args[i+1];
 const result=await buildCustomerWebsite({origin:options.origin,siteId:options.site,out:options.out});
 console.log(JSON.stringify({directory:result.directory,files:result.files.length,origin:result.binding.origin}));
}
