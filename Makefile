LOG_DIR = logs
BASE_DIR = tangles
TANGLES = private_tangle_1 private_tangle_2 private_tangle_3

.PHONY: cleanup bootstrap run stop reset-tendermint start-tendermint stop-tendermint

cleanup-tangles:
	@for TANGLE in $(TANGLES); do \
		echo "Cleaning up $$TANGLE..."; \
		cd $(BASE_DIR)/$$TANGLE && sudo ./cleanup.sh; \
		cd - > /dev/null; \
	done
	@echo "All tangles cleaned up."

bootstrap-tangles:
	@for TANGLE in $(TANGLES); do \
		echo "Bootstrapping $$TANGLE..."; \
		cd $(BASE_DIR)/$$TANGLE && sudo ./bootstrap.sh; \
		cd - > /dev/null; \
	done
	@echo "All tangles bootstrapped."

start-tangles:
	@mkdir -p $(LOG_DIR)
	@for TANGLE in $(TANGLES); do \
		echo "Running $$TANGLE..."; \
		(cd $(BASE_DIR)/$$TANGLE && nohup ./run.sh > ../../$(LOG_DIR)/$$TANGLE.log 2>&1 &) \
	done
	@echo "All tangles running in background. Logs are in $(LOG_DIR)/private_tangle_1|2|3.log"

stop-tangles:
	@echo "Stopping all Tangle containers..."
	@docker ps -q \
		--filter "name=-1a" --filter "name=-1b" --filter "name=-1c" --filter "name=-1d" \
		--filter "name=-2a" --filter "name=-2b" --filter "name=-2c" --filter "name=-2d" \
		--filter "name=-3a" --filter "name=-3b" --filter "name=-3c" --filter "name=-3d" \
		--filter "name=-a" --filter "name=-b" --filter "name=-c" | xargs -r docker stop
	@docker ps -q \
		--filter "name=-1a" --filter "name=-1b" --filter "name=-1c" --filter "name=-1d" \
		--filter "name=-2a" --filter "name=-2b" --filter "name=-2c" --filter "name=-2d" \
		--filter "name=-3a" --filter "name=-3b" --filter "name=-3c" --filter "name=-3d" \
		--filter "name=-a" --filter "name=-b" --filter "name=-c" | xargs -r docker rm
	@pkill -f "./run.sh" || true
	@echo "All specified Tangle containers stopped and removed."

init-tendermint:
	@echo "Initializing Tendermint..."
	tendermint init validator
	@echo "Tendermint initialized."

reset-tendermint:
	@echo "Resetting Tendermint..."
	tendermint unsafe-reset-all
	@echo "Tendermint reset complete."

start-tendermint:
	@mkdir -p $(LOG_DIR)
	@echo "Starting Tendermint node..."
	@nohup tendermint node --proxy_app=kvstore --rpc.unsafe > $(LOG_DIR)/tendermint.log 2>&1 &
	@echo "Tendermint node started in background. Log is in $(LOG_DIR)/tendermint.log"

stop-tendermint:
	@echo "Stopping Tendermint node..."
	@pkill -f "tendermint node"
	@echo "Tendermint node stopped."