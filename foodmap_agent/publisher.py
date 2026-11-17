"""Stable, write-ahead operations over the existing fixed SSH transport."""
import base64
import hashlib
import json
import uuid

CHUNK = 524288

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()

class Publisher:
    def __init__(self, store, operator):
        self.store, self.operator = store, operator

    def operation(self, name, **fields):
        body = dict(schema_version=1, operation=name, **fields)
        body['request_id'] = str(uuid.uuid5(uuid.NAMESPACE_URL, hashlib.sha256(canonical(body)).hexdigest()))
        return json.loads(canonical(body))

    def send(self, body):
        # Preserve exact key order/bytes across crash recovery and different Python runs.
        body = json.loads(canonical(body))
        previous = next((r for r in self.store.receipts() if r['request_id'] == body['request_id']), None)
        if previous:
            if previous['body'] != json.dumps(body, sort_keys=True, separators=(',', ':')):
                raise ValueError('idempotency_conflict')
            if previous['status'] in ('committed', 'complete'):
                return json.loads(previous['receipt'])
            receipt = self.operator(dict(schema_version=1, operation='receipt.get', request_id=str(uuid.uuid4()), target_request_id=body['request_id']))
            if receipt['status'] in ('committed', 'complete'):
                self.store.finish_receipt(body['request_id'], receipt)
                return receipt
        self.store.prepare(body['request_id'], body)
        receipt = self.operator(body)
        if receipt.get('request_id') != body['request_id'] or receipt.get('status') not in ('complete', 'committed', 'prepared'):
            raise RuntimeError('invalid_operation_receipt')
        self.store.finish_receipt(body['request_id'], receipt)
        return receipt

    def blob(self, kind, data, mime):
        digest = hashlib.sha256(data).hexdigest()
        count = (len(data) + CHUNK - 1) // CHUNK
        if not 1 <= count <= 32:
            raise ValueError('blob_too_large')
        complete = False
        for index in range(count):
            chunk = data[index * CHUNK:(index + 1) * CHUNK]
            receipt = self.send(self.operation('blob.chunk', blob_kind=kind, blob_sha256=digest, mime_type=mime,
                        total_bytes=len(data), chunk_index=index, chunk_count=count,
                        chunk_sha256=hashlib.sha256(chunk).hexdigest(), data_base64=base64.b64encode(chunk).decode()))
            complete = complete or receipt['status'] == 'complete'
        if not complete:
            # All chunks may have been prepared in a previous crash sequence; retry the
            # final stable chunk to let the assembler acknowledge completion.
            raise RuntimeError('blob_incomplete')
        return digest

    def publish(self, records, documents, images, *, source_commit, registry_revision, baseline_version):
        # Resume the exact frozen plan after a crash, BEFORE reading a newer parent.
        plan_key = hashlib.sha256(canonical([r['review']['verification_id'] for r in records])).hexdigest()
        plans = self.store.get('publication_plans', {})
        plan = plans.get(plan_key)
        if not plan:
            remote = self.operator(None).get('current_publication')
            parent = remote['data_version'] if remote else None
            history = self.store.get('publication_manifests', {})
            if parent and parent not in history:
                raise RuntimeError('publication_rebase_required')
            previous = history.get(parent, {'records': [], 'images': [], 'verification_ids': []})
            key = lambda r: (r['video']['bvid'], r['video']['part'], r['visit']['id'])
            merged = {key(r): r for r in previous['records']}
            for r in records:
                merged[key(r)] = r
            image_map = {i['path']: i for i in previous['images']}
            image_map.update({i['path']: {k:v for k,v in i.items() if k!='data'} for i in images})
            references={s['path'] for r in merged.values() for s in r['visit']['screenshots']}
            if references-set(image_map):
                raise ValueError('missing_image_reference')
            image_map={path:image for path,image in image_map.items() if path in references}
            versions = {r['review']['rules_version'] for r in merged.values()}
            if versions - {'v1', 'v2'}:
                raise ValueError('unsupported_rules_version')
            manifest = dict(schema_version=1, baseline_version=baseline_version, source_commit=source_commit, rules_version='v2' if 'v2' in versions else 'v1',
                            parent_version=parent, watchlist_revision=registry_revision,
                            records=list(merged.values()), images=list(image_map.values()),
                            verification_ids=list(dict.fromkeys([r['review']['verification_id'] for r in merged.values()])))
            raw = canonical(manifest)
            plan = dict(manifest=manifest, raw_base64=base64.b64encode(raw).decode(),
                        version='v1-' + hashlib.sha256(raw).hexdigest(), parent=parent,
                        etag=remote['pointer_etag'] if remote else None)
            plans[plan_key] = plan
            self.store.set('publication_plans', plans)
        for document in documents:
            raw = document['bytes']
            if hashlib.sha256(raw).hexdigest() != document['sha256']:
                raise ValueError('evidence_hash_mismatch')
            self.blob('evidence', raw, 'application/json')
        for image in images:
            if image['path'] not in {i['path'] for i in plan['manifest']['images']}:
                continue
            if hashlib.sha256(image['data']).hexdigest() != image['sha256']:
                raise ValueError('image_hash_mismatch')
            self.blob('image', image['data'], image['mime_type'])
        raw = base64.b64decode(plan['raw_base64'])
        digest = self.blob('manifest', raw, 'application/json')
        staged = self.send(self.operation('release.stage', manifest_sha256=digest))
        if staged['status'] != 'complete':
            raise RuntimeError('release_not_staged')
        receipt = self.send(self.operation('release.commit', data_version=plan['version'],
                            expected_parent_version=plan['parent'], expected_pointer_etag=plan['etag']))
        if receipt['status'] != 'committed':
            raise RuntimeError('release_not_committed')
        history = self.store.get('publication_manifests', {})
        history[plan['version']] = plan['manifest']
        self.store.set('publication_manifests', history)
        self.store.set('last_publication', receipt)
        return receipt
