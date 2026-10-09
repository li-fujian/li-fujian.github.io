import importlib.util
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location(
    "kc50_strategy", Path(__file__).resolve().parents[1] / "scripts/build_strategy.py"
)
strategy = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = strategy
spec.loader.exec_module(strategy)


def weeks(closes):
    return [
        strategy.WeeklyBar(f"2026-01-{i + 1:02d}", c, c, c, c, 1, i, i)
        for i, c in enumerate(closes)
    ]


class BreakevenGuardTests(unittest.TestCase):
    falling_ma5 = [None, 110.0, 108.0, 106.0, 104.0, 102.0]

    def test_exit_below_cost_buffer_while_ma5_has_not_turned_up(self):
        bars = weeks([100, 100, 100, 100, 97.9, 100])
        self.assertTrue(strategy.breakeven_exit(bars, self.falling_ma5, 2, 4, 100.0))

    def test_hold_within_the_buffer(self):
        bars = weeks([100, 100, 100, 100, 98.1, 100])
        self.assertFalse(strategy.breakeven_exit(bars, self.falling_ma5, 2, 4, 100.0))

    def test_guard_ends_once_ma5_turns_up_after_the_signal_week(self):
        ma5 = [None, 110.0, 108.0, 109.0, 104.0, 102.0]
        bars = weeks([100, 100, 100, 100, 90.0, 100])
        self.assertFalse(strategy.breakeven_exit(bars, ma5, 2, 4, 100.0))

    def test_ma5_rise_before_the_signal_week_does_not_count(self):
        ma5 = [None, 110.0, 111.0, 106.0, 104.0, 102.0]
        bars = weeks([100, 100, 100, 100, 90.0, 100])
        self.assertTrue(strategy.breakeven_exit(bars, ma5, 3, 4, 100.0))

    def test_guard_exit_takes_precedence_over_j_exit(self):
        bars = weeks([100, 100, 100, 100, 97.0, 100])
        j_values = [0, 0, 0, 95.0, 92.0, 0]
        reason = strategy.discretionary_exit_reason(
            bars, j_values, 4, entry_raw_fill=100.0, peak_weekly_close=100.0,
            ma5=self.falling_ma5, signal_idx=2,
        )
        self.assertTrue(reason.startswith("保本离场"))

    def test_signal_week_is_the_week_before_the_fill(self):
        daily = [strategy.DailyBar(d, 1, 1, 1, 1, 1) for d in
                 ("2026-09-17", "2026-09-18", "2026-09-21", "2026-09-22")]
        weekly = strategy.aggregate_weekly(daily)
        self.assertEqual(strategy.signal_week_index(weekly, daily, "2026-09-21"), 0)


class MissedRallyWatchTests(unittest.TestCase):
    # Strict golden cross (MA5 and MA10 both rising) completes at index 20.
    closes = [100] * 12 + [96, 92, 88, 84, 80, 86, 94, 100, 102, 104, 116]

    def test_strict_cross_while_flat_reports_decline_and_rebound(self):
        watch = strategy.missed_rally_watch(weeks(self.closes[:22]), False, None)
        self.assertEqual(watch["cross_week"], "2026-01-21")
        self.assertEqual(watch["decline_pct"], -20.0)
        self.assertEqual(watch["rise_from_low_pct"], 27.5)
        self.assertEqual(watch["since_cross_pct"], 1.96)
        self.assertEqual(watch["level"], "watch")
        self.assertTrue(watch["message"].startswith("观察提示，不是买点"))

    def test_more_than_ten_percent_after_the_cross_escalates(self):
        watch = strategy.missed_rally_watch(weeks(self.closes), False, None)
        self.assertEqual(watch["level"], "alert")

    def test_silent_while_holding(self):
        self.assertIsNone(strategy.missed_rally_watch(weeks(self.closes), True, None))

    def test_cross_formed_before_the_last_exit_was_ridden_not_missed(self):
        self.assertIsNone(strategy.missed_rally_watch(weeks(self.closes), False, "2026-01-22"))
        self.assertIsNotNone(strategy.missed_rally_watch(weeks(self.closes), False, "2026-01-21"))

    def test_cross_with_flat_ma10_is_not_strict(self):
        closes = [100] * 12 + [96, 92, 88, 84, 80, 84, 88, 92, 96, 100, 104]
        self.assertIsNone(strategy.missed_rally_watch(weeks(closes), False, None))

    def test_silent_once_ma5_falls_back_below_ma10(self):
        closes = self.closes + [80, 70, 70]
        self.assertIsNone(strategy.missed_rally_watch(weeks(closes), False, None))


if __name__ == "__main__":
    unittest.main()
