import copy
import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
from update_cameras import parse_source, update

def source(count=1000,date='2026-11-04'):
    rows=[f"{{ name: '公开测试点位{i}', position: [116.4,39.9], aa:'2', time:'{date}', href:'/wap/content/?{i}.html', icon, }}," for i in range(count)]
    return date+'更新\nvar LabelsData = [\n'+'\n'.join(rows)+'\n];'

class SnapshotTests(unittest.TestCase):
    def test_metadata_and_deterministic_revision(self):
        now=dt.datetime(2026,11,4,17,0,tzinfo=dt.timezone.utc)
        data=parse_source(source(),now=now)
        self.assertEqual(data['fetched'],'2026-11-05')
        self.assertEqual(data['fetchedAt'],'2026-11-04T17:00:00Z')
        self.assertEqual(data['revision'],parse_source(source())['revision'])
        self.assertEqual(len(data['cameras']),1000)

    def test_partial_parse_and_abnormal_drop_fail(self):
        previous=parse_source(source(1100))
        with self.assertRaises(ValueError):parse_source(source(),previous)
        with self.assertRaises(ValueError):parse_source(source().replace('position: [116.4,39.9]', 'position: [broken]',1))
        with self.assertRaises(ValueError):parse_source('<html>service unavailable</html>')
        with self.assertRaises(ValueError):parse_source(source(date='2026-10-29'),previous)

    def test_validation_failure_preserves_old_file(self):
        with tempfile.TemporaryDirectory() as d:
            target=Path(d)/'cameras.json';raw=Path(d)/'source.html'
            target.write_text(json.dumps(parse_source(source())));before=target.read_bytes()
            raw.write_text('<html>service unavailable</html>')
            with self.assertRaises(ValueError):update(target,raw)
            self.assertEqual(target.read_bytes(),before)

if __name__=='__main__':unittest.main()
