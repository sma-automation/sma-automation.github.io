import {readMusicSetting,verifyMusicBytes} from './media-music-model.mjs?v=1';

const origin='https://bnvnmdxosbnuzedokqgh.supabase.co';
const key='sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW';
const paymentPath='/functions/v1/sma-music-credit-pack';
export function createCatalogAPI({owner,getSession,request=fetch}){
 async function call(path,options,signal){
  async function auth(){
   signal?.throwIfAborted();
   const s=await getSession();
   if(!s?.access_token||s.user?.id!==owner)throw Error('AUTH_REQUIRED');
   return s;
  }
  const s=await auth();
  const response=await request(origin+path,{...options,headers:{apikey:key,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},
   credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(45000)])});
  const data=options.binary&&response.ok?await response.blob():await response.json();
  await auth();signal?.throwIfAborted();
  if(!response.ok||data?.ok===false)throw Error(data?.code||'UNAVAILABLE');
  return data;
 }
 const rpc=(action,input,signal)=>call('/rest/v1/rpc/sma_music_credits_v1',{method:'POST',body:JSON.stringify({p_action:action,p_input:input})},signal);
 return {
  async overview(signal){
   const r=await rpc('overview',{},signal);
   if(!r.ok||!['alpha','beta','delta'].includes(r.plan)||!Number.isSafeInteger(r.credits)||r.credits<0||!Array.isArray(r.tracks))throw Error('UNAVAILABLE');
   for(const t of r.tracks){
    readMusicSetting({name:t.name,sha256:t.sha256,size_bytes:t.size_bytes,mime_type:t.mime_type,volume:25,start_ms:0});
    if(typeof t.available!=='boolean')throw Error('UNAVAILABLE');
   }
   return r;
  },
  async checkoutEnabled(signal){return (await call(paymentPath,{method:'GET'},signal)).enabled===true;},
  unlock:(sha256,signal)=>rpc('unlock',{sha256},signal),
  async checkout(signal){
   const r=await call(paymentPath,{method:'POST',body:'{}'},signal);
   if(r.checkout){
    const url=new URL(r.checkout);
    if(url.protocol!=='https:'||url.username||url.password||url.port||!['checkout.mollie.com','www.mollie.com'].includes(url.hostname))throw Error('UNAVAILABLE');
   }
   return r;
  },
  async source(setting,signal){
   const m=readMusicSetting(setting),name=m.sha256+(m.mime_type==='audio/wav'?'.wav':'.mp3');
   const blob=await call('/storage/v1/object/authenticated/sma-katalog/'+name,{method:'GET',binary:true},signal);
   await verifyMusicBytes(blob,m);
   if((await getSession())?.user?.id!==owner)throw Error('AUTH_REQUIRED');
   signal?.throwIfAborted();return blob;
  }
 };
}

export function mountCatalog({doc,host,api,goToCheckout}){
 const el=(tag,text)=>{const node=doc.createElement(tag);if(text)node.textContent=text;return node;};
 const root=el('div'),intro=el('p'),refresh=el('button','Aktualisieren'),buy=el('button','10 Musik-Credits für 10 € kaufen'),
  list=el('div'),actions=el('div'),status=el('p'),pageBar=el('div'),prev=el('button','Zurück'),next=el('button','Weiter'),counter=el('span'),audio=el('audio');
 root.className='sma-music-library';actions.className=pageBar.className='sma-music-actions';intro.className=status.className='sma-music-status';
 for(const b of [refresh,buy,prev,next])b.type='button';
 status.setAttribute('role','status');audio.controls=true;audio.hidden=true;
 actions.append(refresh,buy);pageBar.append(prev,counter,next);buy.hidden=pageBar.hidden=true;
 root.append(intro,actions,list,pageBar,audio,status);host.append(root);
 const balance=doc.getElementById('creditsBalanceSlot'),card=balance?.parentElement,oldBuy=card?.querySelector('button[disabled]');
 const oldLabel=oldBuy?.textContent,oldBalance=balance?.textContent;
 const paymentStatus=el('p');paymentStatus.hidden=true;paymentStatus.setAttribute('role','status');
 if(oldBuy)card.append(paymentStatus);
 let data,paymentsEnabled=false,page=0,controller,url,disposed=false;
 function stop(){if(url){audio.pause();audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);url=null;}audio.hidden=true;}
 function draw(){
  list.replaceChildren();
  if(!data)return;
  const delta=data.plan==='delta',canBuy=!delta&&data.tracks.length>0&&paymentsEnabled;
  intro.textContent=delta?'SMA-Musik ist in deinem Delta-Paket enthalten.':data.credits+' Musik-Credits · 1 Credit pro Track.';
  buy.hidden=!canBuy;
  if(balance)balance.textContent=data.credits+' Musik-Credits';
  if(oldBuy){oldBuy.textContent=delta?'SMA-Musik in Delta enthalten':canBuy?'10 Musik-Credits für 10 € kaufen':'Musik-Credits noch nicht buchbar';oldBuy.disabled=!canBuy||!!controller;}
  if(!data.tracks.length)list.append(el('p','Hier erscheinen die von SMA produzierten Tracks.'));
  const total=Math.max(1,Math.ceil(data.tracks.length/5));page=Math.min(page,total-1);
  for(const t of data.tracks.slice(page*5,page*5+5)){
   const row=el('div'),info=el('div'),btn=el('button',t.available?'Anhören':'Für 1 Credit freischalten');
   row.className='sma-music-row';info.append(el('strong',t.name),el('small',t.available?(delta?'In Delta enthalten':'Freigeschaltet'):'SMA-Musik'));
   btn.type='button';btn.disabled=!!controller||(!t.available&&data.credits<1);
   btn.addEventListener('click',()=>run(async signal=>{
    if(t.available){
     stop();const setting={name:t.name,sha256:t.sha256,size_bytes:t.size_bytes,mime_type:t.mime_type,volume:25,start_ms:0};
     const blob=await api.source(setting,signal);signal.throwIfAborted();url=URL.createObjectURL(blob);audio.src=url;audio.hidden=false;
     status.textContent='Hörprobe bereit · '+t.name;
    }else{
     await api.unlock(t.sha256,signal);signal.throwIfAborted();doc.dispatchEvent(new doc.defaultView.Event('sma-music-unlocked'));await reload(signal);status.textContent='Freigeschaltet · '+t.name;
    }
   }));row.append(info,btn);list.append(row);
  }
  pageBar.hidden=total<=1;counter.textContent=(page+1)+' / '+total;prev.disabled=!!controller||page===0;next.disabled=!!controller||page+1>=total;
 }
 async function reload(signal){
  const fresh=await api.overview(signal);
  const enabled=fresh.plan!=='delta'&&fresh.tracks.length>0&&await api.checkoutEnabled(signal).catch(()=>false);
  signal.throwIfAborted();data=fresh;paymentsEnabled=enabled;draw();
 }
 async function run(fn){
  if(disposed||controller)return;
  controller=new AbortController();const signal=controller.signal;refresh.disabled=buy.disabled=true;status.textContent='';draw();
  try{await fn(signal);}
  catch(e){if(!signal.aborted){if(e.message==='AUTH_REQUIRED'||e.message==='ACCESS_INACTIVE'){data=null;stop();list.replaceChildren();buy.hidden=pageBar.hidden=true;intro.textContent='';if(balance)balance.textContent='–';if(oldBuy)oldBuy.disabled=true;}
   status.textContent=({INSUFFICIENT_CREDITS:'Dein Guthaben reicht für diesen Track nicht aus.',CHECKOUT_UNAVAILABLE:'Die Zahlung für Musik-Credits ist noch nicht verfügbar.',AUTH_REQUIRED:'Bitte melde dich erneut an.',ACCESS_INACTIVE:'Der SMA-Musikkatalog ist für diesen Zugang nicht verfügbar.'})[e.message]||'Der Musikkatalog konnte die Anfrage nicht abschließen. Bitte aktualisiere die Ansicht.';}}
  finally{controller=null;if(!disposed){refresh.disabled=buy.disabled=false;draw();}}
 }
 const pay=async event=>{
  const settings=event?.currentTarget===oldBuy;paymentStatus.hidden=true;
  await run(async signal=>{
  const r=await api.checkout(signal);signal.throwIfAborted();
  if(r.checkout){goToCheckout(r.checkout);return;}
  await reload(signal);status.textContent=r.state==='paid'?'Zehnerpaket gutgeschrieben.':r.state==='closed'?'Der frühere Zahlvorgang ist beendet. Du kannst neu starten.':'Prüfe den Zahlungsstand erneut.';
  });
  if(settings&&!disposed&&status.textContent){paymentStatus.textContent=status.textContent;paymentStatus.hidden=false;}
 };
 refresh.addEventListener('click',()=>run(reload));buy.addEventListener('click',pay);oldBuy?.addEventListener('click',pay);
 prev.addEventListener('click',()=>{if(!controller&&page>0){page--;draw();}});
 next.addEventListener('click',()=>{if(!controller&&data&&page+1<Math.ceil(data.tracks.length/5)){page++;draw();}});
 void run(reload);
 return {destroy(){disposed=true;controller?.abort();stop();root.remove();paymentStatus.remove();if(balance)balance.textContent=oldBalance;
  if(oldBuy){oldBuy.disabled=true;oldBuy.textContent=oldLabel;oldBuy.removeEventListener('click',pay);}}};
}
