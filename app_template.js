
const PROV_KR = __PROV__;
const PROV_JP = __PROV_JP__;
const PROV = Object.assign({}, PROV_KR, PROV_JP);   // 코드 앞 2자리 → 시·도 / 지방
const EMBLEMS = __EMBLEMS__;   // 지역 코드 → 공식 휘장(심벌) 이미지 URL
const CLIMATE = __CLIMATE__;   // 지역 코드 → [[월평균기온, 월강수량], x12]
const FESTIVALS = __FESTIVALS__;   // 매년 열리는 대표 축제 [{n:이름, c:코드, m:[월], t:태그, d:설명}]
const TRENDING = __TRENDING__;     // 인기 여행지 {코드: {s:점수, t:테마}}
const TRENDING_AT = __TRENDING_AT__;   // 인기도 기준일 (실시간 아님을 밝히기 위함)
const tooltip = document.getElementById("tooltip");
const $ = id => document.getElementById(id);

// ---- 나라별 지도 ----
const MAPS = {};
["kr", "jp"].forEach(cc => {
  const el = document.getElementById(cc === "kr" ? "map" : "mapJp");
  const vb0 = el.viewBox.baseVal;
  const home = { x: vb0.x, y: vb0.y, w: vb0.width, h: vb0.height };
  const ps = [...el.querySelectorAll(".g-munis path")];
  const marks = document.createElementNS("http://www.w3.org/2000/svg", "g");
  marks.setAttribute("pointer-events", "none");
  marks.setAttribute("class", "g-marks");
  el.insertBefore(marks, el.querySelector(".g-labels"));
  const byCode = {};
  ps.forEach(p => { byCode[p.dataset.code] = p; });
  const texts = [...el.querySelectorAll(".g-labels text")];
  // 라벨 수치를 미리 파싱해 둔다 (팬/줌마다 반복 파싱하지 않도록)
  const meta = texts.map(t => {
    const w = parseFloat(t.dataset.w) || 0;
    const h = parseFloat(t.dataset.h) || w;
    const name = t.textContent;
    // 군은 넓은 시골 지역인데도 도시의 작은 구들과 자리 다툼에서 밀리기 쉬워 우선순위를 준다
    const prio = name.endsWith("군") ? 1.6 : 1;
    return { t, code: t.dataset.code, w, h, area: w * h * prio,
             x: +t.getAttribute("x"), y: +t.getAttribute("y"),
             len: name.length };
  });
  // 큰 지역이 먼저 자리를 차지하도록 미리 정렬 (매 프레임 정렬 제거)
  const metaByArea = meta.slice().sort((a, b) => b.area - a.area);
  MAPS[cc] = {
    cc, svg: el, paths: ps,
    muniTexts: texts, labelMeta: meta, labelMetaByArea: metaByArea,
    provLabelsG: el.querySelector(".g-provlabels"),
    marksG: marks, pathByCode: byCode, bboxCache: {},
    home, vb: { ...home },
    labelAt: cc === "jp" ? Infinity : 6200,   // 이 폭(SVG 단위) 이하로 확대하면 지역명 표시
  };
});
let COUNTRY = "kr";
// 활성 지도 참조 (나라를 바꾸면 다시 바인딩)
let svg, paths, muniTexts, labelMeta, labelMetaByArea, provLabelsG, marksG, pathByCode, bboxCache, home, vb;
function bindMap(cc) {
  const m = MAPS[cc];
  COUNTRY = cc;
  svg = m.svg; paths = m.paths; muniTexts = m.muniTexts; provLabelsG = m.provLabelsG;
  labelMeta = m.labelMeta; labelMetaByArea = m.labelMetaByArea;
  marksG = m.marksG; pathByCode = m.pathByCode; bboxCache = m.bboxCache;
  home = m.home; vb = m.vb;
}
bindMap("kr");
// 시작은 한국 지도만 보이게
Object.values(MAPS).forEach(m => m.svg.classList.toggle("hidden", m.cc !== COUNTRY));
const MAPSVGS = Object.values(MAPS).map(m => m.svg);
// 지역명·소속은 두 나라를 합쳐서 참조 (검색·앨범용)
const nameByCode = {};
Object.values(MAPS).forEach(m => m.paths.forEach(p => { nameByCode[p.dataset.code] = p.dataset.name; }));
const countryOfCode = code => String(code)[0] === "9" ? "jp" : "kr";
// 통계 그룹: 도쿄 시·구(6자리)는 "9T", 그 외는 코드 앞 2자리
const groupOf = c => { c = String(c); return c.length === 6 ? "9T" : c.slice(0, 2); };

let ROOM = null, TOKEN = null;
let visited = new Set();
let photos = {};   // code -> [{url, name, vid}]
let notes = {};    // code -> {visits:[...]}
let selected = null;
let pollTimer = null;
let appliedStateFingerprint = "";

// 접속한 적 있는 지도 목록: {id: {name, token}}
const savedRooms = JSON.parse(localStorage.getItem("travelRooms") || "{}");
function rememberRoom(id, name, token) {
  savedRooms[id] = { name, token };
  localStorage.setItem("travelRooms", JSON.stringify(savedRooms));
}

// ---- API ----
// 쓰기 요청 추적 — 폴링이 방금 저장한 내용을 덮어쓰지 않게 하기 위함
let inflightWrites = 0, lastWriteAt = 0;
async function api(path, opts = {}) {
  const isWrite = !!opts.method && opts.method !== "GET";
  if (isWrite) inflightWrites++;
  opts.headers = Object.assign({ "x-token": TOKEN || "" }, opts.headers || {});
  try {
    const r = await fetch(path, opts);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(body.error || r.status), { status: r.status });
    return body;
  } finally {
    if (isWrite) { inflightWrites--; lastWriteAt = Date.now(); }
  }
}
function setBadge(on, text) {
  const b = $("syncBadge");
  b.className = on ? "on" : "off";
  b.textContent = text || (on ? "동기화됨" : "연결 끊김");
}
const ICON_PIN = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.4-7-11a7 7 0 0 1 14 0c0 5.6-7 11-7 11Z"/><circle cx="12" cy="10" r="2.6"/></svg>';

// ---- 화면 전환 ----
function showLanding() {
  $("landing").style.display = "flex";
  $("app").style.display = "none";
  const ids = Object.keys(savedRooms);
  $("myRoomsWrap").style.display = ids.length ? "" : "none";
  $("myRooms").innerHTML = ids.map(id =>
    `<div class="room-row">` +
    `<a href="/?room=${encodeURIComponent(id)}">${ICON_PIN} ${escapeHtml(savedRooms[id].name || "")}</a>` +
    `<button class="room-forget" data-id="${escapeHtml(id)}" title="목록에서 지우기">&times;</button>` +
    `</div>`).join("");
  $("myRooms").querySelectorAll(".room-forget").forEach(b => {
    b.onclick = () => {
      // 목록에서만 빼는 것 — 지도 자체는 그대로 남는다 (링크로 다시 들어갈 수 있음)
      const id = b.dataset.id;
      if (!confirm(`"${savedRooms[id].name || id}"을(를) 목록에서 지울까요?\n지도는 삭제되지 않고, 링크로 다시 들어갈 수 있습니다.`)) return;
      delete savedRooms[id];
      localStorage.setItem("travelRooms", JSON.stringify(savedRooms));
      try { localStorage.removeItem("state:" + id); } catch {}
      showLanding();
    };
  });
}
// 마지막으로 받은 방 상태를 저장 — 오프라인에서도 지도·기록을 볼 수 있게
function cacheState(id, s) {
  try { localStorage.setItem("state:" + id, JSON.stringify(s)); } catch {}
}
function loadCachedState(id) {
  try { return JSON.parse(localStorage.getItem("state:" + id) || "null"); } catch { return null; }
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = canonicalize(value[key]);
      return out;
    }, {});
  }
  return value;
}
function stateFingerprint(name, visitedValue, photosValue, notesValue) {
  return JSON.stringify(canonicalize({
    name: name || "",
    visited: [...visitedValue].map(String).sort(),
    photos: photosValue || {},
    notes: notesValue || {},
  }));
}
async function enterRoom(id) {
  ROOM = id;
  TOKEN = savedRooms[id] ? savedRooms[id].token : null;
  appliedStateFingerprint = "";
  resetThumbnailQueue();
  const cached = loadCachedState(id);
  let startedFromCache = false;
  if (cached) {
    startApp(cached, false);
    setBadge(false, "동기화 중…");
    startedFromCache = true;
  }
  try {
    const s = await api(`/api/state?room=${id}`);
    if (ROOM !== id) return;
    cacheState(id, s);
    if (startedFromCache) {
      $("roomName").textContent = s.name;
      rememberRoom(id, s.name, TOKEN);
      applyState(s);
      migrateMergedCodes().catch(() => {});
      setBadge(true);
      updateLabels();
      setTimeout(backfillThumbs, 3000);   // 첫 화면이 뜬 뒤에 조용히
    } else {
      startApp(s);
    }
  } catch (e) {
    if (e.status === 403 || e.status === 404) {
      if (startedFromCache) showLanding();
      showJoin(id);
      return;
    }
    // 네트워크 실패: 캐시된 상태가 있으면 오프라인 보기 모드로 진입
    if (startedFromCache) {
      setBadge(false, "오프라인 (보기 전용)");
      return;
    }
    if (cached) {
      startApp(cached);
      setBadge(false, "오프라인 (보기 전용)");
      return;
    }
    alert("서버에 연결할 수 없습니다.");
    showLanding();
  }
}
function showJoin(id) {
  $("joinModal").style.display = "flex";
  $("joinPw").focus();
  $("joinBtn").onclick = async () => {
    $("joinErr").textContent = "";
    try {
      const j = await api("/api/join", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: id, password: $("joinPw").value })
      });
      TOKEN = j.token;
      rememberRoom(id, j.name, j.token);
      $("joinModal").style.display = "none";
      const s = await api(`/api/state?room=${id}`);
      cacheState(id, s);
      startApp(s);
    } catch (e) {
      $("joinErr").textContent = e.message === "Failed to fetch" ? "서버 연결 실패" : e.message;
    }
  };
  $("joinPw").onkeydown = e => { if (e.key === "Enter") $("joinBtn").click(); };
}
function startApp(state, runMigrations = true) {
  $("landing").style.display = "none";
  $("app").style.display = "flex";
  $("roomName").textContent = state.name;
  rememberRoom(ROOM, state.name, TOKEN);
  applyState(state);
  // 통합된 옛 코드의 방문·메모·사진을 새 코드로 이관 (있을 때만).
  // 비동기라 실패해도 앱 시작은 계속되게 둔다.
  if (runMigrations) migrateMergedCodes().catch(() => {});
  setBadge(true);
  updateLabels();
  setTimeout(backfillThumbs, 3000);   // 첫 화면이 뜬 뒤에 조용히
  maybeShowFirstHint();
  clearInterval(pollTimer);
  pollTimer = setInterval(refresh, 12000);   // 다른 사람의 변경 반영
}
// 지도에서 합쳐진 지역의 옛 코드를 새 코드로 이관한다.
//  - 도쿄 시·구(913xxx) → 도쿄도(93013)
//  - 한국 일반구(용인시수지구 등) → 모도시 (전주·청주·창원·용인 등 12개시)
const MERGED_CODES = {"38115": "38111", "38114": "38111", "38113": "38111", "38112": "38111", "37012": "37011", "35012": "35011", "34012": "34011", "33012": "33011", "31193": "31191", "31192": "31191", "31104": "31101", "31103": "31101", "31092": "31091", "31053": "31051", "31052": "31051", "31042": "31041", "31023": "31021", "31022": "31021", "31014": "31011", "31013": "31011", "31012": "31011"};
function mergedTargetOf(code) {
  if (/^913\d{3}$/.test(code)) return "93013";
  return MERGED_CODES[code] || null;
}
// 통합으로 사라진 옛 코드(도쿄 시·구, 일반구)의 기록을 새 코드로 옮긴다
async function migrateMergedCodes() {
  const pairs = [];
  [...visited, ...Object.keys(notes), ...Object.keys(photos)].forEach(c => {
    const t = mergedTargetOf(String(c));
    if (t && !pairs.some(p => p[0] === String(c))) pairs.push([String(c), t]);
  });
  if (!pairs.length) return;
  for (const [from, to] of pairs) await migrateCode(from, to);
}
async function migrateCode(from, to) {
  const oldVisits = visited.has(from) ? [from] : [];
  const oldNotes = notes[from] ? [from] : [];
  const oldPhotos = photos[from] ? [...photos[from]] : [];
  if (!oldVisits.length && !oldNotes.length && !oldPhotos.length) return;
  markDirty(to);
  markDirty(from);
  // 방문 이관
  if (oldVisits.length) {
    if (!visited.has(to)) {
      visited.add(to);
      api("/api/visited", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: ROOM, code: to, on: true }) }).catch(() => {});
    }
    oldVisits.forEach(c => {
      visited.delete(c); markDirty(c);
      api("/api/visited", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: ROOM, code: c, on: false }) }).catch(() => {});
    });
  }
  // 메모(방문 기록) 이관
  if (oldNotes.length) {
    const merged = getVisits(to);
    oldNotes.forEach(c => {
      getVisits(c).forEach(v => merged.push({ id: v.id || newVid(), start: v.start, end: v.end, memo: v.memo }));
      delete notes[c]; markDirty(c);
      api("/api/note", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: ROOM, code: c, visits: [] }) }).catch(() => {});
    });
    notes[to] = { visits: merged };
    api("/api/note", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: ROOM, code: to, visits: merged }) }).catch(() => {});
  }
  // 사진도 이전 지역 코드에서 새 모도시 코드로 이동
  if (oldPhotos.length) {
    photos[to] = photos[to] || [];
    for (const p of oldPhotos) {
      if (!photos[to].some(x => x.url === p.url)) photos[to].push(p);
      try {
        await api(`/api/photo?room=${ROOM}&code=${from}&to=${to}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: p.url })
        });
        photos[from] = (photos[from] || []).filter(x => x.url !== p.url);
        if (!photos[from].length) delete photos[from];
      } catch {}
    }
  }
  paintVisited(); render(); renderFeed();
}
function paintVisited() {
  // 두 나라 지도 모두 방문 색칠을 갱신 (나라를 바꿔도 색이 유지되도록)
  Object.values(MAPS).forEach(m =>
    m.paths.forEach(p => p.classList.toggle("visited", visited.has(p.dataset.code))));
}
// 최근에 로컬 편집한 지역 (code -> 만료 시각). 폴링이 이 지역을 덮어쓰지 않게 함.
const dirty = new Map();
function markDirty(code) { dirty.set(String(code), Date.now() + 6000); }
function applyState(s) {
  const now = Date.now();
  const inVisited = new Set((s.visited || []).map(String));
  const inPhotos = s.photos || {};
  const inNotes = s.notes || {};
  // 최근 로컬 편집(dirty) 지역은 서버 상태 대신 로컬 값을 유지 (동시 편집/폴링 클로버 방지)
  dirty.forEach((exp, code) => {
    if (exp < now) { dirty.delete(code); return; }
    if (visited.has(code)) inVisited.add(code); else inVisited.delete(code);
    if (notes[code]) inNotes[code] = notes[code]; else delete inNotes[code];
    if (photos[code]) inPhotos[code] = photos[code]; else delete inPhotos[code];
  });
  const fingerprint = stateFingerprint(s.name, inVisited, inPhotos, inNotes);
  const changed = fingerprint !== appliedStateFingerprint;
  visited = inVisited;
  photos = inPhotos;
  notes = inNotes;
  appliedStateFingerprint = fingerprint;
  if (!changed) return false;
  paintVisited();
  render();
  renderFeed();
  if (selected) renderPanel();
  return true;
}
async function refresh() {
  // 저장 중이거나 방금 저장했으면 건너뜀 (서버 응답이 뒤늦게 와서 로컬 편집을 지우는 것 방지)
  if (inflightWrites > 0 || Date.now() - lastWriteAt < 4000) return;
  // 입력 중이면 건너뜀 (타이핑하던 메모가 사라지지 않게)
  const ae = document.activeElement;
  if (ae && regionPanelEl && regionPanelEl.contains(ae)) return;
  try {
    const s = await api(`/api/state?room=${ROOM}`);
    cacheState(ROOM, s);
    const changed = applyState(s);
    setBadge(true);
    if (changed) updateLabels();
  } catch { setBadge(false, navigator.onLine ? "연결 끊김" : "오프라인 (보기 전용)"); }
}

$("createBtn").onclick = async () => {
  $("createErr").textContent = "";
  try {
    const j = await api("/api/rooms", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: $("newName").value.trim(), password: $("newPw").value })
    });
    TOKEN = j.token;
    rememberRoom(j.id, j.name, j.token);
    location.href = "/?room=" + j.id;
  } catch (e) {
    $("createErr").textContent = e.message === "Failed to fetch" ? "서버 연결 실패" : e.message;
  }
};
const inviteBtnHtml = $("inviteBtn").innerHTML;
$("inviteBtn").onclick = async () => {
  const link = location.origin + "/?room=" + ROOM;
  try { await navigator.clipboard.writeText(link); $("inviteBtn").textContent = "✓ 복사됨!"; }
  catch { prompt("초대 링크:", link); }
  setTimeout(() => { $("inviteBtn").innerHTML = inviteBtnHtml; }, 1500);
};
$("leaveBtn").onclick = () => { location.href = "/"; };

// ---- 지도 이미지 저장 / 공유 ----
const emblemDataCache = {};
async function toDataURL(url) {
  if (emblemDataCache[url]) return emblemDataCache[url];
  const blob = await (await fetch(url)).blob();
  const data = await new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(blob);
  });
  emblemDataCache[url] = data;
  return data;
}

async function buildMapImage() {
  const W = 800, H = 1100, HEADER = 132, DPR = 2;
  try { await document.fonts.ready; } catch {}   // 폰트 로드 후 렌더 (헤더 텍스트용)
  // 1) 지도 SVG 복제 (전국 뷰) + 방문 색 인라인 + 심벌 data URI
  const clone = svg.cloneNode(true);
  // 전국(홈) 뷰로 되돌린다. 좌표계가 SVG 단위이므로 home 값을 그대로 쓴다
  clone.setAttribute("viewBox", `${home.x} ${home.y} ${home.w} ${home.h}`);
  clone.removeAttribute("id");
  clone.querySelectorAll(".g-munis path").forEach(p => {
    p.classList.remove("visited", "selected");
    p.setAttribute("fill", visited.has(p.dataset.code) ? "#b7e4c7" : "#ffffff");
    p.setAttribute("stroke", "#c6cfd9");
    p.setAttribute("stroke-width", "5.5");   // 좌표계가 10배이므로 선 두께도 10배
  });
  // 라벨은 전국 뷰에서 겹치므로 제거, 마커만 다시 그림
  const cLabels = clone.querySelector(".g-labels"); if (cLabels) cLabels.remove();
  const cMarks = clone.querySelector(".g-marks"); if (cMarks) cMarks.remove();
  // 방문 심벌을 지역 라벨 중심(가장 큰 섬의 무게중심)에 data URI로 배치
  // — bbox 중심을 쓰면 먼 섬(이즈 제도 등)이 포함된 지역은 마커가 바다로 밀림
  // 겹침 회피로 밀어낸 y가 아니라 원래 라벨 좌표를 쓴다 (내보내기는 전국 뷰라 이동값이 무의미)
  const labelPos = {};
  labelMeta.forEach(m => { labelPos[m.code] = [m.x, m.y]; });
  const markG = document.createElementNS("http://www.w3.org/2000/svg", "g");
  for (const p of paths) {
    if (!visited.has(p.dataset.code)) continue;
    const bb = p.getBBox();
    const em = EMBLEMS[p.dataset.code];
    const size = Math.min(Math.min(bb.width, bb.height) * 0.9, 260);   // 상한도 SVG 단위(10배)
    const pos = labelPos[p.dataset.code] || [bb.x + bb.width / 2, bb.y + bb.height / 2];
    const cx = pos[0], cy = pos[1];
    if (em) {
      const data = await toDataURL(em);
      const img = document.createElementNS("http://www.w3.org/2000/svg", "image");
      img.setAttributeNS("http://www.w3.org/1999/xlink", "href", data);
      img.setAttribute("href", data);
      img.setAttribute("x", cx - size / 2); img.setAttribute("y", cy - size / 2);
      img.setAttribute("width", size); img.setAttribute("height", size);
      img.setAttribute("preserveAspectRatio", "xMidYMid meet");
      markG.appendChild(img);
    }
  }
  clone.appendChild(markG);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const svgStr = new XMLSerializer().serializeToString(clone);
  const svgImg = new Image();
  await new Promise((res, rej) => {
    svgImg.onload = res; svgImg.onerror = rej;
    svgImg.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
  });
  // 2) 캔버스에 헤더 + 지도
  const canvas = document.createElement("canvas");
  canvas.width = W * DPR; canvas.height = (H + HEADER) * DPR;
  const ctx = canvas.getContext("2d");
  ctx.scale(DPR, DPR);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H + HEADER);
  // 헤더 텍스트 (현재 보고 있는 나라 기준, 지도에 존재하는 코드만)
  let n = 0;
  visited.forEach(c => { if (countryOfCode(c) === COUNTRY && nameByCode[c]) n++; });
  const unit = COUNTRY === "jp" ? "도도부현" : "시·군·구";
  const pct = Math.round(n / paths.length * 1000) / 10;
  ctx.fillStyle = "#1f2937";
  ctx.font = "700 34px 'Pretendard Variable',Pretendard,'Malgun Gothic',sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillText($("roomName").textContent || "나의 여행 지도", 40, 58);
  ctx.fillStyle = "#3b9c6e";
  ctx.font = "700 26px 'Pretendard Variable',Pretendard,'Malgun Gothic',sans-serif";
  const pctStr = `${pct}%`;
  ctx.fillText(pctStr, 40, 100);
  const pctW = ctx.measureText(pctStr).width;
  ctx.fillStyle = "#6b7280";
  ctx.font = "400 18px 'Pretendard Variable',Pretendard,'Malgun Gothic',sans-serif";
  ctx.fillText(`${n} / ${paths.length} ${unit} 방문`, 40 + pctW + 12, 100);
  ctx.textAlign = "right";
  ctx.fillStyle = "#9ca3af";
  ctx.font = "400 15px 'Pretendard Variable',Pretendard,'Malgun Gothic',sans-serif";
  ctx.fillText("map-for-memory", W - 40, 100);
  ctx.textAlign = "left";
  ctx.strokeStyle = "#eef0f3"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(40, HEADER - 12); ctx.lineTo(W - 40, HEADER - 12); ctx.stroke();
  ctx.drawImage(svgImg, 0, HEADER, W, H);
  return await new Promise(res => canvas.toBlob(res, "image/png"));
}

$("saveBtn").onclick = async () => {
  const btn = $("saveBtn");
  const orig = btn.innerHTML;
  btn.textContent = "만드는 중…"; btn.disabled = true;
  try {
    const blob = await buildMapImage();
    const fname = `${($("roomName").textContent || "여행지도").replace(/[\\/:*?"<>|]/g, "")}.png`;
    const file = new File([blob], fname, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: $("roomName").textContent });
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  } catch (e) {
    if (e && e.name !== "AbortError") alert("이미지를 만들지 못했어요. 다시 시도해 주세요.");
  } finally {
    btn.innerHTML = orig; btn.disabled = false;
  }
};

// ---- 탭 = 지역 선택만 (방문 표시는 패널의 버튼으로) ----
// 탭 위치의 지역을 찾되, 정확히 못 맞히면 화면상 가장 가까운 지역으로 스냅 (작은 구 대응)
function regionAt(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  if (el && el.parentElement && el.parentElement.classList.contains("g-munis") && el.dataset.code)
    return el.dataset.code;
  const r = svg.getBoundingClientRect();
  if (!r.width) return null;
  const px = vb.x + (clientX - r.left) / r.width * vb.w;
  const py = vb.y + (clientY - r.top) / r.height * vb.h;
  let best = null, bestD = Infinity;
  for (const p of paths) {
    const bb = regionBBox(p.dataset.code);
    if (!bb || !bb.width) continue;
    const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
    const d = Math.hypot(cx - px, cy - py);
    if (d < bestD) { bestD = d; best = p; }
  }
  const tolSvg = 26 / (r.width / vb.w);   // 화면상 26px 이내면 스냅
  return best && bestD < tolSvg ? best.dataset.code : null;
}
function handleTap(clientX, clientY) {
  const code = regionAt(clientX, clientY);
  if (code) select(code);
}
function toggleVisited(code) {
  markDirty(code);
  const p = paths.find(x => x.dataset.code === code);
  const on = !visited.has(code);
  if (on) { visited.add(code); p.classList.add("visited"); }
  else { visited.delete(code); p.classList.remove("visited"); }
  render(); updateLabels();
  api("/api/visited", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room: ROOM, code, on })
  }).then(() => setBadge(true)).catch(() => setBadge(false));
}

// ---- 모바일 레이아웃: 하단 탭 + 바텀시트 ----
const mq = window.matchMedia("(max-width: 720px)");
const asideEl = document.querySelector("aside");
const regionPanelEl = $("regionPanel");
function layoutMode() {
  document.body.classList.toggle("is-mobile", mq.matches);
  if (mq.matches) {
    document.body.appendChild(regionPanelEl);   // 바텀시트로 이동
  } else {
    // 사이드바 상단(추천·앨범 위)으로 복귀.
    // 기준점은 aside의 '직계' 자식이어야 한다 — 섹션 안쪽 요소를 쓰면 insertBefore가 터진다.
    asideEl.insertBefore(regionPanelEl, $("recSection"));
    regionPanelEl.classList.remove("open");
    setTab("map");
  }
}
function setTab(t) {
  // 추천과 기록은 같은 화면(사이드) 안에 있고, 어디로 스크롤할지만 다르다
  document.body.classList.toggle("tab-stats", t !== "map");
  document.body.classList.toggle("tab-rec", t === "rec");
  $("tabMap").classList.toggle("active", t === "map");
  $("tabStats").classList.toggle("active", t === "stats");
  $("tabRec").classList.toggle("active", t === "rec");
  if (t === "map") { updateLabels(); return; }   // 숨겨져 있던 동안 크기가 0이었으므로 다시 계산
  // 모바일은 추천/기록이 서로 다른 화면이라 위에서부터 보여주면 된다.
  // 데스크톱은 한 화면에 다 있으므로 해당 섹션으로 스크롤한다.
  const head = t === "rec" ? $("recHead") : $("feedHead");
  asideEl.scrollTo({ top: mq.matches ? 0 : Math.max(0, head.offsetTop - 8), behavior: "smooth" });
}
$("tabMap").onclick = () => setTab("map");
$("tabStats").onclick = () => setTab("stats");
$("tabRec").onclick = () => setTab("rec");
$("mapStatPill").onclick = () => setTab("stats");
$("rpClose").onclick = () => {
  regionPanelEl.classList.remove("open");
  paths.forEach(p => p.classList.remove("selected"));
  selected = null;
};
mq.addEventListener("change", layoutMode);
window.addEventListener("resize", layoutMode);
layoutMode();

// ---- 선택 지역 패널 ----
function select(code) {
  setCountry(countryOfCode(code));   // 다른 나라 지역이면 지도부터 전환
  selected = code;
  dismissFirstHint();
  paths.forEach(p => p.classList.toggle("selected", p.dataset.code === code));
  renderPanel();
  if (mq.matches) regionPanelEl.classList.add("open");
}
function renderPanel() {
  if (!selected) return;
  const p = paths.find(x => x.dataset.code === selected);
  $("rpHint").style.display = "none";
  $("rpBody").style.display = "";
  $("rpName").textContent = p.dataset.name;
  $("rpProv").textContent = PROV[groupOf(selected)] || "";
  const emblem = EMBLEMS[selected];
  $("rpEmblem").style.display = emblem ? "block" : "none";
  if (emblem) $("rpEmblem").src = emblem;
  const v = visited.has(selected);
  const t = $("rpToggle");
  t.textContent = v ? "✓ 방문함" : "방문 표시";
  t.className = v ? "v" : "";
  renderVisits();
  // 방문에 속하지 않은 사진(예전 기록)만 따로 표시
  const unassigned = unassignedPhotos(selected);
  $("unassignedHead").style.display = unassigned.length ? "" : "none";
  const grid = $("photoGrid");
  grid.innerHTML = unassigned.length ? photoGridHtml(unassigned) : "";
  wirePhotoGrid(grid, selected);
}
$("rpToggle").onclick = () => { if (selected) { toggleVisited(selected); renderPanel(); } };

// ---- 방문 기록(여러 번 방문 지원) ----
// 저장 형태: notes[code] = { visits: [{start, end, memo}] }
// 예전 형태({date, memo})는 읽을 때 자동 변환
function newVid() { return "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ---- 사진을 다른 방문으로 옮기기 ----
function openMovePicker(code, url) {
  const cur = ((photos[code] || []).find(p => p.url === url) || {}).vid || "";
  const vs = getVisits(code);
  const rows = vs.map(v => {
    const d = visitDateText(v) || "날짜 없는 방문";
    const memo = v.memo ? `<span class="mv-memo">${escapeHtml(v.memo.slice(0, 30))}</span>` : "";
    return `<button data-vid="${v.id}" class="${v.id === cur ? "cur" : ""}">${d}${memo}</button>`;
  });
  rows.push(`<button data-vid="" class="${cur ? "" : "cur"}">방문일 미지정</button>`);
  if (!vs.length) {
    rows.unshift(`<div class="mv-memo" style="margin-bottom:8px">먼저 '+ 방문 추가'로 방문 기록을 만들어 주세요.</div>`);
  }
  $("moveList").innerHTML = rows.join("");
  $("moveList").querySelectorAll("button[data-vid]").forEach(b => {
    b.onclick = () => movePhoto(code, url, b.dataset.vid);
  });
  $("movePicker").classList.add("show");
}
$("moveCancel").onclick = () => $("movePicker").classList.remove("show");
$("movePicker").onclick = (e) => { if (e.target.id === "movePicker") $("movePicker").classList.remove("show"); };
async function movePhoto(code, url, vid) {
  markDirty(code);
  $("movePicker").classList.remove("show");
  try {
    await api(`/api/photo?room=${ROOM}&code=${code}&vid=${encodeURIComponent(vid)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    const p = (photos[code] || []).find(x => x.url === url);
    if (p) p.vid = vid;
    renderPanel(); renderFeed();
    setBadge(true);
  } catch { alert("옮기지 못했어요. 다시 시도해 주세요."); setBadge(false); }
}
function normVisits(raw) {
  if (!raw) return [];
  if (Array.isArray(raw.visits)) return raw.visits.map(v => ({
    id: v.id || newVid(), start: v.start || "", end: v.end || "", memo: v.memo || ""
  }));
  if (raw.date || raw.memo) return [{ id: newVid(), start: raw.date || "", end: "", memo: raw.memo || "" }];
  return [];
}
function getVisits(code) {
  const raw = notes[code];
  const vs = normVisits(raw);
  // 예전 데이터엔 방문 ID가 없어 매번 새로 생기므로, 한 번 부여하고 고정한다
  // (고정하지 않으면 사진-방문 연결이 계속 어긋남)
  const missing = vs.length && (!raw || !Array.isArray(raw.visits) || raw.visits.some(v => !v.id));
  if (missing) {
    notes[code] = { visits: vs };
    if (ROOM) {
      api("/api/note", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: ROOM, code, visits: vs })
      }).catch(() => {});
    }
  }
  return vs;
}
// 방문별 사진 / 방문일 미지정 사진
function photosOfVisit(code, vid) {
  return (photos[code] || []).filter(p => (p.vid || "") === vid);
}
function unassignedPhotos(code) {
  const ids = new Set(getVisits(code).map(v => v.id));
  return (photos[code] || []).filter(p => !p.vid || !ids.has(p.vid));
}
function photoGridHtml(list) {
  if (!list.length) return "";
  return `<div class="v-photos">${list.map(p =>
    `<div class="ph"><img src="${thumbOf(p)}" alt="${escapeHtml(p.name || "")}" loading="lazy" decoding="async" data-full="${p.url}">` +
    `<button class="del" data-url="${p.url}" title="삭제">✕</button>` +
    `<button class="mv" data-url="${p.url}" title="다른 방문으로 옮기기">이동</button></div>`).join("")}</div>`;
}
// 그리드 안의 사진 클릭(확대)·삭제 연결
function wirePhotoGrid(root, code) {
  const urls = [...root.querySelectorAll("img[data-full]")].map(i => i.dataset.full);
  root.querySelectorAll("img[data-full]").forEach(img => {
    img.onclick = (ev) => {
      ev.stopPropagation();
      openLightbox(urls, img.dataset.full);
    };
  });
  root.querySelectorAll("button.mv[data-url]").forEach(btn => {
    btn.onclick = (ev) => { ev.stopPropagation(); openMovePicker(code, btn.dataset.url); };
  });
  root.querySelectorAll("button.del[data-url]").forEach(btn => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      if (!confirm("이 사진을 삭제할까요?")) return;
      const url = btn.dataset.url;
      markDirty(code);
      try {
        await api(`/api/photo?room=${ROOM}&code=${code}`, {
          method: "DELETE", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url })
        });
        photos[code] = (photos[code] || []).filter(x => x.url !== url);
        if (!photos[code].length) delete photos[code];
        renderPanel(); renderFeed();
      } catch { alert("삭제 실패"); }
    };
  });
}

function renderVisits() {
  const list = $("visitList");
  const visits = getVisits(selected);
  list.innerHTML = visits.map((v, i) => `
    <div class="visit-card" data-i="${i}">
      <div class="visit-top">
        <span class="dlabel">📅 방문일 <em>(하루면 시작일만)</em></span>
        <button class="visit-del" title="이 방문 기록 삭제">✕</button>
      </div>
      <div class="visit-dates">
        <input type="date" class="v-start" value="${v.start}" max="2999-12-31" aria-label="시작일">
        <span class="tilde">~</span>
        <input type="date" class="v-end" value="${v.end}" max="2999-12-31" aria-label="종료일(선택)">
      </div>
      <textarea rows="2" maxlength="500" class="v-memo" placeholder="이때의 기억을 남겨보세요">${escapeHtml(v.memo)}</textarea>
      ${photoGridHtml(photosOfVisit(selected, v.id))}
      <button class="v-addphoto" data-vid="${v.id}">📷 이 방문의 사진 추가</button>
    </div>`).join("");
  list.querySelectorAll(".visit-card").forEach(card => {
    const i = +card.dataset.i;
    const start = card.querySelector(".v-start");
    const end = card.querySelector(".v-end");
    const memo = card.querySelector(".v-memo");
    const commit = () => {
      const vs = getVisits(selected);
      if (!vs[i]) return;
      // 종료일이 시작일보다 빠르면 자동 교정
      let s = start.value, e = end.value;
      if (s && e && e < s) { e = s; end.value = e; }
      vs[i] = { id: vs[i].id, start: s, end: e, memo: memo.value };   // id 유지 (사진 연결)
      saveVisits(selected, vs);
    };
    start.onchange = commit;
    end.onchange = commit;
    let tmr = null;
    memo.oninput = () => { clearTimeout(tmr); tmr = setTimeout(commit, 600); };
    memo.onblur = () => { clearTimeout(tmr); commit(); };
    card.querySelector(".visit-del").onclick = async () => {
      const code = selected;
      const vs = getVisits(code);
      const gone = vs[i];
      const ph = gone ? photosOfVisit(code, gone.id) : [];
      if (ph.length && !confirm(`이 방문 기록과 사진 ${ph.length}장이 함께 삭제됩니다. 계속할까요?`)) return;
      for (const p of ph) {
        try {
          await api(`/api/photo?room=${ROOM}&code=${code}`, {
            method: "DELETE", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: p.url })
          });
        } catch {}
        photos[code] = (photos[code] || []).filter(x => x.url !== p.url);
      }
      if (photos[code] && !photos[code].length) delete photos[code];
      if (gone) noteRemoved(code, gone.id);   // 서버가 이 항목만 지우도록
      vs.splice(i, 1);
      saveVisits(code, vs);
      renderPanel();
    };
    card.querySelector(".v-addphoto").onclick = () => {
      pendingVid = card.querySelector(".v-addphoto").dataset.vid;
      $("photoInput").click();
    };
    wirePhotoGrid(card, selected);
  });
}
// 지운 방문 기록의 id를 지역별로 모아둔다.
// 서버는 '안 보낸 항목'이 삭제인지 모르는 것인지 구분할 수 없으므로,
// 지운 id를 함께 보내야 같이 쓰는 사람의 기록을 지우지 않고 합칠 수 있다.
const removedVisits = new Map();
function noteRemoved(code, id) {
  if (!id) return;
  const set = removedVisits.get(code) || new Set();
  set.add(id);
  removedVisits.set(code, set);
}
function saveVisits(code, visits) {
  markDirty(code);
  // 사용자가 명시적으로 추가한 방문은 비어 있어도 유지 (사진·날짜를 나중에 채울 수 있게)
  const clean = visits.filter(v => v.id);
  if (clean.length) notes[code] = { visits: clean };
  else delete notes[code];
  // 방문 기록을 남겼는데 아직 미방문이면 자동으로 방문 처리
  if (clean.length && !visited.has(code)) toggleVisited(code);
  renderFeed();
  const removed = [...(removedVisits.get(code) || [])];
  api("/api/note", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room: ROOM, code, visits: clean, removed })
  }).then(r => {
    setBadge(true);
    // 서버가 합쳐준 결과를 받아 다른 사람이 같은 지역에 남긴 기록도 바로 보이게 한다
    if (r && Array.isArray(r.visits)) {
      if (r.visits.length) notes[code] = { visits: r.visits };
      else delete notes[code];
      renderFeed();
      if (selected === code) renderVisits();
    }
  }).catch(() => setBadge(false));
}
let pendingVid = "";   // 어느 방문 기록에 사진을 올릴지
$("addVisitBtn").onclick = () => {
  if (!selected) return;
  const vs = getVisits(selected);
  vs.push({ id: newVid(), start: "", end: "", memo: "" });
  saveVisits(selected, vs);   // 바로 저장해야 동기화에 지워지지 않음
  renderVisits();
  const last = $("visitList").querySelector(".visit-card:last-child .v-start");
  if (last) last.focus();
};
// 날짜(기간) 표시용 문자열
function visitDateText(v) {
  const f = d => d.replace(/-/g, ".");
  if (v.start && v.end && v.end !== v.start) {
    // 같은 해·달이면 끝 날짜는 일만 (2026.07.15~16)
    const [ys, ms] = v.start.split("-"), [ye, me, de] = v.end.split("-");
    if (ys === ye && ms === me) return `${f(v.start)}~${de}`;
    if (ys === ye) return `${f(v.start)}~${me}.${de}`;
    return `${f(v.start)}~${f(v.end)}`;
  }
  return f(v.start || v.end || "");
}

// 여행 앨범 피드 (기록 탭): 방문 날짜 최신순, 사진·메모 있는 곳 위주
// ---- 여행 통계 카드 (현재 보고 있는 나라 기준) ----
function renderStatsCards() {
  const box = $("statsCards");
  if (!box) return;
  const cards = [];
  const thisYear = new Date().getFullYear();
  let photoCount = 0, visitCount = 0, yearCount = 0, longest = null, firstD = null, lastD = null;
  const regionVisits = [];   // {code, n} 방문 횟수
  const yearSet = new Set();

  Object.keys(nameByCode).forEach(code => {
    if (countryOfCode(code) !== COUNTRY) return;
    const vs = getVisits(code).filter(v => v.start || v.end || v.memo);
    const ph = (photos[code] || []).length;
    photoCount += ph;
    if (vs.length) regionVisits.push({ code, n: vs.length });
    vs.forEach(v => {
      visitCount++;
      const s = v.start || v.end;
      if (s) {
        const y = +s.slice(0, 4);
        yearSet.add(y);
        if (y === thisYear) yearCount++;
        if (!firstD || s < firstD) firstD = s;
        if (!lastD || s > lastD) lastD = s;
        // 가장 긴 여행(기간)
        if (v.start && v.end && v.end > v.start) {
          const days = Math.round((Date.parse(v.end) - Date.parse(v.start)) / 86400000) + 1;
          if (!longest || days > longest.days) longest = { code, days, text: visitDateText(v) };
        }
      }
    });
  });

  const visitedHere = [...visited].filter(c => countryOfCode(c) === COUNTRY && nameByCode[c]).length;
  if (!visitedHere && !visitCount && !photoCount) {
    box.innerHTML = "";
    $("statsCardHead").style.display = "none";
    return;
  }

  const unit = COUNTRY === "jp" ? "도도부현" : "시·군·구";
  cards.push(`<div class="stat-card"><div class="sc-label">방문한 곳</div>
    <div class="sc-value"><em>${visitedHere}</em>곳</div>
    <div class="sc-sub">전체 ${paths.length}${unit}</div></div>`);

  if (yearCount) {
    cards.push(`<div class="stat-card"><div class="sc-label">올해 여행</div>
      <div class="sc-value"><em>${yearCount}</em>번</div>
      <div class="sc-sub">${thisYear}년 기록</div></div>`);
  } else if (visitCount) {
    cards.push(`<div class="stat-card"><div class="sc-label">남긴 여행 기록</div>
      <div class="sc-value"><em>${visitCount}</em>번</div>
      <div class="sc-sub">${yearSet.size ? yearSet.size + "개 연도" : "날짜 미기록"}</div></div>`);
  }

  const most = regionVisits.sort((a, b) => b.n - a.n)[0];
  if (most && most.n > 1) {
    cards.push(`<div class="stat-card"><div class="sc-label">가장 많이 간 곳</div>
      <div class="sc-value">${escapeHtml(nameByCode[most.code])}</div>
      <div class="sc-sub">${most.n}번 방문</div></div>`);
  }
  if (photoCount) {
    cards.push(`<div class="stat-card"><div class="sc-label">사진</div>
      <div class="sc-value"><em>${photoCount}</em>장</div>
      <div class="sc-sub">추억 기록</div></div>`);
  }
  if (longest) {
    cards.push(`<div class="stat-card"><div class="sc-label">가장 긴 여행</div>
      <div class="sc-value">${escapeHtml(nameByCode[longest.code] || "")} <em>${longest.days}일</em></div>
      <div class="sc-sub">${longest.text}</div></div>`);
  }
  if (firstD && lastD && firstD !== lastD) {
    const f = d => d.replace(/-/g, ".");
    cards.push(`<div class="stat-card wide"><div class="sc-label">여행의 기록</div>
      <div class="sc-value" style="font-size:15px">${f(firstD)} <span style="color:#9ca3af">→</span> ${f(lastD)}</div>
      <div class="sc-sub">첫 기록부터 최근까지</div></div>`);
  }
  box.innerHTML = cards.join("");
  $("statsCardHead").style.display = cards.length ? "" : "none";
}

// ---- 가볼 만한 곳 추천 ----
// CLIMATE: 지역 코드 -> [[월평균기온, 월강수량], x12] (2020~2024 실측 평년값, 빌드 때 미리 받아둠)
let recMonth = new Date().getMonth();      // 0-11

// 추천 점수 항목별 비중. 자료가 없는 항목은 0점 처리하지 않고 빼낸 뒤
// 남은 비중으로 다시 나눈다 — 인기도처럼 일부 지역만 자료가 있는 항목 때문에
// 자료 없는 지역이 부당하게 밀리는 것을 막기 위함.
// (지역 분산은 점수가 아니라 시·도당 노출 개수 제한으로 처리한다)
const REC_WEIGHTS = { weather: 0.35, season: 0.25, popular: 0.20, taste: 0.10 };
const festivalsByCode = FESTIVALS.reduce((byCode, festival) => {
  (byCode[festival.c] ||= []).push(festival);
  return byCode;
}, {});

// 여행하기 좋은 날씨 점수 — 기온이 18도에 가까울수록, 비가 적을수록 높다
function climateScore(t, p) {
  if (t == null || p == null) return null;
  const warmth = Math.max(0, 100 - Math.abs(t - 18) * 6);
  const dry = Math.max(0, 100 - Math.max(0, p - 60) * 0.35);
  return Math.round(warmth * 0.65 + dry * 0.35);
}

// 그 달에 축제가 있으면 높게. 없다고 0점은 아니라서 기본값을 둔다.
function seasonScore(code, month) {
  const fs = festivalsByCode[code] || [];
  if (!fs.length) return 30;
  if (fs.some(f => f.m.includes(month))) return 100;
  const near = (month % 12) + 1, prev = ((month + 10) % 12) + 1;
  return fs.some(f => f.m.includes(near) || f.m.includes(prev)) ? 55 : 35;
}

// 지금까지 다닌 곳에서 취향을 읽는다 (지역 유형 + 자주 간 시·도).
// 기록이 적으면 신호가 아니라 잡음이라 아예 항목에서 뺀다.
function tasteProfile() {
  const mine = [...visited].filter(c => nameByCode[c] && countryOfCode(c) === COUNTRY);
  if (mine.length < 6) return null;      // 몇 곳 안 가봤으면 취향이라 할 만한 게 없다
  const kind = {}, prov = {};
  mine.forEach(c => {
    const k = (nameByCode[c] || "").slice(-1);      // 시 / 군 / 구
    kind[k] = (kind[k] || 0) + 1;
    const g = groupOf(c);
    prov[g] = (prov[g] || 0) + 1;
  });
  return { kind, prov, n: mine.length };
}
function tasteScore(code, tp) {
  if (!tp) return null;
  const k = (nameByCode[code] || "").slice(-1);
  const kindShare = (tp.kind[k] || 0) / tp.n;             // 같은 유형을 얼마나 좋아하나
  const provShare = (tp.prov[groupOf(code)] || 0) / tp.n; // 그 시·도를 얼마나 자주 갔나
  // 한 지역만 계속 밀지 않도록 시·도 쏠림은 상한을 둔다
  return Math.round(Math.min(1, kindShare * 0.6 + Math.min(provShare, 0.4) * 1.0) * 100);
}

// 항목별 점수를 비중에 맞춰 합산하되, 자료 없는 항목은 비중째로 제외
function recScore(parts) {
  let sum = 0, w = 0;
  for (const key in REC_WEIGHTS) {
    if (parts[key] == null) continue;
    sum += parts[key] * REC_WEIGHTS[key];
    w += REC_WEIGHTS[key];
  }
  return w ? Math.round(sum / w) : null;
}
function climateWhy(t, p) {
  const heat = t >= 26 ? "덥지만" : t >= 20 ? "따뜻하고" : t >= 12 ? "선선하고" : t >= 4 ? "쌀쌀하고" : "춥지만";
  const wet = p >= 200 ? "비가 많아요" : p >= 110 ? "비가 잦은 편" : p >= 55 ? "비는 보통" : "비가 적어요";
  return `${heat} ${wet}`;
}

function buildRecommendationRows() {
  const rows = [];
  let unvisited = 0, haveData = 0;
  const tp = tasteProfile();
  const month = recMonth + 1;
  Object.keys(nameByCode).forEach(code => {
    if (countryOfCode(code) !== COUNTRY) return;
    const c = CLIMATE[code];
    if (c && c[recMonth]) haveData++;
    if (visited.has(code)) return;
    unvisited++;
    if (!c || !c[recMonth]) return;
    const [t, p] = c[recMonth];
    const weather = climateScore(t, p);
    if (weather == null) return;
    const hot = TRENDING[code];
    const parts = {
      weather,
      season: seasonScore(code, month),
      popular: hot ? hot.s : null,
      taste: tasteScore(code, tp),
    };
    rows.push({ code, t, p, parts, hot, s: recScore(parts) });
  });
  rows.sort((a, b) => b.s - a.s || a.code.localeCompare(b.code));
  return { rows, unvisited, haveData, month };
}

function takeDiverseRecommendations(rows, limit = 12) {
  const perProv = {}, top = [];
  for (const row of rows) {
    const group = groupOf(row.code);
    if ((perProv[group] = (perProv[group] || 0) + 1) > 2) continue;
    top.push(row);
    if (top.length === limit) break;
  }
  return top;
}

function recommendationReasons(row, month) {
  const why = [];
  if (row.parts.weather >= 70) why.push(`${month}월 날씨 좋음`);
  if (row.parts.season >= 100) why.push("이달 축제");
  else if (row.parts.season >= 55) why.push("축제 시즌 근접");
  if (row.hot) why.push(escapeHtml(row.hot.t));
  if (row.parts.taste != null && row.parts.taste >= 70) why.push("취향과 비슷");
  return why.length ? why : [climateWhy(row.t, row.p)];
}

function recommendationCard(row, month) {
  const emblem = EMBLEMS[row.code];
  return `<div class="rec-card" data-code="${row.code}">
    ${emblem ? `<img src="${emblem}" alt="" loading="lazy">` : ""}
    <div class="rec-main">
      <div class="rec-name">${escapeHtml(nameByCode[row.code])}</div>
      <div class="rec-why">${PROV[groupOf(row.code)] || ""} · ${recommendationReasons(row, month).join(" · ")}</div>
    </div>
    <div class="rec-num"><b>${row.t}°</b>${row.p}mm</div>
  </div>`;
}

function renderRecs() {
  const list = $("recList"), note = $("recNote"), sel = $("recMonth");
  if (!list) return;
  if (!sel.options.length) {
    sel.innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i}">${i + 1}월</option>`).join("");
    sel.value = recMonth;
  }
  // 같은 시·도가 몰리면 목록이 단조로워진다 (대구 자치구만 4개 같은 식). 시·도당 2곳까지.
  const { rows, unvisited, haveData, month } = buildRecommendationRows();
  const top = takeDiverseRecommendations(rows);
  const cName = COUNTRY === "jp" ? "일본" : "한국";
  // 결과가 없는 이유를 구분해서 알린다 (다 가본 것과 날씨 자료가 없는 것은 다르다)
  const at = TRENDING_AT ? `인기도는 ${TRENDING_AT} 기준 편집 자료입니다.` : "";
  note.textContent = rows.length
    ? `${cName}에서 아직 안 가본 ${rows.length}곳 중 ${month}월 날씨·축제·인기·취향을 함께 본 순서입니다. ${at}`
    : !haveData ? `${cName}은 아직 날씨 자료가 없습니다.`
    : !unvisited ? `${cName}은 이미 다 다녀오셨네요.`
    : `추천할 곳을 찾지 못했습니다.`;
  list.innerHTML = top.map(row => recommendationCard(row, month)).join("");
  list.querySelectorAll(".rec-card").forEach(el => {
    el.onclick = () => { setTab("map"); focusRegion(el.dataset.code); };
  });
  renderFestivals();
}

// 축제 기간 표시 — 실제 일정이 있으면 날짜로, 없으면 달로.
// 해마다 일정이 바뀌므로 지난해 자료는 연도를 붙여 지난 일정임을 밝힌다.
function festivalWhen(f) {
  const span = f.m.length > 1 ? `${f.m[0]}~${f.m[f.m.length - 1]}월` : `${f.m[0]}월`;
  if (!f.s || !f.e) return span;
  const y = +f.s.slice(0, 4), m1 = +f.s.slice(4, 6), d1 = +f.s.slice(6, 8);
  const m2 = +f.e.slice(4, 6), d2 = +f.e.slice(6, 8);
  const body = m1 === m2
    ? (d1 === d2 ? `${m1}.${d1}` : `${m1}.${d1}~${d2}`)
    : `${m1}.${d1}~${m2}.${d2}`;
  const thisYear = new Date().getFullYear();
  return y < thisYear ? `${y}년 ${body}` : body;
}

// 이달의 축제 — 매년 반복되는 행사라 '달'로만 다룬다 (정확한 일정은 해마다 바뀜)
function renderFestivals() {
  const list = $("fesList"), note = $("fesNote"), head = $("fesHead");
  if (!list) return;
  const m = recMonth + 1;
  const rows = FESTIVALS.filter(f => f.m.includes(m) && countryOfCode(f.c) === COUNTRY
                                     && nameByCode[f.c]);
  head.textContent = `${m}월의 축제`;
  const cName = COUNTRY === "jp" ? "일본" : "한국";
  const dated = rows.filter(f => f.s).length;
  note.textContent = rows.length
    ? (dated
        ? `날짜는 한국관광공사 자료 기준입니다. 해마다 달라지니 방문 전 확인하세요.`
        : "해마다 열리는 대표 축제입니다. 정확한 일정은 해마다 달라지니 확인 후 방문하세요.")
    : `${m}월에 등록된 ${cName} 축제가 없습니다.`;
  list.innerHTML = rows.map(f => {
    const span = festivalWhen(f);
    // 사진이 있으면 왼쪽에, 없으면 태그 배지로 (사진은 절반 정도만 있다)
    const lead = f.p
      ? `<img class="fes-photo" src="${f.p}" alt="" loading="lazy" decoding="async"
              title="${escapeHtml(f.cr || "")}">`
      : `<span class="fes-tag">${escapeHtml(f.t)}</span>`;
    return `<div class="fes-card${visited.has(f.c) ? " done" : ""}" data-code="${f.c}">
      ${lead}
      <div class="fes-main">
        <div class="fes-name">${escapeHtml(f.n)}</div>
        <div class="fes-sub">${escapeHtml(nameByCode[f.c])} · ${escapeHtml(f.d)}</div>
      </div>
      <span class="fes-when">${span}</span>
    </div>`;
  }).join("");
  list.querySelectorAll(".fes-card").forEach(el => {
    el.onclick = () => { setTab("map"); focusRegion(el.dataset.code); };
  });
}

// 기록 검색·기간 필터 상태 (지도 상태가 아니라 화면 조건이라 서버에 저장하지 않는다)
let feedQuery = "", feedYear = "";
const visitYear = v => (v.start || v.end || "").slice(0, 4);

// 연도 목록은 지금 나라의 기록에서 뽑는다 (나라를 바꾸면 다시 채워짐)
function syncYearOptions() {
  const sel = $("feedYear");
  if (!sel) return;
  const years = new Set();
  Object.keys(notes).forEach(code => {
    if (!nameByCode[code] || countryOfCode(code) !== COUNTRY) return;
    getVisits(code).forEach(v => { const y = visitYear(v); if (y) years.add(y); });
  });
  const list = [...years].sort((a, b) => b.localeCompare(a));
  if (sel.dataset.years === list.join(",")) return;    // 바뀐 게 없으면 그대로
  sel.dataset.years = list.join(",");
  // 지금 고른 연도가 사라졌으면 전체로 되돌린다
  if (feedYear && !years.has(feedYear)) feedYear = "";
  sel.innerHTML = `<option value="">전체 기간</option>` +
    list.map(y => `<option value="${y}">${y}년</option>`).join("");
  sel.value = feedYear;
}

function renderFeed() {
  renderStatsCards();
  renderRecs();
  const feed = $("memoryFeed");
  if (!feed) return;
  syncYearOptions();
  const q = feedQuery.trim().toLowerCase();
  const entries = [];
  let totalCodes = 0;
  const codes = new Set([...Object.keys(notes), ...Object.keys(photos)]);
  codes.forEach(code => {
    if (!nameByCode[code]) return;   // 지도에 없는 코드는 건너뜀
    if (countryOfCode(code) !== COUNTRY) return;   // 현재 나라의 기록만
    let visits = getVisits(code).filter(v => v.start || v.end || v.memo);
    let ph = photos[code] || [];
    if (!visits.length && ph.length === 0) return;
    totalCodes++;
    // 기간 필터: 해당 연도의 방문만 남기고, 남는 게 없으면 카드를 빼낸다
    if (feedYear) {
      visits = visits.filter(v => visitYear(v) === feedYear);
      if (!visits.length) return;
      const vids = new Set(visits.map(v => v.id));
      ph = ph.filter(p => p.vid && vids.has(p.vid));
    }
    // 검색: 지역명·시도명·메모에서 찾는다
    if (q) {
      const hay = [nameByCode[code], PROV[groupOf(code)] || "",
                   ...visits.map(v => v.memo || "")].join(" ").toLowerCase();
      if (!hay.includes(q)) return;
    }
    // 최신 방문이 위로
    visits.sort((a, b) => (b.start || b.end || "0").localeCompare(a.start || a.end || "0"));
    entries.push({ code, visits, photos: ph, latest: (visits[0] && (visits[0].start || visits[0].end)) || "0" });
  });
  entries.sort((a, b) => b.latest.localeCompare(a.latest));
  const filtering = !!(q || feedYear);
  $("feedFilter").style.display = totalCodes > 1 || filtering ? "" : "none";
  const empty = $("feedEmpty");
  empty.style.display = filtering && !entries.length ? "" : "none";
  empty.textContent = "조건에 맞는 기록이 없습니다.";
  feed.innerHTML = entries.map(e => {
    const emblem = EMBLEMS[e.code];
    const prov = PROV[groupOf(e.code)] || "";
    const name = nameByCode[e.code] || "";
    const countHtml = e.visits.length > 1
      ? `<span class="mem-count">${e.visits.length}번 방문</span>` : "";
    const visitsHtml = e.visits.map(v => {
      const d = visitDateText(v);
      const vp = e.photos.filter(p => (p.vid || "") === v.id);
      return `<div class="mem-visit">
        ${d ? `<span class="mem-vdate">${d}</span>` : ""}
        ${v.memo ? `<span class="mem-vmemo">${escapeHtml(v.memo)}</span>` : ""}
      </div>` + (vp.length
        ? `<div class="mem-photos">${vp.map(p =>
            `<img src="${thumbOf(p)}" loading="lazy" decoding="async" data-full="${p.url}">`).join("")}</div>`
        : "");
    }).join("");
    // 방문에 속하지 않은 사진은 맨 아래
    const vids = new Set(e.visits.map(v => v.id));
    const rest = e.photos.filter(p => !p.vid || !vids.has(p.vid));
    const photosHtml = rest.length
      ? `<div class="mem-photos">${rest.map(p =>
          `<img src="${thumbOf(p)}" loading="lazy" decoding="async" data-full="${p.url}">`).join("")}</div>`
      : "";
    return `<div class="mem-card" data-code="${e.code}">
      <div class="mem-head">
        ${emblem ? `<img src="${emblem}" alt="">` : ""}
        <div><div class="mem-title">${name}</div><div class="mem-prov">${prov}</div></div>
        ${countHtml}
      </div>${visitsHtml}${photosHtml}</div>`;
  }).join("");
  // 사진 클릭은 확대 (지역 이동 아님) — 같은 지역 카드의 사진끼리 넘겨보기
  feed.querySelectorAll(".mem-card").forEach(card => {
    const urls = [...card.querySelectorAll("img[data-full]")].map(i => i.dataset.full);
    card.querySelectorAll("img[data-full]").forEach(img => {
      img.onclick = (ev) => {
        ev.stopPropagation();
        openLightbox(urls, img.dataset.full);
      };
    });
  });
  feed.querySelectorAll(".mem-card").forEach(card => {
    card.onclick = () => focusRegion(card.dataset.code);
  });
}
function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// 첫 방문 안내: 방이 비어 있고, 이 방에서 아직 안내를 닫지 않았으면 표시
function maybeShowFirstHint() {
  const seenKey = "hintSeen:" + ROOM;
  const empty = visited.size === 0 && Object.keys(photos).length === 0;
  if (empty && !localStorage.getItem(seenKey)) $("firstHint").style.display = "block";
}
$("firstHintClose").onclick = () => {
  $("firstHint").style.display = "none";
  localStorage.setItem("hintSeen:" + ROOM, "1");
};
// 지역을 한 번 누르면 안내 자동 숨김
function dismissFirstHint() {
  if ($("firstHint").style.display === "block") {
    $("firstHint").style.display = "none";
    localStorage.setItem("hintSeen:" + ROOM, "1");
  }
}

// 사진 압축: 원본은 1600px JPEG, 목록용은 더 작은 WebP로 저장한다.
async function compressImage(file, max = 1600, quality = 0.85, outputType = "image/jpeg") {
  const sourceName = file.name || "photo";
  if (!/^image\//.test(file.type) && file.type !== "application/octet-stream") {
    return { blob: file, name: sourceName };
  }
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) return { blob: file, name: sourceName };
  const k = Math.min(1, max / Math.max(img.width, img.height));
  if (k === 1 && file.size < 2 * 1024 * 1024 && max >= 1600) {
    img.close?.();
    return { blob: file, name: sourceName };
  }
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  img.close?.();
  const blob = await new Promise(r => c.toBlob(r, outputType, quality));
  if (!blob) return { blob: file, name: sourceName };
  const ext = outputType === "image/webp" ? ".webp" : ".jpg";
  return { blob, name: sourceName.replace(/\.\w+$/, "") + ext };
}
// 목록에 쓸 작은 사진. 앨범 칸은 60px 남짓인데 원본(1600px)을 내려받으면
// 사진 한 장에 수백 KB가 들어 모바일에서 한참 걸린다.
const thumbOf = p => p.thumb || p.url;

// 썸네일이 도입되기 전에 올린 사진은 목록에서도 원본(수백 KB)을 받는다.
// 지도를 열었을 때 그런 사진을 찾아 조용히 썸네일을 만들어 올려둔다.
// 한 번만 하면 되고, 실패해도 원본으로 계속 보이므로 조용히 넘어간다.
let thumbFillRan = false;
async function backfillThumbs() {
  if (thumbFillRan || !ROOM) return;
  thumbFillRan = true;
  const todo = [];
  for (const [code, list] of Object.entries(photos)) {
    for (const p of list || []) if (p.url && !p.thumb) todo.push({ code, p });
  }
  if (!todo.length) return;
  for (const { code, p } of todo.slice(0, 40)) {     // 한 번에 너무 많이 하지 않는다
    try {
      const res = await fetch(p.url);
      if (!res.ok) continue;
      const file = new File([await res.blob()], (p.name || "photo.jpg"), { type: "image/jpeg" });
      const t = await compressImage(file, 400, 0.7);
      const r = await api(`/api/photo?room=${ROOM}&code=${code}&thumbfor=${encodeURIComponent(p.url)}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(t.name) },
        body: t.blob
      });
      p.thumb = r.thumb;
    } catch { /* 원본으로 계속 보이므로 넘어간다 */ }
  }
  renderFeed();
  if (selected) renderPanel();
}

// 썸네일 기능 도입 전에 올린 사진은 원본이 한 번 표시된 뒤, 유휴 시간에 작은 썸네일을 만든다.
// 실제로 화면에 나타난 사진만 한 장씩 처리해 첫 화면 네트워크를 방해하지 않는다.
const thumbnailQueue = [];
const queuedThumbnailUrls = new Set();
let thumbnailWorkerRunning = false;
function resetThumbnailQueue() {
  thumbnailQueue.length = 0;
  queuedThumbnailUrls.clear();
}
function findPhotoRecord(url) {
  for (const [code, list] of Object.entries(photos)) {
    const photo = (list || []).find(p => p.url === url);
    if (photo) return { code, photo };
  }
  return null;
}
function waitForIdle() {
  return new Promise(resolve => {
    if ("requestIdleCallback" in window) requestIdleCallback(() => resolve(), { timeout: 1500 });
    else setTimeout(resolve, 200);
  });
}
function queueMissingThumbnail(url) {
  const found = findPhotoRecord(url);
  if (!ROOM || !navigator.onLine || !found || found.photo.thumb || queuedThumbnailUrls.has(url)) return;
  queuedThumbnailUrls.add(url);
  thumbnailQueue.push({ room: ROOM, code: found.code, url });
  processThumbnailQueue();
}
async function processThumbnailQueue() {
  if (thumbnailWorkerRunning) return;
  thumbnailWorkerRunning = true;
  while (thumbnailQueue.length) {
    const job = thumbnailQueue.shift();
    try {
      if (job.room !== ROOM) continue;
      await waitForIdle();
      if (job.room !== ROOM) continue;
      const current = findPhotoRecord(job.url);
      if (!current || current.photo.thumb) continue;
      const response = await fetch(job.url, { cache: "force-cache" });
      if (!response.ok) continue;
      const source = await response.blob();
      if (!/^image\//.test(source.type) && source.type !== "application/octet-stream") continue;
      const t = await compressImage(source, 240, 0.68, "image/webp");
      if (job.room !== ROOM) continue;
      markDirty(job.code);
      const saved = await api(`/api/photo?room=${job.room}&code=${job.code}&thumbfor=${encodeURIComponent(job.url)}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(t.name) },
        body: t.blob
      });
      const live = findPhotoRecord(job.url);
      if (!live) continue;
      live.photo.thumb = saved.thumb;
      document.querySelectorAll("img[data-full]").forEach(img => {
        if (img.dataset.full === job.url) img.src = saved.thumb;
      });
      cacheState(ROOM, { name: $("roomName").textContent, visited: [...visited], photos, notes });
    } catch {
      // 원본 CORS나 일시적인 네트워크 오류가 있으면 원본 표시를 유지한다.
    } finally {
      queuedThumbnailUrls.delete(job.url);
    }
  }
  thumbnailWorkerRunning = false;
}
document.addEventListener("load", e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.full) return;
  if (img.getAttribute("src") === img.dataset.full) queueMissingThumbnail(img.dataset.full);
}, true);

$("photoInput").addEventListener("change", async e => {
  if (!selected) { e.target.value = ""; return; }
  const code = selected, vid = pendingVid;
  markDirty(code);
  const files = [...e.target.files];
  e.target.value = "";
  for (let i = 0; i < files.length; i++) {
    $("uploadMsg").textContent = `업로드 중… (${i + 1}/${files.length})`;
    try {
      const { blob, name } = await compressImage(files[i]);
      const j = await api(`/api/photo?room=${ROOM}&code=${code}&vid=${encodeURIComponent(vid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(name) },
        body: blob
      });
      const entry = { url: j.url, name: j.name, vid: j.vid || vid };
      (photos[code] = photos[code] || []).push(entry);
      // 목록용 작은 사진은 실패해도 원본으로 대체되므로 조용히 넘어간다
      try {
        const t = await compressImage(files[i], 240, 0.68, "image/webp");
        const r = await api(`/api/photo?room=${ROOM}&code=${code}&thumbfor=${encodeURIComponent(j.url)}`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(t.name) },
          body: t.blob
        });
        entry.thumb = r.thumb;
      } catch {}
    } catch { alert(`${files[i].name} 업로드 실패`); }
  }
  $("uploadMsg").textContent = "";
  // 사진만 올린 방문 기록도 서버에 남도록 저장
  if (vid) saveVisits(code, getVisits(code));
  else if ((photos[code] || []).length && !visited.has(code)) toggleVisited(code);
  renderPanel(); renderFeed();
});
// ---- 사진 크게 보기 (넘기기 + 확대/축소) ----
let lbList = [], lbIdx = 0;
let lbResetZoom = () => {};   // 확대 상태 초기화 (아래 확대 모듈에서 채움)
function openLightbox(urls, startUrl) {
  lbList = (urls && urls.length) ? urls : [startUrl];
  lbIdx = Math.max(0, lbList.indexOf(startUrl));
  const box = $("lightbox");
  box.classList.toggle("multi", lbList.length > 1);
  lbResetZoom();
  showLbPhoto();
  box.style.display = "flex";
}
function showLbPhoto() {
  const box = $("lightbox");
  box.querySelector("img").src = lbList[lbIdx];
  $("lbCount").textContent = `${lbIdx + 1} / ${lbList.length}`;
}
function lbMove(step) {
  if (lbList.length < 2) return;
  lbIdx = (lbIdx + step + lbList.length) % lbList.length;
  lbResetZoom();   // 사진을 넘기면 확대 해제
  showLbPhoto();
}
function closeLightbox() { lbResetZoom(); $("lightbox").style.display = "none"; }
$("lbPrev").onclick = (e) => { e.stopPropagation(); lbMove(-1); };
$("lbNext").onclick = (e) => { e.stopPropagation(); lbMove(1); };
document.addEventListener("keydown", (e) => {
  if ($("lightbox").style.display !== "flex") return;
  const zoomed = $("lightbox").classList.contains("zoomed");
  if (e.key === "Escape") { if (zoomed) lbResetZoom(); else closeLightbox(); }
  else if (e.key === "ArrowLeft") { if (!zoomed) lbMove(-1); }
  else if (e.key === "ArrowRight") { if (!zoomed) lbMove(1); }
});
// ---- 확대/축소 + 스와이프 ----
// 확대 안 했을 때: 좌우 스와이프=사진 넘기기, 위아래로 크게 밀면 닫기
// 확대했을 때: 드래그=화면 이동, 넘기기 비활성 (핀치·더블탭·휠로 배율 조절)
(() => {
  const box = $("lightbox");
  const img = box.querySelector("img");
  const MAXZ = 5;
  let scale = 1, tx = 0, ty = 0;
  const pts = new Map();
  let startDist = 0, startScale = 1, startMid = null, startTx = 0, startTy = 0;
  let dragStart = null, moved = false, lastTap = null;

  function apply() {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    box.classList.toggle("zoomed", scale > 1.01);
  }
  function clampPan() {
    // 확대된 이미지가 화면 밖으로 너무 빠져나가지 않게
    const r = img.getBoundingClientRect();
    const w = r.width / scale, h = r.height / scale;
    const maxX = Math.max(0, (w * scale - innerWidth) / 2 + 20);
    const maxY = Math.max(0, (h * scale - innerHeight) / 2 + 20);
    tx = Math.min(maxX, Math.max(-maxX, tx));
    ty = Math.min(maxY, Math.max(-maxY, ty));
  }
  function resetZoom() { scale = 1; tx = ty = 0; apply(); }
  lbResetZoom = resetZoom;    // 사진을 넘기거나 닫을 때 초기화

  function zoomAtPoint(nextScale, cx, cy) {
    const prev = scale;
    scale = Math.min(MAXZ, Math.max(1, nextScale));
    // 손가락(또는 커서) 위치를 기준으로 확대되도록 이동값 보정
    const k = scale / prev;
    tx = cx - (cx - tx) * k;
    ty = cy - (cy - ty) * k;
    if (scale === 1) { tx = ty = 0; } else clampPan();
    apply();
  }

  box.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".lb-nav")) return;
    pts.set(e.pointerId, e);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      startDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      startScale = scale;
      startMid = { x: (a.clientX + b.clientX) / 2 - innerWidth / 2,
                   y: (a.clientY + b.clientY) / 2 - innerHeight / 2 };
      startTx = tx; startTy = ty;
      dragStart = null;
    } else if (pts.size === 1) {
      dragStart = { x: e.clientX, y: e.clientY, tx, ty };
      moved = false;
    }
    try { box.setPointerCapture(e.pointerId); } catch {}
  });

  box.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, e);
    if (pts.size === 2 && startDist > 0) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const next = startScale * (d / startDist);
      const prev = scale;
      scale = Math.min(MAXZ, Math.max(1, next));
      const k = scale / startScale;
      tx = startTx + startMid.x * (1 - k);
      ty = startTy + startMid.y * (1 - k);
      if (scale === 1) { tx = ty = 0; } else clampPan();
      apply();
      moved = true;
    } else if (pts.size === 1 && dragStart) {
      const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
      if (scale > 1.01) {   // 확대 상태에서만 드래그로 이동
        tx = dragStart.tx + dx; ty = dragStart.ty + dy;
        clampPan(); apply();
      }
    }
  });

  function endPointer(e) {
    if (!pts.has(e.pointerId)) return;
    const wasSingle = pts.size === 1;
    const start = dragStart;
    pts.delete(e.pointerId);
    if (pts.size < 2) startDist = 0;
    if (!wasSingle || !start) { dragStart = null; return; }
    dragStart = null;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;

    if (scale <= 1.01) {
      // 확대 안 한 상태: 스와이프로 넘기기 / 아래위로 크게 밀면 닫기
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { lbMove(dx < 0 ? 1 : -1); return; }
      if (Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx)) { closeLightbox(); return; }
    }
    // 더블탭(또는 더블클릭): 확대 ↔ 원래대로
    if (!moved) {
      const now = Date.now();
      const near = lastTap && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40;
      if (lastTap && now - lastTap.t < 450 && near) {
        lastTap = null;
        const cx = e.clientX - innerWidth / 2, cy = e.clientY - innerHeight / 2;
        if (scale > 1.01) resetZoom(); else zoomAtPoint(2.5, cx, cy);
      } else {
        lastTap = { t: now, x: e.clientX, y: e.clientY };
        // 배경(이미지 밖) 단일 탭은 닫기 — 단, 더블탭일 수 있으니 잠깐 기다렸다 실행
        if (scale <= 1.01 && e.target.id === "lightbox") {
          const mine = lastTap;
          setTimeout(() => {
            if (lastTap === mine && scale <= 1.01) closeLightbox();   // 두 번째 탭이 없었으면 닫기
          }, 300);
        }
      }
    }
  }
  box.addEventListener("pointerup", endPointer);
  box.addEventListener("pointercancel", (e) => { pts.delete(e.pointerId); dragStart = null; startDist = 0; });

  // 데스크톱: 휠로 확대/축소
  box.addEventListener("wheel", (e) => {
    e.preventDefault();
    const cx = e.clientX - innerWidth / 2, cy = e.clientY - innerHeight / 2;
    zoomAtPoint(scale * (e.deltaY > 0 ? 1 / 1.2 : 1.2), cx, cy);
  }, { passive: false });
})();

// ---- 툴팁 (두 나라 지도 모두) ----
Object.values(MAPS).forEach(m => m.paths.forEach(p => {
  p.addEventListener("pointermove", e => {
    const code = p.dataset.code;
    const prov = PROV[groupOf(code)] || "";
    const mark = visited.has(code) ? ' <span class="v">✓ 방문</span>' : "";
    const ph = (photos[code] || []).length;
    tooltip.innerHTML = `${prov} ${p.dataset.name}${mark}${ph ? ` · 사진 ${ph}` : ""}`;
    tooltip.style.display = "block";
    tooltip.style.left = (e.clientX + 14) + "px";
    tooltip.style.top = (e.clientY + 14) + "px";
  });
  p.addEventListener("pointerleave", () => { tooltip.style.display = "none"; });
}));

// ---- 통계 (현재 보고 있는 나라 기준) ----
let provCodes = [], provTotals = {};
function buildProvList() {
  provTotals = {};
  paths.forEach(p => {
    const pc = groupOf(p.dataset.code);
    provTotals[pc] = (provTotals[pc] || 0) + 1;
  });
  provCodes = Object.keys(provTotals).sort();
  $("total").textContent = paths.length;
  $("statsHead").textContent = COUNTRY === "jp" ? "지방별 달성률" : "시·도별 달성률";
  $("unitLabel").textContent = COUNTRY === "jp" ? "도도부현" : "시·군·구";
  $("provList").innerHTML = provCodes.map(pc =>
    `<div class="prov-row" id="prov-${pc}"><span class="name">${PROV[pc] || ""}</span>` +
    `<div class="bar"><div></div></div><span class="num"></span></div>`).join("");
}
function render() {
  // 방문 수는 현재 나라 기준으로만 집계
  let n = 0;
  visited.forEach(c => { if (countryOfCode(c) === COUNTRY && nameByCode[c]) n++; });
  $("cnt").textContent = n;
  const pct = paths.length ? n / paths.length * 100 : 0;
  const pctText = (pct > 0 && pct < 10 ? pct.toFixed(1) : Math.round(pct)) + "%";
  $("pct").textContent = pctText;
  $("totalBar").style.width = pct + "%";
  $("mapStatPill").innerHTML = `<b>${n}</b> / ${paths.length} · ${pctText}`;
  const pv = {};
  visited.forEach(c => { if (!nameByCode[c]) return; const pc = groupOf(c); pv[pc] = (pv[pc] || 0) + 1; });
  provCodes.forEach(pc => {
    const row = $("prov-" + pc);
    if (!row) return;
    const v = pv[pc] || 0, t = provTotals[pc] || 0;
    row.querySelector(".bar > div").style.width = (t ? v / t * 100 : 0) + "%";
    row.querySelector(".num").textContent = `${v}/${t}`;
    row.classList.toggle("done", v === t && t > 0);
  });
}
buildProvList();

// ---- 확대/이동 + 라벨 표시 ----
function applyVB() {
  svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  updateLabels();
}
// 나라 전환
function setCountry(cc) {
  if (!MAPS[cc] || cc === COUNTRY) return;
  bindMap(cc);
  Object.values(MAPS).forEach(m => m.svg.classList.toggle("hidden", m.cc !== cc));
  document.querySelectorAll(".cswitch button").forEach(b =>
    b.classList.toggle("active", b.dataset.country === cc));
  // 선택 해제 후 활성 지도 기준으로 다시 그림
  selected = null;
  $("rpHint").style.display = "";
  $("rpBody").style.display = "none";
  if (mq.matches) regionPanelEl.classList.remove("open");
  buildProvList();
  render(); renderFeed(); applyVB();
}
document.querySelectorAll(".cswitch button").forEach(b => {
  b.onclick = () => setCountry(b.dataset.country);
});
function regionBBox(code) {
  // 숨겨진 상태(getBBox=0)는 캐시하지 않아 나중에 다시 정확히 측정
  if ((!bboxCache[code] || !bboxCache[code].width) && pathByCode[code]) {
    const bb = pathByCode[code].getBBox();
    if (bb.width) bboxCache[code] = bb;
    else return bb;
  }
  return bboxCache[code];
}
// 앨범 카드 → 해당 지역으로 지도 이동 + 선택
function focusRegion(code) {
  setTab("map");
  setCountry(countryOfCode(code));   // 다른 나라 지역이면 지도부터 전환
  const bb = regionBBox(code);
  if (bb && bb.width) {
    const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
    const ar = home.w / home.h;
    // 지역이 화면의 약 45%를 차지하도록 여백 포함 크기 계산
    let w = Math.max(bb.width, bb.height * ar) / 0.45;
    w = Math.min(Math.max(w, home.w / 18), home.w);
    let h = w / ar;
    vb = { x: cx - w / 2, y: cy - h / 2, w, h };
    applyVB();
  }
  select(code);
}

// ---- 지역 검색 (한국·일본 모두) ----
const searchIndex = Object.values(MAPS).flatMap(m => m.paths.map(p => ({
  code: p.dataset.code,
  name: p.dataset.name,
  prov: PROV[groupOf(p.dataset.code)] || "",
  cc: m.cc
})));
const searchInput = $("searchInput");
const searchResults = $("searchResults");
let srActive = -1, srItems = [];

function runSearch(q) {
  q = q.trim();
  if (!q) { closeSearch(); return; }
  const scored = [];
  for (const r of searchIndex) {
    const full = r.prov + " " + r.name;
    let score = -1;
    if (r.name.startsWith(q)) score = 0;
    else if (r.name.includes(q)) score = 1;
    else if (full.includes(q)) score = 2;
    if (score >= 0) scored.push({ ...r, score });
  }
  scored.sort((a, b) => (a.cc === COUNTRY ? 0 : 1) - (b.cc === COUNTRY ? 0 : 1)
    || a.score - b.score || a.name.localeCompare(b.name));
  srItems = scored.slice(0, 12);
  srActive = srItems.length ? 0 : -1;
  if (!srItems.length) {
    searchResults.innerHTML = `<div class="sr-empty">"${escapeHtml(q)}" 검색 결과가 없어요</div>`;
  } else {
    searchResults.innerHTML = srItems.map((r, i) => {
      const em = EMBLEMS[r.code];
      const vis = visited.has(r.code) ? `<span class="sr-visited">✓</span>` : "";
      return `<div class="sr-item${i === srActive ? " active" : ""}" data-code="${r.code}" data-i="${i}">
        ${em ? `<img src="${em}" alt="">` : ""}
        <span>${escapeHtml(r.name)}</span> ${vis}
        <span class="sr-prov">${r.cc === "jp" ? "🇯🇵 " : ""}${r.prov}</span>
      </div>`;
    }).join("");
    searchResults.querySelectorAll(".sr-item").forEach(el => {
      el.onmousedown = (e) => { e.preventDefault(); pickSearch(el.dataset.code); };
      el.onmouseenter = () => { srActive = +el.dataset.i; highlightSR(); };
    });
  }
  searchResults.classList.add("show");
}
function highlightSR() {
  searchResults.querySelectorAll(".sr-item").forEach((el, i) =>
    el.classList.toggle("active", i === srActive));
}
function pickSearch(code) {
  focusRegion(code);
  searchInput.value = "";
  closeSearch();
  searchInput.blur();
}
function closeSearch() {
  searchResults.classList.remove("show");
  searchResults.innerHTML = "";
  srItems = []; srActive = -1;
}
searchInput.addEventListener("input", () => runSearch(searchInput.value));
searchInput.addEventListener("focus", () => { if (searchInput.value.trim()) runSearch(searchInput.value); });
searchInput.addEventListener("keydown", (e) => {
  if (!srItems.length && e.key !== "Escape") return;
  if (e.key === "ArrowDown") { e.preventDefault(); srActive = Math.min(srActive + 1, srItems.length - 1); highlightSR(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); srActive = Math.max(srActive - 1, 0); highlightSR(); }
  else if (e.key === "Enter") { e.preventDefault(); if (srItems[srActive]) pickSearch(srItems[srActive].code); }
  else if (e.key === "Escape") { closeSearch(); searchInput.blur(); }
});
document.addEventListener("click", (e) => {
  if (!$("searchWrap").contains(e.target)) closeSearch();
});

// 이름이 겹칠 때 시도해 볼 세로 이동량(px). 0=제자리부터 위아래로 번갈아 넓혀간다.
const LABEL_NUDGE = [0, -7, 7, -14, 14, -21, 21, -28, 28];
function updateLabels() {
  const rect = svg.getBoundingClientRect();
  if (!rect.width) return;
  const pxPerUnit = rect.width / vb.w;
  svg.querySelector(".g-labels").style.fontSize = (11 / pxPerUnit) + "px";
  provLabelsG.style.fontSize = (13 / pxPerUnit) + "px";
  const showMuni = vb.w <= MAPS[COUNTRY].labelAt;
  provLabelsG.style.display = showMuni ? "none" : "";

  // --- 어떤 시·군·구 이름을 보일지: 큰 지역 우선, 겹치면 위아래로 밀어보고 그래도 안 되면 숨김 ---
  // (수치는 labelMeta에 미리 파싱, 정렬도 미리 해둠 — 팬/줌마다 재계산하지 않음)
  const shownSet = new Set();
  const offsets = new Map();        // code -> 세로 이동량(SVG 단위)
  if (showMuni) {
    const sx0 = rect.left - vb.x / vb.w * rect.width, kx = rect.width / vb.w;
    const sy0 = rect.top - vb.y / vb.h * rect.height, ky = rect.height / vb.h;
    const placed = [];
    for (const m of labelMetaByArea) {
      const isSel = m.code === selected;
      // 선택한 지역은 작아도(폭이 좁아도) 이름을 보여준다
      // (data-w가 라벨 자리의 실제 내부 폭이라 여백을 따로 두지 않는다)
      if (!isSel && m.w * pxPerUnit <= m.len * 11) continue;
      const sx = sx0 + m.x * kx, sy = sy0 + m.y * ky;
      // 겹침 판정 상자는 글자가 차지하는 크기에 맞춘다 (11px 글자 = 글자당 폭 11).
      // 여백이 넉넉하면 실제로는 안 겹치는 이름끼리 서로를 지운다.
      const halfW = m.len * 5.5 + 1;
      const l = sx - halfW, r = sx + halfW;
      // 화면 밖 라벨은 겹침 계산에서 제외 (가장 큰 절감)
      if (r < rect.left || l > rect.right) continue;
      // 자리가 없으면 지역 안에서 위아래로 조금씩 밀어 빈 곳을 찾는다.
      // 이동 한계는 지역 높이의 절반 — 이름이 자기 지역을 벗어나지 않게.
      const room = Math.max(0, m.h * ky / 2 - 7);
      for (let i = 0; i < LABEL_NUDGE.length; i++) {
        const dy = LABEL_NUDGE[i];
        if (Math.abs(dy) > room) continue;
        const t = sy + dy - 7, b = sy + dy + 7;
        if (b < rect.top || t > rect.bottom) continue;
        // 선택한 지역 이름은 겹쳐도 항상 표시 (어느 지역인지 헷갈리지 않게)
        let hit = false;
        if (!isSel) {
          for (let j = 0; j < placed.length; j++) {
            const p = placed[j];
            if (!(r < p.l || l > p.r || b < p.t || t > p.b)) { hit = true; break; }
          }
        }
        if (hit) continue;
        shownSet.add(m.code);
        placed.push({ l, r, t, b });
        if (dy) offsets.set(m.code, dy / ky);
        break;
      }
    }
  }
  const marks = [];
  labelMeta.forEach(m => {
    const t = m.t, code = m.code;
    const labelShown = showMuni && shownSet.has(code);
    t.style.display = labelShown ? "" : "none";
    // 겹침을 피해 밀어낸 만큼 실제로 옮긴다 (바뀔 때만 DOM 갱신)
    const off = labelShown ? (offsets.get(code) || 0) : 0;
    if (m.off !== off) { m.off = off; t.setAttribute("y", m.y + off); }
    if (labelShown) {
      t.classList.toggle("on-visited", visited.has(code));
      t.classList.toggle("sel-label", code === selected);
    }
    if (!visited.has(code)) return;
    const x = m.x, y = m.y, ly = m.y + off;
    // 화면(뷰박스) 밖 마커는 만들지 않는다 — 확대 시 대부분이 여기서 걸러짐
    const pad = Math.max(m.w, m.h);
    if (x + pad < vb.x || x - pad > vb.x + vb.w ||
        y + pad < vb.y || y - pad > vb.y + vb.h) return;
    const emblem = EMBLEMS[code];
    if (emblem) {
      // 지자체 심벌을 지역 안에 반투명하게 채움. 지역 크기에 맞추되 너무 작아지지 않게
      const w = m.w, h = m.h;
      // 심벌이 지역 경계를 넘지 않도록 지역 크기 안에 가둔다.
      const fontSvg = 11 / pxPerUnit;
      const availW = w * 0.86;
      // 라벨이 보이면 심벌은 이름 위쪽 공간에만 (지역 위 경계 ~ 라벨 위끝),
      // 안 보이면 지역 중심에 크게.
      const availH = labelShown
        ? Math.max(0, h / 2 - fontSvg * 0.6 - 2 / pxPerUnit)
        : h * 0.82;
      let size = Math.min(w, h) * 0.6;
      size = Math.min(size, availW, availH, 96 / pxPerUnit);
      size = Math.max(size, 12 / pxPerUnit);          // 너무 작지 않게
      size = Math.min(size, availW, availH);          // 단, 지역을 넘지는 않게 최종 캡
      const half = size / 2;
      let cx = x;
      // 이름이 밀려났으면 심벌도 그 위로 따라간다 (겹치지 않게)
      let cy = labelShown ? (ly - fontSvg * 0.5 - 2 / pxPerUnit - half) : y;
      // 심벌 상자를 지역 bbox 안으로 강제 클램프 (경계 밖으로 삐져나오지 않게)
      const bb = regionBBox(code);
      if (bb) {
        if (bb.width > size) cx = Math.min(Math.max(cx, bb.x + half), bb.x + bb.width - half);
        else cx = bb.x + bb.width / 2;
        if (bb.height > size) cy = Math.min(Math.max(cy, bb.y + half), bb.y + bb.height - half);
        else cy = bb.y + bb.height / 2;
      }
      marks.push(
        `<image href="${emblem}" x="${cx - half}" y="${cy - half}" width="${size}" height="${size}"` +
        ` opacity="0.72" preserveAspectRatio="xMidYMid meet"/>`);
    } else {
      // 휘장이 없는 지역은 체크 핀으로 (줌 무관 고정 크기)
      const s = 1 / pxPerUnit;
      const py = labelShown ? ly - 9 / pxPerUnit : y;
      marks.push(
        `<g transform="translate(${x} ${py}) scale(${s})">` +
        `<path d="M0 0C-4.5-6-8-9.2-8-13a8 8 0 1 1 16 0c0 3.8-3.5 7-8 13Z"` +
        ` fill="#2d6a4f" stroke="#ffffff" stroke-width="1.5"/>` +
        `<path d="M-3.2-14.5-0.8-12 3.4-16.2"` +
        ` stroke="#ffffff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
        `</g>`);
    }
  });
  marksG.innerHTML = marks.join("");
}
function zoomAt(cx, cy, factor) {
  const newW = Math.min(home.w * 2, Math.max(home.w / 20, vb.w * factor));
  const k = newW / vb.w;
  vb.x = cx - (cx - vb.x) * k;
  vb.y = cy - (cy - vb.y) * k;
  vb.w = newW; vb.h = vb.h * k;
  applyVB();
}
function clientToSvg(e) {
  const r = svg.getBoundingClientRect();
  return [vb.x + (e.clientX - r.left) / r.width * vb.w,
          vb.y + (e.clientY - r.top) / r.height * vb.h];
}
MAPSVGS.forEach(el => el.addEventListener("wheel", e => {
  e.preventDefault();
  const [cx, cy] = clientToSvg(e);
  zoomAt(cx, cy, e.deltaY > 0 ? 1.2 : 1 / 1.2);
}, { passive: false }));
$("zoomIn").onclick = () => zoomAt(vb.x + vb.w / 2, vb.y + vb.h / 2, 1 / 1.4);
$("zoomOut").onclick = () => zoomAt(vb.x + vb.w / 2, vb.y + vb.h / 2, 1.4);
$("zoomReset").onclick = () => { vb = { ...home }; applyVB(); };
window.addEventListener("resize", updateLabels);

const pointers = new Map();
let pinchDist = 0;
let tapStart = null, tapMoved = false;   // 탭 판정용
MAPSVGS.forEach(el => el.addEventListener("pointerdown", e => {
  pointers.set(e.pointerId, e);
  if (pointers.size === 1) { tapStart = [e.clientX, e.clientY]; tapMoved = false; }
  else { tapStart = null; }   // 멀티터치면 탭 아님
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }
  el.setPointerCapture(e.pointerId);
}));
MAPSVGS.forEach(el => el.addEventListener("pointermove", e => {
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId);
  pointers.set(e.pointerId, e);
  const r = svg.getBoundingClientRect();
  if (pointers.size === 1) {
    if (tapStart && Math.hypot(e.clientX - tapStart[0], e.clientY - tapStart[1]) > 8) tapMoved = true;
    const dx = (e.clientX - prev.clientX) / r.width * vb.w;
    const dy = (e.clientY - prev.clientY) / r.height * vb.h;
    if (dx || dy) { el.classList.add("dragging"); vb.x -= dx; vb.y -= dy; applyVB(); }
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (pinchDist > 0 && d > 0) {
      const mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
      const cx = vb.x + (mx - r.left) / r.width * vb.w;
      const cy = vb.y + (my - r.top) / r.height * vb.h;
      zoomAt(cx, cy, pinchDist / d);
      pinchDist = d;
    }
  }
}));
["pointerup","pointercancel"].forEach(ev => MAPSVGS.forEach(el => el.addEventListener(ev, e => {
  // 단일 탭(거의 안 움직임)이면 지역 선택
  if (ev === "pointerup" && tapStart && !tapMoved && pointers.size === 1) {
    handleTap(e.clientX, e.clientY);
  }
  pointers.delete(e.pointerId);
  if (pointers.size === 0) { el.classList.remove("dragging"); tapStart = null; }
  pinchDist = 0;
})));

$("recMonth").addEventListener("change", e => { recMonth = +e.target.value; renderRecs(); });

// ---- 기록 검색 / 기간 필터 ----
let feedSearchTimer = 0;
$("feedSearch").addEventListener("input", e => {
  const v = e.target.value;
  clearTimeout(feedSearchTimer);
  feedSearchTimer = setTimeout(() => { feedQuery = v; renderFeed(); }, 150);
});
$("feedYear").addEventListener("change", e => { feedYear = e.target.value; renderFeed(); });

// ---- 백업 / 복원 ----
// 사진은 파일이 아니라 주소만 담는다. 저장소에 원본이 남아 있으면 복원 시 다시 연결되지만,
// 원본 지도를 삭제하면 사진 파일도 함께 지워지므로 그때는 복원되지 않는다.
$("backupBtn").onclick = () => {
  const data = {
    app: "map-for-memory", version: 1, exportedAt: new Date().toISOString(),
    room: ROOM, name: $("roomName").textContent,
    visited: [...visited], notes, photos,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `여행지도_${data.name || ROOM}_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("restoreBtn").onclick = () => $("restoreFile").click();
$("restoreFile").addEventListener("change", async e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { alert("백업 파일을 읽을 수 없습니다."); return; }
  if (!data || data.app !== "map-for-memory") { alert("이 앱의 백업 파일이 아닙니다."); return; }
  const cnt = (data.visited || []).length;
  if (!confirm(`방문 ${cnt}곳과 기록을 지금 지도에 합칩니다.\n기존 기록은 지워지지 않고, 겹치는 항목은 건너뜁니다.\n\n사진은 원본이 지워지지 않았을 때만 함께 복원됩니다.`)) return;
  $("restoreBtn").disabled = true;
  const before = { v: visited.size, n: Object.keys(notes).length };
  try {
    await restoreBackup(data);
    alert(`복원 완료 — 방문 ${visited.size - before.v}곳, 기록 ${Object.keys(notes).length - before.n}곳이 추가되었습니다.`);
  } catch (err) {
    alert("복원 중 문제가 발생했습니다: " + (err.message || err));
  } finally {
    $("restoreBtn").disabled = false;
  }
});
// 합치기 방식 — 이미 있는 방문·기록·사진은 그대로 두고 없는 것만 채운다
async function restoreBackup(data) {
  for (const raw of data.visited || []) {
    const code = mergedTargetOf(String(raw)) || String(raw);
    if (!nameByCode[code] || visited.has(code)) continue;
    visited.add(code); markDirty(code);
    await api("/api/visited", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: ROOM, code, on: true }) });
  }
  for (const [raw, note] of Object.entries(data.notes || {})) {
    const code = mergedTargetOf(String(raw)) || String(raw);
    if (!nameByCode[code]) continue;
    const cur = getVisits(code);
    const add = (note.visits || []).filter(v =>
      !cur.some(c => c.id === v.id || (c.start === v.start && c.end === v.end && c.memo === v.memo)));
    if (!add.length) continue;
    const merged = cur.concat(add.map(v => ({ id: v.id || newVid(), start: v.start || "", end: v.end || "", memo: v.memo || "" })));
    notes[code] = { visits: merged }; markDirty(code);
    await api("/api/note", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: ROOM, code, visits: merged }) });
  }
  for (const [raw, list] of Object.entries(data.photos || {})) {
    const code = mergedTargetOf(String(raw)) || String(raw);
    if (!nameByCode[code]) continue;
    photos[code] = photos[code] || [];
    for (const p of list || []) {
      if (!p || !p.url || photos[code].some(x => x.url === p.url)) continue;
      await api(`/api/photo?room=${ROOM}&code=${code}&link=1`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: p.url, name: p.name || "", vid: p.vid || "", thumb: p.thumb || "" }) });
      photos[code].push({ url: p.url, name: p.name || "", vid: p.vid || "", thumb: p.thumb || "" });
    }
    if (!photos[code].length) delete photos[code];
  }
  paintVisited(); render(); updateLabels(); renderFeed();
  if (selected) renderPanel();
}

// ---- 지도 삭제 ----
$("deleteMapBtn").onclick = () => {
  $("delDesc").innerHTML =
    `<b>${escapeHtml($("roomName").textContent)}</b> 지도를 완전히 삭제합니다.<br>` +
    `방문 표시·기록·사진이 모두 지워지며 <b>되돌릴 수 없습니다.</b><br>` +
    `함께 쓰는 사람도 더 이상 열 수 없습니다.`;
  $("delPw").value = "";
  $("delErr").textContent = "";
  $("delModal").classList.add("show");
  $("delPw").focus();
};
$("delCancel").onclick = () => $("delModal").classList.remove("show");
$("delModal").onclick = (e) => { if (e.target.id === "delModal") $("delModal").classList.remove("show"); };
$("delPw").onkeydown = (e) => { if (e.key === "Enter") $("delConfirm").click(); };
$("delConfirm").onclick = async () => {
  const pw = $("delPw").value;
  if (!pw) { $("delErr").textContent = "비밀번호를 입력해 주세요."; return; }
  $("delConfirm").disabled = true;
  $("delErr").textContent = "";
  try {
    await api("/api/rooms", { method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: ROOM, password: pw }) });
    delete savedRooms[ROOM];
    localStorage.setItem("travelRooms", JSON.stringify(savedRooms));
    try { localStorage.removeItem("state:" + ROOM); } catch {}
    location.href = "/";
  } catch (e) {
    $("delErr").textContent = e.message === "Failed to fetch" ? "서버 연결 실패" : (e.message || "삭제 실패");
    $("delConfirm").disabled = false;
  }
};

// ---- 내보내기 / 가져오기 / 초기화 ----
// 초기화 — 지금 보고 있는 나라의 방문 표시만, 지도 비밀번호 확인 후 실행
$("resetBtn").onclick = () => {
  const cName = COUNTRY === "jp" ? "일본" : "한국";
  let n = 0;
  visited.forEach(c => { if (countryOfCode(c) === COUNTRY && nameByCode[c]) n++; });
  $("resetDesc").innerHTML =
    `<b>${cName}</b>의 방문 표시 <b>${n}곳</b>이 지워집니다.<br>` +
    `사진·메모는 그대로 남고, 다른 나라 기록은 유지됩니다.<br>함께 쓰는 지도라면 모두에게 적용됩니다.`;
  $("resetPw").value = "";
  $("resetErr").textContent = "";
  $("resetModal").classList.add("show");
  $("resetPw").focus();
};
$("resetCancel").onclick = () => $("resetModal").classList.remove("show");
$("resetModal").onclick = (e) => { if (e.target.id === "resetModal") $("resetModal").classList.remove("show"); };
$("resetPw").onkeydown = (e) => { if (e.key === "Enter") $("resetConfirm").click(); };
$("resetConfirm").onclick = async () => {
  const pw = $("resetPw").value;
  if (!pw) { $("resetErr").textContent = "비밀번호를 입력해 주세요."; return; }
  $("resetConfirm").disabled = true;
  $("resetErr").textContent = "";
  try {
    await api("/api/reset", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: ROOM, password: pw, country: COUNTRY })
    });
    // 현재 나라 방문만 제거
    [...visited].forEach(c => { if (countryOfCode(c) === COUNTRY) visited.delete(c); });
    paintVisited();
    render(); updateLabels(); renderFeed();
    if (selected) renderPanel();
    setBadge(true);
    $("resetModal").classList.remove("show");
  } catch (e) {
    $("resetErr").textContent = e.message === "Failed to fetch" ? "서버 연결 실패" : (e.message || "초기화 실패");
  } finally {
    $("resetConfirm").disabled = false;
  }
};

// ---- 오프라인 지원 (서비스워커) ----
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
// 오프라인일 때 안내
function updateOnlineBadge() {
  if (!navigator.onLine) setBadge(false, "오프라인 (보기 전용)");
  else setBadge(true);
}
window.addEventListener("offline", updateOnlineBadge);
window.addEventListener("online", () => { updateOnlineBadge(); if (ROOM) refresh(); });

// ---- 시작 ----
const roomParam = new URLSearchParams(location.search).get("room");
if (roomParam && /^[a-z0-9]{6,12}$/.test(roomParam)) enterRoom(roomParam);
else showLanding();
