#!/usr/bin/env python3
"""Read private n8n exports and report a five-workflow migration plan.

No network access, candidate generation, source modifications or imports into n8n.
Reports contain metadata and references, never code, credential values or execution data.
"""

import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

MAIN = "GHBsYQcyt0JLFvRP"
WEBHOOK = "n8n-nodes-base.webhook"
CALL = "n8n-nodes-base.executeWorkflow"
NODE_REFERENCE = re.compile(
    r"\$\(\s*['\"]([^'\"]+)['\"]\s*\)|"
    r"\$node\[\s*['\"]([^'\"]+)['\"]\s*\]|"
    r"\$items\(\s*['\"]([^'\"]+)['\"]"
)
SETTINGS = (
    "executionOrder", "binaryMode", "executionTimeout", "timezone",
    "saveDataErrorExecution", "saveDataSuccessExecution", "saveManualExecutions",
    "saveExecutionProgress", "callerPolicy", "errorWorkflow", "availableInMCP",
)


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from strings(child)


def is_trigger(node):
    kind = node["type"]
    return kind == WEBHOOK or kind.endswith(("Trigger", ".cron", ".interval"))


def graph(workflow):
    adjacency = defaultdict(set)
    reverse = defaultdict(set)
    for source, outputs in workflow.get("connections", {}).items():
        for lanes in outputs.values():
            for lane in lanes:
                for edge in lane:
                    adjacency[source].add(edge["node"])
                    reverse[edge["node"]].add(source)
    return adjacency, reverse


def reachable(starts, adjacency):
    visited = set()
    pending = list(starts)
    while pending:
        node = pending.pop()
        if node not in visited:
            visited.add(node)
            pending.extend(adjacency.get(node, ()))
    return visited


def workflow_target(node):
    value = node.get("parameters", {}).get("workflowId")
    if isinstance(value, dict):
        value = value.get("value")
    return value if isinstance(value, str) and not value.startswith("=") else None


def audit(plan, directory):
    errors = []
    targets = {entry["id"]: entry for entry in plan["targets"]}
    specifications = {entry["id"]: entry for entry in plan["sources"]}
    main_routes = {entry["node"]: entry for entry in plan["main_trigger_routes"]}
    if len(targets) != 5 or len(specifications) != len(plan["sources"]):
        raise ValueError("Plan must have five distinct targets and distinct source IDs")
    for entry in [*specifications.values(), *main_routes.values()]:
        if entry.get("target") is not None and entry["target"] not in targets:
            raise ValueError("Unknown target in plan")

    sources = {}
    for path in sorted(directory.glob("*.json")):
        data = json.loads(path.read_text())
        if not isinstance(data, dict) or data.get("id") not in specifications:
            continue
        identity = data["id"]
        if identity in sources:
            raise ValueError("Duplicate source export: " + identity)
        sources[identity] = (data, path)

    results = []
    calls = []
    endpoints = defaultdict(list)
    groups = {identity: {"id": identity, "role": entry["role"], "nodes": 0,
                         "sources": set(), "settings": defaultdict(dict),
                         "node_names": defaultdict(list), "node_ids": defaultdict(list)}
              for identity, entry in targets.items()}
    for identity, (data, path) in sources.items():
        counts = Counter(node["name"] for node in data["nodes"])
        duplicates = sorted(name for name, count in counts.items() if count > 1)
        if duplicates:
            errors.append({"source": identity, "duplicate_node_names": duplicates})
        nodes = {node["name"]: node for node in data["nodes"]}
        adjacency, reverse = graph(data)
        unknown_edges = sorted({name for name in [*adjacency, *reverse] if name not in nodes})
        if unknown_edges:
            errors.append({"source": identity, "unknown_connection_nodes": unknown_edges})
        roots = [node for node in data["nodes"] if is_trigger(node)]
        active_roots = [node for node in roots if not node.get("disabled", False)]
        active = reachable([node["name"] for node in active_roots], adjacency)
        any_root = reachable([node["name"] for node in roots], adjacency)
        assignments = defaultdict(set)
        if identity == MAIN:
            for node in roots:
                route = main_routes.get(node["name"])
                if route is None:
                    errors.append({"source": identity, "unmapped_trigger": node["name"]})
                    continue
                if route.get("disposition") == "archive_disabled":
                    if not node.get("disabled", False):
                        errors.append({"source": identity, "expected_disabled_trigger": node["name"]})
                    continue
                if not node.get("disabled", False):
                    for name in reachable([node["name"]], adjacency):
                        assignments[name].add(route["target"])
            for name in sorted(set(main_routes) - {node["name"] for node in roots}):
                errors.append({"source": identity, "planned_trigger_missing": name})
        else:
            for name in active:
                assignments[name].add(specifications[identity]["target"])
        for name, assigned in assignments.items():
            if len(assigned) != 1:
                errors.append({"source": identity, "node_shared_between_targets": name,
                               "targets": sorted(assigned)})
            for target in assigned:
                groups[target]["nodes"] += 1
                groups[target]["sources"].add(identity)
                groups[target]["node_names"][name].append(identity)
                if name in nodes and nodes[name].get("id"):
                    groups[target]["node_ids"][nodes[name]["id"]].append({"source": identity, "node": name})

        settings = {key: data.get("settings", {}).get(key, "<instance default>") for key in SETTINGS}
        for target in set().union(*assignments.values()) if assignments else ():
            for key, value in settings.items():
                groups[target]["settings"][key][identity] = value

        components = []
        unseen = set(nodes)
        weak = {name: adjacency[name] | reverse[name] for name in nodes}
        while unseen:
            part = reachable([min(unseen)], weak)
            unseen -= part
            components.append({"node_count": len(part),
                               "active_node_count": len(part & active),
                               "triggers": [node["name"] for node in roots if node["name"] in part]})
        components.sort(key=lambda item: (-item["node_count"], item["triggers"]))

        entrypoints = []
        for node in roots:
            parameters = node.get("parameters", {})
            route = main_routes.get(node["name"], {}) if identity == MAIN else specifications[identity]
            record = {"node": node["name"], "type": node["type"],
                      "disabled": bool(node.get("disabled", False)),
                      "target": route.get("target"), "operation": route.get("operation")}
            if node["type"] == WEBHOOK:
                record.update({"method": parameters.get("httpMethod", "GET"),
                               "path": parameters.get("path"),
                               "responseMode": parameters.get("responseMode", "onReceived"),
                               "rawBody": parameters.get("options", {}).get("rawBody", False)})
                if data.get("active") and not record["disabled"]:
                    endpoints[(str(record["method"]), str(record["path"]))].append(identity)
            for key in ("rule", "pollTimes"):
                if key in parameters:
                    record[key] = parameters[key]
            if node.get("webhookId"):
                record["webhookId"] = node["webhookId"]
            entrypoints.append(record)

        references = []
        special = []
        credentials = set()
        self_http = []
        for node in data["nodes"]:
            name = node["name"]
            parameters = node.get("parameters", {})
            texts = list(strings(parameters))
            used = {next(value for value in match.groups() if value)
                    for text in texts for match in NODE_REFERENCE.finditer(text)}
            for referenced in sorted(used):
                if referenced not in nodes or assignments.get(name, set()) != assignments.get(referenced, set()):
                    references.append({"node": name, "references": referenced,
                                       "reachable": name in active,
                                       "referenced_node_exists": referenced in nodes})
            identity_refs = sorted({term for text in texts for term in
                                    ("$workflow.id", "$workflow.name", "$execution.id",
                                     "$execution.resumeUrl", "$execution.resumeFormUrl", "getWorkflowStaticData")
                                    if term in text})
            if identity_refs or node["type"] in ("n8n-nodes-base.wait", "n8n-nodes-base.formTrigger", "n8n-nodes-base.form"):
                special.append({"node": name, "type": node["type"], "reachable": name in active,
                                "target": sorted(assignments.get(name, ())), "webhookId": node.get("webhookId"),
                                "identity_references": identity_refs,
                                "resume": parameters.get("resume"), "amount": parameters.get("amount"),
                                "unit": parameters.get("unit")})
            for kind, reference in node.get("credentials", {}).items():
                credentials.add((kind, reference.get("id"), reference.get("name")))
            if node["type"] == CALL:
                called = workflow_target(node)
                destination = specifications.get(called, {})
                callers = sorted(assignments.get(name, ()))
                calls.append({"source": identity, "node": name,
                              "reachable": name in active, "disabled": bool(node.get("disabled", False)),
                              "old_target": called, "caller_targets": callers,
                              "new_target": destination.get("target"), "operation": destination.get("operation"),
                              "same_target": destination.get("target") in callers,
                              "mode": parameters.get("mode", "once"),
                              "waitForSubWorkflow": parameters.get("options", {}).get("waitForSubWorkflow", True),
                              "onError": node.get("onError", "stopWorkflow")})
                if name in active and not node.get("disabled", False) and called not in specifications:
                    errors.append({"source": identity, "unresolved_internal_call": name, "old_target": called})
            if node["type"] == "n8n-nodes-base.httpRequest":
                url = parameters.get("url", "")
                if isinstance(url, str) and "johnmusic.app.n8n.cloud/webhook/" in url:
                    self_http.append({"node": name, "reachable": name in active,
                                      "path": url.split("/webhook/", 1)[1].split("?", 1)[0]})

        results.append({"id": identity, "name": data.get("name"), "source_file": path.name,
                        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                        "active": data.get("active"), "versionId": data.get("versionId"),
                        "activeVersionId": data.get("activeVersionId"),
                        "node_count": len(nodes), "active_reachable_nodes": len(active),
                        "disabled_trigger_only_nodes": len(any_root - active),
                        "unreachable_nodes": sorted(set(nodes) - any_root),
                        "components": components, "entrypoints": entrypoints,
                        "settings": settings, "credential_references": sorted(credentials, key=lambda item: tuple(str(value) for value in item)),
                        "special_nodes": special, "cross_target_or_missing_node_references": references,
                        "same_instance_http_calls": self_http,
                        "has_pin_data": bool(data.get("pinData"))})

    for (method, path), owners in endpoints.items():
        if len(owners) > 1:
            errors.append({"duplicate_active_webhook": {"method": method, "path": path}, "sources": owners})
    collisions = []
    for group in groups.values():
        group["sources"] = sorted(group["sources"])
        names = {name: owners for name, owners in group.pop("node_names").items() if len(owners) > 1}
        ids = {key: owners for key, owners in group.pop("node_ids").items() if len(owners) > 1}
        group["node_name_collision_count"] = len(names)
        group["node_id_collision_count"] = len(ids)
        if names or ids:
            collisions.append({"target": group["id"], "node_names": names, "node_ids": ids})
        group["settings_conflicts"] = {
            key: values for key, values in group.pop("settings").items()
            if len({json.dumps(value, sort_keys=True) for value in values.values()}) > 1
        }
    incoming = Counter(call["old_target"] for call in calls if call["reachable"] and not call["disabled"])
    missing = sorted(set(specifications) - set(sources))
    return {"status": "incomplete" if missing else "needs_review" if errors else "inventory_complete",
            "plan_only": True, "expected_sources": len(specifications), "available_sources": len(sources),
            "missing_sources": missing, "targets": list(groups.values()), "internal_calls": calls,
            "node_collisions": collisions,
            "sources_without_observed_internal_callers": sorted(set(sources) - set(incoming)),
            "workflows": results, "errors": errors,
            "limitations": [
                "No execution or billing estimates are inferred from node/workflow counts.",
                "No observed internal caller does not prove no external callers or archived/dynamic callers.",
                "Exported settings may inherit instance defaults; conflicts require an explicit decision.",
                "Only literal node/workflow references are resolved; dynamic references need review.",
                "Public webhook aliases, credentials, guards, item pairing and subworkflow return paths must be preserved.",
                "Do not disable old workflows until every live caller and webhook has been migrated and verified."
            ]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exports", type=Path, required=True, help="Private directory containing fresh workflow JSON exports")
    parser.add_argument("--plan", type=Path, default=Path(__file__).with_name("five-workflows.plan.json"))
    parser.add_argument("--allow-incomplete", action="store_true", help="Report missing exports without a failing exit status")
    parser.add_argument("--summary", action="store_true", help="Omit detailed workflow metadata")
    args = parser.parse_args()
    if not args.exports.is_dir():
        parser.error("--exports must be an existing directory")
    report = audit(json.loads(args.plan.read_text()), args.exports)
    failed = bool(report["errors"]) or (bool(report["missing_sources"]) and not args.allow_incomplete)
    if args.summary:
        report.pop("workflows")
        report.pop("node_collisions")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(2 if failed else 0)


if __name__ == "__main__":
    main()
