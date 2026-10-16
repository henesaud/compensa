.PHONY: update-products serve build

PORT ?= 8001

update-products:
	npm run update:products -- $(if $(SOURCE),--source "$(SOURCE)")

serve:
	python3 scripts/serve.py $(PORT)

build:
	node scripts/build-site.mjs
