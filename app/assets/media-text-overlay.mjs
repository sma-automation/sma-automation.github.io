// Draw in output pixels so the scaled editor preview and the exported overlay match.
export function drawMediaOverlay(canvas, width, height, text, position, style, reportLayout) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  if (!text) return true;

  if (style) {
    const bounds = drawStyledText(ctx, width, height, text, style);
    reportLayout?.(bounds);
    return true;
  }
  const fontSize = Math.max(16, Math.round(width / 25));
  const padding = Math.round(width * .025);
  const left = Math.round(width * .05);
  const maxTextWidth = width - 2 * (left + padding);
  ctx.font = '500 ' + fontSize + 'px Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const lines = wrapText(ctx, text, maxTextWidth);


  const lineHeight = Math.ceil(fontSize * 1.35);
  const boxHeight = lines.length * lineHeight + 2 * padding;
  let top = height * .05;
  if (position === 'center') top = (height - boxHeight) / 2;
  if (position === 'bottom') top = height * .95 - boxHeight;
  top = Math.max(0, Math.round(top));
  reportLayout?.({left,top,width:width-2*left,height:boxHeight,fontSize});
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(left, top, width - 2 * left, boxHeight);
  ctx.fillStyle = 'white';
  lines.forEach((value, index) => ctx.fillText(value, width / 2, top + padding + lineHeight * (index + .5)));
  return true;
}

function wrapText(ctx, text, maxTextWidth) {
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
  return lines;
}

function drawStyledText(ctx, width, height, text, style) {
  const padding = Math.max(1, Math.round(width * .012));
  const maxWidth = Math.max(1, width * .94 - 2 * padding);
  const maxHeight = Math.max(1, height - 2 * padding);
  let fontSize = Math.max(1, Math.round(width * .09 * style.size / 100));
  let lines, lineHeight;
  // Keep long captions visible even when changing from a portrait to a wide canvas.
  do {
    ctx.font = (style.bold ? '700 ' : '400 ') + fontSize + 'px Arial, sans-serif';
    lines = wrapText(ctx, text, maxWidth);
    lineHeight = Math.ceil(1.15 * fontSize);
    if (lineHeight * lines.length <= maxHeight || fontSize <= 1) break;
    fontSize = Math.max(1, Math.min(fontSize - 1, Math.floor(fontSize * .9)));
  } while (true);

  const boxWidth = Math.min(width, Math.ceil(Math.max(...lines.map(line => ctx.measureText(line).width))) + 2 * padding);
  const boxHeight = Math.min(height, lines.length * lineHeight + 2 * padding);
  const left = Math.round(Math.max(0, Math.min(width - boxWidth, width * style.x / 100 - boxWidth / 2)));
  const top = Math.round(Math.max(0, Math.min(height - boxHeight, height * style.y / 100 - boxHeight / 2)));
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = style.color;
  ctx.shadowColor = style.color === '#15171f' ? 'rgba(255,255,255,.8)' : 'rgba(0,0,0,.85)';
  ctx.shadowBlur = Math.max(1, fontSize * .09);
  ctx.shadowOffsetY = Math.max(1, fontSize * .025);
  lines.forEach((line, index) => ctx.fillText(line, left + boxWidth / 2, top + padding + lineHeight * (index + .5)));
  ctx.shadowBlur = ctx.shadowOffsetY = 0;
  return {left,top,width:boxWidth,height:boxHeight,fontSize};
}
