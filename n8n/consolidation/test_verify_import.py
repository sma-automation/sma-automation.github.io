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


if __name__ == '__main__':
    unittest.main()
