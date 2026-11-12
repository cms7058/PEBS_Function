"""Idempotently add the books and articles from the previously agreed ten-layer reading list.

This imports bibliographic records only. No remote PDF is downloaded. Existing NIST
PDF, page index and Skills remain associated with the existing book record.
"""
import hashlib
import json
import os
import pathlib
import time

root = pathlib.Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'scripts/ten_layer_books.json').read_text())
path = root / 'data/catalog/catalog.json'
db = json.loads(path.read_text())
by_title = {book['title'].casefold(): book for book in db['books']}
added = 0
for entry in manifest:
    title = entry['title']
    existing = by_title.get(title.casefold())
    if existing:
        existing.update({k: entry[k] for k in ('stages', 'access', 'source_url')})
        continue
    book_id = 'b' + str(int.from_bytes(hashlib.sha256(title.encode()).digest()[:12], 'big'))
    if any(book['id'] == book_id for book in db['books']):
        raise RuntimeError(f'ID collision for {title}')
    db['books'].append({
        'id': book_id, 'title': title, 'uploaded_at': None,
        'created_at': int(time.time()), 'pages': 0, 'processed': False,
        'indexed': False, 'stages': entry['stages'],
        'access': entry['access'], 'source_url': entry['source_url'],
    })
    by_title[title.casefold()] = db['books'][-1]
    added += 1
backup = path.with_suffix('.before-ten-layer-import.json')
if not backup.exists():
    backup.write_bytes(path.read_bytes())
tmp = path.with_suffix('.tmp')
tmp.write_text(json.dumps(db, ensure_ascii=False, indent=2) + '\n')
os.replace(tmp, path)
print(f'Added {added} records; total books: {len(db["books"])}; PDF files downloaded: 0')
