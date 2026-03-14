# Repository Guidelines
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

## Commit & Pull Request Guidelines
Adopt Conventional Commits (e.g., `feat: add profile agent router`) with scope tags when relevant. Keep commits focused; separate refactors from behavior changes. PRs must describe intent, surface risks, and link issues (`Closes #123`). Attach screenshots or logs for UX or CLI changes, and list follow-up tasks explicitly. Request review once CI passes and note any flaky tests in the PR body.

## Security & Configuration Tips
Store secrets in `.env.local` and never commit credential files; add new patterns to `.gitignore`. Sanitize external inputs at module boundaries and log PII-safe identifiers only. Document required environment variables in `docs/config-example.yaml` and provide secure defaults.
