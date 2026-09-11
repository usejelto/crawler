.DEFAULT_GOAL := test
.PHONY: build test conformance package

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
