const SLOTS = [];
for (let h = 8; h <= 18; h++) {
  SLOTS.push(`${String(h).padStart(2, "0")}:00`);
  if (h < 18) SLOTS.push(`${String(h).padStart(2, "0")}:30`);
}

// Motifs avec durée automatique (consultation = 30 min, contrôle = 20 min…).
const MOTIFS = [
  { val: "Consultation", fr: "Consultation", ar: "استشارة", min: 30 },
  { val: "Contrôle", fr: "Contrôle", ar: "مراقبة", min: 20 },
  { val: "Examen", fr: "Examen", ar: "فحص", min: 45 },
  { val: "Vaccination", fr: "Vaccination", ar: "تلقيح", min: 15 },
  { val: "Suivi", fr: "Suivi", ar: "متابعة", min: 20 },
  { val: "Urgence", fr: "Urgence", ar: "حالة مستعجلة", min: 30 },
  { val: "Autre", fr: "Autre", ar: "أخرى", min: 30 }
];
const DUREES_PAR_MOTIF = Object.fromEntries(MOTIFS.map((m) => [m.val, m.min]));

const TRAD = {
  fr: {
    title: "Prendre rendez-vous — Cabinet Médical",
    cabinet: "Cabinet Médical",
    subtitle: "Prenez rendez-vous en quelques instants",
    langToggle: "العربية",
    waMessage: "Bonjour, prenez rendez-vous avec le Cabinet Médical directement en ligne : {url}",
    waShare: "Partager par WhatsApp",
    waCopy: "Copier le lien",
    waCopie: "Lien copié ✓",
    prenom: "Prénom *",
    nom: "Nom *",
    dateNaissance: "Date de naissance",
    sexe: "Sexe",
    mHomme: "Homme",
    mFemme: "Femme",
    telephone: "Téléphone *",
    email: "Email",
    medecin: "Médecin *",
    medecinPlaceholder: "Choisir un médecin…",
    medecinError: "Médecins indisponibles pour le moment",
    date: "Date *",
    heure: "Heure *",
    heureVide: "Choisir d'abord médecin et date",
    heureAbsent: "Médecin absent cette date",
    choisi: "Choisir…",
    occupe: " (occupé)",
    motif: "Objet du rendez-vous *",
    motifDefault: "Choisir…",
    duree: "Durée estimée : {min} min",
    notes: "Précisions (optionnel)",
    notesPh: "Symptômes, motif détaillé…",
    submit: "Confirmer le rendez-vous",
    envoi: "Envoi…",
    again: "Prendre un autre rendez-vous",
    hint1: "Les créneaux déjà occupés sont désactivés dans la liste des heures.",
    hint2: "Un code de confirmation vous sera envoyé par téléphone ou email : il permet d'annuler le rendez-vous en ligne.",
    staff: "Espace personnel",
    cancelLink: "Annuler un rendez-vous",
    errObligatoire: "Merci de remplir tous les champs obligatoires.",
    errAbsence: "Ce médecin est absent à cette date. Choisissez une autre date.",
    absente: "Ce médecin est absent le {d}",
    absenteMotif: " (motif : {m})",
    errReservation: "Erreur lors de la réservation.",
    success: "Demande enregistrée pour le <b>{date}</b> à <b>{heure}</b>.<br>N° de rendez-vous : <b>#{id}</b> — durée : {min} min.",
    successCode: "Code de confirmation : <b>{code}</b>",
    successByEmail: "Le code a été envoyé par email.",
    successBySms: "Le code a été envoyé par SMS.",
    cancelTitle: "Annuler un rendez-vous",
    cancelSubtitle: "Entrez le numéro de rendez-vous, votre téléphone et le code de confirmation reçu.",
    cancelRdv: "N° de rendez-vous (optionnel)",
    cancelTel: "Téléphone *",
    cancelCode: "Code de confirmation *",
    cancelBtn: "Annuler le rendez-vous",
    cancelSend: "Annulation…",
    cancelSuccess: "Votre rendez-vous du <b>{date}</b> à <b>{heure}</b> (<b>{medecin}</b>) a été <b>annulé</b>.",
    againCancel: "Annuler un autre rendez-vous",
    goBooking: "Prendre un rendez-vous"
  },

  ar: {
    title: "حجز موعد — المركز الطبي",
    cabinet: "المركز الطبي",
    subtitle: "احجز موعدك في لحظات قليلة",
    langToggle: "Français",
    waMessage: "مرحبًا، احجز موعدكم مع المركز الطبي عبر الإنترنت مباشرة : {url}",
    waShare: "مشاركة عبر واتساب",
    waCopy: "نسخ الرابط",
    waCopie: "تم نسخ الرابط ✓",
    prenom: "الاسم الأول *",
    nom: "اللقب *",
    dateNaissance: "تاريخ الميلاد",
    sexe: "الجنس",
    mHomme: "ذكر",
    mFemme: "أنثى",
    telephone: "الهاتف *",
    email: "البريد الإلكتروني",
    medecin: "الطبيب *",
    medecinPlaceholder: "اختر طبيبًا…",
    medecinError: "الأطباء غير متاحين حاليًا",
    date: "التاريخ *",
    heure: "الساعة *",
    heureVide: "اختر أولًا الطبيب والتاريخ",
    heureAbsent: "الطبيب غائب في هذا التاريخ",
    choisi: "اختر…",
    occupe: " (مشغول)",
    motif: "سبب الموعد *",
    motifDefault: "اختر…",
    duree: "المدة التقديرية : {min} دقيقة",
    notes: "تفاصيل (اختياري)",
    notesPh: "الأعراض، تفاصيل السبب…",
    submit: "تأكيد الموعد",
    envoi: "جارٍ الإرسال…",
    again: "حجز موعد آخر",
    hint1: "المواعيد المشغولة غير متاحة في قائمة الساعات.",
    hint2: "سيُرسل إليك رمز تأكيد عبر الهاتف أو البريد الإلكتروني يتيح لك إلغاء الموعد عبر الإنترنت.",
    staff: "فضاء خاص",
    cancelLink: "إلغاء موعد",
    errObligatoire: "يرجى ملء جميع الحقول الإلزامية.",
    errAbsence: "هذا الطبيب غائب في هذا التاريخ. اختر تاريخًا آخر.",
    absente: "هذا الطبيب غائب في {d}",
    absenteMotif: " (السبب : {m})",
    errReservation: "خطأ أثناء الحجز.",
    success: "تم تسجيل الموعد بتاريخ <b>{date}</b> على الساعة <b>{heure}</b>.<br>رقم الموعد : <b>#{id}</b> — المدة : {min} دقيقة.",
    successCode: "رمز التأكيد : <b>{code}</b>",
    successByEmail: "تم إرسال الرمز عبر البريد الإلكتروني.",
    successBySms: "تم إرسال الرمز عبر الرسائل النصية.",
    cancelTitle: "إلغاء موعد",
    cancelSubtitle: "أدخل رقم الموعد وهاتفك ورمز التأكيد الذي توصّلت به.",
    cancelRdv: "رقم الموعد (اختياري)",
    cancelTel: "الهاتف *",
    cancelCode: "رمز التأكيد *",
    cancelBtn: "إلغاء الموعد",
    cancelSend: "جارٍ الإلغاء…",
    cancelSuccess: "تم <b>إلغاء</b> موعدك بتاريخ <b>{date}</b> على الساعة <b>{heure}</b> (الطبيب : <b>{medecin}</b>).",
    againCancel: "إلغاء موعد آخر",
    goBooking: "حجز موعد"
  }
};

const $ = (id) => document.getElementById(id);
const state = { occupes: [], absence: null, medecinParam: null, motifParam: "" };
let lang = "fr";

function tr(key, vars) {
  let s = (TRAD[lang] && TRAD[lang][key]) || key;
  if (vars) {
    for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
  }
  return s;
}

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function dateCourte(iso) {
  const [a, m, j] = String(iso || "").split("-");
  if (!a || !m || !j) return "";
  return `${j}/${m}/${a}`;
}

function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + Number(minutes);
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------
// Langue (ar / fr)
// ---------------------------------------------------------------

function chargeLangue() {
  const saved = localStorage.getItem("rdvLang");
  lang = saved === "ar" || saved === "fr" ? saved : "fr";
}

function remplirSelects() {
  const sexe = $("sexe");
  const sv = sexe.value;
  sexe.innerHTML =
    `<option value="">—</option>` +
    `<option value="M">${tr("mHomme")}</option>` +
    `<option value="F">${tr("mFemme")}</option>`;
  sexe.value = sv;

  const motif = $("motif");
  const mv = motif.value;
  motif.innerHTML =
    `<option value="">${tr("motifDefault")}</option>` +
    MOTIFS.map((m) => `<option value="${m.val}">${lang === "ar" ? m.ar : m.fr}</option>`).join("");
  motif.value = mv || (MOTIFS.some((m) => m.val === state.motifParam) ? state.motifParam : "");
}

function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.title = tr("title");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = tr(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.placeholder = tr(el.getAttribute("data-i18n-ph"));
  });
  $("langToggle").textContent = tr("langToggle");
  remplirSelects();
  majDuree();
  if ($("medecin").value && $("date").value) chargerOccupes();
  else rendererHeures(true);
}

function basculerLangue() {
  lang = lang === "fr" ? "ar" : "fr";
  localStorage.setItem("rdvLang", lang);
  applyLang();
}

// Lien partageable : reprend l'URL courante (LAN ou tunnel) + sélections en cours.
function lienPartage() {
  const p = new URLSearchParams();
  if ($("medecin").value) p.set("medecin", $("medecin").value);
  if ($("motif").value) p.set("motif", $("motif").value);
  if (lang) p.set("lang", lang);
  const q = p.toString();
  return location.origin + location.pathname + (q ? "?" + q : "");
}

function partagerWhatsApp() {
  const url = lienPartage();
  const texte = tr("waMessage").split("{url}").join(url);
  window.open("https://api.whatsapp.com/send?text=" + encodeURIComponent(texte), "_blank", "noopener");
}

function copierLien() {
  const url = lienPartage();
  const fait = () => {
    const b = $("btnCopier");
    const original = b.textContent;
    b.textContent = tr("waCopie");
    setTimeout(() => (b.textContent = original), 2000);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(fait).catch(() => copierLienLegacy(url, fait));
  } else {
    copierLienLegacy(url, fait);
  }
}

function copierLienLegacy(url, fait) {
  const ta = document.createElement("textarea");
  ta.value = url;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    fait();
  } catch (e) { /* presse-papiers indisponible */ }
  ta.remove();
}

function appliquerParams() {
  const p = new URLSearchParams(location.search);
  const l = p.get("lang");
  if (l === "fr" || l === "ar") lang = l;
  state.medecinParam = Number(p.get("medecin")) || null;
  state.motifParam = String(p.get("motif") || "");
}

// ---------------------------------------------------------------
// Réservation
// ---------------------------------------------------------------

function init() {
  const dateInput = $("date");
  dateInput.min = todayStr();
  chargeLangue();
  appliquerParams();
  applyLang();
  chargerMedecins();

  $("medecin").addEventListener("change", chargerOccupes);
  dateInput.addEventListener("change", chargerOccupes);
  $("motif").addEventListener("change", () => {
    majDuree();
    chargerOccupes();
  });
  $("rdvForm").addEventListener("submit", soumettre);

  $("langToggle").addEventListener("click", basculerLangue);
  $("goCancel").addEventListener("click", montrerAnnulation);
  $("goBooking").addEventListener("click", montrerBooking);
  $("cancelForm").addEventListener("submit", annulerRdv);
  $("btnAgain").addEventListener("click", reinitialiserBooking);
  $("btnCancelAgain").addEventListener("click", reinitialiserAnnulation);
  $("btnWhatsApp").addEventListener("click", partagerWhatsApp);
  $("btnCopier").addEventListener("click", copierLien);
}

function majDuree() {
  const min = DUREES_PAR_MOTIF[$("motif").value];
  $("dureeInfo").textContent = min ? tr("duree", { min }) : "";
}

async function chargerMedecins() {
  try {
    const res = await fetch("/api/public/medecins");
    const medecins = await res.json().catch(() => []);
    $("medecin").innerHTML =
      `<option value="">${tr("medecinPlaceholder")}</option>` +
      medecins.map((m) => `<option value="${m.id}">${escapeHtml(m.nom_complet)}</option>`).join("");
    if (state.medecinParam && $("medecin").querySelector(`option[value="${state.medecinParam}"]`)) {
      $("medecin").value = String(state.medecinParam);
      majDuree();
      chargerOccupes();
    }
  } catch (e) {
    $("medecin").innerHTML = `<option value="">${tr("medecinError")}</option>`;
  }
}

async function chargerOccupes() {
  $("heure").value = "";
  const dispo = $("dispoMsg");
  dispo.hidden = true;
  const medecinId = Number($("medecin").value);
  const date = $("date").value;
  state.occupes = [];
  state.absence = null;
  if (!medecinId || !date) {
    rendererHeures(true);
    return;
  }
  try {
    const [occRes, absRes] = await Promise.all([
      fetch(`/api/public/occupation?medecin=${medecinId}&date=${date}`),
      fetch(`/api/public/absences?medecin=${medecinId}&debut=${date}&fin=${date}`)
    ]);
    if (occRes.ok) state.occupes = await occRes.json();
    if (absRes.ok) {
      const absences = await absRes.json();
      state.absence = absences.length ? absences[0] : null;
    }
  } catch (e) { /* créneaux pleins par défaut en cas d'erreur */ }
  if (state.absence) {
    dispo.textContent =
      tr("absente", { d: dateCourte(date) }) +
      (state.absence.motif ? tr("absenteMotif", { m: state.absence.motif }) : "") +
      ".";
    dispo.hidden = false;
  }
  rendererHeures(false);
}

function rendererHeures(toutVide) {
  const liste = $("heure");
  if (toutVide || state.absence) {
    liste.innerHTML = `<option value="">${toutVide ? tr("heureVide") : tr("heureAbsent")}</option>`;
    return;
  }
  if (state.occupes.length === 0) {
    liste.innerHTML =
      `<option value="">${tr("choisi")}</option>` +
      SLOTS.map((s) => `<option value="${s}">${s}</option>`).join("");
    return;
  }
  const duree = DUREES_PAR_MOTIF[$("motif").value] || 30;
  const occupe = (debut) => {
    const fin = addMinutes(debut, duree);
    return state.occupes.some((b) => {
      const bfin = addMinutes(b.heure, b.duree_min);
      return debut < bfin && b.heure < fin;
    });
  };
  liste.innerHTML =
    `<option value="">${tr("choisi")}</option>` +
    SLOTS.map((s) => `<option value="${s}" ${occupe(s) ? "disabled" : ""}>${s}${occupe(s) ? tr("occupe") : ""}</option>`).join("");
}

function afficherErreur(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}

async function soumettre(e) {
  e.preventDefault();
  const errEl = $("rdvError");
  errEl.hidden = true;
  const btn = document.querySelector("#rdvForm button[type=submit]");
  const body = {
    prenom: $("prenom").value,
    nom: $("nom").value,
    dateNaissance: $("dateNaissance").value || null,
    sexe: $("sexe").value || null,
    telephone: $("telephone").value,
    email: $("email").value || null,
    medecinId: Number($("medecin").value),
    date: $("date").value,
    heure: $("heure").value,
    motif: $("motif").value,
    notes: $("notes").value || null
  };
  const hp = $("siteweb");
  if (hp) body.siteweb = hp.value;
  if (!body.medecinId || !body.heure || !body.motif) {
    return afficherErreur(errEl, tr("errObligatoire"));
  }
  if (state.absence) {
    return afficherErreur(errEl, tr("errAbsence"));
  }
  btn.disabled = true;
  btn.textContent = tr("envoi");
  const t0 = Date.now();
  try {
    const res = await fetch("/api/public/rendezvous", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erreur || tr("errReservation"));
    const attente = Math.max(0, 400 - (Date.now() - t0));
    await new Promise((r) => setTimeout(r, attente));
    $("rdvForm").hidden = true;
    $("rdvResult").hidden = false;
    $("rdvSuccess").innerHTML =
      tr("success", {
        date: dateCourte(body.date),
        heure: body.heure,
        id: data.id,
        min: DUREES_PAR_MOTIF[body.motif] || 30
      }) +
      "<br><br>" +
      tr("successCode", { code: data.code }) +
      "<br>" +
      (data.canal === "email" ? tr("successByEmail") : tr("successBySms"));
  } catch (err) {
    afficherErreur(errEl, err.message);
    btn.disabled = false;
    btn.textContent = tr("submit");
  }
}

function reinitialiserBooking() {
  $("rdvForm").reset();
  $("rdvResult").hidden = true;
  $("rdvForm").hidden = false;
  $("rdvError").hidden = true;
  $("dureeInfo").textContent = "";
  rendererHeures(true);
  $("prenom").focus();
}

// ---------------------------------------------------------------
// Annulation en ligne
// ---------------------------------------------------------------

function montrerAnnulation(e) {
  if (e) e.preventDefault();
  $("bookingView").hidden = true;
  $("cancelView").hidden = false;
  reinitialiserAnnulation();
  $("cancelTel").focus();
}

function montrerBooking(e) {
  if (e) e.preventDefault();
  $("cancelView").hidden = true;
  $("bookingView").hidden = false;
}

function reinitialiserAnnulation() {
  $("cancelForm").reset();
  $("cancelResult").hidden = true;
  $("cancelError").hidden = true;
  $("cancelForm").hidden = false;
}

async function annulerRdv(e) {
  e.preventDefault();
  const errEl = $("cancelError");
  errEl.hidden = true;
  const btn = $("cancelForm").querySelector("button[type=submit]");
  const rdvId = $("cancelRdv").value.trim();
  const body = {
    telephone: $("cancelTel").value,
    code: $("cancelCode").value.trim().toUpperCase()
  };
  btn.disabled = true;
  btn.textContent = tr("cancelSend");
  try {
    const res = await fetch(`/api/public/rendezvous/${rdvId ? Number(rdvId) : 0}/annuler`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erreur || "Erreur lors de l'annulation.");
    $("cancelForm").hidden = true;
    $("cancelResult").hidden = false;
    $("cancelSuccess").innerHTML = tr("cancelSuccess", {
      date: dateCourte(data.date),
      heure: data.heure,
      medecin: data.medecin || "—"
    });
  } catch (err) {
    afficherErreur(errEl, err.message);
    btn.disabled = false;
    btn.textContent = tr("cancelBtn");
  }
}

document.addEventListener("DOMContentLoaded", init);