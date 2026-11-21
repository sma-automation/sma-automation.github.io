import {defaultOverlayStyle,overlayColors} from './media-editor-model.mjs?v=5';
import {drawMediaOverlay} from './media-text-overlay.mjs?v=3';

const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
export function mountEditorCaption({doc,stage,control,changed}) {
  const panel = doc.getElementById('overlayPanel');
  const canvas = doc.getElementById('overlayCanvas'), fallback = doc.getElementById('overlay');
  const text = control('overlay_text'), position = control('overlay_position');
  let style, width = 1, height = 1, active = false, editing = false, disposed = false;
  let bounds, pointer, originalText, suppressClick = false;
  const blocked = () => disposed || doc.getElementById('fields').disabled;
  function element(tag,className,caption) {
    const el=doc.createElement(tag);
    el.className=className;
    if(caption) el.textContent=caption;
    return el;
  }
  function button(parent,caption,label,action) {
    const b=element('button','',caption);
    b.type='button';
    b.setAttribute('aria-label',label);
    b.addEventListener('click',event=>{
      event.stopPropagation();
      if(!blocked()) action();
    });
    parent.append(b);
    return b;
  }

  const selection=element('div','editor-caption-selection');
  const target=button(selection,'','Texteinblendung bearbeiten',()=>{
    if(!suppressClick) startTyping();
    suppressClick=false;
  });
  target.className='editor-caption-target';
  const resize=button(selection,'','Schriftgröße ändern',()=>{});
  resize.className='editor-caption-resize';
  const input=element('textarea','editor-caption-input');
  input.rows=1;
  input.maxLength=320;
  input.setAttribute('aria-label','Text im Bild bearbeiten');
  input.spellcheck=true;
  selection.append(input);
  stage.append(selection);

  const tools=element('div','editor-caption-tools');
  const help=element('p','muted','Tippe den Text im Bild an, um ihn zu ändern. Ziehe ihn an die gewünschte Stelle.');
  const sizeLabel=element('strong','','Schriftgröße'), sizeRow=element('div','editor-caption-sizes');
  const down=button(sizeRow,'A−','Schrift verkleinern',()=>setSize(currentStyle().size-10));
  const sizeValue=element('output','');
  sizeRow.append(sizeValue);
  const up=button(sizeRow,'A+','Schrift vergrößern',()=>setSize(currentStyle().size+10));
  const colorsLabel=element('strong','','Schriftfarbe'), palette=element('div','editor-caption-colors');
  const colors=[];
  for(const [hex,name] of Object.entries(overlayColors)) {
    const b=button(palette,'',name,()=>update({color:hex}));
    b.style.setProperty('--sample',hex);
    colors.push([b,hex]);
  }
  const bold=button(tools,'Fett','Fett',()=>update({bold:!currentStyle().bold}));
  tools.prepend(help,sizeLabel,sizeRow,colorsLabel,palette);
  const add=button(tools,'Text hinzufügen','Text hinzufügen',()=>{
    style={...defaultOverlayStyle};
    text.value='Dein Text';
    changed();
    paint(width,height);
    startTyping();
  });
  const remove=button(tools,'Text entfernen','Text entfernen',()=>{
    editing=false;
    style=undefined;
    text.value='';
    changed();
    paint(width,height);
    add.focus();
  });
  panel.append(tools);

  function currentStyle() {
    if(style) return style;
    return {...defaultOverlayStyle,x:50,y:bounds?Math.round((bounds.top+bounds.height/2)*100/height):64};
  }
  function update(values) {
    if(blocked()) return;
    const updated={...currentStyle(),...values};
    if(style && Object.keys(updated).every(k=>updated[k]===style[k])) return;
    style=updated;
    changed();
    paint(width,height);
  }
  function setSize(value) {
    update({size:clamp(Math.round(value),50,260)});
  }
  function paint(w,h) {
    if(disposed || !w || !h) return;
    width=w; height=h;
    const caption=text.value, anchor=position.value;
    bounds=null;
    const drawn=caption && drawMediaOverlay(canvas,w,h,caption,anchor,style,rect=>{bounds=rect;});
    canvas.hidden=!drawn || editing;
    if(drawn) canvas.setAttribute('aria-label',caption);
    else canvas.removeAttribute('aria-label');
    fallback.textContent=drawn||editing?'':caption;
    const v=style||defaultOverlayStyle;
    if(!bounds) {
      const bw=Math.max(w*.18,Math.min(w*.9,Array.from(caption).length*w*.048));
      const bh=Math.min(h,Math.max(w*.12,h*.08));
      const y=style?v.y:anchor==='top'?5+bh/h*50:anchor==='bottom'?95-bh/h*50:50;
      bounds={left:clamp(w*v.x/100-bw/2,0,w-bw),top:clamp(h*y/100-bh/2,0,h-bh),width:bw,height:bh,fontSize:w*.09*v.size/100};
    }
    const box=selection.style;
    box.left=100*bounds.left/w+'%'; box.top=100*bounds.top/h+'%';
    box.width=100*bounds.width/w+'%'; box.height=100*bounds.height/h+'%';
    if(fallback.textContent) {
      Object.assign(fallback.style,{left:box.left,top:box.top,width:box.width,height:box.height,
        padding:'0',right:'auto',bottom:'auto',transform:'none',color:v.color,fontWeight:v.bold?'700':'400'});
    }
    selection.hidden=!active || (!caption && !editing);
    target.hidden=editing;
    resize.hidden=editing;
    input.hidden=!editing;
    if(editing) {
      input.style.color=v.color;
      input.style.fontSize=Math.max(16,bounds.fontSize*(stage.clientWidth||w)/w)+'px';
      input.style.fontWeight=v.bold?'700':'400';
    }
    const hasText=Boolean(caption)||editing;
    help.hidden=!hasText;
    for(const el of [sizeRow,sizeLabel,palette,colorsLabel,bold,remove]) el.hidden=!hasText;
    add.hidden=hasText;
    sizeValue.textContent=v.size+' %';
    down.disabled=v.size<=50;
    up.disabled=v.size>=260;
    bold.setAttribute('aria-pressed',String(v.bold));
    for(const [b,hex] of colors) b.setAttribute('aria-pressed',String(hex===v.color));
  }
  function startTyping() {
    if(blocked()||!active||editing) return;
    originalText=text.value;
    input.value=originalText;
    editing=true;
    paint(width,height);
    input.focus();
    input.select?.();
  }
  function finishTyping(focus=false) {
    if(!editing) return;
    editing=false;
    paint(width,height);
    if(focus) (text.value?target:add).focus();
  }
  input.addEventListener('input',()=>{
    if(blocked()) return;
    const value=Array.from(input.value.replace(/[\u0000-\u001f\u007f]/gu,' ')).slice(0,160).join('');
    if(value!==input.value) input.value=value;
    text.value=value;
    changed();
    paint(width,height);
  });
  input.addEventListener('blur',()=>finishTyping());
  input.addEventListener('keydown',event=>{
    if(event.isComposing) return;
    if(event.key==='Escape'||event.key==='Enter') {
      event.preventDefault();event.stopPropagation();
      if(event.key==='Escape'&&text.value!==originalText){text.value=originalText;changed();}
      finishTyping(true);
    }
  });
  selection.addEventListener('click',event=>event.stopPropagation());
  selection.addEventListener('dblclick',event=>event.stopPropagation());

  function begin(event,grip) {
    if(blocked()||!active||editing||event.button!==0||event.isPrimary===false||!bounds) return;
    event.stopPropagation();
    const box=stage.getBoundingClientRect();
    if(!box.width||!box.height) return;
    const cx=(bounds.left+bounds.width/2)/width,cy=(bounds.top+bounds.height/2)/height;
    pointer={id:event.pointerId,grip,box,cx,cy,x:event.clientX,y:event.clientY,size:currentStyle().size,
      distance:Math.max(4,Math.hypot(event.clientX-box.left-cx*box.width,event.clientY-box.top-cy*box.height)),moved:false};
    suppressClick=false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  target.addEventListener('pointerdown',event=>begin(event,false));
  resize.addEventListener('pointerdown',event=>begin(event,true));
  selection.addEventListener('pointermove',event=>{
    const p=pointer;
    if(!p||p.id!==event.pointerId||blocked()) return;
    const dx=event.clientX-p.x,dy=event.clientY-p.y;
    if(!p.moved&&Math.hypot(dx,dy)<3) return;
    p.moved=true;
    event.preventDefault();
    if(p.grip) {
      const distance=Math.hypot(event.clientX-p.box.left-p.cx*p.box.width,event.clientY-p.box.top-p.cy*p.box.height);
      setSize(p.size*distance/p.distance);
    } else {
      update({x:Math.round(clamp(100*(p.cx+dx/p.box.width),0,100)),y:Math.round(clamp(100*(p.cy+dy/p.box.height),0,100))});
    }
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture']) {
    selection.addEventListener(type,event=>{
      if(pointer?.id!==event.pointerId) return;
      suppressClick=pointer.moved;
      pointer=null;
    });
  }
  target.addEventListener('keydown',event=>{
    const directions={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]};
    if(!Object.hasOwn(directions,event.key)||blocked())return;
    event.preventDefault();event.stopPropagation();
    const [x,y]=directions[event.key], step=event.shiftKey?5:1, v=currentStyle();
    update({x:clamp(v.x+x*step,0,100),y:clamp(v.y+y*step,0,100)});
  });
  resize.addEventListener('keydown',event=>{
    if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)||blocked())return;
    event.preventDefault();event.stopPropagation();
    setSize(currentStyle().size+(['ArrowUp','ArrowRight'].includes(event.key)?10:-10));
  });
  function reset() {
    editing=false;pointer=null;suppressClick=false;originalText='';input.value='';
    selection.hidden=true;target.hidden=false;resize.hidden=false;input.hidden=true;
    style=undefined;bounds=null;
  }
  reset();
  return {
    paint,
    fill(settings){reset();if(settings.overlay_style)style={...settings.overlay_style};},
    getSetting(){return style?{overlay_style:{...style}}:{};},
    setActive(value){active=value;if(!active){finishTyping();pointer=null;}paint(width,height);},
    clear(){reset();fallback.textContent='';canvas.hidden=true;canvas.width=canvas.height=0;canvas.removeAttribute('aria-label');},
    destroy(){disposed=true;reset();selection.remove();tools.remove();}
  };
}
