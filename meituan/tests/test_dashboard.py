import copy
import importlib.util
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("update_dashboard", ROOT / "scripts/update_dashboard.py")
u = importlib.util.module_from_spec(spec)
spec.loader.exec_module(u)
FIXTURE = ROOT / "research/2026-10-03/raw-fixture"
NOW = datetime.fromisoformat("2026-10-03T01:00:00+08:00")


class DashboardTests(unittest.TestCase):
    def setUp(self):
        self.raw = {name: (FIXTURE/name).read_text(encoding="utf-8") for name in u.URLS}
        self.fin = json.loads((ROOT/'data/fundamentals.json').read_text(encoding="utf-8"))

    def build(self):
        return u.build(self.raw, NOW, self.fin)

    def mutate_bars(self, period, fn):
        name = f'tencent_{period}.json'
        data = json.loads(self.raw[name])
        fn(data['data']['hk03690'][period])
        self.raw[name] = json.dumps(data)

    def test_verified_snapshot(self):
        d = self.build()
        self.assertEqual(d['quote']['close'], 70.2)
        self.assertEqual(d['quote']['volume'], 22485255)
        self.assertEqual(d['meta']['confirmed_week'], '2026-10-02')
        self.assertEqual(d['audit']['daily_weekly_matched'], 135)
        self.assertAlmostEqual(d['technical']['ma20'], 78.7825)
        self.assertAlmostEqual(d['technical']['ma60'], 89.585833)
        self.assertAlmostEqual(d['technical']['hist'], -1.43156)
        self.assertEqual(d['technical']['legacy_failure']['date'], '2026-09-25')
        self.assertEqual(d['technical']['below'], ['5','10','20','30','60'])
        self.assertEqual(d['technical']['week_sessions'], 4)

    def test_quote_disagreement_rejected(self):
        self.raw['sina_quote.txt'] = self.raw['sina_quote.txt'].replace(',70.200,', ',70.300,', 1)
        with self.assertRaisesRegex(ValueError, '不一致'): self.build()

    def test_ohlc_invalid_rejected(self):
        self.mutate_bars('day', lambda rows: rows[-1].__setitem__(4, '999'))
        with self.assertRaisesRegex(ValueError, 'OHLC'): self.build()

    def test_volume_unit_error_rejected(self):
        self.mutate_bars('week', lambda rows: rows[-1].__setitem__(5, '1049702.87'))
        with self.assertRaisesRegex(ValueError, '成交量'): self.build()

    def test_missing_day_rejected(self):
        self.mutate_bars('day', lambda rows: rows.pop(-2))
        with self.assertRaisesRegex(ValueError, '缺少交易日'): self.build()

    def test_duplicate_rejected(self):
        self.mutate_bars('week', lambda rows: rows.append(rows[-1]))
        with self.assertRaisesRegex(ValueError, '重复'): self.build()

    def test_stale_and_unknown_calendar_rejected(self):
        with self.assertRaisesRegex(ValueError, '最近收盘交易日'):
            u.build(self.raw, datetime.fromisoformat('2026-10-05T17:00:00+08:00'), self.fin)
        with self.assertRaisesRegex(ValueError, '日历'):
            u.latest_closed_session(datetime.fromisoformat('2027-01-04T17:00:00+08:00'))

    def test_hk_holidays_and_half_day(self):
        for now, expected in [('2026-10-02T17:00:00+08:00','2026-10-02'),
                              ('2026-10-01T17:00:00+08:00','2026-09-30'),
                              ('2026-02-16T12:10:00+08:00','2026-02-13'),
                              ('2026-02-16T12:16:00+08:00','2026-02-16')]:
            self.assertEqual(u.latest_closed_session(datetime.fromisoformat(now)).isoformat(), expected)
        self.assertEqual(u.week_end('2026-04-02').isoformat(), '2026-04-02')

    def test_incomplete_week_uses_previous_confirmed_week(self):
        # Reconstruct the same raw feed as at Wednesday, with matching quote snapshots.
        daydoc=json.loads(self.raw['tencent_day.json'])
        rows=daydoc['data']['hk03690']['day']
        rows[:]=[r for r in rows if r[0]<='2026-09-30']
        self.raw['tencent_day.json']=json.dumps(daydoc)
        weekdoc=json.loads(self.raw['tencent_week.json'])
        week=weekdoc['data']['hk03690']['week']
        current=[r for r in rows if r[0]>='2026-09-28']
        week[-1]=['2026-09-30', current[0][1],current[-1][2],
                  str(max(float(r[3]) for r in current)),str(min(float(r[4]) for r in current)),
                  str(sum(float(r[5]) for r in current))]
        self.raw['tencent_week.json']=json.dumps(weekdoc)
        r=rows[-1]
        for name,sep in [('tencent','~'),('sina',',')]:
            original=self.raw[name+'_quote.txt'];parts=original.split('"')[1].split(sep)
            if name=='tencent':
                for i,value in {3:r[2],4:rows[-2][2],5:r[1],6:r[5],30:'2026/09/30 16:08:15',33:r[3],34:r[4],37:str(float(r[5])*float(r[2]))}.items(): parts[i]=value
            else:
                for i,value in {2:r[1],3:rows[-2][2],4:r[3],5:r[4],6:r[2],11:str(float(r[5])*float(r[2])),12:r[5],17:'2026/09/30',18:'16:08:15'}.items(): parts[i]=value
            self.raw[name+'_quote.txt']=original.split('"')[0]+'"'+sep.join(parts)+'";'
        result=u.build(self.raw,datetime.fromisoformat('2026-09-30T17:00:00+08:00'),self.fin)
        self.assertFalse(result['meta']['latest_week_complete'])
        self.assertEqual(result['meta']['confirmed_week'],'2026-09-25')
        self.assertEqual(result['technical']['weekly']['close'],71.65)
        self.assertEqual(result['quote']['close'],71.7)

    def test_rollback_preserves_public_files(self):
        d=self.build()
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);u.publish(d,self.raw,root)
            original={p:p.read_bytes() for p in root.rglob('*') if p.is_file()}
            bad=copy.deepcopy(d);bad['meta']['as_of']='2026-08-24'
            with self.assertRaisesRegex(ValueError,'回退'): u.publish(bad,self.raw,root)
            self.assertEqual(original,{p:p.read_bytes() for p in root.rglob('*') if p.is_file()})

    def test_failure_does_not_publish(self):
        self.raw['sina_quote.txt']='wrong payload'
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);(root/'sentinel').write_text('unchanged')
            with self.assertRaises(ValueError): u.publish(self.build(),self.raw,root)
            self.assertEqual(list(root.iterdir()),[root/'sentinel'])

    def test_nonfinite_rejected(self):
        self.mutate_bars('day',lambda rows: rows[-1].__setitem__(2,'NaN'))
        with self.assertRaisesRegex(ValueError,'非有限数'): self.build()

    def test_financial_totals_and_original_units(self):
        u.validate_financials(self.fin)
        self.assertEqual(self.fin['quarter']['revenue']/100000,1046.43044)
        self.assertEqual(self.fin['half_year']['net_profit']/100000,-46.72036)
        self.fin['segments']['core_local_revenue']+=1
        with self.assertRaisesRegex(ValueError,'收入不平'): u.validate_financials(self.fin)


if __name__=='__main__': unittest.main()
