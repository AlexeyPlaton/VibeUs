#!/bin/bash
# =============================================================================
# VIBUS CLOUD - PRODUCTION VPS AUTOMATED PROVISIONING SCRIPT
# Target OS: Ubuntu 22.04 / 24.04 LTS or Debian 11/12
# =============================================================================
set -e

echo "🚀 [1/5] Updating system packages..."
sudo apt-get update -y && sudo apt-get upgrade -y
sudo apt-get install -y curl git ufw jq openssl ca-certificates gnupg lsb-release

echo "🔒 [2/5] Configuring UFW Firewall (Ports 22, 80, 443)..."
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw allow 80/tcp comment 'HTTP / Certbot'
sudo ufw allow 443/tcp comment 'HTTPS / WSS'
sudo ufw --force enable

echo "🐳 [3/5] Installing Docker Engine & Docker Compose Plugin..."
if ! command -v docker &> /dev/null; then
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    sudo apt-get update -y
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    sudo systemctl enable docker
    sudo systemctl start docker
    echo "✅ Docker installed successfully."
else
    echo "✅ Docker already installed."
fi

echo "📦 [4/5] Preparing directories for SSL & Certbot..."
mkdir -p certbot/conf
mkdir -p certbot/www

echo "📝 [5/5] Checking environment configuration..."
if [ ! -f ".env.production" ]; then
    if [ -f "deploy/env.production.example" ]; then
        cp deploy/env.production.example .env.production
        echo "Created .env.production from deploy/env.production.example. Fill real values before launching."
    elif [ -f ".env.production.example" ]; then
        cp .env.production.example .env.production
        echo "Created .env.production from .env.production.example. Fill real values before launching."
    else
        echo "ERROR: production environment template not found." >&2
        exit 2
    fi
fi

echo "✨ VPS Setup Complete! Next step: run ./scripts/init_ssl.sh to request Let's Encrypt certificates."
