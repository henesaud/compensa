.PHONY: update-products serve

update-products:
	npm run update:products

serve:
	python3 -m http.server 8000
