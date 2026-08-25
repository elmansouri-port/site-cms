# Rainbow site & CMS — the commands worth remembering.
#
#   make up        build and start everything
#   make seed      load the authored site into MongoDB
#   make verify    prove the served pages still match the originals

COMPOSE      := docker compose
COMPOSE_DEV  := docker compose -f docker-compose.yml -f docker-compose.dev.yml
GATEWAY      ?= http://localhost:8080

.DEFAULT_GOAL := help
.PHONY: help up down restart build logs ps seed seed-reset dev dev-db install test verify verify-live verify-menu shell-api shell-mongo purge backup clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

## ── Running ──────────────────────────────────────────────────────────────────

up: ## Build and start the whole stack
	$(COMPOSE) up -d --build
	@echo "site  $(GATEWAY)/"
	@echo "cms   $(GATEWAY)/admin/"

down: ## Stop everything (volumes are kept)
	$(COMPOSE) down

restart: ## Restart the application containers
	$(COMPOSE) restart api web cms gateway

build: ## Rebuild the images
	$(COMPOSE) build

logs: ## Follow the logs
	$(COMPOSE) logs -f --tail 100

ps: ## Show what is running
	$(COMPOSE) ps

## ── Content ──────────────────────────────────────────────────────────────────

seed: ## Load the authored site into MongoDB (keeps CMS edits)
	$(COMPOSE) exec api node apps/api/src/seed/seed.js

seed-reset: ## Drop the content collections and reload from source
	$(COMPOSE) exec api node apps/api/src/seed/seed.js --reset

purge: ## Clear the Redis cache
	$(COMPOSE) exec redis redis-cli FLUSHALL

## ── Development ──────────────────────────────────────────────────────────────

install: ## Install the workspace dependencies
	npm install

dev-db: ## Start only MongoDB and Redis, with their ports published
	$(COMPOSE_DEV) up -d mongo redis

dev: dev-db ## Run the three apps on the host with hot reload
	npm run dev

## ── Checks ───────────────────────────────────────────────────────────────────

test: ## Unit tests, fidelity check and API integration tests
	npm test

verify: ## Prove the CMS reproduces every authored page
	npm run verify

verify-live: ## Diff the running site against the authored source
	node tools/verify-live.mjs $(GATEWAY)

verify-menu: ## Prove the CMS-driven navigation renders identically
	node tools/verify-megamenu.mjs $(GATEWAY)/api

## ── Operations ───────────────────────────────────────────────────────────────

shell-api: ## Shell into the API container
	$(COMPOSE) exec api sh

shell-mongo: ## Mongo shell
	$(COMPOSE) exec mongo mongosh -u $${MONGO_ROOT_USER:-rainbow} -p $${MONGO_ROOT_PASSWORD} --authenticationDatabase admin $${MONGO_DB:-rainbow_cms}

backup: ## Dump the database to ./backups
	@mkdir -p backups
	$(COMPOSE) exec -T mongo mongodump --username $${MONGO_ROOT_USER:-rainbow} --password $${MONGO_ROOT_PASSWORD} --authenticationDatabase admin --db $${MONGO_DB:-rainbow_cms} --archive --gzip > backups/rainbow-$$(date +%Y%m%d-%H%M%S).gz
	@echo "written to backups/"

clean: ## Stop everything and delete the volumes — destroys all content
	$(COMPOSE) down -v
