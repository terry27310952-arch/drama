create table if not exists public.projects (
  id uuid primary key,
  name text not null,
  description text,
  bible jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.characters (
  id uuid primary key,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null,
  role text,
  traits text[] not null default '{}',
  speech_style text,
  visual_prompt text,
  reference_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.locations (
  id uuid primary key,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null,
  mood text,
  era text,
  lighting text,
  visual_prompt text,
  reference_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.script_generation_requests (
  id uuid primary key,
  project_id uuid references public.projects(id) on delete cascade,
  selected_character_ids uuid[] not null default '{}',
  selected_location_ids uuid[] not null default '{}',
  selected_genres text[] not null default '{}',
  tone text,
  platform text,
  episode_count integer not null default 1,
  duration_per_episode text,
  prompt_input text,
  llm_model text,
  status text not null default 'queued',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scripts (
  id uuid primary key,
  project_id uuid references public.projects(id) on delete cascade,
  generation_request_id uuid references public.script_generation_requests(id) on delete set null,
  title text not null,
  logline text,
  synopsis text,
  structure jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scenes (
  id uuid primary key,
  script_id uuid references public.scripts(id) on delete cascade,
  episode_number integer not null,
  scene_number integer not null,
  location_id uuid references public.locations(id) on delete set null,
  character_ids uuid[] not null default '{}',
  genre_tags text[] not null default '{}',
  beat text,
  dialogue text,
  action text,
  emotion text,
  quality_score integer,
  continuity_notes text,
  image_prompt text,
  video_prompt text,
  cliffhanger_hook text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assets (
  id uuid primary key,
  owner_type text not null,
  owner_id uuid,
  kind text not null,
  url text,
  prompt text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.generations (
  id uuid primary key,
  project_id uuid references public.projects(id) on delete cascade,
  generation_type text not null,
  provider text,
  model text,
  prompt text not null,
  result jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects enable row level security;
alter table public.characters enable row level security;
alter table public.locations enable row level security;
alter table public.script_generation_requests enable row level security;
alter table public.scripts enable row level security;
alter table public.scenes enable row level security;
alter table public.assets enable row level security;
alter table public.generations enable row level security;

-- Server-side access should use SUPABASE_SERVICE_ROLE_KEY.
-- Add authenticated-user policies later when login/workspace ownership is introduced.
