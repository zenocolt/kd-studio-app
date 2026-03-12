<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/dd1e34f9-edc3-4ab0-a38c-479319e5c2c1

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Supabase Connection

This project now supports Supabase connection via environment config.

1. Copy `.env.example` to `.env.local` or `.env`.
2. Set:
   `DB_PROVIDER="supabase"`
   `SUPABASE_URL="https://YOUR_PROJECT.supabase.co"`
   `SUPABASE_SERVICE_ROLE_KEY="..."`
3. Keep `DB_PROVIDER="sqlite"` if you want existing local SQLite behavior.

You can verify connectivity at:
`GET /api/health/db`
