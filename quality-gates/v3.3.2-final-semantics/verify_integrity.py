from pathlib import Path
import hashlib, sys
root = Path(__file__).resolve().parent
manifest = root/'MANIFEST.sha256'
if not manifest.exists():
    raise SystemExit('MANIFEST.sha256 missing')
errors=[]
for line in manifest.read_text(encoding='utf-8').splitlines():
    if not line.strip(): continue
    digest, rel = line.split('  ', 1)
    p=root/rel
    if not p.exists(): errors.append(f'MISSING {rel}'); continue
    actual=hashlib.sha256(p.read_bytes()).hexdigest()
    if actual != digest: errors.append(f'MODIFIED {rel}')
if errors:
    print('\n'.join(errors), file=sys.stderr)
    raise SystemExit(1)
print('Quality Gate integrity: PASS')
