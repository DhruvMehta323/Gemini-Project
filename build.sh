#!/usr/bin/env bash
set -e

# Install backend Python dependencies
pip install -r risk_aware_routing/requirements.txt

# Build frontend
cd frontend
npm install
npm run build
cd ..
