import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time
from urllib.parse import urlsplit
import uuid
from .queue import STAGES
from .watchlist import WatchlistSync, GitHub, now_iso
from .scheduler import Scanner, NodeCollector, next_daily
from .pi_rpc import PiRPC, cancel_rpc
from .pipeline import Pipeline
from .publisher import Publisher
from .evidence_cache import recover_registered

class Singleton:
    def __init__(self, state):
        self.file = Path(state) / 'service.lock'
        self.handle = None

    def __enter__(self):
        self.handle = self.file.open('a+')
        try:
            fcntl.flock(self.handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.handle.close()
            raise RuntimeError('service_already_running') from None
        self.handle.seek(0)
        self.handle.truncate()
        self.handle.write(str(os.getpid()))
        self.handle.flush()
        return self

    def __exit__(self, *_):
        fcntl.flock(self.handle, fcntl.LOCK_UN)
        self.handle.close()

class OperationClient:
    def __init__(self, root, node, config):
        self.root, self.node, self.config = root, node, config

    def __call__(self, operation):
        if not self.config:
            raise RuntimeError('blocked_registry_configuration')
        env = {k: os.environ[k] for k in ('HOME', 'TMPDIR', 'LANG') if k in os.environ}
        env['PATH'] = '/usr/bin:/bin'
        result = subprocess.run([str(self.node), str(self.root / 'scripts/agent-operation.cjs'), str(self.config)],
                                input=json.dumps(operation), capture_output=True, text=True,
                                timeout=55, cwd=self.root, env=env, check=False)
        if result.returncode or len(result.stdout) > 2 * 1024 * 1024:
            raise RuntimeError('registry_transport_failed')
        return json.loads(result.stdout)

    def lookup(self, request_id):
        return self(dict(schema_version=1, operation='receipt.get', request_id=str(uuid.uuid4()), target_request_id=request_id))

class Service:
    def __init__(self, store, root, node=None, model_config=None, upload_config=None, github_token=None, mode='preview', publication_observer=None):
        self.store, self.root = store, Path(root).resolve()
        if mode not in ('preview','production','draining'):
            raise ValueError('invalid_service_mode')
        self.mode=mode
        self.node = Path(node or self.root / 'tools/node-v22.23.5-darwin-arm64/bin/node').resolve()
        self.instance_id = str(uuid.uuid4())
        self.pi = None
        self.model = None
        self.model_env = {}
        self.model_requests = 0
        self.last_error = None
        self.stop_requested = False
        self.operator = OperationClient(self.root, self.node, upload_config)
        self.sync = WatchlistSync(store, self.operator)
        self.github = GitHub(github_token)
        self.scanner = Scanner(store, NodeCollector(self.root, self.node), on_progress=self.progress)
        self.next_source_at = next_daily()
        self.next_watchlist_at = 0
        previous=store.get('service',{})
        if mode=='production' and previous.get('mode')=='production':
            for key in ('next_source_at','next_watchlist_at'):
                value=previous.get(key)
                if isinstance(value,(int,float)) and value>0:setattr(self,key,value)
        self.last_model_probe = 0
        self.current_job = None
        self.last_heartbeat = 0
        self.pi_restart_at = 0
        self.pi_restart_failures = 0
        self.model_config = Path(model_config).resolve() if model_config else None
        self.load_model()
        commit = subprocess.run(['git','rev-parse','HEAD'],cwd=self.root,capture_output=True,text=True,timeout=5)
        self.source_commit = commit.stdout.strip() if commit.returncode == 0 else None
        self.pipeline = Pipeline(store,self.root,self.node,self.operator,self.source_commit)
        self.pipeline.publisher.observer=publication_observer
        self.last_status_upload = 0

    def load_model(self):
        # Read only the explicitly supplied private project file. Never inspect DSH/Codex.
        if not self.model_config or not self.model_config.exists():
            self.model = None
            self.last_error = 'blocked_model'
            return
        if self.model_config.stat().st_mode & 0o077:
            raise ValueError('model_config_must_be_0600')
        value = json.loads(self.model_config.read_text())
        if set(value) != {'provider', 'model', 'api', 'base_url', 'api_key', 'models_config'}:
            raise ValueError('invalid_private_model_config')
        endpoint = urlsplit(value['base_url'])
        if endpoint.scheme not in ('http', 'https') or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment:
            raise ValueError('invalid_model_endpoint')
        if any(not isinstance(value[k], str) or not value[k] for k in value):
            raise ValueError('invalid_model_configuration')
        if any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.:/' for c in value['provider'] + value['model']):
            raise ValueError('invalid_model_identifier')
        if value['api'] not in ('anthropic-messages', 'openai-responses'):
            raise ValueError('unsupported_model_api')
        self.model = {k: value[k] for k in ('provider', 'model', 'api', 'base_url')}
        self.model_env = {'FOODMAP_MODEL_API_KEY': value['api_key']}
        config = self.store.root / 'pi/config'
        config.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Consume only the handoff's single-provider file; never copy DSH configuration.
        models = json.loads(Path(value['models_config']).read_text())
        provider = models.get('providers', {}).get(value['provider'])
        if (set(models.get('providers', {})) != {value['provider']} or not provider
                or provider.get('api') != value['api'] or provider.get('baseUrl') != value['base_url']
                or provider.get('apiKey') != '${FOODMAP_MODEL_API_KEY}'
                or len(provider.get('models', [])) != 1 or provider['models'][0]['id'] != value['model']
                or provider['models'][0].get('maxTokens', 8193) > 8192
                or set(provider) - {'api', 'baseUrl', 'apiKey', 'models'}
                or set(provider['models'][0]) - {'id', 'name', 'contextWindow', 'maxTokens', 'input', 'cost', 'reasoning'}):
            raise ValueError('invalid_scoped_models_config')
        file = config / 'models.json'
        file.write_text(json.dumps(models))
        file.chmod(0o600)
        checked = subprocess.run([str(self.node), str(self.root / 'agent/pi/validate-models.mjs'), str(file)], capture_output=True, timeout=15)
        if checked.returncode:
            raise ValueError('invalid_official_models_schema')
        self.last_error = None

    def start_pi(self):
        if self.pi and self.pi.proc.poll() is None:
            return
        if self.pi:
            previous = self.pi
            self.pi = None
            self.model_requests += previous.model_requests
            previous.close()
        self.pi = PiRPC(self.root, self.store.root, self.node,
                        provider=self.model['provider'] if self.model else None,
                        model=self.model['model'] if self.model else None, model_env=self.model_env)
        try:
            self.pi.audit()
            self.pi.on_poll = self.progress
        except Exception:
            self.pi.close()
            self.pi = None
            raise

    def ensure_pi(self):
        if self.pi and self.pi.proc.poll() is None:
            return
        if time.time() < self.pi_restart_at:
            return
        try:
            self.start_pi()
            self.pi_restart_at = 0
            self.pi_restart_failures = 0
            self.last_error = None if self.model else 'blocked_model'
        except Exception:
            self.pi_restart_failures += 1
            self.pi_restart_at = time.time() + min(300, 15 * 2 ** min(self.pi_restart_failures, 5))
            self.last_error = 'pi_restart_backoff'

    def progress(self):
        if time.time()-self.last_heartbeat>5:
            self.heartbeat(query_pi=False)
            if not getattr(self,'offline',True):
                self.upload_heartbeat()

    def heartbeat(self, query_pi=True):
        self.last_heartbeat = time.time()
        pi_state = 'blocked_model' if not self.model else 'unavailable'
        session_id = None
        if self.pi and self.pi.proc.poll() is None:
            try:
                state = self.pi.state_info() if query_pi else self.pi.last_state
                session_id = state.get('sessionId')
                if self.model:
                    pi_state = 'busy' if self.current_job or state.get('isStreaming') else 'idle'
            except Exception:
                self.last_error = 'pi_unavailable'
        counts = {s: 0 for s in STAGES}
        for job in self.store.jobs():
            counts[job['stage']] += 1
        try:
            provider_requests = json.loads((self.store.root / 'pi/model-audit.jsonl.count.json').read_text())['provider_requests']
        except (OSError, ValueError, KeyError):
            provider_requests = 0
        self.store.set('service', dict(instance_id=self.instance_id, pid=os.getpid(), heartbeat_at=now_iso(),
                      scheduler_owner='python' if self.mode=='production' else 'legacy', mode=self.mode, pi_restart_at=self.pi_restart_at, pi_restart_failures=self.pi_restart_failures, next_watchlist_at=self.next_watchlist_at,
                      next_source_at=self.next_source_at, last_error_code=self.last_error,
                      model_requests=provider_requests, model_jobs_started=self.model_requests + (self.pi.model_requests if self.pi else 0),
                      pi=dict(state=pi_state, pid=self.pi.proc.pid if self.pi else None, version='1.5.2' if self.pi else None,
                              session_id=session_id, provider=self.model['provider'] if self.model else None,
                              model=self.model['model'] if self.model else None), queue=counts))

    def advance_pipeline(self):
        for job in self.store.jobs():
            if job['stage'] not in ('verifying','staged') or job['next_retry_at'] > time.time():
                continue
            try:
                if job['stage'] == 'staged':
                    if self.mode!='production':
                        continue
                    self.pipeline.resume(job)
                else:
                    saved=self.store.get('extraction:'+job['id'])
                    if not saved:
                        self.store.db.execute("UPDATE jobs SET stage='discovered',error_code='missing_extraction_context' WHERE id=?",(job['id'],))
                        return True
                    self.pipeline.advance(job,saved['result'],saved['context'],saved['model'],publish=self.mode=='production')
            except Exception:
                self.last_error='publication_or_verification_failed'
                self.store.db.execute('UPDATE jobs SET error_code=?,next_retry_at=? WHERE id=?',('publication_or_verification_failed',time.time()+60,job['id']))
            return True
        return False

    def upload_heartbeat(self):
        if not self.operator.config or time.time()-self.last_status_upload < 60 or not self.source_commit:
            return
        from datetime import datetime, timezone
        status=self.store.get('service')
        iso=lambda ts: datetime.fromtimestamp(ts,timezone.utc).isoformat() if ts else None
        body=dict(schema_version=1,operation='service.heartbeat',request_id=str(uuid.uuid4()),instance_id=self.instance_id,
                  owner=status['scheduler_owner'],mode=status['mode'],source_commit=self.source_commit,heartbeat_at=status['heartbeat_at'],
                  next_watchlist_at=iso(self.next_watchlist_at),next_source_at=iso(self.next_source_at),
                  pi={k:status['pi'][k] for k in ('state','version','session_id')},queue=status['queue'],last_error_code=self.last_error)
        try:
            receipt=self.operator(body)
            if receipt.get('status')!='committed':
                raise RuntimeError('heartbeat_not_committed')
            from .status import snapshot
            if self.store.get('watchlist'):
                self.operator(snapshot(self.store))
            self.last_status_upload=time.time()
            if self.last_error=='heartbeat_upload_failed':
                self.last_error=None
        except Exception:
            self.last_error='heartbeat_upload_failed'

    def process_one(self):
        if self.mode=='draining':
            return
        if self.advance_pipeline():
            return
        if not self.model:
            self.store.db.execute("UPDATE jobs SET stage='blocked_model',error_code='blocked_model' WHERE stage='discovered'")
            self.last_error = 'blocked_model'
            return
        # A supervisor may restart us before the crashed worker's lease expires.
        # Reconcile writes and reclaim expired leases on each processing cycle,
        # rather than requiring another restart after the expiry timestamp.
        try:
            self.store.recover(self.operator.lookup)
        except Exception:
            self.last_error = 'receipt_recovery_failed'
            return
        self.store.db.execute("UPDATE jobs SET stage='discovered' WHERE stage IN ('pending','blocked_capture') AND next_retry_at>0 AND next_retry_at<=? AND attempt<3",(time.time(),))
        job = self.store.claim(self.instance_id)
        if not job:
            return
        self.current_job = job['id']
        context=None
        context_valid=False
        try:
            self.start_pi()
            evidence_root = self.store.root / 'evidence' / job['id']
            evidence_root.mkdir(parents=True, exist_ok=True)
            row = next(v for v in self.store.videos() if v['bvid'] == job['bvid'])
            raw = json.dumps(row, ensure_ascii=False).encode()
            (evidence_root / 'discovery.json').write_bytes(raw)
            context = dict(task_id=job['id'], creator_uid=job['uid'], bvid=job['bvid'], part=job['part'], root=str(evidence_root),
                           evidence={'discovery': dict(file='discovery.json', sha256=hashlib.sha256(raw).hexdigest())},
                           prompt={'instruction': 'Read registered evidence, fetch official metadata with subtitles, capture original frames, search POIs for each exact Beijing branch. Description must be an exact quote from registered official subtitles or original-frame apple-vision-v1 OCR within the visit segment. C2 v2 also allows a single-venue official Bili description that explicitly binds the store to a disambiguating street, with an original frame and exactly one matching Beijing AMap branch. For that case quote the official description, use AMap for house number/GCJ-02 coordinates, and never attribute its address to speech or OCR. Ambiguous or multi-store descriptions remain missing. Cite actual evidence; never invent quotes, evaluations or prices. Propose extraction with registered evidence IDs. poi_candidates must contain actual payload.pois[].id values; evidence_ids contain registered source artifact IDs. Description must be one exact quote, not a narrative paraphrase. Submit via content_submit_extraction. Missing facts stay uncertain. Never approve or publish.',
                                   'task_id': job['id'], 'bvid': job['bvid'], 'part': job['part'], 'creator_uid': job['uid'], 'evidence_ids': ['discovery']})
            saved=self.store.get('task_context:'+job['id'])
            if saved:
                if any(saved.get(k)!=context[k] for k in ('task_id','creator_uid','bvid','part','root')):
                    raise RuntimeError('cached_task_identity_mismatch')
                discovery=context['evidence']['discovery']
                for key in ('evidence','frame_files','model_preview_bytes'):
                    if key in saved:context[key]=saved[key]
                context['evidence']['discovery']=discovery
            durable=recover_registered(context)
            if durable:
                context['evidence'].update(durable['evidence'])
                context.setdefault('frame_files',{}).update(durable['frame_files'])
                context['model_preview_bytes']=max(context.get('model_preview_bytes',0),durable['model_preview_bytes'])
            context.update(frame_capture_count=0,proposal_submitted=False,subtitles_checked=False)
            context['prompt']['evidence_ids']=list(context['evidence'])
            context['prompt']['instruction']+=' Reuse registered artifacts already present. Capture at most THREE new frames in this attempt; avoid blind sequential scans and black/outro frames. After frame or preview budget exhaustion, submit missing facts. Submit exactly one proposal, then end; never keep sampling after a successful submission.'
            context_valid=True
            def bound(state):
                self.store.save_session(job['id'], state.get('sessionFile'), state['sessionId'])
            result = self.pi.run(job, context, on_bound=bound)
            self.store.set('extraction:'+job['id'],dict(result=result,context=context,model=self.model))
            self.store.release(job['id'], self.instance_id, 'verifying', proposal=result)
        except Exception as error:
            try:
                if self.pi:
                    self.pi.close()
            finally:
                stage = 'blocked_model' if str(error) == 'blocked_model' else 'discovered' if job['attempt'] < 3 else 'failed'
                self.store.release(job['id'], self.instance_id, stage, 'blocked_model' if stage == 'blocked_model' else type(error).__name__, time.time() + 60)
                self.last_error = type(error).__name__
        finally:
            if context_valid:self.store.set('task_context:'+job['id'],context)
            self.current_job = None

    def serve(self, *, offline=False, duration=None):
        self.offline=offline
        end = time.monotonic() + duration if duration is not None else None
        with Singleton(self.store.root):
            self.store.seed(self.root)
            # Without upload config, an unresolved write must remain unresolved.
            if any(r['status'] == 'prepared' for r in self.store.receipts()):
                self.store.recover(self.operator.lookup)
            else:
                self.store.recover(lambda rid: {'status': 'not_found'})
            old_handlers = {s: signal.signal(s, self.stop) for s in (signal.SIGTERM, signal.SIGINT)}
            try:
                self.ensure_pi()
                while not self.stop_requested and (end is None or time.monotonic() < end):
                    now = time.time()
                    self.ensure_pi()
                    if self.model_config and now - self.last_model_probe > 30:
                        self.last_model_probe = now
                        if not self.model:
                            self.load_model()
                            if self.model and self.pi:
                                self.pi.close()
                    if not offline and self.mode!='draining':
                        if now >= self.next_watchlist_at or self.store.get('sync_requested'):
                            self.sync.poll(self.github)
                            self.store.set('sync_requested', False)
                            self.next_watchlist_at = self.store.get('watchlist_sync', {}).get('next_retry_at', now + 900)
                        if now >= self.next_source_at or self.store.get('sources_due') or self.store.get('run_once_requested'):
                            self.scanner.run()
                            self.store.set('sources_due', False)
                            self.store.set('run_once_requested', False)
                            self.next_source_at = min([next_daily()] + [c['next_retry_at'] for c in self.store.cursors() if c['next_retry_at'] > now])
                        self.process_one()
                    self.heartbeat()
                    if not offline:
                        self.upload_heartbeat()
                    # Bounded interruptible idle; no calls to prompt in this loop.
                    for _ in range(10):
                        if self.stop_requested or (end is not None and time.monotonic() >= end):
                            break
                        time.sleep(1)
            finally:
                if self.pi:
                    try:
                        cancel_rpc(self.pi.request)
                    except Exception:
                        pass
                    self.pi.close()
                self.store.set('stopped_at', now_iso())
                for s, handler in old_handlers.items():
                    signal.signal(s, handler)

    def stop(self, *_):
        self.stop_requested = True
        if self.pi:
            self.pi.close()
