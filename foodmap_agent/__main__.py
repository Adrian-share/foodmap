import argparse
import json
from pathlib import Path
import os
from .queue import Store
from .service import Service

def main():
    parser = argparse.ArgumentParser(description='Foodmap Python/Pi preview service; does not switch production scheduling.')
    parser.add_argument('--state', type=Path, required=True, help='Dedicated state directory; use an isolated path for tests')
    parser.add_argument('--node', type=Path)
    parser.add_argument('--model-config', type=Path, help='Explicit private 0600 project model JSON')
    parser.add_argument('--mode',choices=('preview','production','draining'),default='preview',help='Only production publishes; coordinator must first pause the legacy scheduler')
    parser.add_argument('--upload-config', type=Path, help='Explicit private ingest.env; never passed to Pi')
    sub = parser.add_subparsers(dest='command', required=True)
    serve = sub.add_parser('serve')
    serve.add_argument('--offline', action='store_true', help='Only real Pi control/heartbeats; no discovery or model task')
    serve.add_argument('--duration', type=float, help='Foreground diagnostic duration in seconds')
    for name in ('status', 'run-once', 'sync-watchlist', 'export-report'):
        p = sub.add_parser(name)
        p.add_argument('--json', action='store_true')
    args = parser.parse_args()
    store = Store(args.state)
    root = Path(__file__).resolve().parents[1]
    try:
        if args.command == 'serve':
            Service(store, root, args.node, args.model_config, args.upload_config,
                    os.environ.get('FOODMAP_GITHUB_TOKEN'),mode=args.mode).serve(offline=args.offline, duration=args.duration)
        elif args.command == 'run-once':
            store.set('run_once_requested', True)
            print(json.dumps({'state': 'enqueued', 'scheduler_started': False}))
        elif args.command == 'sync-watchlist':
            # Request work from the existing owner; never create a second scheduler.
            store.set('sync_requested', True)
            print(json.dumps({'state': 'enqueued', 'scheduler_started': False}))
        elif args.command == 'status':
            print(json.dumps(store.get('service', {'state': 'not_started'}), ensure_ascii=False))
        else:
            print(json.dumps({'service': store.get('service'), 'baseline': store.get('baseline'),
                              'watchlist_sync': store.get('watchlist_sync'), 'cursors': store.cursors(),
                              'jobs': store.jobs(), 'receipts': store.receipts()}, ensure_ascii=False))
    finally:
        store.close()

if __name__ == '__main__':
    main()
