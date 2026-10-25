# Score-reader accuracy corpus

Sheet-music PDFs with known answers (measure count, time signatures, measures per line) used to
test `vendor/score-omr.js`, the reader behind "From Sheet Music".

Generators (need `pip install music21 verovio cairosvg pypdf lilypond`):
- `build_classics.py` – 15 real pieces from the music21 corpus (Bach, Mozart, Haydn, Beethoven, Joplin,
  Schubert, Handel, Verdi, Chopin, Monteverdi, Corelli) engraved with Verovio.
- `build_synthetic.py` – 5/4, 7/8, 6/8, 12/8, 2/2 and mid-piece meter changes with tempo marks.
- `build_validation.py N SEED` – unseen pieces in random SMuFL fonts / sizes / page formats.
- `system_truth.py` – measures per line straight from the engraver, for pinpointing errors.
Scanned and LilyPond variants were made by rasterising with noise/rotation and via musicxml2ly.

Runners:
- `node tests/score-corpus/run_node.js [filter]` – fast, Node only (pdftoppm at 170 dpi).
- `node tests/score_corpus.js <pdfDir> <truth.json> [filter]` – the real app in headless Chromium
  (serve the repo on :8765 first). This is the number that matters.

Results for v1.6.0 inside the app: 30/33 tuning set, 28/30 and 24/30 on two unseen sets
(the misses are mostly rough phone-quality scans, typically off by 1–5 measures).
The previous reader (≤1.5.2) got 1/33.
