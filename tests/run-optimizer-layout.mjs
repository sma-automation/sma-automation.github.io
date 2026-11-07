// Exercise the actual page and workspace styles in Chromium at CSS viewport sizes.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const asset = name => readFile(new URL('../app/' + name, import.meta.url), 'utf8');
let template = await asset('publication-preview.html');
for (const [tag, path] of template.matchAll(/<link rel="stylesheet" href="([^"?]+)\?[^"]+">/g)) {
  template = template.replace(tag, '<style>' + await asset(path) + '</style>');
}
const workspace = (await asset('assets/optimizer-workspace.mjs')).replace('export function', 'function');
const orderDialog = (await asset('assets/publication-order.mjs')).replaceAll('export ', '');
const sizes = [
  ['YouTube', 1008, 728], ['YouTube', 390, 844], ['TikTok', 320, 568],
  ['Instagram', 840, 710], ['Facebook', 960, 690],
];
function frame([portal, width, height]) {
  const script = `
    ${workspace}
    ${orderDialog}
    const $ = id => document.getElementById(id);
    const portal = ${JSON.stringify(portal)};
    document.body.classList.add('portal-mode');
    const controller = createOptimizerWorkspace(document, portal, () => {}, {
      getPreview: () => ({draft:{title:'Testbeitrag', body:'Beitragstext zur ausgewählten Datei.'}}),
    });
    installOrderReview(document, {host:$('workspacePreviewHeader'), portalName:portal});
    controller.selection({name:'Testvideo', media_kind:'video', width_px:720, height_px:1280});
    $('assetPreview').hidden = false;
    controller.show('preview');
    const box = id => $(id).getBoundingClientRect();
    const media = box('assetPreviewMedia'), body = box('workspacePostBody');
    const viewport = document.documentElement;
    const result = {
      portal, width:innerWidth, action:box('preparePublicationOrder').bottom+scrollY,
      stage:media.height, fits:viewport.scrollWidth<=innerWidth,
      beside:body.left>=media.right-1, page:viewport.scrollHeight
    };
    parent.postMessage(result, '*');
  `;
  const html = template.replace(/<script type="module" src="assets\/publication-preview.js[^"]*"><\/script>/, () => '<script>' + script + '</script>');
  const escaped = html.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  return '<iframe width="'+width+'" height="'+height+'" srcdoc="'+escaped+'"></iframe>';
}
const folder = await mkdtemp(join(tmpdir(), 'sma-layout-'));
try {
  const fixture = join(folder, 'preview.html');
  const host = `<script>addEventListener('message',e=>{const node=document.createElement('output');node.textContent=JSON.stringify(e.data);document.body.append(node);});</script>`;
  await writeFile(fixture, '<!DOCTYPE html><html><body>'+host+sizes.map(frame).join('')+'</body></html>');
  const output = execFileSync(process.env.CHROME_BIN || 'google-chrome', [
    '--headless','--disable-gpu','--disable-background-networking','--disable-dev-shm-usage','--no-sandbox',
    '--user-data-dir='+join(folder,'profile'),'--virtual-time-budget=6000','--dump-dom',pathToFileURL(fixture).href
  ], {encoding:'utf8',maxBuffer:8*1024*1024,timeout:45000,stdio:['ignore','pipe','pipe']});
  const reports = Array.from(output.matchAll(/<output>(\{[^<]*\})<\/output>/g), match=>JSON.parse(match[1]));
  assert.equal(reports.length, sizes.length, 'Every viewport must report its layout');
  for (const [portal,width,height] of sizes) {
    const report = reports.find(r=>r.portal===portal&&r.width===width);
    assert.ok(report, portal+' '+width);
    console.log(report);
    assert.ok(report.fits && report.action < height/2 && report.stage <= height*0.51);
    assert.equal(report.beside,width>=660);
    if(width>=660)assert.ok(report.page<=height,'Short portrait post should fit one desktop screen');
  }
} finally {
  await rm(folder,{force:true,recursive:true});
}
