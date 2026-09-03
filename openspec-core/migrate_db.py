import sqlite3
import glob
import os

for db_path in glob.glob('/var/www/vibeus/**/*.db', recursive=True) + glob.glob('./*.db'):
    try:
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        cur.execute("PRAGMA table_info(workspaces)")
        cols = [c[1] for c in cur.fetchall()]
        print(f"Found {db_path}, workspaces columns: {cols}")
        if cols:
            if 'is_lifetime_free' not in cols:
                cur.execute("ALTER TABLE workspaces ADD COLUMN is_lifetime_free BOOLEAN DEFAULT 0")
                print(f"-> Added is_lifetime_free to {db_path}")
            if 'promo_code_used' not in cols:
                cur.execute("ALTER TABLE workspaces ADD COLUMN promo_code_used VARCHAR DEFAULT NULL")
                print(f"-> Added promo_code_used to {db_path}")
            conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error checking {db_path}: {e}")
