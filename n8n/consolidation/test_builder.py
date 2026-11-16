"""Offline contract tests. Fixtures are invented and contain no provider data."""

import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

import build as builder


SETTINGS = {
    'executionOrder': 'v1', 'binaryMode': 'separate', 'executionTimeout': 120,
    'saveDataErrorExecution': 'none', 'saveDataSuccessExecution': 'none',
    'saveManualExecutions': False, 'saveExecutionProgress': False,
    'callerPolicy': 'workflowsFromSameOwner', 'availableInMCP': False,
}


def node(name, kind, parameters=None, **extra):
    versions = {builder.CALL: 1.3, builder.INTERNAL_TRIGGER: 1.1}
    return {'name': name, 'id': 'fixture-' + name, 'type': kind,
            'typeVersion': versions.get(kind, 1), 'position': [0, 0],
            'parameters': parameters or {}, **extra}


def links(*names):
    return {'main': [[builder.edge(name) for name in names]]}


def workflow(identity, nodes, connections):
    return {'id': identity, 'name': identity, 'versionId': identity + '-v1',
            'active': True, 'nodes': nodes, 'connections': connections,
            'settings': copy.deepcopy(SETTINGS), 'staticData': None, 'pinData': {}}


def fixture():
    ids = ['fixture-a', 'fixture-b', 'fixture-c', 'fixture-d', 'fixture-e']
    plan = {
        'targets': [{'id': identity, 'role': identity} for identity in ids],
        'sources': [{'id': identity, 'target': identity, 'operation': identity + '.run'} for identity in ids]
                   + [{'id': 'fixture-helper', 'target': ids[0], 'operation': 'helper.run'}],
        'main_trigger_routes': [],
    }
    sources = {
        ids[0]: workflow(ids[0], [
            node('API', builder.WEBHOOK, {'path': 'fixture-a', 'httpMethod': 'POST',
                                        'responseMode': 'responseNode', 'authentication': 'headerAuth',
                                        'options': {'rawBody': True}}, webhookId='fixture-webhook-a'),
            node('Call', builder.CALL, {'source': 'database',
                                       'workflowId': {'value': 'fixture-helper', 'mode': 'id'},
                                       'mode': 'each', 'options': {'waitForSubWorkflow': True}},
                 onError='continueErrorOutput', credentials={'fixtureAuth': {'id': 'credential-fixture', 'name': 'Fixture'}}),
            node('Reply', 'n8n-nodes-base.respondToWebhook', {'responseBody': '={{ $json }}'}),
            node('Failure', 'n8n-nodes-base.code', {'jsCode': 'return $input.all();'}),
        ], {'API': links('Call'), 'Call': {'main': [[builder.edge('Reply')], [builder.edge('Failure')]]}}),
        ids[1]: workflow(ids[1], [
            node('API', builder.WEBHOOK, {'path': 'fixture-b'}),
            node('Return', 'n8n-nodes-base.code', {'jsCode': 'return $("API").all();'}),
        ], {'API': links('Return')}),
        ids[2]: workflow(ids[2], [
            node('Form', 'n8n-nodes-base.formTrigger', webhookId='fixture-form'),
            node('Wait', 'n8n-nodes-base.wait', {'resume': 'webhook'}, webhookId='fixture-wait'),
            node('Return', 'n8n-nodes-base.code', {'jsCode': 'return $input.all();'}),
        ], {'Form': links('Wait'), 'Wait': links('Return')}),
        ids[3]: workflow(ids[3], [
            node('Hourly', 'n8n-nodes-base.scheduleTrigger', {'rule': {'interval': [{'field': 'hours'}]}}),
            node('Return', 'n8n-nodes-base.code', {'jsCode': 'return $input.all();'}),
        ], {'Hourly': links('Return')}),
        ids[4]: workflow(ids[4], [
            node('Entry', builder.INTERNAL_TRIGGER, {'inputSource': 'passthrough'}),
            node('Return', 'n8n-nodes-base.code', {'jsCode': 'return $input.all();'}),
        ], {'Entry': links('Return')}),
        'fixture-helper': workflow('fixture-helper', [
            node('Entry', builder.INTERNAL_TRIGGER, {'inputSource': 'passthrough'}),
            node('Return', 'n8n-nodes-base.code', {
                'jsCode': "return $('Entry').all().map(item => ({...item, json: {...item.json, checked:true}}));"}),
        ], {'Entry': links('Return')}),
    }
    # The real OAuth/form path has no own timeout; a finite form/Wait lifetime
    # would require a different resume design, so the generic builder rejects it.
    del sources[ids[2]]['settings']['executionTimeout']
    review = builder.review_template(plan, sources)
    review['target_settings'] = {identity: copy.deepcopy(SETTINGS) for identity in ids}
    del review['target_settings'][ids[2]]['executionTimeout']
    review['wait_resume_cutover_reviewed'] = True
    review['deadline_policy'] = 'absolute_per_operation_v1'
    return plan, sources, review


class BuilderContracts(unittest.TestCase):
    def setUp(self):
        self.plan, self.sources, self.review = fixture()

    def refresh(self):
        self.review['source_pins'] = builder.source_pins(self.sources)

    def build(self, **kwargs):
        return builder.build(self.plan, self.sources, self.review, **kwargs)

    def rejects(self, code, **kwargs):
        with self.assertRaisesRegex(builder.BuildError, code):
            self.build(**kwargs)

    def test_deterministic_five_inactive_targets_and_untouched_sources(self):
        original = copy.deepcopy(self.sources)
        first, provenance = self.build()
        second, second_provenance = self.build()
        self.assertEqual(first, second)
        self.assertEqual(provenance, second_provenance)
        self.assertEqual(self.sources, original)
        self.assertEqual(set(first), {entry['id'] for entry in self.plan['targets']})
        self.assertTrue(all(value['active'] is False for value in first.values()))

    def test_self_call_is_explicit_operation_and_preserves_call_flags(self):
        candidates, provenance = self.build()
        target = candidates['fixture-a']
        call = next(n for n in target['nodes'] if n['name'] == 'fixture-a · Call')
        self.assertEqual(call['parameters']['workflowId']['value'], 'fixture-a')
        self.assertEqual(call['parameters']['mode'], 'each')
        self.assertTrue(call['parameters']['options']['waitForSubWorkflow'])
        self.assertEqual(call['onError'], 'continueErrorOutput')
        self.assertEqual(call['credentials'], self.sources['fixture-a']['nodes'][1]['credentials'])
        reply_guard = 'fixture-a · Reply · Frist vor Eingang 0'
        self.assertEqual(target['connections'][call['name']], {
            'main': [[builder.edge(reply_guard)], [builder.edge('fixture-a · Failure')]]})
        self.assertEqual(target['connections'][reply_guard], links('fixture-a · Reply'))
        self.assertEqual(provenance['internal_calls'][0]['operation'], 'helper.run')
        self.assertTrue(provenance['internal_calls'][0]['same_target'])
        adjacency, _ = builder.graph(target)
        public = builder.reachable(['fixture-a · API'], adjacency)
        self.assertNotIn('SMA · Interner Einstieg', public)
        self.assertNotIn('fixture-helper · Entry', public)

    def test_form_wait_and_webhook_identity_and_response_semantics_survive(self):
        candidates, _ = self.build()
        for identity, names in [('fixture-a', ['API']), ('fixture-c', ['Form', 'Wait'])]:
            for name in names:
                before = next(n for n in self.sources[identity]['nodes'] if n['name'] == name)
                after = next(n for n in candidates[identity]['nodes'] if n['name'] == identity + ' · ' + name)
                self.assertEqual(before['webhookId'], after['webhookId'])
                self.assertEqual(before['parameters'], after['parameters'])
                if before['type'] in builder.PROTECTED_IDS:
                    self.assertEqual(before['id'], after['id'])

    def test_source_and_overlay_pins_fail_closed(self):
        self.sources['fixture-a']['name'] = 'Changed after review'
        self.rejects('SOURCE_SNAPSHOT_CHANGED')
        self.refresh()
        overlay = copy.deepcopy(self.sources['fixture-a'])
        self.rejects('UNREVIEWED_EFFECTIVE_SOURCE', effective_sources={'fixture-a': overlay})
        self.review['effective_source_pins'] = builder.source_pins({'fixture-a': overlay})
        self.build(effective_sources={'fixture-a': overlay})
        overlay['nodes'][0]['parameters']['path'] = 'changed-public-path'
        self.review['effective_source_pins'] = builder.source_pins({'fixture-a': overlay})
        self.rejects('OVERLAY_EXTERNAL_ENTRY_CHANGED', effective_sources={'fixture-a': overlay})

    def test_declared_or_mapped_inputs_are_not_silently_dropped(self):
        self.sources['fixture-a']['nodes'][1]['parameters']['workflowInputs'] = {
            'mappingMode': 'defineBelow', 'value': {'different': '={{ $json.secret }}'}, 'schema': []}
        self.refresh()
        self.rejects('MAPPED_INPUT_REQUIRES_MATERIALIZER')

    def test_empty_native_mapper_preserves_passthrough(self):
        self.sources['fixture-a']['nodes'][1]['parameters']['workflowInputs'] = {
            'mappingMode': 'defineBelow', 'value': None, 'schema': [], 'matchingColumns': [],
            'attemptToConvertTypes': False, 'convertFieldsToString': True}
        self.refresh()
        candidates, provenance = self.build()
        call = next(n for n in candidates['fixture-a']['nodes'] if n['type'] == builder.CALL)
        self.assertNotIn('workflowInputs', call['parameters'])
        self.assertEqual(provenance['internal_calls'][0]['mapping'], 'empty_mapper_passthrough')

    def test_detached_calls_rejected_to_prevent_envelope_return(self):
        self.sources['fixture-a']['nodes'][1]['parameters']['options']['waitForSubWorkflow'] = False
        self.refresh()
        self.rejects('ASYNC_CALL_REQUIRES_RETURN_ADAPTER')

    def test_unknown_dynamic_target_or_node_reference_rejected(self):
        self.sources['fixture-a']['nodes'][1]['parameters']['workflowId']['value'] = '={{ $json.workflow }}'
        self.refresh()
        self.rejects('UNRESOLVED_WORKFLOW_TARGET')
        self.sources['fixture-a']['nodes'][1]['parameters']['workflowId']['value'] = 'fixture-helper'
        self.sources['fixture-helper']['nodes'][1]['parameters']['jsCode'] = 'return $(inputName).all();'
        self.refresh()
        self.rejects('UNRESOLVED_DYNAMIC_NODE_REFERENCE')

    def test_nonempty_static_data_rejected_and_absence_requires_evidence(self):
        self.sources['fixture-helper']['staticData'] = {'global': {'cursor': 5}}
        self.refresh()
        self.rejects('NONEMPTY_STATIC_DATA')
        del self.sources['fixture-helper']['staticData']
        self.refresh()
        self.rejects('STATIC_DATA_ABSENCE_IS_NOT_EMPTY')
        self.review['static_data_reviews']['fixture-helper'] = {
            'status': 'unused_in_retained_graph', 'reason': 'Synthetic pure trigger and return only.'}
        self.build()

    def test_schedule_requires_version_matched_full_metadata(self):
        metadata = copy.deepcopy(self.sources['fixture-d'])
        del self.sources['fixture-d']['staticData']
        self.refresh()
        self.rejects('STATEFUL_TRIGGER_STATIC_DATA_METADATA_REQUIRED')
        self.review['metadata_pins'] = {'fixture-d': builder.digest(metadata)}
        self.build(metadata_sources={'fixture-d': metadata})
        metadata['versionId'] = 'old-version'
        self.review['metadata_pins'] = {'fixture-d': builder.digest(metadata)}
        self.rejects('METADATA_ACTIVE_VERSION_CHANGED', metadata_sources={'fixture-d': metadata})

    def test_reviewed_hourly_state_moves_by_exact_node_binding_only(self):
        metadata = copy.deepcopy(self.sources['fixture-d'])
        metadata['staticData'] = {
            'node:Hourly': {'recurrenceRules': [None], 'recurrenceRuleSignatures': [None]},
            'node:Old schedule': {'recurrenceRules': [None], 'recurrenceRuleSignatures': [None]},
        }
        del self.sources['fixture-d']['staticData']
        self.refresh()
        self.review['metadata_pins'] = {'fixture-d': builder.digest(metadata)}
        self.rejects('NONEMPTY_STATIC_DATA', metadata_sources={'fixture-d': metadata})
        self.review['static_data_migrations'] = {'fixture-d': {
            'strategy': 'preserve_hourly_schedule_metadata',
            'preserve_node_keys': {'node:Hourly': 'Hourly'},
            'rollback_only_keys': ['node:Old schedule'],
            'reason': 'Synthetic hourly recurrence has no cursor; retain exact active value.'}}
        candidates, provenance = self.build(metadata_sources={'fixture-d': metadata})
        self.assertEqual(candidates['fixture-d']['staticData'], {
            'node:fixture-d · Hourly': metadata['staticData']['node:Hourly']})
        self.assertEqual(provenance['static_data_evidence']['fixture-d']['rollback_only'], ['node:Old schedule'])
        metadata['staticData']['node:Hourly']['recurrenceRules'][0] = 8
        self.review['metadata_pins'] = {'fixture-d': builder.digest(metadata)}
        self.rejects('STATIC_DATA_RECURRENCE_CURSOR_UNREVIEWED', metadata_sources={'fixture-d': metadata})

    def test_stale_schedule_migration_is_not_accepted_for_other_state(self):
        self.review['static_data_migrations'] = {'fixture-d': {'strategy': 'preserve_hourly_schedule_metadata'}}
        self.rejects('STALE_STATIC_DATA_MIGRATION')

    def test_empty_internal_operation_list_has_no_empty_switch(self):
        candidates, _ = self.build()
        target = candidates['fixture-b']
        self.assertFalse(any(node['type'] == 'n8n-nodes-base.switch' for node in target['nodes']))
        self.assertEqual(target['connections']['SMA · Interne Operation prüfen'],
                         links('SMA · Unbekannte Operation ablehnen'))

    def test_every_setting_change_needs_an_exact_reasoned_review(self):
        self.review['target_settings']['fixture-a']['executionTimeout'] = 600
        self.rejects('UNREVIEWED_SETTING_CHANGE')
        changes = builder.setting_changes(self.plan, self.sources,
                                           builder.assignments(self.plan, self.sources),
                                           self.review['target_settings'])
        self.review['accepted_setting_changes'] = [{**change, 'reason': 'Synthetic fixture only.'} for change in changes]
        self.build()
        self.review['target_settings']['fixture-a']['executionTimeout'] = 900
        self.rejects('UNREVIEWED_SETTING_CHANGE')

    def test_unreviewed_identity_change_and_wait_cutover_rejected(self):
        self.sources['fixture-helper']['nodes'][1]['parameters']['jsCode'] = 'return [{json:{id:$workflow.id}}];'
        self.refresh()
        self.rejects('WORKFLOW_IDENTITY_REVIEW_REQUIRED')
        self.review['identity_policies'] = {'fixture-helper/Return': {'workflow_id': 'preserve_source'}}
        candidates, _ = self.build()
        copied = next(n for n in candidates['fixture-a']['nodes'] if n['name'] == 'fixture-helper · Return')
        self.assertIn('"fixture-helper"', copied['parameters']['jsCode'])
        self.review['wait_resume_cutover_reviewed'] = False
        self.rejects('WAIT_RESUME_CUTOVER_REVIEW_REQUIRED')

    def test_internal_operation_cannot_reach_a_public_response(self):
        helper = self.sources['fixture-helper']
        helper['nodes'].append(node('Respond', 'n8n-nodes-base.respondToWebhook'))
        helper['connections']['Return'] = links('Respond')
        self.refresh()
        self.rejects('INTERNAL_OPERATION_REACHES_HTTP_RESPONSE')

    def test_shared_graph_response_is_proved_by_native_entry_not_payload(self):
        helper = self.sources['fixture-helper']
        helper['nodes'].extend([
            node('Public', builder.WEBHOOK, {'path': 'fixture-helper-public'}),
            node('Internal?', 'n8n-nodes-base.if', {'conditions': {
                'conditions': [{'leftValue': '={{ $("Entry").isExecuted }}', 'rightValue': '',
                                'operator': {'type': 'boolean', 'operation': 'true', 'singleValue': True}}],
                'combinator': 'and'}}, typeVersion=2.2),
            node('Child return', 'n8n-nodes-base.code', {'jsCode': 'return $input.all();'}),
            node('Public response', 'n8n-nodes-base.respondToWebhook'),
        ])
        helper['connections'].update({
            'Public': links('Return'), 'Return': links('Internal?'),
            'Internal?': {'main': [[builder.edge('Child return')], [builder.edge('Public response')]]},
        })
        self.refresh()
        _, provenance = self.build()
        proof = provenance['entry_gate_proofs']['fixture-a']
        self.assertEqual(proof['public']['fixture-helper · Internal?']['selected_output'], 1)
        self.assertEqual(proof['internal']['helper.run']['fixture-helper · Internal?']['selected_output'], 0)
        gate = next(n for n in helper['nodes'] if n['name'] == 'Internal?')
        gate['parameters']['conditions']['conditions'][0]['leftValue'] = '={{ $json.internal === true }}'
        self.refresh()
        self.rejects('INTERNAL_OPERATION_REACHES_HTTP_RESPONSE')

    def test_both_literal_quote_styles_and_known_finite_map_rewrite(self):
        names = {'Input': 'source · Input', 'Product': 'source · Product'}
        code = '''const inventoryNames = {
  product: 'Product',
};
const one = name => inventorySingle($(name).all());
const x = $('Input').first();
const y = $items("Product", 0, 1);
const z = $node["Input"].json;
'''
        rewritten = builder.rewrite_string(code, names, 'source', 'Return', 'source', 'Source', 'Source', {})
        self.assertIn('product: "source · Product"', rewritten)
        self.assertIn('$("source · Input").first()', rewritten)
        self.assertIn('$items("source · Product", 0, 1)', rewritten)
        self.assertIn('$node["source · Input"].json', rewritten)
        with self.assertRaisesRegex(builder.BuildError, 'NODE_REFERENCE_OUTSIDE_TARGET'):
            builder.rewrite_string("return $('Outside').all();", names, 'source', 'Return', 'source', 'Source', 'Source', {})

    def test_compact_literal_helper_and_finite_ternary_are_closed_over_known_nodes(self):
        names = {'Input': 'source · Input', 'Product': 'source · Product'}
        code = "const one=name=>inventorySingle($(name).all()); const a=one('Input'), b=one(\"Product\");"
        result = builder.rewrite_string(code, names, 'source', 'Return', 'source', 'Source', 'Source', {})
        self.assertIn('one("source · Input")', result)
        self.assertIn('one("source · Product")', result)
        ternary = "const n=$(p==='youtube'?'Input':'Product').first().json;"
        result = builder.rewrite_string(ternary, names, 'source', 'Return', 'source', 'Source', 'Source', {})
        self.assertIn('$(p===\'youtube\'?"source · Input":"source · Product")', result)
        for unsafe in [code + 'one(variable);', code + 'passFunction(one);']:
            with self.assertRaisesRegex(builder.BuildError, 'UNRESOLVED_INVENTORY_LITERAL_HELPER'):
                builder.rewrite_string(unsafe, names, 'source', 'Return', 'source', 'Source', 'Source', {})
        with self.assertRaisesRegex(builder.BuildError, 'TERNARY_REFERENCE_OUTSIDE_TARGET'):
            builder.rewrite_string(ternary.replace('Product', 'Outside'), names, 'source', 'Return', 'source', 'Source', 'Source', {})

    def test_generated_code_guard_blocks_work_and_http_timeout_uses_remaining_budget(self):
        self.sources['fixture-b']['nodes'][1]['parameters']['jsCode'] = "effects.push('business'); return $input.all();"
        self.refresh()
        candidates, _ = self.build()
        guard = next(n['parameters']['jsCode'] for n in candidates['fixture-b']['nodes']
                     if n['name'] == 'fixture-b · Return')
        timeout = builder.http_timeout_expression('={{ 5000 }}', {'Marker'}, 'fixture')
        script = r"""
const vm = require('node:vm');
const assert = require('node:assert/strict');
const data = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
let clock = 1000000;
let deadline = clock + 700;
const effects = [];
const input = [{json:{business:true},binary:{asset:{id:'fake'}},metadata:{subExecution:{executionId:'fake'}}}];
const context = {effects, Date:{now:()=>clock}, $input:{all:()=>input},
  $:()=>({isExecuted:true,first:()=>({json:{payload:{},deadlineAt:deadline}})})};
const run = () => new vm.Script('(async()=>{'+data.guard+'})()').runInNewContext(context);
(async()=>{
  const result = await run();
  assert.equal(effects.length,1); assert.equal(result[0].json.business,true);
  assert.equal(result[0].binary.asset.id,'fake'); assert.equal(result[0].metadata,undefined);
  const expression = data.timeout.slice(3,-2);
  assert.equal(new vm.Script(expression).runInNewContext(context),700);
  clock = deadline;
  await assert.rejects(run(),/CONSOLIDATION_OPERATION_TIMEOUT/);
  assert.equal(effects.length,1);
  assert.throws(()=>new vm.Script(expression).runInNewContext(context),/CONSOLIDATION_OPERATION_TIMEOUT/);
  deadline = clock+10000;
  assert.equal(new vm.Script(expression).runInNewContext(context),5000);
})().catch(error=>{console.error(error);process.exitCode=1;});
"""
        result = subprocess.run(['node', '-e', script], input=json.dumps({'guard': guard, 'timeout': timeout}),
                                text=True, capture_output=True, check=False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_graph_loop_cannot_reenter_a_deadline_marker(self):
        self.sources['fixture-b']['connections']['Return'] = links('API')
        self.refresh()
        self.rejects('TRIGGER_REENTRY_WOULD_REFRESH_DEADLINE')

    def test_added_parent_graph_uses_existing_unbounded_target_and_native_child(self):
        component = {'name': 'Synthetic parent component', 'settings': {'executionOrder': 'v1'},
            'nodes': [node('Job start', builder.WEBHOOK, {'httpMethod': 'POST', 'path': 'fixture-job'}, webhookId='fixture-job-hook'),
                      node('Bound', 'n8n-nodes-base.code', {'jsCode': 'return $input.all();'}),
                      node('Job wait', 'n8n-nodes-base.wait', {'resume': 'webhook'}, webhookId='fixture-job-wait'),
                      node('Job call', builder.CALL, {'source': 'database', 'workflowId': {'value': 'fixture-helper', 'mode': 'id'},
                                                     'mode': 'once', 'options': {'waitForSubWorkflow': True}})],
            'connections': {'Job start': links('Bound'), 'Bound': links('Job wait'), 'Job wait': links('Job call')}}
        components = {'file-job-parent': {'target': 'fixture-c', 'source_sha256': 'a' * 64, 'graph': component}}
        self.review['component_pins'] = builder.component_pins(components)
        plan, sources = builder.with_components(self.plan, self.sources, components)
        changes = builder.setting_changes(plan, sources, builder.assignments(plan, sources), self.review['target_settings'])
        self.review['accepted_setting_changes'] = [{**change, 'reason': 'Synthetic reviewed common privacy profile.'} for change in changes]
        self.review['call_deadline_inputs'] = {'component:file-job-parent/Job call': {
            'node': 'Bound', 'field': 'deadline_at', 'format': 'iso', 'reason': 'Immutable server-bound job deadline.'}}
        candidates, provenance = self.build(components=components)
        self.assertEqual(len(candidates), 5)
        self.assertNotIn('executionTimeout', candidates['fixture-c']['settings'])
        self.assertFalse(any(value['source'].startswith('component:') for value in provenance['operation_deadlines']))
        call = next(value for value in provenance['internal_calls'] if value['source'].startswith('component:'))
        self.assertEqual(call['new_target'], 'fixture-a')
        self.assertEqual(call['additional_deadline']['format'], 'iso')
        self.assertEqual(provenance['component_pins'], self.review['component_pins'])
        candidates_again, provenance_again = self.build(components=components)
        self.assertEqual((candidates, provenance), (candidates_again, provenance_again))
        components['file-job-parent']['graph']['nodes'][0]['parameters']['path'] = 'changed-after-review'
        self.rejects('UNREVIEWED_COMPONENT_GRAPH', components=components)

    def test_component_cannot_smuggle_settings_state_or_reuse_public_routes(self):
        value = {'target': 'fixture-c', 'source_sha256': 'a' * 64,
                 'graph': {'name': 'Synthetic', 'settings': {'executionOrder': 'v1'},
                           'nodes': [node('Public', builder.WEBHOOK, {'path': 'fixture-job'})], 'connections': {}}}
        component = {'synthetic': value}
        builder.with_components(self.plan, self.sources, component)
        for field, content in [('id', 'new-workflow'), ('staticData', {}), ('active', False)]:
            value['graph'][field] = content
            with self.assertRaisesRegex(builder.BuildError, 'COMPONENT_WORKFLOW_STATE_OR_SETTINGS_FORBIDDEN'):
                builder.with_components(self.plan, self.sources, component)
            del value['graph'][field]
        value['graph']['settings']['executionTimeout'] = 180
        with self.assertRaisesRegex(builder.BuildError, 'COMPONENT_WORKFLOW_STATE_OR_SETTINGS_FORBIDDEN'):
            builder.with_components(self.plan, self.sources, component)
        del value['graph']['settings']['executionTimeout']
        value['graph']['nodes'][0]['parameters'] = {'httpMethod': 'POST', 'path': 'fixture-a'}
        with self.assertRaisesRegex(builder.BuildError, 'COMPONENT_PUBLIC_ROUTE_COLLISION'):
            builder.with_components(self.plan, self.sources, component)

    def test_native_call_additional_deadline_shortens_but_never_extends_marker(self):
        self.review['call_deadline_inputs'] = {'fixture-a/Call': {
            'node': 'API', 'field': '_thumbnail_deadline', 'format': 'epoch_ms',
            'reason': 'Synthetic immutable batch budget.'}}
        candidates, _ = self.build()
        adapter = next(node for node in candidates['fixture-a']['nodes'] if node['name'] == 'fixture-a · Call · interne Eingabe')
        script = r'''
const vm=require('node:vm'),assert=require('node:assert/strict');
const code=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
const clock=1800000000000;
let extra=clock+35000;
const input={json:{original:'payload'},binary:{image:{data:'YXNk'}}};
const context={Date:{now:()=>clock,parse:Date.parse},$input:{all:()=>[input]},
 $:name=>({isExecuted:true,first:(output,run)=>{
  assert.equal(output,0);assert.equal(run,0);
  return {json:name==='fixture-a · API'?{_thumbnail_deadline:extra}:{payload:{},deadlineAt:clock+120000}};
 }})};
const execute=()=>vm.runInNewContext('(function(){'+code+'})()',context);
let result=execute();assert.equal(result[0].json.context.deadlineAt,clock+35000);
assert.equal(result[0].json.payload,input.json);assert.equal(result[0].binary,input.binary);
extra=clock+999999;assert.equal(execute()[0].json.context.deadlineAt,clock+120000);
extra='invalid';assert.throws(execute,/CALL_DEADLINE_INVALID/);
extra=clock-1;assert.throws(execute,/OPERATION_TIMEOUT/);
'''
        completed = subprocess.run(['node', '-e', script], input=json.dumps(adapter['parameters']['jsCode']),
                                   text=True, capture_output=True)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.review['call_deadline_inputs']['fixture-a/nonexistent'] = self.review['call_deadline_inputs']['fixture-a/Call']
        self.rejects('STALE_CALL_DEADLINE_INPUT_POLICY')

    def test_multiple_manual_entries_require_one_exact_explicit_selection(self):
        source = self.sources['fixture-a']
        for number in range(1, 4):
            name = 'Admin ' + str(number)
            source['nodes'].extend([node(name, 'n8n-nodes-base.manualTrigger'),
                                   node(name + ' work', 'n8n-nodes-base.code', {'jsCode': 'return $input.all();'})])
            source['connections'][name] = links(name + ' work')
        self.refresh()
        candidates, provenance = self.build()
        target = candidates['fixture-a']
        self.assertEqual(sum(node['type'] == 'n8n-nodes-base.manualTrigger' for node in target['nodes']), 1)
        self.assertEqual(sum(node['type'] == builder.INTERNAL_TRIGGER for node in target['nodes']), 1)
        policy = provenance['manual_entry_consolidation']['fixture-a']
        nodes = {node['name']: node for node in target['nodes']}
        assignments = nodes[policy['selector']]['parameters']['assignments']['assignments']
        self.assertEqual(assignments[0]['name'], 'manual_operation')
        self.assertEqual(assignments[0]['value'], '')
        rules = nodes[policy['router']]['parameters']['rules']['values']
        self.assertEqual(len(rules), 3)
        self.assertEqual(nodes[policy['router']]['parameters']['options']['fallbackOutput'], 'extra')
        for index, operation in enumerate(policy['operations']):
            self.assertEqual(target['connections'][policy['router']]['main'][index], [builder.edge(operation['target_bridge'])])
            self.assertEqual(rules[index]['conditions']['conditions'][0]['rightValue'], operation['operation'])
            self.assertEqual(target['connections'][operation['target_bridge']], links(operation['target_bridge'] + ' · Operationsfrist'))
        public = builder.reachable(['fixture-a · API'], builder.graph(target)[0])
        self.assertNotIn(policy['selector'], public)
        self.assertTrue(all(operation['target_bridge'] not in public for operation in policy['operations']))
        script = r'''
const vm=require('node:vm'),assert=require('node:assert/strict');
const {policy,nodes,rules}=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
const route=value=>rules.map((rule,index)=>rule.conditions.conditions[0].rightValue===value?index:-1).filter(index=>index>=0);
const execute=(name,json)=>vm.runInNewContext('(function(){'+nodes[name].parameters.jsCode+'})()',{$input:{all:()=>[{json}]}});
for(const value of ['', 'unknown', 'all']){
 assert.equal(route(value).length,0);assert.throws(()=>execute(policy.reject,{manual_operation:value}),/MANUAL_SELECTION_REQUIRED/);
}
for(const [index,operation] of policy.operations.entries()){
 assert.deepEqual(route(operation.operation),[index]);
 const output=execute(operation.target_bridge,{manual_operation:operation.operation});
 assert.equal(JSON.stringify(output[0].json),'{}');assert.equal(output[0].pairedItem.item,0);
 assert.throws(()=>execute(operation.target_bridge,{manual_operation:policy.operations[(index+1)%3].operation}),/MANUAL_SELECTION_INVALID/);
 assert.throws(()=>execute(operation.target_bridge,{manual_operation:operation.operation,extra:true}),/MANUAL_SELECTION_INVALID/);
}
'''
        completed = subprocess.run(['node', '-e', script], input=json.dumps({'policy': policy, 'nodes': nodes, 'rules': rules}),
                                   text=True, capture_output=True)
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_incomplete_exports_and_unsafe_output_path_fail_without_writes(self):
        del self.sources['fixture-helper']
        self.rejects('INCOMPLETE_LIVE_EXPORTS')
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'not-private'
            with self.assertRaisesRegex(builder.BuildError, 'PRIVATE_OUTPUT_PATH_REQUIRED'):
                builder.write_candidates({}, {}, output)
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
