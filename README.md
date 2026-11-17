# Aram Events — Local AI Website Studio

## Features
- Local email/password registration and login (no JWT). Passwords are stored as salted scrypt hashes in `backend/data/users.json`.
- In-memory sessions using an HttpOnly cookie; restarting the backend signs users out. No session secret is needed.
- No Razorpay, payment flow, API key, or JWT secret.
- Local Ollama model: `qwen2.5:0.5b`.
- AI website generation, flyer OCR (JPG/PNG/WEBP/PDF), template library and visual editor.

## Requirements
- Node.js 20 or newer
- Ollama installed and running
- `ollama pull qwen2.5:0.5b`

## Run on Windows PowerShell
Open PowerShell in `backend` and run:

```powershell
Copy-Item .env.example .env -Force
$env:TEMP = 'E:\Temp'
$env:TMP = 'E:\Temp'
$env:npm_config_cache = 'E:\npm-cache'
npm install --cache 'E:\npm-cache'
npm start
```

Open `http://localhost:5000`. Create an account, then sign in.

## Important
This is a local development login, not production-grade identity management. Sessions are stored in memory and expire when the server restarts. Do not expose this development server directly to the public internet.
