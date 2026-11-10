"""Offline, fail-closed TikTok AIGC release gate.

Never contacts n8n, Supabase, Google Drive or TikTok. Never modifies
an installed workflow. --installed-export must be an operator-exported JSON
of the existing 47-node provider/cover copy, inspected only on the local
machine; never commit a private workflow export to the public repository.
"""
import argparse
import copy
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
BASELINE = ROOT / "tests/provider-cover-pr57-workflow.json"
INSTALLED_WORKFLOW_ID = "JaidX5YeKl6ZTqjQ"
INSTALLED_WORKFLOW_NAME = "SMA – Auftrag – Provider und Cover V1"
EXPECTED_SQL = HERE.parents[1] / "supabase/sql/publication-tiktok-aigc.sql"
MIGRATION = HERE.parents[1] / "supabase/migrations/20261110110100_publication_tiktok_aigc_v1.sql"
NEW_KEYS = "['visibility','disable_comment','disable_duet','disable_stitch','brand_content_toggle','brand_organic_toggle','is_aigc']"
OLD_KEYS = "['visibility','disable_comment','disable_duet','disable_stitch','brand_content_toggle','brand_organic_toggle']"
NEW_BODY = "brand_organic_toggle:choices.brand_organic_toggle,is_aigc:choices.is_aigc}"
OLD_BODY = "brand_organic_toggle:choices.brand_organic_toggle}"
REQUIRED_SETTINGS = {
    "executionOrder": "v1",
    "saveDataErrorExecution": "none",
    "saveDataSuccessExecution": "none",
    "saveManualExecutions": False,
    "saveExecutionProgress": False,
    "executionTimeout": 600,
    "callerPolicy": "workflowsFromSameOwner",
    "availableInMCP": False,
}


class GateError(Exception):
    """Redacted gate error: no workflow values, tokens or customer data."""


def read_json(path):
    path = Path(path)
    if not path.is_file() or path.stat().st_size > 6_000_000:
        raise GateError("EXPORT_MISSING_OR_TOO_LARGE")
    try:
        content = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeError, ValueError, OSError):
        raise GateError("INVALID_EXPORT_JSON") from None
    if not isinstance(content, dict):
        raise GateError("INVALID_EXPORT_STRUCTURE")
    return content


def load_patcher():
    spec = importlib.util.spec_from_file_location("sma_aigc_cover_patcher", HERE / "patch-provider-cover.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verify_release_sources():
    if EXPECTED_SQL.read_bytes() != MIGRATION.read_bytes():
        raise GateError("SQL_MIGRATION_MISMATCH")
    sql = EXPECTED_SQL.read_text(encoding="utf-8")
    for required in (
        "ce9dc4edbe66a00ce89924c1a91b49d1",
        "TIKTOK_AIGC_ORDER_BASELINE_CHANGED",
        "TIKTOK_AIGC_LEGACY_ACTIVE_ORDER",
    ):
        if required not in sql:
            raise GateError("SQL_RELEASE_GUARD_MISSING")


def verify_nodes(workflow):
    nodes = workflow.get("nodes")
    if not isinstance(nodes, list) or len(nodes) != 47:
        raise GateError("WORKFLOW_NODE_COUNT_CHANGED")
    names = [node.get("name") for node in nodes if isinstance(node, dict)]
    if len(names) != 47 or len(set(names)) != 47 or any(not isinstance(name, str) for name in names):
        raise GateError("WORKFLOW_NODE_IDENTITY_CHANGED")
    if any(
        "webhook" in node.get("type", "").lower()
        or "scheduletrigger" in node.get("type", "").lower()
        or "manualtrigger" in node.get("type", "").lower()
        or node.get("retryOnFail") is True
        for node in nodes
    ):
        raise GateError("WORKFLOW_TRIGGER_OR_RETRY_CHANGED")
    if workflow.get("pinData") not in ({}, None):
        raise GateError("PINNED_EXECUTION_DATA_PRESENT")
    settings = workflow.get("settings")
    if not isinstance(settings, dict) or any(settings.get(k) != v for k, v in REQUIRED_SETTINGS.items()):
        raise GateError("WORKFLOW_SETTINGS_CHANGED")
    if set(settings) - set(REQUIRED_SETTINGS) - {"binaryMode", "timeSavedMode"}:
        raise GateError("UNKNOWN_WORKFLOW_SETTINGS")
    # A checksum must be in the upload path, not just present on the canvas.
    # The complete parity check below still rejects every other graph drift.
    sha_node = next((n for n in nodes if n["name"] == "Provider-Dateiprüfsumme bestätigen"), None)
    if sha_node is None or sha_node.get("type") != "n8n-nodes-base.code":
        raise GateError("CRITICAL_CHECKSUM_NODE_MISSING")
    connections = workflow.get("connections")
    if not isinstance(connections, dict):
        raise GateError("CRITICAL_CHECKSUM_ROUTE_CHANGED")
    for source, dest in (
        ("Provider-Videodatei lesen", "Provider-Dateiprüfsumme bestätigen"),
        ("Provider-Dateiprüfsumme bestätigen", "Provider-Dateistand rückprüfen"),
        ("Provider-Dateistand rückprüfen", "Provider-Prüfnachweise verbinden"),
    ):
        flow = connections.get(source, {})
        branches = flow.get("main", []) if isinstance(flow, dict) else []
        destinations = [
            edge.get("node")
            for branch in branches if isinstance(branch, list)
            for edge in branch if isinstance(edge, dict)
        ]
        if dest not in destinations:
            raise GateError("CRITICAL_CHECKSUM_ROUTE_CHANGED")
    return nodes


def legacy_from_candidate(candidate):
    old = copy.deepcopy(candidate)
    changes = 0
    for node in verify_nodes(old):
        js = node.get("parameters", {}).get("jsCode", "")
        if "function providerUploadPlan(" not in js:
            continue
        if not isinstance(js, str) or js.count(NEW_KEYS) != 1 or js.count(NEW_BODY) != 1:
            raise GateError("AIGC_NODE_PATCH_UNEXPECTED")
        node["parameters"]["jsCode"] = js.replace(NEW_KEYS, OLD_KEYS).replace(NEW_BODY, OLD_BODY)
        changes += 1
    if changes != 4:
        raise GateError("AIGC_NODE_PATCH_COUNT_CHANGED")
    return old


def verify_installed(installed, original, patcher):
    # A copied, draft, inactive or unrelated workflow is not the actual
    # published provider/cover entry; content parity alone cannot establish it.
    if installed.get("id") != INSTALLED_WORKFLOW_ID:
        raise GateError("INSTALLED_WORKFLOW_ID_UNVERIFIED")
    if installed.get("name") != INSTALLED_WORKFLOW_NAME:
        raise GateError("INSTALLED_WORKFLOW_NAME_CHANGED")
    if installed.get("active") is not True:
        raise GateError("INSTALLED_WORKFLOW_INACTIVE")
    # Since n8n 2.0, a Published workflow can have a newer saved draft.
    # An active badge alone DOES NOT prove that exported nodes are the
    # version executing in production. Both version IDs are mandatory;
    # reject ambiguous metadata rather than approving the wrong graph.
    saved_version = installed.get("versionId")
    published_version = installed.get("activeVersionId")
    if not isinstance(saved_version, str) or not isinstance(published_version, str) or not saved_version or not published_version:
        raise GateError("PUBLISHED_VERSION_UNVERIFIED")
    if saved_version != published_version:
        raise GateError("SAVED_DRAFT_DIFFERS_FROM_PUBLISHED")
    # Compare the existing installed copy with what the original, pre-AIGC
    # 47-node copy must look like. Only known n8n export defaults are ignored.
    current_nodes = verify_nodes(installed)
    legacy_nodes = verify_nodes(original)
    before = {n["name"]: n for n in legacy_nodes}
    if set(n["name"] for n in current_nodes) != set(before):
        raise GateError("INSTALLED_NODE_SET_DRIFT")
    for node in current_nodes:
        if patcher.digest(patcher.normalized(node)) != patcher.digest(patcher.normalized(before[node["name"]])):
            raise GateError("INSTALLED_NODE_DRIFT")
    if not isinstance(installed.get("connections"), dict) or patcher.digest(installed["connections"]) != patcher.digest(original["connections"]):
        raise GateError("INSTALLED_EDGES_DRIFT")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Verify AIGC rollout sources and an existing 47-node n8n export, without deployment.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--source-only", action="store_true", help="Validate pinned source without claiming the installed workflow is ready")
    group.add_argument("--installed-export", type=Path, help="Read a private export locally; never commit it")
    args = parser.parse_args(argv)
    try:
        verify_release_sources()
        patcher = load_patcher()
        candidate = patcher.patch(read_json(BASELINE))
        verify_nodes(candidate)
        if candidate.get("active") is not False:
            raise GateError("CANDIDATE_NOT_INERT")
        legacy = legacy_from_candidate(candidate)
        if args.source_only:
            print("SOURCE_PREFLIGHT_OK; LIVE_EXPORT_NOT_VERIFIED; NO_DEPLOYMENT")
            return 0
        installed = read_json(args.installed_export)
        verify_installed(installed, legacy, patcher)
        print("INSTALLED_BASELINE_MATCH; AIGC_CANDIDATE_SOURCE_READY; NO_DEPLOYMENT")
        return 0
    except (GateError, ValueError, KeyError, TypeError, OSError) as exc:
        # The patcher may reveal source-only error labels; never echo raw workflow JSON.
        label = str(exc)
        if not isinstance(exc, GateError) and label not in {
            "PROVIDER_BASELINE_CHANGED", "PROVIDER_SETTINGS_CHANGED",
            "UNKNOWN_WORKFLOW_SETTING", "PIN_DATA_NOT_ALLOWED",
            "TIKTOK_AIGC_PROVIDER_BASELINE_CHANGED", "TIKTOK_AIGC_NODE_COUNT_CHANGED",
            "PROVIDER_ADAPTER_CHANGED",
        }:
            label = "SOURCE_PREFLIGHT_FAILED"
        print("AIGC_ROLLOUT_BLOCKED: " + label, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
