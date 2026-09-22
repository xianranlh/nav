#!/usr/bin/env python3
"""Export obs sync user 1 / vault 1 to nav's derived read-only Vault."""
import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import sqlite3
import tempfile
import shutil
import hashlib

BASE = Path(os.environ.get('NAV_OBS_EXPORT_DIR', '/root/nav-obs-sync'))
SOURCE = Path(os.environ.get('OBS_SYNC_STORAGE', '/root/fast-note-sync-service/storage'))
TARGET = BASE / 'vault'
STATE = BASE / 'state.json'


def destination(relative):
    p = PurePosixPath(relative)
    if not relative or p.is_absolute() or any(x in ('..', '.') or x.startswith('.') for x in p.parts):
        raise ValueError('Unsafe export path')
    result = TARGET.joinpath(*p.parts)
    if not result.resolve().is_relative_to(TARGET.resolve()):
        raise ValueError('Export path escapes vault')
    return result


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() == content:
        return
    fd, temporary = tempfile.mkstemp(prefix='.export-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(content)
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def rows(database, table):
    with sqlite3.connect(f'file:{SOURCE / "database" / database}?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        return db.execute(f'SELECT * FROM {table} WHERE vault_id=1').fetchall()


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').digest()


def main():
    BASE.mkdir(parents=True, exist_ok=True)
    TARGET.mkdir(parents=True, exist_ok=True)
    with (BASE / 'export.lock').open('w') as lock, tempfile.TemporaryDirectory(prefix='.staging-', dir=BASE) as staging:
        fcntl.flock(lock, fcntl.LOCK_EX)
        previous = set(json.loads(STATE.read_text())) if STATE.exists() else set()
        desired = {}
        for database, table, folder, prefix, filename in [
            ('db_user_1.sqlite3', 'note', 'note', 'n_', 'content.txt'),
            ('db_user_file_1.sqlite3', 'file', 'file', 'f_', 'file.dat'),
        ]:
            for row in rows(database, table):
                if row['action'] == 'delete':
                    continue
                relative = row['path']
                destination(relative)
                if relative in desired:
                    raise ValueError('Duplicate export path')
                source = SOURCE / 'vault/u_1' / folder / f'{prefix}{row["id"]}' / filename
                # Stage before publishing; memory stays bounded even with large attachments.
                staged = Path(staging) / str(len(desired))
                shutil.copyfile(source, staged)
                desired[relative] = staged
        changed = 0
        for relative, staged in desired.items():
            target = destination(relative)
            if target.exists() and target.stat().st_size == staged.stat().st_size and digest(target) == digest(staged):
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            os.chmod(staged, 0o644)
            os.replace(staged, target)
            changed += 1
        for relative in previous - desired.keys():
            destination(relative).unlink(missing_ok=True)
        atomic_write(STATE, json.dumps(sorted(desired), ensure_ascii=False).encode())
        print(json.dumps({'exported': len(desired), 'changed': changed, 'notes': sum(p.lower().endswith('.md') for p in desired)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
