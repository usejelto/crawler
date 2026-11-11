.DEFAULT_GOAL := test
.PHONY: build test conformance package security check npm-audit lint deadcode

# The shared quality targets (hooks, tools, secrets, osv, workflow-audit, sast)
# arrive from the contracts repository as a checksummed snapshot; `make inputs`
# in the backend refreshes it, and nothing edits it here.
include vendor/quality/quality.mk

node_modules: package.json package-lock.json
	npm ci
	@touch $@

build: node_modules
	npm run build

test: node_modules
	npm run check
	npm test

conformance: node_modules
	npm run conformance

package: build
	npm pack

# ESLint's recommended JavaScript and TypeScript rules (eslint.config.js) over
# the source, the tests and the packaging script.
lint: node_modules
	npx --no-install eslint --max-warnings 0 .

# Knip (knip.config.ts): files nothing imports, unused exports and
# dependencies, and dependencies used but not declared.
deadcode: node_modules knip

# The whole gate: what to run before a pull request, and what CI runs.
# Conformance runs twice beside it in CI, as before.
check: lint deadcode test build package security

security: secrets workflow-audit osv npm-audit

npm-audit:
	npm audit --audit-level=moderate --package-lock-only
