
import { withSupabase } from "npm:@supabase/server@1";

const BUCKET = "sma-produktbilder";
const SEITENGROESSE = 10;
const ANZEIGEDAUER = 900;

function antwort(status: number, message: string) {
  return Response.json(
    { ok: false, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function bildPfade(
  produkt: {
    sma_produkt_id: string;
    bild_pfade?: string[] | null;
    bild_pfad?: string | null;
  },
  userId: string,
): string[] {
  const bilder = produkt.bild_pfade?.length
    ? produkt.bild_pfade
    : (produkt.bild_pfad ? [produkt.bild_pfad] : []);

  const ordner = `${userId}/${produkt.sma_produkt_id}/`;

  return [...new Set(bilder.filter((pfad) =>
    typeof pfad === "string" &&
    pfad.startsWith(ordner) &&
    !pfad.includes("..") &&
    !pfad.includes("\\")
  ))].slice(0, 8);
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "GET") {
      return antwort(405, "Nur GET erlaubt");
    }

    const url = new URL(req.url);
    const slug = (url.searchParams.get("shop") ?? "")
      .trim().toLowerCase();
    const seiteText = url.searchParams.get("seite") ?? "1";
    const suche = (url.searchParams.get("suche") ?? "").trim();

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
        slug.length > 63) {
      return antwort(400, "Ungueltige Shop-Kennung");
    }

    if (!/^[1-9][0-9]{0,3}$/.test(seiteText) ||
        Number(seiteText) > 1000) {
      return antwort(400, "Ungueltige Seitennummer");
    }

    if (suche.length > 60 ||
        (suche && !/^[\p{L}\p{N} .-]+$/u.test(suche))) {
      return antwort(400, "Ungueltiger Suchbegriff");
    }

    const produkt = url.searchParams.get("produkt");
    if (produkt !== null && (
      !/^[A-Za-z0-9_-]{1,80}$/.test(produkt) ||
      url.searchParams.getAll("produkt").length !== 1 ||
      url.searchParams.getAll("shop").length !== 1 ||
      url.searchParams.has("suche") || url.searchParams.has("seite")
    )) {
      return antwort(400, "Ungueltiger Produktlink");
    }

    try {
      const db = ctx.supabaseAdmin;

      const { data: shop, error: shopFehler } = await db
        .from("sma_kunden")
        .select(
          "user_id,kunde_id,kunde_name,aktiv,zahlung_bestaetigt,demo_delta_aktiv"
        )
        .eq("shop_slug", slug)
        .eq("shop_oeffentlich", true)
        .maybeSingle();

      if (shopFehler) throw shopFehler;

      if (!shop?.user_id || !shop?.kunde_id ||
          shop.aktiv !== true ||
          (shop.zahlung_bestaetigt !== true &&
           shop.demo_delta_aktiv !== true)) {
        return antwort(404, "Shop nicht verfuegbar");
      }

      const seite = Number(seiteText);
      const start = (seite - 1) * SEITENGROESSE;

      let abfrage = db.from("sma_produkte")
        .select(
          "sma_produkt_id,produkt_name,beschreibung,produkt_typ," +
          "preis,waehrung,bestand,shopify_aktiv,bild_pfad,bild_pfade,created_at",
          { count: "exact" },
        )
        .eq("user_id", shop.user_id)
        .eq("kunde_id", shop.kunde_id)
        .eq("aktiv", true);

      if (produkt !== null) {
        abfrage = abfrage.eq("sma_produkt_id", produkt);
      } else if (suche) {
        abfrage = abfrage.ilike("produkt_name", `%${suche}%`);
      }

      const {
        data: produkte,
        error: produktFehler,
        count,
      } = await abfrage
        .order("created_at", { ascending: false })
        .range(start, start + SEITENGROESSE - 1);

      if (produktFehler) throw produktFehler;
      if (produkt !== null && (count !== 1 || produkte?.length !== 1 ||
          produkte[0].sma_produkt_id !== produkt)) {
        return antwort(404, "Produkt nicht verfuegbar");
      }

      const ergebnis = await Promise.all(
        (produkte ?? []).map(async (produkt) => {
          const pfade = bildPfade(produkt, shop.user_id);
          let bilder: string[] = [];

          if (pfade.length) {
            const { data, error } = await db.storage
              .from(BUCKET)
              .createSignedUrls(pfade, ANZEIGEDAUER);

            if (error) {
              console.error("Bildlinks:", error.message);
            } else {
              bilder = (data ?? [])
                .map((bild) => bild.signedUrl ?? "")
                .filter(Boolean);
            }
          }

          return {
            produkt_id: produkt.sma_produkt_id,
            name: produkt.produkt_name,
            beschreibung: produkt.beschreibung ?? "",
            typ: produkt.produkt_typ ?? "",
            preis: produkt.preis,
            waehrung: produkt.waehrung ?? "EUR",
            bestand: produkt.bestand ?? 0,
            shopify_aktiv: produkt.shopify_aktiv === true,
            bilder,
            hauptbild: bilder[0] ?? null,
          };
        }),
      );

      return Response.json({
        ok: true,
        shop: {
          slug,
          name: shop.kunde_name || "SMA Shop",
        },
        seite,
        pro_seite: SEITENGROESSE,
        ...(produkt !== null ? { produkt_filter: produkt } : {}),
        gesamt: count ?? 0,
        seiten: Math.ceil((count ?? 0) / SEITENGROESSE),
        produkte: ergebnis,
      }, {
        headers: { "Cache-Control": "no-store" },
      });

    } catch (error) {
      console.error("SMA Shop-Produktabruf:", error);
      return antwort(
        500,
        "Produktabruf momentan nicht moeglich",
      );
    }
  }),
};
