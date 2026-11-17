C2 v2 accepts a single-venue official Bili description that names a distinguishing
street, an original frame bound to the same BV/P/CID and segment, and exactly one
Beijing AMap brand/street match. Pi only proposes. Independent verification selects
from all registered candidates, never the first result. Conflicting descriptions,
high-confidence bound OCR/subtitles, house numbers, multiple same-street branches,
multi-venue descriptions and uncertain part scope stay pending or excluded.

The fallback is deliberately conservative: one page and one proposed visit, a
description beginning with the venue name and no cross-venue conjunctions. Other
videos can still pass the existing subtitle/OCR rule. Native OCR confidence stays
0.9. No per-BV, per-POI or screenshot hash approval allowlist is used.

Each v2 verification document carries three provenance roles and registered source
hashes: `official_description_street` (also the description text hash),
`original_frame` (also the original image hash), and `unique_amap_street_match`
(selected POI and excluded candidates/reasons). AMap supplies address and GCJ-02;
the Bili official description supplies the short exact quote. The UI labels that
quote as an official description rather than a timestamped spoken opinion.

Protocol schema version and operation names stay at 1. Optional attribution fields
are added to the existing schema and precompiled Worker validators. Existing v1
verification documents replay byte-for-byte. A v2 manifest may preserve v1 records;
every record still replays against its own independent verification document.
Old Worker v11 does not understand the new proof fields: root must deploy the
reviewed source before a v2 release can stage. Uploading blobs cannot switch current.

`scripts/stage3-c2-continuation.py` is a bounded operational task, not a scheduler.
It requires the existing preview service to be stopped and takes its Singleton
lock over the same SQLite state. Without `--publish` it runs one real Pi task and
stores the approved plan at staged. `--publish` resumes that plan without another
model call. Keep the supervised service in preview/legacy until root accepts the
public version, image, three locations, playback and actual MacBook MCP.

Runtime state and evidence archives are private review artifacts, not committed
source. Do not rewrite the previous frozen handoff archives. No video/audio/stream
fragments are saved. Do not read Sites credentials or deploy a parallel site.
