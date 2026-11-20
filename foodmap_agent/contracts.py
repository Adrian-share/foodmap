import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / 'docs/architecture/FACT-31/schemas.json').read_text())

def validate(name, value):
    schema = {'$defs': SCHEMA['$defs'], '$ref': '#/$defs/' + name}
    if not Draft202012Validator(schema, format_checker=FormatChecker()).is_valid(value):
        # Never echo untrusted content (which may include credentials).
        raise ValueError('invalid_' + name)
    return value

def watchlist(raw):
    if len(raw) > 512 * 1024:
        raise ValueError('watchlist_too_large')
    value = validate('watchlist', json.loads(raw.decode('utf-8')))
    uids = set()
    for source in value['sources']:
        uid = source['uid']
        if uid in uids or source['profile_url'] != 'https://space.bilibili.com/' + uid:
            raise ValueError('invalid_uid_profile')
        anchors=source.get('collection_anchors',[])
        ids=[a['season_id'] for a in anchors]
        if len(set(ids))!=len(ids) or any(sid not in source['season_ids'] for sid in ids):
            raise ValueError('invalid_collection_binding')
        uids.add(uid)
    if any(link['uid'] not in uids for link in value.get('video_links', [])):
        raise ValueError('unregistered_link_owner')
    return value
