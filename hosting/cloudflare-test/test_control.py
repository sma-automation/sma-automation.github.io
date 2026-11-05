import contextlib
import io
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import control


class ReleaseGuards(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.release = Path(os.environ["SMA_RELEASE_TEST_DIRECTORY"])

    def test_exact_package(self):
        control.validate_release(self.release)

    def test_extra_file_blocks_upload(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "release"
            shutil.copytree(self.release, root)
            (root / "functions.js").write_text("unapproved")
            with self.assertRaisesRegex(control.CheckError, "FILE_SET_MISMATCH"):
                control.validate_release(root)

    def test_modified_file_blocks_upload(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "release"
            shutil.copytree(self.release, root)
            (root / "index.html").write_text("unapproved")
            with self.assertRaisesRegex(control.CheckError, "HASH_MISMATCH"):
                control.validate_release(root)

    def test_directory_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "release"
            root.symlink_to(self.release.resolve(), target_is_directory=True)
            with self.assertRaisesRegex(control.CheckError, "DIRECTORY_INVALID"):
                control.main(["validate", str(root)])

    def test_no_deploy_without_approval_before_network(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(control.Api, "request") as request:
            with self.assertRaisesRegex(control.CheckError, "DEPLOYMENT_NOT_APPROVED"):
                control.main(["deploy", str(self.release)])
            request.assert_not_called()

    def test_preflight_reads_only(self):
        env = {"CLOUDFLARE_ACCOUNT_ID": "a" * 32, "CLOUDFLARE_API_TOKEN_READONLY": "test-token"}
        output = io.StringIO()
        with patch.dict(os.environ, env, clear=True), patch.object(control.Api, "request", side_effect=[{"status": "active"}, None]) as request, contextlib.redirect_stdout(output):
            control.main(["preflight", str(self.release)])
            self.assertEqual(len(request.call_args_list), 2)
            self.assertTrue(all(len(call.args) == 1 for call in request.call_args_list))
        self.assertIn("READY_FOR_APPROVAL", output.getvalue())
        self.assertNotIn("test-token", output.getvalue())

    def test_existing_project_blocks_mutation(self):
        env = {"CLOUDFLARE_ACCOUNT_ID": "a" * 32, "CLOUDFLARE_API_TOKEN_READONLY": "test-token", "SMA_CLOUDFLARE_RELEASE_APPROVAL": control.APPROVAL}
        with patch.dict(os.environ, env, clear=True), patch.object(control.Api, "request", side_effect=[{"status": "active"}, {"name": control.PROJECT}]) as request, patch.object(control.subprocess, "run") as run:
            with self.assertRaisesRegex(control.CheckError, "TARGET_ALREADY_EXISTS"):
                control.main(["deploy", str(self.release)])
            self.assertEqual(request.call_count, 2)
            run.assert_not_called()

    def test_api_rejects_other_resources_and_methods(self):
        api = control.Api("a" * 32, "test-token", allow_create=True)
        with patch.object(api.opener, "open") as network:
            for path, method in [("/zones", "GET"), (api.project, "DELETE"), (api.project, "PATCH"), ("https://example.invalid", "GET")]:
                with self.assertRaisesRegex(control.CheckError, "OPERATION_NOT_ALLOWED"):
                    api.request(path, method)
            with self.assertRaisesRegex(control.CheckError, "CONFIGURATION_NOT_ALLOWED"):
                api.request(api.collection, "POST", {"name": "other-project"})
            network.assert_not_called()

    def test_readonly_api_cannot_create(self):
        api = control.Api("a" * 32, "test-token")
        with self.assertRaisesRegex(control.CheckError, "OPERATION_NOT_ALLOWED"):
            api.request(api.collection, "POST", {"name": control.PROJECT, "production_branch": control.PRODUCTION_BRANCH})

    def test_copied_command_is_never_executed(self):
        with patch.object(control.subprocess, "run") as run:
            token = control.normalize_token('curl https://example.invalid -H "Authorization: Bearer test-token"; malicious-command')
            self.assertEqual(token, "test-token")
            run.assert_not_called()
        with self.assertRaisesRegex(control.CheckError, "TOKEN_AMBIGUOUS"):
            control.normalize_token("Authorization: Bearer token-one\nAuthorization: Bearer token-two")


if __name__ == "__main__":
    unittest.main()
