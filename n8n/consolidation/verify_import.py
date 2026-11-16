#!/usr/bin/env python3
"""Compare an n8n UI readback with a private candidate, without contacting n8n."""

import argparse
import copy
import json
from pathlib import Path
import re
import sys


def differences(expected, actual, location=''):
    """Return paths only: values may contain private credential or ticket data."""
    result = []
    if isinstance(expected, dict) and isinstance(actual, dict):
        for key in sorted(set(expected) | set(actual)):
            field = location + '.' + key if location else key
            if key not in expected or key not in actual:
                result.append(field)
            else:
                result.extend(differences(expected[key], actual[key], field))
    elif isinstance(expected, list) and isinstance(actual, list):
        if len(expected) != len(actual):
            result.append(location + '.length')
        for index, (left, right) in enumerate(zip(expected, actual)):
            result.extend(differences(left, right, location + '[' + str(index) + ']'))
    elif type(expected) is not type(actual) or expected != actual:
        result.append(location)
    return result


def normalized_nodes(nodes):
    if not isinstance(nodes, list) or not nodes:
        return None, ['nodes.required']
    names = [node.get('name') for node in nodes]
    ids = [node.get('id') for node in nodes]
    if any(not isinstance(name, str) for name in names) or len(set(names)) != len(names):
        return None, ['nodes.unique_names_required']
    if any(not isinstance(identity, str) for identity in ids) or len(set(ids)) != len(ids):
        return None, ['nodes.unique_ids_required']
    # The 2.47.7 UI regenerates node UUIDs during import. Node names, parameters,
    # credential references, callback IDs and execution/error flags stay strict.
    result = {node['name']: {key: copy.deepcopy(value) for key, value in node.items()
                            if key not in ('id', 'position')} for node in nodes}
    for node in result.values():
        # Code v2's documented 2.47.7 default is runOnceForAllItems. UI import
        # strips this explicit default; per-item mode is never normalized away.
        if node.get('type') == 'n8n-nodes-base.code' and node.get('typeVersion') == 2 \
                and node.get('parameters', {}).get('mode') == 'runOnceForAllItems':
            del node['parameters']['mode']
        # 2.47.7 ExecuteWorkflow.node.ts: source defaults to database (v1.3),
        # mode to once. Keep parameter-based workflows and per-item calls exact.
        if node.get('type') == 'n8n-nodes-base.executeWorkflow' and node.get('typeVersion') == 1.3:
            for field, default in (('source', 'database'), ('mode', 'once')):
                if node.get('parameters', {}).get(field) == default:
                    del node['parameters'][field]
        # Wait v1.1 uses Webhook/description.ts authenticationProperty(), whose
        # default is none. Any explicit auth method, false or null stays strict.
        if node.get('type') == 'n8n-nodes-base.wait' and node.get('typeVersion') == 1.1 \
                and node.get('parameters', {}).get('incomingAuthentication') == 'none':
            del node['parameters']['incomingAuthentication']
        # Set v3.4: SetV2.node.ts declares options default {} and execution uses
        # getNodeParameter('options', i, {}). Do not erase nonempty/invalid values.
        options = node.get('parameters', {}).get('options')
        if node.get('type') == 'n8n-nodes-base.set' and node.get('typeVersion') == 3.4 \
                and type(options) is dict and not options:
            del node['parameters']['options']
        # workflow-execute.ts continuesOnError only permits the two continue
        # modes or legacy continueOnFail=true. An absent Code-v2 onError stops
        # just as explicit stopWorkflow does; never erase a continue setting.
        if node.get('type') == 'n8n-nodes-base.code' and node.get('typeVersion') == 2 \
                and node.get('onError') == 'stopWorkflow' and node.get('continueOnFail') is not True:
            del node['onError']
    return result, []


def normalized_connections(connections):
    result = copy.deepcopy(connections)
    for name, outputs in list(result.items()):
        for channel, lanes in list(outputs.items()):
            # Omitted terminal connections and trailing empty output lanes have
            # no edge. Keep interior lane positions and every actual edge exact.
            while lanes and lanes[-1] == []:
                lanes.pop()
            if not lanes:
                del outputs[channel]
        if not outputs:
            del result[name]
    return result


def normalize_explicit_form_route_ids(expected_nodes, actual_nodes):
    """Compare Form Trigger 2.6 IDs only after proving an identical static route.

    Both dictionaries contain normalized copies. n8n 2.47.7 imports regenerate
    form-trigger webhookIds; GET and POST use path || options.path || webhookId.
    Never permit the generated ID to replace a formerly public implicit route.
    Authenticated forms and all Form/Wait callback IDs remain strict.
    """
    equivalences = []
    uuid_pattern = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    for name, expected in expected_nodes.items():
        actual = actual_nodes.get(name)
        if not actual or expected.get('webhookId') == actual.get('webhookId'):
            continue
        nodes = (expected, actual)
        if not all(node.get('type') == 'n8n-nodes-base.formTrigger' and node.get('typeVersion') == 2.6
                   and node.get('parameters', {}).get('authentication', 'none') == 'none'
                   and isinstance(node.get('webhookId'), str)
                   and re.fullmatch(uuid_pattern, node['webhookId']) for node in nodes):
            continue
        if not all(isinstance(node.get('parameters', {}).get('options', {}), dict) for node in nodes):
            continue
        routes = [node.get('parameters', {}).get('path')
                  or node.get('parameters', {}).get('options', {}).get('path') for node in nodes]
        if not isinstance(routes[0], str) or not re.fullmatch(r'[A-Za-z0-9_-]+', routes[0]) \
                or routes[0] != routes[1]:
            continue
        actual['webhookId'] = expected['webhookId']
        equivalences.append({'node': name, 'equivalence': 'regenerated_form_trigger_id_with_exact_explicit_route',
                             'verified_n8n_version': '2.47.7'})
    return equivalences


def normalized_settings(settings):
    result = copy.deepcopy(settings)
    # Exactly n8n 2.47.7: WorkflowSettings.vue defaults this field to true and
    # materializes it on Save. Runtime uses `redactCallerExecutions !== false`.
    # Missing and true preserve the same caller redaction; false/null/other
    # additions remain visible differences. No other setting is normalized.
    if result.get('redactCallerExecutions') is True:
        del result['redactCallerExecutions']
    return result


def verify(candidate, readback, published=False):
    problems = []
    if candidate.get('id') != readback.get('id'):
        problems.append('id')
    if candidate.get('name') != readback.get('name'):
        problems.append('name')
    actual_graph = readback
    if published:
        version = readback.get('activeVersionId')
        if readback.get('active') is not True or not version:
            problems.append('published.active_version_evidence_required')
        elif readback.get('versionId') == version:
            actual_graph = readback
        elif readback.get('activeVersion', {}).get('versionId') == version:
            actual_graph = readback['activeVersion']
        else:
            problems.append('published.active_graph_evidence_required')
    expected_nodes, errors = normalized_nodes(candidate.get('nodes'))
    problems.extend('candidate.' + error for error in errors)
    actual_nodes, errors = normalized_nodes(actual_graph.get('nodes'))
    problems.extend('readback.' + error for error in errors)
    form_route_equivalences = []
    if expected_nodes is not None and actual_nodes is not None:
        form_route_equivalences = normalize_explicit_form_route_ids(expected_nodes, actual_nodes)
        problems.extend(differences(expected_nodes, actual_nodes, 'nodes'))
    problems.extend(differences(normalized_connections(candidate.get('connections', {})),
                                normalized_connections(actual_graph.get('connections', {})), 'connections'))
    expected_settings, actual_settings = candidate.get('settings', {}), readback.get('settings', {})
    problems.extend(differences(normalized_settings(expected_settings), normalized_settings(actual_settings), 'settings'))
    if readback.get('pinData') or actual_graph.get('pinData'):
        problems.append('pinData.must_be_empty')
    if candidate.get('staticData'):
        if 'staticData' not in readback:
            problems.append('staticData.full_metadata_evidence_required')
        else:
            problems.extend(differences(candidate['staticData'], readback['staticData'], 'staticData'))
    elif readback.get('staticData'):
        problems.append('staticData.unexpected_nonempty_state')
    default_equivalences = []
    if ('redactCallerExecutions' not in expected_settings and actual_settings.get('redactCallerExecutions') is True) \
            or ('redactCallerExecutions' not in actual_settings and expected_settings.get('redactCallerExecutions') is True):
        default_equivalences.append({'setting': 'redactCallerExecutions', 'equivalence': 'absent_equals_true',
                                     'verified_n8n_version': '2.47.7'})
    return {'ok': not problems, 'scope': 'published_active_graph' if published else 'editor_graph_only',
            'workflow_id': candidate.get('id'), 'node_count': len(candidate.get('nodes', [])),
            'ignored_import_fields': ['node.id', 'node.position'],
            'verified_graph_normalizations': ['code_v2.default_all_items_mode', 'trailing_empty_connection_lanes',
                'execute_workflow_v1_3.default_database_source', 'execute_workflow_v1_3.default_once_mode',
                'wait_v1_1.default_no_incoming_authentication', 'code_v2.default_stop_on_error',
                'set_v3_4.default_empty_options'],
            'verified_default_equivalences': default_equivalences,
            'verified_form_route_equivalences': form_route_equivalences,
            'differences': sorted(set(problems)),
            'runtime_verified': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--readback', type=Path, required=True)
    parser.add_argument('--published', action='store_true', help='Require active-version metadata, not just the editable draft')
    args = parser.parse_args()
    result = verify(json.loads(args.candidate.read_text()), json.loads(args.readback.read_text()), args.published)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not result['ok']:
        raise SystemExit(2)


if __name__ == '__main__':
    main()
