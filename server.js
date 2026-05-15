require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fetch = require("node-fetch");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const PORT = process.env.PORT || 4000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, ".data");
const PUBLIC_DIR = path.join(ROOT, "public");

const SUPABASE_URL = trimSlash(process.env.SUPABASE_URL || "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "shortdrama-assets";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5";

const TABLES = [
  "projects",
  "characters",
  "locations",
  "script_generation_requests",
  "scripts",
  "scenes",
  "assets",
  "generations"
];

ensureLocalStore();

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(PUBLIC_DIR));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    storage: hasSupabase() ? "supabase" : "local-json",
    llm: OPENAI_API_KEY ? "openai-responses" : "demo-mode",
    model: OPENAI_MODEL
  });
});

app.get("/api/projects", async (req, res, next) => {
  try {
    const projects = await list("projects");
    if (projects.length === 0) {
      return res.json([await create("projects", defaultProject())]);
    }
    res.json(projects);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/projects/:id", async (req, res, next) => {
  try {
    res.json(await update("projects", req.params.id, normalizeProjectPatch(req.body)));
  } catch (error) {
    next(error);
  }
});

app.get("/api/characters", async (req, res, next) => {
  try { res.json(await list("characters")); } catch (error) { next(error); }
});

app.post("/api/characters", async (req, res, next) => {
  try { res.status(201).json(await create("characters", normalizeCharacter(req.body))); } catch (error) { next(error); }
});

app.get("/api/locations", async (req, res, next) => {
  try { res.json(await list("locations")); } catch (error) { next(error); }
});

app.post("/api/locations", async (req, res, next) => {
  try { res.status(201).json(await create("locations", normalizeLocation(req.body))); } catch (error) { next(error); }
});

app.get("/api/generations", async (req, res, next) => {
  try {
    const rows = await list("generations");
    res.json(rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))));
  } catch (error) {
    next(error);
  }
});

app.post("/api/assets/upload", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file is required" });
    const ownerType = req.body.owner_type || "asset";
    const ownerId = req.body.owner_id || null;
    const fileName = `${ownerType}/${ownerId || "unassigned"}/${Date.now()}-${safeName(req.file.originalname)}`;
    let publicUrl = "";

    if (hasSupabase()) {
      await supabaseStorageUpload(fileName, req.file.buffer, req.file.mimetype);
      publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${fileName}`;
    } else {
      const assetDir = path.join(PUBLIC_DIR, "uploads", ownerType, ownerId || "unassigned");
      fs.mkdirSync(assetDir, { recursive: true });
      const localPath = path.join(assetDir, path.basename(fileName));
      fs.writeFileSync(localPath, req.file.buffer);
      publicUrl = `/uploads/${ownerType}/${ownerId || "unassigned"}/${path.basename(fileName)}`;
    }

    const asset = await create("assets", {
      owner_type: ownerType,
      owner_id: ownerId,
      kind: req.body.kind || "reference_image",
      url: publicUrl,
      prompt: req.body.prompt || "",
      metadata: { mime_type: req.file.mimetype, original_name: req.file.originalname }
    });
    res.status(201).json(asset);
  } catch (error) {
    next(error);
  }
});

app.post("/api/assets/generate-prompt", async (req, res, next) => {
  try {
    const { type, name, description, visualStyle } = req.body;
    if (!OPENAI_API_KEY) {
      return res.json({
        prompt: `Vertical cinematic short-drama reference image of ${name || type}, ${description || "distinctive visual identity"}, ${visualStyle || "natural film lighting, production-ready, consistent design"}`
      });
    }
    const prompt = await generateText({
      instructions: "Create one production-ready image generation prompt. Return plain text only.",
      input: [`Asset type: ${type}`, `Name: ${name}`, `Description: ${description}`, `Visual style: ${visualStyle || "cinematic vertical short drama"}`].join("\n")
    });
    res.json({ prompt: extractText(prompt) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/scripts/generate", async (req, res, next) => {
  try {
    const payload = normalizeScriptRequest(req.body);
    const [characters, locations, projects] = await Promise.all([
      getMany("characters", payload.selected_character_ids),
      getMany("locations", payload.selected_location_ids),
      list("projects")
    ]);
    const project = projects.find((item) => item.id === payload.project_id) || projects[0] || defaultProject();
    const request = await create("script_generation_requests", {
      project_id: payload.project_id,
      selected_character_ids: payload.selected_character_ids,
      selected_location_ids: payload.selected_location_ids,
      selected_genres: payload.selected_genres,
      tone: payload.tone,
      platform: payload.platform,
      episode_count: payload.episode_count,
      duration_per_episode: payload.duration_per_episode,
      prompt_input: payload.prompt_input,
      llm_model: OPENAI_API_KEY ? OPENAI_MODEL : "demo-mode",
      status: "running"
    });

    const generated = await generateScriptJson(payload, characters, locations, project);
    const script = await create("scripts", {
      project_id: payload.project_id,
      generation_request_id: request.id,
      title: generated.title,
      synopsis: generated.synopsis,
      logline: generated.logline || "",
      structure: generated.structure || []
    });

    const scenes = [];
    for (const scene of generated.scenes) {
      scenes.push(await create("scenes", normalizeScene({
        ...scene,
        script_id: script.id,
        genre_tags: scene.genre_tags || payload.selected_genres
      })));
    }

    await create("generations", {
      project_id: payload.project_id,
      generation_type: "script",
      provider: OPENAI_API_KEY ? "openai" : "demo",
      model: OPENAI_API_KEY ? OPENAI_MODEL : "demo-mode",
      prompt: JSON.stringify({ payload, characters, locations, project }, null, 2),
      result: { script, scenes }
    });
    await update("script_generation_requests", request.id, { status: "completed" });
    res.status(201).json({ request: { ...request, status: "completed" }, script, scenes });
  } catch (error) {
    next(error);
  }
});

app.post("/api/scenes/:id/regenerate", async (req, res, next) => {
  try {
    const scenes = await list("scenes");
    const scene = scenes.find((item) => item.id === req.params.id);
    if (!scene) return res.status(404).json({ error: "Scene not found" });
    const kind = req.body.kind || "image_prompt";
    const [characters, locations, scripts, projects] = await Promise.all([
      getMany("characters", scene.character_ids || []),
      getMany("locations", scene.location_id ? [scene.location_id] : []),
      list("scripts"),
      list("projects")
    ]);
    const script = scripts.find((item) => item.id === scene.script_id) || {};
    const project = projects.find((item) => item.id === script.project_id) || projects[0] || {};
    const patch = await regenerateScenePatch(kind, scene, script, project, characters, locations);
    const updatedScene = await update("scenes", scene.id, patch);
    await create("generations", {
      project_id: script.project_id || project.id || null,
      generation_type: kind,
      provider: OPENAI_API_KEY ? "openai" : "demo",
      model: OPENAI_API_KEY ? OPENAI_MODEL : "demo-mode",
      prompt: JSON.stringify({ kind, scene, script, project, characters, locations }, null, 2),
      result: { patch, scene: updatedScene }
    });
    res.json(updatedScene);
  } catch (error) {
    next(error);
  }
});

app.get("/api/scripts", async (req, res, next) => {
  try {
    const scripts = await list("scripts");
    const scenes = await list("scenes");
    res.json(scripts.map((script) => ({
      ...script,
      scenes: scenes.filter((scene) => scene.script_id === script.id).sort((a, b) => a.episode_number - b.episode_number || a.scene_number - b.scene_number)
    })));
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.message || "Internal server error" });
});

app.listen(PORT, () => console.log(`Shortdrama AI Studio running at http://localhost:${PORT}`));

function defaultProject() {
  return {
    name: "AI Shortdrama Channel",
    description: "Manage characters, locations, scripts, image prompts, and video prompts in one production console.",
    bible: {
      audience: "Short-form drama viewers in their 20s and 30s",
      world: "Modern Korea with realistic spaces and fast emotional turns",
      tone: "Strong hooks, clear desire, and a small reversal at the end of each scene",
      rules: "Keep character voices and relationships consistent. Focus each scene on one emotional shift.",
      visual_style: "9:16 vertical, cinematic close-ups, clean production design, consistent faces"
    }
  };
}

function normalizeProjectPatch(input) {
  return {
    name: input.name || "AI Shortdrama Channel",
    description: input.description || "",
    bible: {
      audience: input.audience || "",
      world: input.world || "",
      tone: input.tone || "",
      rules: input.rules || "",
      visual_style: input.visual_style || ""
    }
  };
}

function normalizeCharacter(input) {
  return {
    project_id: input.project_id || null,
    name: required(input.name, "name"),
    role: input.role || "Lead",
    traits: splitList(input.traits),
    speech_style: input.speech_style || "",
    visual_prompt: input.visual_prompt || "",
    reference_image_url: input.reference_image_url || ""
  };
}

function normalizeLocation(input) {
  return {
    project_id: input.project_id || null,
    name: required(input.name, "name"),
    mood: input.mood || "",
    era: input.era || "",
    lighting: input.lighting || "",
    visual_prompt: input.visual_prompt || "",
    reference_image_url: input.reference_image_url || ""
  };
}

function normalizeScriptRequest(input) {
  return {
    project_id: input.project_id || null,
    selected_character_ids: input.selected_character_ids || [],
    selected_location_ids: input.selected_location_ids || [],
    selected_genres: input.selected_genres || [],
    tone: input.tone || "fast pacing, emotional immersion",
    platform: input.platform || "YouTube Shorts",
    episode_count: Number(input.episode_count || 1),
    duration_per_episode: input.duration_per_episode || "60 seconds",
    prompt_input: input.prompt_input || ""
  };
}

function normalizeScene(input) {
  return {
    script_id: input.script_id,
    episode_number: Number(input.episode_number || 1),
    scene_number: Number(input.scene_number || 1),
    location_id: input.location_id || null,
    character_ids: input.character_ids || [],
    genre_tags: input.genre_tags || [],
    beat: input.beat || "",
    dialogue: input.dialogue || "",
    action: input.action || "",
    emotion: input.emotion || "",
    quality_score: Number(input.quality_score || 78),
    continuity_notes: input.continuity_notes || "",
    image_prompt: input.image_prompt || "",
    video_prompt: input.video_prompt || "",
    cliffhanger_hook: input.cliffhanger_hook || ""
  };
}

async function generateScriptJson(payload, characters, locations, project) {
  if (!OPENAI_API_KEY) return demoScript(payload, characters, locations, project);
  return parseGeneratedJson(await generateText({
    instructions: [
      "You are a senior vertical short-drama showrunner.",
      "Return valid JSON only. No markdown.",
      "Create concise Korean script scenes for short-form drama production.",
      "First produce a logline and episode structure, then scenes.",
      "Each scene must include quality_score, continuity_notes, image_prompt, and video_prompt."
    ].join(" "),
    input: JSON.stringify({
      project_bible: project.bible || {},
      request: payload,
      characters,
      locations
    }, null, 2)
  }));
}

async function regenerateScenePatch(kind, scene, script, project, characters, locations) {
  if (!OPENAI_API_KEY) return demoScenePatch(kind, scene, characters, locations);
  return parseGeneratedJson(await generateText({
    instructions: "Return valid JSON only. Regenerate only the requested field for a vertical short-drama production scene.",
    input: JSON.stringify({ requested_field: kind, project_bible: project.bible || {}, script, scene, characters, locations }, null, 2)
  }));
}

async function generateText({ instructions, input }) {
  if (!OPENAI_API_KEY) return "Demo mode: add OPENAI_API_KEY to generate with the LLM API.";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: OPENAI_MODEL, instructions, input })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error && data.error.message ? data.error.message : "OpenAI API request failed");
  return data.output_text || extractResponseText(data) || "";
}

function demoScript(payload, characters, locations, project) {
  const selectedCharacters = characters.length ? characters : [{ id: null, name: "Lead", visual_prompt: "consistent protagonist" }];
  const location = locations[0] || { id: null, name: "Secret cafe", visual_prompt: "cinematic cafe at night" };
  const lead = selectedCharacters[0];
  const genreText = payload.selected_genres.join(" + ") || "romance thriller";
  const sceneCount = Math.max(1, Math.min(4, payload.episode_count + 1));
  return {
    title: `${genreText} shortdrama pilot`,
    logline: `${lead.name} discovers a clue at ${location.name} and starts doubting the person they trusted most.`,
    synopsis: `${lead.name} faces an unexpected truth at ${location.name}, starting a conflict that pulls viewers into the next episode.`,
    structure: ["Hook: a strange clue in a familiar space", "Pressure: a relationship crack and emotional escalation", "Turn: the betrayal clue points back to the lead"],
    scenes: Array.from({ length: sceneCount }).map((_, index) => ({
      episode_number: 1,
      scene_number: index + 1,
      location_id: (locations[index % Math.max(locations.length, 1)] || location).id,
      character_ids: selectedCharacters.map((item) => item.id).filter(Boolean),
      genre_tags: payload.selected_genres,
      beat: index === 0 ? "Opening: a small warning sign in a calm situation" : "Turn: an unspoken secret shakes the relationship",
      dialogue: `${lead.name}: "Wait. Why is this photo here?"`,
      action: `${lead.name} picks up an old photo from the table and scans the room.`,
      emotion: "anxiety, curiosity, suppressed anger",
      quality_score: 82 + index,
      continuity_notes: `Keep ${lead.name}'s voice and ${project.bible ? project.bible.visual_style : "vertical cinematic style"}.`,
      image_prompt: `Vertical cinematic still, ${lead.visual_prompt || lead.name}, at ${location.visual_prompt || location.name}, tense expression, dramatic lighting, short drama key visual`,
      video_prompt: `9:16 vertical video, slow push-in on ${lead.name}, hand picking up an old photo, subtle background motion, tense pause, dramatic reveal, ${payload.duration_per_episode}`,
      cliffhanger_hook: "The back of the photo has the lead character's name and today's date."
    }))
  };
}

function demoScenePatch(kind, scene, characters, locations) {
  const lead = characters[0] || { name: "Lead", visual_prompt: "consistent protagonist" };
  const location = locations[0] || { name: "main location", visual_prompt: "cinematic location" };
  const stamp = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  if (kind === "dialogue") {
    return { dialogue: `${lead.name}: "I think I know who hid this."`, quality_score: Math.min(100, Number(scene.quality_score || 80) + 3) };
  }
  if (kind === "video_prompt") {
    return { video_prompt: `9:16 vertical cinematic shot, ${lead.name} turns slowly toward camera, ${location.visual_prompt || location.name}, controlled handheld tension, one-second silence before reveal, regenerated ${stamp}`, quality_score: Math.min(100, Number(scene.quality_score || 80) + 2) };
  }
  return { image_prompt: `High-consistency vertical drama keyframe, ${lead.visual_prompt || lead.name}, ${location.visual_prompt || location.name}, emotional close-up, sharp production lighting, regenerated ${stamp}`, quality_score: Math.min(100, Number(scene.quality_score || 80) + 2) };
}

function extractResponseText(data) {
  if (!data.output) return "";
  return data.output.flatMap((item) => item.content || []).map((content) => content.text || "").filter(Boolean).join("\n");
}

function parseGeneratedJson(text) {
  try { return JSON.parse(text); } catch (error) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("LLM returned non-JSON output.");
  }
}

async function list(table) {
  if (hasSupabase()) return supabaseRest(table);
  return readLocal(table);
}

async function getMany(table, ids) {
  const rows = await list(table);
  return rows.filter((row) => ids.includes(row.id));
}

async function create(table, data) {
  const row = { id: data.id || randomId(), ...data, created_at: data.created_at || new Date().toISOString(), updated_at: data.updated_at || new Date().toISOString() };
  if (hasSupabase()) {
    const rows = await supabaseRest(table, { method: "POST", body: JSON.stringify(row), headers: { Prefer: "return=representation" } });
    return rows[0];
  }
  const rows = readLocal(table);
  rows.push(row);
  writeLocal(table, rows);
  return row;
}

async function update(table, id, patch) {
  const nextPatch = { ...patch, updated_at: new Date().toISOString() };
  if (hasSupabase()) {
    const rows = await supabaseRest(`${table}?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(nextPatch), headers: { Prefer: "return=representation" } });
    return rows[0];
  }
  const rows = readLocal(table);
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) throw new Error(`${table} row not found`);
  rows[index] = { ...rows[index], ...nextPatch };
  writeLocal(table, rows);
  return rows[index];
}

async function supabaseRest(tablePath, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${tablePath}`, {
    method: options.method || "GET",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.body
  });
  if (!response.ok) throw new Error(`Supabase REST error: ${await response.text()}`);
  if (response.status === 204) return [];
  return response.json();
}

async function supabaseStorageUpload(fileName, buffer, mimeType) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${fileName}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": mimeType, "x-upsert": "true" },
    body: buffer
  });
  if (!response.ok) throw new Error(`Supabase storage error: ${await response.text()}`);
}

function ensureLocalStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(PUBLIC_DIR, "uploads"), { recursive: true });
  for (const table of TABLES) {
    const file = localFile(table);
    if (!fs.existsSync(file)) fs.writeFileSync(file, "[]\n", "utf8");
  }
}

function readLocal(table) {
  const raw = fs.readFileSync(localFile(table), "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw || "[]");
}

function writeLocal(table, rows) {
  fs.writeFileSync(localFile(table), `${JSON.stringify(rows, null, 2)}\n`, "utf8");
}

function localFile(table) { return path.join(DATA_DIR, `${table}.json`); }
function hasSupabase() { return Boolean(SUPABASE_URL && SUPABASE_KEY); }
function splitList(value) { return Array.isArray(value) ? value : String(value || "").split(",").map((item) => item.trim()).filter(Boolean); }
function required(value, name) { if (!value) throw new Error(`${name} is required`); return value; }
function safeName(fileName) { return String(fileName).replace(/[^a-zA-Z0-9._-]/g, "-"); }
function trimSlash(value) { return value.replace(/\/$/, ""); }
function randomId() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"); }
function extractText(value) { return typeof value === "string" ? value : JSON.stringify(value); }
