"""Render a reviewable preview plist to stdout; loading is coordinator-owned."""
from pathlib import Path
import plistlib
import sys
root=Path(__file__).resolve().parents[2]
state=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else root/'.agent-state/launchd-preview'
plist={'Label':'com.adrian.foodmap-agent-preview','ProgramArguments':[str(root/'tools/venv/bin/python'),'-m','foodmap_agent','--state',str(state),'serve','--offline'],
       'WorkingDirectory':str(root),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':15,
       'StandardOutPath':str(state/'stdout.log'),'StandardErrorPath':str(state/'stderr.log'),
       'EnvironmentVariables':{'PATH':'/usr/bin:/bin','PYTHONUNBUFFERED':'1'}}
sys.stdout.buffer.write(plistlib.dumps(plist))
