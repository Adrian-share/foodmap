"""Stable, write-ahead operations over the existing fixed SSH transport."""
import base64
import hashlib
import json
import uuid
from pathlib import Path
import subprocess

CHUNK = 524288

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()

class IdentityPending(RuntimeError):
    def __init__(self, data_version, pending):
        super().__init__('store_identity_unresolved')
        self.data_version,self.pending=data_version,pending

class Publisher:
    def __init__(self, store, operator, observer=None):
        self.store, self.operator, self.observer = store, operator, observer

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

    def check_identity(self, records, aliases, evidence, parent):
        root=Path(__file__).resolve().parents[1]
        process=subprocess.run([str(root/'tools/node-v22.23.5-darwin-arm64/bin/node'),str(root/'scripts/agent-store-identity.cjs')],
                  input=json.dumps(dict(records=records,store_aliases=aliases,store_alias_evidence=evidence)),text=True,capture_output=True,
                  cwd=root,env={'PATH':'/usr/bin:/bin'},timeout=20)
        if len(process.stdout)>32*1024*1024:raise ValueError('invalid_store_identity_result')
        result=json.loads(process.stdout)
        if process.returncode or result.get('error_code'):raise ValueError(result.get('error_code','invalid_store_identity'))
        if result['pending']:raise IdentityPending(parent,result['pending'])

    def publish(self, records, documents, images, *, source_commit, registry_revision, baseline_version, store_aliases=None, store_alias_evidence=None):
        # Resume the exact frozen plan after a crash, BEFORE reading a newer parent.
        if (store_aliases is None)!=(store_alias_evidence is None):raise ValueError('incomplete_store_identity')
        key_material=[r['review']['verification_id'] for r in records]
        if store_aliases is not None:key_material=dict(verification_ids=key_material,store_aliases=store_aliases,store_alias_evidence=store_alias_evidence)
        plan_key = hashlib.sha256(canonical(key_material)).hexdigest()
        plans = self.store.get('publication_plans', {})
        plan = plans.get(plan_key)
        if not plan:
            remote = self.operator(None).get('current_publication')
            parent = remote['data_version'] if remote else None
            history = self.store.get('publication_manifests', {})
            if parent and parent not in history:
                raise RuntimeError('publication_rebase_required')
            previous = history.get(parent, {'records': [], 'images': [], 'verification_ids': []})
            inherited=previous;seen=set()
            while 'store_aliases' not in inherited and inherited.get('parent_version'):
                ancestor=inherited['parent_version']
                if ancestor in seen or ancestor not in history:raise RuntimeError('publication_rebase_required')
                seen.add(ancestor);inherited=history[ancestor]
            aliases=store_aliases if store_aliases is not None else inherited.get('store_aliases',{})
            alias_evidence=store_alias_evidence if store_alias_evidence is not None else inherited.get('store_alias_evidence',[])
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
            self.check_identity(list(merged.values()),aliases,alias_evidence,parent)
            manifest.update(store_aliases=aliases,store_alias_evidence=alias_evidence)
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
        observation=None
        if self.observer:
            try:observation=self.observer.begin(plan['version'],records,plan['parent'])
            except Exception as error:self.store.set('publication_observation_error',dict(data_version=plan['version'],stage='before_commit',error_code=type(error).__name__))
        receipt = self.send(self.operation('release.commit', data_version=plan['version'],
                            expected_parent_version=plan['parent'], expected_pointer_etag=plan['etag']))
        if receipt['status'] != 'committed':
            raise RuntimeError('release_not_committed')
        history = self.store.get('publication_manifests', {})
        history[plan['version']] = plan['manifest']
        self.store.set('publication_manifests', history)
        self.store.set('last_publication', receipt)
        if observation is not None:
            try:
                result=self.observer.complete(observation,receipt)
                self.store.set('last_publication_observation',{k:result[k] for k in ('data_version','status','within_sixty_seconds','full_R4_status','folder')})
                self.store.set('publication_observation_error',None)
            except Exception as error:self.store.set('publication_observation_error',dict(data_version=plan['version'],stage='after_commit',error_code=type(error).__name__))
        return receipt
