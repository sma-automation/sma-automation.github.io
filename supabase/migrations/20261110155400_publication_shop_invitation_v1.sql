-- Customer-owned shop invitation in every newly completed portal caption.
-- Existing drafts/orders are intentionally NOT backfilled or changed.
-- This normalizer never supplies publishing or provider approval.
CREATE OR REPLACE FUNCTION sma_private.publication_shop_invitation_v1()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $invitation$
DECLARE
  line text;
  footer text;
  product_footer text;
  original_caption text;
  body text;
  next_caption text;
  hashtag_text text;
  part jsonb;
  parts jsonb:='[]'::jsonb;
  language_code text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed'
     OR jsonb_typeof(NEW.preview->'drafts') IS DISTINCT FROM 'array'
     OR NEW.shop_url !~ '^https://sma-automation\.com/app/shop\.html\?shop=[a-z0-9]+(-[a-z0-9]+)*$'
     THEN RETURN NEW;
  END IF;
  language_code:=NEW.input->>'language';
  IF language_code NOT IN ('de','en') THEN RETURN NEW; END IF;
  line:=CASE language_code WHEN 'en' THEN 'Feel free to visit my shop!' ELSE 'Schau doch mal in meinem Shop vorbei!' END;
  FOR part IN SELECT value FROM jsonb_array_elements(NEW.preview->'drafts') t(value)
  LOOP
    original_caption:=part->>'caption';
    body:=part->>'body';
    IF jsonb_typeof(part) IS DISTINCT FROM 'object'
       OR jsonb_typeof(part->'hashtags') IS DISTINCT FROM 'array'
       OR jsonb_typeof(part->'body') IS DISTINCT FROM 'string'
       OR jsonb_typeof(part->'caption') IS DISTINCT FROM 'string'
       THEN parts:=parts||jsonb_build_array(part);CONTINUE;
    END IF;
    footer:=CASE language_code WHEN 'en' THEN '🛒 Visit our shop: ' ELSE '🛒 Zum Shop: ' END||NEW.shop_url;
    IF part ? 'product_id' AND jsonb_typeof(part->'product_id')='string'
       AND part->>'product_id' ~ '^[A-Za-z0-9_-]{1,80}$'
    THEN
      product_footer:=CASE language_code WHEN 'en' THEN '🛒 View product: ' ELSE '🛒 Zum Produkt: ' END
        ||NEW.shop_url||'&produkt='||(part->>'product_id');
      IF right(original_caption,char_length(product_footer)+2)=E'\n\n'||product_footer
         THEN footer:=product_footer;
      END IF;
    END IF;
    -- Keep unusual legacy fixtures and unverified links untouched. Normal
    -- model-generated captions always end with this owner-derived footer.
    IF right(original_caption,char_length(footer)+2) IS DISTINCT FROM E'\n\n'||footer
       THEN parts:=parts||jsonb_build_array(part);CONTINUE;
    END IF;
    IF right(body,char_length(line)+2) IS DISTINCT FROM E'\n\n'||line
       AND char_length(body)+char_length(line)+2<=1200
    THEN body:=body||E'\n\n'||line;
    END IF;
    SELECT string_agg('#'||value,' ' ORDER BY n) INTO hashtag_text
      FROM jsonb_array_elements_text(part->'hashtags') WITH ORDINALITY t(value,n);
    IF right(body,char_length(line)+2)=E'\n\n'||line
       THEN next_caption:=concat_ws(E'\n\n',body,nullif(hashtag_text,''),footer);
       ELSE next_caption:=concat_ws(E'\n\n',body,line,nullif(hashtag_text,''),footer);
    END IF;
    IF octet_length(next_caption)>5000
       OR (part->>'platform'='tiktok' AND char_length(next_caption)+
          (SELECT count(*) FROM regexp_split_to_table(next_caption,'') t(ch) WHERE ascii(ch)>65535)>2200)
    THEN RAISE EXCEPTION 'CAPTION_TOO_LONG' USING ERRCODE='23514'; END IF;
    parts:=parts||jsonb_build_array(part||jsonb_build_object('body',body,'caption',next_caption));
  END LOOP;
  NEW.preview:=jsonb_set(NEW.preview,'{drafts}',parts);
  RETURN NEW;
END
$invitation$;
REVOKE ALL ON FUNCTION sma_private.publication_shop_invitation_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER publication_shop_invitation_v1
BEFORE INSERT OR UPDATE OF preview,status ON sma_private.publication_previews_v1
FOR EACH ROW EXECUTE FUNCTION sma_private.publication_shop_invitation_v1();

-- The existing finish function returns p_preview before the table trigger.
-- Return the authoritative, trigger-normalized stored preview instead.
CREATE OR REPLACE FUNCTION public.sma_publication_preview_finish_v1(p_id uuid, p_lease uuid, p_preview jsonb DEFAULT NULL::jsonb, p_error text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  j sma_private.publication_previews_v1%rowtype;
  c public.sma_kunden%rowtype;
  failure text;
begin
  select * into j from sma_private.publication_previews_v1 q where q.id=p_id for update;
  if not found or j.lease_id is distinct from p_lease or j.status<>'processing' or j.lease_until<now() then return jsonb_build_object('ok',false,'code','INVALID_LEASE'); end if;
  select * into c from public.sma_kunden k where k.id=j.customer_id and k.user_id=j.user_id;
  if not found or c.aktiv is not true or not(c.zahlung_bestaetigt is true or c.demo_delta_aktiv is true) or c.shop_oeffentlich is not true or ('https://sma-automation.com/app/shop.html?shop='||c.shop_slug) is distinct from j.shop_url then failure:='ACCOUNT_CHANGED';
  elsif p_error is not null then failure:=case when p_error='CAPTION_TOO_SIMILAR' then p_error else 'PREPARATION_FAILED' end;
  elsif jsonb_typeof(p_preview) is distinct from 'object' or octet_length(p_preview::text)>40000 or p_preview->>'stage' is distinct from 'text_preview' or p_preview->'can_publish' is distinct from 'false'::jsonb or p_preview->>'shop_url' is distinct from j.shop_url or jsonb_typeof(p_preview->'drafts') is distinct from 'array' then failure:='INVALID_PREVIEW';
  elsif jsonb_array_length(p_preview->'drafts')<>jsonb_array_length(j.input->'platforms') then failure:='INVALID_PREVIEW';
  end if;
  if failure is not null then
    update sma_private.publication_previews_v1 set status='failed',error_code=failure,diagnostic_code=case when p_error in ('CAPTION_TOO_SIMILAR','MODEL_INCOMPLETE','MODEL_REFUSED','MODEL_INVALID','MODEL_INVALID_TEXT','MODEL_UNEXPECTED_LINK','MODEL_INVALID_PLATFORM','MODEL_INVALID_HASHTAGS','CAPTION_TOO_LONG','RUNTIME_BUFFER','CONTEXT_NOT_READY','INVALID_SHOP','HTTP_400','HTTP_401','HTTP_403','HTTP_429','HTTP_500','HTTP_502','HTTP_503','HTTP_504') then p_error else 'UNCLASSIFIED' end,finished_at=now() where id=j.id;
    return jsonb_build_object('ok',false,'status','failed','id',j.id,'code',failure);
  end if;
  update sma_private.publication_previews_v1 set status='completed',preview=p_preview,finished_at=now() where id=j.id returning * into j;
  -- Read the normalized row after the BEFORE trigger; the public response must
  -- match the stored body and caption, not the unnormalized worker input.
  return jsonb_build_object('ok',true,'status','completed','id',j.id,'preview',j.preview,'revision',j.revision);
exception when check_violation then
  if sqlerrm<>'CAPTION_TOO_SIMILAR' then raise; end if;
  update sma_private.publication_previews_v1 set status='failed',error_code='CAPTION_TOO_SIMILAR',diagnostic_code='CAPTION_TOO_SIMILAR',finished_at=now()
    where id=p_id and lease_id=p_lease and status='processing';
  return jsonb_build_object('ok',false,'status','failed','id',p_id,'code','CAPTION_TOO_SIMILAR');
end;
$function$
;
