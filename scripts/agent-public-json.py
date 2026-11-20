"""One fixed public POI operation. No arbitrary URL, credentials, shell or file input."""
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlencode
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from foodmap_agent.http_client import read_public_json,PublicHTTPError

def poi_operation(value,reader=read_public_json):
    if (not isinstance(value,dict) or set(value)!={'operation','query'} or value['operation']!='poi'
            or not isinstance(value['query'],str) or not value['query'].strip() or len(value['query'])>80
            or any(ord(c)<32 or ord(c)==127 for c in value['query'])):
        raise ValueError('invalid_public_request')
    return reader('/api/content/poi?'+urlencode({'q':value['query']}),max_bytes=512*1024)

if __name__=='__main__':
    try:
        raw=sys.stdin.buffer.read(4097)
        if len(raw)>4096:raise ValueError('invalid_public_request')
        result=poi_operation(json.loads(raw))
        print(json.dumps(dict(ok=True,data=result,transport=dict(python=sys.executable,env_keys=sorted(os.environ),model_key_present='FOODMAP_MODEL_API_KEY' in os.environ,upload_key_present='FOODMAP_INGEST_TOKEN' in os.environ)),ensure_ascii=False,separators=(',',':')))
    except PublicHTTPError as error:
        print(json.dumps(dict(ok=False,error_code='public_http_'+str(error.status))))
    except ValueError as error:
        code='public_body_too_large' if str(error)=='public_body_too_large' else 'invalid_public_request'
        print(json.dumps(dict(ok=False,error_code=code)))
    except Exception:
        print(json.dumps(dict(ok=False,error_code='public_network_error')))
