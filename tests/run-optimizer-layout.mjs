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
const workspace = (await asset('assets/publication-destination.mjs')).replace('export function', 'function') +
  (await asset('assets/optimizer-workspace.mjs')).replace(/^import .*;$/gm, '').replace('export function', 'function');
const productLookup = (await asset('assets/publication-catalog-lookup.mjs')).replaceAll('export function', 'function');
const draftConflict = (await asset('assets/publication-draft-conflict.mjs')).replace('export function', 'function');
const orderDialog = (await asset('assets/publication-order.mjs')).replaceAll('export ', '');
const sizes = [
  ['YouTube', 1008, 728], ['YouTube', 390, 844], ['TikTok', 320, 568],
  ['Instagram', 840, 710], ['Facebook', 960, 690],
];
function frame([portal, width, height]) {
  const script = `
    ${workspace}
    ${orderDialog}
    ${productLookup}
    const compareDrafts = (()=>{${draftConflict};return mountDraftConflict;})();
    const $ = id => document.getElementById(id);
    const portal = ${JSON.stringify(portal)};
    document.body.classList.add('portal-mode');
    const previewData={draft:{title:'Testbeitrag',body:'Beitragstext zur ausgewählten Datei.'}};
    const controller = createOptimizerWorkspace(document, portal, () => {}, {
      getPreview: () => previewData,
      onEditLink: () => controller.show('source')
    });
    installOrderReview(document, {host:$('workspacePreviewPrimary'), portalName:portal});
    controller.selection({name:'Testvideo', media_kind:'video', width_px:720, height_px:1280});
    $('assetPreview').hidden = false;
    controller.show('preview');
    const box = id => $(id).getBoundingClientRect();
    const media = box('assetPreviewMedia'), body = box('workspacePostBody');
    const viewport = document.documentElement;
    const fileActions=$('workspacePreviewActions');
    const uploadHiddenUntilOpened=!fileActions.open&&box('deviceBrowse').width===0;
    fileActions.open=true;
    const uploadFits=box('deviceBrowse').width>0&&box('deviceBrowse').right<=innerWidth;
    fileActions.open=false;
    const result = {
      portal, width:innerWidth, action:box('preparePublicationOrder').bottom+scrollY,
      stage:media.height, fits:viewport.scrollWidth<=innerWidth,
      uploadInPreview:$('deviceBrowse').parentElement?.id==='workspacePreviewActions',
      uploadProgressInPreview:$('uploadPanel').parentElement?.id==='workspacePreview',
      uploadFits,uploadHiddenUntilOpened,
      beside:body.left>=media.right-1, page:viewport.scrollHeight
    };
    previewData.draftStep={target:'magic_text',label:'✨ Magic Effect · Beitragstext erstellen',note:'Die Dateivorschau hat noch keinen Beitrag.'};
    controller.refreshPreview();
    const magicBox=box('workspaceDraftAction'),manualBox=box('workspaceManualDraft');
    result.magicOfferFits=magicBox.width>0&&magicBox.right<=innerWidth&&manualBox.width>0&&manualBox.right<=innerWidth&&viewport.scrollWidth<=innerWidth;
    previewData.draftStep={target:'save',label:'Entwurf speichern',note:'Die Vorschau zeigt deine ungespeicherten Änderungen.'};
    controller.refreshPreview();
    result.manualHiddenAfterSave=$('workspaceManualDraft').hidden;
    const actionBox=box('workspaceDraftAction');
    result.draftActionFits=actionBox.width>0&&actionBox.right<=innerWidth&&viewport.scrollWidth<=innerWidth&&box('preparePublicationOrder').width===0;
    previewData.draftStep={target:'tiktok-hashtags',label:'Hashtags korrigieren',note:'Der Hashtag #'+ 'W'.repeat(50)+' ist doppelt. Verwende ihn nur einmal.'};
    controller.refreshPreview();
    result.correctionFits=box('workspaceDraftNotice').right<=innerWidth&&box('workspaceDraftAction').right<=innerWidth&&viewport.scrollWidth<=innerWidth;
    delete previewData.draftStep;
    Object.assign(previewData.draft,{shop_url:'https://sma-automation.com/app/shop.html?shop=fixture',product_id:'fixture-1'});
    previewData.linkNotice='Der gewählte Artikel ist nicht mehr verfügbar.';
    controller.refreshPreview();
    result.withdrawnVisible=box('workspaceEditLink').width>0&&!$('workspacePostShop').hasAttribute('href')&&viewport.scrollWidth<=innerWidth;
    $('workspaceEditLink').click();
    const item={name:'Synthetischer Testartikel',sku:'TEST-01',product_id:'fixture-1',purpose:'Testartikel'};
    const lookup=mountCatalogLookup(document,async()=>({choices:[item],more:false}));
    lookup.setContext({id:'fixture-video',revision:'version:1'},portal);
    $('catalogLookup').open=true;$('catalogQuery').value='TEST';
    $('catalogSearch').click();
    Promise.resolve().then(async()=>{
      result.lookupVisible=box('catalogProduct').width>0&&viewport.scrollWidth<=innerWidth;
      result.noPreselection=$('catalogProduct').value==='';
      $('catalogProduct').value=item.product_id;
      result.selectedProduct=(await lookup.validate()).product_id;
      $('result').hidden=false;
      controller.setVariant({
        title:'Eine weitere sachliche Textvariante',
        body:'Anderer Beschreibungstext zur gleichen Datei. '.repeat(8),
        hashtags:['SMA','WeitereVersion']
      });
      controller.show('source');
      const variant=box('workspaceVariantPanel');
      result.variantBeforeSaved=variant.top<box('result').top;
      controller.revealVariant();
      result.variantFits=variant.width>0&&variant.left>=0&&variant.right<=innerWidth&&
        ['workspaceVariantAdopt','workspaceVariantNext','workspaceVariantDiscard'].every(id=>{
          const b=box(id);return b.width>0&&b.left>=0&&b.right<=innerWidth;
        })&&viewport.scrollWidth<=innerWidth;
      controller.setVariant(null);
      controller.show('preview');
      if(['YouTube','TikTok'].includes(portal)){
        const base={title:'Titel',body:'Vorher',hashtags:[],product_id:null};
        const mine={...base,body:'X'.repeat(320)},saved={...base,body:'Andere Fassung',hashtags:['Gespeichert']};
        const picking=compareDrafts(document).choose(base,mine,saved);
        const dialog=$('draftConflictDialog'),apply=$('draftConflictApply');
        result.comparisonFits=dialog.open&&box('draftConflictDialog').width<=innerWidth&&dialog.scrollWidth<=dialog.clientWidth+1;
        result.requiresChoice=apply.disabled;
        $('draftConflictFields').querySelector('input').click();apply.click();
        const chosen=await picking;
        result.merged=chosen.body===mine.body&&chosen.hashtags[0]==='Gespeichert'&&!dialog.open;
      }
      parent.postMessage(result, '*');
    });
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
    assert.ok(report.correctionFits && report.draftActionFits && report.fits && report.action < height/2 && report.stage <= height*0.51);
    assert.ok(report.magicOfferFits&&report.manualHiddenAfterSave,'One-click Magic and manual fallback fit '+portal+' '+width);
    assert.ok(report.uploadInPreview&&report.uploadProgressInPreview&&report.uploadFits&&report.uploadHiddenUntilOpened,'Upload control must remain hidden until the file menu opens and fit '+portal+' at '+width);
    assert.ok(report.variantFits,'Variant comparison and controls must fit '+portal+' at '+width);
    assert.ok(report.variantBeforeSaved,'Candidate must appear above the saved editor '+portal+' at '+width);
    assert.equal(report.beside,width>=660);
    assert.ok(report.withdrawnVisible&&report.lookupVisible&&report.noPreselection);
    assert.equal(report.selectedProduct,'fixture-1');
    if(['YouTube','TikTok'].includes(portal))assert.ok(report.comparisonFits&&report.requiresChoice&&report.merged,'Draft comparison at width '+width);
    if(width>=660)assert.ok(report.page<=height,'Short portrait post should fit one desktop screen');
  }
} finally {
  await rm(folder,{force:true,recursive:true});
}
