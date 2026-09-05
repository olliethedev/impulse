#!/usr/bin/env python3
"""Isolated Linux installer failures; no real scheduler or container is used."""
import json,os,pathlib,subprocess,tempfile
with tempfile.TemporaryDirectory(prefix='review-install-') as directory:
 root=pathlib.Path(directory);(root/'scripts').mkdir();(root/'dist').mkdir();(root/'bin').mkdir()
 source=(pathlib.Path(__file__).resolve().parents[1]/'scripts/install-local.sh').read_bytes()
 (root/'scripts/install-local.sh').write_bytes(source)
 destination=root/'installed/impulse';destination.parent.mkdir()
 (root/'.impulse-install.json').write_text(json.dumps({'destination':str(destination),'harness':'codex'}))
 cli='''#!/bin/bash
printf '%s\\n' "$*" >> "$FIXTURE_TRACE"
case "$1 $2" in
 'daemon status') printf '{"data":{"running":true}}\\n';;
 *) printf '{"ok":true,"data":{}}\\n';;
esac
'''
 destination.write_text(cli);destination.chmod(0o755)
 (root/'dist/impulse').write_text(cli);(root/'dist/impulse').chmod(0o755)
 engine=root/'bin/container';engine.write_text('#!/bin/sh\nif [ "$1" = info ];then echo false;fi\nexit 0\n');engine.chmod(0o755)
 copy=root/'bin/cp';copy.write_text('#!/bin/sh\necho "fixture: destination write failed" >&2\nexit 1\n');copy.chmod(0o755)
 trace=root/'calls'
 result=subprocess.run(['bash',str(root/'scripts/install-local.sh')],env={**os.environ,'CONTAINER_ENGINE':str(engine),'PATH':str(root/'bin')+':'+os.environ['PATH'],'FIXTURE_TRACE':str(trace)},text=True,capture_output=True,timeout=10)
 calls=trace.read_text().splitlines()
 assert result.returncode==1 and destination.read_text()==cli, result
 assert not any('daemon stop' in call for call in calls), calls
 copy.unlink();trace.unlink()
 rename=root/'bin/mv';rename.write_text('#!/bin/sh\necho "fixture: rename failed" >&2\nexit 1\n');rename.chmod(0o755)
 result=subprocess.run(['bash',str(root/'scripts/install-local.sh')],env={**os.environ,'CONTAINER_ENGINE':str(engine),'PATH':str(root/'bin')+':'+os.environ['PATH'],'FIXTURE_TRACE':str(trace)},text=True,capture_output=True,timeout=10)
 calls=trace.read_text().splitlines()
 assert result.returncode==1 and destination.read_text()==cli, result
 assert calls[-2:]==['daemon stop --json','daemon start --json'], calls
 print('PASS: failed preparation preserves running dispatch; failed replacement restores it')
