// The filmstrip samples the authenticated local video URL. It never requests a second copy from Drive.
import {originalVideoSupported} from './original-video-preview.mjs?v=6';

const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));
const seconds = ms => (ms / 1000).toLocaleString('de-AT', {maximumFractionDigits: 3}) + ' s';
const clock = ms => Math.floor(ms / 60000) + ':' + ((ms % 60000) / 1000).toFixed(2).padStart(5, '0').replace('.', ',');

function drawFrames(doc, canvas, url) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const decoder = doc.createElement('video'), count = 8, cellWidth = 96, cellHeight = 62;
  let index = 0, closed = false;
  canvas.width = cellWidth * count;
  canvas.height = cellHeight;
  decoder.muted = true;
  decoder.playsInline = true;
  decoder.preload = 'auto';
  function close() {
    if (closed) return;
    closed = true;
    decoder.removeEventListener('loadedmetadata', seek);
    decoder.removeEventListener('seeked', draw);
    decoder.removeEventListener('error', close);
    decoder.removeAttribute('src');
    decoder.load();
  }
  function seek() {
    if (closed || !Number.isFinite(decoder.duration) || !decoder.duration) return close();
    decoder.currentTime = (index + .5) / count * decoder.duration;
  }
  function draw() {
    if (closed) return;
    const {videoWidth: w, videoHeight: h} = decoder;
    if (!w || !h) return close();
    const scale = Math.max(cellWidth / w, cellHeight / h);
    const sw = cellWidth / scale, sh = cellHeight / scale;
    try {
      ctx.drawImage(decoder, (w - sw) / 2, (h - sh) / 2, sw, sh, index * cellWidth, 0, cellWidth, cellHeight);
    } catch { return close(); }
    if (++index === count) close();
    else seek();
  }
  decoder.addEventListener('loadedmetadata', seek);
  decoder.addEventListener('seeked', draw);
  decoder.addEventListener('error', close);
  decoder.src = url;
  return close;
}

export function mountEditorTimeline({doc, control, original, music, changed, canEdit}) {
  const element = id => doc.getElementById(id);
  const track = element('timeTrack'), play = element('stagePlayback'), scrub = element('scrub');
  const video = original?.video;
  const handlers = [], handles = [element('trimStart'), element('trimEnd')];
  let file = null, duration = 0, cursor = 0, pending = null, ready = false, dragging = null, gripOffset = 0, cancelFrames;
  let followPlayback = false;
  function on(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    handlers.push(() => target.removeEventListener(type, handler));
  }
  const getTime = key => control(key).value === '' ? null : Math.round(Number(control(key).value) * 1000);
  const setTime = (key, ms) => {control(key).value = ms === null ? '' : String(ms / 1000);};
  function bounds() {return [getTime('start_ms') ?? 0, getTime('end_ms') ?? duration];}
  function paintCursor() {
    if (!duration) return;
    track.style.setProperty('--cursor', (100 * cursor / duration) + '%');
    scrub.value = String(cursor);
    scrub.setAttribute('aria-valuetext', seconds(cursor));
    element('timeClock').textContent = clock(cursor) + ' / ' + clock(duration);
  }
  function paint() {
    if (!duration) return;
    const [a,b] = bounds(), cover = getTime('cover_ms');
    track.style.setProperty('--start', (100 * a / duration) + '%');
    track.style.setProperty('--end', (100 * b / duration) + '%');
    element('cutBounds').textContent = 'Von ' + seconds(a) + ' bis ' + seconds(b);
    element('cutDuration').textContent = 'Dauer ' + seconds(b - a);
    element('coverMark').hidden = cover === null;
    element('coverMark').style.left = (100 * (cover ?? 0) / duration) + '%';
    element('coverTime').textContent = cover === null ? '' : 'Cover bei ' + seconds(cover);
    handles.forEach((handle,i) => {
      handle.setAttribute('aria-valuemin', String((i ? a + 1 : 0) / 1000));
      handle.setAttribute('aria-valuemax', String((i ? duration : b - 1) / 1000));
      handle.setAttribute('aria-valuenow', String((i ? b : a) / 1000));
      handle.setAttribute('aria-valuetext', seconds(i ? b : a));
    });
    paintCursor();
  }
  function applyPending() {
    if (!ready || !pending) return;
    const action = pending;
    pending = null;
    if (!canEdit() || doc.visibilityState === 'hidden') return;
    if (action === 'play') {
      const [a,b] = bounds();
      const end = Math.min(b / 1000, video.duration);
      if (!original.playRange(a / 1000, end)) element('editorOriginal').querySelector('[role=status]').textContent = 'Der ausgewählte Ausschnitt ist im Video nicht erreichbar.';
    } else original.seekTo(Math.max(0, Math.min(cursor / 1000, video.duration - .001)));
  }
  function requestAction(action) {
    if (!original || !originalVideoSupported(file)) return;
    followPlayback = action === 'play';
    pending = action;
    if (ready) applyPending();
    else void original.load();
  }
  function moveCursor(ms) {
    if (!duration || !canEdit()) return;
    cursor = clamp(ms, 0, duration);
    paintCursor();
    requestAction('seek');
  }
  function trim(index, ms) {
    if (!duration || !canEdit()) return;
    const [a,b] = bounds();
    const value = index ? clamp(ms, a+1, duration) : clamp(ms, 0, b-1);
    setTime(index ? 'end_ms' : 'start_ms', index && value === duration ? null : value);
    const [start,end] = bounds(), cover = getTime('cover_ms');
    if (cover !== null) setTime('cover_ms', clamp(cover,start,end-1));
    moveCursor(index ? value-1 : value);
    changed();
  }
  function timeAt(event) {
    const rect = track.getBoundingClientRect();
    return rect.width ? Math.round(duration * clamp((event.clientX - rect.left) / rect.width, 0, 1)) : cursor;
  }
  handles.forEach((handle,index) => {
    on(handle, 'pointerdown', event => {
      if (!canEdit() || event.button !== 0 || dragging !== null) return;
      event.preventDefault(); handle.focus(); handle.setPointerCapture(event.pointerId);
      dragging = event.pointerId;
      gripOffset = bounds()[index] - timeAt(event);
    });
    on(handle, 'pointermove', event => {if (dragging === event.pointerId) trim(index,timeAt(event) + gripOffset);});
    on(handle, 'lostpointercapture', () => {dragging = null;});
    on(handle, 'keydown', event => {
      const step = event.shiftKey ? 1000 : 40, [a,b] = bounds();
      const offsets = {ArrowRight:step,ArrowUp:step,ArrowLeft:-step,ArrowDown:-step,PageUp:1000,PageDown:-1000};
      if (!(event.key in offsets) && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      trim(index,event.key === 'Home' ? 0 : event.key === 'End' ? duration : (index ? b : a) + offsets[event.key]);
    });
  });
  on(scrub,'input',() => moveCursor(Number(scrub.value)));
  on(scrub,'keydown',event => {
    const step = event.shiftKey ? 1000 : 40;
    const positions = {Home:0, End:duration, ArrowLeft:cursor-step, ArrowRight:cursor+step};
    if (!Object.hasOwn(positions,event.key)) return;
    event.preventDefault();
    moveCursor(positions[event.key]);
  });
  on(element('useCover'),'click',() => {
    if (!duration || !canEdit()) return;
    const [a,b] = bounds(), value = clamp(cursor,a,b-1);
    setTime('cover_ms', value);
    moveCursor(value); changed();
  });
  on(play,'click',() => {
    if (!canEdit()) return;
    if (ready && !video.paused) {original.stop(); return;}
    requestAction('play');
  });
  function updatePlaying() {
    const playing = !!(ready && !video.paused && !video.ended);
    play.dataset.playing = String(playing);
    play.setAttribute('aria-label', playing ? 'Wiedergabe anhalten' : 'Gewählten Ausschnitt abspielen');
    play.firstElementChild.textContent = playing ? 'Ⅱ' : '▶';
  }
  for (const event of ['playing','play','pause','ended']) on(video, event, updatePlaying);
  for (const event of ['playing','seeked','timeupdate','ratechange']) {
    on(video,event,()=>{if(ready)music.syncPreview(video,bounds()[0]);});
  }
  for (const event of ['pause','waiting','seeking','ended','emptied']) on(video,event,()=>music.stopPreview());
  on(video,'timeupdate',() => {
    // The slider owns the cursor during manual seeking. A delayed timeupdate
    // from the previous seek must never replace the user's cover selection.
    if (!ready || !followPlayback || dragging !== null) return;
    cursor = clamp(Math.round(video.currentTime * 1000), 0, duration);
    paintCursor();
  });
  function readyChange(value) {
    ready = value;
    if (!value) {
      music.stopPreview(); cancelFrames?.(); cancelFrames = null;
      element('frameStrip').width = 0;
    } else {
      if (video.src && !cancelFrames) cancelFrames = drawFrames(doc,element('frameStrip'),video.src);
      applyPending();
    }
    updatePlaying();
  }
  function setFile(next) {
    const total = next?.media_kind === 'video' && next.duration_ms > 0 ? next.duration_ms : 0;
    if (file?.id !== next?.id || file?.revision !== next?.revision || duration !== total || !next) {
      pending = null; followPlayback = false; dragging = null; cursor = 0;
      readyChange(false);
    }
    file = next;
    duration = total;
    play.hidden = !(original && originalVideoSupported(file));
    element('timeline').hidden = !duration;
    element('useCover').hidden = !duration;
    if (!duration) {element('coverTime').textContent = '';return;}
    scrub.max = String(duration);
    const ruler = element('timeRuler');
    ruler.replaceChildren(...[0,.25,.5,.75,1].map(fraction => {
      const tick = doc.createElement('span');
      tick.textContent = seconds(Math.round(duration * fraction)); return tick;
    }));
    paint();
  }
  return {setFile,paint,readyChange,prepare(){if(originalVideoSupported(file))void original?.load();},
    pause(){pending = null; followPlayback = false; music.stopPreview(); original?.stop();},
    destroy(){pending = null; cancelFrames?.(); handlers.forEach(remove => remove());}};
}
