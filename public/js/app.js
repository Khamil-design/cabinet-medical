/* Application de gestion du cabinet médical — frontend vanilla JS */

const state = {
  user: null,
  medecins: [],
  patients: [],
  planningDate: today(),
  planningMode: "jour",
  planningMedecin: "",
  planningAbsences: [],
  usersFilter: ""
};

// ---------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function age(dateNaissance) {
  if (!dateNaissance) return "";
  const naiss = new Date(dateNaissance + "T00:00:00");
  const now = new Date();
  let a = now.getFullYear() - naiss.getFullYear();
  const m = now.getMonth() - naiss.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < naiss.getDate())) a--;
  return String(a);
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function nomComplet(p) {
  return `${p.prenom || ""} ${p.nom || ""}`.trim();
}

function statutBadge(statut) {
  const libelles = {
    planifie: "Planifié", confirme: "Confirmé", termine: "Terminé", annule: "Annulé",
    impayee: "Impayée", partielle: "Partielle", payee: "Payée"
  };
  return `<span class="badge ${esc(statut)}">${esc(libelles[statut] || statut)}</span>`;
}

function toast(texte, erreur) {
  const t = document.getElementById("toast");
  t.textContent = texte;
  t.className = "toast" + (erreur ? " error" : "");
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), 3500);
}

// ---------------------------------------------------------------
// API
// ---------------------------------------------------------------

async function api(path, method, body) {
  const opt = { method: method || "GET", headers: {} };
  if (body !== undefined) {
    opt.headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(body);
  }
  const res = await fetch(path, opt);
  if (res.status === 401 && !path.startsWith("/api/login")) {
    window.location.href = "/login";
    throw new Error("Non authentifié");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.erreur || "Erreur serveur.");
    e.status = res.status;
    throw e;
  }
  return data;
}

// ---------------------------------------------------------------
// Modale
// ---------------------------------------------------------------

function openModal(title, bodyHtml, wide) {
  const overlay = document.getElementById("modalOverlay");
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalBody").innerHTML = bodyHtml;
  document.getElementById("modalBox").className = "modal" + (wide ? " modal-wide" : "");
  overlay.hidden = false;
  return overlay;
}

function closeModal() {
  document.getElementById("modalOverlay").hidden = true;
}

function bindModalClose() {
  document.getElementById("modalClose").onclick = closeModal;
  document.getElementById("modalOverlay").addEventListener("click", (e) => {
    if (e.target.id === "modalOverlay") closeModal();
  });
}

// ---------------------------------------------------------------
// Navigation / démarrage
// ---------------------------------------------------------------

let view = document.getElementById("view");

function route() {
  const h = location.hash.replace(/^#\/?/, "");
  if (h.startsWith("patient/")) {
    renderPatientDetail(Number(h.split("/")[1]));
  } else if (h === "patients") {
    renderPatients();
  } else if (h === "factures") {
    renderFactures();
  } else if (h === "a-confirmer") {
    renderAConfirmer();
  } else if (h === "activite") {
    renderActivite();
  } else if (h === "tarifs") {
    renderTarifs();
  } else if (h === "utilisateurs") {
    renderUtilisateurs();
  } else {
    renderPlanning();
  }
  bindNavActive(h.replace(/^patient\/.*/, "patients"));
}

function bindNavActive(active) {
  document.querySelectorAll("[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === active);
    if (active === "patients" && b.dataset.view === "patients") b.classList.add("active");
  });
}

async function init() {
  state.user = await api("/api/me");
  document.getElementById("userName").textContent = state.user.nomComplet;
  document.getElementById("userRole").textContent = { admin: "Administrateur", medecin: "Médecin", secretaire: "Secrétaire" }[state.user.role];

  document.querySelectorAll(".admin-only").forEach((el) => (el.style.display = state.user.role === "admin" ? "" : "none"));

  try {
    const users = await api("/api/users");
    state.medecins = users.filter((u) => u.role === "medecin" || u.role === "admin");
  } catch (e) { /* non bloquant */ }

  document.getElementById("logoutBtn").onclick = async () => {
    await api("/api/logout", "POST");
    window.location.href = "/login";
  };

  document.querySelectorAll("[data-view]").forEach((b) => {
    b.addEventListener("click", () => {
      location.hash = b.dataset.view;
    });
  });

  window.addEventListener("hashchange", route);
  route();

  view = document.getElementById("view");
  bindModalClose();
}

// ---------------------------------------------------------------
// PLANNING
// ---------------------------------------------------------------

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ajouterJours(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

function debutSemaine(iso) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() || 7) - 1));
  return isoDate(d);
}

function dernierJourMois(iso) {
  const d = new Date(iso.slice(0, 8) + "01T00:00:00");
  d.setMonth(d.getMonth() + 1, 0);
  return isoDate(d);
}

function dateCourte(iso) {
  const [a, m, j] = iso.split("-");
  return `${j}/${m}/${a}`;
}

function decalerDate(offset) {
  state.planningDate = ajouterJours(state.planningDate, offset);
  renderPlanning();
}

function decalerPlanning(offset) {
  if (state.planningMode === "jour") return decalerDate(offset);
  const d = new Date(state.planningDate + "T00:00:00");
  if (state.planningMode === "semaine") d.setDate(d.getDate() + offset * 7);
  else d.setMonth(d.getMonth() + offset);
  state.planningDate = isoDate(d);
  renderPlanning();
}

function allerAujourdhui() {
  state.planningDate = state.planningMode === "mois" ? today().slice(0, 8) + "01" : today();
  renderPlanning();
}

function setPlanningMode(mode) {
  if (state.planningMode === mode) return;
  state.planningMode = mode;
  renderPlanning();
}

function libellePeriode() {
  if (state.planningMode === "jour") return dateLongue(state.planningDate);
  if (state.planningMode === "semaine") {
    const d = debutSemaine(state.planningDate);
    return `Semaine du ${dateCourte(d)} au ${dateCourte(ajouterJours(d, 6))}`;
  }
  const d = new Date(state.planningDate.slice(0, 8) + "01T00:00:00");
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(d);
}

function peutGererAbsences() {
  return state.user && (state.user.role === "medecin" || state.user.role === "admin");
}

async function renderPlanning() {
  view.innerHTML = `
    <div class="view-header">
      <h1>Planning</h1>
      <div class="toolbar">
        <div class="seg">
          <button class="seg-btn ${state.planningMode === "jour" ? "active" : ""}" onclick="setPlanningMode('jour')">Jour</button>
          <button class="seg-btn ${state.planningMode === "semaine" ? "active" : ""}" onclick="setPlanningMode('semaine')">Semaine</button>
          <button class="seg-btn ${state.planningMode === "mois" ? "active" : ""}" onclick="setPlanningMode('mois')">Mois</button>
        </div>
        <button class="btn btn-outline" onclick="decalerPlanning(-1)">←</button>
        <button class="btn btn-outline" onclick="allerAujourdhui()">Aujourd'hui</button>
        <button class="btn btn-outline" onclick="decalerPlanning(1)">→</button>
        <input type="date" id="datePicker" value="${esc(state.planningDate)}">
        <select id="medecinFilter" style="width:auto">
          <option value="">Tous les médecins</option>
          ${state.medecins
            .filter((m) => m.actif !== 0)
            .map((m) => `<option value="${m.id}" ${state.planningMedecin == m.id ? "selected" : ""}>${esc(m.nom_complet)}</option>`)
            .join("")}
        </select>
        <button class="btn btn-primary" id="btnNouveauRdv">+ RDV</button>
        ${peutGererAbsences() ? `<button class="btn btn-outline" id="btnAbsence">+ Absence</button>` : ""}
      </div>
    </div>
    <h2 style="font-size:16px;color:var(--muted);margin:0 0 14px">${esc(libellePeriode())}</h2>
    <div id="planningBody" class="empty">Chargement…</div>
  `;

  document.getElementById("datePicker").onchange = (e) => {
    if (e.target.value) { state.planningDate = e.target.value; renderPlanning(); }
  };
  document.getElementById("medecinFilter").onchange = (e) => {
    state.planningMedecin = e.target.value;
    renderPlanning();
  };
  document.getElementById("btnNouveauRdv").onclick = () => openRdvForm();
  const btnAbsence = document.getElementById("btnAbsence");
  if (btnAbsence) btnAbsence.onclick = () => openAbsenceForm();

  try {
    let debut = state.planningDate;
    let fin = state.planningDate;
    if (state.planningMode === "semaine") { debut = debutSemaine(state.planningDate); fin = ajouterJours(debut, 6); }
    else if (state.planningMode === "mois") { debut = state.planningDate.slice(0, 8) + "01"; fin = dernierJourMois(state.planningDate); }

    const params = new URLSearchParams({ debut, fin });
    if (state.planningMedecin) params.set("medecin", state.planningMedecin);
    const absParams = new URLSearchParams({ debut, fin });
    if (state.planningMedecin) absParams.set("medecin", state.planningMedecin);

    const [rvs, absences] = await Promise.all([
      api(`/api/rendezvous?${params}`),
      api(`/api/absences?${absParams}`)
    ]);
    state.planningAbsences = absences;
    const mapAbs = absenceSurJours(debut, fin);

    const comptes = { planifie: 0, confirme: 0, termine: 0, annule: 0 };
    rvs.forEach((r) => (comptes[r.statut] = (comptes[r.statut] || 0) + 1));

    const body = `
      <div class="summary">
        <div class="chip"><b>${rvs.length}</b><small>Rendez-vous</small></div>
        <div class="chip planifie"><b>${comptes.planifie}</b><small>Planifiés</small></div>
        <div class="chip confirme"><b>${comptes.confirme}</b><small>Confirmés</small></div>
        <div class="chip termine"><b>${comptes.termine}</b><small>Terminés</small></div>
        <div class="chip annule"><b>${comptes.annule}</b><small>Annulés</small></div>
      </div>
      ${etatJour(mapAbs)}
      ${corpsPlanning(state.planningMode, rvs, debut, fin, mapAbs)}
    `;
    document.getElementById("planningBody").className = "";
    document.getElementById("planningBody").innerHTML = body;
  } catch (e) {
    toast(e.message, true);
  }
}

function joursDe(debut, fin) {
  const jours = [];
  for (let iso = debut; iso <= fin; iso = ajouterJours(iso, 1)) jours.push(iso);
  return jours;
}

function absenceSurJours(debut, fin) {
  const map = {};
  state.planningAbsences.forEach((a) => {
    if (state.planningMedecin && Number(a.medecin_id) !== Number(state.planningMedecin)) return;
    for (const iso of joursDe(a.date_debut, a.date_fin)) {
      if (debut <= iso && iso <= fin) (map[iso] || (map[iso] = [])).push(a);
    }
  });
  return map;
}

function etatJour(mapAbs) {
  return (mapAbs[state.planningDate] || []).map((a) => `
    <div class="absence-banner">
      <b>Absence</b> · ${esc(a.medecin_nom || "Médecin")} — du ${esc(dateCourte(a.date_debut))} au ${esc(dateCourte(a.date_fin))}
      ${a.motif ? ` (${esc(a.motif)})` : ""}
      ${peutGererAbsences() ? `<button class="btn btn-danger-ghost btn-sm" onclick="supprimerAbsence(${a.id})">Supprimer</button>` : ""}
    </div>`).join("");
}

function corpsPlanning(mode, rvs, debut, fin, mapAbs) {
  if (mode === "semaine") return vueSemaine(rvs, debut, mapAbs);
  if (mode === "mois") return vueMois(rvs, debut, fin, mapAbs);
  return rvs.length
    ? `<div class="planning-grid">${rvs.map(carteRdv).join("")}</div>`
    : `<div class="card"><div class="empty">Aucun rendez-vous ce jour.</div></div>`;
}

function vueSemaine(rvs, debut, mapAbs) {
  const jours = [];
  for (let i = 0; i < 7; i++) {
    const iso = ajouterJours(debut, i);
    jours.push({ iso, rvs: rvs.filter((r) => r.date === iso).sort((a, b) => a.heure.localeCompare(b.heure)) });
  }
  const heures = [];
  for (let h = 8; h <= 20; h++) {
    heures.push(`${String(h).padStart(2, "0")}:00`);
    if (h !== 20) heures.push(`${String(h).padStart(2, "0")}:30`);
  }
  const noms = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
  return `
    <div class="planning-week">
      <div class="pw-time"></div>
      ${jours.map((j, i) => `
        <div class="pw-head ${j.iso === today() ? "today" : ""} ${mapAbs[j.iso] ? "absent" : ""}">
          <b>${noms[i]}</b><br>
          <span class="pw-date">${esc(dateCourte(j.iso))}</span>
          ${mapAbs[j.iso] ? `<span class="pw-abs">Absent</span>` : ""}
        </div>`).join("")}
      ${heures.map((h) => `
        <div class="pw-time">${h}</div>
        ${jours.map((j) => `
          <div class="pw-cell ${j.iso === today() ? "today" : ""} ${mapAbs[j.iso] ? "absent" : ""}" onclick="${mapAbs[j.iso] ? "" : `state.planningDate='${j.iso}'; setPlanningMode('jour')`}">
            ${j.rvs.filter((r) => r.heure === h).map((r) => `
              <div class="pw-rdv ${esc(r.statut)}" onclick="event.stopPropagation(); openRdvForm(${r.id})">${esc(r.heure)} ${esc(nomComplet(r))}</div>`).join("")}
          </div>`).join("")}
      `).join("")}
    </div>`;
}

function vueMois(rvs, debut, fin, mapAbs) {
  const premier = new Date(debut + "T00:00:00");
  const start = ajouterJours(debut, -((premier.getDay() || 7) - 1));
  const etatComtes = (iso) => {
    const jr = rvs.filter((r) => r.date === iso);
    return ["termine", "confirme", "planifie", "annule"].map((s) =>
      jr.filter((r) => r.statut === s).length
        ? `<span class="cal-pts"><i class="pt ${s}"></i>${jr.filter((r) => r.statut === s).length}</span>`
        : "").join("");
  };
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const iso = ajouterJours(start, i);
    const hors = iso < debut || iso > fin;
    const total = rvs.filter((r) => r.date === iso).length;
    cells.push(`
      <div class="cal-cell ${hors ? "hors" : ""} ${iso === today() ? "today" : ""} ${mapAbs[iso] ? "absent" : ""}"
           onclick="${hors ? "" : `state.planningDate='${iso}'; setPlanningMode('jour')`}">
        <div class="cal-num">${Number(iso.slice(8))}</div>
        ${!hors && total ? `<span class="cal-total">${total}</span>` : ""}
        <div class="cal-comptes">${etatComtes(iso)}</div>
        ${mapAbs[iso] ? `<div class="cal-abs">Abs</div>` : ""}
      </div>`);
  }
  return `
    <div class="cal">
      <div class="cal-head">Lun</div><div class="cal-head">Mar</div><div class="cal-head">Mer</div>
      <div class="cal-head">Jeu</div><div class="cal-head">Ven</div><div class="cal-head">Sam</div><div class="cal-head">Dim</div>
      ${cells.join("")}
    </div>`;
}

async function openAbsenceForm() {
  let medecinDefaut = state.planningMedecin;
  if (!medecinDefaut && state.user.role === "medecin") medecinDefaut = String(state.user.id);
  const medecins = state.medecins.filter((m) => m.actif !== 0);
  openModal("Nouvelle absence", `
    <form id="absenceForm">
      <div>
        <label>Médecin *</label>
        <select id="absMedecin" required>
          ${medecins.map((m) => `<option value="${m.id}" ${String(m.id) === String(medecinDefaut) ? "selected" : ""}>${esc(m.nom_complet)}</option>`).join("")}
        </select>
      </div>
      <div class="form-row">
        <div><label>Du *</label><input type="date" id="absDebut" value="${esc(state.planningDate)}" required></div>
        <div><label>Au *</label><input type="date" id="absFin" value="${esc(state.planningDate)}" required></div>
      </div>
      <div><label>Motif</label><input type="text" id="absMotif" placeholder="Congés, formation…"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer</button>
      </div>
    </form>
  `);
  bindModalClose();
  document.getElementById("absenceForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("/api/absences", "POST", {
        medecinId: Number(document.getElementById("absMedecin").value),
        dateDebut: document.getElementById("absDebut").value,
        dateFin: document.getElementById("absFin").value,
        motif: document.getElementById("absMotif").value
      });
      closeModal();
      toast("Absence enregistrée.");
      renderPlanning();
    } catch (err) {
      toast(err.message, true);
    }
  };
}

async function supprimerAbsence(id) {
  if (!confirm("Supprimer cette absence ?")) return;
  try {
    await api(`/api/absences/${id}`, "DELETE");
    toast("Absence supprimée.");
    renderPlanning();
  } catch (e) {
    toast(e.message, true);
  }
}

function carteRdv(r) {
  return `
    <div class="rdv-card ${esc(r.statut)}">
      <div class="rdv-time">${esc(r.heure)} <span style="font-size:13px;color:var(--muted)">(${r.duree_min} min)</span></div>
      <h3>${esc(nomComplet(r))}</h3>
      <div class="rdv-meta">
        ${esc(r.medecin_nom || "—")} · ${esc(r.motif || "Consultation")}<br>
        ${esc(r.patient_telephone || "")}
      </div>
      <div>${statutBadge(r.statut)}</div>
      <div class="actions" style="margin-top:10px">
        ${r.statut !== "annule" ? `<button class="btn btn-outline btn-sm" onclick="changerStatutRdv(${r.id},'termine')">Terminer</button>
        <button class="btn btn-outline btn-sm" onclick="changerStatutRdv(${r.id},'confirme')">Confirmer</button>
        <button class="btn btn-outline btn-sm" onclick="changerStatutRdv(${r.id},'annule')">Annuler</button>` : ""}
        <button class="btn btn-outline btn-sm" onclick="openRdvForm(${r.id})">Modifier</button>
        <button class="btn btn-danger-ghost btn-sm" onclick="supprimerRdv(${r.id})">Supprimer</button>
      </div>
    </div>`;
}

function dateLongue(iso) {
  const d = new Date(iso + "T00:00:00");
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
}

async function changerStatutRdv(id, statut) {
  try {
    await api(`/api/rendezvous/${id}`, "PUT", { statut });
    toast("Statut mis à jour.");
    renderPlanning();
  } catch (e) {
    toast(e.message, true);
  }
}

async function supprimerRdv(id) {
  if (!confirm("Supprimer ce rendez-vous ?")) return;
  try {
    await api(`/api/rendezvous/${id}`, "DELETE");
    toast("Rendez-vous supprimé.");
    renderPlanning();
  } catch (e) {
    toast(e.message, true);
  }
}

async function openRdvForm(id, patientPreselect) {
  let rv = { date: state.planningDate, heure: "09:00", dureeMin: 30, statut: "planifie", motif: "", notes: "" };
  if (id) {
    const tous = await api("/api/rendezvous");
    rv = Object.assign(rv, tous.find((r) => r.id === id) || {});
  }
  if (state.patients.length === 0) state.patients = await api("/api/patients");

  const patientSel = String(rv.patient_id ?? patientPreselect ?? "");

  openModal(id ? "Modifier le rendez-vous" : "Nouveau rendez-vous", `
    <form id="rdvForm">
      <div class="form-row">
        <div>
          <label>Patient *</label>
          <select id="rvPatient" required>
            <option value="">— Choisir un patient —</option>
            ${state.patients.map((p) => `<option value="${p.id}" ${String(p.id) === patientSel ? "selected" : ""}>${esc(nomComplet(p))}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Médecin *</label>
          <select id="rvMedecin" required>
            ${state.medecins.filter((m) => m.actif !== 0).map((m) => `<option value="${m.id}" ${String(m.id) === String(rv.medecin_id) ? "selected" : ""}>${esc(m.nom_complet)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div><label>Date *</label><input type="date" id="rvDate" value="${esc(rv.date)}" required></div>
        <div><label>Heure *</label><input type="time" id="rvHeure" value="${esc(rv.heure)}" required></div>
      </div>
      <div class="form-row">
        <div><label>Durée (min)</label><input type="number" id="rvDuree" value="${rv.dureeMin}" min="5" step="5"></div>
        <div><label>Statut</label>
          <select id="rvStatut">
            <option value="planifie" ${rv.statut === "planifie" ? "selected" : ""}>Planifié</option>
            <option value="confirme" ${rv.statut === "confirme" ? "selected" : ""}>Confirmé</option>
            <option value="termine" ${rv.statut === "termine" ? "selected" : ""}>Terminé</option>
            <option value="annule" ${rv.statut === "annule" ? "selected" : ""}>Annulé</option>
          </select>
        </div>
      </div>
      <label>Motif</label><input type="text" id="rvMotif" value="${esc(rv.motif)}">
      <label>Notes</label><textarea id="rvNotes">${esc(rv.notes)}</textarea>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer</button>
      </div>
    </form>
  `, true);

  document.getElementById("rdvForm").onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      patientId: Number(document.getElementById("rvPatient").value),
      medecinId: Number(document.getElementById("rvMedecin").value),
      date: document.getElementById("rvDate").value,
      heure: document.getElementById("rvHeure").value,
      dureeMin: Number(document.getElementById("rvDuree").value) || 30,
      motif: document.getElementById("rvMotif").value,
      statut: document.getElementById("rvStatut").value,
      notes: document.getElementById("rvNotes").value
    };
    try {
      if (id) await api(`/api/rendezvous/${id}`, "PUT", body);
      else await api("/api/rendezvous", "POST", body);
      closeModal();
      toast("Rendez-vous enregistré.");
      renderPlanning();
    } catch (err) {
      toast(err.message, true);
    }
  };
}

// ---------------------------------------------------------------
// À CONFIRMER (rappels + rendez-vous en attente de confirmation)
// ---------------------------------------------------------------

function canalBadge(type) {
  return `<span class="canal ${type === "email" ? "email" : "sms"}">${type === "email" ? "E-mail" : "SMS"}</span>`;
}

async function renderAConfirmer() {
  view.innerHTML = `
    <div class="view-header">
      <h1>À confirmer</h1>
      <div class="toolbar">
        <button class="btn btn-outline" id="btnGenererRappels">Générer les rappels (J-1 / J-2)</button>
        <button class="btn btn-outline" id="btnToutEnvoyer">Tout envoyer</button>
      </div>
    </div>
    <div id="suiviBody" class="empty">Chargement…</div>
  `;
  document.getElementById("btnGenererRappels").onclick = async () => {
    try {
      const d = await api("/api/rappels/generer", "POST");
      toast(`${d.generes} rappel(s) généré(s).`);
      renderAConfirmer();
    } catch (e) { toast(e.message, true); }
  };
  document.getElementById("btnToutEnvoyer").onclick = async () => {
    if (!confirm("Marquer tous les rappels en attente comme envoyés ?")) return;
    try {
      const d = await api("/api/rappels/envoyer-tous", "POST");
      toast(`${d.envoyes} rappel(s) envoyé(s).`);
      renderAConfirmer();
    } catch (e) { toast(e.message, true); }
  };

  try {
    const auj = today();
    const fin = ajouterJours(auj, 30);
    const [rappelsAEnvoyer, rappelsEnvoyes, aConfirmer] = await Promise.all([
      api("/api/rappels?envoye=0"),
      api("/api/rappels?envoye=1"),
      api(`/api/rendezvous?debut=${auj}&fin=${fin}&statut=planifie`)
    ]);
    const body = `
      <h3 style="margin-top:0">Rappels à envoyer (${rappelsAEnvoyer.length})</h3>
      ${blocRappels(rappelsAEnvoyer, true)}
      <h3>Rendez-vous à confirmer (${aConfirmer.length})</h3>
      ${blocAConfirmer(aConfirmer)}
      <h3>Rappels envoyés (${rappelsEnvoyes.length})</h3>
      ${blocRappels(rappelsEnvoyes, false)}
    `;
    const el = document.getElementById("suiviBody");
    el.className = "";
    el.innerHTML = body;
  } catch (e) {
    toast(e.message, true);
  }
}

function blocRappels(liste, enAttente) {
  if (!liste.length) {
    return `<div class="card"><div class="empty">Aucun rappel ${enAttente ? "à envoyer" : "envoyé"} pour le moment.</div></div>`;
  }
  return `<div class="suivi-list">
    ${liste.map((r) => `
      <div class="suivi-row">
        <div class="suivi-main">
          <b>${esc(nomComplet(r))}</b>
          <span class="muted">${esc(r.patient_telephone || "")}${r.patient_email ? " · " + esc(r.patient_email) : ""}</span><br>
          <span class="muted">RDV ${esc(r.rdv_date)} à ${esc(r.rdv_heure)} · ${esc(r.medecin_nom || "—")} · ${canalBadge(r.type)}</span>
        </div>
        <div class="actions">
          ${r.envoye
            ? `<span class="muted">Envoyé ${esc(r.envoye_le || "")}</span>`
            : `<button class="btn btn-primary btn-sm" onclick="envoyerRappel(${r.id})">Envoyer</button>`}
        </div>
      </div>`).join("")}
  </div>`;
}

function blocAConfirmer(liste) {
  if (!liste.length) {
    return `<div class="card"><div class="empty">Aucun rendez-vous en attente de confirmation.</div></div>`;
  }
  return `<div class="suivi-list">
    ${liste.map((r) => `
      <div class="suivi-row">
        <div class="suivi-main">
          <b>${esc(nomComplet(r))}</b>
          <span class="muted">${esc(r.patient_telephone || "")}</span><br>
          <span class="muted">${esc(r.date)} à ${esc(r.heure)} · ${esc(r.medecin_nom || "—")}${r.motif ? " · " + esc(r.motif) : ""} · ${statutBadge("planifie")}</span>
        </div>
        <div class="actions">
          <button class="btn btn-outline btn-sm" onclick="confirmerDepuisSuivi(${r.id}, 'confirme')">Confirmer</button>
          <button class="btn btn-danger-ghost btn-sm" onclick="confirmerDepuisSuivi(${r.id}, 'annule')">Annuler</button>
        </div>
      </div>`).join("")}
  </div>`;
}

async function envoyerRappel(id) {
  try {
    await api(`/api/rappels/${id}/envoyer`, "POST");
    toast("Rappel envoyé.");
    renderAConfirmer();
  } catch (e) { toast(e.message, true); }
}

async function confirmerDepuisSuivi(id, statut) {
  try {
    await api(`/api/rendezvous/${id}`, "PUT", { statut });
    toast(statut === "confirme" ? "Rendez-vous confirmé." : "Rendez-vous annulé.");
    renderAConfirmer();
  } catch (e) { toast(e.message, true); }
}

// ---------------------------------------------------------------
// PATIENTS
// ---------------------------------------------------------------

async function renderPatients() {
  view.innerHTML = `
    <div class="view-header">
      <h1>Patients</h1>
      <div class="toolbar">
        <input type="search" id="recherchePatient" placeholder="Rechercher (nom, téléphone)…" style="width:280px">
        <button class="btn btn-primary" id="btnNouveauPatient">+ Nouveau patient</button>
      </div>
    </div>
    <div id="patientsBody" class="empty">Chargement…</div>
  `;

  document.getElementById("btnNouveauPatient").onclick = () => openPatientForm();
  document.getElementById("recherchePatient").oninput = debounce(async (e) => {
    await afficherPatients(e.target.value);
  }, 250);

  await afficherPatients("");
}

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

async function afficherPatients(q) {
  const body = document.getElementById("patientsBody");
  try {
    const patients = await api(`/api/patients${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    body.className = "";
    body.innerHTML = patients.length
      ? `<div class="card">
          <table class="table">
            <thead><tr><th>Patient</th><th>Téléphone</th><th>Naissance</th><th>Groupe</th><th style="text-align:end">Actions</th></tr></thead>
            <tbody>
              ${patients.map((p) => `
                <tr>
                  <td>
                    <a href="#patient/${p.id}" style="font-weight:600;color:var(--ink);text-decoration:none">${esc(nomComplet(p))}</a>
                    ${p.sexe ? `<span style="color:var(--muted)">(${p.sexe === "M" ? "H" : "F"})</span>` : ""}
                  </td>
                  <td>${esc(p.telephone || "—")}</td>
                  <td>${esc(p.date_naissance || "—")} ${p.date_naissance ? `<small style="color:var(--muted)">(${age(p.date_naissance)} ans)</small>` : ""}</td>
                  <td>${esc(p.groupe_sanguin || "—")}</td>
                  <td>
                    <div class="actions">
                      <a class="btn btn-outline btn-sm" href="#patient/${p.id}">Dossier</a>
                      <button class="btn btn-outline btn-sm" onclick="openPatientForm(${p.id})">Modifier</button>
                      <button class="btn btn-danger-ghost btn-sm" onclick="supprimerPatient(${p.id})">Supprimer</button>
                    </div>
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>`
      : `<div class="card"><div class="empty">Aucun patient trouvé.</div></div>`;
  } catch (e) {
    body.className = "";
    body.innerHTML = `<div class="card"><div class="empty">${esc(e.message)}</div></div>`;
  }
}

const champsPatient = [
  ["prenom", "Prénom *", "text"],
  ["nom", "Nom *", "text"],
  ["dateNaissance", "Date de naissance", "date"],
  ["sexe", "Sexe", "select", [["", "—"], ["F", "Femme"], ["M", "Homme"]]],
  ["telephone", "Téléphone", "tel"],
  ["email", "Email", "email"],
  ["adresse", "Adresse", "text"],
  ["groupeSanguin", "Groupe sanguin", "text"]
];

async function openPatientForm(id) {
  let p = {};
  if (id) {
    const tous = await api("/api/patients");
    p = tous.find((x) => x.id === id) || {};
  }
  const f = (k, label, type, opts) => {
    if (type === "select") {
      const options = opts.map(([v, l]) => `<option value="${esc(v)}" ${String(p[k]) === v ? "selected" : ""}>${esc(l)}</option>`).join("");
      return `<div><label>${label}</label><select id="p${k}">${options}</select></div>`;
    }
    return `<div><label>${label}</label><input type="${type}" id="p${k}" value="${esc(p[k] || "")}"></div>`;
  };
  let rows = "";
  for (let i = 0; i < champsPatient.length; i += 2) {
    const left = champsPatient[i];
    const right = champsPatient[i + 1];
    rows += `<div class="form-row">${f(left[0], left[1], left[2], left[3])}${right ? f(right[0], right[1], right[2], right[3]) : ""}</div>`;
  }

  openModal(id ? "Modifier le patient" : "Nouveau patient", `
    <form id="patientForm">
      ${rows}
      <div class="form-row">
        <div><label>Antécédents</label><textarea id="pantecedents">${esc(p.antecedents || "")}</textarea></div>
        <div><label>Notes</label><textarea id="pnotes">${esc(p.notes || "")}</textarea></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer</button>
      </div>
    </form>
  `, true);

  document.getElementById("patientForm").onsubmit = async (e) => {
    e.preventDefault();
    const lire = (k) => document.getElementById(`p${k}`).value;
    const body = {
      prenom: lire("prenom"), nom: lire("nom"), dateNaissance: lire("dateNaissance") || null,
      sexe: lire("sexe") || null, telephone: lire("telephone"), email: lire("email"),
      adresse: lire("adresse"), groupeSanguin: lire("groupeSanguin"),
      antecedents: lire("antecedents"), notes: lire("notes")
    };
    try {
      if (id) await api(`/api/patients/${id}`, "PUT", body);
      else await api("/api/patients", "POST", body);
      closeModal();
      toast("Patient enregistré.");
      renderPatients();
    } catch (err) {
      toast(err.message, true);
    }
  };
}

async function supprimerPatient(id) {
  if (!confirm("Supprimer définitivement ce patient et ses données ?")) return;
  try {
    await api(`/api/patients/${id}`, "DELETE");
    toast("Patient supprimé.");
    renderPatients();
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------------------------------------------------------------
// DOSSIER PATIENT
// ---------------------------------------------------------------

async function renderPatientDetail(id) {
  view.innerHTML = `<h1 class="no-print">Dossier patient</h1><div id="detailBody" class="empty">Chargement…</div>`;
  const body = document.getElementById("detailBody");

  try {
    const patients = await api("/api/patients");
    const p = patients.find((x) => x.id === id);
    if (!p) throw new Error("Patient introuvable.");

    const rvs = await api("/api/rendezvous");
    const rvPatient = rvs.filter((r) => r.patient_id === id);

    const ordos = await api(`/api/patients/${id}/ordonnances`);

    const factures = await api(`/api/factures?patient=${id}`);

    body.className = "";
    body.innerHTML = `
      <div class="card">
        <div class="patient-head">
          <div style="display:flex;align-items:center;gap:16px">
            <div class="patient-avatar">${esc(nomComplet(p).charAt(0) || "?")}</div>
            <div>
              <h1 style="margin:0;font-size:22px">${esc(nomComplet(p))}</h1>
              <span style="color:var(--muted)">${esc(p.sexe === "F" ? "Femme" : p.sexe === "M" ? "Homme" : "")}${p.date_naissance ? " · " + age(p.date_naissance) + " ans" : ""}</span>
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-outline no-print" onclick="openPatientForm(${p.id})">Modifier</button>
            <button class="btn btn-outline no-print" onclick="imprimerDossier()">🖨 Imprimer</button>
            <a class="btn btn-outline no-print" href="#patients">← Patients</a>
          </div>
        </div>

        <div class="print-header">
          <strong>Cabinet Médical</strong>
          <h1 style="margin:4px 0 0">Dossier médical de ${esc(nomComplet(p))}</h1>
          <small style="color:var(--muted)">Imprimé le ${esc(new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date()))}</small>
        </div>

        <div class="kv" style="margin-top:18px">
          <div><dt>Téléphone</dt><dd>${esc(p.telephone || "—")}</dd></div>
          <div><dt>Email</dt><dd>${esc(p.email || "—")}</dd></div>
          <div><dt>Adresse</dt><dd>${esc(p.adresse || "—")}</dd></div>
          <div><dt>Groupe sanguin</dt><dd>${esc(p.groupe_sanguin || "—")}</dd></div>
        </div>
        ${p.antecedents ? `<p><strong>Antécédents :</strong> ${esc(p.antecedents)}</p>` : ""}
        ${p.notes ? `<p><strong>Notes :</strong> ${esc(p.notes)}</p>` : ""}
      </div>

      <div class="section-title">
        <h2 style="font-size:18px;margin:0">Rendez-vous et notes cliniques</h2>
        <button class="btn btn-outline btn-sm no-print" onclick="openRdvFormNouveau(${p.id})">+ Rendez-vous</button>
      </div>
      <div class="card">
        ${rvPatient.length
          ? `<table class="table">
               <thead><tr><th>Date</th><th>Heure</th><th>Médecin</th><th>Motif</th><th>Statut</th><th>Notes cliniques</th><th class="no-print"></th></tr></thead>
               <tbody>${rvPatient.map((r) => `<tr>
                 <td>${esc(r.date)}</td><td>${esc(r.heure)}</td>
                 <td>${esc(r.medecin_nom || "—")}</td><td>${esc(r.motif || "—")}</td>
                 <td>${statutBadge(r.statut)}</td>
                 <td class="note-cell">${r.notes ? esc(r.notes) : '<span class="muted">—</span>'}</td>
                 <td class="no-print"><div class="actions"><button class="btn btn-outline btn-sm" onclick="openNotesRdv(${r.id}, ${p.id})">${r.notes ? "Notes…" : "+ Notes"}</button></div></td>
               </tr>`).join("")}
               </tbody>
             </table>`
          : `<div class="empty">Aucun rendez-vous.</div>`}
      </div>

      <div class="section-title">
        <h2 style="font-size:18px;margin:0">Ordonnances</h2>
        ${state.user.role === "medecin" || state.user.role === "admin"
          ? `<button class="btn btn-outline btn-sm no-print" onclick="openOrdonnanceForm(${p.id})">+ Ordonnance</button>` : ""}
      </div>
      <div class="card">
        ${ordos.length
          ? `<table class="table">
               <thead><tr><th>Date</th><th>Médecin</th><th>Nb médicaments</th><th class="no-print"></th></tr></thead>
               <tbody>${ordos.map((o) => `<tr>
                 <td>${esc(o.date)}</td><td>${esc(o.medecin_nom || "—")}</td>
                 <td>${esc(o.nb_items || "")}</td>
                 <td class="no-print"><div class="actions">
                   <button class="btn btn-outline btn-sm" onclick="imprimerOrdonnance(${o.id})">Imprimer</button>
                   <button class="btn btn-danger-ghost btn-sm" onclick="supprimerOrdonnance(${o.id})">Supprimer</button>
                 </div></td></tr>`).join("")}
               </tbody>
             </table>`
          : `<div class="empty">Aucune ordonnance.</div>`}
      </div>

      <div class="section-title">
        <h2 style="font-size:18px;margin:0">Factures</h2>
        <button class="btn btn-outline btn-sm no-print" onclick="openFactureForm(${p.id})">+ Facture</button>
      </div>
      <div class="card">
        ${factures.length
          ? `<div class="summary" style="margin-bottom:12px">
               <div class="chip"><b>${factures.length}</b><small>Factures</small></div>
               <div class="chip termine"><b>${(factures.reduce((s, f) => s + f.paye, 0)).toFixed(2)} MDH</b><small>Encaissé</small></div>
               <div class="chip planifie"><b>${(factures.reduce((s, f) => s + Math.max(0, f.montant - f.paye), 0)).toFixed(2)} MDH</b><small>Restant dû</small></div>
             </div>
             <table class="table">
               <thead><tr><th>N°</th><th>Désignation</th><th>Montant</th><th>Payé</th><th>Reste</th><th>Statut</th><th class="no-print"></th></tr></thead>
               <tbody>${factures.map((f) => {
                 const reste = Math.max(0, f.montant - f.paye);
                 return `<tr>
                   <td>${esc(f.numero)}</td><td>${esc(f.designation)}</td>
                   <td>${f.montant.toFixed(2)} MDH</td><td>${f.paye.toFixed(2)} MDH</td>
                   <td>${reste.toFixed(2)} MDH</td>
                   <td>${statutBadge(f.statut)}</td>
                   <td class="no-print"><div class="actions">
                     <button class="btn btn-outline btn-sm" onclick="detailFacture(${f.id})">Détail</button>
                     ${(state.user.role === "admin" || state.user.role === "medecin") ? `<button class="btn btn-danger-ghost btn-sm" onclick="supprimerFacture(${f.id})">Supprimer</button>` : ""}
                   </div></td></tr>`;}).join("")}
               </tbody>
             </table>`
          : `<div class="empty">Aucune facture.</div>`}
      </div>
    `;
  } catch (e) {
    body.className = "";
    body.innerHTML = `<div class="card"><div class="empty">${esc(e.message)}</div></div>`;
  }
}

async function openRdvFormNouveau(patientId) {
  await openRdvForm(null, patientId);
}

function imprimerDossier() {
  window.print();
}

async function openNotesRdv(id, patientId) {
  let rv;
  try {
    const tous = await api("/api/rendezvous");
    rv = tous.find((r) => r.id === id);
  } catch (e) {
    return toast(e.message, true);
  }
  if (!rv) return toast("Rendez-vous introuvable.", true);
  openModal("Notes cliniques du rendez-vous", `
    <p style="margin-top:0;color:var(--muted)">
      ${esc(rv.date)} à ${esc(rv.heure)} · ${esc(rv.medecin_nom || "—")} · ${esc(rv.motif || "Consultation")}
    </p>
    <form id="notesForm">
      <label>Notes cliniques</label>
      <textarea id="notesRdvTxt" rows="6" placeholder="Motif, examen, diagnostic, traitement, recommandations…">${esc(rv.notes)}</textarea>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer</button>
      </div>
    </form>
  `);
  bindModalClose();
  document.getElementById("notesForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`/api/rendezvous/${id}`, "PUT", { notes: document.getElementById("notesRdvTxt").value });
      closeModal();
      toast("Notes enregistrées.");
      renderPatientDetail(patientId);
    } catch (err) {
      toast(err.message, true);
    }
  };
}

// ---------------------------------------------------------------
// ORDONNANCES
// ---------------------------------------------------------------

let ordoItems = [{ medicament: "", posologie: "", duree: "" }];

async function openOrdonnanceForm(patientId) {
  if (state.patients.length === 0) state.patients = await api("/api/patients");
  ordoItems = [{ medicament: "", posologie: "", duree: "" }];
  openModal("Nouvelle ordonnance", `
    <p style="margin-top:0;color:var(--muted)">Patient : <strong>${esc(patientNomPlaceholder(patientId))}</strong></p>
    <form id="ordoForm">
      <div id="ordoItems"></div>
      <button type="button" class="btn btn-outline btn-sm" onclick="ajouterLigneOrdo()">+ Ajouter un médicament</button>
      <label>Notes / posologie globale</label>
      <textarea id="ordoNotes"></textarea>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer</button>
      </div>
    </form>
  `, true);
  renduLignesOrdo();

  document.getElementById("ordoForm").onsubmit = async (e) => {
    e.preventDefault();
    const items = ordoItems
      .map((l) => ({
        medicament: document.getElementById(`om${l.key}`).value,
        posologie: document.getElementById(`op${l.key}`).value,
        duree: document.getElementById(`od${l.key}`).value
      }))
      .filter((l) => l.medicament.trim());
    if (items.length === 0) return toast("Ajoutez au moins un médicament.", true);
    try {
      await api("/api/ordonnances", "POST", { patientId, items, notes: document.getElementById("ordoNotes").value });
      closeModal();
      toast("Ordonnance enregistrée.");
      renderPatientDetail(patientId);
    } catch (err) {
      toast(err.message, true);
    }
  };
}

function patientNomPlaceholder(id) {
  const p = state.patients.find((x) => x.id === id);
  return p ? nomComplet(p) : id;
}

function renduLignesOrdo() {
  const conteneur = document.getElementById("ordoItems");
  conteneur.innerHTML = ordoItems
    .map((l) => `
      <div class="form-row" style="margin-bottom:10px">
        <div><label>Médicament *</label><input type="text" id="om${l.key}" value="${esc(l.medicament)}" placeholder="Doliprane 1000 mg"></div>
        <div><label>Posologie</label><input type="text" id="op${l.key}" value="${esc(l.posologie)}" placeholder="1 comprimé matin et soir"></div>
        <div><label>Durée</label><input type="text" id="od${l.key}" value="${esc(l.duree)}" placeholder="5 jours"></div>
      </div>`)
    .join("");
}

function ajouterLigneOrdo() {
  ordoItems.push({ key: Date.now(), medicament: "", posologie: "", duree: "" });
  renduLignesOrdo();
}

async function imprimerOrdonnance(id) {
  try {
    const { ordonnance, items } = await api(`/api/ordonnances/${id}`);
    const fenetre = window.open("", "_blank", "width=800,height=900");
    if (!fenetre) return toast("Autorisez les fenêtres pop-up.", true);
    fenetre.document.write(`
      <!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
      <title>Ordonnance</title>
      <style>
        body{font-family:Georgia,serif;color:#222;padding:24px;max-width:700px;margin:auto}
        .tete{display:flex;justify-content:space-between;border-bottom:2px solid #000;padding-bottom:12px;margin-bottom:24px}
        .infos{padding:14px;background:#f5f5f5;border-radius:6px;margin-bottom:18px}
        table{width:100%;border-collapse:collapse;margin-top:8px}
        th,td{border:1px solid #aaa;padding:8px 10px;text-align:start}
        th{background:#eee}
        .sign{margin-top:60px;display:flex;justify-content:flex-end}
        .dx{font-weight:bold;font-size:18px;letter-spacing:.5px;text-align:center;margin:18px 0}
      </style></head>
      <body>
        <div class="tete">
          <div><strong>Cabinet Médical</strong><br>${new Date().getFullYear()} | Règlement intérieur : ${new Intl.DateTimeFormat("fr-FR").format(new Date(ordonnance.date))}</div>
          <div><button onclick="window.print()" style="cursor:pointer">🖨 Imprimer</button></div>
        </div>
        <h1 style="text-align:center;margin:8px 0 4px">ORDONNANCE</h1>
        <div class="dx">Rx</div>
        <div class="infos">
          <strong>${esc(nomComplet(ordonnance))}</strong>${ordonnance.date_naissance ? " — né(e) le " + esc(ordonnance.date_naissance) : ""}<br>
          Date : ${esc(ordonnance.date)} — Médecin : ${esc(ordonnance.medecin_nom || "")}
        </div>
        <table>
          <thead><tr><th>Médicament</th><th>Posologie</th><th>Durée</th></tr></thead>
          <tbody>
            ${items.map((i) => `<tr><td>${esc(i.medicament)}</td><td>${esc(i.posologie || "")}</td><td>${esc(i.duree || "")}</td></tr>`).join("")}
          </tbody>
        </table>
        ${ordonnance.notes ? `<p style="margin-top:14px"><strong>Notes :</strong> ${esc(ordonnance.notes)}</p>` : ""}
        <div class="sign">Signature : ______________________</div>
      </body></html>
    `);
    fenetre.document.close();
  } catch (e) {
    toast(e.message, true);
  }
}

async function supprimerOrdonnance(id) {
  if (!confirm("Supprimer cette ordonnance ?")) return;
  try {
    await api(`/api/ordonnances/${id}`, "DELETE");
    toast("Ordonnance supprimée.");
    if (location.hash.includes("patient/")) renderPatientDetail(Number(location.hash.split("/")[1]));
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------------------------------------------------------------
// FACTURATION
// ---------------------------------------------------------------

async function renderFactures() {
  view.innerHTML = `
    <div class="view-header">
      <h1>Facturation</h1>
      <div class="toolbar">
        <select id="filtreStatut" style="width:auto">
          <option value="">Tous les statuts</option>
          <option value="impayee">Impayées</option>
          <option value="partielle">Partielles</option>
          <option value="payee">Payées</option>
        </select>
        <input type="search" id="rechercheFacture" placeholder="Rechercher un patient…" style="width:240px">
        <button class="btn btn-primary" onclick="openFactureForm()">+ Nouvelle facture</button>
      </div>
    </div>
    <div id="facturesBody" class="empty">Chargement…</div>
  `;

  document.getElementById("filtreStatut").onchange = afficherFactures;
  document.getElementById("rechercheFacture").oninput = debounce(afficherFactures, 250);
  await afficherFactures();
}

async function afficherFactures() {
  const body = document.getElementById("facturesBody");
  if (!body) return;
  const statut = document.getElementById("filtreStatut").value;
  const q = document.getElementById("rechercheFacture").value.trim();
  try {
    let factures = await api(`/api/factures${statut ? `?statut=${statut}` : ""}`);
    if (q) {
      const besoins = await api("/api/patients?q=" + encodeURIComponent(q));
      const ids = new Set(besoins.map((p) => p.id));
      factures = factures.filter((f) => ids.has(f.patient_id));
    }
    body.className = "";
    body.innerHTML = factures.length
      ? `<div class="card">
          <table class="table">
            <thead><tr><th>N°</th><th>Patient</th><th>Désignation</th><th>Montant</th><th>Payé</th><th>Reste</th><th>Statut</th><th style="text-align:end">Actions</th></tr></thead>
            <tbody>
              ${factures.map((f) => {
                const reste = Math.max(0, f.montant - f.paye);
                return `<tr>
                  <td>${esc(f.numero)}</td>
                  <td><a href="#patient/${f.patient_id}" style="color:var(--ink);text-decoration:none;font-weight:600">${esc(nomComplet(f))}</a></td>
                  <td>${esc(f.designation)}</td>
                  <td>${f.montant.toFixed(2)} MDH</td>
                  <td>${f.paye.toFixed(2)} MDH</td>
                  <td>${reste.toFixed(2)} MDH</td>
                  <td>${statutBadge(f.statut)}</td>
                  <td><div class="actions">
                    <button class="btn btn-outline btn-sm" onclick="detailFacture(${f.id})">Détail</button>
                    ${(state.user.role === "admin" || state.user.role === "medecin") ? `<button class="btn btn-danger-ghost btn-sm" onclick="supprimerFacture(${f.id})">Supprimer</button>` : ""}
                  </div></td>
                </tr>`;}).join("")}
            </tbody>
          </table>
        </div>`
      : `<div class="card"><div class="empty">Aucune facture.</div></div>`;
  } catch (e) {
    body.className = "";
    body.innerHTML = `<div class="card"><div class="empty">${esc(e.message)}</div></div>`;
  }
}

async function openFactureForm(patientIdPreselectionne) {
  if (state.patients.length === 0) state.patients = await api("/api/patients");
  openModal("Nouvelle facture", `
    <form id="factureForm">
      <label>Patient *</label>
      <select id="fcPatient" required>
        <option value="">— Choisir un patient —</option>
        ${state.patients.map((p) => `<option value="${p.id}" ${String(p.id) === String(patientIdPreselectionne) ? "selected" : ""}>${esc(nomComplet(p))}</option>`).join("")}
      </select>
      <label>Désignation *</label>
      <input type="text" id="fcDesignation" placeholder="Consultation">
      <div class="form-row">
        <div><label>Montant (MDH) *</label><input type="number" id="fcMontant" step="0.01" min="0.01"></div>
        <div><label>Lié au rendez-vous n°</label><input type="number" id="fcRdv" placeholder="(optionnel)"></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer</button>
      </div>
    </form>
  `, true);

  document.getElementById("factureForm").onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      patientId: Number(document.getElementById("fcPatient").value),
      designation: document.getElementById("fcDesignation").value,
      montant: Number(document.getElementById("fcMontant").value),
      rendezvousId: document.getElementById("fcRdv").value ? Number(document.getElementById("fcRdv").value) : null
    };
    try {
      const r = await api("/api/factures", "POST", body);
      closeModal();
      toast(`Facture ${r.numero} créée.`);
      renderFactures();
    } catch (err) {
      toast(err.message, true);
    }
  };
}

async function detailFacture(id) {
  const { facture, paiements, paye } = await api(`/api/factures/${id}`);
  const reste = Math.max(0, facture.montant - paye);
  openModal(`Facture ${facture.numero}`, `
    <div class="kv">
      <div><dt>Patient</dt><dd>${esc(nomComplet(facture))}</dd></div>
      <div><dt>Désignation</dt><dd>${esc(facture.designation)}</dd></div>
      <div><dt>Montant</dt><dd>${facture.montant.toFixed(2)} MDH</dd></div>
      <div><dt>Payé / Reste</dt><dd>${paye.toFixed(2)} / ${reste.toFixed(2)} MDH</dd></div>
      <div><dt>Statut</dt><dd>${statutBadge(facture.statut)}</dd></div>
    </div>

    <h3 style="font-size:16px;margin:18px 0 8px">Paiements</h3>
    ${paiements.length
      ? `<table class="table">
           <thead><tr><th>Date</th><th>Montant</th><th>Mode</th></tr></thead>
           <tbody>${paiements.map((pm) => `<tr><td>${esc(pm.date_paiement)}</td><td>${pm.montant.toFixed(2)} MDH</td><td>${esc(pm.mode)}</td></tr>`).join("")}</tbody>
         </table>`
      : `<div class="empty" style="padding:14px">Aucun paiement.</div>`}

    ${reste > 0 ? `
      <h3 style="font-size:16px;margin:18px 0 8px">Encaisser un paiement</h3>
      <form id="paiementForm">
        <div class="form-row">
          <div><label>Montant (MDH)</label><input type="number" step="0.01" id="pmMontant" value="${reste.toFixed(2)}"></div>
          <div><label>Mode</label>
            <select id="pmMode">
              <option value="especes">Espèces</option>
              <option value="carte">Carte</option>
              <option value="cheque">Chèque</option>
              <option value="virement">Virement</option>
            </select>
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Encaisser</button>
        </div>
      </form>` : ""}
  `);

  const frm = document.getElementById("paiementForm");
  if (frm) {
    frm.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api(`/api/factures/${id}/paiement`, "POST", {
          montant: Number(document.getElementById("pmMontant").value),
          mode: document.getElementById("pmMode").value
        });
        closeModal();
        toast("Paiement enregistré.");
        if (location.hash.includes("patient/")) renderPatientDetail(Number(location.hash.split("/")[1]));
        else renderFactures();
      } catch (err) {
        toast(err.message, true);
      }
    };
  }
}

async function supprimerFacture(id) {
  if (!confirm("Supprimer cette facture et ses paiements ?")) return;
  try {
    await api(`/api/factures/${id}`, "DELETE");
    toast("Facture supprimée.");
    if (location.hash.includes("patient/")) renderPatientDetail(Number(location.hash.split("/")[1]));
    else renderFactures();
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------------------------------------------------------------
// SUIVI D'ACTIVITÉ (admin)
// ---------------------------------------------------------------

function fmtMontant(n) {
  return `${Number(n).toFixed(2).replace(".", ",")} MDH`;
}

function barrePourcent(p) {
  return `
    <div class="barre"><div class="barre-fill" style="width:${Math.min(100, Math.max(0, p))}%"></div></div>
    <span class="barre-label">${Math.round(p)}%</span>`;
}

async function renderActivite() {
  const d = await api("/api/dashboard");
  const topMotifs = d.parMotif.slice(0, 5);
  const maxMotif = topMotifs.length ? Math.max(...topMotifs.map((m) => m.n)) : 1;
  const maxJour = d.parJour.length ? Math.max(...d.parJour.map((j) => j.n)) : 1;

  view.innerHTML = `
    <div class="view-header">
      <h1>Suivi d'activité</h1>
      <div class="header-actions">
        <span class="badge badge-info">${esc(d.periode)}</span>
        <a class="btn btn-outline" href="/api/export/patients.csv" download>⬇ Patients CSV</a>
        <a class="btn btn-outline" href="/api/export/factures.csv" download>⬇ Factures CSV</a>
        <a class="btn btn-outline" href="/api/export/patients.pdf" download>⬇ Patients PDF</a>
        <a class="btn btn-outline" href="/api/export/factures.pdf" download>⬇ Factures PDF</a>
      </div>
    </div>

    <div class="cards">
      <div class="card"><div class="card-val">${fmtMontant(d.caJour)}</div><div class="card-lbl">CA du jour</div></div>
      <div class="card"><div class="card-val">${fmtMontant(d.caMois)}</div><div class="card-lbl">CA du mois</div></div>
      <div class="card"><div class="card-val">${fmtMontant(d.encaisseMois)}</div><div class="card-lbl">Encaissé (mois)</div></div>
      <div class="card"><div class="card-val">${d.rdvJour}</div><div class="card-lbl">RDV du jour</div></div>
      <div class="card"><div class="card-val">${d.rdvMois}</div><div class="card-lbl">RDV du mois</div></div>
      <div class="card"><div class="card-val">${d.tauxJour}%</div><div class="card-lbl">Taux d'occupation (jour)</div></div>
      <div class="card"><div class="card-val">${d.tauxMois}%</div><div class="card-lbl">Taux d'occupation (mois)</div></div>
      <div class="card"><div class="card-val">${d.patientsTotal}</div><div class="card-lbl">Patients au fichier</div></div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <h3>Top 5 motifs de consultation — ${esc(d.periode)}</h3>
        ${topMotifs.length
          ? topMotifs.map((m) => `
              <div class="barre-ligne">
                <span class="barre-txt">${esc(m.motif)}</span>
                <div class="barre"><div class="barre-fill barre-fill-blue" style="width:${(m.n / maxMotif) * 100}%"></div></div>
                <span class="barre-nb">${m.n}</span>
              </div>`).join("")
          : `<div class="empty">Aucun rendez-vous ce mois-ci.</div>`}
      </div>

      <div class="panel">
        <h3>Activité par médecin — ${esc(d.periode)}</h3>
        <table class="table">
          <thead><tr><th>Médecin</th><th>RDV</th><th>CA</th></tr></thead>
          <tbody>
            ${d.parMedecin.length
              ? d.parMedecin.map((m) => `<tr><td>${esc(m.medecin)}</td><td>${m.nb_rdv}</td><td>${fmtMontant(m.ca)}</td></tr>`).join("")
              : `<tr><td colspan="3"><div class="empty">Aucun rendez-vous ce mois-ci.</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h3>Nombre de rendez-vous — 14 derniers jours</h3>
      <div class="histo">
        ${d.parJour.length
          ? d.parJour.map((j) => `
              <div class="histo-col">
                <div class="histo-bar" style="height:${Math.max(2, (j.n / maxJour) * 120)}px" title="${esc(j.jour)} : ${j.n} RDV"></div>
                <span class="histo-tt">${j.n}</span>
                <span class="histo-date">${j.jour.slice(8)}</span>
              </div>`).join("")
          : `<div class="empty">Aucune donnée.</div>`}
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------
// UTILISATEURS (admin)
// ---------------------------------------------------------------

async function renderUtilisateurs() {
  view.innerHTML = `
    <div class="view-header">
      <h1>Utilisateurs / Médecins</h1>
      <div class="toolbar">
        <select id="filtreRole" style="width:auto">
          <option value="">Tous les rôles</option>
          <option value="medecin" ${state.usersFilter === "medecin" ? "selected" : ""}>Médecins</option>
          <option value="secretaire" ${state.usersFilter === "secretaire" ? "selected" : ""}>Secrétariat</option>
          <option value="admin" ${state.usersFilter === "admin" ? "selected" : ""}>Administrateurs</option>
        </select>
        <button class="btn btn-primary" onclick="openUserForm()">+ Nouvel utilisateur</button>
      </div>
    </div>
    <div id="usersBody" class="empty">Chargement…</div>
  `;
  document.getElementById("filtreRole").onchange = (e) => {
    state.usersFilter = e.target.value;
    renderUtilisateurs();
  };
  const body = document.getElementById("usersBody");
  try {
    let users = await api("/api/users");
    if (state.usersFilter) users = users.filter((u) => u.role === state.usersFilter);
    body.className = "";
    body.innerHTML = `<div class="card">
      <table class="table">
        <thead><tr><th>Nom complet</th><th>Identifiant</th><th>Rôle</th><th>Actif</th><th style="text-align:end">Actions</th></tr></thead>
        <tbody>
          ${users.map((u) => `<tr>
            <td style="font-weight:600">${esc(u.nom_complet)} ${u.id === state.user.id ? `<span class="badge confirme">vous</span>` : ""}</td>
            <td>${esc(u.username)}</td>
            <td>${esc({ admin: "Administrateur", medecin: "Médecin", secretaire: "Secrétaire" }[u.role] || u.role)}</td>
            <td>${u.actif ? `<span class="badge termine">Actif</span>` : `<span class="badge annule">Inactif</span>`}</td>
            <td><div class="actions">
              <button class="btn btn-outline btn-sm" onclick="openUserForm(${u.id})">Modifier</button>
              <button class="btn btn-outline btn-sm" onclick="toggleActifUser(${u.id}, ${u.id === state.user.id})">${u.actif ? "Désactiver" : "Activer"}</button>
              <button class="btn btn-danger-ghost btn-sm" onclick="supprimerUser(${u.id})" ${u.id === state.user.id ? "disabled title='Impossible de supprimer votre compte'" : ""}>Supprimer</button>
            </div></td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  } catch (e) {
    body.className = "";
    body.innerHTML = `<div class="card"><div class="empty">${esc(e.message)}</div></div>`;
  }
}

async function supprimerUser(id) {
  if (id === state.user.id) return toast("Vous ne pouvez pas supprimer votre propre compte.", true);
  if (!confirm("Supprimer définitivement cet utilisateur ? Ses rendez-vous, factures et ordonnances seront conservés (sans médecin rattaché).")) return;
  try {
    await api(`/api/users/${id}`, "DELETE");
    toast("Utilisateur supprimé.");
    renderUtilisateurs();
  } catch (e) {
    toast(e.message, true);
  }
}

async function openUserForm(id) {
  let u = {};
  if (id) {
    const users = await api("/api/users");
    u = users.find((x) => x.id === id) || {};
  }
  openModal(id ? "Modifier l'utilisateur" : "Nouvel utilisateur", `
    <form id="userForm">
      <div class="form-row">
        <div><label>Nom complet *</label><input type="text" id="uNom" value="${esc(u.nom_complet || "")}" required></div>
        <div><label>Identifiant ${id ? "" : "*"}</label><input type="text" id="uUsername" value="${esc(u.username || "")}" ${id ? "disabled" : "required"}></div>
      </div>
      <div class="form-row">
        <div><label>${id ? "Nouveau mot de passe (vide = inchangé)" : "Mot de passe *"}</label><input type="password" id="uPassword" ${id ? "" : "required"}></div>
        <div><label>Rôle</label>
          <select id="uRole">
            <option value="medecin" ${u.role === "medecin" ? "selected" : ""}>Médecin</option>
            <option value="secretaire" ${u.role === "secretaire" ? "selected" : ""}>Secrétaire</option>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>Administrateur</option>
          </select>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer</button>
      </div>
    </form>
  `, true);

  document.getElementById("userForm").onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      nomComplet: document.getElementById("uNom").value,
      role: document.getElementById("uRole").value,
      password: document.getElementById("uPassword").value || undefined
    };
    try {
      if (id) {
        await api(`/api/users/${id}`, "PUT", body);
      } else {
        await api("/api/users", "POST", {
          username: document.getElementById("uUsername").value,
          ...body
        });
      }
      closeModal();
      toast("Utilisateur enregistré.");
      renderUtilisateurs();
    } catch (err) {
      toast(err.message, true);
    }
  };
}

async function toggleActifUser(id, estMoi) {
  if (estMoi) return toast("Vous ne pouvez pas désactiver votre propre compte.", true);
  if (!confirm("Modifier l'état de ce compte ?")) return;
  try {
    const users = await api("/api/users");
    const u = users.find((x) => x.id === id);
    await api(`/api/users/${id}`, "PUT", { actif: !u.actif });
    toast("Utilisateur mis à jour.");
    renderUtilisateurs();
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------------------------------------------------------------
// TARIFS (admin) — grille des activités du cabinet
// ---------------------------------------------------------------

async function renderTarifs() {
  const estAdmin = state.user && state.user.role === "admin";
  view.innerHTML = `
    <div class="view-header">
      <h1>Tarifs des activités</h1>
      <div class="toolbar">
        ${estAdmin ? `<button class="btn btn-primary" onclick="openTarifForm()">+ Nouvelle activité</button>` : ""}
      </div>
    </div>
    <div id="tarifsBody" class="empty">Chargement…</div>
  `;
  const body = document.getElementById("tarifsBody");
  try {
    const tarifs = await api("/api/tarifs");
    const categories = [...new Set(tarifs.map((t) => t.categorie))].sort((a, b) => a.localeCompare(b, "fr"));
    const escN = (n) => Number(n).toFixed(2).replace(".", ",");
    body.className = "";
    body.innerHTML = categories.map((cat) => `
      <h2 class="tarif-cat">${esc(cat)}</h2>
      <div class="card">
        <table class="table">
          <thead><tr><th>Désignation</th><th>Cotation</th><th>Prix (MDH)</th>${estAdmin ? `<th style="text-align:end">Actions</th>` : ""}</tr></thead>
          <tbody>
            ${tarifs.filter((t) => t.categorie === cat).map((t) => `
              <tr class="${t.actif ? "" : "tarif-inactif"}">
                <td>${esc(t.designation)}</td>
                <td>${esc(t.cotation || "—")}</td>
                <td>${escN(t.prix)}</td>
                ${estAdmin ? `<td><div class="actions">
                  <button class="btn btn-outline btn-sm" onclick="openTarifForm(${t.id})">Modifier</button>
                  <button class="btn btn-outline btn-sm" onclick="toggleActifTarif(${t.id})">${t.actif ? "Désactiver" : "Activer"}</button>
                  <button class="btn btn-danger-ghost btn-sm" onclick="supprimerTarif(${t.id})">Supprimer</button>
                </div></td>` : ""}
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    `).join("");
  } catch (e) {
    body.className = "";
    body.innerHTML = `<div class="card"><div class="empty">${esc(e.message)}</div></div>`;
  }
}

async function openTarifForm(id) {
  let t = { categorie: "Soins", designation: "", cotation: "", prix: "" };
  if (id) {
    const tarifs = await api("/api/tarifs");
    t = tarifs.find((x) => x.id === id) || t;
  }
  openModal(id ? "Modifier l'activité" : "Nouvelle activité", `
    <form id="tarifForm">
      <div class="form-row">
        <div><label>Catégorie *</label>
          <input type="text" id="tfCategorie" list="tfCategories" value="${esc(t.categorie)}" required>
          <datalist id="tfCategories">
            <option value="Soins"><option value="Consultation"><option value="Vaccination">
            <option value="Examens"><option value="Urgences"><option value="Certificats"><option value="Actes">
          </datalist>
        </div>
        <div><label>Cotation</label><input type="text" id="tfCotation" value="${esc(t.cotation || "")}" placeholder="C, K+P, ECG…"></div>
      </div>
      <div class="form-row">
        <div><label>Désignation *</label><input type="text" id="tfDesignation" value="${esc(t.designation)}" required></div>
        <div><label>Prix (MDH) *</label><input type="number" id="tfPrix" step="0.01" min="0" value="${t.prix}"></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer</button>
      </div>
    </form>
  `, true);

  document.getElementById("tarifForm").onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      categorie: document.getElementById("tfCategorie").value.trim() || "Soins",
      designation: document.getElementById("tfDesignation").value,
      cotation: document.getElementById("tfCotation").value.trim() || null,
      prix: Number(document.getElementById("tfPrix").value)
    };
    try {
      if (id) await api(`/api/tarifs/${id}`, "PUT", body);
      else await api("/api/tarifs", "POST", body);
      closeModal();
      toast("Activité enregistrée.");
      renderTarifs();
    } catch (err) {
      toast(err.message, true);
    }
  };
}

async function toggleActifTarif(id) {
  const tarifs = await api("/api/tarifs");
  const t = tarifs.find((x) => x.id === id);
  if (!t) return;
  try {
    await api(`/api/tarifs/${id}`, "PUT", { actif: !t.actif });
    toast(t.actif ? "Activité désactivée." : "Activité réactivée.");
    renderTarifs();
  } catch (e) {
    toast(e.message, true);
  }
}

async function supprimerTarif(id) {
  if (!confirm("Supprimer définitivement cette activité du tarifaire ?")) return;
  try {
    await api(`/api/tarifs/${id}`, "DELETE");
    toast("Activité supprimée.");
    renderTarifs();
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------------------------------------------------------------
// Lancement
// ---------------------------------------------------------------

init().catch((e) => {
  console.error(e);
  window.location.href = "/login";
});