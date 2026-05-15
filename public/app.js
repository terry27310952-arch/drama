const state = {
  project: null,
  characters: [],
  locations: [],
  scripts: [],
  generations: [],
  genres: ["로맨스", "복수극", "미스터리", "코미디", "판타지", "학원물", "재벌가", "스릴러", "타임슬립"]
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", async () => {
  bindNavigation();
  bindForms();
  $("#refreshButton").addEventListener("click", loadAll);
  await loadAll();
});

function bindNavigation() {
  $$(".nav-button").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".nav-button").forEach((item) => item.classList.remove("active"));
      $$(".view").forEach((view) => view.classList.remove("active"));
      button.classList.add("active");
      $(`#${button.dataset.view}`).classList.add("active");
    });
  });
}

function bindForms() {
  $("#projectBibleForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.project) return;
    const data = Object.fromEntries(new FormData(event.target).entries());
    state.project = await api(`/api/projects/${state.project.id}`, {
      method: "PATCH",
      body: JSON.stringify(data)
    });
    toast("프로젝트 바이블을 저장했습니다.");
  });

  $("#characterForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const character = await postForm("/api/characters", event.target);
    await uploadReferenceIfPresent(event.target, "character", character.id, character.visual_prompt);
    event.target.reset();
    await loadAll();
    toast("캐릭터를 저장했습니다.");
  });

  $("#locationForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const location = await postForm("/api/locations", event.target);
    await uploadReferenceIfPresent(event.target, "location", location.id, location.visual_prompt);
    event.target.reset();
    await loadAll();
    toast("로케이션을 저장했습니다.");
  });

  $$("[data-generate-prompt]").forEach((button) => {
    button.addEventListener("click", async () => {
      const type = button.dataset.generatePrompt;
      const form = button.closest("form");
      const formData = new FormData(form);
      button.disabled = true;
      button.textContent = "프롬프트 생성 중...";
      try {
        const result = await api("/api/assets/generate-prompt", {
          method: "POST",
          body: JSON.stringify({
            type,
            name: formData.get("name"),
            description: describeAsset(type, formData),
            visualStyle: "9:16 cinematic vertical short drama, consistent production bible reference"
          })
        });
        form.elements.visual_prompt.value = result.prompt;
        toast("이미지 생성 프롬프트를 채웠습니다.");
      } finally {
        button.disabled = false;
        button.textContent = "이미지 생성 프롬프트 채우기";
      }
    });
  });

  $("#scriptForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const payload = {
      project_id: state.project && state.project.id,
      selected_character_ids: checkedValues("character"),
      selected_location_ids: checkedValues("location"),
      selected_genres: checkedValues("genre"),
      platform: form.get("platform"),
      tone: form.get("tone"),
      episode_count: Number(form.get("episode_count")),
      duration_per_episode: form.get("duration_per_episode"),
      prompt_input: form.get("prompt_input")
    };

    if (!payload.selected_character_ids.length || !payload.selected_location_ids.length || !payload.selected_genres.length) {
      toast("캐릭터, 로케이션, 장르를 각각 하나 이상 선택해 주세요.");
      return;
    }

    const submitButton = event.target.querySelector("button[type='submit']");
    submitButton.disabled = true;
    submitButton.textContent = "생성 중...";
    try {
      const result = await api("/api/scripts/generate", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      state.scripts.unshift({ ...result.script, scenes: result.scenes });
      await loadAll();
      toast("대본과 장면 프롬프트를 생성했습니다.");
      document.querySelector('[data-view="dashboard"]').click();
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "LLM으로 장면 보드 생성";
    }
  });

  $("#sceneBoard").addEventListener("click", handleSceneAction);
}

async function handleSceneAction(event) {
  const button = event.target.closest("[data-scene-action]");
  if (!button) return;

  const { sceneAction, sceneId } = button.dataset;
  const scene = allScenes().find((item) => item.id === sceneId);
  if (!scene) return;

  if (sceneAction === "copy-image") {
    await navigator.clipboard.writeText(scene.image_prompt || "");
    toast("이미지 프롬프트를 복사했습니다.");
    return;
  }
  if (sceneAction === "copy-video") {
    await navigator.clipboard.writeText(scene.video_prompt || "");
    toast("영상 프롬프트를 복사했습니다.");
    return;
  }

  const kind = sceneAction.replace("regen-", "");
  button.disabled = true;
  button.textContent = "재생성 중...";
  try {
    await api(`/api/scenes/${sceneId}/regenerate`, {
      method: "POST",
      body: JSON.stringify({ kind })
    });
    await loadAll();
    toast("장면을 새 버전으로 갱신했습니다.");
  } finally {
    button.disabled = false;
  }
}

async function loadAll() {
  const [health, projects, characters, locations, scripts, generations] = await Promise.all([
    api("/api/health"),
    api("/api/projects"),
    api("/api/characters"),
    api("/api/locations"),
    api("/api/scripts"),
    api("/api/generations")
  ]);

  state.project = projects[0];
  state.characters = characters;
  state.locations = locations;
  state.scripts = scripts.reverse();
  state.generations = generations;

  $("#systemStatus").textContent = `${health.storage} · ${health.llm}`;
  render();
}

function render() {
  $("#metricCharacters").textContent = state.characters.length;
  $("#metricLocations").textContent = state.locations.length;
  $("#metricScripts").textContent = state.scripts.length;
  $("#metricGenerations").textContent = state.generations.length;

  renderProjectBible();
  renderAssets("#characterList", state.characters, characterCard);
  renderAssets("#locationList", state.locations, locationCard);
  renderChoices();
  renderScenes();
  renderHistory();
}

function renderProjectBible() {
  if (!state.project) return;
  const bible = state.project.bible || {};
  const form = $("#projectBibleForm");
  form.elements.name.value = state.project.name || "";
  form.elements.audience.value = bible.audience || "";
  form.elements.world.value = bible.world || "";
  form.elements.tone.value = bible.tone || "";
  form.elements.rules.value = bible.rules || "";
  form.elements.visual_style.value = bible.visual_style || "";
}

function renderAssets(selector, items, card) {
  const container = $(selector);
  container.innerHTML = items.length ? items.map(card).join("") : `<p class="empty">아직 등록된 항목이 없습니다.</p>`;
}

function characterCard(item) {
  return `
    <article class="asset-card">
      <h3>${escapeHtml(item.name)} · ${escapeHtml(item.role || "")}</h3>
      <p>${escapeHtml(item.speech_style || "말투 설정 없음")}</p>
      <div class="tags">${(item.traits || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
      <div class="prompt-block">${escapeHtml(item.visual_prompt || "비주얼 프롬프트 없음")}</div>
    </article>
  `;
}

function locationCard(item) {
  return `
    <article class="asset-card">
      <h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml([item.mood, item.era, item.lighting].filter(Boolean).join(" · ") || "분위기 설정 없음")}</p>
      <div class="prompt-block">${escapeHtml(item.visual_prompt || "비주얼 프롬프트 없음")}</div>
    </article>
  `;
}

function renderChoices() {
  $("#characterChoices").innerHTML = state.characters.length
    ? state.characters.map((item) => choice("character", item.id, item.name)).join("")
    : `<p class="empty">캐릭터를 먼저 추가하세요.</p>`;

  $("#locationChoices").innerHTML = state.locations.length
    ? state.locations.map((item) => choice("location", item.id, item.name)).join("")
    : `<p class="empty">로케이션을 먼저 추가하세요.</p>`;

  $("#genreChoices").innerHTML = state.genres.map((genre) => choice("genre", genre, genre)).join("");
}

function choice(group, value, label) {
  return `
    <label class="choice">
      <input type="checkbox" name="${group}" value="${escapeHtml(value)}" />
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function renderScenes() {
  const scenes = allScenes();
  const board = $("#sceneBoard");
  board.classList.toggle("empty", scenes.length === 0);
  board.innerHTML = scenes.length ? scenes.map(sceneCard).join("") : "아직 생성된 장면이 없습니다.";
}

function sceneCard(scene) {
  const location = state.locations.find((item) => item.id === scene.location_id);
  const characters = state.characters.filter((item) => (scene.character_ids || []).includes(item.id));
  const score = Number(scene.quality_score || 0);
  return `
    <article class="scene-card">
      <div class="scene-head">
        <div>
          <h3>${escapeHtml(scene.scriptTitle)} · EP${scene.episode_number} SC${scene.scene_number}</h3>
          <p>${escapeHtml(scene.beat || "")}</p>
        </div>
        <span class="score ${score >= 85 ? "good" : ""}">${score || "-"}점</span>
      </div>
      <div class="scene-meta">
        <span>장소: ${escapeHtml(location ? location.name : "미지정")}</span>
        <span>등장: ${escapeHtml(characters.map((item) => item.name).join(", ") || "미지정")}</span>
      </div>
      <p><strong>대사</strong><br />${escapeHtml(scene.dialogue || "")}</p>
      <p><strong>연기/액션</strong><br />${escapeHtml(scene.action || "")}</p>
      <p><strong>연속성 메모</strong><br />${escapeHtml(scene.continuity_notes || "아직 없음")}</p>
      <div class="prompt-block"><strong>Image</strong><br />${escapeHtml(scene.image_prompt || "")}</div>
      <div class="prompt-block"><strong>Video</strong><br />${escapeHtml(scene.video_prompt || "")}</div>
      <div class="scene-actions">
        <button class="secondary" data-scene-action="copy-image" data-scene-id="${scene.id}">이미지 복사</button>
        <button class="secondary" data-scene-action="copy-video" data-scene-id="${scene.id}">영상 복사</button>
        <button class="secondary" data-scene-action="regen-dialogue" data-scene-id="${scene.id}">대사 재생성</button>
        <button class="secondary" data-scene-action="regen-image_prompt" data-scene-id="${scene.id}">이미지 재생성</button>
        <button class="secondary" data-scene-action="regen-video_prompt" data-scene-id="${scene.id}">영상 재생성</button>
      </div>
    </article>
  `;
}

function renderHistory() {
  const container = $("#generationHistory");
  container.classList.toggle("empty", state.generations.length === 0);
  container.innerHTML = state.generations.length
    ? state.generations.map((item) => `
      <article class="history-card">
        <strong>${escapeHtml(item.generation_type)}</strong>
        <span>${escapeHtml(item.provider)} · ${escapeHtml(item.model)} · ${formatDate(item.created_at)}</span>
      </article>
    `).join("")
    : "아직 생성 기록이 없습니다.";
}

function allScenes() {
  return state.scripts.flatMap((script) => (script.scenes || []).map((scene) => ({ ...scene, scriptTitle: script.title })));
}

async function postForm(url, form) {
  const data = {};
  for (const [key, value] of new FormData(form).entries()) {
    if (value instanceof File) continue;
    data[key] = value;
  }
  data.project_id = state.project && state.project.id;
  return api(url, { method: "POST", body: JSON.stringify(data) });
}

async function uploadReferenceIfPresent(form, ownerType, ownerId, prompt) {
  const fileInput = form.elements.reference_file;
  const file = fileInput && fileInput.files && fileInput.files[0];
  if (!file) return null;
  const body = new FormData();
  body.append("file", file);
  body.append("owner_type", ownerType);
  body.append("owner_id", ownerId);
  body.append("kind", "reference_image");
  body.append("prompt", prompt || "");
  const response = await fetch("/api/assets/upload", { method: "POST", body });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Upload failed");
  return data;
}

function describeAsset(type, formData) {
  if (type === "character") {
    return [formData.get("role"), formData.get("traits"), formData.get("speech_style")].filter(Boolean).join(", ");
  }
  return [formData.get("mood"), formData.get("era"), formData.get("lighting")].filter(Boolean).join(", ");
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function checkedValues(name) {
  return $$(`input[name='${name}']:checked`).map((item) => item.value);
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  window.setTimeout(() => element.classList.remove("show"), 2600);
}

function formatDate(value) {
  return new Date(value).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
