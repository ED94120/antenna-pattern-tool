const antennaFiles = [
  "data/Huawei_AOC4518R30V06.txt",
  "data/Huawei_AOC4518R27V06.txt",
  "data/Huawei_A104518R1V07.txt",
  "data/Huawei_AQU4519R1V06.txt",
  "data/Huawei_A06240PA01V06.txt",
  "data/Huawei_ASI4518R14V06.txt",
  "data/Nokia_5G_AIRSCALE_AQQE.txt",
  "data/Ericsson_5G_AIR_6449.txt"
];

const antennaSpecsFile = "data/antenna-specs.txt";
const defaultAntennaInfo = "Pas d'information disponible pour ce modèle d'antenne";

const ATTENUATION_MESSAGE_TYPE = "ANTENNA_PATTERN_ATTENUATIONS";

let antennas = {};      // { name: { bands: { bandLabel: { az:[], el:[] } } } }
let antennaInfos = {};  // { antennaName: "texte libre..." }

let latestAttenuationPayload = null;
let latestAttenuationSignature = "";

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

    await loadAntennaInfos();

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

  const sendBtn = document.getElementById("btnSendAttenuations");

  if (sendBtn) {
    sendBtn.addEventListener("click", () => {
      sendLatestAttenuationsToParent(true);
    });
  }
}

function setStatus(msg, isErr = false) {
  const el = document.getElementById("status");

  el.textContent = msg || "";
  el.className = isErr ? "status error" : "status";
}

async function loadAntennaInfos() {
  antennaInfos = {};

  try {
    const r = await fetch(antennaSpecsFile);

    if (!r.ok) {
      return;
    }

    const text = await r.text();
    antennaInfos = parseAntennaSpecs(text);
  } catch {
    antennaInfos = {};
  }
}

function parseAntennaSpecs(text) {
  const result = {};
  const lines = text.split(/\r?\n/);

  let currentName = null;
  let currentBlock = [];

  function saveCurrentBlock() {
    if (!currentName) return;

    const content = currentBlock.join("\n").trim();
    result[currentName] = content || defaultAntennaInfo;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith("[ANTENNA]")) {
      saveCurrentBlock();

      currentName = line.substring("[ANTENNA]".length).trim();
      currentBlock = [];

      continue;
    }

    if (currentName) {
      currentBlock.push(rawLine);
    }
  }

  saveCurrentBlock();

  return result;
}

function updateAntennaInfo() {
  const select = document.getElementById("antennaSelect");
  const infoEl = document.getElementById("antennaInfo");

  if (!infoEl) return;

  const antennaName = (select?.value || "").trim();

  if (!antennaName) {
    infoEl.value = defaultAntennaInfo;
    return;
  }

  const info = antennaInfos[antennaName];

  infoEl.value = (info && info.trim()) ? info.trim() : defaultAntennaInfo;
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
  latestAttenuationPayload = null;
  latestAttenuationSignature = "";

  clearAnglesOnly();
  updateAntennaInfo();
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
        <label for="el_${idx}">Déport élévation (°)</label>

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

      <div class="sepTop resultBlock">
        <div class="resultRow">
          <span class="resultLabel">Atténuation Azimut :</span>
          <span class="result muted" id="azRes_${idx}">—</span>
          <button class="copyBtn" type="button" data-copy-target="azRes_${idx}">Copier</button>
        </div>

        <div class="resultRow">
          <span class="resultLabel">Atténuation Élévation :</span>
          <span class="result muted" id="elRes_${idx}">—</span>
          <button class="copyBtn" type="button" data-copy-target="elRes_${idx}">Copier</button>
        </div>

        <div class="resultRow">
          <span class="resultLabel">Somme atténuation :</span>
          <span class="result muted" id="sumRes_${idx}">—</span>
          <button class="copyBtn copyBtnSum" type="button" data-copy-target="sumRes_${idx}">Copier</button>
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

  cards.querySelectorAll(".copyBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      copyText(btn.dataset.copyTarget);
    });
  });

  setStatus(`Bandes détectées : ${Object.keys(bands).length}`);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => (
    {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[c]
  ));
}

function parseAngle(str) {
  const raw = (str ?? "").trim();
  const s = raw.replace(",", ".");

  if (!raw) {
    return {
      state: "empty",
      ok: false,
      val: NaN
    };
  }

  if (s === "-" || s === "+" || s === "." || s === "-." || s === "+.") {
    return {
      state: "partial",
      ok: false,
      val: NaN
    };
  }

  const v = Number(s);

  if (!Number.isFinite(v)) {
    return {
      state: "invalid",
      ok: false,
      val: NaN
    };
  }

  return {
    state: "ok",
    ok: true,
    val: v
  };
}

function normAzimuth(a) {
  let x = a % 360;

  if (x < 0) x += 360;

  return x;
}

function elevationToIndexFloat(eDeg) {
  if (eDeg >= 0 && eDeg <= 180) {
    return {
      ok: true,
      idx: eDeg
    };
  }

  if (eDeg < 0 && eDeg >= -180) {
    return {
      ok: true,
      idx: eDeg + 360
    };
  }

  return {
    ok: false,
    idx: NaN
  };
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

  const bandResults = [];

  bandLabels.forEach((bandLabel, idx) => {
    const res = updateBandCard(idx, bandLabel, bands[bandLabel], azInfo);

    bandResults.push(res);

    if (res.full) {
      fullCount++;
    } else if (res.partial) {
      partialCount++;
    } else if (res.invalid) {
      invalidCount++;
    }
  });

  updateLatestAttenuationPayload(ant, bandResults, azInfo);

  if (fullCount === 0 && partialCount === 0) {
    if (!azInfo.ok && azInfo.state !== "empty" && azInfo.state !== "partial") {
      setStatus("Azimut invalide, aucune valeur exploitable.", true);
    } else {
      setStatus("Aucune valeur exploitable pour le moment.", true);
    }

    return;
  }

  let msg = "";

  if (fullCount > 0) {
    msg += `${fullCount} bande(s) calculée(s) complètement`;
  }

  if (partialCount > 0) {
    msg += `${msg ? ", " : ""}${partialCount} partiellement`;
  }

  if (invalidCount > 0) {
    msg += `${msg ? ", " : ""}${invalidCount} avec saisie invalide`;
  }

  setStatus(`Calcul mis à jour : ${msg}.`);
}

function getAzimuthInfo() {
  const azInput = document.getElementById("azimuthInput");
  const parsed = parseAngle(azInput.value);

  setInputState(
    azInput,
    parsed.state === "invalid",
    parsed.state === "partial"
  );

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
  const sumResEl = document.getElementById(`sumRes_${idx}`);
  const echoEl = document.getElementById(`echo_${idx}`);
  const elInput = document.getElementById(`el_${idx}`);

  azResEl.textContent = "—";
  azResEl.classList.add("muted");

  elResEl.textContent = "—";
  elResEl.classList.add("muted");

  sumResEl.textContent = "—";
  sumResEl.classList.add("muted");

  echoEl.textContent = "";

  const elParsed = parseAngle(elInput.value);

  setInputState(
    elInput,
    elParsed.state === "invalid",
    elParsed.state === "partial"
  );

  let azDone = false;
  let elDone = false;
  let invalid = false;
  let attAzVal = NaN;
  let attElVal = NaN;
  let attSum = NaN;

  const notes = [];

  if (azInfo.ok) {
    attAzVal = interpCircular360(pat.az, azInfo.norm);

    azResEl.textContent = `${attAzVal.toFixed(2)} dB`;
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
      attElVal = interpCircular360(pat.el, eIdx.idx);

      elResEl.textContent = `${attElVal.toFixed(2)} dB`;
      elResEl.classList.remove("muted");

      notes.push(`Élévation saisie: ${elParsed.val}° ; position table: ${eIdx.idx.toFixed(3)}`);

      elDone = true;
    }
  }

  if (azDone && elDone) {
    attSum = attAzVal + attElVal;

    sumResEl.textContent = `${attSum.toFixed(2)} dB`;
    sumResEl.classList.remove("muted");
  }

  echoEl.textContent = notes.join(" ");

  return {
    bandLabel,
    frequencyRangeMHz: extractFrequencyRangeMHz(bandLabel),
    full: azDone && elDone,
    partial: (azDone || elDone) && !(azDone && elDone),
    invalid,
    azimuthAttenuation: azDone ? attAzVal : null,
    elevationAttenuation: elDone ? attElVal : null,
    totalAttenuation: (azDone && elDone) ? attSum : null
  };
}

function setInputState(input, invalid, partialInvalid) {
  input.classList.remove("invalid", "partial-invalid");

  if (invalid) {
    input.classList.add("invalid");
  } else if (partialInvalid) {
    input.classList.add("partial-invalid");
  }
}

function clearAnglesOnly() {
  document.getElementById("azimuthInput").value = "";
  document.getElementById("azEcho").textContent = "";

  latestAttenuationPayload = null;
  latestAttenuationSignature = "";

  const slider = document.getElementById("azimuthSlider");

  if (slider) {
    slider.value = 0;
  }

  updateAzSliderLabel(0);

  const cards = document.getElementById("bandCards");

  cards.querySelectorAll("input[id^='el_']").forEach(inp => {
    inp.value = "";
    inp.classList.remove("invalid", "partial-invalid");
  });

  cards.querySelectorAll("span[id^='azRes_'], span[id^='elRes_'], span[id^='sumRes_']").forEach(sp => {
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

  updateAntennaInfo();
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

  if (Math.abs(v - Math.round(v)) < 1e-9) {
    return String(Math.round(v));
  }

  return String(Number(v.toFixed(3)));
}

function onAngleKeydown(e) {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

  e.preventDefault();

  const dir = e.key === "ArrowUp" ? 1 : -1;

  let step = 1;

  if (e.shiftKey) {
    step = 5;
  }

  if (e.ctrlKey || e.metaKey) {
    step = 10;
  }

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
  const txt = (document.getElementById(spanId)?.textContent || "").trim();

  if (!txt || txt === "—") return;

  const numMatch = txt.replace(",", ".").match(/-?\d+(?:\.\d+)?/);

  if (!numMatch) {
    setStatus("Aucune valeur numérique à copier.", true);
    return;
  }

  const valueToCopy = numMatch[0];

  try {
    await navigator.clipboard.writeText(valueToCopy);
    setStatus("Valeur numérique copiée dans le presse-papier.");
  } catch {
    const ta = document.createElement("textarea");

    ta.value = valueToCopy;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";

    document.body.appendChild(ta);
    ta.select();

    try {
      document.execCommand("copy");
      setStatus("Valeur numérique copiée dans le presse-papier.");
    } catch {
      setStatus("Copie impossible (navigateur).", true);
    } finally {
      document.body.removeChild(ta);
    }
  }
}

/* -------------------------------------------------------------------------
   Transmission des atténuations vers la page parente
   -------------------------------------------------------------------------

   Principe :
   - ne jamais envoyer de champ vide ;
   - envoyer uniquement les valeurs réellement calculées ;
   - la page parente doit fusionner les nouvelles valeurs avec les anciennes.

   Champs possibles :
   - fixedBand1Attenuation : atténuation bande FF n°1
   - fixedBand2Attenuation : atténuation bande FF n°2
   - fixedBand3Attenuation : atténuation bande FF n°3
   - g3500Attenuation      : atténuation 5G 3500 MHz
------------------------------------------------------------------------- */

function updateLatestAttenuationPayload(antennaName, bandResults, azInfo) {
  const payload = buildAttenuationPayload(antennaName, bandResults, azInfo);

  latestAttenuationPayload = payload;

  if (payloadHasAnyAttenuation(payload)) {
    sendLatestAttenuationsToParent(false);
  }
}

function buildAttenuationPayload(antennaName, bandResults, azInfo) {
  const calculatedResults = bandResults
    .filter(res => res.full)
    .filter(res => Number.isFinite(res.totalAttenuation));

  if (calculatedResults.length === 0) {
    return null;
  }

  const antennaKind = detectAntennaKind(antennaName, bandResults);

  const payload = {
    antennaType: antennaKind,
    source: {
      antennaName,
      azimuthOffset: azInfo.ok ? Number(azInfo.val.toFixed(3)) : null,
      azimuthUsedModulo360: azInfo.ok ? Number(azInfo.norm.toFixed(3)) : null,
      savedAt: new Date().toISOString(),
      mapping: {}
    }
  };

  if (antennaKind === "steerable") {
    addSteerable3500Attenuation(payload, calculatedResults);
  } else {
    addFixedBeamAttenuations(payload, calculatedResults);
  }

  if (!payloadHasAnyAttenuation(payload)) {
    return null;
  }

  return payload;
}

function detectAntennaKind(antennaName, bandResults) {
  const ranges = bandResults
    .map(res => res.frequencyRangeMHz)
    .filter(Boolean);

  if (ranges.length === 0) {
    return "fixed";
  }

  const has3500Band = ranges.some(is3500Range);
  const hasNon3500Band = ranges.some(range => !is3500Range(range));

  if (has3500Band && !hasNon3500Band) {
    return "steerable";
  }

  const normalizedName = String(antennaName || "").toLowerCase();

  if (
    has3500Band &&
    (
      normalizedName.includes("airscale") ||
      normalizedName.includes("air_") ||
      normalizedName.includes("5g")
    )
  ) {
    return "steerable";
  }

  return "fixed";
}

function addSteerable3500Attenuation(payload, calculatedResults) {
  const candidates3500 = calculatedResults
    .filter(res => is3500Range(res.frequencyRangeMHz))
    .sort(compareBandResultsByCenterFrequency);

  if (candidates3500.length === 0) {
    return;
  }

  const selected = candidates3500[0];

  payload.g3500Attenuation = formatAttenuationDb(selected.totalAttenuation);
  payload.source.mapping.g3500Attenuation = selected.bandLabel;
}

function addFixedBeamAttenuations(payload, calculatedResults) {
  const fixedResults = calculatedResults
    .filter(res => !is3500Range(res.frequencyRangeMHz))
    .sort(compareBandResultsByCenterFrequency);

  if (fixedResults.length >= 1) {
    payload.fixedBand1Attenuation = formatAttenuationDb(fixedResults[0].totalAttenuation);
    payload.source.mapping.fixedBand1Attenuation = fixedResults[0].bandLabel;
  }

  if (fixedResults.length >= 2) {
    payload.fixedBand2Attenuation = formatAttenuationDb(fixedResults[1].totalAttenuation);
    payload.source.mapping.fixedBand2Attenuation = fixedResults[1].bandLabel;
  }

  if (fixedResults.length >= 3) {
    payload.fixedBand3Attenuation = formatAttenuationDb(fixedResults[2].totalAttenuation);
    payload.source.mapping.fixedBand3Attenuation = fixedResults[2].bandLabel;
  }

  payload.fixedBandCount = Math.min(fixedResults.length, 3);
}

function payloadHasAnyAttenuation(payload) {
  if (!payload) return false;

  return (
    Object.prototype.hasOwnProperty.call(payload, "fixedBand1Attenuation") ||
    Object.prototype.hasOwnProperty.call(payload, "fixedBand2Attenuation") ||
    Object.prototype.hasOwnProperty.call(payload, "fixedBand3Attenuation") ||
    Object.prototype.hasOwnProperty.call(payload, "g3500Attenuation")
  );
}

function sendLatestAttenuationsToParent(showStatus) {
  if (!payloadHasAnyAttenuation(latestAttenuationPayload)) {
    if (showStatus) {
      setStatus("Aucune atténuation complète à transmettre.", true);
    }

    return false;
  }

  const message = {
    type: ATTENUATION_MESSAGE_TYPE,
    payload: latestAttenuationPayload
  };

  const signature = JSON.stringify(message);

  if (!showStatus && signature === latestAttenuationSignature) {
    return true;
  }

  latestAttenuationSignature = signature;

  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, "*");
    }

    if (showStatus) {
      setStatus("Atténuations transmises à la page parente.");
    }

    return true;
  } catch (error) {
    if (showStatus) {
      setStatus(`Transmission impossible : ${error?.message ?? error}`, true);
    }

    return false;
  }
}

function formatAttenuationDb(value) {
  if (!Number.isFinite(value)) return "";

  return Number(value).toFixed(2);
}

function extractFrequencyRangeMHz(label) {
  const text = String(label || "");

  const matches = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(GHz|MHz)?/gi)];

  if (matches.length === 0) {
    return null;
  }

  const freqs = matches
    .map(match => {
      const rawValue = match[1];
      const rawUnit = match[2] || "MHz";

      let value = Number(rawValue.replace(",", "."));

      if (!Number.isFinite(value)) {
        return NaN;
      }

      const unit = rawUnit.toLowerCase();

      if (unit === "ghz") {
        value *= 1000;
      }

      return value;
    })
    .filter(Number.isFinite);

  if (freqs.length === 0) {
    return null;
  }

  const fMin = Math.min(...freqs);
  const fMax = Math.max(...freqs);

  return {
    fMin,
    fMax,
    fCenter: (fMin + fMax) / 2
  };
}

function is3500Range(range) {
  if (!range) return false;

  return frequencyIsInsideRange(3500, range.fMin, range.fMax);
}

function frequencyIsInsideRange(freq, fMin, fMax) {
  return freq >= fMin && freq <= fMax;
}

function compareBandResultsByCenterFrequency(a, b) {
  const ca = a.frequencyRangeMHz?.fCenter ?? Number.POSITIVE_INFINITY;
  const cb = b.frequencyRangeMHz?.fCenter ?? Number.POSITIVE_INFINITY;

  return ca - cb;
}

window.copyText = copyText;
window.sendLatestAttenuationsToParent = sendLatestAttenuationsToParent;
window.getLatestAttenuationPayload = function() {
  return latestAttenuationPayload;
};
   
