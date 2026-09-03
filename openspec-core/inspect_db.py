import sqlite3

conn = sqlite3.connect('/var/www/vibeus/openspec-core/vibus.db')
tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
for (tname,) in tables:
    cols = [c[1] for c in conn.execute(f"PRAGMA table_info({tname})").fetchall()]
    print(f"Table '{tname}': {cols}")

print("\nAlembic version:")
try:
    print(conn.execute("SELECT * FROM alembic_version").fetchall())
except Exception as e:
    print(f"Error reading alembic_version: {e}")
