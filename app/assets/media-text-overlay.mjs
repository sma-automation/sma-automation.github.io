// Draw in output pixels so the scaled editor preview and the exported overlay match.
export function drawMediaOverlay(canvas, width, height, text, position) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  if (!text) return true;

  const fontSize = Math.max(16, Math.round(width / 25));
  const padding = Math.round(width * .025);
  const left = Math.round(width * .05);
  const maxTextWidth = width - 2 * (left + padding);
  ctx.font = '500 ' + fontSize + 'px Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const lines = [];
  let line = '';
  for (const token of text.match(/ +|[^ ]+/gu) || []) {
    if (token.startsWith(' ')) {
      line += token;
      continue;
    }
    if (line && ctx.measureText(line + token).width > maxTextWidth) {
      const complete = line.replace(/ +$/, '');
      if (complete) lines.push(complete);
      line = '';
    }
    if (ctx.measureText(token).width <= maxTextWidth) {
      line += token;
      continue;
    }
    // Split only words that cannot fit on an empty line.
    const graphemes = typeof Intl.Segmenter === 'function'
      ? Array.from(new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(token), entry => entry.segment)
      : Array.from(token);
    for (const character of graphemes) {
      if (line && ctx.measureText(line + character).width > maxTextWidth) {
        lines.push(line);
        line = '';
      }
      line += character;
    }
  }
  lines.push(line.replace(/ +$/, ''));

  const lineHeight = Math.ceil(fontSize * 1.35);
  const boxHeight = lines.length * lineHeight + 2 * padding;
  let top = height * .05;
  if (position === 'center') top = (height - boxHeight) / 2;
  if (position === 'bottom') top = height * .95 - boxHeight;
  top = Math.max(0, Math.round(top));
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(left, top, width - 2 * left, boxHeight);
  ctx.fillStyle = 'white';
  lines.forEach((value, index) => ctx.fillText(value, width / 2, top + padding + lineHeight * (index + .5)));
  return true;
}
