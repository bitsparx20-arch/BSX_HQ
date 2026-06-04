# Bitsparx HQ

Company management platform (FastAPI + React + MongoDB).

## Local setup

### Prerequisites

- Python 3.11+
- Node.js 18+ and Yarn
- MongoDB on `localhost:27017` (e.g. `brew services start mongodb-community` or Docker: `docker run -d -p 27017:27017 mongo:7`)

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # add Bedrock API key
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
yarn install
cp .env.example .env
yarn start
```

Open http://localhost:3000 — default admin: `admin@bitsparx.com` / `Admin@123`.

### BitsBot (Amazon Bedrock)

Set in `backend/.env`:

- `LLM_PROVIDER=bedrock`
- `AWS_REGION` (e.g. `ap-south-1`)
- `BEDROCK_MODEL_ID` (e.g. `apac.amazon.nova-micro-v1:0`)
- `BEDROCK_API_KEY` from Bedrock → Discover → API keys

## Deploy to KVM (147.93.104.138)

1. **Enable SSH** (one-time, from your Mac):

   ```bash
   ssh-copy-id root@147.93.104.138
   ```

2. **Configure secrets** in `backend/.env` (Bedrock key, `JWT_SECRET`, `ADMIN_PASSWORD`, etc.).

3. **Deploy**:

   ```bash
   ./deploy/deploy.sh
   ```

   Optional env vars:

   - `DEPLOY_SERVER=root@147.93.104.138`
   - `PUBLIC_URL=http://147.93.104.138` (or your domain)

The script cleans old Docker/web stacks, installs nginx + Node + Python, runs MongoDB in Docker, builds the React app, and starts `bitsparx-api` via systemd.

After deploy, open `PUBLIC_URL` and sign in with your admin account.
