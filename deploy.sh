#!/bin/bash
set -e

VM="sachem"
REMOTE_DIR="/opt/santha"

echo "→ Setting up $REMOTE_DIR on $VM..."
ssh $VM "mkdir -p $REMOTE_DIR"

echo "→ Syncing server files..."
rsync -az --delete server/ $VM:$REMOTE_DIR/server/
rsync -az --delete apps/ $VM:$REMOTE_DIR/server/public/apps/

echo "→ Installing dependencies..."
ssh $VM "cd $REMOTE_DIR/server && /usr/bin/npm install --production 2>&1"

echo "→ Setting up systemd service..."
ssh $VM "cat > /tmp/santha.service << 'EOF'
[Unit]
Description=Santha AppStore
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/santha/server
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=PORT=3000
EnvironmentFile=-/opt/santha/.env

[Install]
WantedBy=multi-user.target
EOF
sudo mv /tmp/santha.service /etc/systemd/system/santha.service
sudo systemctl daemon-reload
sudo systemctl enable santha
sudo systemctl restart santha"

sleep 2
ssh $VM "sudo systemctl status santha --no-pager"
echo ""
echo "✓ Deployed. Store running on port 3000."
echo "  Open http://$(ssh $VM 'curl -s ifconfig.me' 2>/dev/null):3000 on your phone."
