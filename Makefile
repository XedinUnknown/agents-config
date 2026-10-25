# Development and release tasks. `make help` lists them.
#
# Targets are real files where possible, so `make build` only recompiles when
# a source changed and `make setup` only reinstalls when the lockfile did.

.DEFAULT_GOAL := build
.PHONY: help setup build dev typecheck test check pack clean

NODE_MODULES := node_modules/.package-lock.json
SOURCES := $(shell find src -name '*.ts' ! -name '*.test.ts')
PACKAGE := $(shell node -p "const p = require('./package.json'); p.name.replace('@', '').replace('/', '-') + '-' + p.version").tgz

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | sed -E 's/:.*## /\t/' | expand -t 12

setup: $(NODE_MODULES) ## Install dependencies

$(NODE_MODULES): package.json package-lock.json
	npm ci

build: dist/index.js ## Compile to dist/, as published

dist/index.js: $(NODE_MODULES) $(SOURCES) tsconfig.json tsconfig.build.json
	rm -rf dist
	npm run build

dev: $(NODE_MODULES) ## Re-run the tests on every change
	node --import tsx --test --watch 'src/**/*.test.ts'

typecheck: $(NODE_MODULES) ## Typecheck sources and tests
	npm run typecheck

test: $(NODE_MODULES) ## Run the tests
	npm test

check: typecheck test ## Typecheck and test

pack: $(PACKAGE) ## Build the npm package tarball

$(PACKAGE): dist/index.js package.json README.md CHANGELOG.md
	npm pack --ignore-scripts

clean: ## Remove build output
	rm -rf dist *.tgz
