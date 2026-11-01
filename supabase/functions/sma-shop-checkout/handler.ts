// Public cart preparation only. Shopify owns final pricing and payment.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HOST = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const ORIGINS = new Set(['https://sma-automation.com', 'https://www.sma-automation.com']);
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

export function createHandler(liveEnabled: () => boolean) {
  return async (req: Request, ctx: any): Promise<Response> => {
    const origin = req.headers.get('origin') || '';
    const headers = {
      'Access-Control-Allow-Origin': ORIGINS.has(origin) ? origin : 'https://sma-automation.com',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Vary': 'Origin', 'Cache-Control': 'no-store',
    };
    const reply = (status: number, message: string, details = {}) => Response.json({
      ok: status === 200, message, ...details,
    }, {status, headers});
    if (origin && !ORIGINS.has(origin)) return reply(403, 'Ursprung nicht zugelassen.');
    if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers});
    if (req.method !== 'POST') return reply(405, 'Nur POST erlaubt.');
    try {
      let body: unknown;
      try {
        const text = await req.text();
        if (text.length > 8192) return reply(413, 'Warenkorb zu groß.');
        body = JSON.parse(text);
      } catch { return reply(400, 'Ungültige JSON-Daten.'); }
      const shop = object(body) && typeof body.shop === 'string' ? body.shop.trim().toLowerCase() : '';
      if (!object(body) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(shop) || shop.length > 63) return reply(400, 'Ungültige Shop-Adresse.');
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) return reply(400, 'Bitte 1 bis 20 Produkte auswählen.');
      const basket = new Map<string, number>();
      let quantity = 0;
      for (const item of body.items) {
        if (!object(item)) return reply(400, 'Ungültige Warenkorbposition.');
        const id = typeof item.produkt_id === 'string' ? item.produkt_id.trim().toLowerCase() : '';
        const count = item.menge;
        if (!UUID.test(id) || !Number.isInteger(count) || count < 1 || count > 20 || basket.has(id)) return reply(400, 'Produkt-ID, Menge oder doppelte Position prüfen.');
        quantity += count;
        if (quantity > 40) return reply(400, 'Höchstens 40 Stück pro Warenkorb.');
        basket.set(id, count);
      }
      // Both release gates are mandatory. Request parameters cannot enable them.
      if (!liveEnabled()) return reply(403, 'Die Kasse ist noch nicht freigeschaltet.');
      const db = ctx.supabaseAdmin;
      const {data: customer, error: customerError} = await db.from('sma_kunden')
        .select('id,user_id,kunde_id,aktiv,shop_oeffentlich,zahlung_bestaetigt,demo_delta_aktiv')
        .eq('shop_slug', shop).maybeSingle();
      if (customerError) throw customerError;
      if (!customer || customer.aktiv !== true || customer.shop_oeffentlich !== true ||
          !(customer.zahlung_bestaetigt === true || customer.demo_delta_aktiv === true)) return reply(404, 'Dieser Shop ist nicht verfügbar.');
      const {data: accounts, error: accountError} = await db.from('sma_shopify_konten')
        .select('markt_konto_id,shopify_domain,aktiv').eq('sma_kunden_id', customer.id).eq('aktiv', true).limit(2);
      if (accountError) throw accountError;
      if (accounts?.length !== 1) return reply(403, 'Die Kasse für diesen Shop ist noch nicht freigeschaltet.');
      const domain = String(accounts[0].shopify_domain || '').trim().toLowerCase();
      if (!HOST.test(domain) || !accounts[0].markt_konto_id) return reply(409, 'Ungültige Shopify-Zuordnung.');
      const ids = [...basket.keys()];
      const {data: products, error: productError} = await db.from('sma_produkte')
        .select('sma_produkt_id,produkt_name,aktiv,shopify_aktiv,bestand,kauf_url,preis,waehrung')
        .eq('user_id', customer.user_id).eq('kunde_id', customer.kunde_id).in('sma_produkt_id', ids);
      if (productError) throw productError;
      if (products?.length !== ids.length) return reply(409, 'Produktzuordnung nicht eindeutig.');
      const byId = new Map();
      for (const p of products) {
        if (!basket.has(p.sma_produkt_id) || byId.has(p.sma_produkt_id)) return reply(409, 'Produktzuordnung nicht eindeutig.');
        byId.set(p.sma_produkt_id, p);
      }
      const variants = new Set();
      const lines = [];
      let totalCents = 0, currency = '';
      for (const [id, count] of basket) {
        const p = byId.get(id);
        if (p.aktiv !== true || p.shopify_aktiv !== true || typeof p.kauf_url !== 'string') return reply(409, 'Produkt nicht für Shopify freigegeben.');
        const stock = p.bestand === null ? NaN : Number(p.bestand);
        if (!Number.isSafeInteger(stock) || stock < count) return reply(409, 'Gewünschte Menge nicht verfügbar: ' + p.produkt_name);
        let url: URL;
        try { url = new URL(p.kauf_url.trim()); } catch { return reply(409, 'Ungültige Shopify-Kaufadresse.'); }
        const match = url.pathname.match(/^\/cart\/([1-9][0-9]{5,24}):[1-9][0-9]*\/?$/);
        if (url.protocol !== 'https:' || url.hostname !== domain || url.port || url.username || url.password || url.search || url.hash || !match) return reply(409, 'Ungültige Shopify-Kaufadresse oder Variante.');
        if (variants.has(match[1])) return reply(409, 'Mehrere Produkte verweisen auf dieselbe Shopify-Variante.');
        variants.add(match[1]);
        const price = p.preis === null ? NaN : Number(p.preis);
        const cents = Math.round(price * 100);
        const code = String(p.waehrung || '').toUpperCase();
        if (!Number.isFinite(price) || price < 0 || !Number.isSafeInteger(cents) || !/^[A-Z]{3}$/.test(code) || (currency && currency !== code)) return reply(409, 'Preis oder Währung prüfen.');
        currency = code;
        totalCents += cents * count;
        if (!Number.isSafeInteger(totalCents)) return reply(409, 'Warenkorbwert zu groß.');
        lines.push({produkt_id: id, variante: match[1], menge: count, bestand: stock, einzelpreis: cents / 100, summe: cents * count / 100});
      }
      return reply(200, 'Warenkorb geprüft. Endpreis und Versand werden bei Shopify angezeigt.', {
        shop, modus: 'shopify_live', shopify_domain: domain,
        checkout_url: 'https://' + domain + '/cart/' + lines.map(p => p.variante + ':' + p.menge).join(','),
        positionen: lines.length, gesamtmenge: quantity,
        warenkorb: lines, gesamtbetrag: totalCents / 100, waehrung: currency,
      });
    } catch {
      console.error('SMA public checkout preparation failed');
      return reply(503, 'Die Kasse ist derzeit nicht erreichbar. Bitte später erneut versuchen.');
    }
  };
}
