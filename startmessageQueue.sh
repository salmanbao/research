#!/bin/bash
# Create the docker network if it doesn't exist
# docker network create blockchain_network || true

# docker network create blockchain_network
docker run -d --name rabbitmq --network blockchain_network -p 5672:5672 -p 15672:15672 rabbitmq:3-management

