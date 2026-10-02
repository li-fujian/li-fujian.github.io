import importlib.util
import sys
import unittest
from datetime import date
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location(
    "kc50", Path(__file__).resolve().parents[1] / "scripts/build_strategy.py"
)
strategy = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = strategy
spec.loader.exec_module(strategy)


class CompletedWeekTests(unittest.TestCase):
    def count(self, dates, reference):
        daily = [strategy.DailyBar(d, 100, 100, 110, 90, 1000) for d in dates]
        weekly = strategy.aggregate_weekly(daily)
        return strategy.completed_week_count(daily, weekly, as_of=date.fromisoformat(reference))

    def test_holiday_shortened_weeks(self):
        for last in ("2026-04-30", "2026-06-18", "2026-09-24", "2026-09-30"):
            with self.subTest(last=last):
                self.assertEqual(self.count([last], last), 1)

    def test_do_not_complete_a_week_with_another_session_remaining(self):
        for last in ("2026-09-23", "2026-09-28", "2026-09-29"):
            with self.subTest(last=last):
                self.assertEqual(self.count([last], last), 0)

    def test_friday_and_prior_weeks(self):
        self.assertEqual(self.count(["2026-09-18"], "2026-09-18"), 1)
        self.assertEqual(self.count(["2026-09-24", "2026-09-28"], "2026-09-28"), 1)
        self.assertEqual(self.count(["2026-09-24"], "2026-09-28"), 1)

    def test_empty_input(self):
        self.assertEqual(strategy.completed_week_count([], []), 0)


if __name__ == "__main__":
    unittest.main()
