# Contributing to @jelto/crawler

Bug reports, documentation corrections, examples and focused code changes are
welcome. Participants follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Start a contribution

Search [existing issues](https://github.com/usejelto/crawler/issues) before opening one. Use a bug report for
reproducible failures, a feature request to explain a use case, or a blank issue
for questions and documentation feedback. Discuss substantial features and
breaking changes before implementing them. Small fixes can go straight to a PR.

Send security reports privately as described in [SECURITY.md](SECURITY.md).
For installation and account help, see [SUPPORT.md](SUPPORT.md).

## Local development

Node.js 24.22.2 (the release `.nvmrc` pins), npm, and Make for development,
matching CI. The package supports Node.js 22 or compatible Fetch runtimes; CI
runs the tests on the oldest Node 22 release as well.

Fork and clone this repository, create a branch from `main`, and run commands
from this component's root. The standalone checkout contains its build inputs;
you do not need the private Jelto backend.

```sh
npm ci
make test
make conformance
make conformance
make package
```

Run the smallest relevant checks while iterating, then the affected gates above.
Documentation-only changes need link and example review; SDK behavior or wire
changes require the appropriate tests and two consecutive conformance passes
before certification. Package changes must also pass packaging checks.

Tests live beside the implementation in `src/`. The bot catalog and guide in
`vendor/jelto/` are pinned inputs; do not edit those copies. Report changes to the
signature catalog in the contracts repository and guide corrections as a docs
issue here. The guide source and hashes are recorded in the vendor manifest.
This component's conformance command tests its exported JavaScript without a
contracts archive. Server intake, authorization, billing, retention and deletion
belong to the service repository.

## Checks and exceptions

`make check` is the whole gate, and the command CI runs on Linux. It runs `test`, `build`, `package` and `security`. `make hooks`
enables two Git hooks once per clone: `commit-msg` rejects a subject that is
not a Conventional Commit, and `pre-commit` runs gitleaks over the staged
changes. Do not bypass them with `--no-verify`.

The security targets run separate programs, not project dependencies.
`vendor/quality/tools.json` pins each one's exact version and SHA-256; the first run
downloads and verifies it into `~/.cache/jelto-tools` (`JELTO_TOOLS_DIR`
overrides the location), and `make tools` installs them all ahead of time.
`vendor/quality/` is a checksummed snapshot of the contracts repository's
`tools/quality/`; change it there, not here.

| Target | Tool | What it checks |
|---|---|---|
| `make secrets` | gitleaks | the whole Git history for credentials |
| `make workflow-audit` | actionlint, zizmor | workflow syntax, script injection, permissions and pinning |
| `make osv` | OSV-Scanner | `package-lock.json` against the OSV database, downloaded and matched locally |
| `make npm-audit` | npm audit | `package-lock.json` against the npm advisory database |

When a check reports something, fix a real problem in the same change. A
deliberate exception, or a finding the tool got wrong, is marked at the one
place it applies, with the reason beside it:

- gitleaks: a `.gitleaks.toml` allowlist entry naming the one literal and why;
- zizmor: `# zizmor: ignore[<audit>]` on the line, with the reason above it;
- OSV-Scanner: an `[[IgnoredVulns]]` entry in `osv-scanner.toml` with a
  `reason` and an `ignoreUntil` date.

Never disable a rule, a file or a directory wholesale, and never relax a
threshold to make a check pass.

## Review and acceptance

Keep changes focused and match the surrounding style.
TypeScript uses strict types and two-space indentation. Preserve the bounded queue and privacy filters.
Add regression coverage for behavior changes. Do not update expected values just to match a
failing implementation, and do not edit generated or vendored inputs by hand.

Use a scoped Conventional Commit title, such as `fix(crawler): clarify retry handling` or `docs(crawler): explain local installation`. Describe the problem,
the resulting behavior, relevant issue/specification, compatibility impact and
exact verification commands with results. Include screenshots for visible UI
changes. State when a check was not run and why. A separate specification change
should precede its implementation; fixture expectation changes need a separate
commit explaining their derivation.

Use synthetic data in examples and reports. Never include credentials, customer
payloads or IP addresses in public logs. Contributions must preserve Jelto's
privacy boundaries: no IP storage or logging, and no row-level identifier that
joins a website visitor to an app install.

Taha Bozdemir reviews scope, correctness, tests and compatibility, and decides
whether to merge. Review is best effort with no guaranteed turnaround. Maintainers
may request changes or decline work outside the component's purpose; explain
tradeoffs in the issue or PR so future contributors can follow the decision.

## Licensing and releases

Submit only work you have the right to contribute, under this repository's
[MIT license](LICENSE). Preserve third-party notices and the Contributor Covenant
attribution. Jelto names, logos, mascots and original brand artwork are excluded
from the software license; no trademark rights are granted. No separate CLA or
DCO sign-off is required.

Maintainers publish releases using [RELEASING.md](RELEASING.md). Local packaging
does not publish, and a successful test run is not a release announcement.
