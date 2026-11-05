#!/bin/bash
echo "🚀 Deploying latest code to Linux POS..."

# Automatically figure out if you use main or master
BRANCH=$(git rev-parse --abbrev-ref HEAD)

ssh food@192.168.100.19 "cd ~/resto-server/public && git fetch origin && git reset --hard origin/$BRANCH && echo '✅ Code updated!' && pm2 restart resto-local"
