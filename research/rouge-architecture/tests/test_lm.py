"""R1.14 language-model stack: streaming exactness, data streams, floors."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    import torch

    from benchmarks import text
    from prototypes import lm
except ImportError:  # torch missing: the CI test job installs it
    torch = None


@unittest.skipIf(torch is None, "torch not installed")
class TestLM(unittest.TestCase):
    def test_streaming_is_exact(self):
        """Reading 256 bytes at once equals reading them in two halves with the state carried."""
        torch.manual_seed(0)
        x = torch.randint(0, 256, (2, 256))
        for model in (lm.RougeLM(d=64, layers=2, heads=4, slots=4, block=64),
                      lm.RougeLM(d=64, layers=2, heads=4, slots=0, block=64),
                      lm.LSTMLM(d=64, layers=2)):
            model.eval()
            with torch.no_grad():
                whole, _ = model(x, model.init_state(2))
                first, state = model(x[:, :128], model.init_state(2))
                second, _ = model(x[:, 128:], state)
            self.assertLess((whole - torch.cat([first, second], 1)).abs().max().item(), 1e-5, type(model).__name__)

    def test_causal(self):
        """Changing a future byte never changes an earlier prediction."""
        torch.manual_seed(1)
        x = torch.randint(0, 256, (1, 192))
        y = x.clone()
        y[0, 150] = (y[0, 150] + 1) % 256
        for model in (lm.TransformerLM(d=64, layers=2, heads=4), lm.RougeLM(d=64, layers=2, heads=4, slots=4, block=64),
                      lm.LSTMLM(d=64, layers=1)):
            model.eval()
            with torch.no_grad():
                a, _ = model(x)
                b, _ = model(y)
            self.assertLess((a[0, :150] - b[0, :150]).abs().max().item(), 1e-5, type(model).__name__)
            self.assertGreater((a[0, 150:] - b[0, 150:]).abs().max().item(), 0.0, type(model).__name__)

    def test_state_is_constant_in_length(self):
        model = lm.RougeLM(d=64, layers=2, heads=4, slots=4, block=64)
        self.assertEqual(model.memory_bytes(1024), model.memory_bytes(1 << 17))
        self.assertLess(sum(model.memory_bytes(4096).values()), sum(lm.TransformerLM(d=64, layers=2, heads=4).memory_bytes(4096).values()))

    def test_streams_walk_forward_and_restore(self):
        data = torch.arange(100_000, dtype=torch.int64) % 256
        s = text.Streams(data, batch=4, length=32, seed=3, span=10 * 32)
        x1, reset = s.next()
        self.assertEqual(x1.shape, (4, 33))
        self.assertFalse(reset.any())
        saved = s.state()
        x2, _ = s.next()
        self.assertTrue(torch.equal(x2[:, 0], x1[:, -1]))  # the next segment starts where the last one ended
        s.restore(saved)
        x2b, _ = s.next()
        self.assertTrue(torch.equal(x2, x2b))

    def test_ngram_floor_orders(self):
        data = torch.tensor(list(b"abcabcabcabcabcabc" * 200), dtype=torch.uint8)
        self.assertLess(text.ngram_floor(data, data[:300], 3), text.ngram_floor(data, data[:300], 1))

    def test_ternary_is_counted_packed(self):
        dense, tern = lm.TransformerLM(d=64, layers=2, heads=4), lm.TransformerLM(d=64, layers=2, heads=4, ternary=True)
        self.assertLess(lm.stored_bytes(tern), 0.5 * lm.stored_bytes(dense))


if __name__ == "__main__":
    unittest.main()
