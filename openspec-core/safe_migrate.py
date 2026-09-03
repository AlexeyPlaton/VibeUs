import sqlite3
import os

DB_PATH = '/var/www/vibeus/openspec-core/vibus.db'

def run_migration():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    def get_columns(table_name):
        try:
            return [c[1] for c in cur.execute(f"PRAGMA table_info({table_name})").fetchall()]
        except Exception:
            return []

    def add_col_if_missing(table, col, col_type, default=None):
        cols = get_columns(table)
        if cols and col not in cols:
            d = f" DEFAULT {default}" if default is not None else ""
            sql = f"ALTER TABLE {table} ADD COLUMN {col} {col_type}{d}"
            print(f"Adding column: {sql}")
            cur.execute(sql)
            conn.commit()

    print("--- Checking and migrating schema ---")

    # 1. users
    cur.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id VARCHAR NOT NULL PRIMARY KEY,
        email VARCHAR NOT NULL UNIQUE,
        hashed_password VARCHAR,
        is_active BOOLEAN DEFAULT 1,
        terms_version VARCHAR(32),
        terms_accepted_at DATETIME,
        privacy_version VARCHAR(32),
        privacy_acknowledged_at DATETIME,
        created_at DATETIME
    )
    """)
    add_col_if_missing('users', 'terms_version', 'VARCHAR(32)')
    add_col_if_missing('users', 'terms_accepted_at', 'DATETIME')
    add_col_if_missing('users', 'privacy_version', 'VARCHAR(32)')
    add_col_if_missing('users', 'privacy_acknowledged_at', 'DATETIME')

    # 2. sessions
    cur.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR NOT NULL PRIMARY KEY,
        user_id VARCHAR NOT NULL REFERENCES users(id),
        token VARCHAR NOT NULL UNIQUE,
        created_at DATETIME,
        expires_at DATETIME NOT NULL,
        revoked_at DATETIME
    )
    """)

    # 3. promo_codes
    cur.execute("""
    CREATE TABLE IF NOT EXISTS promo_codes (
        id VARCHAR NOT NULL PRIMARY KEY,
        code_digest VARCHAR NOT NULL UNIQUE,
        tier VARCHAR NOT NULL,
        duration_days INTEGER DEFAULT 30,
        grants_lifetime BOOLEAN DEFAULT 0,
        campaign VARCHAR(80),
        is_active BOOLEAN DEFAULT 1,
        max_uses INTEGER DEFAULT 1,
        times_used INTEGER DEFAULT 0,
        expires_at DATETIME,
        created_at DATETIME
    )
    """)
    add_col_if_missing('promo_codes', 'duration_days', 'INTEGER', '30')
    add_col_if_missing('promo_codes', 'grants_lifetime', 'BOOLEAN', '0')
    add_col_if_missing('promo_codes', 'campaign', 'VARCHAR(80)')

    # 4. workspaces
    add_col_if_missing('workspaces', 'api_key_digest', 'VARCHAR')
    add_col_if_missing('workspaces', 'yookassa_payment_method_id', 'VARCHAR(256)')
    add_col_if_missing('workspaces', 'subscription_status', 'VARCHAR', "'inactive'")
    add_col_if_missing('workspaces', 'current_period_start', 'DATETIME')
    add_col_if_missing('workspaces', 'current_period_end', 'DATETIME')
    add_col_if_missing('workspaces', 'cancel_at_period_end', 'BOOLEAN', '0')
    add_col_if_missing('workspaces', 'billing_provider', 'VARCHAR', "'free'")
    add_col_if_missing('workspaces', 'company_inn', 'VARCHAR')
    add_col_if_missing('workspaces', 'company_name', 'VARCHAR')
    add_col_if_missing('workspaces', 'is_lifetime_free', 'BOOLEAN', '0')
    add_col_if_missing('workspaces', 'promo_code_used', 'VARCHAR')
    add_col_if_missing('workspaces', 'payment_method_refused', 'BOOLEAN', '0')
    add_col_if_missing('workspaces', 'payment_method_refused_at', 'DATETIME')
    add_col_if_missing('workspaces', 'tickets_usage_period_start', 'DATETIME')

    # 5. workspace_memberships
    cur.execute("""
    CREATE TABLE IF NOT EXISTS workspace_memberships (
        id VARCHAR NOT NULL PRIMARY KEY,
        workspace_id VARCHAR NOT NULL REFERENCES workspaces(id),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        role VARCHAR NOT NULL DEFAULT 'member',
        created_at DATETIME
    )
    """)

    # Promo redemption ledger (for founding/trial campaigns).
    cur.execute("""
    CREATE TABLE IF NOT EXISTS promo_redemptions (
        id VARCHAR NOT NULL PRIMARY KEY,
        promo_code_id VARCHAR NOT NULL REFERENCES promo_codes(id),
        workspace_id VARCHAR NOT NULL REFERENCES workspaces(id),
        user_id VARCHAR REFERENCES users(id),
        campaign VARCHAR(80),
        tier VARCHAR NOT NULL,
        duration_days INTEGER,
        redeemed_at DATETIME NOT NULL,
        UNIQUE(promo_code_id, workspace_id),
        UNIQUE(promo_code_id, user_id)
    )
    """)

    # 6. projects
    cols = get_columns('projects')
    if 'api_token' in cols:
        print("Recreating projects table without api_token constraint...")
        cur.execute("""
        CREATE TABLE projects_new (
            id VARCHAR NOT NULL PRIMARY KEY,
            workspace_id VARCHAR REFERENCES workspaces(id),
            name VARCHAR NOT NULL,
            description TEXT DEFAULT '',
            api_token_digest VARCHAR UNIQUE,
            slug VARCHAR NOT NULL UNIQUE,
            columns JSON,
            custom_roles JSON,
            custom_boards JSON,
            group_chat JSON,
            subscribers JSON,
            feedbacks JSON,
            ticket_seq INTEGER DEFAULT 0,
            revision INTEGER DEFAULT 0,
            is_deleted BOOLEAN DEFAULT 0,
            telemetry_enabled BOOLEAN DEFAULT 0,
            ai_data_sharing BOOLEAN DEFAULT 0,
            public_widget_key_digest VARCHAR,
            public_widget_origins JSON,
            github_repo VARCHAR,
            github_token_encrypted TEXT,
            github_sync_enabled BOOLEAN DEFAULT 0,
            created_at DATETIME
        )
        """)
        existing_cols = [c for c in cols if c != 'api_token']
        col_list_str = ", ".join(existing_cols)
        cur.execute(f"INSERT INTO projects_new ({col_list_str}) SELECT {col_list_str} FROM projects")
        cur.execute("DROP TABLE projects")
        cur.execute("ALTER TABLE projects_new RENAME TO projects")
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_projects_slug ON projects(slug)")
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_projects_api_token_digest ON projects(api_token_digest)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_projects_public_widget_key_digest ON projects(public_widget_key_digest)")
        conn.commit()
        print("Projects table cleanly migrated!")
    else:
        add_col_if_missing('projects', 'api_token_digest', 'VARCHAR')
        add_col_if_missing('projects', 'custom_boards', 'JSON')
        add_col_if_missing('projects', 'ticket_seq', 'INTEGER', '0')
        add_col_if_missing('projects', 'revision', 'INTEGER', '0')
        add_col_if_missing('projects', 'is_deleted', 'BOOLEAN', '0')
        add_col_if_missing('projects', 'telemetry_enabled', 'BOOLEAN', '0')
        add_col_if_missing('projects', 'ai_data_sharing', 'BOOLEAN', '0')
        add_col_if_missing('projects', 'public_widget_key_digest', 'VARCHAR')
        add_col_if_missing('projects', 'public_widget_origins', 'JSON')
        add_col_if_missing('projects', 'github_repo', 'VARCHAR')
        add_col_if_missing('projects', 'github_token_encrypted', 'TEXT')
        add_col_if_missing('projects', 'github_sync_enabled', 'BOOLEAN', '0')

    # 7. project_access_links
    cur.execute("""
    CREATE TABLE IF NOT EXISTS project_access_links (
        id VARCHAR NOT NULL PRIMARY KEY,
        project_id VARCHAR NOT NULL REFERENCES projects(id),
        token_hash VARCHAR NOT NULL UNIQUE,
        label VARCHAR DEFAULT '',
        role VARCHAR DEFAULT 'reviewer',
        ttl VARCHAR DEFAULT '7d',
        single_use BOOLEAN DEFAULT 0,
        is_activated BOOLEAN DEFAULT 0,
        activated_fingerprint VARCHAR,
        activated_at DATETIME,
        expires_at DATETIME,
        created_at DATETIME
    )
    """)

    # 8. spec_tickets
    add_col_if_missing('spec_tickets', 'key', 'VARCHAR')
    add_col_if_missing('spec_tickets', 'github_issue_url', 'VARCHAR')
    add_col_if_missing('spec_tickets', 'github_issue_number', 'INTEGER')
    add_col_if_missing('spec_tickets', 'revision', 'INTEGER', '0')

    # 9. payments
    cur.execute("""
    CREATE TABLE IF NOT EXISTS payments (
        id VARCHAR NOT NULL PRIMARY KEY,
        provider VARCHAR NOT NULL DEFAULT 'yookassa',
        provider_payment_id VARCHAR NOT NULL UNIQUE,
        workspace_id VARCHAR NOT NULL REFERENCES workspaces(id),
        plan VARCHAR NOT NULL,
        amount_minor INTEGER NOT NULL,
        currency VARCHAR NOT NULL DEFAULT 'RUB',
        status VARCHAR NOT NULL DEFAULT 'pending',
        is_test BOOLEAN DEFAULT 0,
        entitlement_period_start DATETIME,
        entitlement_period_end DATETIME,
        processed_at DATETIME,
        created_at DATETIME
    )
    """)
    add_col_if_missing('payments', 'entitlement_period_start', 'DATETIME')
    add_col_if_missing('payments', 'entitlement_period_end', 'DATETIME')

    # 10. tunnel_sessions
    cur.execute("""
    CREATE TABLE IF NOT EXISTS tunnel_sessions (
        id VARCHAR NOT NULL PRIMARY KEY,
        tunnel_id VARCHAR NOT NULL UNIQUE,
        project_id VARCHAR NOT NULL REFERENCES projects(id),
        connect_token_digest VARCHAR NOT NULL,
        target_port INTEGER DEFAULT 5173,
        status VARCHAR DEFAULT 'active',
        is_connected BOOLEAN DEFAULT 0,
        expires_at DATETIME NOT NULL,
        created_at DATETIME
    )
    """)

    # 11. preview_sessions
    cur.execute("""
    CREATE TABLE IF NOT EXISTS preview_sessions (
        id VARCHAR NOT NULL PRIMARY KEY,
        session_digest VARCHAR NOT NULL UNIQUE,
        tunnel_id VARCHAR NOT NULL REFERENCES tunnel_sessions(tunnel_id),
        access_link_id VARCHAR NOT NULL REFERENCES project_access_links(id),
        created_at DATETIME,
        expires_at DATETIME NOT NULL,
        revoked_at DATETIME
    )
    """)

    # 12. audit_events
    cur.execute("""
    CREATE TABLE IF NOT EXISTS audit_events (
        id VARCHAR NOT NULL PRIMARY KEY,
        event_id VARCHAR(128) UNIQUE,
        workspace_id VARCHAR REFERENCES workspaces(id),
        project_id VARCHAR REFERENCES projects(id),
        user_id VARCHAR REFERENCES users(id),
        event_type VARCHAR NOT NULL,
        ip_address VARCHAR,
        details JSON,
        created_at DATETIME
    )
    """)
    add_col_if_missing('audit_events', 'event_id', 'VARCHAR(128)')

    # 13. feedbacks
    cur.execute("""
    CREATE TABLE IF NOT EXISTS feedbacks (
        id VARCHAR NOT NULL PRIMARY KEY,
        project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        idempotency_key VARCHAR(128),
        text TEXT NOT NULL,
        category VARCHAR(64) DEFAULT 'idea',
        status VARCHAR(32) DEFAULT 'new',
        converted_ticket_id VARCHAR,
        created_at DATETIME,
        details JSON,
        CONSTRAINT uq_feedbacks_project_idempotency UNIQUE (project_id, idempotency_key)
    )
    """)
    add_col_if_missing('feedbacks', 'converted_ticket_id', 'VARCHAR')

    # Update alembic_version to head
    cur.execute("CREATE TABLE IF NOT EXISTS alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)")
    cur.execute("DELETE FROM alembic_version")
    cur.execute("INSERT INTO alembic_version (version_num) VALUES ('e9f0a1b2c3d4')")
    conn.commit()
    conn.close()
    print("✅ Database schema is now fully up-to-date with Alembic revision 'e9f0a1b2c3d4'!")

if __name__ == '__main__':
    run_migration()
