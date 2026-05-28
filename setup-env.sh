#!/bin/bash
# Run once to generate and set API key on VM
set -e

VM="sachem"
KEY=$(openssl rand -hex 32)

ssh $VM "echo 'SANTHA_API_KEY=$KEY' > /opt/santha/.env && chmod 600 /opt/santha/.env"
echo "SANTHA_API_KEY=$KEY" > .env.local
echo "✓ API key set on VM and saved to .env.local"
echo "  Keep .env.local safe — Claude uses this key to deploy apps."
