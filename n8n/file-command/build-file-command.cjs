'use strict';
const crypto = require('node:crypto');
const {createFileCommandRuntime} = require('./command-runtime.cjs');

const SOURCES = {
  lo3Wt6jem0CxCrJF: {operation: 'media.device_upload', commands: ['upload_start', 'upload_finish'],
    entry: 'Anfrage prüfen', auth: ['Upload reservieren'], kind: 'upload', fixture: 'device-upload-workflow.json'},
  dheEkIi8KUNqHpmq: {operation: 'content.image_analysis', commands: ['magic_photo'],
    entry: 'Anfrage prüfen', auth: ['Fotoerkennung reservieren'], kind: 'asset', fixture: 'magic-effect-workflow.json'},
  a1F5Ps0B3sXMh70S: {operation: 'content.video_analysis', commands: ['magic_video'],
    entry: 'Anfrage prüfen', auth: ['Videoerkennung reservieren'], kind: 'asset', fixture: 'video-magic-workflow.json'},
  mWoUMjzxAsfggRHU: {operation: 'content.review', commands: ['review'],
    entry: 'Anfrage prüfen', auth: ['Prüfung reservieren'], kind: 'asset', fixture: 'content-review-workflow.json'},
  '9dNstQ4E2uXpZ18Z': {operation: 'content.preview', commands: ['preview_prepare'],
    entry: 'Eingabe prüfen', auth: ['Konto und Shop prüfen'], kind: 'preview', fixture: 'preview-workflow.json'},
  RdtCqCWRi7P4W7B0: {operation: 'publication.order_api', commands: ['account', 'order_prepare', 'order_approve'],
    entry: 'Dashboard-Anfrage prüfen', auth: ['Eigenen Auftrag bearbeiten', 'Eigenes Kontoziel lesen'], kind: 'order', fixture: 'publication-order-api-workflow.json'},
};

function replaceReference(value, oldName, replacement) {
  if (Array.isArray(value)) return value.map(item => replaceReference(item, oldName, replacement));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceReference(item, oldName, replacement)]));
  if (typeof value !== 'string') return value;
  return value.replace(/\$\(\s*(['"])([^'"\r\n]+)\1\s*\)/g, (match, quote, name) => name === oldName ? replacement : match);
}

function adaptAuthGate(code, kind, internalExpression) {
  const negative = "typeof auth!=='string'||!/^Bearer [A-Za-z0-9._-]{20,8000}$/.test(auth)";
  const positive = "typeof a==='string'&&/^Bearer [A-Za-z0-9._-]{20,8000}$/.test(a)";
  const needle = kind === 'asset' ? positive : negative;
  if (code.split(needle).length !== 2) throw Error('AUTH_GATE_SOURCE_CHANGED');
  const replacement = kind === 'asset' ? '(' + internalExpression + '||(' + needle + '))' :
    '!(' + internalExpression + ')&&(' + needle + ')';
  return code.replace(needle, replacement);
}

function transformFileCommandSource(original) {
  const config = SOURCES[original.id];
  if (!config) throw Error('UNKNOWN_COMMAND_SOURCE');
  const workflow = structuredClone(original), sourceNodes = [...workflow.nodes];
  if (sourceNodes.some(node => node.type === 'n8n-nodes-base.executeWorkflowTrigger')) throw Error('INTERNAL_TRIGGER_ALREADY_PRESENT');
  const hooks = sourceNodes.filter(node => node.type === 'n8n-nodes-base.webhook');
  const responses = sourceNodes.filter(node => node.type === 'n8n-nodes-base.respondToWebhook');
  if (hooks.length !== 1 || responses.length !== 1) throw Error('COMMAND_SOURCE_TRIGGER_SHAPE_CHANGED');
  const hook = hooks[0], response = responses[0];
  if (response.parameters.respondWith !== 'json' || response.parameters.options?.responseCode !== 200 ||
      typeof response.parameters.responseBody !== 'string' || !response.parameters.responseBody.startsWith('={{')) throw Error('COMMAND_RESPONSE_SOURCE_CHANGED');
  const timeout = workflow.settings?.executionTimeout;
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw Error('COMMAND_SOURCE_TIMEOUT_REQUIRED');
  const byName = name => {const node = workflow.nodes.find(item => item.name === name); if (!node) throw Error('MISSING_COMMAND_NODE: ' + name); return node;};
  byName(config.entry); config.auth.forEach(byName);
  const template = sourceNodes.find(node => node.type === 'n8n-nodes-base.httpRequest' && node.parameters.authentication === 'genericCredentialType' &&
    node.parameters.genericAuthType === 'httpHeaderAuth' && node.credentials?.httpHeaderAuth && /\/rest\/v1\/rpc\//.test(node.parameters.url));
  if (!template || !/^https:\/\/[a-z0-9]+\.supabase\.co\/rest\/v1\/rpc\/[a-z0-9_]+$/.test(template.parameters.url)) throw Error('EXISTING_SERVICE_RPC_REQUIRED');
  const rpcURL = template.parameters.url.replace(/\/rpc\/[^/]+$/, '/rpc/sma_file_job_worker_v1');
  const runtime = 'const command=(' + createFileCommandRuntime.toString() + ')();\n';
  const nodes = [], originalConnections = structuredClone(workflow.connections), authNative = new Map();
  function add(label, type, parameters, extra = {}) {
    const name = 'Command · ' + label;
    if (workflow.nodes.some(node => node.name === name) || nodes.some(node => node.name === name)) throw Error('COMMAND_NODE_NAME_COLLISION');
    const hex = crypto.createHash('sha256').update(workflow.id + '\0file-command-v1\0' + name).digest('hex');
    nodes.push({id: hex.slice(0,8) + '-' + hex.slice(8,12) + '-4' + hex.slice(13,16) + '-8' + hex.slice(17,20) + '-' + hex.slice(20,32),
      name, type: 'n8n-nodes-base.' + type, typeVersion: type === 'code' ? 2 : type === 'if' ? 2.2 : type === 'httpRequest' ? template.typeVersion : 1.1,
      position: [-800 + (nodes.length % 4) * 300, 700 + Math.floor(nodes.length / 4) * 180], parameters, ...extra});
    return name;
  }
  function edge(from, to, output = 0) {
    const links = workflow.connections[from] ??= {main: []};
    while (links.main.length <= output) links.main.push([]);
    links.main[output].push({node: to, type: 'main', index: 0});
  }
  function setEdges(from, links, output = 0) {
    const connection = workflow.connections[from] ??= {main: []};
    while (connection.main.length <= output) connection.main.push([]);
    connection.main[output] = structuredClone(links || []);
  }
  function redirect(oldName, newName) {
    for (const connection of Object.values(workflow.connections)) for (const branch of connection.main || []) for (const link of branch) if (link.node === oldName) link.node = newName;
  }
  const expr = name => '$(' + JSON.stringify(name) + ')';
  const first = name => expr(name) + '.first(0,0).json';
  const latest = name => expr(name) + '.first(0).json';
  const boolean = condition => ({conditions: {options: {caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2},
    conditions: [{id: 'native-command', leftValue: '={{ ' + condition + ' }}', rightValue: '', operator: {type: 'boolean', operation: 'true', singleValue: true}}], combinator: 'and'}, options: {}});
  const native = add('Nativer Eingang', 'executeWorkflowTrigger', {inputSource: 'passthrough'});
  const isNative = expr(native) + '.isExecuted';
  const ticket = add('Ticket prüfen', 'code', {jsCode: runtime + 'if($input.all().length!==1)throw Error("FILE_COMMAND_SINGLE_REQUIRED");const item=$input.first();return [command.copyItem(item,command.ticket(item.json,$execution.id,' + timeout + ',Date.now()))];'});
  function rpc(label, body, context, extra = {}) {
    const parameters = structuredClone(template.parameters);
    parameters.url = rpcURL; parameters.jsonBody = '={{ ' + body + ' }}';
    parameters.options = {...parameters.options, timeout: '={{ Math.max(1,Math.min(25000,' + context + '.deadlineAt-Date.now())) }}'};
    return add(label, 'httpRequest', parameters, {credentials: structuredClone(template.credentials), ...extra});
  }
  const claimPrepare = add('Claimparameter binden', 'code', {jsCode: runtime + 'return [{json:command.claimParams(' + first(ticket) + ',Date.now())}];'});
  const claim = rpc('Command übernehmen', '$json', first(ticket));
  const accepted = add('Claim bestätigen', 'code', {jsCode: runtime + 'const origin=' + expr(ticket) + '.first(0,0);return [command.copyItem(origin,command.claimed($input.first().json,origin.json,' + JSON.stringify(config.commands) + ',Date.now()))];'});
  const common = add('Gemeinsamer Eingang', 'code', {jsCode: runtime + 'const item=$input.first();return [command.copyItem(item,' + isNative + '?' + first(accepted) + '.request:item.json)];'});
  edge(native, ticket); edge(ticket, claimPrepare); edge(claimPrepare, claim); edge(claim, accepted); edge(accepted, common);
  workflow.connections[hook.name] = {main: [[{node: common, type: 'main', index: 0}]]};
  setEdges(common, originalConnections[hook.name]?.main?.[0]);
  if (originalConnections[hook.name]?.main?.[0]?.length !== 1 || originalConnections[hook.name].main[0][0].node !== config.entry) throw Error('COMMAND_SOURCE_ENTRY_CHANGED');
  byName(config.entry).parameters.jsCode = adaptAuthGate(byName(config.entry).parameters.jsCode, config.kind, isNative);

  for (const name of config.auth) {
    const source = byName(name), incoming = add('Interner RPC · ' + name + '?', 'if', boolean(isNative));
    const prepare = add('Reservierung binden · ' + name, 'code', {jsCode: runtime + 'return [{json:command.params("reserve",' + first(accepted) + ',{},Date.now())}];'});
    const reserved = rpc('Privat reservieren · ' + name, '$json', first(accepted), {onError: source.onError || 'stopWorkflow'});
    authNative.set(name, reserved);
    redirect(name, incoming); edge(incoming, prepare, 0); edge(incoming, name, 1); edge(prepare, reserved);
    workflow.connections[reserved] = structuredClone(originalConnections[name] || {main: []});
  }
  // A native reservation executes the same whitelisted database function under
  // its stored owner. Existing downstream references see that function's exact
  // response, while public calls keep their original user-JWT RPC and checks.
  for (const node of sourceNodes) {
    node.parameters = replaceReference(node.parameters, hook.name, expr(common));
    for (const [name, target] of authNative) node.parameters = replaceReference(node.parameters, name,
      '(' + isNative + '?' + expr(target) + ':' + expr(name) + ')');
  }

  let capture, captured, captureRPC, completeRPC, completeReturn;
  const responseExpression = response.parameters.responseBody.slice(3, -2).trim();
  const responseRoute = add('Interne Antwort?', 'if', boolean(isNative));
  const skipRepeated = config.kind === 'order' ? add('Antwort bereits gespeichert?', 'if', boolean('false')) : null;
  capture = add('Öffentliche Antwort binden', 'code', {jsCode: runtime + 'const item=$input.first(),response=command.publicResponse((' + responseExpression + '),200);return [command.copyItem(item,{continuation:item.json,response,request:command.params("result",' + first(accepted) + ',response,Date.now())})];'});
  captureRPC = rpc('Commandantwort speichern', '$json.request', first(accepted), {onError: 'continueErrorOutput'});
  captured = add('Facharbeit fortsetzen', 'code', {jsCode: runtime + 'command.acknowledge($input.first().json,"RESULT");const saved=' + expr(capture) + '.first(0,0);return [command.copyItem(saved,saved.json.continuation)];'}, {onError: 'continueErrorOutput'});
  const responseOnce = () => expr(capture) + '.isExecuted?' + first(capture) + '.response:null';
  const completeFailed = add('Fehlgeschlagen abschließen', 'code', {jsCode: runtime + 'return [{json:command.completion(' + first(accepted) + ',(' + responseOnce() + '),$input.first().json,"failure",Date.now())}];'});
  const completeResponse = add('Antwort abschließen', 'code', {jsCode: runtime + 'return [{json:command.completion(' + first(accepted) + ',(' + responseOnce() + '),$input.first().json,"response",Date.now())}];'});
  const completeVerified = add('Facharbeit abschließen', 'code', {jsCode: runtime + 'return [{json:command.completion(' + first(accepted) + ',(' + responseOnce() + '),$input.first().json,"verified",Date.now())}];'});
  const completePrepare = add('Abschluss merken', 'code', {jsCode: runtime + 'return $input.all().map(item=>command.copyItem(item));'});
  completeRPC = rpc('Command abschließen', '$json.request', first(accepted));
  completeReturn = add('Privates Ergebnis', 'code', {jsCode: runtime + 'command.acknowledge($input.first().json,"COMPLETION");const end=' + latest(completePrepare) + ';return [{json:command.receipt(' + first(accepted) + ',end.outcome,null,end.detail?{detail:end.detail}:{})}];'});
  for (const name of [completeFailed, completeResponse, completeVerified]) edge(name, completePrepare);
  edge(completePrepare, completeRPC); edge(completeRPC, completeReturn);
  redirect(response.name, responseRoute); edge(responseRoute, skipRepeated || capture, 0); edge(responseRoute, response.name, 1);
  edge(capture, captureRPC); edge(captureRPC, captured, 0); edge(captureRPC, completeFailed, 1); edge(captured, completeFailed, 1);
  const responseNext = originalConnections[response.name]?.main?.[0] || [];
  if (responseNext.length) setEdges(captured, responseNext, 0); else edge(captured, completeResponse, 0);

  let orderFinish = null, orderMetadata = null;
  if (config.kind === 'order') {
    const repeat = add('Gespeicherte Antwort fortsetzen', 'code', {jsCode: runtime + 'return $input.all().map(item=>command.copyItem(item));'});
    nodes.find(node => node.name === skipRepeated).parameters = boolean(expr(capture) + '.isExecuted');
    edge(skipRepeated, repeat, 0); edge(skipRepeated, capture, 1); setEdges(repeat, responseNext);
    const observed = {};
    for (const [key, sourceName] of [['comparison', 'Inhaltsabgleich im Hintergrund'], ['provider', 'Providerweg im Hintergrund']]) {
      const source = byName(sourceName), gate = add('Interner ' + key + '-Befund?', 'if', boolean(isNative));
      const failureGate = add('Interner ' + key + '-Fehler?', 'if', boolean(isNative));
      const kept = add(key === 'provider' ? 'Providerbefund halten' : 'Abgleichbefund halten', 'code', {jsCode: ''});
      nodes.find(node => node.name === kept).parameters.jsCode = runtime + 'const item=$input.first(),sequence=' + expr(kept) + '.isExecuted?' + latest(kept) + '.sequence+1:1;return [command.copyItem(item,{sequence,result:item.json})];';
      observed[key] = kept;
      setEdges(sourceName, [{node: gate, type: 'main', index: 0}], 0); edge(gate, kept, 0); setEdges(gate, originalConnections[sourceName].main[0], 1); setEdges(kept, originalConnections[sourceName].main[0]);
      setEdges(sourceName, [{node: failureGate, type: 'main', index: 0}], 1); edge(failureGate, completeFailed, 0); setEdges(failureGate, originalConnections[sourceName].main[1], 1);
    }
    orderFinish = add('Freigegebenen Auftrag fortsetzen?', 'if', boolean(first(accepted) + '.operation === "order_approve" && (' + responseOnce() + ')?.body?.ok === true'));
    // A private running comparison waits in this command. A failed comparison
    // cannot fall through to a provider attempt merely because the original
    // early HTTP response was successful. Public source edges stay unchanged.
    const comparisonDone = add('Abgleich tatsächlich abgeschlossen?', 'if', boolean('$json.result?.ok === true && $json.result.state === "completed"'));
    const comparisonRunning = add('Abgleich läuft bereits?', 'if', boolean('$json.result?.ok === true && $json.result.state === "running"'));
    setEdges(observed.comparison, [{node: comparisonDone, type: 'main', index: 0}]);
    setEdges(comparisonDone, originalConnections['Inhaltsabgleich im Hintergrund'].main[0], 0); edge(comparisonDone, comparisonRunning, 1);
    edge(comparisonRunning, orderFinish, 0); edge(comparisonRunning, completeFailed, 1);
    const continuePrepare = add('Auftragsstatus binden', 'code', {jsCode: runtime + 'return [{json:command.params("order_continue",' + first(accepted) + ',{},Date.now())}];'}, {onError: 'continueErrorOutput'});
    const continued = rpc('Auftrag privat erneut lesen', '$json', first(accepted), {onError: 'continueErrorOutput'});
    const decision = add('Fortsetzung entscheiden', 'code', {jsCode: ''}, {onError: 'continueErrorOutput'});
    nodes.find(node => node.name === decision).parameters.jsCode = runtime +
      'const previous=' + expr(decision) + '.isExecuted?' + latest(decision) + ':null,observation=' + expr(observed.provider) + '.isExecuted?' + latest(observed.provider) + ':null,comparison=' + expr(observed.comparison) + '.isExecuted?' + latest(observed.comparison) + '.result:null;\n' +
      'return [{json:command.orderDecision($input.first().json,' + first(accepted) + ',previous,observation,comparison,Date.now())}];';
    const done = add('Providerarbeit vollständig?', 'if', boolean('$json.action === "completed"'));
    const failed = add('Fortsetzung gesperrt?', 'if', boolean('$json.action === "failed"'));
    const wait = add('Providerstatus abwarten?', 'if', boolean('$json.action === "wait"'));
    const pause = add('Drei Sekunden abwarten', 'code', {jsCode: runtime + 'command.remaining(' + first(accepted) + ',Date.now());await new Promise(resolve=>setTimeout(resolve,3000));command.remaining(' + first(accepted) + ',Date.now());return $input.all().map(item=>command.copyItem(item));'}, {onError: 'continueErrorOutput'});
    const next = add('Frischen Auftrag fortsetzen', 'code', {jsCode: runtime + 'command.remaining(' + first(accepted) + ',Date.now());return [{json:$input.first().json.order}];'}, {onError: 'continueErrorOutput'});
    const stop = add('Fortsetzungsbefund abschließen', 'code', {jsCode: runtime + 'const plan=$input.first().json,ending=command.completion(' + first(accepted) + ',(' + responseOnce() + '),{ok:plan.action==="completed"},plan.action==="completed"?"verified":"failure",Date.now());return [{json:{...ending,detail:plan.code}}];'});
    edge(orderFinish, continuePrepare, 0); edge(orderFinish, completeResponse, 1);
    edge(continuePrepare, continued, 0); edge(continuePrepare, completeFailed, 1); edge(continued, decision, 0); edge(continued, completeFailed, 1);
    edge(decision, done, 0); edge(decision, completeFailed, 1); edge(done, stop, 0); edge(done, failed, 1); edge(failed, stop, 0); edge(failed, wait, 1);
    edge(wait, pause, 0); edge(wait, next, 1); edge(pause, continuePrepare, 0); edge(pause, completeFailed, 1);
    edge(next, 'Zielkonto zuordnen?', 0); edge(next, completeFailed, 1); edge(stop, completePrepare);
    orderMetadata = {decision, waitNode: pause, continuationRPC: continued, originalBudgetSeconds: timeout};
  }
  const failedTerminals = new Set(['Erkennungsfehler speichern', 'Prüffehler speichern']);
  const terminals = [];
  for (const node of sourceNodes) {
    if (node.type === 'n8n-nodes-base.respondToWebhook' || node.disabled) continue;
    const ordinary = node.type === 'n8n-nodes-base.if' ? 2 : 1;
    const outputs = ordinary + (node.onError === 'continueErrorOutput' ? 1 : 0);
    for (let port = 0; port < outputs; port++) {
      if (originalConnections[node.name]?.main?.[port]?.length) continue;
      const gate = add('Interner Abschluss · ' + node.name + ' · ' + port + '?', 'if', boolean(isNative));
      edge(node.name, gate, port);
      const failure = port >= ordinary || failedTerminals.has(node.name);
      const target = failure ? completeFailed : orderFinish || (node.type === 'n8n-nodes-base.if' ? completeResponse : completeVerified);
      edge(gate, target, 0); terminals.push({node: node.name, output: port, failure});
    }
  }
  workflow.nodes.push(...nodes);
  return {workflow, metadata: {sourceId: workflow.id, sourceVersionId: workflow.versionId, operation: config.operation,
    commands: config.commands, internalTrigger: native, entryNode: ticket, publicEntry: common,
    capturedResponse: capture, responseAcknowledgement: captured, completion: completeReturn, terminals,
    ...(orderMetadata ? {orderContinuation: orderMetadata} : {})}};
}

module.exports = {SOURCES, adaptAuthGate, transformFileCommandSource};

if (require.main === module) {
  const fs = require('node:fs'), path = require('node:path');
  const [sourceDir, outputDir] = process.argv.slice(2);
  if (!sourceDir || !outputDir || process.argv.length !== 4) throw Error('Usage: node build-file-command.cjs PRIVATE_SOURCE_DIR PRIVATE_OUTPUT_DIR');
  const output = path.resolve(outputDir), repository = path.resolve(__dirname, '../..');
  if (output === path.resolve(sourceDir) || output === repository || output.startsWith(repository + path.sep)) throw Error('PRIVATE_OUTPUT_REQUIRED');
  fs.mkdirSync(output, {recursive: true}); const overlays = [];
  for (const id of Object.keys(SOURCES)) {
    const bytes = fs.readFileSync(path.join(sourceDir, id + '.json')), parsed = JSON.parse(bytes), original = Array.isArray(parsed) ? parsed[0] : parsed;
    const {workflow, metadata} = transformFileCommandSource(original), text = JSON.stringify(workflow, null, 2) + '\n', file = id + '.json';
    fs.writeFileSync(path.join(output, file), text, {mode: 0o600});
    overlays.push({...metadata, file, sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'), candidateSha256: crypto.createHash('sha256').update(text).digest('hex')});
  }
  fs.writeFileSync(path.join(output, 'file-command-overlays.json'), JSON.stringify({version: 1, overlays}, null, 2) + '\n', {mode: 0o600});
  process.stdout.write(JSON.stringify({overlays: overlays.map(({sourceId, sourceSha256, candidateSha256, operation}) => ({sourceId, sourceSha256, candidateSha256, operation}))}, null, 2) + '\n');
}
