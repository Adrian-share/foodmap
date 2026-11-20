"""Single acceptance observer. It never creates jobs, Pi, sources or publications."""
import argparse,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from foodmap_agent.p3_acceptance import P3Acceptance,acceptance_window
p=argparse.ArgumentParser();p.add_argument('--expected-release',required=True);p.add_argument('--multica-cli',required=True);p.add_argument('--arm',action='store_true');p.add_argument('--window-start',required=True);p.add_argument('--window-end',required=True);a=p.parse_args()
window=acceptance_window(a.window_start,a.window_end)
state=Path('/Users/adrian/foodmap-agent-state/python-preview');observer=P3Acceptance(state,state/('acceptance/p3-'+window['date'].replace('-','')),a.expected_release,a.multica_cli,window_start=a.window_start,window_end=a.window_end)
if a.arm:observer.run()
else:
 s=observer.snapshot();print(json.dumps(dict(mode='read_only_preflight',production=s['service']['mode'],day=s['day'],used=s['used'],active=[j for j in s['jobs'] if j['stage']=='cleaning'],phase=observer.value['phase'],signals_sent=0)))
