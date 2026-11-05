"""Verify the deployed static release with public GET requests only."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import time
import urllib.error
import urllib.request

BASE = "https://sma-customer-website-test.pages.dev"
MANIFEST = json.loads(Path(__file__).with_name("release-manifest.json").read_text())
HEADERS = {
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow",
    "X-Frame-Options": "DENY",
}


def check(path):
    try:
        request = urllib.request.Request(BASE + "/" + path, headers={"User-Agent": "SMA-Release-Verification/1.0"})
        with urllib.request.urlopen(request, timeout=20) as response:
            data = response.read(100000)
            if response.status != 200:
                return path, "HTTP_" + str(response.status)
            if hashlib.sha256(data).hexdigest() != MANIFEST[path]["sha256"]:
                return path, "HASH_MISMATCH"
            for key, value in HEADERS.items():
                if response.headers.get(key) != value:
                    return path, "HEADER_MISMATCH:" + key
            if "frame-ancestors 'none'" not in response.headers.get("Content-Security-Policy", ""):
                return path, "CSP_MISMATCH"
        return path, "OK"
    except urllib.error.HTTPError as error:
        return path, "HTTP_" + str(error.code)
    except (urllib.error.URLError, OSError):
        return path, "NETWORK_ERROR"


def main():
    paths = [path for path in MANIFEST if path != "_headers"]
    for attempt in range(4):
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = dict(pool.map(check, paths))
        if all(value == "OK" for value in results.values()):
            break
        if attempt < 3:
            time.sleep(5)
    failures = {path: value for path, value in results.items() if value != "OK"}
    if failures:
        print(json.dumps({"code": "PUBLIC_VERIFICATION_FAILED", "failures": failures}))
        raise SystemExit(1)
    request = urllib.request.Request(BASE + "/not-a-real-route", headers={"User-Agent": "SMA-Release-Verification/1.0"})
    try:
        urllib.request.urlopen(request, timeout=20)
        raise RuntimeError("MISSING_ROUTE_RETURNED_SUCCESS")
    except urllib.error.HTTPError as error:
        if error.code != 404 or hashlib.sha256(error.read()).hexdigest() != MANIFEST["404.html"]["sha256"]:
            raise RuntimeError("MISSING_ROUTE_MISMATCH") from None
    print(json.dumps({"code": "PUBLIC_RELEASE_VERIFIED", "url": BASE,
                      "public_files": len(paths), "hashes_match": True,
                      "security_headers_match": True, "unknown_route": 404}))


if __name__ == "__main__":
    main()
