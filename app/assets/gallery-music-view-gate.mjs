// One observer for the visible dashboard publishing area. This does not
// poll on a timer or read any customer/server data.
export function createMusicViewGate({root,documents=[],visible,Observer}={}){
 if(!root||typeof visible!=='function')throw new TypeError('Missing music visibility binding');
 const isVisible=()=>{
  try{return visible()===true;}catch{return false;}
 };
 function subscribeVisibility(onChange){
  if(typeof onChange!=='function')throw new TypeError('Missing music visibility callback');
  let previous=isVisible(),disposed=false;
  const check=()=>{
   if(disposed)return;
   const current=isVisible();
   if(current===previous)return;
   previous=current;onChange();
  };
  const docs=[...new Set(documents.filter(Boolean))];
  for(const doc of docs)doc.addEventListener?.('visibilitychange',check);
  const NativeObserver=Observer??root.ownerDocument?.defaultView?.MutationObserver;
  const observer=typeof NativeObserver==='function'?new NativeObserver(check):null;
  observer?.observe(root,{subtree:true,attributes:true,childList:true,
   attributeFilter:['hidden','class','style']});
  return ()=>{
   if(disposed)return;
   disposed=true;observer?.disconnect();
   for(const doc of docs)doc.removeEventListener?.('visibilitychange',check);
  };
 }
 return {isVisible,subscribeVisibility};
}
