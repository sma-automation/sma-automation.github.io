"""Exercise the SMA webhook handoff in a fresh local n8n instance. No production endpoints."""

import http.cookiejar
import http.server
import json
import os
from pathlib import Path
import secrets
import signal
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "n8n/publishing"
CLI = os.environ.get("SMA_N8N_BIN") or shutil.which("n8n")
cases = [
    ("get", "checked", "completed", True),
    ("approve", "checked", "completed", True),
    ("get", "checked", "rpc-error", True),
    ("get", "prepared", "completed", False),
    ("prepare", "checked", "completed", False),
    ("get", "blocked", "completed", False),
    ("get", "checked", "provider-error", True),
    ("get", "checked", "running", True),
]
ids = {str(uuid.uuid4()): case for case in cases}
calls = []


class Stub(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        if self.path not in ("/order", "/provider", "/comparison"):
            calls.append((None, self.path, "unexpected"))
        key = data.get("p_id") or data.get("p_input", {}).get("id")
        status = 200
        if key not in ids:
            status, reply = 400, {"message": "unknown fixture"}
        else:
            action, state, scenario, _ = ids[key]
            calls.append((key, self.path, data.get("p_action")))
            if self.path == "/order" and data["p_action"] == action:
                reply = dict(id=key, state=state, ok=True, can_upload=False, can_publish=False)
            elif self.path == "/comparison" and data["p_action"] == "claim":
                status = 503 if scenario == "rpc-error" else 200
                reply = {
                    "ok": status == 200,
                    "state": "running" if scenario == "running" else "completed",
                }
            elif self.path == "/provider" and data == {"p_id": key, "p_action": "context"}:
                status = 503 if scenario == "provider-error" else 200
                reply = {"ok": False, "state": "blocked"}
            else:
                status, reply = 400, {"message": "unexpected call"}
        b = json.dumps(reply).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)


def test_graph(source, names=None):
    if names is None:
        names = {n["name"] for n in source["nodes"]}
    nodes = [n for n in source["nodes"] if n["name"] in names]
    assert len(nodes) == len(names), names - {n["name"] for n in nodes}
    edges = {
        a: {"main": [[e for e in out if e["node"] in names] for out in b["main"]]}
        for a, b in source["connections"].items()
        if a in names
    }
    return dict(
        name="SMA synthetic " + source["name"],
        nodes=nodes,
        connections=edges,
        settings={
            **source["settings"],
            "saveDataErrorExecution": "all",
            "saveDataSuccessExecution": "all",
        },
    )


def workflows(folder, stub):
    original = json.loads((SRC / "publication-order-api-workflow.json").read_text())
    compare = json.loads((SRC / "comparison-delivery-workflow.json").read_text())
    cover = folder / "provider.json"
    subprocess.run(
        [
            sys.executable,
            str(SRC / "patch-provider-cover.py"),
            "--input",
            str(ROOT / "tests/provider-cover-pr57-workflow.json"),
            "--output",
            str(cover),
        ],
        check=True,
    )
    provider = json.loads(cover.read_text())
    # Preserve all paths, including the request error output used for branch inference.
    main = test_graph(original)
    child = test_graph(
        compare,
        {
            "Auftragsabgleich starten",
            "Auftrag auswählen",
            "Abgleichauftrag übernehmen",
            "Abgleichauftrag übernommen?",
            "Abgleichstatus bereinigen",
        },
    )
    proof = test_graph(
        provider,
        {
            "Providerauftrag fortsetzen",
            "Providerauftrags-ID prüfen",
            "Providerauftrag lesen",
            "Providerstatus sicher zurückgeben",
        },
    )
    routes = {
        "Eigenen Auftrag bearbeiten": ("sma_publication_order_v1", "order"),
        "Abgleichauftrag übernehmen": ("sma_publication_comparison_delivery_v1", "comparison"),
        "Providerauftrag lesen": ("sma_publication_provider_cover_v1", "provider"),
    }
    for wf in [main, child, proof]:
        for n in wf["nodes"]:
            p = n["parameters"]
            if n["type"].endswith(".httpRequest"):
                if n["name"] not in routes:
                    n.pop("credentials", None)
                    n["parameters"] = {"method": "POST", "url": stub + "/unexpected"}
                    continue
                rpc, endpoint = routes[n["name"]]
                assert p["url"].endswith("/rpc/" + rpc)
                n.pop("credentials", None)
                for field in ["sendHeaders", "headerParameters", "authentication", "genericAuthType"]:
                    p.pop(field, None)
                p["url"] = stub + "/" + endpoint
            elif n["type"].endswith(".dataTable"):
                n.pop("credentials", None)
                p["dataTableId"] = {"__rl": True, "mode": "id", "value": "syntheticLocalTable"}
            elif n["type"].endswith(".webhook"):
                p["path"] = "sma-synthetic-handoff"
    return main, child, proof


def data_at(entry, *keys):
    # n8n stores execution data using flatted. Dereference only the requested path.
    pool = json.loads(entry)
    value = pool[0]
    for key in keys:
        value = value[key]
        if isinstance(value, str):
            value = pool[int(value)]
    return value


def run(folder):
    stub = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Stub)
    threading.Thread(target=stub.serve_forever, daemon=True).start()
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        broker = s.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    env = dict(
        HOME=str(folder),
        PATH=os.environ.get("PATH", os.defpath),
        N8N_USER_FOLDER=str(folder),
        N8N_LISTEN_ADDRESS="127.0.0.1",
        N8N_HOST="127.0.0.1",
        N8N_PORT=str(port),
        N8N_RUNNERS_BROKER_PORT=str(broker),
        N8N_DIAGNOSTICS_ENABLED="false",
        N8N_VERSION_NOTIFICATIONS_ENABLED="false",
        N8N_TEMPLATES_ENABLED="false",
        N8N_PERSONALIZATION_ENABLED="false",
        N8N_LICENSE_AUTO_RENEW_ENABLED="false",
        N8N_COMMUNITY_PACKAGES_ENABLED="false",
        NODE_FUNCTION_ALLOW_BUILTIN="crypto",
        N8N_SECURE_COOKIE="false",
        N8N_SSRF_PROTECTION_ENABLED="false",
        N8N_LOG_LEVEL="warn",
        N8N_WORKFLOW_PUBLICATION_OUTBOX_POLL_INTERVAL_MS="500",
        N8N_RUNNERS_AUTH_TOKEN=secrets.token_hex(20),
    )
    jar = http.cookiejar.CookieJar()
    client = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(jar)
    )

    def request(path, body=None, headers=None):
        req = urllib.request.Request(
            base + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={
                "Content-Type": "application/json",
                **({"Origin": base} if path.startswith("/rest/") else {}),
                **(headers or {}),
            },
        )
        try:
            with client.open(req, timeout=45) as res:
                return json.load(res)
        except urllib.error.HTTPError as err:
            raise RuntimeError((path, err.code, err.read()[:600])) from err

    main, child, proof = workflows(folder, f"http://127.0.0.1:{stub.server_port}")
    logfile = folder / "n8n.log"
    with logfile.open("w") as log:
        release = subprocess.check_output([CLI, "--version"], env=env, text=True).strip()
        if release != "2.47.5":
            raise RuntimeError(f"Expected n8n 2.47.5, got {release}")
        proc = subprocess.Popen([CLI, "start"], env=env, stdout=log, stderr=log, start_new_session=True)
        try:
            for _ in range(160):
                if proc.poll() is not None:
                    raise RuntimeError("n8n exited before serving")
                try:
                    if request("/healthz/readiness").get("status") == "ok":
                        break
                except (OSError, RuntimeError):
                    pass
                time.sleep(0.5)
            else:
                raise RuntimeError("n8n readiness timeout")
            request(
                "/rest/owner/setup",
                dict(
                    email="replay@example.invalid",
                    firstName="Synthetic",
                    lastName="Fixture",
                    password="Local1!" + secrets.token_hex(16),
                ),
            )

            def publish(w):
                created = request("/rest/workflows", w)["data"]
                request(
                    "/rest/workflows/" + created["id"] + "/activate", {"versionId": created["versionId"]}
                )
                return created["id"]

            childid, proofid = publish(child), publish(proof)
            for n in main["nodes"]:
                if n["type"].endswith(".executeWorkflow"):
                    n["parameters"]["workflowId"]["value"] = (
                        proofid if n["name"] == "Providerweg im Hintergrund" else childid
                    )
            mainid = publish(main)
            db = sqlite3.connect(folder / ".n8n/database.sqlite")
            sql = "SELECT e.id,e.workflowId,e.status,d.data FROM execution_entity e JOIN execution_data d ON e.id=d.executionId WHERE e.id>? ORDER BY e.id"
            for _ in range(100):
                paths = db.execute(
                    "SELECT webhookPath,method FROM webhook_entity WHERE workflowId=?", (mainid,)
                ).fetchall()
                if paths:
                    break
                time.sleep(0.15)
            assert len(paths) == 1 and paths[0][1] == "POST", paths
            webhook = "/webhook/" + paths[0][0]
            since = 0
            for key, (action, state, scenario, expected) in ids.items():
                response = request(
                    webhook,
                    {"action": action, "input": {"id": key}},
                    {"Authorization": "Bearer synthetic_token_for_local_test_0001"},
                )
                assert response == dict(
                    ok=True, id=key, state=state, can_upload=False, can_publish=False
                ), (action, state, response)
                for _ in range(180):
                    rows = db.execute(sql, (since,)).fetchall()
                    if any(r[1] == mainid and r[2] in ("success", "error", "crashed") for r in rows):
                        break
                    time.sleep(0.15)
                else:
                    raise RuntimeError("handoff completion timeout")
                ids_seen = {r[1] for r in rows}
                assert ids_seen == ({mainid, childid, proofid} if expected else {mainid, childid}), (
                    action,
                    state,
                    ids_seen,
                )
                assert len(rows) == len(ids_seen), "Unexpected duplicate execution"
                traces = {r[1]: data_at(r[3], "resultData", "runData") for r in rows}
                mainTrace = traces[mainid]
                verdict = next(r[2] for r in rows if r[1] == mainid)
                assert verdict == "success" and "Unveränderte Auftragsantwort" in mainTrace, (
                    verdict,
                    list(mainTrace),
                )
                parent_data = next(r[3] for r in rows if r[1] == mainid)
                gate_outputs = (
                    "resultData",
                    "runData",
                    "Geprüften Providerauftrag fortsetzen?",
                    0,
                    "data",
                    "main",
                )
                assert data_at(parent_data, *gate_outputs, 0 if expected else 1, 0, "json", "id") == key
                assert ("Auftragsantwort nach Providerstart" in mainTrace) == expected
                assert all(r[2] == "success" for r in rows), [(r[1], r[2]) for r in rows]
                if expected:
                    assert {
                        "Providerauftrag fortsetzen",
                        "Providerauftrags-ID prüfen",
                        "Providerauftrag lesen",
                    } <= traces[proofid].keys()
                seq = [(path, act) for k, path, act in calls if k == key]
                assert seq == [("/order", action), ("/comparison", "claim")] + (
                    [("/provider", "context")] if expected else []
                ), seq
                print(
                    f"{action:7} {state:8} {scenario:14} context={int(expected)} webhook=200 main=success",
                    flush=True,
                )
                since = max(x[0] for x in rows)
            assert all(k in ids for k, _, _ in calls), "Unexpected HTTP node executed"
            db.close()
        except Exception:
            print(logfile.read_text()[-5000:], file=sys.stderr)
            raise
        finally:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
            stub.shutdown()


if __name__ == "__main__":
    if not CLI:
        sys.exit("Install the pinned n8n CLI or set SMA_N8N_BIN to its executable.")
    with tempfile.TemporaryDirectory(prefix="sma-n8n-replay-") as folder:
        run(Path(folder))
