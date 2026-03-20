# Repository Guidelines

No hacks, do the right architecture, for example when rendering PDF, rely on PDF spec and custom rendering, do not try to hack leverage some browser api to approximate rendering.
All changes should be from first principles.

Do not run the full test suite for now, it can hang; instead do changes and ask me to run broader verification.
Exception: for any change that affects PDF rendering or layout (parser output, text geometry, canvas rendering, HTML layout conversion, or viewer rendering), always run `npx vitest run tests/pdfLayout.integration.test.ts`.
When adding new feature, create new module/file where new code should go, and in general keep the project organize into smaller component/modules.

## Project Structure & Module Organization
Organize core logic under `src/`, grouped by domain (e.g., `src/agents/decision_engine.py`). Shared helpers belong in `src/common/` with minimal cross-module imports. Mirror the runtime structure in `tests/` (`tests/agents/test_decision_engine.py`) and store fixtures under `tests/fixtures/`. Place reusable scripts in `scripts/` (ensure they are executable) and documentation in `docs/`. Whenever a new module introduces configuration, add a sample to `docs/config-example.yaml`.

## Build, Test, and Development Commands
All contributor workflows live in the `Makefile`. Run `make setup` after cloning to install dependencies into a local virtualenv. `make lint` should chain formatting (Black, isort) and static analysis (ruff, mypy). Use `make test` for the full suite and `make test TEST=tests/agents/test_decision_engine.py` to target a module. If you add new tooling, extend the `Makefile` target and document flags inline.

## Coding Style & Naming Conventions
Follow Python 3.11 conventions with 4-space indentation and UTF-8 source files. Use type hints on public functions and prefer dataclasses for plain data containers. Module names stay snake_case, classes PascalCase, and async helpers end with `_async`. Run `black .` and `ruff check .` before pushing; both are configured via `pyproject.toml`. Keep functions under 50 lines and extract reusable logic into `src/common`.

## Testing Guidelines
We rely on pytest with freezegun for deterministic time-based tests. Name test modules `test_<module>.py` and fixtures `fixture_<purpose>.py`. Aim for ≥90% line coverage (`make coverage` or `pytest --cov=src --cov-report=term-missing`). Include regression tests for every bug fix and document edge cases in test docstrings.
For this repository's PDF rendering/layout changes, the required targeted regression command is `npx vitest run tests/pdfLayout.integration.test.ts`, even when the full suite is otherwise being skipped.
When asked to visually verify a PDF rendering/layout fix yourself, do not hand the check back to the user by default. Use the local browser harness in `./scripts/capture_formula_region.mjs` to render a PDF crop in headless Chrome and inspect the screenshot output directly. Example: `./scripts/capture_formula_region.mjs --pdf pdfs/NIPS-2017-attention-is-all-you-need-Paper.pdf --page 4 --match '∑' --scale 6 --debug --output /tmp/formula-check.png`. Use `--debug` when you need bounds/baseline overlays, and adjust `--context-x`, `--context-y`, and `--crop-padding` to widen the crop around the target formula.
Do not trust whole-page RMSE or a quick visual pass for tiny rendering defects. Small glyph overlaps and scan-conversion problems can hide inside a low page-wide error. When a user points at a specific word, formula fragment, or figure, compare that exact region against the PDF-native reference with `./scripts/compare_pdf_region_render.mjs` before declaring the issue fixed. Example: `./scripts/compare_pdf_region_render.mjs --pdf pdfs/NIPS-2017-attention-is-all-you-need-Paper.pdf --page 7 --match 'P100 GPUs\\.' --scale 8 --context-x 40 --context-y 14 --crop-padding 2 --threshold 70% --output-dir /tmp/gpus-compare`.
For render verification, always rebuild the relevant client/library artifacts first when the tooling depends on `dist/` or `testApp/dist/`, otherwise the compare output can be stale.
Be careful with filtered PDF streams: trailing `CR/LF` bytes are not safe to strip before decoding just because the content is binary. If a stream issue looks like a missing figure or missing glyphs inside a Form XObject, check whether the parser is trimming real compressed bytes before Flate decode.

## Commit & Pull Request Guidelines
Adopt Conventional Commits (e.g., `feat: add profile agent router`) with scope tags when relevant. Keep commits focused; separate refactors from behavior changes. PRs must describe intent, surface risks, and link issues (`Closes #123`). Attach screenshots or logs for UX or CLI changes, and list follow-up tasks explicitly. Request review once CI passes and note any flaky tests in the PR body.

## Security & Configuration Tips
Store secrets in `.env.local` and never commit credential files; add new patterns to `.gitignore`. Sanitize external inputs at module boundaries and log PII-safe identifiers only. Document required environment variables in `docs/config-example.yaml` and provide secure defaults.
