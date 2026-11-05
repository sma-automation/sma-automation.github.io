"""One isolated Pages test release. Default mode is read-only preflight."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

PROJECT = "sma-customer-website-test"
SOURCE_SHA = "84cd5c37d7c7336c6adfe9a792776009f453fba3"
PRODUCTION_BRANCH = "test-release"
APPROVAL = "approved-2026-11-05-release1"


class CheckError(Exception):
    pass


def status(code, **fields):
    # Callers supply only fixed labels and verified public release metadata.
    print(json.dumps({"check": "cloudflare_test_release", "code": code, **fields}, sort_keys=True))


def normalize_token(raw):
    token = raw.strip()
    fenced = re.fullmatch(r"```(?:[A-Za-z0-9_-]+)?[ \t]*\r?\n([\s\S]*?)\r?\n```", token)
    if fenced:
        token = fenced.group(1).strip()
    if len(token) >= 2 and token[0] == token[-1] and token[0] in "\"'":
        token = token[1:-1].strip()
    value = r"[A-Za-z0-9._~+/\-]+=*"
    headers = re.findall(r"(?i)\bAuthorization[ \t]*:[ \t]*Bearer[ \t]+(" + value + r")(?=[\s\"'`\\]|$)", token)
    if headers:
        if len(set(headers)) != 1:
            raise CheckError("TOKEN_AMBIGUOUS")
        return headers[0]
    bare = re.fullmatch(r"(?:Bearer[ \t]+)?(" + value + r")", token, re.IGNORECASE)
    if not bare:
        raise CheckError("TOKEN_FORMAT_INVALID")
    return bare.group(1)


def validate_release(directory):
    expected = json.loads(Path(__file__).with_name("release-manifest.json").read_text())
    if directory.is_symlink() or not directory.is_dir():
        raise CheckError("RELEASE_DIRECTORY_INVALID")
    entries = list(directory.rglob("*"))
    if any(path.is_symlink() for path in entries):
        raise CheckError("RELEASE_SYMLINK")
    actual = {str(path.relative_to(directory)): path for path in entries if path.is_file()}
    if set(actual) != set(expected) or len(actual) != 17:
        raise CheckError("RELEASE_FILE_SET_MISMATCH")
    for name, path in actual.items():
        data = path.read_bytes()
        if len(data) != expected[name]["bytes"] or hashlib.sha256(data).hexdigest() != expected[name]["sha256"]:
            raise CheckError("RELEASE_HASH_MISMATCH")
    if sum(item["bytes"] for item in expected.values()) != 52105:
        raise CheckError("RELEASE_SIZE_MISMATCH")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Api:
    def __init__(self, account, token, allow_create=False):
        if not re.fullmatch(r"[0-9a-fA-F]{32}", account):
            raise CheckError("ACCOUNT_FORMAT_INVALID")
        self.account = account
        self.token = token
        self.allow_create = allow_create
        self.collection = "/accounts/" + account + "/pages/projects"
        self.project = self.collection + "/" + PROJECT
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, path, method="GET", data=None, allow_missing=False):
        permitted = method == "GET" and path in {"/user/tokens/verify", self.project}
        creating = self.allow_create and method == "POST" and path == self.collection
        if not permitted and not creating:
            raise CheckError("API_OPERATION_NOT_ALLOWED")
        if creating and data != {"name": PROJECT, "production_branch": PRODUCTION_BRANCH}:
            raise CheckError("PROJECT_CONFIGURATION_NOT_ALLOWED")
        request = urllib.request.Request(
            "https://api.cloudflare.com/client/v4" + path,
            data=None if data is None else json.dumps(data).encode(),
            headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json", "Accept": "application/json"},
            method=method,
        )
        try:
            with self.opener.open(request, timeout=25) as response:
                body = response.read(1048577)
            if len(body) > 1048576:
                raise CheckError("API_RESPONSE_TOO_LARGE")
            result = json.loads(body)
        except urllib.error.HTTPError as error:
            if error.code == 404 and allow_missing and method == "GET":
                return None
            raise CheckError("API_HTTP_" + str(int(error.code))) from None
        except (urllib.error.URLError, OSError, ValueError, UnicodeError):
            raise CheckError("API_RESPONSE_INVALID") from None
        if not isinstance(result, dict) or result.get("success") is not True:
            raise CheckError("API_REQUEST_REJECTED")
        return result.get("result")


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["validate", "preflight", "deploy"])
    parser.add_argument("directory", type=Path)
    parser.add_argument("--wrangler", type=Path)
    args = parser.parse_args(argv)
    validate_release(args.directory)
    directory = args.directory.resolve()
    if args.mode == "validate":
        status("PACKAGE_VERIFIED", files=17, bytes=52105, source=SOURCE_SHA)
        return
    if args.mode == "deploy" and os.environ.get("SMA_CLOUDFLARE_RELEASE_APPROVAL") != APPROVAL:
        raise CheckError("DEPLOYMENT_NOT_APPROVED")
    token = normalize_token(os.environ.get("CLOUDFLARE_API_TOKEN_READONLY", ""))
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
    api = Api(account, token, allow_create=args.mode == "deploy")
    verification = api.request("/user/tokens/verify")
    if not isinstance(verification, dict) or verification.get("status") != "active":
        raise CheckError("TOKEN_NOT_ACTIVE")
    existing = api.request(api.project, allow_missing=True)
    if existing is not None:
        # Never adopt, overwrite, delete, or retry into a pre-existing project.
        raise CheckError("TARGET_ALREADY_EXISTS")
    if args.mode == "preflight":
        status("READY_FOR_APPROVAL", project=PROJECT, files=17, bytes=52105)
        return
    if args.wrangler is None or not args.wrangler.is_file():
        raise CheckError("WRANGLER_NOT_AVAILABLE")
    created = api.request(api.collection, "POST", {"name": PROJECT, "production_branch": PRODUCTION_BRANCH})
    if not isinstance(created, dict) or created.get("name") != PROJECT or not created.get("id"):
        raise CheckError("PROJECT_CREATE_UNCONFIRMED")
    status("ISOLATED_PROJECT_CREATED", project=PROJECT)
    env = {key: value for key, value in os.environ.items() if not key.startswith("CLOUDFLARE_")}
    env.update({"CLOUDFLARE_API_TOKEN": token, "CLOUDFLARE_ACCOUNT_ID": account, "WRANGLER_SEND_METRICS": "false", "CI": "true"})
    # Run from the standalone output directory: no repository functions/config.
    try:
        completed = subprocess.run(
            [str(args.wrangler.resolve()), "pages", "deploy", str(directory), "--project-name", PROJECT,
             "--branch", PRODUCTION_BRANCH, "--commit-hash", SOURCE_SHA, "--commit-dirty=false", "--no-bundle"],
            cwd=directory, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=240,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise CheckError("UPLOAD_UNCONFIRMED_PROJECT_RETAINED") from None
    if completed.returncode:
        raise CheckError("UPLOAD_FAILED_PROJECT_RETAINED")
    for attempt in range(6):
        current = api.request(api.project)
        deployment = current.get("canonical_deployment") if isinstance(current, dict) else None
        if isinstance(deployment, dict) and deployment.get("latest_stage", {}).get("status") == "success":
            if current.get("uses_functions") is True or deployment.get("uses_functions") is True:
                raise CheckError("UNEXPECTED_FUNCTIONS")
            subdomain = current.get("subdomain", "")
            if not re.fullmatch(r"[a-z0-9][a-z0-9-]*\.pages\.dev", subdomain):
                raise CheckError("PUBLIC_HOST_UNCONFIRMED")
            status("TEST_PACKAGE_DEPLOYED", project=PROJECT, url="https://" + subdomain, files=17, bytes=52105)
            return
        if attempt < 5:
            time.sleep(5)
    raise CheckError("DEPLOYMENT_STATUS_PENDING_PROJECT_RETAINED")


if __name__ == "__main__":
    try:
        main()
    except CheckError as error:
        status(str(error))
        sys.exit(1)
