import {quickStart, guides} from './tutorial-catalog.mjs';

const asset = (id, extension) => new URL('../tutorials/' + id + '.' + extension, import.meta.url).href;

export function mountTutorials(doc, tabs) {
  if (!tabs) return;
  const page = doc.getElementById('page-tutorials');
  const cleanups = [];
  const players = [];
  const translated = (tag, de, en) => {
    const node = doc.createElement(tag);
    node.dataset.de = de;
    node.dataset.en = en;
    node.textContent = doc.documentElement.lang === 'en' ? en : de;
    return node;
  };

  for (const [key, lessons] of [['start', quickStart], ['guides', guides]]) {
    const panel = tabs.entries.find(entry => entry.key === key)?.panel;
    if (!panel) continue;

    // Retain the shell's original nodes for teardown. The shared help slot stays movable.
    const originals = [...panel.children].filter(node => node.matches('.card,.grid'));
    const visibility = originals.map(node => node.hidden);
    originals.forEach(node => { node.hidden = true; });
    const root = doc.createElement('div');
    root.className = 'sma-tutorials';
    const list = doc.createElement('div');
    list.className = 'sma-lesson-list';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-labelledby', 'sma-tutorials-tab-' + key);
    const content = doc.createElement('article');
    content.className = 'sma-lesson-view';
    content.id = 'sma-tutorial-player-' + key;
    root.append(list, content);
    panel.prepend(root);
    let current;
    let video;
    const pause = () => {
      if (video && video.paused === false) video.pause();
    };
    players.push({panel, pause});

    function select(lesson) {
      if (current === lesson) return;
      pause();
      current = lesson;
      for (const button of list.children) {
        button.setAttribute('aria-pressed', String(button.dataset.lesson === lesson.id));
      }
      const header = doc.createElement('header');
      const title = translated('h2', lesson.title, lesson.en);
      const time = doc.createElement('span');
      time.textContent = lesson.duration + ' min · DE';
      header.append(title, time);

      video = doc.createElement('video');
      video.controls = true;
      video.setAttribute('playsinline', '');
      title.id = content.id + '-title';
      video.setAttribute('aria-labelledby', title.id);
      video.preload = 'none';
      video.poster = asset(lesson.id, 'jpg');
      video.src = asset(lesson.id, 'mp4');

      const problem = doc.createElement('p');
      const errorText = translated('span', 'Das Video konnte nicht geladen werden.', 'The video could not be loaded.');
      problem.setAttribute('role', 'status');
      problem.hidden = true;
      const retry = translated('button', 'Erneut laden', 'Retry');
      retry.type = 'button';
      const media = video;
      retry.onclick = () => { problem.hidden = true; media.load(); };
      media.addEventListener('error', () => { problem.hidden = false; });
      problem.append(errorText, ' ', retry);
      const steps = doc.createElement('details');
      const summary = translated('summary', 'Schritte zum Nachlesen', 'Read the steps (German)');
      const instructions = doc.createElement('ol');
      instructions.lang = 'de';
      for (const step of lesson.steps) {
        const li = doc.createElement('li');
        li.textContent = step;
        instructions.append(li);
      }
      steps.append(summary, instructions);
      if (lesson.id === 'social-verbinden') {
        const help = translated('a', 'YouTube-Hilfe zu anklickbaren Links', 'YouTube Help on clickable links');
        help.href = 'https://support.google.com/youtube/answer/13748639';
        help.target = '_blank';
        help.rel = 'noopener noreferrer';
        steps.append(help);
      }
      content.replaceChildren(header, media, problem, steps);
    }

    for (const lesson of lessons) {
      const button = translated('button', lesson.title, lesson.en);
      button.type = 'button';
      button.dataset.lesson = lesson.id;
      button.setAttribute('aria-controls', content.id);
      button.onclick = () => select(lesson);
      list.append(button);
    }
    select(lessons[0]);
    cleanups.push(() => {
      pause();
      root.remove();
      originals.forEach((node, index) => { node.hidden = visibility[index]; });
    });
  }

  function pauseHidden() {
    for (const {panel, pause} of players) {
      if (doc.hidden || panel.hidden || !page.classList.contains('active')) pause();
    }
  }
  const Observer = doc.defaultView?.MutationObserver;
  const observer = Observer && new Observer(pauseHidden);
  observer?.observe(page, {attributes: true, attributeFilter: ['class']});
  for (const {panel} of players) observer?.observe(panel, {attributes: true, attributeFilter: ['hidden']});
  doc.addEventListener('visibilitychange', pauseHidden);
  return () => {
    observer?.disconnect();
    doc.removeEventListener('visibilitychange', pauseHidden);
    cleanups.forEach(cleanup => cleanup());
  };
}
