# Shortdrama AI Studio

AI 숏드라마 채널 운영을 위한 제작 콘솔 MVP입니다.

## Features

- Project bible for audience, world, tone, production rules, and visual style
- Character library with voice, traits, visual prompt, and reference image upload
- Location library with mood, era, lighting, and visual prompt
- Multi-select script generation with characters, locations, and genres
- Scene board with dialogue, action, continuity notes, quality score, image prompt, and video prompt
- Scene-level regenerate actions for dialogue, image prompts, and video prompts
- Generation history
- Supabase REST persistence support
- Local JSON fallback when Supabase is not configured

## Run Locally

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:4000`.

## Environment Variables

```bash
PORT=4000
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=shortdrama-assets
```

If `OPENAI_API_KEY` is empty, the app runs in demo mode.
If Supabase values are empty, the app stores data in `.data/`.

## Supabase

Run `supabase/schema.sql` in the Supabase SQL editor to create the tables.
RLS is enabled. The current MVP expects server-side access through `SUPABASE_SERVICE_ROLE_KEY`.
