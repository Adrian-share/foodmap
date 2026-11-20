"""Versioned registry activation; no production queue or network."""
import copy,hashlib,json,tempfile,unittest
from pathlib import Path
from foodmap_agent.queue import Store
from foodmap_agent.watchlist import WatchlistSync
from foodmap_agent.scheduler import Scanner,SourceFailure
ROOT=Path(__file__).resolve().parents[2]
BV='BV1abcde2345';UID='999123';SID='987654'
class DynamicAnchors(unittest.TestCase):
 def setUp(self):
  t=tempfile.TemporaryDirectory();self.addCleanup(t.cleanup);self.q=Store(t.name);self.addCleanup(self.q.close)
  self.w=json.loads((ROOT/'docs/architecture/FACT-31/watchlist.initial.json').read_text());self.w['sources']=[dict(uid=UID,name='offline',profile_url='https://space.bilibili.com/'+UID,enabled=True,collection_scope='beijing',season_ids=[SID],collection_anchors=[dict(season_id=SID,bvid=BV)])];self.w['video_links']=[]
  self.sync=WatchlistSync(self.q,lambda op:dict(status='committed',registry_revision=op['expected_registry_revision']+1))
 def ingest(self,w):
  raw=json.dumps(w).encode();g=dict(repo='Adrian-share/foodmap',ref='fact-18/beijing-content-003',path='content/watchlists/beijing.json',commit_sha='a'*40,sha256=hashlib.sha256(raw).hexdigest(),observed_at='2026-11-20T02:00:00Z')
  return self.sync.ingest(raw,g)
 def test_activated_list_supplies_new_account_anchor_without_runtime_static_change(self):
  self.assertEqual(self.ingest(self.w)['state'],'activated')
  plan=Scanner(self.q,lambda *_:None,anchors=[]).plan();s=next(s for s in plan if s['type']=='season');self.assertEqual(s['anchor_bvid'],BV)
  self.assertEqual(self.q.get('watchlist')['registry_revision'],1)
 def test_invalid_version_preserves_last_good_and_cursors_and_disable_preserves_history(self):
  self.assertEqual(self.ingest(self.w)['state'],'activated');sc=Scanner(self.q,lambda *_:None,anchors=[]);key=Scanner.key(next(s for s in sc.plan() if s['type']=='season'));cur=dict(page=2,next_retry_at=999,last_success={'page':1},failures=2);self.q.save_cursor(key,cur);old=self.q.get('watchlist')
  for mutate in [lambda w:w['sources'][0]['collection_anchors'].append(dict(season_id=SID,bvid=BV)),lambda w:w['sources'][0]['collection_anchors'][0].update(season_id='1'),lambda w:w['sources'][0]['collection_anchors'][0].update(bvid='https://evil.test'),lambda w:w['sources'][0]['collection_anchors'][0].update(uid='1')]:
   w=copy.deepcopy(self.w);mutate(w);self.assertEqual(self.ingest(w)['state'],'invalid_watchlist');self.assertEqual(self.q.get('watchlist'),old);self.assertEqual(self.q.cursor(key),cur)
  w=copy.deepcopy(self.w);w['sources'][0]['enabled']=False;self.assertEqual(self.ingest(w)['state'],'activated');self.assertEqual(sc.plan(),[]);self.assertEqual(self.q.cursor(key),cur)
 def test_source_refusal_retains_success_and_other_source_provenance_merges(self):
  self.assertEqual(self.ingest(self.w)['state'],'activated');s=next(s for s in Scanner(self.q,None,anchors=[]).plan() if s['type']=='season');self.assertEqual(s['anchor_bvid'],BV)
  sc=Scanner(self.q,lambda *_:dict(items=[dict(uid=UID,bvid=BV,title='offline')],reached_end=True,url='https://api.bilibili.com/x/web-interface/view',collection=dict(id=SID,uid=UID,anchor_bvid=BV,reported_total=1,read_count=1,payload_sha256='b'*64)),anchors=[]);sc.plan=lambda:[s]
  self.q.discover(UID,BV,1,'old-source','offline',1);self.assertEqual(sc.run()['new'],0);self.assertEqual(len(self.q.jobs()),1);self.assertEqual(len(self.q.videos()[0]['sources']),2)
  key=sc.key(s);cur=self.q.cursor(key);cur['next_retry_at']=0;self.q.save_cursor(key,cur)
  def denied(*_):raise SourceFailure('official_source_restricted',http_status=200,business_code=-352)
  sc.fetch_page=denied;self.assertEqual(sc.run()['restricted'],1);self.assertEqual(self.q.cursor(key)['last_success'],cur['last_success']);self.assertEqual(len(self.q.jobs()),1)
