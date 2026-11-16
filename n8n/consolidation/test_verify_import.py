import copy
import unittest

from verify_import import verify


class ImportReadbackContracts(unittest.TestCase):
    def setUp(self):
        self.candidate = {'id': 'existing', 'name': 'Synthetic', 'active': False,
            'settings': {'saveDataSuccessExecution': 'none'}, 'staticData': None,
            'nodes': [{'id': 'before', 'name': 'Wait', 'type': 'n8n-nodes-base.wait', 'typeVersion': 1.1,
                       'webhookId': 'unchanged-callback', 'position': [0, 0],
                       'parameters': {'resume': 'webhook', 'options': {'webhookSuffix': 'phase-1'}}}],
            'connections': {}}
        self.readback = copy.deepcopy(self.candidate)
        self.readback['nodes'][0]['id'] = 'ui-generated'
        self.readback['nodes'][0]['position'] = [500, 900]

    def test_observed_ui_uuid_regeneration_does_not_hide_callback_changes(self):
        self.assertTrue(verify(self.candidate, self.readback)['ok'])
        self.readback['nodes'][0]['webhookId'] = 'wrong'
        self.assertEqual(verify(self.candidate, self.readback)['differences'], ['nodes.Wait.webhookId'])

    def test_node_flags_credentials_and_unapplied_settings_are_not_ignored(self):
        self.readback['settings'] = {'saveDataSuccessExecution': 'all'}
        self.readback['nodes'][0]['credentials'] = {'synthetic': {'id': 'wrong'}}
        self.readback['nodes'][0]['onError'] = 'continueErrorOutput'
        result = verify(self.candidate, self.readback)
        self.assertEqual(result['differences'], ['nodes.Wait.credentials', 'nodes.Wait.onError', 'settings.saveDataSuccessExecution'])
        self.assertNotIn('wrong', str(result))

    def test_draft_match_cannot_claim_published_parity(self):
        self.assertFalse(verify(self.candidate, self.readback, published=True)['ok'])
        self.readback.update(active=True, versionId='draft', activeVersionId='published',
                             activeVersion={'versionId': 'published', 'nodes': copy.deepcopy(self.readback['nodes']), 'connections': {}})
        self.assertTrue(verify(self.candidate, self.readback, published=True)['ok'])
        self.readback['activeVersion']['nodes'][0]['parameters']['options']['webhookSuffix'] = 'old-phase'
        self.assertFalse(verify(self.candidate, self.readback, published=True)['ok'])
        self.assertTrue(verify(self.candidate, self.readback)['ok'])

    def test_schedule_state_requires_full_metadata_and_exact_preserved_value(self):
        self.candidate['staticData'] = {'node:Hourly': {'recurrenceRules': [None], 'recurrenceRuleSignatures': [None]}}
        del self.readback['staticData']
        self.assertEqual(verify(self.candidate, self.readback)['differences'], ['staticData.full_metadata_evidence_required'])
        self.readback['staticData'] = copy.deepcopy(self.candidate['staticData'])
        self.assertTrue(verify(self.candidate, self.readback)['ok'])

    def test_only_verified_true_caller_redaction_default_is_equivalent_to_absence(self):
        self.readback['settings']['redactCallerExecutions'] = True
        result = verify(self.candidate, self.readback)
        self.assertTrue(result['ok'])
        self.assertEqual(result['verified_default_equivalences'], [{
            'setting': 'redactCallerExecutions', 'equivalence': 'absent_equals_true',
            'verified_n8n_version': '2.47.7'}])
        for invalid in (False, None, 1, 'true'):
            self.readback['settings']['redactCallerExecutions'] = invalid
            self.assertEqual(verify(self.candidate, self.readback)['differences'], ['settings.redactCallerExecutions'])
        self.candidate['settings']['redactCallerExecutions'] = True
        del self.readback['settings']['redactCallerExecutions']
        self.assertTrue(verify(self.candidate, self.readback)['ok'])
        self.candidate['settings']['redactCallerExecutions'] = False
        self.assertFalse(verify(self.candidate, self.readback)['ok'])

    def test_code_v2_all_item_default_is_equal_to_omission_but_not_per_item(self):
        expected = self.candidate['nodes'][0]
        actual = self.readback['nodes'][0]
        for node in (expected, actual):
            node.update(type='n8n-nodes-base.code', typeVersion=2, parameters={'jsCode': 'return $input.all();'})
        expected['parameters']['mode'] = 'runOnceForAllItems'
        self.assertTrue(verify(self.candidate, self.readback)['ok'])
        actual['parameters']['mode'] = 'runOnceForEachItem'
        self.assertFalse(verify(self.candidate, self.readback)['ok'])

    def test_only_fixed_time_saved_mode_is_equivalent_to_absence(self):
        self.readback['settings']['timeSavedMode'] = 'fixed'
        result = verify(self.candidate, self.readback)
        self.assertTrue(result['ok'])
        self.assertEqual(result['verified_default_equivalences'], [{
            'setting': 'timeSavedMode', 'equivalence': 'absent_equals_fixed',
            'verified_n8n_version': '2.47.7'}])
        for invalid in ('dynamic', False, None, 0, 'FIXED', ''):
            self.readback['settings']['timeSavedMode'] = invalid
            self.assertEqual(verify(self.candidate, self.readback)['differences'], ['settings.timeSavedMode'])
        self.candidate['settings']['timeSavedMode'] = 'fixed'
        del self.readback['settings']['timeSavedMode']
        self.assertTrue(verify(self.candidate, self.readback)['ok'])
        self.candidate['settings']['timeSavedMode'] = 'dynamic'
        self.assertFalse(verify(self.candidate, self.readback)['ok'])
        self.candidate['settings']['timeSavedMode'] = 'fixed'
        self.readback['settings']['timeSavedPerExecution'] = 5
        self.assertEqual(verify(self.candidate, self.readback)['differences'], ['settings.timeSavedPerExecution'])

    def test_empty_terminal_lanes_are_normalized_without_reindexing_actual_edges(self):
        edge = {'node': 'Wait', 'type': 'main', 'index': 0}
        self.candidate['connections'] = {'Wait': {'main': [[], [edge], []]}, 'Empty': {'main': [[]]}}
        self.readback['connections'] = {'Wait': {'main': [[], [edge]]}}
        self.assertTrue(verify(self.candidate, self.readback)['ok'])
        self.readback['connections'] = {'Wait': {'main': [[edge]]}}
        self.assertFalse(verify(self.candidate, self.readback)['ok'])
        self.readback['connections'] = {}
        self.assertFalse(verify(self.candidate, self.readback)['ok'])

    def test_execute_workflow_v1_3_database_source_default_is_exact(self):
        expected = self.candidate['nodes'][0]
        actual = self.readback['nodes'][0]
        for node in (expected, actual):
            node.update(type='n8n-nodes-base.executeWorkflow', typeVersion=1.3,
                        parameters={'workflowId': {'value': 'existing-child'}})
        expected['parameters']['source'] = 'database'
        self.assertTrue(verify(self.candidate, self.readback)['ok'])
        for invalid in ('parameter', 'localFile', False, None):
            actual['parameters']['source'] = invalid
            self.assertEqual(verify(self.candidate, self.readback)['differences'], ['nodes.Wait.parameters.source'])
        del actual['parameters']['source']
        expected['typeVersion'] = actual['typeVersion'] = 1.2
        self.assertFalse(verify(self.candidate, self.readback)['ok'])

    def test_execute_workflow_v1_3_once_mode_does_not_hide_per_item_or_missing_nodes(self):
        expected = self.candidate['nodes'][0]
        actual = self.readback['nodes'][0]
        for node in (expected, actual):
            node.update(type='n8n-nodes-base.executeWorkflow', typeVersion=1.3,
                        parameters={'workflowId': {'value': 'existing-child'}})
        expected['parameters']['mode'] = 'once'
        self.assertTrue(verify(self.candidate, self.readback)['ok'])
        for invalid in ('each', False, None):
            actual['parameters']['mode'] = invalid
            self.assertEqual(verify(self.candidate, self.readback)['differences'], ['nodes.Wait.parameters.mode'])
        del actual['parameters']['mode']
        expected['parameters']['mode'] = 'each'
        self.assertFalse(verify(self.candidate, self.readback)['ok'])
        expected['parameters']['mode'] = 'once'
        self.readback['nodes'] = []
        self.assertFalse(verify(self.candidate, self.readback)['ok'])

    def test_wait_v1_1_no_authentication_default_does_not_hide_auth_changes(self):
        expected = self.candidate['nodes'][0]
        actual = self.readback['nodes'][0]
        expected['parameters']['incomingAuthentication'] = 'none'
        self.assertTrue(verify(self.candidate, self.readback)['ok'])
        for invalid in ('basicAuth', 'headerAuth', 'jwtAuth', False, None):
            actual['parameters']['incomingAuthentication'] = invalid
            self.assertEqual(verify(self.candidate, self.readback)['differences'], ['nodes.Wait.parameters.incomingAuthentication'])
        del actual['parameters']['incomingAuthentication']
        expected['parameters']['incomingAuthentication'] = 'headerAuth'
        self.assertFalse(verify(self.candidate, self.readback)['ok'])
        expected['parameters']['incomingAuthentication'] = 'none'
        expected['typeVersion'] = actual['typeVersion'] = 1
        self.assertFalse(verify(self.candidate, self.readback)['ok'])

    def test_code_v2_stop_on_error_default_keeps_continue_flags_strict(self):
        expected = self.candidate['nodes'][0]
        actual = self.readback['nodes'][0]
        for node in (expected, actual):
            node.update(type='n8n-nodes-base.code', typeVersion=2, parameters={'jsCode': 'throw Error("synthetic");'})
        expected['onError'] = 'stopWorkflow'
        self.assertTrue(verify(self.candidate, self.readback)['ok'])
        for invalid in ('continueRegularOutput', 'continueErrorOutput', False, None):
            actual['onError'] = invalid
            self.assertEqual(verify(self.candidate, self.readback)['differences'], ['nodes.Wait.onError'])
        del actual['onError']
        actual['continueOnFail'] = True
        self.assertFalse(verify(self.candidate, self.readback)['ok'])
        del actual['continueOnFail']
        expected['typeVersion'] = actual['typeVersion'] = 1
        self.assertFalse(verify(self.candidate, self.readback)['ok'])

    def test_set_v3_4_only_empty_options_object_is_equivalent_to_absence(self):
        expected = self.candidate['nodes'][0]
        actual = self.readback['nodes'][0]
        for node in (expected, actual):
            node.update(type='n8n-nodes-base.set', typeVersion=3.4,
                        parameters={'assignments': {'assignments': []}})
        actual['parameters']['options'] = {}
        self.assertTrue(verify(self.candidate, self.readback)['ok'])
        for invalid in (False, None, [], {'stripBinary': True}, {'ignoreConversionErrors': False}):
            actual['parameters']['options'] = invalid
            self.assertEqual(verify(self.candidate, self.readback)['differences'], ['nodes.Wait.parameters.options'])
        del actual['parameters']['options']
        expected['parameters']['options'] = {}
        self.assertTrue(verify(self.candidate, self.readback)['ok'])
        expected['typeVersion'] = actual['typeVersion'] = 3.3
        self.assertFalse(verify(self.candidate, self.readback)['ok'])

    def test_regenerated_form_trigger_id_requires_the_same_explicit_static_public_path(self):
        expected = self.candidate['nodes'][0]
        actual = self.readback['nodes'][0]
        for node in (expected, actual):
            node.update(type='n8n-nodes-base.formTrigger', typeVersion=2.6,
                        parameters={'options': {'path': 'original-form-route'}})
        expected['webhookId'] = '11111111-1111-4111-8111-111111111111'
        actual['webhookId'] = '22222222-2222-4222-8222-222222222222'
        result = verify(self.candidate, self.readback)
        self.assertTrue(result['ok'])
        self.assertEqual(len(result['verified_form_route_equivalences']), 1)
        for invalid in ('changed-route', '', None, False, '={{ $json.route }}'):
            actual['parameters']['options']['path'] = invalid
            self.assertFalse(verify(self.candidate, self.readback)['ok'])
        del actual['parameters']['options']['path']
        self.assertFalse(verify(self.candidate, self.readback)['ok'])
        del expected['parameters']['options']['path']
        self.assertFalse(verify(self.candidate, self.readback)['ok'])

    def test_form_identity_exception_never_applies_to_auth_callbacks_or_other_versions(self):
        expected = self.candidate['nodes'][0]
        actual = self.readback['nodes'][0]
        for node in (expected, actual):
            node.update(type='n8n-nodes-base.formTrigger', typeVersion=2.6,
                        parameters={'options': {'path': 'same-route'}})
        expected['webhookId'] = '11111111-1111-4111-8111-111111111111'
        actual['webhookId'] = '22222222-2222-4222-8222-222222222222'
        for auth in ('n8nUserAuth', 'basicAuth', False, None):
            for node in (expected, actual):
                node['parameters']['authentication'] = auth
            self.assertFalse(verify(self.candidate, self.readback)['ok'])
        for node in (expected, actual):
            del node['parameters']['authentication']
        for kind, version in [('n8n-nodes-base.form', 2.6), ('n8n-nodes-base.wait', 1.1),
                              ('n8n-nodes-base.formTrigger', 2.5)]:
            for node in (expected, actual):
                node['type'], node['typeVersion'] = kind, version
            self.assertFalse(verify(self.candidate, self.readback)['ok'])
        for node in (expected, actual):
            node['type'], node['typeVersion'] = 'n8n-nodes-base.formTrigger', 2.6
        for invalid in ('', 'not-an-id', None, False):
            actual['webhookId'] = invalid
            self.assertFalse(verify(self.candidate, self.readback)['ok'])


if __name__ == '__main__':
    unittest.main()
