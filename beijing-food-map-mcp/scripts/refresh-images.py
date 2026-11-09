"""Refresh the ten original Bilibili video covers. Runtime queries stay offline."""
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com/"}


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=25) as response:
        return response.read(), response.headers.get_content_type()


def cover(shop):
    bvid = shop["video"].rstrip("/").split("/")[-1]
    if not re.fullmatch(r"BV[0-9A-Za-z]{10}", bvid):
        raise ValueError("Invalid original video ID: " + bvid)
    api = "https://api.bilibili.com/x/web-interface/view?bvid=" + bvid
    payload, _ = fetch(api)
    response = json.loads(payload)
    if response["code"] != 0:
        raise ValueError(str(response))
    video = response["data"]
    if video["bvid"] != bvid:
        raise ValueError("Video mismatch")
    original = video["pic"].replace("http://", "https://", 1)
    if not re.match(r"^https://i[012]\.hdslb\.com/bfs/archive/", original):
        raise ValueError("Unexpected image host")
    download = original + "@640w_360h_1c.jpg"
    data, content_type = fetch(download)
    if content_type != "image/jpeg" or not data.startswith(b"\xff\xd8\xff"):
        raise ValueError("Expected a real JPEG cover")
    if not 1000 < len(data) < 200000:
        raise ValueError("Unexpected thumbnail size")
    record = {
        "restaurant": shop["name"], "file": bvid + ".jpg", "kind": "video_cover",
        "alt": shop["name"] + " · 原探店视频封面", "source": shop["video"],
        "restaurant_source": shop["source"], "video_id": bvid, "title": video["title"],
        "metadata_source": api, "original_url": original, "download_url": download,
        "mime_type": "image/jpeg", "width": 640, "height": 360, "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }
    return record, data


def main():
    shops = json.loads(subprocess.check_output(
        ["node", "-e", "console.log(JSON.stringify(require('./samples.js').restaurants))"], cwd=ROOT))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        images = list(pool.map(cover, shops))
    directory = ROOT / "assets/images"
    directory.mkdir(parents=True, exist_ok=True)
    for record, data in images:
        (directory / record["file"]).write_bytes(data)
        print(record["restaurant"], record["file"], record["bytes"], "bytes")
    (directory / "manifest.json").write_text(json.dumps(
        [record for record, _ in images], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
