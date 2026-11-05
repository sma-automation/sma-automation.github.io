"""Attach or inspect only the agreed test hostname; never modify DNS."""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

from control import CheckError, NoRedirect, PROJECT, PRODUCTION_BRANCH, normalize_token

DOMAIN = "test.sma-automation.com"
TARGET = "sma-customer-website-test.pages.dev"
STATES = {"initializing", "pending", "active", "deactivated", "blocked", "error"}


class DomainApi:
    def __init__(self, account, token, allow_attach=False):
        if not re.fullmatch(r"[0-9a-fA-F]{32}", account):
            raise CheckError("ACCOUNT_FORMAT_INVALID")
        self.project = "/accounts/" + account + "/pages/projects/" + PROJECT
        self.domains = self.project + "/domains"
        self.domain = self.domains + "/" + DOMAIN
        self.token = token
        self.allow_attach = allow_attach
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, path, method="GET", data=None, missing_ok=False):
        read = method == "GET" and data is None and path in {"/user/tokens/verify", self.project, self.domain}
        attach = self.allow_attach and method == "POST" and path == self.domains and data == {"name": DOMAIN}
        if not read and not attach:
            raise CheckError("OPERATION_NOT_ALLOWED")
        request = urllib.request.Request(
            "https://api.cloudflare.com/client/v4" + path,
            data=None if data is None else json.dumps(data).encode(), method=method,
            headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "SMA-Domain-Setup/1.0"})
        try:
            with self.opener.open(request, timeout=25) as response:
                raw = response.read(1048577)
            if len(raw) > 1048576:
                raise CheckError("API_RESPONSE_TOO_LARGE")
            body = json.loads(raw)
        except urllib.error.HTTPError as error:
            if error.code == 404 and missing_ok and read and path == self.domain:
                return None
            raise CheckError("API_HTTP_" + str(error.code)) from None
        except (urllib.error.URLError, OSError, ValueError):
            raise CheckError("API_RESPONSE_INVALID") from None
        if not isinstance(body, dict) or body.get("success") is not True:
            raise CheckError("API_REQUEST_REJECTED")
        return body.get("result")


def run(api, attach=False):
    token = api.request("/user/tokens/verify")
    if not isinstance(token, dict) or token.get("status") != "active":
        raise CheckError("TOKEN_NOT_ACTIVE")
    project = api.request(api.project)
    if not isinstance(project, dict) or project.get("name") != PROJECT or project.get("subdomain") != TARGET or project.get("production_branch") != PRODUCTION_BRANCH:
        raise CheckError("PROJECT_MISMATCH")
    deployment = project.get("canonical_deployment") or {}
    if deployment.get("latest_stage", {}).get("status") != "success" or project.get("uses_functions") is True:
        raise CheckError("DEPLOYED_STATIC_PROJECT_NOT_CONFIRMED")
    domain = api.request(api.domain, missing_ok=True)
    created = False
    if domain is None and attach:
        domain = api.request(api.domains, "POST", {"name": DOMAIN})
        created = True
    if domain is None:
        return {"code": "DOMAIN_NOT_ATTACHED", "domain": DOMAIN, "cname_target": TARGET}
    if not isinstance(domain, dict) or domain.get("name") != DOMAIN:
        raise CheckError("DOMAIN_RESULT_MISMATCH")
    def state(value):
        return value if value in STATES else "unknown"
    def diagnostic(section):
        value = (domain.get(section) or {}).get("error_message")
        return re.sub(r"[\r\n]", " ", value).replace(api.token, "[redacted]")[:500] if isinstance(value, str) else None
    method = (domain.get("validation_data") or {}).get("method")
    return {"code": "DOMAIN_ATTACHED" if created else "DOMAIN_STATUS", "domain": DOMAIN,
            "cname_target": TARGET, "status": state(domain.get("status")),
            "validation": state((domain.get("validation_data") or {}).get("status")),
            "verification": state((domain.get("verification_data") or {}).get("status")),
            "validation_method": method if method in {"http", "txt"} else "unknown",
            "validation_error": diagnostic("validation_data"),
            "verification_error": diagnostic("verification_data"),
            "dns_modified": False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["status", "attach"], default="status", nargs="?")
    args = parser.parse_args()
    api = DomainApi(os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip(),
                    normalize_token(os.environ.get("CLOUDFLARE_API_TOKEN_READONLY", "")),
                    allow_attach=args.mode == "attach")
    print(json.dumps(run(api, attach=args.mode == "attach"), sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except CheckError as error:
        print(json.dumps({"code": str(error)}))
        sys.exit(1)
