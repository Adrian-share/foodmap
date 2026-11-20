"""Render a reviewable plist only. Installation and legacy cutover belong to the coordinator."""
import argparse
from pathlib import Path
import plistlib
import sys
root=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser()
p.add_argument('state',nargs='?',type=Path,default=root/'.agent-state/launchd-preview')
p.add_argument('--mode',choices=('preview','production','draining'),default='preview')
p.add_argument('--model-config',type=Path)
p.add_argument('--upload-config',type=Path)
p.add_argument('--online',action='store_true')
args=p.parse_args()
if args.mode=='production' and (not args.online or not args.model_config or not args.upload_config):
 p.error('production requires --online and explicit private model/upload configuration; pause legacy scheduling first')
state=args.state.resolve()
argv=[str(root/'tools/venv/bin/python'),'-m','foodmap_agent','--state',str(state),'--mode',args.mode]
for option,file in (('--model-config',args.model_config),('--upload-config',args.upload_config)):
 if file:argv.extend([option,str(file.resolve())])
argv+=['serve']+([] if args.online else ['--offline'])
label='com.adrian.foodmap-agent' if args.mode=='production' else 'com.adrian.foodmap-agent-preview'
plist={'Label':label,'ProgramArguments':argv,'WorkingDirectory':str(root),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':15,
       'StandardOutPath':str(state/'stdout.log'),'StandardErrorPath':str(state/'stderr.log'),
       'EnvironmentVariables':{'PATH':'/usr/bin:/bin','PYTHONUNBUFFERED':'1'}}
sys.stdout.buffer.write(plistlib.dumps(plist))
