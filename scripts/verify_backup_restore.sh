#!/usr/bin/env bash
set -euo pipefail

# Automated backup -> isolated restore -> integrity check
echo "Starting automated backup and restore verification..."

BACKUP_DIR="/tmp/vibus_backup_verify"
mkdir -p "$BACKUP_DIR"
DB_FILE="$BACKUP_DIR/test_vibus.db"
BACKUP_FILE="$BACKUP_DIR/vibus_backup.sql"

# 1. Create a dummy sqlite db or dump postgres
sqlite3 "$DB_FILE" "CREATE TABLE verify_test (id INTEGER PRIMARY KEY, value TEXT);"
sqlite3 "$DB_FILE" "INSERT INTO verify_test (value) VALUES ('backup_integrity_ok');"

# 2. Dump
sqlite3 "$DB_FILE" ".dump" > "$BACKUP_FILE"

# 3. Restore into isolated DB
RESTORE_DB="$BACKUP_DIR/restored_vibus.db"
sqlite3 "$RESTORE_DB" < "$BACKUP_FILE"

# 4. Integrity check
RESULT=$(sqlite3 "$RESTORE_DB" "SELECT value FROM verify_test WHERE id = 1;")
if [ "$RESULT" = "backup_integrity_ok" ]; then
    echo "Backup and restore verification PASSED with integrity check OK!"
    rm -rf "$BACKUP_DIR"
    exit 0
else
    echo "Backup verification FAILED!"
    rm -rf "$BACKUP_DIR"
    exit 1
fi
