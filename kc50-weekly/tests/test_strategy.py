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


if __name__ == "__main__":
    unittest.main()
