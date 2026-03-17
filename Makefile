VENV = /opt/sennet-agent/venv
PYTHON = $(VENV)/bin/python
PYTHONPATH = $(shell pwd):$(shell pwd)/app

test-arch:
	PYTHONPATH=$(PYTHONPATH) $(PYTHON) scripts/validate_fastapi_only_architecture.py

test-scheduler:
	PYTHONPATH=$(PYTHONPATH) $(PYTHON) scripts/test_scheduler_slot_idempotency.py

test-local: test-arch test-scheduler
	@echo "✓ Todos los tests locales pasaron"

test-smoke:
	PYTHONPATH=$(PYTHONPATH) $(PYTHON) scripts/smoke_test_api.py \
		--base-url http://127.0.0.1:8000 \
		--tenant $(TENANT) \
		--admin-token $(shell grep AGENT_ADMIN_TOKEN /opt/sennet-agent/env | cut -d= -f2)

.PHONY: test-arch test-scheduler test-local test-smoke
