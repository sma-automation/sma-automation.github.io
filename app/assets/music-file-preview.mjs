import {dashboardAction} from './dashboard-feedback.mjs?v=1';
import {musicClipDescription} from './music-clip-filters.mjs?v=1';

const activePreviews = new WeakMap();

export function musicFileLabel(doc, track, detail, onClick) {
  const label = doc.createElement(onClick ? 'button' : 'div');
  label.className = 'sma-music-file';
  if (onClick) {
    label.type = 'button';
    label.dataset.smaActionKey = 'music-preview/' + track.sha256;
    label.title = 'Hörprobe abspielen oder pausieren';
    label.setAttribute('aria-label', track.name + ' – Hörprobe abspielen oder pausieren');
    label.addEventListener('click', dashboardAction(onClick));
  }
  const title = doc.createElement('strong');
  title.textContent = track.name;
  label.append(title);
  for (const text of [detail, musicClipDescription(track)].filter(Boolean)) {
    const line = doc.createElement('small');
    line.textContent = text;
    label.append(line);
  }
  return label;
}

export function createMusicPreview({doc, audio, status, source, createURL, revokeURL}) {
  let request, current, url, observer;
  function stop() {
    request?.abort();
    request = current = null;
    observer?.disconnect();
    observer = null;
    if (activePreviews.get(doc) === stop) activePreviews.delete(doc);
    audio.pause?.();
    audio.removeAttribute('src');
    audio.load?.();
    audio.hidden = true;
    if (url) revokeURL(url);
    url = null;
  }
  async function play(track) {
    if (url && current === track.sha256 && !audio.paused && !audio.ended) {
      audio.pause();
      status.textContent = 'Pausiert · ' + track.name;
      return;
    }
    if (!url || current !== track.sha256) {
      activePreviews.get(doc)?.();
      activePreviews.set(doc, stop);
      current = track.sha256;
      request = new AbortController();
      const {signal} = request;
      if (doc.defaultView?.MutationObserver) {
        observer = new doc.defaultView.MutationObserver(() => {
          for (let el=audio.parentElement; el; el=el.parentElement) {
            if (el.hidden || el.getAttribute('aria-hidden')==='true' || doc.defaultView.getComputedStyle?.(el).display==='none') {
              stop();
              break;
            }
          }
        });
        for (let parent=audio.parentElement; parent; parent=parent.parentElement) {
          observer.observe(parent, {attributes:true, attributeFilter:['hidden','aria-hidden','class','style']});
        }
      }
      status.textContent = 'Hörprobe wird geladen …';
      try {
        const blob = await source(track, signal);
        if (signal.aborted) return;
        url = createURL(blob);
        audio.src = url;
        audio.hidden = false;
      } catch {
        if (!signal.aborted) {
          stop();
          status.textContent = 'Diese Hörprobe konnte nicht geladen werden.';
        }
        return;
      }
    }
    const {signal} = request;
    try {
      if (audio.ended) audio.currentTime = 0;
      await audio.play();
      if (!signal.aborted) status.textContent = 'Hörprobe · ' + track.name;
    } catch (error) {
      if (!signal.aborted) status.textContent = error.name === 'NotAllowedError'
        ? 'Starte die Hörprobe im Audioplayer.'
        : 'Die Hörprobe konnte nicht abgespielt werden.';
    }
  }
  return {play, stop};
}
