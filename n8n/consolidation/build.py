#!/usr/bin/env python3
"""Build five private, inactive import candidates; never contact n8n or providers."""

import argparse
import copy
import hashlib
import json
import os
import re
import sys
import tempfile
import uuid
from collections import defaultdict
from pathlib import Path

sys.dont_write_bytecode = True
from audit import MAIN, WEBHOOK, CALL, graph, is_trigger, reachable, strings, workflow_target

ROOT = Path(__file__).resolve().parent
PRIVATE_OUTPUT = Path('/workspace/shared/sma-five-workflows-20261116/candidates')
INTERNAL_TRIGGER = 'n8n-nodes-base.executeWorkflowTrigger'
PROTECTED_IDS = {'n8n-nodes-base.formTrigger', 'n8n-nodes-base.form', 'n8n-nodes-base.wait'}
REFERENCE = re.compile(r'''(\$\(\s*|\$items\(\s*|\$node\[\s*)(['"])([^'"]+)\2''')
DYNAMIC = re.compile(r'''\$(?:items)?\(\s*[^\s'"\)]|\$node\[\s*[^\s'"]|\$node\.''')
NAMESPACE = uuid.UUID('48d86c48-625d-5dd4-9e2c-54cbf910f889')
DEFAULT = '<instance default>'


class BuildError(ValueError):
    pass


def need(condition, code, detail=''):
    if not condition:
        raise BuildError(code + (': ' + detail if detail else ''))


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def stable_id(*parts):
    return str(uuid.uuid5(NAMESPACE, '\0'.join(parts)))


def source_pins(sources):
    return {identity: {'versionId': data.get('versionId'), 'sha256': digest(data)}
            for identity, data in sorted(sources.items())}


def load_sources(directory, plan):
    expected = {entry['id'] for entry in plan['sources']}
    sources = {}
    for path in sorted(directory.glob('*.json')):
        data = json.loads(path.read_text())
        if not isinstance(data, dict) or data.get('id') not in expected:
            continue
        identity = data['id']
        need(identity not in sources, 'DUPLICATE_SOURCE', identity)
        sources[identity] = data
    need(set(sources) == expected, 'INCOMPLETE_LIVE_EXPORTS', ','.join(sorted(expected - set(sources))))
    for identity, data in sources.items():
        need(data.get('active') is True and bool(data.get('versionId')), 'PUBLISHED_SOURCE_REQUIRED', identity)
        need(not data.get('activeVersionId') or data['activeVersionId'] == data['versionId'], 'DRAFT_EXPORT_REJECTED', identity)
        need(isinstance(data.get('nodes'), list) and bool(data['nodes']), 'SOURCE_NODES_REQUIRED', identity)
    return sources


def load_overlay_manifest(manifest_path, exports_directory, plan, sources):
    """Verify a private transform's byte hashes before accepting its JSON copies."""
    manifest = json.loads(manifest_path.read_text())
    need(isinstance(manifest, dict) and manifest.get('version') == 1
         and isinstance(manifest.get('overlays'), list), 'OVERLAY_MANIFEST_INVALID')
    specs = {entry['id']: entry for entry in plan['sources']}
    overlays = {}
    for entry in manifest['overlays']:
        identity = entry.get('sourceId')
        need(identity in sources and identity not in overlays, 'OVERLAY_MANIFEST_SOURCE_INVALID', str(identity))
        need(entry.get('file') == identity + '.json', 'OVERLAY_MANIFEST_PATH_INVALID', str(identity))
        source_bytes = (exports_directory / (identity + '.json')).read_bytes()
        overlay_bytes = (manifest_path.parent / entry['file']).read_bytes()
        need(hashlib.sha256(source_bytes).hexdigest() == entry.get('sourceSha256')
             and hashlib.sha256(overlay_bytes).hexdigest() == entry.get('candidateSha256'),
             'OVERLAY_MANIFEST_BYTE_HASH_MISMATCH', identity)
        need(entry.get('sourceVersionId') == sources[identity]['versionId']
             and entry.get('operation') == specs[identity]['operation'], 'OVERLAY_OPERATION_VERSION_CHANGED', identity)
        overlay = json.loads(overlay_bytes)
        need(overlay.get('id') == identity and overlay.get('versionId') == sources[identity]['versionId'],
             'OVERLAY_IDENTITY_CHANGED', identity)
        triggers = [node['name'] for node in overlay.get('nodes', [])
                    if node['type'] == INTERNAL_TRIGGER and not node.get('disabled')]
        need(triggers == [entry.get('internalTrigger')]
             and any(node['name'] == entry.get('entryNode') for node in overlay['nodes']),
             'OVERLAY_INTERNAL_ENTRY_CHANGED', identity)
        overlays[identity] = overlay
    return overlays


def load_component_manifest(manifest_path, plan):
    """Load explicitly added graphs, never a sixth workflow or a draft export."""
    manifest = json.loads(manifest_path.read_text())
    need(isinstance(manifest, dict) and manifest.get('version') == 1
         and isinstance(manifest.get('components'), list), 'COMPONENT_MANIFEST_INVALID')
    targets = {entry['id'] for entry in plan['targets']}
    components = {}
    for entry in manifest['components']:
        identity, filename = entry.get('id'), entry.get('file')
        need(isinstance(identity, str) and re.fullmatch(r'[a-z][a-z0-9-]{0,63}', identity)
             and identity not in components and entry.get('target') in targets,
             'COMPONENT_ID_OR_TARGET_INVALID', str(identity))
        need(filename == identity + '.json', 'COMPONENT_MANIFEST_PATH_INVALID', identity)
        content = (manifest_path.parent / filename).read_bytes()
        need(hashlib.sha256(content).hexdigest() == entry.get('sha256'),
             'COMPONENT_MANIFEST_BYTE_HASH_MISMATCH', identity)
        components[identity] = {'target': entry['target'], 'source_sha256': entry['sha256'],
                                'graph': json.loads(content)}
    return components


def component_pins(components):
    return {identity: {'target': value['target'], 'source_sha256': value['source_sha256'],
                      'graph_sha256': digest(value['graph'])}
            for identity, value in sorted(components.items())}


def with_components(plan, sources, components):
    """Give an added graph a logical namespace, without inventing a live ID."""
    plan, sources = copy.deepcopy(plan), copy.deepcopy(sources)
    targets = {entry['id'] for entry in plan['targets']}
    old_webhook_ids = {node['webhookId'] for source in sources.values() for node in source['nodes']
                       if node.get('webhookId')}
    old_routes = {(node.get('parameters', {}).get('httpMethod', 'GET'), node.get('parameters', {}).get('path'))
                  for source in sources.values() for node in source['nodes'] if node['type'] == WEBHOOK and not node.get('disabled')}
    for identity, entry in sorted(components.items()):
        need(isinstance(identity, str) and re.fullmatch(r'[a-z][a-z0-9-]{0,63}', identity)
             and entry.get('target') in targets, 'COMPONENT_ID_OR_TARGET_INVALID', str(identity))
        data = entry.get('graph')
        need(isinstance(data, dict) and isinstance(data.get('name'), str)
             and isinstance(data.get('nodes'), list) and data['nodes']
             and isinstance(data.get('connections'), dict), 'COMPONENT_GRAPH_REQUIRED', identity)
        need(set(data) <= {'name', 'nodes', 'connections', 'settings'}
             and data.get('settings', {}) == {'executionOrder': 'v1'},
             'COMPONENT_WORKFLOW_STATE_OR_SETTINGS_FORBIDDEN', identity)
        need(isinstance(entry.get('source_sha256'), str)
             and re.fullmatch(r'[a-f0-9]{64}', entry['source_sha256']), 'COMPONENT_HASH_REQUIRED', identity)
        roots = [node for node in data['nodes'] if is_trigger(node) and not node.get('disabled')]
        need(roots and all(node['type'] == WEBHOOK for node in roots),
             'COMPONENT_REQUIRES_SEPARATE_PUBLIC_ENTRY', identity)
        need(not any(node.get('disabled') or node['type'] == INTERNAL_TRIGGER for node in data['nodes']),
             'COMPONENT_DORMANT_OR_NATIVE_ENTRY_FORBIDDEN', identity)
        for node in data['nodes']:
            webhook_id = node.get('webhookId')
            if webhook_id:
                need(webhook_id not in old_webhook_ids, 'COMPONENT_CALLBACK_ID_COLLISION', identity)
                old_webhook_ids.add(webhook_id)
            if node['type'] == WEBHOOK:
                parameters = node.get('parameters', {})
                route = (parameters.get('httpMethod', 'GET'), parameters.get('path'))
                need(isinstance(route[1], str) and route[1] and route not in old_routes,
                     'COMPONENT_PUBLIC_ROUTE_COLLISION', identity)
                old_routes.add(route)
        logical = 'component:' + identity
        need(logical not in sources, 'COMPONENT_NAMESPACE_COLLISION', identity)
        sources[logical] = {**copy.deepcopy(data), 'id': logical, 'staticData': None}
        plan['sources'].append({'id': logical, 'target': entry['target'], 'operation': None})
    return plan, sources


def source_entry_signatures(workflow):
    result = []
    for node in workflow['nodes']:
        if node.get('disabled') or node['type'] not in PROTECTED_IDS | {WEBHOOK}:
            continue
        result.append({'type': node['type'], 'parameters': node.get('parameters', {}),
                       'webhookId': node.get('webhookId'),
                       'node_id': node.get('id') if node['type'] in PROTECTED_IDS else None})
    return sorted(result, key=digest)


def assignments(plan, sources):
    specs = {entry['id']: entry for entry in plan['sources']}
    targets = {entry['id'] for entry in plan['targets']}
    need(len(targets) == 5 and targets <= set(sources), 'FIVE_EXISTING_TARGETS_REQUIRED')
    routes = {entry['node']: entry for entry in plan['main_trigger_routes']}
    result = {}
    for identity, data in sources.items():
        nodes = {node['name']: node for node in data['nodes']}
        need(len(nodes) == len(data['nodes']), 'DUPLICATE_SOURCE_NODE_NAME', identity)
        adjacency, reverse = graph(data)
        need(set(adjacency) | set(reverse) <= set(nodes), 'DANGLING_SOURCE_CONNECTION', identity)
        allocated = defaultdict(set)
        roots = [node for node in data['nodes'] if is_trigger(node)]
        need(not any(reverse.get(node['name']) for node in roots),
             'TRIGGER_REENTRY_WOULD_REFRESH_DEADLINE', identity)
        if identity == MAIN:
            need({node['name'] for node in roots} == set(routes), 'MAIN_TRIGGER_SET_CHANGED')
            for node in roots:
                route = routes[node['name']]
                if route.get('disposition') == 'archive_disabled':
                    need(node.get('disabled') is True, 'DORMANT_TRIGGER_REACTIVATED', node['name'])
                    continue
                need(not node.get('disabled'), 'EXPECTED_ACTIVE_TRIGGER_DISABLED', node['name'])
                for name in reachable([node['name']], adjacency):
                    allocated[name].add(route['target'])
        else:
            for name in reachable([node['name'] for node in roots if not node.get('disabled')], adjacency):
                allocated[name].add(specs[identity]['target'])
        for name, owners in allocated.items():
            need(len(owners) == 1 and owners <= targets, 'AMBIGUOUS_GRAPH_DESTINATION', identity + '/' + name)
            result[(identity, name)] = next(iter(owners))
    return result


def setting_changes(plan, sources, allocated, settings):
    changes = []
    for target in sorted(settings):
        contributors = sorted({identity for (identity, _), owner in allocated.items() if owner == target})
        for identity in contributors:
            before = sources[identity].get('settings', {})
            after = settings[target]
            for key in sorted(set(before) | set(after)):
                old, new = before.get(key, DEFAULT), after.get(key, DEFAULT)
                if old != new:
                    changes.append({'target': target, 'source': identity, 'setting': key, 'before': old, 'after': new})
    return changes


def review_template(plan, sources, components=None):
    original_sources = sources
    components = components or {}
    plan, sources = with_components(plan, sources, components)
    allocated = assignments(plan, sources)
    conflicts = {}
    for entry in plan['targets']:
        target = entry['id']
        contributors = {identity for (identity, _), owner in allocated.items() if owner == target}
        keys = set().union(*(sources[identity].get('settings', {}) for identity in contributors))
        conflicts[target] = {key: {identity: sources[identity].get('settings', {}).get(key, DEFAULT)
                                  for identity in sorted(contributors)} for key in sorted(keys)}
    return {'schema_version': 1, 'source_pins': source_pins(original_sources), 'effective_source_pins': {},
            'component_pins': component_pins(components), 'call_deadline_inputs': {},
            'metadata_pins': {}, 'static_data_reviews': {}, 'static_data_migrations': {},
            'target_settings': {entry['id']: None for entry in plan['targets']},
            'target_names': {}, 'accepted_setting_changes': [], 'identity_policies': {},
            'deadline_policy': None,
            'wait_resume_cutover_reviewed': False, 'settings_observations': conflicts}


def checked_schedule_state(identity, data, sources, allocated, migration):
    """Migrate only reviewed, empty hourly-recurrence bookkeeping.

    This intentionally cannot migrate arbitrary static state, recurrence cursors,
    or a renamed global state object. Full metadata is pinned by the caller.
    """
    need(isinstance(migration, dict) and migration.get('strategy') == 'preserve_hourly_schedule_metadata'
         and isinstance(migration.get('reason'), str) and migration['reason'].strip(),
         'NONEMPTY_STATIC_DATA', identity)
    retained = migration.get('preserve_node_keys', {})
    obsolete = migration.get('rollback_only_keys', [])
    state = data['staticData']
    need(isinstance(state, dict) and isinstance(retained, dict) and retained
         and isinstance(obsolete, list) and len(set(obsolete)) == len(obsolete)
         and set(retained).isdisjoint(obsolete) and set(state) == set(retained) | set(obsolete),
         'STATIC_DATA_MIGRATION_KEYS_MISMATCH', identity)
    nodes = {node['name']: node for node in sources[identity]['nodes']}
    result = {}
    for key, value in state.items():
        need(isinstance(key, str) and key.startswith('node:') and
             value == {'recurrenceRules': [None], 'recurrenceRuleSignatures': [None]},
             'STATIC_DATA_RECURRENCE_CURSOR_UNREVIEWED', identity + '/' + str(key))
        if key in obsolete:
            need(key[5:] not in nodes, 'STATIC_DATA_ROLLBACK_KEY_STILL_REFERENCED', identity + '/' + key)
            continue
        name = retained[key]
        node = nodes.get(name, {})
        rules = node.get('parameters', {}).get('rule', {}).get('interval', [])
        need(key == 'node:' + name and (identity, name) in allocated
             and node.get('type') == 'n8n-nodes-base.scheduleTrigger' and not node.get('disabled')
             and len(rules) == 1 and rules[0].get('field') == 'hours'
             and rules[0].get('hoursInterval', 1) == 1 and rules[0].get('triggerAtMinute', 0) == 0,
             'STATIC_DATA_HOURLY_NODE_BINDING_CHANGED', identity + '/' + str(name))
        target = allocated[(identity, name)]
        new_key = 'node:' + identity + ' · ' + name
        result.setdefault(target, {})[new_key] = copy.deepcopy(value)
    return result


def checked_static_data(sources, allocated, review, metadata_sources):
    need(set(metadata_sources) <= set(sources), 'UNKNOWN_METADATA_SOURCE')
    need(review.get('metadata_pins', {}) == {identity: digest(data) for identity, data in sorted(metadata_sources.items())},
         'UNREVIEWED_METADATA_SOURCE')
    observations = {}
    migrated = {}
    stateless_entries = {WEBHOOK, INTERNAL_TRIGGER, 'n8n-nodes-base.manualTrigger', 'n8n-nodes-base.formTrigger'}
    for identity, source in sources.items():
        data = metadata_sources.get(identity, source)
        if identity in metadata_sources:
            expected = source['versionId']
            need(data.get('id') == identity, 'METADATA_ID_CHANGED', identity)
            if data.get('versionId') == expected:
                active = data
            else:
                need(data.get('activeVersionId') == expected, 'METADATA_ACTIVE_VERSION_CHANGED', identity)
                active = data.get('activeVersion') or {}
                need(active.get('versionId') == expected, 'METADATA_ACTIVE_VERSION_REQUIRED', identity)
            need(active.get('nodes') == source['nodes'] and active.get('connections') == source['connections']
                 and data.get('settings', {}) == source.get('settings', {}), 'METADATA_GRAPH_CHANGED', identity)
        if 'staticData' in data:
            if data['staticData']:
                states = checked_schedule_state(identity, data, sources, allocated,
                                                review.get('static_data_migrations', {}).get(identity))
                for target, state in states.items():
                    need(set(migrated.get(target, {})).isdisjoint(state), 'STATIC_DATA_TARGET_COLLISION', target)
                    migrated.setdefault(target, {}).update(state)
                observations[identity] = {
                    'status': 'reviewed_hourly_schedule_metadata_preserved',
                    'preserved': review['static_data_migrations'][identity]['preserve_node_keys'],
                    'rollback_only': review['static_data_migrations'][identity]['rollback_only_keys'],
                }
            else:
                observations[identity] = 'explicitly_empty_in_export_or_active_metadata'
            continue
        retained = [node for node in source['nodes'] if (identity, node['name']) in allocated]
        stateful = [node['name'] for node in retained if is_trigger(node) and node['type'] not in stateless_entries and not node.get('disabled')]
        need(not stateful, 'STATEFUL_TRIGGER_STATIC_DATA_METADATA_REQUIRED', identity + '/' + ','.join(stateful))
        attestation = review.get('static_data_reviews', {}).get(identity, {})
        need(attestation.get('status') == 'unused_in_retained_graph' and isinstance(attestation.get('reason'), str)
             and bool(attestation['reason'].strip()), 'STATIC_DATA_ABSENCE_IS_NOT_EMPTY', identity)
        observations[identity] = 'absent_field_explicitly_reviewed_as_unused_in_retained_graph'
    observed_migrations = {identity for identity, value in observations.items() if isinstance(value, dict)}
    need(set(review.get('static_data_migrations', {})) == observed_migrations, 'STALE_STATIC_DATA_MIGRATION')
    return observations, migrated


def checked_settings(plan, sources, allocated, review):
    need(review.get('deadline_policy') == 'absolute_per_operation_v1', 'OPERATION_DEADLINE_POLICY_REVIEW_REQUIRED')
    settings = review.get('target_settings', {})
    need(set(settings) == {entry['id'] for entry in plan['targets']} and
         all(isinstance(value, dict) for value in settings.values()), 'TARGET_SETTINGS_REVIEW_REQUIRED')
    for identity, values in settings.items():
        need(values.get('executionOrder') == 'v1' and values.get('binaryMode') == 'separate', 'EXECUTION_MODE_MUST_BE_EXPLICIT', identity)
        need(values.get('saveDataErrorExecution') == 'none' and values.get('saveDataSuccessExecution') == 'none'
             and values.get('saveManualExecutions') is False and values.get('saveExecutionProgress') is False,
             'PRIVATE_PAYLOAD_PERSISTENCE_FORBIDDEN', identity)
        need(values.get('callerPolicy') == 'workflowsFromSameOwner' and values.get('availableInMCP') is False,
             'INTERNAL_CALLER_POLICY_REQUIRED', identity)
    changes = setting_changes(plan, sources, allocated, settings)
    accepted = review.get('accepted_setting_changes', [])
    need(all(isinstance(value, dict) and isinstance(value.get('reason'), str) and value['reason'].strip()
             for value in accepted), 'SETTING_CHANGE_REASON_REQUIRED')
    actual = {digest(value) for value in changes}
    recorded = {digest({key: value[key] for key in ('target', 'source', 'setting', 'before', 'after')}) for value in accepted}
    need(actual == recorded, 'UNREVIEWED_SETTING_CHANGE', str(len(actual - recorded)) + ' missing / ' + str(len(recorded - actual)) + ' stale')
    return copy.deepcopy(settings), changes


def rewrite_string(text, names, source, old_name, target, target_name, source_name, review):
    # Resolve the existing, finite inventory helper; do not authorize arbitrary
    # dynamically calculated node names just because they resemble this helper.
    if '$(name)' in text:
        helper = 'const one = name => inventorySingle($(name).all());'
        compact_helper = 'const one=name=>inventorySingle($(name).all());'
        mapping = re.search(r'const inventoryNames = (\{[\s\S]*?\n\});', text)
        need(text.count('$(name)') == 1, 'UNRESOLVED_DYNAMIC_NODE_REFERENCE', source + '/' + old_name)
        if compact_helper in text:
            call = re.compile(r'''\bone\(\s*(['"])([^'"]+)\1\s*\)''')
            remainder = text.replace(compact_helper, '')
            referenced = [match.group(2) for match in call.finditer(remainder)]
            need(referenced and not re.search(r'\bone\b', call.sub('', remainder))
                 and all(name in names for name in referenced),
                 'UNRESOLVED_INVENTORY_LITERAL_HELPER', source + '/' + old_name)
            text = call.sub(lambda match: 'one(' + json.dumps(names[match.group(2)], ensure_ascii=False) + ')', text)
            checked = text.replace(compact_helper, '')
        else:
            need(helper in text and mapping is not None,
                 'UNRESOLVED_DYNAMIC_NODE_REFERENCE', source + '/' + old_name)
            entry = re.compile(r'''\s*([A-Za-z_$][\w$]*)\s*:\s*(['"])([^'"]+)\2\s*,?''')
            body = mapping.group(1)[1:-1]
            need(not entry.sub('', body).strip(), 'UNRESOLVED_INVENTORY_NAME_MAP', source + '/' + old_name)
            referenced = [match.group(3) for match in entry.finditer(body)]
            need(bool(referenced) and all(name in names for name in referenced), 'INVENTORY_REFERENCE_OUTSIDE_TARGET', source + '/' + old_name)
            replacement = entry.sub(lambda match: '\n  ' + match.group(1) + ': ' + json.dumps(names[match.group(3)], ensure_ascii=False) + ',', body)
            text = text[:mapping.start(1)] + '{' + replacement + '\n}' + text[mapping.end(1):]
            checked = text.replace(helper, '')
    else:
        checked = text
    # This form selects between two literal node names. Its comparison is kept
    # verbatim; both possible destinations must belong to this same graph.
    ternary = re.compile(r'''\$\(\s*([A-Za-z_$][\w$]*\s*===\s*(['"])[^'"]+\2)\s*\?\s*(['"])([^'"]+)\3\s*:\s*(['"])([^'"]+)\5\s*\)''')
    def rewrite_ternary(match):
        first, second = match.group(4), match.group(6)
        need(first in names and second in names, 'TERNARY_REFERENCE_OUTSIDE_TARGET', source + '/' + old_name)
        return '$(' + match.group(1) + '?' + json.dumps(names[first], ensure_ascii=False) + ':' + json.dumps(names[second], ensure_ascii=False) + ')'
    text = ternary.sub(rewrite_ternary, text)
    checked = ternary.sub('', checked)
    need(not DYNAMIC.search(REFERENCE.sub('', checked)), 'UNRESOLVED_DYNAMIC_NODE_REFERENCE', source + '/' + old_name)
    need('getWorkflowStaticData' not in text and '$workflow.staticData' not in text, 'STATIC_DATA_ACCESS_REQUIRES_DESIGN', source + '/' + old_name)

    def replace(match):
        referenced = match.group(3)
        need(referenced in names, 'NODE_REFERENCE_OUTSIDE_TARGET', source + '/' + old_name + ' -> ' + referenced)
        return match.group(1) + json.dumps(names[referenced], ensure_ascii=False)
    text = REFERENCE.sub(replace, text)
    policies = review.get('identity_policies', {}).get(source + '/' + old_name, {})
    for expression, changed, original, policy_key in (
        ('$workflow.id', source != target, source, 'workflow_id'),
        ('$workflow.name', source_name != target_name, source_name, 'workflow_name'),
    ):
        if changed and expression in text:
            policy = policies.get(policy_key)
            need(policy in ('preserve_source', 'accept_destination'), 'WORKFLOW_IDENTITY_REVIEW_REQUIRED', source + '/' + old_name)
            if policy == 'preserve_source':
                text = text.replace(expression, json.dumps(original, ensure_ascii=False))
    return text


def rewrite_parameters(value, names, source, old_name, target, target_name, source_name, review):
    if isinstance(value, str):
        return rewrite_string(value, names, source, old_name, target, target_name, source_name, review)
    if isinstance(value, list):
        return [rewrite_parameters(child, names, source, old_name, target, target_name, source_name, review) for child in value]
    if isinstance(value, dict):
        return {key: rewrite_parameters(child, names, source, old_name, target, target_name, source_name, review)
                for key, child in value.items()}
    return value


def input_mapping_kind(node, child):
    need(node.get('typeVersion') in (1.2, 1.3), 'UNREVIEWED_EXECUTE_WORKFLOW_VERSION', node['name'])
    params = node.get('parameters', {})
    need(params.get('source', 'database') == 'database', 'NON_DATABASE_SUBWORKFLOW', node['name'])
    need(params.get('mode', 'once') in ('once', 'each'), 'DYNAMIC_EXECUTION_MODE', node['name'])
    need(isinstance(params.get('options', {}).get('waitForSubWorkflow', True), bool), 'DYNAMIC_WAIT_MODE', node['name'])
    need(params.get('options', {}).get('waitForSubWorkflow', True) is True, 'ASYNC_CALL_REQUIRES_RETURN_ADAPTER', node['name'])
    triggers = [entry for entry in child['nodes'] if entry['type'] == INTERNAL_TRIGGER and not entry.get('disabled')]
    need(len(triggers) == 1 and triggers[0].get('parameters', {}).get('inputSource', 'workflowInputs') == 'passthrough',
         'CHILD_INPUT_CONTRACT_REQUIRES_MATERIALIZER', child['id'])
    mapping = params.get('workflowInputs')
    if mapping is None:
        return 'passthrough'
    need(isinstance(mapping, dict) and mapping.get('mappingMode', 'defineBelow') == 'defineBelow'
         and mapping.get('value') in (None, {}) and not mapping.get('schema')
         and not mapping.get('matchingColumns'), 'MAPPED_INPUT_REQUIRES_MATERIALIZER', node['name'])
    # Native Execute Workflow merges evaluated value into the original JSON.
    # No fields and no schema means the original JSON/binary remain unchanged.
    return 'empty_mapper_passthrough'


def code_node(identity, name, code, position):
    return {'id': stable_id(identity, name), 'name': name, 'type': 'n8n-nodes-base.code',
            'typeVersion': 2, 'position': position,
            'parameters': {'mode': 'runOnceForAllItems', 'jsCode': code}}


def edge(name, index=0):
    return {'node': name, 'type': 'main', 'index': index}


def entry_gate(node, known_entries):
    """Recognize only an exact, non-payload-based native-entry IF gate."""
    if node.get('type') != 'n8n-nodes-base.if' or node.get('typeVersion') not in (2, 2.1, 2.2):
        return None
    conditions = node.get('parameters', {}).get('conditions', {})
    rules = conditions.get('conditions', [])
    if len(rules) != 1 or conditions.get('combinator', 'and') != 'and':
        return None
    rule = rules[0]
    if rule.get('operator') != {'type': 'boolean', 'operation': 'true', 'singleValue': True}:
        return None
    expression = rule.get('leftValue', '')
    if not isinstance(expression, str):
        return None
    match = re.fullmatch(r'''=\{\{\s*\$\(\s*(['"])([^'"]+)\1\s*\)\.isExecuted\s*\}\}''', expression)
    return match.group(2) if match and match.group(2) in known_entries else None


def reachable_in_context(candidate, starts, known_entries, executed_entries):
    nodes = {node['name']: node for node in candidate['nodes']}
    reached, gates, pending = set(), {}, list(starts)
    while pending:
        name = pending.pop()
        if name in reached:
            continue
        reached.add(name)
        outputs = candidate.get('connections', {}).get(name, {})
        referenced_entry = entry_gate(nodes[name], known_entries)
        for kind, lanes in outputs.items():
            selected = lanes
            if referenced_entry is not None and kind == 'main':
                chosen = 0 if referenced_entry in executed_entries else 1
                selected = [lanes[chosen]] if len(lanes) > chosen else []
                gates[name] = {'entry': referenced_entry, 'selected_output': chosen}
            for lane in selected:
                pending.extend(link['node'] for link in lane)
    return reached, gates


def marker_values_expression(markers):
    values = [f'$({json.dumps(name, ensure_ascii=False)}).isExecuted ? '
              f'$({json.dumps(name, ensure_ascii=False)}).first(0,0).json : undefined'
              for name in sorted(markers)]
    return '[' + ','.join(values) + '].filter(value => value !== undefined)'


def marker_deadline_expression(markers):
    if not markers:
        return 'null'
    return 'consolidationReadDeadline(' + marker_values_expression(markers) + ')'


def call_deadline_expression(source, old_name, markers, names, allocated, review):
    base = marker_deadline_expression(markers)
    policy = review.get('call_deadline_inputs', {}).get(source + '/' + old_name)
    if policy is None:
        return base, None
    need(isinstance(policy, dict) and set(policy) == {'node', 'field', 'format', 'reason'}
         and isinstance(policy.get('reason'), str) and policy['reason'].strip()
         and isinstance(policy.get('field'), str) and re.fullmatch(r'[A-Za-z_$][\w$]*', policy['field'])
         and policy.get('format') in ('epoch_ms', 'iso'), 'CALL_DEADLINE_INPUT_POLICY_INVALID', source + '/' + old_name)
    reference = (source, policy.get('node'))
    need(reference in names and allocated[reference] == allocated[(source, old_name)],
         'CALL_DEADLINE_INPUT_OUTSIDE_GRAPH', source + '/' + old_name)
    accessor = '$(' + json.dumps(names[reference], ensure_ascii=False) + ').first(0,0).json[' + json.dumps(policy['field']) + ']'
    conversion = 'value' if policy['format'] == 'epoch_ms' else '(typeof value === "string" ? Date.parse(value) : NaN)'
    additional = '(() => { const value = ' + accessor + '; const deadlineAt = ' + conversion + '; ' + \
        "if (!Number.isSafeInteger(deadlineAt) || deadlineAt <= 0) throw Error('CONSOLIDATION_CALL_DEADLINE_INVALID'); return deadlineAt; })()"
    return 'consolidationMinimumDeadline([' + base + ', ' + additional + '])', copy.deepcopy(policy)


def http_timeout_expression(original, markers, detail):
    if isinstance(original, (int, float)) and not isinstance(original, bool):
        need(original > 0, 'BOUNDED_HTTP_TIMEOUT_INVALID', detail)
        configured = json.dumps(original)
    else:
        need(isinstance(original, str) and original.strip().startswith('={{')
             and original.strip().endswith('}}'), 'BOUNDED_HTTP_TIMEOUT_REVIEW_REQUIRED', detail)
        configured = original.strip()[3:-2].strip()
    # Expressions run in their own context: do not depend on declarations in a
    # previous Code node. Evaluate the existing timeout once, retaining stricter
    # request-specific limits (including the thumbnail batch deadline).
    return '={{ (() => {\n' + \
        'const markers = ' + marker_values_expression(markers) + ';\n' + \
        "if (!markers.length || markers.some(value => value.deadlineAt !== null && (!Number.isSafeInteger(value.deadlineAt) || value.deadlineAt <= 0))) throw Error('CONSOLIDATION_MARKER_MISSING_OR_INVALID');\n" + \
        'const deadlines = markers.map(value => value.deadlineAt).filter(value => value !== null);\n' + \
        'const deadlineAt = deadlines.length ? Math.min(...deadlines) : null;\n' + \
        "if (deadlineAt !== null && Date.now() >= deadlineAt) throw Error('CONSOLIDATION_OPERATION_TIMEOUT');\n" + \
        'const configured = Number((' + configured + '));\n' + \
        "if (!Number.isFinite(configured) || configured <= 0) throw Error('CONSOLIDATION_REQUEST_TIMEOUT_INVALID');\n" + \
        'if (deadlineAt === null) return configured;\n' + \
        'const remaining = deadlineAt - Date.now();\n' + \
        "if (remaining <= 0) throw Error('CONSOLIDATION_OPERATION_TIMEOUT');\n" + \
        'return Math.max(1, Math.min(configured, remaining));\n})() }}'


def instrument_deadlines(sources, allocated, candidates, copied, names, internal_entries, runtime, provenance):
    """Keep per-source budgets without exposing runtime fields to business JSON.

    The limits are cooperative at Code/builtin boundaries. Already started
    non-abortable builtin work is not a transaction and is not rolled back.
    """
    marker_by_root = {}
    markers_by_node = defaultdict(set)
    provenance['operation_deadlines'] = []
    provenance['deadline_guards'] = []
    for identity, source in sorted(sources.items()):
        timeout = source.get('settings', {}).get('executionTimeout')
        need(timeout is None or (isinstance(timeout, int) and not isinstance(timeout, bool)),
             'SOURCE_TIMEOUT_NOT_STATIC_SECONDS', identity)
        timeout = timeout if timeout and timeout > 0 else None
        adjacency, _ = graph(source)
        for root in source['nodes']:
            key = (identity, root['name'])
            if key not in allocated or not is_trigger(root) or root.get('disabled'):
                continue
            internal = root['type'] == INTERNAL_TRIGGER
            if timeout is None and not internal:
                # Keep inherited instance limits on the original unbounded
                # public/form/Wait paths, without adding a new branch budget.
                continue
            target = allocated[key]
            candidate = candidates[target]
            root_name = names[key]
            marker_name = root_name + ' · Operationsfrist'
            position = copied[key].get('position', [0, 0])
            operation = next((op for op, name, src in internal_entries[target]
                              if src == identity and name == root_name), None)
            if internal:
                need(operation is not None, 'INTERNAL_DEADLINE_OPERATION_MISSING', root_name)
                begin = 'consolidationBeginInternal($input.all(), ' + json.dumps(operation) + ', ' + json.dumps(timeout) + ')'
                copied[key]['parameters']['jsCode'] = runtime + '\nreturn consolidationRestore($input.all());'
                candidate['connections'][marker_name] = {'main': [[edge(root_name)]]}
                internal_entries[target] = [(op, marker_name if name == root_name and src == identity else name, src)
                                            for op, name, src in internal_entries[target]]
            else:
                begin = 'consolidationBeginExternal($input.all(), ' + json.dumps(timeout) + ')'
                restore_name = root_name + ' · Facheingabe'
                outputs = candidate['connections'].get(root_name, {})
                need(set(outputs) <= {'main'} and len(outputs.get('main', [])) <= 1,
                     'EXTERNAL_ENTRY_OUTPUT_REQUIRES_REVIEW', root_name)
                candidate['connections'][root_name] = {'main': [[edge(marker_name)]]}
                candidate['connections'][marker_name] = {'main': [[edge(restore_name)]]}
                candidate['connections'][restore_name] = outputs
                candidate['nodes'].append(code_node(identity, restore_name,
                    runtime + '\nreturn consolidationRestore($input.all());', [position[0] + 360, position[1]]))
            candidate['nodes'].append(code_node(identity, marker_name, runtime + '\nreturn ' + begin + ';',
                                                [position[0] + 180, position[1]]))
            marker_by_root[key] = marker_name
            for name in reachable([root['name']], adjacency):
                if (identity, name) in allocated:
                    need(allocated[(identity, name)] == target, 'DEADLINE_GRAPH_CROSSES_TARGET', identity + '/' + name)
                    markers_by_node[(identity, name)].add(marker_name)
            provenance['operation_deadlines'].append({'source': identity, 'entry': root['name'],
                'target': target, 'marker': marker_name, 'own_timeout_seconds': timeout,
                'inherits_shorter_parent': internal})

    for key, node in copied.items():
        identity, old_name = key
        original = next(value for value in sources[identity]['nodes'] if value['name'] == old_name)
        markers = markers_by_node[key]
        if not markers or is_trigger(original):
            continue
        need(node['type'] not in PROTECTED_IDS, 'BOUNDED_FORM_OR_WAIT_REQUIRES_REVIEW', identity + '/' + old_name)
        candidate = candidates[allocated[key]]
        deadline = marker_deadline_expression(markers)
        check = 'consolidationAssertDeadline(' + deadline + ');'
        kind = node['type']
        if kind == 'n8n-nodes-base.code':
            original_code = node.get('parameters', {}).get('jsCode')
            need(isinstance(original_code, str) and '__smaConsolidationResult' not in original_code
                 and not re.search(r'\b(?:const|let|var|function)\s+consolidation\w*', original_code),
                 'CODE_DEADLINE_WRAPPER_REQUIRES_REVIEW', identity + '/' + old_name)
            node['parameters']['jsCode'] = runtime + '\n' + check + \
                '\nconst __smaConsolidationResult = await (async () => {\n' + original_code + \
                '\n})();\n' + check + '\nreturn consolidationCodeOutput(__smaConsolidationResult);'
            provenance['deadline_guards'].append({'source': identity, 'node': old_name, 'kind': 'code_before_and_after'})
        elif kind == 'n8n-nodes-base.httpRequest':
            options = node['parameters'].setdefault('options', {})
            options['timeout'] = http_timeout_expression(options.get('timeout'), markers, identity + '/' + old_name)
            provenance['deadline_guards'].append({'source': identity, 'node': old_name, 'kind': 'http_remaining_time'})
        elif kind == CALL:
            # The dedicated caller adapter below checks and forwards this exact
            # deadline before any native subworkflow call can start.
            provenance['deadline_guards'].append({'source': identity, 'node': old_name, 'kind': 'native_call_context'})
        else:
            incoming = defaultdict(list)
            for outputs in candidate['connections'].values():
                for channel, lanes in outputs.items():
                    for lane in lanes:
                        for link in lane:
                            if link['node'] == node['name']:
                                need(channel == 'main' and isinstance(link.get('index', 0), int),
                                     'DEADLINE_INPUT_CHANNEL_UNSUPPORTED', node['name'])
                                incoming[link.get('index', 0)].append(link)
            need(incoming, 'DEADLINE_NODE_HAS_NO_MAIN_INPUT', node['name'])
            for index, links in incoming.items():
                guard_name = node['name'] + ' · Frist vor Eingang ' + str(index)
                for link in links:
                    link['node'] = guard_name
                    link['index'] = 0
                candidate['nodes'].append(code_node(identity, guard_name,
                    runtime + '\n' + check + '\nreturn consolidationPassThrough($input.all());',
                    [node.get('position', [0, 0])[0] - 180, node.get('position', [0, 0])[1] + index * 100]))
                candidate['connections'][guard_name] = {'main': [[edge(node['name'], index)]]}
            provenance['deadline_guards'].append({'source': identity, 'node': old_name, 'kind': 'builtin_before_each_input'})

        # Terminal HTTP/builtin work and Code nodes with continue-on-error need
        # a separate final gate: their own error policy must not turn an expired
        # operation into a successful child return. HTTP response nodes retain
        # their original early/terminal send point, guarded immediately before.
        outgoing = candidate['connections'].get(node['name'], {})
        has_outgoing = any(lane for lanes in outgoing.values() for lane in lanes)
        continued = node.get('onError', 'stopWorkflow') != 'stopWorkflow' or node.get('continueOnFail') is True
        if not has_outgoing and kind not in ('n8n-nodes-base.respondToWebhook', 'n8n-nodes-base.stopAndError') \
                and (kind != 'n8n-nodes-base.code' or continued):
            output_count = 2 if node.get('onError') == 'continueErrorOutput' else 1
            lanes = []
            for index in range(output_count):
                guard_name = node['name'] + ' · Frist vor Rückgabe ' + str(index)
                candidate['nodes'].append(code_node(identity, guard_name,
                    runtime + '\n' + check + '\nreturn consolidationPassThrough($input.all());',
                    [node.get('position', [0, 0])[0] + 180, node.get('position', [0, 0])[1] + index * 100]))
                lanes.append([edge(guard_name)])
            candidate['connections'][node['name']] = {'main': lanes}
    return markers_by_node


def form_entry_route(node):
    parameters = node.get('parameters', {})
    return parameters.get('path') or parameters.get('options', {}).get('path') or node.get('webhookId')


def pin_form_entry_routes(copied, provenance):
    """Keep Form Trigger 2.6 public URLs explicit across UI webhookId regeneration.

    n8n 2.47.7 imports regenerate FormTrigger.webhookId, including an explicit
    path equal to that old ID. The operator must restore this exact Form Path
    after import. The readback verifier requires the explicit path on both sides.
    """
    provenance['form_routes'] = []
    for (source, original_name), node in sorted(copied.items()):
        if node['type'] != 'n8n-nodes-base.formTrigger' or node.get('typeVersion') != 2.6:
            continue
        parameters = node['parameters']
        need(parameters.get('authentication', 'none') == 'none',
             'FORM_AUTH_IDENTITY_REVIEW_REQUIRED', node['name'])
        path = form_entry_route(node)
        need(isinstance(path, str) and re.fullmatch(r'[A-Za-z0-9_-]+', path),
             'FORM_STATIC_PUBLIC_PATH_REQUIRED', node['name'])
        if not parameters.get('path') and not parameters.get('options', {}).get('path'):
            parameters.setdefault('options', {})['path'] = path
        provenance['form_routes'].append({'source': source, 'source_node': original_name,
            'target_node': node['name'], 'public_path': path, 'source_webhook_id': node.get('webhookId'),
            'restore_form_path_after_ui_import': path == node.get('webhookId')})


def consolidate_manual_entries(candidates, copied, provenance):
    """n8n 2.47.7 permits one ManualTrigger per workflow (maxNodes: 1).

    Retain each original entry's name and outgoing graph as a guarded Code
    bridge. A single UI-editable, empty-by-default selector routes exactly one
    operation. It must never fan out into several administrative operations.
    """
    manual_type = 'n8n-nodes-base.manualTrigger'
    source_by_name = {node['name']: (source, old_name) for (source, old_name), node in copied.items()}
    provenance['manual_entry_consolidation'] = {}
    for target, candidate in candidates.items():
        entries = sorted([node for node in candidate['nodes'] if node['type'] == manual_type and not node.get('disabled')],
                         key=lambda node: node['name'])
        if len(entries) <= 1:
            continue
        trigger = 'SMA · Manuellen Vorgang starten'
        selector = 'SMA · Manuellen Vorgang auswählen'
        router = 'SMA · Manuellen Vorgang zuordnen'
        reject = 'SMA · Manuelle Auswahl erforderlich'
        field = 'manual_operation'
        operations = []
        for node in entries:
            source, original_name = source_by_name[node['name']]
            operation = source + ' / ' + original_name
            operations.append({'operation': operation, 'source': source, 'original_node': original_name,
                               'target_bridge': node['name']})
            # The native ManualTrigger emits exactly one empty JSON item.
            # Keep that Fachinput, without leaking the selector field downstream.
            node['type'], node['typeVersion'] = 'n8n-nodes-base.code', 2
            node['parameters'] = {'jsCode':
                'const items = $input.all();\n' +
                'if (items.length !== 1 || Object.keys(items[0].json).join(",") !== ' + json.dumps(field) +
                ' || items[0].json.' + field + ' !== ' + json.dumps(operation, ensure_ascii=False) +
                ') throw Error("CONSOLIDATION_MANUAL_SELECTION_INVALID");\n' +
                'return [{json: {}, pairedItem: {item: 0}}];'}
            node.pop('webhookId', None)
        candidate['nodes'].append({'id': stable_id(target, trigger), 'name': trigger,
            'type': manual_type, 'typeVersion': 1, 'position': [-1300, -1400], 'parameters': {}})
        choices = '\n'.join(value['operation'] for value in operations)
        candidate['nodes'].append({'id': stable_id(target, selector), 'name': selector,
            'type': 'n8n-nodes-base.set', 'typeVersion': 3.4, 'position': [-1050, -1400],
            'parameters': {'assignments': {'assignments': [{'id': stable_id(target, selector, field),
                'name': field, 'value': '', 'type': 'string'}]}},
            'notesInFlow': True,
            'notes': 'Standard: leer = Abbruch ohne Fachaktion. Für einen bewussten manuellen Lauf genau einen Wert in manual_operation eintragen:\n'
                     + choices + '\nNach dem Lauf die Auswahl wieder leeren. Öffentliche und geplante Aufrufe benutzen diesen Einstieg nicht.'})
        rules = [{'conditions': {'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'strict', 'version': 3},
                    'conditions': [{'id': stable_id(target, router, entry['operation']),
                        'leftValue': '={{ $json.' + field + ' }}', 'rightValue': entry['operation'],
                        'operator': {'type': 'string', 'operation': 'equals'}}], 'combinator': 'and'},
                  'renameOutput': True, 'outputKey': entry['original_node']} for entry in operations]
        candidate['nodes'].append({'id': stable_id(target, router), 'name': router,
            'type': 'n8n-nodes-base.switch', 'typeVersion': 3.4, 'position': [-800, -1400],
            'parameters': {'rules': {'values': rules}, 'options': {'fallbackOutput': 'extra'}}})
        candidate['nodes'].append(code_node(target, reject,
            'throw Error(' + json.dumps('CONSOLIDATION_MANUAL_SELECTION_REQUIRED: Im Knoten "' + selector +
                '" genau einen der angezeigten Vorgänge wählen.', ensure_ascii=False) + ');', [-550, -1600]))
        candidate['connections'][trigger] = {'main': [[edge(selector)]]}
        candidate['connections'][selector] = {'main': [[edge(router)]]}
        candidate['connections'][router] = {'main': [[edge(entry['target_bridge'])] for entry in operations] + [[edge(reject)]]}
        provenance['manual_entry_consolidation'][target] = {'trigger': trigger, 'selector': selector,
            'field': field, 'default_value': '', 'router': router, 'reject': reject, 'operations': operations}
    for target, candidate in candidates.items():
        need(sum(node['type'] == manual_type for node in candidate['nodes']) <= 1,
             'N8N_MANUAL_TRIGGER_LIMIT_EXCEEDED', target)


def build(plan, original_sources, review, effective_sources=None, metadata_sources=None, components=None):
    original_plan = plan
    expected = {entry['id'] for entry in plan['sources']}
    need(set(original_sources) == expected, 'INCOMPLETE_LIVE_EXPORTS')
    need(review.get('source_pins') == source_pins(original_sources), 'SOURCE_SNAPSHOT_CHANGED')
    sources = copy.deepcopy(original_sources)
    overlays = effective_sources or {}
    need(set(overlays) <= expected, 'UNKNOWN_EFFECTIVE_SOURCE')
    need(review.get('effective_source_pins', {}) == source_pins(overlays), 'UNREVIEWED_EFFECTIVE_SOURCE')
    for identity, effective in overlays.items():
        need(effective.get('id') == identity and effective.get('versionId') == original_sources[identity].get('versionId'), 'OVERLAY_IDENTITY_CHANGED', identity)
        need(effective.get('staticData', DEFAULT) == original_sources[identity].get('staticData', DEFAULT),
             'OVERLAY_STATIC_DATA_CHANGED', identity)
        need(source_entry_signatures(effective) == source_entry_signatures(original_sources[identity]),
             'OVERLAY_EXTERNAL_ENTRY_CHANGED', identity)
        sources[identity] = copy.deepcopy(effective)
    for identity, data in sources.items():
        need(not data.get('pinData'), 'PINNED_DATA_REJECTED', identity)
    components = components or {}
    need(review.get('component_pins', {}) == component_pins(components), 'UNREVIEWED_COMPONENT_GRAPH')
    static_state, migrated_state = checked_static_data(original_sources, assignments(plan, original_sources), review, metadata_sources or {})
    plan, sources = with_components(plan, sources, components)
    allocated = assignments(plan, sources)
    settings, changes = checked_settings(plan, sources, allocated, review)
    for identity, component in components.items():
        need('executionTimeout' not in settings[component['target']],
             'COMPONENT_PARENT_REQUIRES_INHERITED_TOTAL_TIMEOUT', identity)
        retained = {name for source, name in allocated if source == 'component:' + identity}
        need(retained == {node['name'] for node in component['graph']['nodes']},
             'COMPONENT_UNREACHABLE_NODE_REJECTED', identity)
    specs = {entry['id']: entry for entry in plan['sources']}
    runtime = (ROOT / 'dispatcher-runtime.cjs').read_text().split('// @exports')[0]
    candidates = {}
    for entry in plan['targets']:
        identity = entry['id']
        candidates[identity] = {'id': identity,
            'name': review.get('target_names', {}).get(identity, sources[identity]['name']),
            'active': False, 'nodes': [], 'connections': {}, 'settings': settings[identity],
            'pinData': {}, 'staticData': migrated_state.get(identity)}
    names = {(identity, name): identity + ' · ' + name for identity, name in allocated}
    copied = {}
    internal_entries = defaultdict(list)
    provenance = {'source_pins': source_pins(original_sources), 'effective_source_pins': source_pins(overlays),
                  'component_pins': component_pins(components),
                  'static_data_evidence': static_state,
                  'deadline_policy': review['deadline_policy'], 'plan_sha256': digest(original_plan),
                  'runtime_sha256': hashlib.sha256(runtime.encode()).hexdigest(),
                  'setting_changes': changes, 'nodes': [], 'internal_calls': [], 'excluded_nodes': {}}
    any_wait = False
    for identity, data in sorted(sources.items()):
        by_name = {node['name']: node for node in data['nodes']}
        provenance['excluded_nodes'][identity] = sorted(set(by_name) - {name for source, name in allocated if source == identity})
        for old_name, original in by_name.items():
            key = (identity, old_name)
            if key not in allocated:
                continue
            target = allocated[key]
            mapping = {name: renamed for (source, name), renamed in names.items()
                       if source == identity and allocated[(source, name)] == target}
            node = copy.deepcopy(original)
            node['name'] = names[key]
            if node['type'] not in PROTECTED_IDS:
                node['id'] = stable_id(identity, original['id'])
            node['parameters'] = rewrite_parameters(node.get('parameters', {}), mapping, identity, old_name,
                                                    target, candidates[target]['name'], data['name'], review)
            if node['type'] == 'n8n-nodes-base.wait':
                any_wait = True
            if node['type'] == INTERNAL_TRIGGER:
                need(not node.get('disabled'), 'DISABLED_INTERNAL_ENTRY', identity)
                need(node.get('parameters', {}).get('inputSource') == 'passthrough', 'DECLARED_CHILD_INPUTS_REQUIRE_REVIEW', identity)
                operation = specs[identity]['operation']
                internal_entries[target].append((operation, node['name'], identity))
                node['type'] = 'n8n-nodes-base.code'
                node['typeVersion'] = 2
                node['parameters'] = {'mode': 'runOnceForAllItems', 'jsCode': runtime + '\nreturn consolidationUnwrap($input.all(), ' + json.dumps(operation) + ');'}
                node.pop('webhookId', None)
            candidates[target]['nodes'].append(node)
            copied[key] = node
            provenance['nodes'].append({'source': identity, 'source_node': old_name, 'target': target,
                                        'target_node': node['name'], 'source_node_id': original['id'], 'target_node_id': node['id']})
        for old_name, outputs in data.get('connections', {}).items():
            key = (identity, old_name)
            if key not in allocated:
                continue
            target = allocated[key]
            rewritten = {}
            for kind, lanes in outputs.items():
                rewritten[kind] = []
                for lane in lanes:
                    new_lane = []
                    for link in lane:
                        destination = (identity, link['node'])
                        need(destination in allocated and allocated[destination] == target, 'EDGE_CROSSES_DESTINATION', identity + '/' + old_name)
                        new_lane.append({**link, 'node': names[destination]})
                    rewritten[kind].append(new_lane)
            candidates[target]['connections'][names[key]] = rewritten
    need(not any_wait or review.get('wait_resume_cutover_reviewed') is True, 'WAIT_RESUME_CUTOVER_REVIEW_REQUIRED')

    markers_by_node = instrument_deadlines(sources, allocated, candidates, copied, names,
                                           internal_entries, runtime, provenance)
    pin_form_entry_routes(copied, provenance)
    consolidate_manual_entries(candidates, copied, provenance)

    used_call_deadlines = set()
    for (identity, old_name), node in sorted(copied.items()):
        if node['type'] != CALL or node.get('disabled'):
            continue
        original = next(entry for entry in sources[identity]['nodes'] if entry['name'] == old_name)
        child_id = workflow_target(original)
        need(child_id in specs, 'UNRESOLVED_WORKFLOW_TARGET', identity + '/' + old_name)
        mapping_kind = input_mapping_kind(original, sources[child_id])
        target = allocated[(identity, old_name)]
        child_target = specs[child_id]['target']
        operation = specs[child_id]['operation']
        need(any(op == operation and source == child_id for op, _, source in internal_entries[child_target]),
             'INTERNAL_OPERATION_ENTRY_MISSING', child_id)
        adapter_name = node['name'] + ' · interne Eingabe'
        position = node.get('position', [0, 0])
        call_deadline, call_policy = call_deadline_expression(identity, old_name, markers_by_node[(identity, old_name)],
                                                             names, allocated, review)
        if call_policy is not None:
            used_call_deadlines.add(identity + '/' + old_name)
        adapter = code_node(identity, adapter_name,
                            runtime + '\nreturn consolidationWrap($input.all(), ' + json.dumps(operation) + ', ' +
                            call_deadline + ');',
                            [position[0] - 180, position[1]])
        # Redirect only the incoming main edge. Caller outputs/error paths remain
        # byte-identical apart from the consistent node-name namespace.
        incoming = 0
        for outputs in candidates[target]['connections'].values():
            for kind, lanes in outputs.items():
                for lane in lanes:
                    for link in lane:
                        if link['node'] == node['name']:
                            need(kind == 'main' and link.get('index', 0) == 0, 'UNSUPPORTED_CALL_INPUT_CONNECTION', node['name'])
                            link['node'] = adapter_name
                            incoming += 1
        need(incoming > 0, 'UNCONNECTED_INTERNAL_CALL', node['name'])
        candidates[target]['nodes'].append(adapter)
        candidates[target]['connections'][adapter_name] = {'main': [[edge(node['name'])]]}
        node['parameters']['workflowId'] = {'__rl': True, 'value': child_target, 'mode': 'id'}
        node['parameters'].pop('workflowInputs', None)
        provenance['internal_calls'].append({'source': identity, 'node': old_name, 'old_target': child_id,
            'new_target': child_target, 'operation': operation, 'mapping': mapping_kind,
            'same_target': target == child_target, 'mode': node['parameters'].get('mode', 'once'),
            'waitForSubWorkflow': node['parameters'].get('options', {}).get('waitForSubWorkflow', True),
            'onError': node.get('onError', 'stopWorkflow'), 'additional_deadline': call_policy})
    need(used_call_deadlines == set(review.get('call_deadline_inputs', {})), 'STALE_CALL_DEADLINE_INPUT_POLICY')

    for target, candidate in candidates.items():
        entries = sorted(internal_entries[target])
        operations = [operation for operation, _, _ in entries]
        need(len(set(operations)) == len(operations), 'DUPLICATE_INTERNAL_OPERATION', target)
        entry_name = 'SMA · Interner Einstieg'
        validate_name = 'SMA · Interne Operation prüfen'
        route_name = 'SMA · Interne Operation zuordnen'
        reject_name = 'SMA · Unbekannte Operation ablehnen'
        candidate['nodes'].append({'id': stable_id(target, entry_name), 'name': entry_name,
            'type': INTERNAL_TRIGGER, 'typeVersion': 1.1, 'position': [-1080, -800],
            'parameters': {'inputSource': 'passthrough'}})
        need(sum(node['type'] == INTERNAL_TRIGGER for node in candidate['nodes']) == 1,
             'N8N_INTERNAL_TRIGGER_LIMIT_EXCEEDED', target)
        candidate['nodes'].append(code_node(target, validate_name,
            runtime + '\nreturn consolidationValidate($input.all(), ' + json.dumps(operations) + ');', [-840, -800]))
        values = []
        for operation in operations:
            values.append({'conditions': {'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'strict', 'version': 3},
                'conditions': [{'id': stable_id(target, operation), 'leftValue': '={{ $json.operation }}',
                    'rightValue': operation, 'operator': {'type': 'string', 'operation': 'equals'}}], 'combinator': 'and'},
                'renameOutput': True, 'outputKey': operation})
        candidate['nodes'].append(code_node(target, reject_name, "throw Error('CONSOLIDATION_OPERATION_UNAVAILABLE');", [-360, -1100]))
        candidate['connections'][entry_name] = {'main': [[edge(validate_name)]]}
        if entries:
            candidate['nodes'].append({'id': stable_id(target, route_name), 'name': route_name,
                'type': 'n8n-nodes-base.switch', 'typeVersion': 3.4, 'position': [-600, -800],
                'parameters': {'rules': {'values': values}, 'options': {'fallbackOutput': 'extra'}}})
            candidate['connections'][validate_name] = {'main': [[edge(route_name)]]}
            candidate['connections'][route_name] = {'main': [[edge(name)] for _, name, _ in entries] + [[edge(reject_name)]]}
        else:
            candidate['connections'][validate_name] = {'main': [[edge(reject_name)]]}
        all_names = [node['name'] for node in candidate['nodes']]
        all_ids = [node['id'] for node in candidate['nodes']]
        need(len(set(all_names)) == len(all_names) and len(set(all_ids)) == len(all_ids), 'CANDIDATE_NODE_COLLISION', target)
        adjacency, reverse = graph(candidate)
        need(set(adjacency) | set(reverse) <= set(all_names), 'DANGLING_CANDIDATE_CONNECTION', target)
        external = [node['name'] for node in candidate['nodes'] if is_trigger(node) and node['type'] != INTERNAL_TRIGGER and not node.get('disabled')]
        original_entries = {names[(identity, node['name'])]
                            for identity, source in sources.items() for node in source['nodes']
                            if node['type'] == INTERNAL_TRIGGER and (identity, node['name']) in allocated
                            and allocated[(identity, node['name'])] == target}
        public_reached, public_gates = reachable_in_context(candidate, external, original_entries, set())
        need(not ({entry_name, validate_name, route_name} | original_entries) & public_reached,
             'PUBLIC_PATH_REACHES_DISPATCHER', target)
        provenance.setdefault('entry_gate_proofs', {})[target] = {'public': public_gates, 'internal': {}}
        for operation, name, source in entries:
            own_entries = {names[(source, node['name'])] for node in sources[source]['nodes']
                           if node['type'] == INTERNAL_TRIGGER and not node.get('disabled')}
            need(len(own_entries) == 1, 'ONE_NATIVE_ENTRY_PER_SOURCE_REQUIRED', source)
            reached, gates = reachable_in_context(candidate, [name], original_entries, own_entries)
            need(not (original_entries - own_entries) & reached, 'INTERNAL_ENTRIES_CROSS_GRAPH', source)
            provenance['entry_gate_proofs'][target]['internal'][operation] = gates
            need(not any(node['name'] in reached and node['type'] in (WEBHOOK, 'n8n-nodes-base.respondToWebhook', 'n8n-nodes-base.formTrigger', 'n8n-nodes-base.form')
                         for node in candidate['nodes']), 'INTERNAL_OPERATION_REACHES_HTTP_RESPONSE', name)

    # Parameter node references legitimately change, so compare public route and
    # callback identity fields separately from copied response expressions.
    def signatures(workflows, source_graph=False):
        result = []
        for identity, workflow in workflows.items():
            for node in workflow['nodes']:
                if node.get('disabled'):
                    continue
                if source_graph and (identity, node['name']) not in allocated:
                    continue
                if node['type'] == WEBHOOK:
                    p = node.get('parameters', {})
                    result.append(('webhook', p.get('httpMethod', 'GET'), p.get('path'), node.get('webhookId'),
                                   p.get('responseMode', 'onReceived'), p.get('authentication', 'none'),
                                   p.get('options', {}).get('rawBody', False)))
                elif node['type'] == 'n8n-nodes-base.formTrigger' and node.get('typeVersion') == 2.6:
                    result.append((node['type'], node['id'], node.get('webhookId'), form_entry_route(node),
                                   node.get('parameters', {}).get('authentication', 'none')))
                elif node['type'] in PROTECTED_IDS:
                    result.append((node['type'], node['id'], node.get('webhookId')))
        return sorted(result, key=repr)
    need(signatures(sources, source_graph=True) == signatures(candidates), 'EXTERNAL_ROUTE_OR_CALLBACK_ID_CHANGED')
    provenance['candidate_hashes'] = {identity: digest(candidate) for identity, candidate in sorted(candidates.items())}
    return candidates, provenance


def write_candidates(candidates, provenance, output):
    output = output.resolve()
    need(output == PRIVATE_OUTPUT or PRIVATE_OUTPUT in output.parents, 'PRIVATE_OUTPUT_PATH_REQUIRED')
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    output.chmod(0o700)
    files = {identity + '.json': value for identity, value in candidates.items()}
    files['build-provenance.json'] = provenance
    rendered = {name: json.dumps(value, ensure_ascii=False, indent=2) + '\n' for name, value in files.items()}
    for name, text in rendered.items():
        path = output / name
        need(not path.exists() or path.read_text() == text, 'EXISTING_CANDIDATE_DIFFERS', name)
    for name, text in rendered.items():
        path = output / name
        if path.exists():
            continue
        fd, temporary = tempfile.mkstemp(prefix='.build-', dir=output)
        try:
            with os.fdopen(fd, 'w') as handle:
                handle.write(text)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exports', type=Path, required=True)
    parser.add_argument('--plan', type=Path, default=ROOT / 'five-workflows.plan.json')
    parser.add_argument('--review', type=Path)
    parser.add_argument('--effective-exports', type=Path, help='Explicitly reviewed derived overlays; originals stay untouched')
    parser.add_argument('--overlay-manifest', type=Path, action='append', default=[], help='Private transform manifest with exact source/candidate byte hashes; repeat for distinct sources')
    parser.add_argument('--component-manifest', type=Path, action='append', default=[], help='Pinned additional graph within an existing target; never creates an extra workflow')
    parser.add_argument('--metadata-exports', type=Path, help='Full current metadata for staticData/active-version verification')
    parser.add_argument('--review-template', action='store_true', help='Print source pins and unresolved settings; no candidates')
    parser.add_argument('--output', type=Path, default=PRIVATE_OUTPUT)
    args = parser.parse_args()
    try:
        plan = json.loads(args.plan.read_text())
        sources = load_sources(args.exports, plan)
        components = {}
        for manifest in args.component_manifest:
            addition = load_component_manifest(manifest, plan)
            need(set(components).isdisjoint(addition), 'DUPLICATE_COMPONENT_GRAPH')
            components.update(addition)
        if args.review_template:
            print(json.dumps(review_template(plan, sources, components), ensure_ascii=False, indent=2))
            return
        need(args.review is not None, 'REVIEW_FILE_REQUIRED')
        review = json.loads(args.review.read_text())
        overlays = {}
        need(not (args.effective_exports and args.overlay_manifest), 'CHOOSE_ONE_OVERLAY_INPUT')
        for manifest in args.overlay_manifest:
            addition = load_overlay_manifest(manifest, args.exports, plan, sources)
            need(set(overlays).isdisjoint(addition), 'DUPLICATE_EFFECTIVE_SOURCE')
            overlays.update(addition)
        if args.effective_exports:
            for path in sorted(args.effective_exports.glob('*.json')):
                data = json.loads(path.read_text())
                need(isinstance(data, dict) and data.get('id') in sources, 'UNKNOWN_EFFECTIVE_SOURCE', path.name)
                need(data['id'] not in overlays, 'DUPLICATE_EFFECTIVE_SOURCE', data['id'])
                overlays[data['id']] = data
        metadata = {}
        if args.metadata_exports:
            for path in sorted(args.metadata_exports.glob('*.json')):
                data = json.loads(path.read_text())
                need(isinstance(data, dict) and data.get('id') in sources, 'UNKNOWN_METADATA_SOURCE', path.name)
                need(data['id'] not in metadata, 'DUPLICATE_METADATA_SOURCE', data['id'])
                metadata[data['id']] = data
        candidates, provenance = build(plan, sources, review, overlays, metadata, components)
        write_candidates(candidates, provenance, args.output)
        print(json.dumps({'candidate_count': len(candidates), 'active': False, 'output': str(args.output),
                          'candidate_hashes': provenance['candidate_hashes']}, indent=2))
    except (BuildError, OSError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)


if __name__ == '__main__':
    main()
