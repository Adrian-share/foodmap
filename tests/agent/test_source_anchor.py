"""Offline planning, cursor and outcome regressions; no live state or requests."""
import json,tempfile,unittest
from pathlib import Path
from foodmap_agent.queue import Store
from foodmap_agent.scheduler import Scanner,NodeCollector
from foodmap_agent.status import snapshot

UID='3546728118618546';SID='5780378';ANCHOR='BV1NG6kYTEXG';NEW='BV1abcde2345'
BINDING=[dict(uid=UID,season_id=SID,bvid=ANCHOR)]
class AnchoredSource(unittest.TestCase):
 def setup_store(self):
  tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);q=Store(tmp.name);self.addCleanup(q.close)
  q.set('watchlist',dict(registry_revision=2,watchlist=dict(sources=[dict(uid=UID,enabled=True,season_ids=[SID,'123'])],video_links=[])))
  q.db.execute('INSERT INTO videos VALUES (?,?,?,?,?)',(ANCHOR,UID,'old known anchor','[]','published'))
  return q
 def test_known_anchor_still_discovers_new_collection_entry_and_replay_defers(self):
  q=self.setup_store();calls=[]
  def page(source,p):
   calls.append((source,p));return dict(url='https://api.bilibili.com/x/web-interface/view?bvid='+ANCHOR,reached_end=True,items=[dict(uid=UID,bvid=ANCHOR,title='old'),dict(uid=UID,bvid=NEW,title='new')],collection=dict(id=SID,uid=UID,anchor_bvid=ANCHOR,reported_total=2,read_count=2,payload_sha256='a'*64))
  scanner=Scanner(q,page,anchors=BINDING);plan=scanner.plan();target=next(s for s in plan if s.get('anchor_bvid'))
  self.assertFalse(any(s['type']=='season' and s['id']==SID and not s.get('anchor_bvid') for s in plan))
  old=dict(uid=UID,type='season',id=SID);old_cursor=dict(page=4,next_retry_at=123,last_success={'page':3},failures=2)
  q.save_cursor(Scanner.key(old),old_cursor)
  scanner.plan=lambda:[target]
  r=scanner.run();self.assertEqual(r['new'],1);self.assertEqual(r['ok'],1)
  self.assertEqual(len(q.jobs()),1);self.assertEqual(q.jobs()[0]['bvid'],NEW)
  cursor=q.cursor(Scanner.key(target));self.assertEqual(cursor['last_success']['collection']['read_count'],2)
  self.assertEqual(snapshot(q)['accounts'][0]['url'],'https://api.bilibili.com/x/web-interface/view?bvid='+ANCHOR)
  self.assertEqual(q.cursor(Scanner.key(old))['page'],4)
  self.assertEqual(scanner.run()['deferred'],1);self.assertEqual(len(calls),1);self.assertEqual(q.cursor(Scanner.key(target)),cursor)
  self.assertEqual(snapshot(q)['run']['outcome'],'backoff_unchecked')
 def test_disabled_source_or_removed_season_does_not_schedule_anchor(self):
  q=self.setup_store();scanner=Scanner(q,lambda *_:None,anchors=BINDING)
  self.assertTrue(any(s.get('anchor_bvid') for s in scanner.plan()))
  w=q.get('watchlist');w['watchlist']['sources'][0]['season_ids']=['123'];q.set('watchlist',w)
  self.assertFalse(any(s.get('anchor_bvid') for s in scanner.plan()))
  w['watchlist']['sources'][0]['enabled']=False;q.set('watchlist',w);self.assertEqual(scanner.plan(),[])
 def test_anchor_metadata_without_collection_proof_is_not_success(self):
  q=self.setup_store();scanner=Scanner(q,lambda *_:dict(url='https://api.bilibili.com/x/web-interface/view',reached_end=True,items=[dict(uid=UID,bvid=NEW)]),anchors=BINDING)
  target=next(s for s in scanner.plan() if s.get('anchor_bvid'));scanner.plan=lambda:[target]
  self.assertEqual(scanner.run()['failed'],1);self.assertEqual(q.jobs(),[])
 def test_restriction_preserves_http_business_code_and_is_not_no_new(self):
  from foodmap_agent.scheduler import SourceFailure
  q=self.setup_store()
  def fail(*_):raise SourceFailure('official_source_restricted',http_status=200,business_code=-352)
  scanner=Scanner(q,fail,anchors=[]);target=dict(uid=UID,type='season',id=SID);scanner.plan=lambda:[target]
  r=scanner.run();self.assertEqual(r['restricted'],1);self.assertEqual(r['failed'],0)
  c=q.cursor(Scanner.key(target));self.assertEqual(c['http_status'],200);self.assertEqual(c['business_code'],-352)
  self.assertEqual(snapshot(q)['run']['outcome'],'source_restricted');self.assertEqual(snapshot(q)['run']['sources_restricted'],1)
