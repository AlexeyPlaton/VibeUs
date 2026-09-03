import os, sys, urllib.request, urllib.error

base = (os.getenv('VIBUS_STAGING_URL') or '').rstrip('/')
if not base:
    print('VIBUS_STAGING_URL is required, e.g. https://staging.vibeus.pro', file=sys.stderr)
    raise SystemExit(2)

checks = [
    ('/', None),
    ('/widget.js', ('javascript', 'text/plain', 'application/octet-stream')),
    ('/widget.css', ('text/css', 'text/plain', 'application/octet-stream')),
]
for path, expected_types in checks:
    url = base + path
    req = urllib.request.Request(url, headers={'User-Agent':'Vibus-QG-v3.3.2'})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            status = r.status
            ctype = (r.headers.get('Content-Type') or '').lower()
            body = r.read(2048)
    except Exception as e:
        raise SystemExit(f'FAIL {url}: {e}')
    if status != 200:
        raise SystemExit(f'FAIL {url}: HTTP {status}')
    if not body:
        raise SystemExit(f'FAIL {url}: empty body')
    if expected_types and not any(x in ctype for x in expected_types):
        raise SystemExit(f'FAIL {url}: unexpected content-type {ctype!r}')
    print(f'PASS {url} -> {status} {ctype}')
print('STAGING STATIC SMOKE PASS')
