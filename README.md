# IOTA-Tendermint-Badar-Oman

## Overview

Setup done for 3 tangles with seperate domains/ips to store IoT devices data through data script and a tendermint node to store snapshots of transactions after specified time interval as merkle tree to verify effeciently

## Prerequisites

Clone the following repositories to build the required Hornet & Tendermint tools:

- [Hornet Repository v2.0.2](https://github.com/iotaledger/hornet/tree/v2.0.2)
- [Tendermint Repository v0.37.0-rc2](https://github.com/tendermint/tendermint/tree/v0.37.0-rc2)

## Build and Install Hornet Tool

Follow the README inside the `hornet` folder, OR use these simple command steps inside the directory:

```sh
go build -tags rocksdb -o hornet main.go
sudo mv hornet /usr/local/bin/
```

## Build and Install Tendermint Tool

Follow the README inside the `tendermint` folder, OR follow this quickstart guide:
[Quickstart Guide](https://docs.tendermint.com/v0.34/introduction/quick-start.html)

# Tangle and Tendermint Management Makefile

## Overview

This project includes a Makefile to manage private Tangle nodes and a Tendermint blockchain node. It provides commands to start, stop, and reset both components efficiently.

---

## Prerequisites

Ensure the following dependencies are installed:

### Install Make

- **Ubuntu/Debian:**
  ```sh
  sudo apt update && sudo apt install make -y
  ```
- **MacOS (Homebrew):**
  ```sh
  brew install make
  ```
- **Windows (WSL or Cygwin):**
  ```sh
  sudo apt install make -y
  ```

---

## Directory Structure

```
Project/
│── Makefile
│── tangles/
│   ├── private_tangle_1/
│   │   ├── cleanup.sh
│   │   ├── bootstrap.sh
│   │   ├── run.sh
│   ├── private_tangle_2/
│   ├── private_tangle_3/
│── logs/
│── utils/
```

---

## Usage

### Bootstrap Tangles

To initialize the private Tangle nodes:

```sh
make bootstrap
```

### Start Tangles

To start all private Tangle nodes in the background:

```sh
make start-tangles
```

- Logs are stored in the `logs/` directory.

### Stop Tangles

To stop all running Tangle nodes:

```sh
make stop-tangles
```

- This will send termination signals to all running Tangle processes.

### Cleanup Tangles

To remove old state data for all tangles:

```sh
make cleanup
```

---

## Tendermint Management

### Start Tendermint Node

```sh
make start-tendermint
```

- Runs the Tendermint node in the background.
- Logs are saved in `logs/tendermint.log`.

### Stop Tendermint Node

```sh
make stop-tendermint
```

- Stops the running Tendermint node.

### Reset Tendermint

```sh
make reset-tendermint
```

- Resets the Tendermint node to a clean state.

---

### start Messaging Queue

```sh
./startmessageQueue.sh
```

## Makefile Explanation

The **Makefile** includes the following commands:

- **start-tangles**: Starts all Tangle nodes and logs output.
- **stop-tangles**: Stops all running Tangle nodes.
- **cleanup**: Cleans up Tangle data.
- **bootstrap**: Initializes the Tangle network.
- **start-tendermint**: Runs Tendermint in the background.
- **stop-tendermint**: Stops Tendermint.
- **reset-tendermint**: Resets the Tendermint state.

Each command is executed using:

```sh
make <command>
```

---

## Notes

- Ensure `run.sh`, `cleanup.sh`, and `bootstrap.sh` have **execution permissions**:
  ```sh
  chmod +x tangles/private_tangle_*/{run.sh,cleanup.sh,bootstrap.sh}
  ```
- If a process does not stop properly, use:
  ```sh
  pkill -f run.sh
  ```
- Modify `Makefile` variables such as `BASE_DIR`, `TANGLES`, and `LOG_DIR` to match your setup.

---

## Troubleshooting

1. **Makefile not found?**

   - Ensure you're in the correct directory: `cd /path/to/project`

2. **Processes not stopping?**

   - Run: `pkill -f run.sh`

3. **Permission denied errors?**
   - Run: `chmod +x tangles/private_tangle_*/run.sh`

---

## Start the Server App

Run the following command:

```sh
node index.js
```

## Start the data simulation script

Run the following command:

```sh
node data.js
```

## License

MIT License
