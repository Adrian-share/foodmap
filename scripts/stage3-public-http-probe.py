"""Read-only public HTTP compatibility with a truthful project identity."""
import json,sys,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root))
from foodmap_agent.http_client import read_public_json,PublicHTTPError,PUBLIC_HEADERS
report=dict(fixture=False,scope='read-only Cloudflare/application reachability; no cookies or policy changes',user_agent=PUBLIC_HEADERS['User-Agent'])
try:
 with urllib.request.urlopen('https://foodmap.shareworld.fun/healthz',timeout=15) as response:report['default_python']={'status':response.status}
except urllib.error.HTTPError as error:report['default_python']={'status':error.code,'body':error.read(1024).decode(errors='replace')}
except Exception as error:report['default_python']={'error_code':type(error).__name__}
report['identified']={}
for path in ('/healthz','/api/content/current','/api/content/poi?q=%E9%A3%9E%E5%A4%A9%E5%A4%A7%E5%8E%A6'):
 try:report['identified'][path]={'status':200,'value':read_public_json(path)}
 except PublicHTTPError as error:report['identified'][path]={'status':error.status}
 except Exception as error:report['identified'][path]={'error_code':type(error).__name__}
(root/'evidence/FACT-33/public-http-identity.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False))
