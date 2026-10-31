# Deploying Apollo for free: Hugging Face Spaces + Neon

One Docker container (FastAPI serving the built React UI and the API on the same origin) on a free Hugging Face
Space, with users and runs in a free Neon Postgres database. Free-plan limits change; check them when you sign up.

**Why this pair:** the app needs ~2 GB RAM (torch + the embedding model). Hugging Face's free CPU Space has enough;
most other free web hosts stop at 512 MB. The Space's disk is wiped on restart, so data lives in Neon.

**Limits of the free plans:** the Space sleeps after a long idle period (about 48 h) and takes 1–2 minutes to wake;
Neon suspends an idle database and the first query after that is a little slower.

---

## 1. Neon (database)

1. Sign up at https://neon.tech → **New Project** → region **AWS Asia Pacific (Singapore)**.
2. **Connect** → turn **Connection pooling off** → copy the connection string
   (`postgresql://USER:PASSWORD@ep-....neon.tech/neondb?sslmode=require`).
3. Put it in your local `.env` (never commit it):
   ```
   DATABASE_URL=postgresql://USER:PASSWORD@ep-....neon.tech/neondb?sslmode=require
   ```
4. Copy your local accounts and runs into Neon (same email and password keep working):
   ```powershell
   .venv\Scripts\python scripts\migrate_to_db.py
   ```
5. Check: Neon console → **Tables** shows `users` and `runs`.

## 2. Hugging Face Space (app)

1. Sign up at https://huggingface.co → **New Space** → SDK **Docker** → template **Blank** →
   hardware **CPU basic (free)** → **Create Space**.
2. Space → **Settings → Variables and secrets** → add each as a **secret**:

   | Name | Value |
   |---|---|
   | `GROQ_API_KEY`, `GEMINI_API_KEY`, `TAVILY_API_KEY`, `SERPER_API_KEY` | your keys |
   | `JWT_SECRET` | a new long random string (`python -c "import secrets;print(secrets.token_urlsafe(48))"`) |
   | `DATABASE_URL` | the Neon connection string |
   | `COOKIE_SECURE` | `true` |
   | `LLM_PROVIDER` | `groq` |

3. Hugging Face → **Settings → Access Tokens** → create a **Write** token (used as the password when pushing).

## 3. Push the code

```powershell
git remote add space https://huggingface.co/spaces/<username>/<space-name>
git push space main
```
Username = your Hugging Face username, password = the Write token. Watch the **Logs** tab; the first build takes
about 10–15 minutes (it builds the frontend, installs CPU-only torch and downloads the embedding model).

To update later: commit, then `git push space main` (and `git push origin main` for GitHub).

## 4. Open the app

Open **`https://<username>-<space-name>.hf.space`** directly. Inside the Space page on huggingface.co the app runs
in a cross-site frame, where browsers do not send the login cookie, so sign-in only works on the direct link.

## Troubleshooting

| Problem | Fix |
|---|---|
| Build fails installing `torch==2.15.0` | In `Dockerfile` change it to plain `torch` (latest CPU build) |
| "Cannot reach the backend" / errors in Logs | A secret is missing or misspelled; compare with the table above |
| Sign-in does not stick | Use the direct `.hf.space` link; check `COOKIE_SECURE=true` |
| Security page says "local SQLite" | `DATABASE_URL` secret is missing; data would be lost on restart |
| App asleep | Open the link and wait 1–2 minutes |

## What the repo provides for this

- `Dockerfile`: builds the frontend, installs CPU-only torch, pre-downloads the embedding model, runs uvicorn on
  port 7860 as user 1000 (Spaces' requirements).
- `.dockerignore`: keeps `.env`, `output/` and local databases out of the image.
- `api.py`: serves `frontend/dist` on `/` when it exists (production), after all `/api` routes.
- `README.md` front matter (`sdk: docker`, `app_port: 7860`): tells Hugging Face how to run the Space.
- `scripts/migrate_to_db.py`: one-time copy of local data into `DATABASE_URL`.
