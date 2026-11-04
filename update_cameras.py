#!/usr/bin/env python3
"""Fetch public camera records without executing JavaScript; preserve the old file on failure."""
import argparse
import datetime as dt
import hashlib
import html
import json
import math
import os
from pathlib import Path
import re
import tempfile
import urllib.request
from zoneinfo import ZoneInfo

SOURCE = 'https://www.jinjing365.com/wap/'
RECORD = re.compile(
    r"name:\s*'((?:\\.|[^'\\])*)',\s*position:\s*\[([\d.]+),\s*([\d.]+)\],"
    r"\s*aa:\s*'([^']*)',\s*time:\s*'([^']*)',\s*href:\s*'(/wap/content/\?\d+\.html)'",
    re.S,
)

def parse_source(text, previous=None, now=None):
    dates = re.findall(r'(20\d{2}-\d{2}-\d{2})更新', text)
    if not dates:
        raise ValueError('Source update date not found; keeping existing snapshot')
    updated = dates[0]
    dt.date.fromisoformat(updated)
    cameras = []
    for name, lng, lat, category, date, url in RECORD.findall(text):
        point = [float(lng), float(lat)]
        if not all(math.isfinite(n) for n in point) or not (70 < point[0] < 140 and 0 < point[1] < 60):
            raise ValueError('Invalid camera coordinate')
        dt.date.fromisoformat(date)
        if date > updated:
            raise ValueError('Record date newer than source date')
        name = html.unescape(re.sub(r"\\([\\'\"nrt])", lambda m: {'n':'\n','r':'\r','t':'\t'}.get(m[1], m[1]), name)).strip()
        if not name:
            raise ValueError('Empty camera name')
        cameras.append(dict(name=name, gcj=point, category=category, updated=date, url='https://www.jinjing365.com'+url))
    expected = len(re.findall(r'\bposition:\s*\[', text))
    if len(cameras) < 1000 or len(cameras) != expected:
        raise ValueError(f'Incomplete source: parsed {len(cameras)} of {expected} records')
    if previous:
        if updated < previous['updated']:
            raise ValueError('Source date regressed; keeping existing snapshot')
        if len(cameras) < len(previous['cameras']) * .95:
            raise ValueError('Camera count fell by more than 5%; manual review required')
    content = json.dumps(cameras, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
    now = now or dt.datetime.now(dt.timezone.utc)
    return dict(schemaVersion=1, source=SOURCE, updated=updated,
                fetched=now.astimezone(ZoneInfo('Asia/Shanghai')).date().isoformat(),
                fetchedAt=now.astimezone(dt.timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z'),
                revision=hashlib.sha256(content).hexdigest()[:20], coordinateSystem='GCJ-02', cameras=cameras)

def update(output, source_file=None):
    previous = json.loads(output.read_text()) if output.exists() else None
    if source_file:
        text = source_file.read_text()
    else:
        request = urllib.request.Request(SOURCE, headers={'User-Agent':'Jinglu-camera-sync/1.0 (+https://jasonzhang1986.github.io/jinglu/)'})
        with urllib.request.urlopen(request, timeout=45) as response:
            if response.status != 200:
                raise ValueError('Camera source returned HTTP '+str(response.status))
            text = response.read(8_000_001)
            if len(text) > 8_000_000:
                raise ValueError('Unexpected source size')
            text = text.decode('utf-8-sig')
    snapshot = parse_source(text, previous)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=output.parent, delete=False) as stream:
            temporary = stream.name
            json.dump(snapshot, stream, ensure_ascii=False, separators=(',', ':'))
            stream.write('\n')
        os.replace(temporary, output)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
    print(f"Source updated {snapshot['updated']}; {len(snapshot['cameras'])} cameras; revision {snapshot['revision']}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parent/'cameras.json')
    parser.add_argument('--source-file', type=Path)
    args = parser.parse_args()
    update(args.output, args.source_file)
