const antennaFiles = [
  "data/Huawei_A104518R1V07.txt",
  "data/Huawei_AQU4519R1V06.txt",
  "data/Huawei_ASI4518R14V06.txt",
  "data/Huawei_AOC4518R30V06.txt",
  "data/Huawei_AOC4518R27V06.txt",
  "data/Huawei_A06240PA01V06.txt",
  "data/Nokia_5G_AIRSCALE_AQQE.txt",
  "data/Ericsson_5G_AIR_6449.txt"
];

let antennas = {}; // { name: { bands: { bandLabel: { az:[], el:[] } } } }

window.onload = init;

async function init() {
  try {
    setStatus("Chargement des antennes…");

    for (const file of antennaFiles) {
      const r = await fetch(file);
      if (!r.ok) {
        setStatus(`ERREUR fetch: ${file} (${r.status})`, true);
        return;
      }
      const text = await r.text();
      parseAntenna(text);
    }

    populateAntennaList();
    bindUI();
    setStatus("Prêt.");
    refreshAllResults();
  } catch (e) {
    setStatus(`ERREUR: ${e?.message ?? e}`, true);
  }
}

function bindUI() {
  document.getElementById("btnCalc").addEventListener("click", refreshAllResults);
  document.getElementById("btnClearAngles").addEventListener("click", clearAngles);
  document.getElementById("btnClearAll").addEventListener("click", clearAll);

  document.getElementById("antennaSelect").addEventListener("change", onAntennaChanged);

  const azInput = document.getElementById("azimuthInput");
  const azSlider = document.getElementById("azimuthSlider");

  azInput.addEventListener("input", () => {
    syncSliderFromAzimuthInput();
    refreshAllResults();
  });

  azInput.addEventListener("keydown", onAngleKeydown);
  azInput.addEventListener("wheel", onAngleWheel, { passive: false });

  azSlider.addEventListener("input", () => {
    const v = Number(azSlider.value);
    document.getElementById("azimuthInput").value = formatAngleForInput(v);
    updateAzSliderLabel(v);
    refreshAllResults();
  });

  document.querySelectorAll(".stepBtn").forEach(btn => {
    btn.addEventListener("click", onStepButtonClick);
  });
}

function setStatus(msg, isErr = false) {
  const el = document.getElementById("status");
  el.textContent = msg || "";
  el.className = isErr ? "status error" : "status";
}

function parseAntenna(text) {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const antennaName = lines[0];
  let i = 1;

  antennas[antennaName] = { bands: {} };

  while (i < lines.length) {
    const bandLabel = lines[i++];

    if (!/^Azimut$/i.test(lines[i] || "")) {
      throw new Error(`Format invalide (${antennaName}): 'Azimut' attendu après '${bandLabel}'`);
    }
    i++;

    const az = [];
    for (let k = 0; k < 360; k++) {
      const v = parseFloat((lines[i++] || "").replace(",", "."));
      if (!Number.isFinite(v)) {
        throw new Error(`Valeur Azimut invalide (${antennaName} / ${bandLabel}, index ${k})`);
      }
      az.push(toAttenuation(v));
    }

    if (!/^Elevation$/i.test(lines[i] || "")) {
      throw new Error(`Format invalide (${antennaName} / ${bandLabel}): 'Elevation' attendu`);
    }
    i++;

    const el = [];
    for (let k = 0; k < 360; k++) {
      const v = parseFloat((lines[i++] || "").replace(",", "."));
      if (!Number.isFinite(v)) {
        throw new Error(`Valeur Elevation invalide (${antennaName} / ${bandLabel}, index ${k})`);
      }
      el.push(toAttenuation(v));
    }

    antennas[antennaName].bands[bandLabel] = { az, el };
  }
}

function toAttenuation(v) {
  return (v <= 0) ? -v : v;
}

function populateAntennaList() {
  const select = document.getElementById("antennaSelect");
  select.innerHTML = "";

  for (const name of Object.keys(antennas)) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }

  onAntennaChanged();
}

function onAntennaChanged() {
  clearAnglesOnly();
  renderBandCards();
  refreshAllResults();
}

function renderBandCards() {
  const cards = document.getElementById("bandCards");
  cards.innerHTML = "";

  const ant = document.getElementById("antennaSelect").value;
  const bands = antennas[ant].bands;

  Object.keys(bands).forEach((bandLabel, idx) => {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.band = bandLabel;

    card.innerHTML = `
      <h3>${escapeHtml(bandLabel)}</h3>

      <div class="cardGrid">
        <label for="el_${idx}">Élévation (°)</label>
        <div class="fieldBlock">
          <div class="angleEditor">
            <input id="el_${idx}" type="text" inputmode="decimal" placeholder="ex: 0, 5, -10" />

            <div class="stepBtns">
              <button type="button" class="stepBtn" data-target="el_${idx}" data-step="-10">-10</button>
              <button type="button" class="stepBtn" data-target="el_${idx}" data-step="-5">-5</button>
              <button type="button" class="stepBtn" data-target="el_${idx}" data-step="-1">-1</button>
              <button type="button" class="stepBtn" data-target="el_${idx}" data-step="1">+1</button>
              <button type="button" class="stepBtn" data-target="el_${idx}" data-step="5">+5</button>
              <button type="button" class="stepBtn" data-target="el_${idx}" data-step="10">+10</button>
            </div>
          </div>
        </div>
      </div>

      <div class="sepTop">
        <div class="resultLine">
          <span>Atténuation Azimut :</span>
          <span class="result muted" id="azRes_${idx}">—</span>
          <button class="copyBtn" type="button" onclick="copyText('azRes_${idx}')">Copier</button>
        </div>

        <div class="resultLine" style="margin-top:6px;">
          <span>Atténuation Élévation :</span>
          <span class="result muted" id="elRes_${idx}">—</span>
          <button class="copyBtn" type="button" onclick="copyText('elRes_${idx}')">Copier</button>
        </div>

        <div class="mono" id="echo_${idx}" style="margin-top:8px;"></div>
      </div>
    `;

    cards.appendChild(card);
  });

  cards.querySelectorAll("input[id^='el_']").forEach(inp => {
    inp.addEventListener("input", refreshAllResults);
    inp.addEventListener("keydown", onAngleKeydown);
    inp.addEventListener("wheel", onAngleWheel, { passive: false });
  });

  cards.querySelectorAll(".stepBtn").forEach(btn => {
    btn.addEventListener("click", onStepButtonClick);
  });

  setStatus(`Bandes détectées : ${Object.keys(bands).length}`);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]
  ));
}

function parseAngle(str) {
  const raw = (str ?? "").trim();
  const s = raw.replace(",", ".");

  if (!raw) return { state: "empty", ok: false, val: NaN };
  if (s === "-" || s === "+" || s === "." || s === "-." || s === "+.") {
    return { state: "partial", ok: false, val: NaN };
  }

  const v = Number(s);
  if (!Number.isFinite(v)) return { state: "invalid", ok: false, val: NaN };

  return { state: "ok", ok: true, val: v };
}

function normAzimuth(a) {
  let x = a % 360;
  if (x < 0) x += 360;
  return x;
}

function elevationToIndexFloat(eDeg) {
  if (eDeg >= 0 && eDeg <= 180) return { ok: true, idx: eDeg };
  if (eDeg < 0 && eDeg >= -180) return { ok: true, idx: eDeg + 360 };
  return { ok: false, idx: NaN };
}

function interpCircular360(arr, idxFloat) {
  const n = 360;
  let x = idxFloat % n;
  if (x < 0) x += n;

  const i0 = Math.floor(x);
  const t = x - i0;
  const i1 = (i0 + 1) % n;

  return arr[i0] * (1 - t) + arr[i1] * t;
}

function refreshAllResults() {
  const ant = document.getElementById("antennaSelect").value;
  if (!ant || !antennas[ant]) {
    setStatus("Aucune antenne disponible.", true);
    return;
  }

  const bands = antennas[ant].bands;
  const bandLabels = Object.keys(bands);

  const azInfo = getAzimuthInfo();
  renderAzimuthEcho(azInfo);

  let fullCount = 0;
  let partialCount = 0;
  let invalidCount = 0;

  bandLabels.forEach((bandLabel, idx) => {
    const res = updateBandCard(idx, bandLabel, bands[bandLabel], azInfo);

    if (res.full) fullCount++;
    else if (res.partial) partialCount++;
    else if (res.invalid) invalidCount++;
  });

  if (fullCount === 0 && partialCount === 0) {
    if (!azInfo.ok && azInfo.state !== "empty" && azInfo.state !== "partial") {
      setStatus("Azimut invalide, aucune valeur exploitable.", true);
    } else {
      setStatus("Aucune valeur exploitable pour le moment.", true);
    }
    return;
  }

  let msg = "";
  if (fullCount > 0) msg += `${fullCount} bande(s) calculée(s) complètement`;
  if (partialCount > 0) msg += `${msg ? ", " : ""}${partialCount} partiellement`;
  if (invalidCount > 0) msg += `${msg ? ", " : ""}${invalidCount} avec saisie invalide`;

  setStatus(`Calcul mis à jour : ${msg}.`);
}

function getAzimuthInfo() {
  const azInput = document.getElementById("azimuthInput");
  const parsed = parseAngle(azInput.value);

  setInputState(azInput, parsed.state === "invalid", parsed.state === "partial");

  if (!parsed.ok) {
    return {
      state: parsed.state,
      ok: false,
      val: NaN,
      norm: NaN
    };
  }

  const azNorm = normAzimuth(parsed.val);

  return {
    state: "ok",
    ok: true,
    val: parsed.val,
    norm: azNorm
  };
}

function renderAzimuthEcho(azInfo) {
  const el = document.getElementById("azEcho");

  if (azInfo.state === "empty") {
    el.textContent = "Azimut non renseigné.";
    return;
  }

  if (azInfo.state === "partial") {
    el.textContent = "Azimut en cours de saisie…";
    return;
  }

  if (!azInfo.ok) {
    el.textContent = "Azimut invalide.";
    return;
  }

  el.textContent =
    `Azimut saisi: ${azInfo.val}° ; azimut utilisé (mod 360): ${azInfo.norm.toFixed(3)}°`;
}

function updateBandCard(idx, bandLabel, pat, azInfo) {
  const azResEl = document.getElementById(`azRes_${idx}`);
  const elResEl = document.getElementById(`elRes_${idx}`);
  const echoEl = document.getElementById(`echo_${idx}`);
  const elInput = document.getElementById(`el_${idx}`);

  azResEl.textContent = "—";
  azResEl.classList.add("muted");

  elResEl.textContent = "—";
  elResEl.classList.add("muted");

  echoEl.textContent = "";

  const elParsed = parseAngle(elInput.value);
  setInputState(elInput, elParsed.state === "invalid", elParsed.state === "partial");

  let azDone = false;
  let elDone = false;
  let invalid = false;
  const notes = [];

  if (azInfo.ok) {
    const attAz = interpCircular360(pat.az, azInfo.norm);
    azResEl.textContent = `${attAz.toFixed(2)} dB`;
    azResEl.classList.remove("muted");
    azDone = true;
  } else if (azInfo.state === "invalid") {
    notes.push("Azimut invalide.");
    invalid = true;
  } else if (azInfo.state === "partial") {
    notes.push("Azimut en cours de saisie.");
  }

  if (elParsed.state === "empty") {
    notes.push("Élévation non renseignée.");
  } else if (elParsed.state === "partial") {
    notes.push("Élévation en cours de saisie.");
  } else if (elParsed.state === "invalid") {
    notes.push("Élévation invalide.");
    invalid = true;
  } else {
    const eIdx = elevationToIndexFloat(elParsed.val);
    if (!eIdx.ok) {
      notes.push("Élévation hors domaine (valeurs admises : -180° à 180°).");
      invalid = true;
    } else {
      const attEl = interpCircular360(pat.el, eIdx.idx);
      elResEl.textContent = `${attEl.toFixed(2)} dB`;
      elResEl.classList.remove("muted");
      notes.push(`Élévation saisie: ${elParsed.val}° ; index utilisé: ${eIdx.idx.toFixed(3)}`);
      elDone = true;
    }
  }

  echoEl.textContent = notes.join(" ");

  return {
    full: azDone && elDone,
    partial: (azDone || elDone) && !(azDone && elDone),
    invalid
  };
}

function setInputState(input, invalid, partialInvalid) {
  input.classList.remove("invalid", "partial-invalid");

  if (invalid) input.classList.add("invalid");
  else if (partialInvalid) input.classList.add("partial-invalid");
}

function clearAnglesOnly() {
  document.getElementById("azimuthInput").value = "";
  document.getElementById("azEcho").textContent = "";

  const slider = document.getElementById("azimuthSlider");
  if (slider) slider.value = 0;
  updateAzSliderLabel(0);

  const cards = document.getElementById("bandCards");
  cards.querySelectorAll("input[id^='el_']").forEach(inp => {
    inp.value = "";
    inp.classList.remove("invalid", "partial-invalid");
  });

  cards.querySelectorAll("span[id^='azRes_'], span[id^='elRes_']").forEach(sp => {
    sp.textContent = "—";
    sp.classList.add("muted");
  });

  cards.querySelectorAll("div[id^='echo_']").forEach(sp => {
    sp.textContent = "";
  });

  document.getElementById("azimuthInput").classList.remove("invalid", "partial-invalid");
}

function clearAngles() {
  clearAnglesOnly();
  setStatus("Angles effacés.");
}

function clearAll() {
  clearAnglesOnly();
  document.getElementById("antennaSelect").selectedIndex = 0;
  renderBandCards();
  refreshAllResults();
  setStatus("Réinitialisé.");
}

function syncSliderFromAzimuthInput() {
  const azInput = document.getElementById("azimuthInput");
  const slider = document.getElementById("azimuthSlider");
  const parsed = parseAngle(azInput.value);

  if (parsed.ok) {
    const norm = normAzimuth(parsed.val);
    slider.value = Math.round(norm);
    updateAzSliderLabel(Math.round(norm));
  } else {
    updateAzSliderLabel(Number(slider.value));
  }
}

function updateAzSliderLabel(v) {
  document.getElementById("azSliderValue").textContent = `${v}°`;
}

function onStepButtonClick(e) {
  const btn = e.currentTarget;
  const targetId = btn.dataset.target;
  const step = Number(btn.dataset.step);
  const input = document.getElementById(targetId);

  if (!input || !Number.isFinite(step)) return;

  incrementAngleInput(input, step);
  refreshAllResults();
}

function incrementAngleInput(input, step) {
  const parsed = parseAngle(input.value);
  let base = 0;

  if (parsed.ok) {
    base = parsed.val;
  }

  let next = base + step;

  if (input.id === "azimuthInput") {
    next = normAzimuth(next);
    input.value = formatAngleForInput(next);

    const slider = document.getElementById("azimuthSlider");
    slider.value = Math.round(next);
    updateAzSliderLabel(Math.round(next));
    return;
  }

  next = clamp(next, -180, 180);
  input.value = formatAngleForInput(next);
}

function clamp(v, vMin, vMax) {
  return Math.min(vMax, Math.max(vMin, v));
}

function formatAngleForInput(v) {
  if (!Number.isFinite(v)) return "";
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
  return String(Number(v.toFixed(3)));
}

function onAngleKeydown(e) {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

  e.preventDefault();

  const dir = e.key === "ArrowUp" ? 1 : -1;
  let step = 1;

  if (e.shiftKey) step = 5;
  if (e.ctrlKey || e.metaKey) step = 10;

  incrementAngleInput(e.currentTarget, dir * step);
  refreshAllResults();
}

function onAngleWheel(e) {
  if (document.activeElement !== e.currentTarget) return;

  e.preventDefault();

  const dir = e.deltaY < 0 ? 1 : -1;
  incrementAngleInput(e.currentTarget, dir);
  refreshAllResults();
}

async function copyText(spanId) {
  const txt = (document.getElementById(spanId).textContent || "").trim();
  if (!txt || txt === "—") return;

  try {
    await navigator.clipboard.writeText(txt);
    setStatus("Copié dans le presse-papier.");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = txt;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();

    try {
      document.execCommand("copy");
      setStatus("Copié dans le presse-papier.");
    } catch {
      setStatus("Copie impossible (navigateur).", true);
    } finally {
      document.body.removeChild(ta);
    }
  }
}

window.copyText = copyText;
   
