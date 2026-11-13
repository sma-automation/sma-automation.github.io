import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from './dom-runtime/node_modules/playwright-core/index.mjs';
import {createShopCatalog} from '../app/assets/shop-catalog-model.mjs';

const shop = 'mobiler-testshop';
const site = 'https://sma-automation.com';
const wordpress = 'https://wordpress.example';
const shopUrl = site + '/app/shop.html?shop=' + shop;
const products = [
  {produkt_id:'foto_1', name:'Produkt ohne Bild', preis:9.90, bestand:1, shopify_aktiv:false},
  {produkt_id:'foto_2', name:'Produkt mit verfügbarem Bestand', preis:39.90, bestand:4, shopify_aktiv:true},
  {produkt_id:'foto_3', name:'Derzeit ausverkaufter Artikel', preis:34.90, bestand:0, shopify_aktiv:true},
].map(product => ({...product, waehrung:'EUR', bilder:[]}));
const api = new URL('https://bnvnmdxosbnuzedokqgh.supabase.co/functions/v1/sma-shop-produkte');
const embed = createShopCatalog(shopUrl);
const hostPage = `<!doctype html><html lang="de"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;padding:16px}</style><main>${embed.html}</main></html>`;
const appFiles = new Set(['shop.html', 'shop-catalog.html', 'assets/shop-catalog.css', 'assets/shop-catalog-page.mjs',
  'assets/shop-catalog.mjs', 'assets/shop-catalog-model.mjs', 'assets/website-domain-model.mjs']);

async function serveTestPages(route) {
  const url = new URL(route.request().url());
  if (route.request().method() !== 'GET') return route.abort();
  if (url.href === wordpress + '/') return route.fulfill({contentType:'text/html', body:hostPage});
  if (url.origin === api.origin && url.pathname === api.pathname && url.searchParams.get('shop') === shop) {
    const selected = url.searchParams.get('produkt');
    const rows = selected ? products.filter(product => product.produkt_id === selected) : products;
    return route.fulfill({headers:{'Access-Control-Allow-Origin':site}, json:{
      ok:true, shop:{slug:shop,name:'SMA Testshop'}, seite:1, pro_seite:10, seiten:1,
      gesamt:rows.length, produkte:rows, produkt_filter:selected,
    }});
  }
  const path = url.pathname.slice('/app/'.length);
  if (url.origin !== site || !url.pathname.startsWith('/app/') || !appFiles.has(path)) return route.abort();
  const contentType = path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : 'text/javascript';
  return route.fulfill({contentType, body:await readFile(new URL('../app/' + path, import.meta.url))});
}

async function openByTouch(page, link) {
  const [destination] = await Promise.all([page.waitForEvent('popup'), link.tap()]);
  return destination;
}

const browser = await chromium.launch({executablePath:process.env.CHROME_BIN, channel:process.env.CHROME_BIN ? undefined : 'chrome'});
try {
  for (const width of [320, 360, 390, 430]) {
    const context = await browser.newContext({viewport:{width,height:800}, isMobile:true, hasTouch:true, locale:'de-AT'});
    try {
      await context.route('**/*', serveTestPages);
      const page = await context.newPage();
      await page.goto(wordpress);
      const frame = page.frameLocator('iframe');
      await frame.getByText('4 verfügbar', {exact:true}).waitFor();
      const metrics = await frame.locator('html').evaluate(el => ({
        width:el.clientWidth, overflow:el.scrollWidth > el.clientWidth,
        targets:[...el.querySelectorAll('#shopOpen, #refresh, .product h2 a')].map(a => a.getBoundingClientRect().height),
        lines:[...el.querySelectorAll('.product h2, .availability, .price')].map(e => {
          const rect = e.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= el.clientWidth && rect.height > 0 && e.scrollWidth <= e.clientWidth + 1;
        }),
      }));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth),width);
      assert(metrics.width <= width && metrics.width >= width-55, 'Catalog uses the embedded mobile width');
      assert(!metrics.overflow && metrics.lines.length === 9 && metrics.lines.every(Boolean), 'All names, prices and stock fit');
      assert(metrics.targets.length === 5 && metrics.targets.every(h => h >= 44), 'Catalog links and buttons offer 44px touch targets');
      const status = frame.getByRole('status');
      const refreshed = page.waitForResponse(r => new URL(r.url()).pathname === api.pathname && r.ok());
      await Promise.all([refreshed, frame.getByRole('button',{name:'Aktualisieren'}).tap()]);
      await frame.getByText('4 verfügbar',{exact:true}).waitFor();
      assert.match(await status.innerText(), /^3 Produkte/);
      for (const product of products) {
        const detail = await openByTouch(page,frame.getByRole('link',{name:product.name, exact:true}));
        await detail.locator('#linkedProduct #galleryTitle').waitFor();
        assert.equal(detail.url(),shopUrl + '&produkt=' + product.produkt_id);
        assert.equal(await detail.locator('#galleryTitle').innerText(),product.name);
        assert.equal(await detail.locator('#galleryPrice').innerText(),new Intl.NumberFormat('de-AT',{style:'currency',currency:'EUR'}).format(product.preis));
        await detail.close();
      }
      const overview = await openByTouch(page,frame.getByRole('link',{name:/Shop öffnen/}));
      await overview.locator('#grid h3').first().waitFor();
      assert.equal(overview.url(),shopUrl);
      assert.deepEqual(await overview.locator('#grid h3').allTextContents(),products.map(p=>p.name));
      await overview.close();
      console.log(`${width}px viewport, ${metrics.width}px catalog: 3 detail taps, refresh and shop passed`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
