"""One controlled production recovery observation; never a collector/model/publisher."""
import fcntl,hashlib,json,os,re,signal,sqlite3,subprocess,time
from datetime import datetime,timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from .evidence_cache import recover_registered
from .release_audit import write_json,utc,epoch

def fault_ready(job,service,used,registered,now,second):
    return bool(job and job['stage']=='cleaning' and job['attempt']==(2 if second else 1)
                and job['lease_owner']==service['instance_id'] and job['lease_until']>now
                and service['scheduler_owner']=='python' and service['mode']=='production'
                and used<=(8 if second else 7) and registered)

class P3Acceptance:
    def __init__(self,state,journal,expected_release,multica_cli):
        self.state=Path(state).resolve();self.journal=Path(journal).resolve();self.release=expected_release;self.cli=multica_cli
        if not re.fullmatch(r'[a-f0-9]{40}',expected_release):raise ValueError('invalid_expected_release')
        if not self.journal.is_relative_to(self.state/'acceptance'):raise ValueError('observer_journal_outside_state')
        self.journal.mkdir(parents=True,exist_ok=True,mode=0o700);self.file=self.journal/'status.json';self.stopping=False
        self.value=json.loads(self.file.read_text()) if self.file.exists() else dict(fixture=False,phase='waiting_window',expected_release=expected_release,armed_at=utc(),events=[])
        if self.value['expected_release']!=expected_release:raise ValueError('armed_release_changed')
    def save(self,event=None,**fields):
        self.value.update(fields,observer_pid=os.getpid(),heartbeat_at=utc())
        if event:self.value['events'].append(dict(at=utc(),event=event))
        write_json(self.file,self.value)
    def snapshot(self):
        c=sqlite3.connect('file:'+str(self.state/'queue.sqlite3')+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
        c.execute('BEGIN')
        get=lambda k,default=None:json.loads(r[0]) if (r:=c.execute('select value from service_state where key=?',(k,)).fetchone()) else default
        day=datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat()
        jobs=[dict(r) for r in c.execute('select id,bvid,uid,part,rules_version,stage,attempt,lease_owner,lease_until,session_id,session_path from jobs order by rowid')]
        attempts=[dict(r) for r in c.execute('select * from attempts order by rowid')]
        receipts={r['request_id']:hashlib.sha256((r['body']+(r['receipt'] or '')).encode()).hexdigest() for r in c.execute("select * from receipts where status in ('committed','complete')")}
        histories={k:hashlib.sha256(json.dumps(v,sort_keys=True).encode()).hexdigest() for k,v in get('publication_manifests',{}).items()}
        cursor_values={r['key']:json.loads(r['value']) for r in c.execute('select key,value from source_cursors order by key')}
        s=dict(checked_at=utc(),service=get('service'),jobs=jobs,day=day,used=sum(x['day']==day for x in attempts),attempts=attempts,receipts=receipts,histories=histories,
               cursors=list(cursor_values),cursor_values=cursor_values,last_scan=get('last_scan'),prepared=c.execute("select count(*) from receipts where status='prepared'").fetchone()[0],model_audit_count=json.loads((self.state/'pi/model-audit.jsonl.count.json').read_text()))
        selected=self.value.get('task_id')
        if selected:s.update(extraction=get('extraction:'+selected),events=get('pipeline_events:'+selected,[]))
        c.close();return s
    @staticmethod
    def cursor_comparison(before,after):
        # Changed values need source-scan evidence and root review, not a guessed
        # pass/fail: both legitimate progress and accidental resets change them.
        result=dict(before_checked_at=before.get('checked_at'),after_checked_at=after.get('checked_at'))
        if 'cursor_values' not in before or 'cursor_values' not in after:
            return dict(result,status='missing_cursor_snapshot')
        a,b=before['cursor_values'],after['cursor_values'];shared=sorted(a.keys()&b.keys())
        changed={k:dict(before=a[k],after=b[k]) for k in shared if json.dumps(a[k],sort_keys=True)!=json.dumps(b[k],sort_keys=True)}
        missing=sorted(a.keys()-b.keys());added=sorted(b.keys()-a.keys())
        return dict(result,status='missing_cursor_values' if missing else 'pending_source_progress_review' if changed or added else 'unchanged',
                    unchanged=[k for k in shared if k not in changed],changed=changed,missing=missing,added=added)
    def registered(self,job,snapshot):
        try:
            identity=dict(task_id=job['id'],creator_uid=job['uid'],bvid=job['bvid'],part=job['part'],root=str(self.state/'evidence'/job['id']))
            value=recover_registered(identity)
            if not value or 'metadata' not in value['evidence'] or not value['frame_files']:return None
            binding=json.loads((self.state/'pi/task.json').read_text())
            if any(binding.get(k)!=v for k,v in identity.items()):return None
            started=max(x['started_at'] for x in snapshot['attempts'] if x['task_id']==job['id'])
            if (Path(identity['root'])/'registered-context.json').stat().st_mtime<started:return None
            proposal=self.state/'pi/proposal.json'
            if proposal.exists() and proposal.stat().st_mtime>=started:return None
            return dict(identity=identity,registered=value,attempt_started_at=started)
        except (OSError,ValueError,KeyError,TypeError):return None
    def owned(self,pid,kind,parent=None):
        raw=subprocess.check_output([self.cli,'daemon','status','--output','json'],text=True,timeout=10);daemon=json.loads(raw)
        daemon_pid=daemon.get('pid') or daemon.get('daemon',{}).get('pid')
        if not daemon_pid or pid in (int(daemon_pid),os.getpid()):raise RuntimeError('protected_or_unknown_daemon_pid')
        text=subprocess.check_output(['/bin/ps','-p',str(pid),'-o','ppid=,command='],text=True).strip();ppid=int(text.split(maxsplit=1)[0]);command=text.split(maxsplit=1)[1]
        if parent is not None and ppid!=parent:raise RuntimeError('owned_parent_changed')
        if kind=='pi':
            # Pi sets process.title='pi'; prove its mapped executable, not argv text.
            mapped=subprocess.check_output(['/usr/sbin/lsof','-a','-p',str(pid),'-d','txt','-Fn'],text=True)
            expected='/Users/adrian/foodmap-agent-runtime/foodmap/preview/releases/'+self.release+'/tools/node-v22.23.5-darwin-arm64/bin/node'
            audit=json.loads((self.state/'pi/audit.json').read_text())
            if 'n'+expected not in mapped.splitlines() or os.getpgid(pid)!=pid or not audit.get('valid') or len(audit.get('active',[]))!=5 or not all(self.release in x['sourceInfo']['path'] for x in audit['all']):raise RuntimeError('not_the_owned_pi_group')
        else:
            label=subprocess.check_output(['/bin/launchctl','print','gui/'+str(os.getuid())+'/com.adrian.foodmap-agent'],text=True)
            if self.release not in label or not re.search(r'\bpid = '+str(pid)+r'\b',label) or '-m foodmap_agent' not in command or str(self.state) not in command:raise RuntimeError('not_the_unique_production_owner')
            with (self.state/'service.lock').open('r+') as lock:
                if int(lock.read().strip())!=pid:raise RuntimeError('singleton_pid_changed')
                try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                except BlockingIOError:pass
                else:fcntl.flock(lock,fcntl.LOCK_UN);raise RuntimeError('production_singleton_not_held')
    def legacy_stopped(self):
        a=json.loads(subprocess.check_output([self.cli,'autopilot','get','9d7d3391-9e85-4a55-baae-8294bc33e15e','--output','json'],text=True,timeout=20))
        tasks=json.loads(subprocess.check_output([self.cli,'agent','tasks','2783a44b-d346-4c71-a393-bb017407b73e','--output','json'],text=True,timeout=20))
        if a['autopilot']['status']!='paused' or any(t['status'] not in ('completed','failed','cancelled') for t in tasks):raise RuntimeError('legacy_owner_not_drained')
    def interrupt(self,snapshot,job,registration,second):
        if snapshot['prepared']:raise RuntimeError('unconfirmed_write_protects_fault_window')
        service=snapshot['service'];python=service['pid'];pi=service['pi']['pid']
        self.legacy_stopped()
        self.owned(python,'python');self.owned(pi,'pi',python)
        fresh=self.snapshot();current=next((x for x in fresh['jobs'] if x['id']==job['id']),None)
        if fresh['prepared'] or not fault_ready(current,fresh['service'],fresh['used'],bool(self.registered(current,fresh)) if current else False,time.time(),second):return False
        if fresh['service']['pid']!=python or fresh['service']['pi']['pid']!=pi:raise RuntimeError('process_changed_before_signal')
        if second:
            if current['session_id']!=self.value['session_id']:raise RuntimeError('retry_session_changed')
            self.save('before_python_sigkill',phase='waiting_restart',second_python_pid=python,second_pi_pid=pi,python_killed_at=time.time(),second_attempt=current,second_snapshot=fresh)
            os.kill(python,signal.SIGKILL)
        else:
            self.save('before_first_pi_sigterm',phase='waiting_retry',task_id=job['id'],bvid=job['bvid'],uid=job['uid'],part=job['part'],session_id=job['session_id'],session_path=job['session_path'],first_python_pid=python,first_pi_pid=pi,baseline=fresh,first_registration=registration,selected_day=fresh['day'])
            os.killpg(pi,signal.SIGTERM)
        return True
    @staticmethod
    def alive(pid):
        result=subprocess.run(['/bin/ps','-p',str(pid),'-o','stat='],capture_output=True,text=True)
        return result.returncode==0 and result.stdout.strip() and not result.stdout.strip().startswith('Z')
    def tick(self):
        s=self.snapshot();phase=self.value['phase'];now=time.time()
        if phase=='waiting_window':
            if now<epoch('2026-11-19T00:00:00+08:00'):return
            if s['used']>=10:self.save('natural_budget_already_exhausted_no_fault_sent',phase='budget_exhausted_pending');return
            for job in s['jobs']:
                registration=self.registered(job,s) if job['stage']=='cleaning' and job['attempt']==1 else None
                if fault_ready(job,s['service'],s['used'],bool(registration),now,False):self.interrupt(s,job,registration,False);break
        elif phase=='waiting_retry':
            job=next(x for x in s['jobs'] if x['id']==self.value['task_id'])
            if job['attempt']>2:raise RuntimeError('retry_went_beyond_safe_second_attempt')
            registration=self.registered(job,s) if job['stage']=='cleaning' and job['attempt']==2 else None
            if fault_ready(job,s['service'],s['used'],bool(registration),now,True):self.interrupt(s,job,registration,True)
        elif phase=='waiting_restart':
            old_pi=self.value['second_pi_pid']
            if self.alive(old_pi):
                if now-self.value['python_killed_at']>15:
                    self.owned(old_pi,'pi');os.killpg(old_pi,signal.SIGTERM)
                    time.sleep(1)
                    if self.alive(old_pi):self.owned(old_pi,'pi');os.killpg(old_pi,signal.SIGKILL)
                    raise RuntimeError('stdin_eof_failed_owned_pi_cleaned_up_not_a_pass')
                return
            if s['service']['pid']==self.value['second_python_pid']:return
            self.owned(s['service']['pid'],'python')
            self.save('launchd_restarted_and_old_pi_eof_closed',phase='waiting_final',stdin_eof_closed=True,new_python_pid=s['service']['pid'],new_pi_pid=s['service']['pi']['pid'],
                      recovery_snapshot=s,cursor_recovery_comparison=self.cursor_comparison(self.value['baseline'],s))
        elif phase=='waiting_final':
            job=next(x for x in s['jobs'] if x['id']==self.value['task_id']);result=s.get('extraction',{}).get('result',{}) if s.get('extraction') else {}
            if job['stage'] in ('cleaning','discovered','deferred_budget','verifying'):return
            self.save('cursor_values_after_final_task',final_snapshot=s,cursor_final_comparison=self.cursor_comparison(self.value['baseline'],s))
            if not result or result.get('settled',{}).get('aborted') is not False:raise RuntimeError('final_task_has_no_successful_settled')
            baseline=self.value['baseline'];registration=self.registered_final(job)
            checks=dict(attempt_three=job['attempt']==3,one_business_job=sum(x['bvid']==job['bvid'] and x['part']==job['part'] and x['rules_version']==job['rules_version'] for x in s['jobs'])==1,
                        same_session=job['session_id']==self.value['session_id'],same_session_path=job['session_path']==self.value['session_path'],budget_within_ten=s['used']<=10,
                        one_terminal_business_event=sum(e['stage'] in ('published','pending','blocked_capture') for e in s['events'])==1,
                        model_counter_not_reset=s['model_audit_count']['provider_requests']>=baseline['model_audit_count']['provider_requests'],
                        previous_attempts_preserved=all(x in s['attempts'] for x in baseline['attempts']),receipts_preserved=all(s['receipts'].get(k)==v for k,v in baseline['receipts'].items()),
                        manifests_preserved=all(s['histories'].get(k)==v for k,v in baseline['histories'].items()),cursor_keys_preserved=set(baseline['cursors'])<=set(s['cursors']),
                        original_frames_preserved=all(registration['frame_files'].get(k)==v for k,v in self.value['first_registration']['registered']['frame_files'].items()),
                        metadata_preserved=registration['evidence'].get('metadata')==self.value['first_registration']['registered']['evidence']['metadata'])
            if not all(checks.values()):raise RuntimeError('recovery_invariant_failed:'+','.join(k for k,v in checks.items() if not v))
            self.save('one_real_task_settled_after_both_faults',phase='completed_pending_root_review',checks=checks,final_job=job,final_extraction=result,final_snapshot=s)
    def registered_final(self,job):
        return recover_registered(dict(task_id=job['id'],creator_uid=job['uid'],bvid=job['bvid'],part=job['part'],root=str(self.state/'evidence'/job['id'])))
    def run(self):
        with (self.journal/'observer.lock').open('a+') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            signal.signal(signal.SIGTERM,lambda *_:setattr(self,'stopping',True))
            self.save('observer_armed_no_collection_or_model_calls')
            try:
                while not self.stopping and self.value['phase'] in ('waiting_window','waiting_retry','waiting_restart','waiting_final'):
                    if time.time()>=epoch('2026-11-19T02:00:00+08:00'):self.save('window_expired',phase='expired_pending');break
                    self.tick();self.save();time.sleep(30 if self.value['phase']=='waiting_window' and time.time()<epoch('2026-11-19T00:00:00+08:00') else 2)
                if self.stopping:self.save('observer_stopped_by_operator',phase='stopped_pending')
            except Exception as error:self.save('observer_aborted_guard_or_recovery_failure',phase='failed_pending',error_code=str(error));raise
