const antennaFiles = [
  "data/Huawei_A104518R1V07.txt",
  "data/Huawei_AQU4519R1V06.txt",
  "data/Huawei_ASI4518R14v06.txt"
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
  } catch (e) {
    setStatus(`ERREUR: ${e?.message ?? e}`, true);
  }
}

function bindUI() {
  document.getElementById("btnCalc").addEventListener("click", calculateAll);
  document.getElementById("btnClearAngles").addEventListener("click", clearAngles);
  document.getElementById("btnClearAll").addEventListener("click", clearAll);
  document.getElementById("antennaSelect").addEventListener("change", onAntennaChanged);
}

function setStatus(msg, isErr=false) {
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

    // Attendu: "Azimut"
    if (!/^Azimut$/i.test(lines[i] || "")) {
      throw new Error(`Format invalide (${antennaName}): 'Azimut' attendu après '${bandLabel}'`);
    }
    i++;

    const az = [];
    for (let k = 0; k < 360; k++) {
      const v = parseFloat((lines[i++] || "").replace(",", "."));
      az.push(toAttenuation(v));
    }

    // Attendu: "Elevation"
    if (!/^Elevation$/i.test(lines[i] || "")) {
      throw new Error(`Format invalide (${antennaName} / ${bandLabel}): 'Elevation' attendu`);
    }
    i++;

    const el = [];
    for (let k = 0; k < 360; k++) {
      const v = parseFloat((lines[i++] || "").replace(",", "."));
      el.push(toAttenuation(v));
    }

    antennas[antennaName].bands[bandLabel] = { az, el };
  }
}

function toAttenuation(v) {
  // Tes fichiers contiennent des gains négatifs normalisés.
  // Si un jour tu mets déjà des atténuations positives, ça restera OK :
  // - si v <= 0 => att = -v
  // - si v >= 0 => att = v
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
        <input id="el_${idx}" inputmode="decimal" placeholder="ex: 0, 5, -10" />
      </div>

      <div style="margin-top:10px;">
        <div class="resultLine">
          <span>Atténuation Azimut :</span>
          <span class="result" id="azRes_${idx}"></span>
          <button type="button" onclick="copyText('azRes_${idx}')">Copier</button>
        </div>

        <div class="resultLine" style="margin-top:6px;">
          <span>Atténuation Élévation :</span>
          <span class="result" id="elRes_${idx}"></span>
          <button type="button" onclick="copyText('elRes_${idx}')">Copier</button>
        </div>

        <div class="mono" id="echo_${idx}" style="margin-top:8px;"></div>
      </div>
    `;

    cards.appendChild(card);
  });

  setStatus(`Bandes détectées : ${Object.keys(bands).length}`);
}

function escapeHtml(s){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function parseAngle(str) {
  const s = (str ?? "").trim().replace(",", ".");
  if (!s) return { ok:false, val: NaN };
  const v = Number(s);
  return Number.isFinite(v) ? { ok:true, val:v } : { ok:false, val:NaN };
}

function normAzimuth(a) {
  let x = a % 360;
  if (x < 0) x += 360;
  return x;
}

function elevationToIndexFloat(eDeg) {
  // domaine strict : 0..180 (dessous) ou -179..-1 (au-dessus)
  if (eDeg >= 0 && eDeg <= 180) return { ok:true, idx: eDeg };
  if (eDeg <= -1 && eDeg >= -179) return { ok:true, idx: eDeg + 360 }; // -179->181; -1->359
  return { ok:false, idx: NaN };
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

function calculateAll() {
  setStatus("");

  const ant = document.getElementById("antennaSelect").value;
  const bands = antennas[ant].bands;
  const bandLabels = Object.keys(bands);

  // Azimut commun
  const azIn = parseAngle(document.getElementById("azimuthInput").value);
  if (!azIn.ok) { setStatus("Azimut invalide (nombre attendu).", true); return; }

  const azNorm = normAzimuth(azIn.val);
  document.getElementById("azEcho").textContent =
    `Azimut saisi: ${azIn.val}° ; azimut utilisé (mod 360): ${azNorm.toFixed(3)}°`;

  // Calcul par bande
  let okCount = 0;

  bandLabels.forEach((bandLabel, idx) => {
    // nettoyer anciens résultats
    document.getElementById(`azRes_${idx}`).textContent = "";
    document.getElementById(`elRes_${idx}`).textContent = "";
    document.getElementById(`echo_${idx}`).textContent = "";

    const elIn = parseAngle(document.getElementById(`el_${idx}`).value);
    if (!elIn.ok) {
      document.getElementById(`echo_${idx}`).textContent = "Élévation invalide.";
      return;
    }

    const eIdx = elevationToIndexFloat(elIn.val);
    if (!eIdx.ok) {
      document.getElementById(`echo_${idx}`).textContent =
        "Élévation hors domaine (0..180 ou -179..-1).";
      return;
    }

    const pat = bands[bandLabel];
    const attAz = interpCircular360(pat.az, azNorm);
    const attEl = interpCircular360(pat.el, eIdx.idx);

    document.getElementById(`azRes_${idx}`).textContent = `${attAz.toFixed(2)} dB`;
    document.getElementById(`elRes_${idx}`).textContent = `${attEl.toFixed(2)} dB`;
    document.getElementById(`echo_${idx}`).textContent = `Élévation saisie: ${elIn.val}° (strict)`;

    okCount++;
  });

  setStatus(okCount > 0
    ? `Calcul terminé (${okCount}/${bandLabels.length} bandes calculées).`
    : "Aucun résultat (vérifie les élévations).", okCount === 0);
}

function clearAnglesOnly() {
  document.getElementById("azimuthInput").value = "";
  document.getElementById("azEcho").textContent = "";
  // efface champs / résultats dans les cartes
  const cards = document.getElementById("bandCards");
  cards.querySelectorAll("input[id^='el_']").forEach(inp => inp.value = "");
  cards.querySelectorAll("span[id^='azRes_'], span[id^='elRes_']").forEach(sp => sp.textContent = "");
  cards.querySelectorAll("div[id^='echo_']").forEach(sp => sp.textContent = "");
}

function clearAngles() {
  clearAnglesOnly();
  setStatus("Angles effacés.");
}

function clearAll() {
  clearAnglesOnly();
  document.getElementById("antennaSelect").selectedIndex = 0;
  renderBandCards();
  setStatus("Réinitialisé.");
}

async function copyText(spanId) {
  const txt = (document.getElementById(spanId).textContent || "").trim();
  if (!txt) return;

  try {
    await navigator.clipboard.writeText(txt);
    setStatus("Copié dans le presse-papier.");
  } catch {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = txt;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); setStatus("Copié dans le presse-papier."); }
    catch { setStatus("Copie impossible (navigateur).", true); }
    finally { document.body.removeChild(ta); }
  }
}

// Expose pour onclick inline
window.copyText = copyText;
