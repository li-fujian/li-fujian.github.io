import sys
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from update_study_klines import prior_close, proportional_factor, shift_for


class AdjustmentMethods(unittest.TestCase):
    def test_another_dividend_splits_subtractive_qfq_from_yahoo_adjclose(self):
        # Documented Hundsun prints, plus one more 0.20 cash dividend after a 20.40 close.
        # Subtractive qfq and Yahoo's proportional adjclose then differ by more than 0.06,
        # so a fixed gap between those two series must not reject the rebuild.
        raw_closes = {
            "2026-05-18": Decimal("26.66"),
            "2026-06-08": Decimal("22.26"),
            "2026-10-21": Decimal("20.13"),
            "2026-11-16": Decimal("20.40"),
        }
        dividends = [
            ("2026-06-09", Decimal("0.20")),
            ("2026-10-22", Decimal("0.05")),
            ("2026-11-17", Decimal("0.20")),
        ]
        raw = raw_closes["2026-05-18"]
        subtractive = raw - shift_for("2026-05-18", dividends)
        proportional = raw * proportional_factor("2026-05-18", dividends, raw_closes)
        self.assertEqual(subtractive, Decimal("26.21"))
        self.assertGreater(abs(subtractive - proportional), Decimal("0.06"))
        self.assertLess(abs(proportional - Decimal("26.0964")), Decimal("0.001"))
        self.assertLess(abs(raw * proportional_factor("2026-05-18", dividends, raw_closes) - proportional), Decimal("0.02"))

    def test_current_hundsun_factor_matches_the_known_adjclose(self):
        raw_closes = {
            "2026-05-18": Decimal("26.66"),
            "2026-06-08": Decimal("22.26"),
            "2026-10-21": Decimal("20.13"),
        }
        dividends = [
            ("2026-06-09", Decimal("0.20")),
            ("2026-10-22", Decimal("0.05")),
        ]
        proportional = Decimal("26.66") * proportional_factor("2026-05-18", dividends, raw_closes)
        self.assertLess(abs(proportional - Decimal("26.3548")), Decimal("0.001"))
        self.assertEqual(prior_close("2026-11-17", {"2026-11-16": Decimal("20.40")}), Decimal("20.40"))


if __name__ == "__main__":
    unittest.main()
