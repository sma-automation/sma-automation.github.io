'use strict';

// A nullable adjustment group is not proof of success. Only an unchanged request
// may use a complete, fresh readback as confirmation; never retry the mutation.
function stockRequestConfirmation(mutation, readback, prepared, claim, mapping, now=Date.now()) {
  const unknown=code=>({status:'unknown',code});
  if(!mutation||mutation.error||('errors' in mutation&&(!Array.isArray(mutation.errors)||mutation.errors.length)))
    return unknown('SHOPIFY_RESPONSE_UNCERTAIN');
  const result=mutation.data?.inventorySetQuantities;
  if(!result)return unknown('SHOPIFY_RESPONSE_MISSING');
  if(!Array.isArray(result.userErrors))return unknown('SHOPIFY_RESPONSE_INVALID');
  if(result.userErrors.length)return {status:'failed',code:'SHOPIFY_REJECTED',
    errors:result.userErrors.map(x=>({code:x?.code,message:x?.message}))};
  if(result.inventoryAdjustmentGroup){
    if(typeof result.inventoryAdjustmentGroup.createdAt!=='string'||
        !Number.isFinite(Date.parse(result.inventoryAdjustmentGroup.createdAt)))
      return unknown('SHOPIFY_CONFIRMATION_INVALID');
    return {status:'applied',code:'SHOPIFY_CONFIRMED',quantity:claim.quantity};
  }
  // Missing properties and changed quantities remain uncertain even if a later
  // read happens to match. They do not establish which operation performed a write.
  if(result.inventoryAdjustmentGroup!==null||!prepared||!claim||
      !Number.isSafeInteger(claim.quantity)||claim.quantity<0||claim.quantity>1000000||
      prepared.quantity!==claim.quantity||prepared.from_quantity!==claim.quantity)
    return unknown('SHOPIFY_CONFIRMATION_MISSING');
  if(typeof claim.sku!=='string'||!claim.sku||
      !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(claim.variant_id||'')||
      !/^gid:\/\/shopify\/InventoryItem\/\d+$/.test(prepared.inventory_item_id||'')||
      !/^gid:\/\/shopify\/Location\/\d+$/.test(prepared.location_id||'')||
      !/^gid:\/\/shopify\/Product\/\d+$/.test(mapping?.product_gid||''))
    return unknown('SHOPIFY_READBACK_IDENTITY');
  const age=now-Date.parse(prepared.read_at);
  if(!Number.isFinite(age)||age<0||age>90000)return unknown('SHOPIFY_READBACK_EXPIRED');
  if(!readback||readback.error||('errors' in readback&&(!Array.isArray(readback.errors)||readback.errors.length)))return unknown('SHOPIFY_READBACK_FAILED');
  const variant=readback.data?.productVariant,item=variant?.inventoryItem;
  if(!variant||variant.id!==claim.variant_id||variant.id!==prepared.variant_id||
      variant.product?.id!==mapping?.product_gid||variant.sku!==claim.sku||
      !item||item.id!==prepared.inventory_item_id||item.sku!==claim.sku||item.tracked!==true)
    return unknown('SHOPIFY_READBACK_IDENTITY');
  const variants=item.variants,levels=item.inventoryLevels;
  if(variants?.pageInfo?.hasNextPage!==false||!Array.isArray(variants.nodes)||
      variants.nodes.length!==1||variants.nodes[0].id!==variant.id||
      levels?.pageInfo?.hasNextPage!==false||!Array.isArray(levels.nodes))
    return unknown('SHOPIFY_READBACK_INCOMPLETE');
  const eligible=levels.nodes.filter(x=>x?.location?.isActive===true&&x.location.fulfillsOnlineOrders===true);
  if(eligible.length!==1||eligible[0].location.id!==prepared.location_id)
    return unknown('SHOPIFY_READBACK_LOCATION');
  const quantities=eligible[0].quantities;
  const available=Array.isArray(quantities)?quantities.filter(x=>x?.name==='available'):[];
  if(available.length!==1||!Number.isSafeInteger(available[0].quantity)||available[0].quantity!==claim.quantity)
    return unknown('SHOPIFY_READBACK_QUANTITY');
  return {status:'applied',code:'SHOPIFY_UNCHANGED_CONFIRMED',quantity:claim.quantity,
    unchanged:true,confirmation:'readback',confirmed_at:new Date(now).toISOString(),
    inventory_item_id:item.id,location_id:prepared.location_id,variant_id:variant.id};
}

module.exports={stockRequestConfirmation};
