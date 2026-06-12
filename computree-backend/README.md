# Computree Backend

Tiny Node/Express backend for the shared Computree forest.

It stores public forest events in a JSON file:

- worldseeds
- AI flower artifacts
- autosync snapshots

## Local run

```bash
cd computree-backend
npm install
cp .env.example .env
npm start
```

Test:

```bash
curl http://localhost:8787/health
curl http://localhost:8787/events
```

## Oracle Cloud deploy

On your Ubuntu Oracle instance:

```bash
sudo apt update
sudo apt install -y git nodejs npm

git clone https://github.com/ancientpagoda-rgb/reality-sandbox.git
cd reality-sandbox/computree-backend
npm install
cp .env.example .env
nano .env
npm start
```

For persistent service:

```bash
sudo tee /etc/systemd/system/computree.service >/dev/null <<'EOF'
[Unit]
Description=Computree Shared Forest Backend
After=network.target

[Service]
WorkingDirectory=/home/ubuntu/reality-sandbox/computree-backend
ExecStart=/usr/bin/npm start
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now computree
sudo systemctl status computree
```

Open firewall/security list for TCP `8787`, or reverse proxy through nginx/Caddy.

## Frontend config

In the Computree web page shared settings, use:

```text
Backend URL: http://YOUR_SERVER_IP:8787
Write token: whatever-you-put-in-.env
```

The frontend still works offline/local if no backend is configured.
