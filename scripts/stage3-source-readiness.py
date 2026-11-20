"""One real approved collection read against an isolated SQLite backup.

Never starts a service/model, writes live state, publishes content or changes a trigger.
"""
import hashlib,json,os,sqlite3,subprocess,sys,time,uuid
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root))
from foodmap_agent.queue import Store
from foodmap_agent.scheduler import Scanner,NodeCollector
from foodmap_agent.status import snapshot

def main():
 state=Path('/Users/adrian/foodmap-agent-state/python-preview')
 out=root/'evidence/FACT-33/source-readiness';out.mkdir(parents=True,exist_ok=True)
 isolated=root/'.agent-state/source-readiness'/str(uuid.uuid4());isolated.mkdir(parents=True,mode=0o700)
 source=sqlite3.connect('file:'+str(state/'queue.sqlite3')+'?mode=ro',uri=True)
 dest=sqlite3.connect(isolated/'queue.sqlite3');source.backup(dest);source.close();dest.close()
 q=Store(isolated);collector=NodeCollector(root,root/'tools/node-v22.23.5-darwin-arm64/bin/node')
 captures=[]
 # Same real sourcePage / fetchJson implementation; observe its bounded stream
 # to retain the raw official response without issuing another network request.
 js=r'''
const fs=require('node:fs'),path=require('node:path');
const {sourcePage}=require('./scripts/agent-source-page.cjs');
const {resolveFetch}=require('./scripts/refresh-creator-inventory-incremental.cjs');
const input=JSON.parse(fs.readFileSync(0,'utf8')),out=process.argv[1],real=resolveFetch();
(async()=>{try{const result=await sourcePage(input,async(url,init)=>{
 const r=await real(url,init),reader=r.body.getReader(),chunks=[];let n=0;
 fs.writeFileSync(path.join(out,'request.json'),JSON.stringify({url,headers:init.headers,redirect:init.redirect,http_status:r.status}));
 return {status:r.status,body:{getReader:()=>({async read(){const v=await reader.read();if(v.done)fs.writeFileSync(path.join(out,'official-response.json'),Buffer.concat(chunks));else{n+=v.value.length;if(n>2*1024*1024){await reader.cancel();throw Error('response_too_large');}chunks.push(Buffer.from(v.value));}return v;},cancel:()=>reader.cancel(),releaseLock:()=>reader.releaseLock()})}};
 });console.log(JSON.stringify(result));}catch(e){console.log(JSON.stringify({error_code:e.error_code||'source_probe_failed',http_status:e.http_status,business_code:e.business_code}));process.exitCode=1;}})();
'''
 def fetch_page(s,page):
  r=subprocess.run([str(collector.node),'-e',js,str(out)],input=json.dumps(dict(source=s,page=page)),cwd=root,capture_output=True,text=True,timeout=25,env={'HOME':str(Path.home()),'PATH':'/usr/bin:/bin'})
  if r.returncode:raise RuntimeError('real_source_probe_failed')
  value=json.loads(r.stdout);captures.append(value);(out/'source-page.json').write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');return value
 scanner=Scanner(q,fetch_page,anchors=collector.anchors)
 plan=scanner.plan();target=next(s for s in plan if s.get('anchor_bvid')=='BV1NG6kYTEXG')
 scanner.plan=lambda:[target]  # Bounded diagnostic scope: one actual planned source.
 before=dict(videos=len(q.videos()),jobs=len(q.jobs()),cursor=q.cursor(Scanner.key(target)),cursors=q.cursors())
 first=scanner.run(max_requests=1);after_cursor=q.cursor(Scanner.key(target));after_jobs=q.jobs()
 second=scanner.run(max_requests=1)
 current=captures[0] if captures else {}
 legacy=Path('/Users/adrian/foodmap-agent-state/runs/2026-11-17T01-01-07-477Z-b7e4f945-8bd2-4a94-bf96-a90581dd6d04/snapshot.json')
 old=json.loads(legacy.read_text());old_ids={d['bvid'] for d in old['discoveries'] if '#season-5780378' in d['source']};new_ids={v['bvid'] for v in current.get('items',[])}
 raw=(out/'official-response.json').read_bytes() if (out/'official-response.json').exists() else b''
 report=dict(fixture=False,scope='one approved official collection; isolated SQLite backup; no live queue mutation',checked_at=time.time(),source=target,
             model_or_service_started=False,requests=len(captures),first_scan=first,second_scan=second,before=before,
             after=dict(videos=len(q.videos()),jobs=len(after_jobs),cursor=after_cursor),cursor_stable_on_replay=q.cursor(Scanner.key(target))==after_cursor,
             jobs_stable_on_replay=q.jobs()==after_jobs,old_collection_unique=len(old_ids),current_collection_unique=len(new_ids),lost_old_bvids=sorted(old_ids-new_ids),new_list_bvids=sorted(new_ids-old_ids),
             response_sha256=hashlib.sha256(raw).hexdigest(),payload_sha256=current.get('collection',{}).get('payload_sha256'),isolated_state=str(isolated))
 report['passed']=bool(first['ok']==1 and not first['failed'] and not first['restricted'] and len(captures)==1 and len(new_ids)>=61 and old_ids<=new_ids and second['deferred']==1 and report['cursor_stable_on_replay'] and report['jobs_stable_on_replay'])
 (out/'real-collection-scan.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');q.close()
 print(json.dumps({k:report[k] for k in ('passed','requests','first_scan','second_scan','old_collection_unique','current_collection_unique','lost_old_bvids')}))
 return 0 if report['passed'] else 1

if __name__=='__main__':sys.exit(main())
