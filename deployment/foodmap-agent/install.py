"""Install locked tools inside this checkout. Does not load launchd or edit PATH globally."""
import sys
if sys.version_info < (3, 12):
    raise SystemExit('Python >=3.12 required before installing tools. Use /usr/local/bin/python3 (tested 3.13.3); do not use SSH default Python 3.9.')

import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
from urllib.request import urlopen
import venv

root=Path(__file__).resolve().parents[2]
lock=json.loads((root/'agent/pi/runtime.lock.json').read_text())
if sys.platform!='darwin':raise SystemExit('this runtime lock targets darwin-arm64')
if subprocess.check_output(['sysctl','-n','hw.optional.arm64'],text=True).strip()!='1':raise SystemExit('arm64 hardware required by this lock')
version=lock['node']['version']
name=f'node-v{version}-darwin-arm64'
tools=root/'tools';tools.mkdir(exist_ok=True)
node=tools/name/'bin/node'
if not node.exists():
    with urlopen(f'https://nodejs.org/dist/v{version}/{name}.tar.gz',timeout=60) as response:data=response.read(64*1024*1024)
    if hashlib.sha256(data).hexdigest()!=lock['node']['sha256']:raise SystemExit('node_hash_mismatch')
    archive=tools/(name+'.tar.gz');archive.write_bytes(data)
    with tarfile.open(archive) as tar:tar.extractall(tools,filter='data')
if subprocess.check_output([str(node),'--version'],text=True).strip()!='v'+version:raise SystemExit('node_version_mismatch')
venv.EnvBuilder(with_pip=True).create(tools/'venv')
subprocess.run([str(tools/'venv/bin/python'),'-m','pip','install','-r',str(root/'foodmap_agent/requirements.lock')],check=True)
env={**os.environ,'PATH':str(node.parent)+os.pathsep+os.environ.get('PATH','')}
subprocess.run([str(node),str(node.parent/'npm'),'ci','--ignore-scripts','--prefix',str(root/'agent/pi'),'--registry','https://registry.npmjs.org'],env=env,check=True)
subprocess.run([str(node),str(node.parent/'npm'),'ci','--ignore-scripts','--prefix',str(root),'--registry','https://registry.npmjs.org'],env=env,check=True)
# Native OCR is optional. Source access/clear text are still required by verification.
ocr=subprocess.run(['/usr/bin/xcrun','swiftc','-O',str(root/'agent/pi/frame-ocr.swift'),'-o',str(tools/'frame-ocr')],capture_output=True,check=False)
if ocr.returncode:print('Native frame OCR unavailable; subtitle/frame evidence remains pending when text cannot be verified.')
print('Project tools installed. Production scheduler and launchd unchanged.')
