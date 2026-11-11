.DEFAULT_GOAL := test
.PHONY: build test conformance package

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
