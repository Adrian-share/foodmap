import unittest
from foodmap_agent.pipeline import Pipeline
from foodmap_agent.publisher import Publisher

class PipelineAcceptance(unittest.TestCase):
    def test_R1_unknown_receipt_is_reconciled_before_retry(self):
        from foodmap_agent.queue import Store
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as d:
            store=Store(d)
            calls=[]
            def operator(body):
                calls.append(body['operation'])
                if body['operation']=='receipt.get':
                    return {'status':'committed','request_id':body['target_request_id']}
                raise AssertionError('must not resend committed operation')
            publisher=Publisher(store,operator)
            body={'schema_version':1,'operation':'release.commit','request_id':'11111111-1111-4111-8111-111111111111'}
            store.prepare(body['request_id'],body)
            r=publisher.send(body)
            self.assertEqual(r['status'],'committed')
            self.assertEqual(calls,['receipt.get'])
            store.close()

    def test_R1_full_python_publisher_reconciles_lost_commit_and_preserves_previous_snapshot(self):
        import base64,json,subprocess
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from foodmap_agent.queue import Store
        root=Path(__file__).resolve().parents[2]
        node=root/'tools/node-v22.23.5-darwin-arm64/bin/node'
        proc=subprocess.Popen([str(node),'tests/fixtures/publication-rpc.cjs'],cwd=root,stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
        def request(body):
            proc.stdin.write(json.dumps(body)+'\n');proc.stdin.flush()
            result=json.loads(proc.stdout.readline())
            if result.get('transport_error'):raise RuntimeError(result['transport_error'])
            return result
        try:
            with TemporaryDirectory() as state:
                store=Store(state);store.seed(root)
                lost=[True]
                calls=[]
                def operator(body):
                    r=request(body);calls.append(body['operation'] if body else 'GET')
                    if body and body['operation']=='release.commit' and lost[0]:
                        lost[0]=False;raise TimeoutError('response_lost_after_success')
                    return r
                publisher=Publisher(store,operator)
                def data(name,seed=50):
                    fixture=request({'fixture':name,'seed':seed})
                    fixture.pop('input');fixture.pop('private_frames')
                    for d in fixture['documents']:d['bytes']=base64.b64decode(d.pop('data'))
                    for i in fixture['images']:i['data']=base64.b64decode(i['data'])
                    return fixture
                args=dict(source_commit='a'*40,registry_revision=1,baseline_version=store.get('baseline')['version'])
                fixture=data('first')
                with self.assertRaises(TimeoutError):publisher.publish(**fixture,**args)
                pointer=request(None)['current_publication']
                self.assertIsNotNone(pointer)
                before=calls.count('release.commit')
                store.close();store=Store(state);publisher=Publisher(store,operator)
                receipt=publisher.publish(**fixture,**args)
                self.assertEqual(receipt['status'],'committed')
                self.assertEqual(calls.count('release.commit'),before)
                self.assertIn('receipt.get',calls)
                replacement=data('first',80)
                publisher.publish(**replacement,**args)
                revised=request(None)['current_publication']
                revised_manifest=store.get('publication_manifests')[revised['data_version']]
                self.assertEqual(len(revised_manifest['images']),1)
                self.assertEqual(revised_manifest['images'][0]['sha256'],replacement['images'][0]['sha256'])
                self.assertTrue(request({'inspect':fixture['images'][0]['path'].replace('content/','public/')})['exists'])
                self.assertTrue(request({'inspect':'public/releases/'+pointer['data_version']+'.json'})['exists'])
                second=data('second')
                publisher.publish(**second,**args)
                latest=request(None)['current_publication']
                self.assertEqual(latest['generation'],3)
                manifest=store.get('publication_manifests')[latest['data_version']]
                self.assertEqual(len(manifest['records']),2)
                self.assertEqual(len(manifest['images']),2)
                store.close()
        finally:
            proc.stdin.close();proc.wait(timeout=10);proc.stdout.close()


    def test_C3_only_record_referenced_frame_is_in_public_images(self):
        import base64,hashlib,json,subprocess
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from foodmap_agent.queue import Store
        root=Path(__file__).resolve().parents[2]
        node=root/'tools/node-v22.23.5-darwin-arm64/bin/node'
        result=subprocess.run([str(node),'tests/fixtures/publication-rpc.cjs'],input=json.dumps({'fixture':'one-public-frame','extra_frame':True})+'\n',cwd=root,capture_output=True,text=True,check=True)
        fixture=json.loads(result.stdout)
        with TemporaryDirectory() as state:
            store=Store(state);evidence=Path(state)/'evidence';evidence.mkdir()
            x=fixture['input'];context={**x['identity'],'root':str(evidence),'evidence':{},'frame_files':{}}
            for i,source in enumerate(x['sources']):
                raw=json.dumps(source['payload'],ensure_ascii=False,separators=(',',':')).encode()
                file='source-'+str(i)+'.json';(evidence/file).write_bytes(raw)
                context['evidence'][source['id']]=dict(file=file,kind=source['kind'],sha256=hashlib.sha256(raw).hexdigest(),source_url=source['source_url'],checked_at=source['checked_at'])
            for image in fixture['private_frames']:
                raw=base64.b64decode(image['data']);file=image['sha256']+'.png';(evidence/file).write_bytes(raw)
                context['frame_files'][image['sha256']]=dict(file=file,sha256=image['sha256'])
            pi_result=dict(proposal=x['proposal'],session_id='fixture',settled={'aborted':False})
            pipeline=Pipeline(store,root,node,lambda _:None,'a'*40)
            verified,images=pipeline.verify({},pi_result,context,{'provider':'ark-coding-plan-cn','model':'doubao-seed-2.1-turbo'})
            self.assertEqual(verified['status'],'approved')
            self.assertEqual(len(context['frame_files']),2)
            self.assertEqual(len(images),1)
            self.assertEqual(images[0]['sha256'],verified['records'][0]['visit']['screenshots'][0]['sha256'])
            self.assertTrue(all((evidence/i['file']).is_file() for i in context['frame_files'].values()))
            store.close()
