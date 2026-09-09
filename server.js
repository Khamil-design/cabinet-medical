const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const PDFDocument = require("pdfkit");
const path = require("node:path");
const crypto = require("node:crypto");
const db = require("./db");
const wa = require("./whatsapp");

// ---------------------------------------------------------------
// Stockage des sessions dans SQLite (persistant entre les redémarrages)
// ---------------------------------------------------------------

class SqliteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.db = database;
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS sessions (
         sid TEXT PRIMARY KEY,
         sess TEXT NOT NULL,
         expire INTEGER NOT NULL
       )`
    );
    this._purge();
    setInterval(() => this._purge(), 60 * 60 * 1000).unref();
  }

  _purge() {
    try {
      this.db.prepare("DELETE FROM sessions WHERE expire <= ?").run(Date.now());
    } catch (e) {
      console.error("[sessions] purge", e);
    }
  }

  _expire(sess) {
    const c = sess && sess.cookie;
    if (c && c.expires) return new Date(c.expires).getTime();
    if (c && c.maxAge) return Date.now() + c.maxAge;
    return Date.now() + 12 * 3600 * 1000;
  }

  get(sid, cb) {
    try {
      this._purge();
      const row = this.db.prepare("SELECT sess FROM sessions WHERE sid = ?").get(sid);
      if (!row) return cb(null, null);
      cb(null, JSON.parse(row.sess));
    } catch (e) {
      cb(e);
    }
  }

  set(sid, sess, cb) {
    try {
      const expire = this._expire(sess);
      this.db
        .prepare(
          `INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`
        )
        .run(sid, JSON.stringify(sess), expire);
      if (cb) cb(null);
    } catch (e) {
      if (cb) cb(e);
    }
  }

  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }

  destroy(sid, cb) {
    try {
      this.db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      if (cb) cb(null);
    } catch (e) {
      if (cb) cb(e);
    }
  }

  length(cb) {
    try {
      cb(null, this.db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n);
    } catch (e) {
      cb(e);
    }
  }

  clear(cb) {
    try {
      this.db.prepare("DELETE FROM sessions").run();
      if (cb) cb(null);
    } catch (e) {
      if (cb) cb(e);
    }
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(
  session({
    name: "cabinet.sid",
    secret: process.env.SESSION_SECRET || "cabinet-medical-local-secret",
    store: new SqliteSessionStore(db),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 12
    }
  })
);
app.use(express.static(path.join(__dirname, "public"), { index: false }));

// ---------------------------------------------------------------
// Aides
// ---------------------------------------------------------------

function idRequis(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ erreur: "Identifiant invalide." });
    return null;
  }
  return id;
}

function requiertAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ erreur: "Non authentifié." });
  next();
}

function role(...roles) {
  return function (req, res, next) {
    if (!req.session.user) return res.status(401).json({ erreur: "Non authentifié." });
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ erreur: "Accès refusé pour ce rôle." });
    }
    next();
  };
}

function aujourdhuiIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoPlusJours(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function horodatage() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function sexeValide(v) {
  return v === "M" || v === "F" || v == null || v === "";
}

function normaliseTel(v) {
  if (v == null || String(v).trim() === "") return null;
  let s = String(v).replace(/[\s.\-()]/g, "");
  s = s.replace(/^\+33/, "0");
  return s || null;
}

// Limitation de débit simple en mémoire (par adresse IP).
function limiter(fenetreMs, max) {
  const hits = new Map();
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || "?";
    const now = Date.now();
    const entrees = (hits.get(ip) || []).filter((t) => now - t < fenetreMs);
    if (entrees.length >= max) {
      return res.status(429).json({ erreur: "Trop de demandes. Réessayez dans quelques minutes." });
    }
    entrees.push(now);
    hits.set(ip, entrees);
    if (hits.size > 1000) {
      for (const [k, v] of hits) {
        if (v.every((t) => now - t >= fenetreMs)) hits.delete(k);
      }
    }
    next();
  };
}

// ---------------------------------------------------------------
// Authentification
// ---------------------------------------------------------------

app.post("/api/login", limiter(60 * 1000, 10), (req, res) => {
  const { username, password } = req.body || {};
  const user = db
    .prepare("SELECT * FROM users WHERE username = ? AND actif = 1")
    .get(String(username || "").trim());
  if (!user || !bcrypt.compareSync(String(password || ""), user.password_hash)) {
    return res.status(401).json({ erreur: "Identifiant ou mot de passe incorrect." });
  }
  req.session.user = {
    id: user.id,
    username: user.username,
    nomComplet: user.nom_complet,
    role: user.role
  };
  res.json({ ok: true, user: req.session.user });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  if (!req.session.user) return res.status(401).json({ erreur: "Non authentifié." });
  res.json(req.session.user);
});

// ---------------------------------------------------------------
// Médecins / utilisateurs (admin et medecin peuvent consulter ; seul admin gère)
// ---------------------------------------------------------------

app.get("/api/users", requiertAuth, (req, res) => {
  const rows = db
    .prepare("SELECT id, username, nom_complet, role, actif FROM users ORDER BY nom_complet")
    .all();
  res.json(rows);
});

app.post("/api/users", role("admin"), (req, res) => {
  const { username, password, nomComplet, role: newRole } = req.body || {};
  if (!username || !password || !nomComplet || !["admin", "medecin", "secretaire"].includes(newRole)) {
    return res.status(400).json({ erreur: "Champs incomplets ou rôle invalide." });
  }
  const existe = db.prepare("SELECT id FROM users WHERE username = ?").get(username.trim());
  if (existe) return res.status(409).json({ erreur: "Ce nom d'utilisateur existe déjà." });
  const r = db
    .prepare("INSERT INTO users (username, password_hash, nom_complet, role) VALUES (?, ?, ?, ?)")
    .run(username.trim(), bcrypt.hashSync(password, 10), nomComplet.trim(), newRole);
  res.status(201).json({ id: r.lastInsertRowid });
});

app.put("/api/users/:id", role("admin"), (req, res) => {
  const id = idRequis(req, res);
  if (!id) return;
  const { nomComplet, password, role: newRole, actif } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!user) return res.status(404).json({ erreur: "Utilisateur introuvable." });

  let q = "UPDATE users SET nom_complet = ?";
  const params = [nomComplet != null ? nomComplet : user.nom_complet];
  if (password) {
    q += ", password_hash = ?";
    params.push(bcrypt.hashSync(password, 10));
  }
  if (["admin", "medecin", "secretaire"].includes(newRole)) {
    q += ", role = ?";
    params.push(newRole);
  }
  if (typeof actif === "boolean") {
    q += ", actif = ?";
    params.push(actif ? 1 : 0);
  }
  q += " WHERE id = ?";
  params.push(id);
  db.prepare(q).run(...params);
  res.json({ ok: true });
});

app.delete("/api/users/:id", role("admin"), (req, res) => {
  const id = idRequis(req, res);
  if (!id) return;
  if (id === req.session.user.id) {
    return res.status(400).json({ erreur: "Vous ne pouvez pas supprimer votre propre compte." });
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!user) return res.status(404).json({ erreur: "Utilisateur introuvable." });
  const adminsActifs = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND actif = 1").get().n;
  if (user.role === "admin" && adminsActifs <= 1) {
    return res.status(400).json({ erreur: "Impossible de supprimer le dernier administrateur actif." });
  }
  // Références à préserver : cree_par (patients) est mis à NULL ; les autres
  // tables (rendezvous, factures, ordonnances) utilisent ON DELETE SET NULL.
  db.prepare("UPDATE patients SET cree_par = NULL WHERE cree_par = ?").run(id);
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// Patients
// ---------------------------------------------------------------

app.get("/api/patients", requiertAuth, (req, res) => {
  const terme = String(req.query.q || "").trim();
  let rows;
  if (terme) {
    rows = db
      .prepare(
        `SELECT p.*, u.nom_complet AS cree_par_nom
         FROM patients p LEFT JOIN users u ON u.id = p.cree_par
         WHERE p.nom LIKE ? OR p.prenom LIKE ? OR p.telephone LIKE ?
           OR (p.prenom || ' ' || p.nom) LIKE ?
         ORDER BY p.nom, p.prenom`
      )
      .all(`%${terme}%`, `%${terme}%`, `%${terme}%`, `%${terme}%`);
  } else {
    rows = db
      .prepare(
        `SELECT p.*, u.nom_complet AS cree_par_nom
         FROM patients p LEFT JOIN users u ON u.id = p.cree_par
         ORDER BY p.nom, p.prenom`
      )
      .all();
  }
  res.json(rows);
});

app.post("/api/patients", requiertAuth, (req, res) => {
  const { prenom, nom, dateNaissance, sexe, telephone, email, adresse, groupeSanguin, antecedents, notes } =
    req.body || {};
  if (!prenom || !nom) {
    return res.status(400).json({ erreur: "Prénom et nom sont obligatoires." });
  }
  if (!sexeValide(sexe)) return res.status(400).json({ erreur: "Sexe invalide." });
  const r = db
    .prepare(
      `INSERT INTO patients
        (prenom, nom, date_naissance, sexe, telephone, email, adresse, groupe_sanguin, antecedents, notes, cree_par)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(prenom).trim(),
      String(nom).trim(),
      dateNaissance || null,
      sexe || null,
      normaliseTel(telephone) || null,
      email || null,
      adresse || null,
      groupeSanguin || null,
      antecedents || null,
      notes || null,
      req.session.user.id
    );
  res.status(201).json({ id: r.lastInsertRowid });
});

app.put("/api/patients/:id", requiertAuth, (req, res) => {
  const id = idRequis(req, res);
  if (!id) return;
  const patient = db.prepare("SELECT * FROM patients WHERE id = ?").get(id);
  if (!patient) return res.status(404).json({ erreur: "Patient introuvable." });

  const { prenom, nom, dateNaissance, sexe, telephone, email, adresse, groupeSanguin, antecedents, notes } =
    req.body || {};
  if (!sexeValide(sexe)) return res.status(400).json({ erreur: "Sexe invalide." });

  db.prepare(
    `UPDATE patients SET
       prenom = ?, nom = ?, date_naissance = ?, sexe = ?, telephone = ?, email = ?,
       adresse = ?, groupe_sanguin = ?, antecedents = ?, notes = ?
     WHERE id = ?`
  ).run(
    String(prenom ?? patient.prenom).trim(),
    String(nom ?? patient.nom).trim(),
    dateNaissance ?? patient.date_naissance,
    sexe ?? patient.sexe,
    normaliseTel(telephone) ?? patient.telephone,
    email ?? patient.email,
    adresse ?? patient.adresse,
    groupeSanguin ?? patient.groupe_sanguin,
    antecedents ?? patient.antecedents,
    notes ?? patient.notes,
    id
  );
  res.json({ ok: true });
});

app.delete("/api/patients/:id", role("admin", "medecin"), (req, res) => {
  const id = idRequis(req, res);
  if (!id) return;
  const patient = db.prepare("SELECT id FROM patients WHERE id = ?").get(id);
  if (!patient) return res.status(404).json({ erreur: "Patient introuvable." });
  db.prepare("DELETE FROM patients WHERE id = ?").run(id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// Rendez-vous
// ---------------------------------------------------------------

function chevauche(medecinId, date, heure, duree, exclureId) {
  const debut = heure;
  const fin = addMinutes(heure, duree);
  const rows = db
    .prepare(
      `SELECT id, heure, duree_min FROM rendezvous
       WHERE medecin_id = ? AND date = ? AND statut != 'annule'
         AND (? != id)`
    )
    .all(medecinId, date, exclureId || -1);
  for (const r of rows) {
    const d2 = r.heure;
    const f2 = addMinutes(d2, r.duree_min);
    if (debut < f2 && d2 < fin) return r;
  }
  return null;
}

function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + Number(minutes);
  const H = String(Math.floor(total / 60) % 24).padStart(2, "0");
  const M = String(total % 60).padStart(2, "0");
  return `${H}:${M}`;
}

function absentMedecin(medecinId, date) {
  return (
    db
      .prepare(
        "SELECT id, motif, date_debut, date_fin FROM absences WHERE medecin_id = ? AND date_debut <= ? AND date_fin >= ?"
      )
      .get(Number(medecinId), date, date) || null
  );
}

app.get("/api/rendezvous", requiertAuth, (req, res) => {
  const { date, medecin, debut, fin, statut } = req.query;
  let q = `
    SELECT rv.*, p.nom AS patient_nom, p.prenom AS patient_prenom, p.telephone AS patient_telephone,
           u.nom_complet AS medecin_nom
    FROM rendezvous rv
    JOIN patients p ON p.id = rv.patient_id
    LEFT JOIN users u ON u.id = rv.medecin_id
  `;
  const conds = [];
  const params = [];
  if (date) {
    conds.push("rv.date = ?");
    params.push(date);
  }
  if (debut) {
    conds.push("rv.date >= ?");
    params.push(debut);
  }
  if (fin) {
    conds.push("rv.date <= ?");
    params.push(fin);
  }
  if (medecin) {
    conds.push("rv.medecin_id = ?");
    params.push(Number(medecin));
  }
  if (statut) {
    conds.push("rv.statut = ?");
    params.push(statut);
  }
  if (conds.length) q += " WHERE " + conds.join(" AND ");
  q += " ORDER BY rv.date, rv.heure";
  res.json(db.prepare(q).all(...params));
});

app.post("/api/rendezvous", requiertAuth, (req, res) => {
  const { patientId, medecinId, date, heure, dureeMin, motif, statut, notes } = req.body || {};
  if (!patientId || !date || !heure) {
    return res.status(400).json({ erreur: "Patient, date et heure sont obligatoires." });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(heure)) {
    return res.status(400).json({ erreur: "Date ou heure invalide." });
  }
  const duree = Number(dureeMin) > 0 ? Number(dureeMin) : 30;
  const patient = db.prepare("SELECT id FROM patients WHERE id = ?").get(Number(patientId));
  if (!patient) return res.status(404).json({ erreur: "Patient introuvable." });
  const medecin = db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('medecin','admin')").get(Number(medecinId));
  if (!medecin) return res.status(400).json({ erreur: "Médecin invalide." });

  const absence = absentMedecin(medecinId, date);
  if (absence) {
    return res.status(409).json({
      erreur: `Ce médecin est absent du ${absence.date_debut} au ${absence.date_fin}${absence.motif ? " (" + absence.motif + ")" : ""}. Choisissez une autre date.`
    });
  }

  const conflit = chevauche(Number(medecinId), date, heure, duree, null);
  if (conflit) {
    return res.status(409).json({
      erreur: `Créneau occupé par le rendez-vous #${conflit.id} (${conflit.heure}, ${conflit.duree_min} min).`
    });
  }
  const r = db
    .prepare(
      `INSERT INTO rendezvous (patient_id, medecin_id, date, heure, duree_min, motif, statut, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(Number(patientId), Number(medecinId), date, heure, duree, motif || null, statut || "planifie", notes || null);
  res.status(201).json({ id: r.lastInsertRowid });
});

app.put("/api/rendezvous/:id", requiertAuth, (req, res) => {
  const id = idRequis(req, res);
  if (!id) return;
  const rv = db.prepare("SELECT * FROM rendezvous WHERE id = ?").get(id);
  if (!rv) return res.status(404).json({ erreur: "Rendez-vous introuvable." });

  const { date, heure, dureeMin, motif, notes, statut, medecinId } = req.body || {};
  const nouvelleDate = date || rv.date;
  const nouvelleHeure = heure || rv.heure;
  const nouvelleDuree = Number(dureeMin) > 0 ? Number(dureeMin) : rv.duree_min;
  const nouveauMedecin = medecinId ? Number(medecinId) : rv.medecin_id;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(nouvelleDate) || !/^\d{2}:\d{2}$/.test(nouvelleHeure)) {
    return res.status(400).json({ erreur: "Date ou heure invalide." });
  }
  if (statut && !["planifie", "confirme", "termine", "annule"].includes(statut)) {
    return res.status(400).json({ erreur: "Statut invalide." });
  }
  const absence = absentMedecin(nouveauMedecin, nouvelleDate);
  if (absence) {
    return res.status(409).json({
      erreur: `Ce médecin est absent du ${absence.date_debut} au ${absence.date_fin}${absence.motif ? " (" + absence.motif + ")" : ""}. Choisissez une autre date.`
    });
  }
  const conflit = chevauche(nouveauMedecin, nouvelleDate, nouvelleHeure, nouvelleDuree, id);
  if (conflit) {
    return res.status(409).json({
      erreur: `Créneau occupé par le rendez-vous #${conflit.id} (${conflit.heure}, ${conflit.duree_min} min).`
    });
  }
  db.prepare(
    `UPDATE rendezvous SET date = ?, heure = ?, duree_min = ?, motif = ?, notes = ?,
       statut = ?, medecin_id = ? WHERE id = ?`
  ).run(
    nouvelleDate,
    nouvelleHeure,
    nouvelleDuree,
    motif !== undefined ? motif : rv.motif,
    notes !== undefined ? notes : rv.notes,
    statut || rv.statut,
    nouveauMedecin,
    id
  );
  res.json({ ok: true });
});

app.delete("/api/rendezvous/:id", requiertAuth, (req, res) => {
  const id = idRequis(req, res);
  if (!id) return;
  const rv = db.prepare("SELECT id FROM rendezvous WHERE id = ?").get(id);
  if (!rv) return res.status(404).json({ erreur: "Rendez-vous introuvable." });
  db.prepare("DELETE FROM rendezvous WHERE id = ?").run(id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// Absences / congés des médecins
// ---------------------------------------------------------------

app.get("/api/absences", requiertAuth, (req, res) => {
  const { debut, fin, medecin } = req.query;
  let q = `
    SELECT a.*, u.nom_complet AS medecin_nom
    FROM absences a
    LEFT JOIN users u ON u.id = a.medecin_id
  `;
  const conds = [];
  const params = [];
  if (medecin) {
    conds.push("a.medecin_id = ?");
    params.push(Number(medecin));
  }
  if (debut) {
    conds.push("a.date_fin >= ?");
    params.push(debut);
  }
  if (fin) {
    conds.push("a.date_debut <= ?");
    params.push(fin);
  }
  if (conds.length) q += " WHERE " + conds.join(" AND ");
  q += " ORDER BY a.date_debut";
  res.json(db.prepare(q).all(...params));
});

app.post("/api/absences", role("medecin", "admin"), (req, res) => {
  const { medecinId, dateDebut, dateFin, motif } = req.body || {};
  if (!medecinId || !dateDebut || !dateFin) {
    return res.status(400).json({ erreur: "Médecin et dates sont obligatoires." });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDebut) || !/^\d{4}-\d{2}-\d{2}$/.test(dateFin)) {
    return res.status(400).json({ erreur: "Dates invalides." });
  }
  if (dateFin < dateDebut) {
    return res.status(400).json({ erreur: "La date de fin doit être après celle du début." });
  }
  const medecin = db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('medecin','admin')").get(Number(medecinId));
  if (!medecin) return res.status(400).json({ erreur: "Médecin invalide." });
  const r = db
    .prepare("INSERT INTO absences (medecin_id, date_debut, date_fin, motif, cree_par) VALUES (?, ?, ?, ?, ?)")
    .run(Number(medecinId), dateDebut, dateFin, motif || null, req.session.user.id);
  res.status(201).json({ id: r.lastInsertRowid });
});

app.delete("/api/absences/:id", role("medecin", "admin"), (req, res) => {
  const id = idRequis(req, res);
  if (!id) return;
  const abs = db.prepare("SELECT id FROM absences WHERE id = ?").get(id);
  if (!abs) return res.status(404).json({ erreur: "Absence introuvable." });
  db.prepare("DELETE FROM absences WHERE id = ?").run(id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// Rappels de rendez-vous (générés automatiquement, envoi simulé)
// ---------------------------------------------------------------

// Recherche les rendez-vous de demain ou après-demain (statut planifié ou
// confirmé) et crée un rappel pour chacun s'il n'en existe pas déjà.
function genererRappels() {
  const cibles = [isoPlusJours(aujourdhuiIso(), 1), isoPlusJours(aujourdhuiIso(), 2)];
  const rvs = db
    .prepare(
      `SELECT rv.id, rv.patient_id, rv.medecin_id, p.email
       FROM rendezvous rv
       JOIN patients p ON p.id = rv.patient_id
       WHERE rv.date IN (?, ?) AND rv.statut IN ('planifie', 'confirme')`
    )
    .all(...cibles);
  const existe = (id) => db.prepare("SELECT 1 FROM rappels WHERE rendezvous_id = ?").get(id);
  const inserer = (rdvId, patientId, medecinId, type) =>
    db
      .prepare("INSERT INTO rappels (rendezvous_id, patient_id, medecin_id, type) VALUES (?, ?, ?, ?)")
      .run(rdvId, patientId, medecinId, type);
  let n = 0;
  for (const rv of rvs) {
    if (existe(rv.id)) continue;
    inserer(rv.id, rv.patient_id, rv.medecin_id, rv.email ? "email" : "sms");
    n++;
  }
  return n;
}

app.get("/api/rappels", requiertAuth, (req, res) => {
  const { envoye } = req.query;
  let q = `
    SELECT r.*,
           rv.date AS rdv_date, rv.heure AS rdv_heure, rv.motif AS rdv_motif, rv.statut AS rdv_statut,
           u.nom_complet AS medecin_nom,
           p.nom AS patient_nom, p.prenom AS patient_prenom,
           p.telephone AS patient_telephone, p.email AS patient_email
    FROM rappels r
    JOIN rendezvous rv ON rv.id = r.rendezvous_id
    JOIN patients p ON p.id = r.patient_id
    LEFT JOIN users u ON u.id = r.medecin_id
  `;
  if (envoye === "0" || envoye === "1") q += ` WHERE r.envoye = ${Number(envoye)}`;
  const sens = envoye === "1" ? "DESC" : "ASC";
  q += ` ORDER BY rv.date ${sens}, rv.heure ${sens}`;
  res.json(db.prepare(q).all());
});

app.post("/api/rappels/generer", role("admin", "medecin", "secretaire"), (req, res) => {
  const n = genererRappels();
  res.json({ generes: n });
});

app.post("/api/rappels/envoyer-tous", role("admin", "medecin", "secretaire"), (req, res) => {
  const up = db
    .prepare("UPDATE rappels SET envoye = 1, envoye_le = ? WHERE envoye = 0")
    .run(horodatage());
  res.json({ envoyes: up.changes });
});

app.post("/api/rappels/:id/envoyer", role("admin", "medecin", "secretaire"), (req, res) => {
  const id = idRequis(req, res);
  if (!id) return;
  const rappel = db.prepare("SELECT id FROM rappels WHERE id = ?").get(id);
  if (!rappel) return res.status(404).json({ erreur: "Rappel introuvable." });
  db.prepare("UPDATE rappels SET envoye = 1, envoye_le = ? WHERE id = ?").run(horodatage(), id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// Facturation
// ---------------------------------------------------------------

function numeroFacture() {
  const annee = new Date().getFullYear();
  const row = db
    .prepare("SELECT numero FROM factures WHERE numero LIKE ? ORDER BY numero DESC LIMIT 1")
    .get(`F-${annee}-%`);
  const dernier = row ? Number(row.numero.split("-")[2]) : 0;
  return `F-${annee}-${String(dernier + 1).padStart(4, "0")}`;
}

function majStatut(factureId) {
  const total = db.prepare("SELECT COALESCE(SUM(montant),0) AS s FROM paiements WHERE facture_id = ?").get(factureId).s;
  const f = db.prepare("SELECT montant FROM factures WHERE id = ?").get(factureId);
  let statut = "impayee";
  if (total >= f.montant) statut = "payee";
  else if (total > 0) statut = "partielle";
  db.prepare("UPDATE factures SET statut = ? WHERE id = ?").run(statut, factureId);
  return statut;
}

app.get("/api/factures", requiertAuth, (req, res) => {
  const { statut, patient } = req.query;
  let q = `
    SELECT f.*, p.nom AS patient_nom, p.prenom AS patient_prenom,
           u.nom_complet AS medecin_nom,
           (SELECT COALESCE(SUM(montant),0) FROM paiements WHERE facture_id = f.id) AS paye
    FROM factures f
    JOIN patients p ON p.id = f.patient_id
    LEFT JOIN users u ON u.id = f.medecin_id
  `;
  const conds = [];
  const params = [];
  if (statut) {
    conds.push("f.statut = ?");
    params.push(statut);
  }
  if (patient) {
    conds.push("f.patient_id = ?");
    params.push(Number(patient));
  }
  if (conds.length) q += " WHERE " + conds.join(" AND ");
  q += " ORDER BY f.cree_le DESC, f.id DESC";
  res.json(db.prepare(q).all(...params));
});

app.post("/api/factures", requiertAuth, (req, res) => {
  const { patientId, rendezvousId, designation, montant } = req.body || {};
  if (!patientId || !designation || !(Number(montant) > 0)) {
    return res.status(400).json({ erreur: "Patient, désignation et montant sont obligatoires." });
  }
  const patient = db.prepare("SELECT id FROM patients WHERE id = ?").get(Number(patientId));
  if (!patient) return res.status(404).json({ erreur: "Patient introuvable." });
  let numero = numeroFacture();
  while (db.prepare("SELECT id FROM factures WHERE numero = ?").get(numero)) {
    numero = numeroFacture();
  }
  const r = db
    .prepare(
      `INSERT INTO factures (numero, patient_id, medecin_id, rendezvous_id, designation, montant, statut)
       VALUES (?, ?, ?, ?, ?, ?, 'impayee')`
    )
    .run(numero, Number(patientId), req.session.user.role === "medecin" || req.session.user.role === "admin" ? req.session.user.id : null, rendezvousId || null, String(designation).trim(), Number(montant));
  res.status(201).json({ id: r.lastInsertRowid, numero });
});

app.get("/api/factures/:id", requiertAuth, (req, res) => {
  const id = idRequis(req, res);
  if (!id) return;
  const f = db
    .prepare(
      `SELECT f.*, p.nom AS patient_nom, p.prenom AS patient_prenom, u.nom_complet AS medecin_nom
       FROM factures f
       JOIN patients p ON p.id = f.patient_id
       LEFT JOIN users u ON u.id = f.medecin_id
       WHERE f.id = ?`
    )
    .get(id);
  if (!f) return res.status(404).json({ erreur: "Facture introuvable." });
  const paiements = db.prepare("SELECT * FROM paiements WHERE facture_id = ? ORDER BY date_paiement, id").all(id);
  res.json({ facture: f, paiements, paye: paiements.reduce((s, p) => s + p.montant, 0) });
});

app.post("/api/factures/:id/paiement", requiertAuth, (req, res) => {
  const id = idRequis(req, res);
  if (!id) return;
  const { montant, mode, datePaiement } = req.body || {};
  const m = Number(montant);
  if (!(m > 0)) return res.status(400).json({ erreur: "Montant invalide." });
  if (!["especes", "carte", "cheque", "virement"].includes(mode || "especes")) {
    return res.status(400).json({ erreur: "Mode de paiement invalide." });
  }
  const f = db.prepare("SELECT * FROM factures WHERE id = ?").get(id);
  if (!f) return res.status(404).json({ erreur: "Facture introuvable." });
  const paye = db.prepare("SELECT COALESCE(SUM(montant),0) AS s FROM paiements WHERE facture_id = ?").get(id).s;
  if (paye + m > f.montant + 0.001) {
    return res.status(400).json({ erreur: "Le total des paiements dépasse le montant de la facture." });
  }
  db.prepare("INSERT INTO paiements (facture_id, montant, mode, date_paiement) VALUES (?, ?, ?, ?)").run(
    id,
    m,
    mode || "especes",
    /^\d{4}-\d{2}-\d{2}$/.test(datePaiement || "") ? datePaiement : new Date().toISOString().slice(0, 10)
  );
  const statut = majStatut(id);
  res.status(201).json({ ok: true, statut });
});

app.delete("/api/factures/:id", role("admin", "medecin"), (req, res) => {
  const id = idRequis(req, res);
  if (!id) return;
  const f = db.prepare("SELECT id FROM factures WHERE id = ?").get(id);
  if (!f) return res.status(404).json({ erreur: "Facture introuvable." });
  db.prepare("DELETE FROM factures WHERE id = ?").run(id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// Ordonnances
// ---------------------------------------------------------------

app.get("/api/patients/:id/ordonnances", requiertAuth, (req, res) => {
  const id = idRequis(req, res);
  if (!id) return;
  const rows = db
    .prepare(
      `SELECT o.*, u.nom_complet AS medecin_nom,
              (SELECT COUNT(*) FROM ordonnance_items oi WHERE oi.ordonnance_id = o.id) AS nb_items
       FROM ordonnances o LEFT JOIN users u ON u.id = o.medecin_id
       WHERE o.patient_id = ? ORDER BY o.date DESC, o.id DESC`
    )
    .all(id);
  res.json(rows);
});

app.get("/api/ordonnances/:id", requiertAuth, (req, res) => {
  const id = idRequis(req, res);
  if (!id) return;
  const o = db
    .prepare(
      `SELECT o.*, p.prenom, p.nom, p.date_naissance, u.nom_complet AS medecin_nom
       FROM ordonnances o
       JOIN patients p ON p.id = o.patient_id
       LEFT JOIN users u ON u.id = o.medecin_id
       WHERE o.id = ?`
    )
    .get(id);
  if (!o) return res.status(404).json({ erreur: "Ordonnance introuvable." });
  const items = db
    .prepare("SELECT * FROM ordonnance_items WHERE ordonnance_id = ? ORDER BY id")
    .all(id);
  res.json({ ordonnance: o, items });
});

app.post("/api/ordonnances", role("medecin", "admin"), (req, res) => {
  const { patientId, rendezvousId, notes, items } = req.body || {};
  if (!patientId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ erreur: "Patient et au moins un médicament sont obligatoires." });
  }
  const patient = db.prepare("SELECT id FROM patients WHERE id = ?").get(Number(patientId));
  if (!patient) return res.status(404).json({ erreur: "Patient introuvable." });

  const r = db
    .prepare("INSERT INTO ordonnances (patient_id, medecin_id, rendezvous_id, notes) VALUES (?, ?, ?, ?)")
    .run(Number(patientId), req.session.user.id, rendezvousId || null, notes || null);
  const ordoId = Number(r.lastInsertRowid);
  const ins = db.prepare(
    "INSERT INTO ordonnance_items (ordonnance_id, medicament, posologie, duree) VALUES (?, ?, ?, ?)"
  );
  for (const it of items) {
    if (!it.medicament) continue;
    ins.run(ordoId, String(it.medicament).trim(), it.posologie || null, it.duree || null);
  }
  res.status(201).json({ id: ordoId });
});

app.delete("/api/ordonnances/:id", role("medecin", "admin"), (req, res) => {
  const id = idRequis(req, res);
  if (!id) return;
  const o = db.prepare("SELECT id FROM ordonnances WHERE id = ?").get(id);
  if (!o) return res.status(404).json({ erreur: "Ordonnance introuvable." });
  db.prepare("DELETE FROM ordonnances WHERE id = ?").run(id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// Suivi d'activité (tableau de bord admin)
// ---------------------------------------------------------------

const SLOTS_PAR_JOUR = 21; // créneaux de 30 min/médecin/jour (08:00 → 18:30)

function moisCourant() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function libelleMois(mois) {
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(new Date(mois + "-01T00:00:00"));
}

function nbJoursOuvresMois(mois) {
  const [a, m] = mois.split("-").map(Number);
  const jours = new Date(a, m, 0).getDate();
  let n = 0;
  for (let j = 1; j <= jours; j++) {
    const dow = new Date(a, m - 1, j).getDay();
    if (dow >= 1 && dow <= 5) n++;
  }
  return n;
}

app.get("/api/dashboard", role("admin"), (req, res) => {
  const auj = aujourdhuiIso();
  const mois = moisCourant();
  const un = (q, ...p) => db.prepare(q).get(...p);

  const caJour = un("SELECT COALESCE(SUM(montant),0) AS s FROM factures WHERE date(cree_le) = date('now','localtime')").s;
  const caMois = un("SELECT COALESCE(SUM(montant),0) AS s FROM factures WHERE cree_le LIKE ?", mois + "-%").s;
  const encaisseJour = un("SELECT COALESCE(SUM(montant),0) AS s FROM paiements WHERE date(date_paiement) = date('now')").s;
  const encaisseMois = un("SELECT COALESCE(SUM(montant),0) AS s FROM paiements WHERE date_paiement LIKE ?", mois + "-%").s;
  const rdvJour = un("SELECT COUNT(*) AS n FROM rendezvous WHERE date = ?", auj).n;
  const rdvMois = un("SELECT COUNT(*) AS n FROM rendezvous WHERE date LIKE ?", mois + "-%").n;
  const patientsTotal = un("SELECT COUNT(*) AS n FROM patients").n;
  const medecinsActifs = un("SELECT COUNT(*) AS n FROM users WHERE role = 'medecin' AND actif = 1").n;

  const ouvresMois = nbJoursOuvresMois(mois);
  const tauxJour = medecinsActifs ? Math.round((rdvJour / (medecinsActifs * SLOTS_PAR_JOUR)) * 100) : 0;
  const tauxMois = medecinsActifs && ouvresMois ? Math.round((rdvMois / (medecinsActifs * ouvresMois * SLOTS_PAR_JOUR)) * 100) : 0;

  const parMotif = db
    .prepare(
      "SELECT COALESCE(NULLIF(TRIM(motif), ''), 'Consultation') AS motif, COUNT(*) AS n FROM rendezvous WHERE date LIKE ? GROUP BY motif ORDER BY n DESC LIMIT 10"
    )
    .all(mois + "-%");

  const parMedecin = db
    .prepare(
      `SELECT COALESCE(u.nom_complet, '—') AS medecin, COUNT(rv.id) AS nb_rdv,
              (SELECT COALESCE(SUM(montant),0) FROM factures f
               WHERE f.medecin_id = rv.medecin_id AND f.cree_le LIKE ?) AS ca
       FROM rendezvous rv
       LEFT JOIN users u ON u.id = rv.medecin_id
       WHERE rv.date LIKE ?
       GROUP BY rv.medecin_id
       ORDER BY nb_rdv DESC`
    )
    .all(mois + "-%", mois + "-%");

  const parJour = db
    .prepare(
      "SELECT date AS jour, COUNT(*) AS n FROM rendezvous WHERE date >= date('now','localtime','-13 days') AND date <= date('now','localtime') GROUP BY date ORDER BY date"
    )
    .all();

  res.json({
    periode: libelleMois(mois),
    caJour,
    caMois,
    encaisseJour,
    encaisseMois,
    rdvJour,
    rdvMois,
    patientsTotal,
    medecinsActifs,
    ouvresMois,
    tauxJour,
    tauxMois,
    parMotif,
    parMedecin,
    parJour
  });
});

// ---------------------------------------------------------------
// Exports CSV / PDF
// ---------------------------------------------------------------

function celluleCSV(v) {
  const s = String(v ?? "");
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function envoyerCSV(res, nom, lignes) {
  res.set({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${nom}"`
  });
  res.send("\uFEFF" + lignes.map((l) => l.map(celluleCSV).join(";")).join("\r\n"));
}

app.get("/api/export/patients.csv", role("admin"), (req, res) => {
  const rows = db.prepare("SELECT * FROM patients ORDER BY nom, prenom").all();
  const lignes = [["ID", "Prénom", "Nom", "Naissance", "Sexe", "Téléphone", "Email", "Adresse", "Groupe sanguin", "Antécédents", "Créé le"]];
  rows.forEach((p) =>
    lignes.push([
      p.id,
      p.prenom,
      p.nom,
      p.date_naissance || "",
      p.sexe || "",
      p.telephone || "",
      p.email || "",
      p.adresse || "",
      p.groupe_sanguin || "",
      p.antecedents || "",
      p.cree_le || ""
    ])
  );
  envoyerCSV(res, "patients.csv", lignes);
});

app.get("/api/export/factures.csv", role("admin"), (req, res) => {
  const rows = db
    .prepare(
      `SELECT f.*, p.prenom AS patient_prenom, p.nom AS patient_nom, u.nom_complet AS medecin_nom,
              (SELECT COALESCE(SUM(montant),0) FROM paiements WHERE facture_id = f.id) AS paye
       FROM factures f
       JOIN patients p ON p.id = f.patient_id
       LEFT JOIN users u ON u.id = f.medecin_id
       ORDER BY f.cree_le DESC`
    )
    .all();
  const dec = (n) => String(Number(n).toFixed(2)).replace(".", ",");
  const lignes = [["ID", "N°", "Date", "Patient", "Médecin", "Désignation", "Montant", "Payé", "Reste", "Statut"]];
  rows.forEach((f) =>
    lignes.push([
      f.id,
      f.numero,
      (f.cree_le || "").split(" ")[0],
      `${f.patient_prenom} ${f.patient_nom}`,
      f.medecin_nom || "",
      f.designation,
      dec(f.montant),
      dec(f.paye),
      dec(Math.max(0, f.montant - f.paye)),
      f.statut
    ])
  );
  envoyerCSV(res, "factures.csv", lignes);
});

function envoyerPDF(res, nom, build) {
  const doc = new PDFDocument({ size: "A4", margin: 48 });
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${nom}"`
  });
  doc.pipe(res);
  build(doc);
  doc.end();
}

function entetePDF(doc, titre) {
  doc.font("Helvetica-Bold").fontSize(15).fillColor("#1c2b31").text("Cabinet Médical", 48, 48);
  doc.font("Helvetica").fontSize(9).fillColor("#666");
  doc.text(`Généré le ${new Intl.DateTimeFormat("fr-FR").format(new Date())}`, 350, 50, { width: 202, align: "right" });
  doc.moveDown(1);
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#1c2b31").text(titre);
  doc.moveTo(48, doc.y).lineTo(552, doc.y).stroke("#bbb");
  doc.moveDown(0.8);
}

function tablePDF(doc, cols, rows) {
  const gauche = 48;
  const largeur = 504;
  const w = largeur / cols.length;
  const dessinerEnTete = () => {
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#1c2b31");
    cols.forEach((c, i) => doc.text(c, gauche + i * w, doc.y, { width: w - 4 }));
    const yl = doc.y + 2;
    doc.moveTo(gauche, yl).lineTo(gauche + largeur, yl).stroke("#999");
    doc.y = yl + 4;
  };
  dessinerEnTete();
  doc.font("Helvetica").fontSize(8.5).fillColor("#222");
  for (const r of rows) {
    if (doc.y > 720) {
      doc.addPage();
      doc.y = 48;
      dessinerEnTete();
    }
    const yRow = doc.y;
    const h = Math.max(...cols.map((c, i) => doc.heightOfString(String(r[i] ?? ""), { width: w - 4 })), 12);
    cols.forEach((c, i) => doc.text(String(r[i] ?? ""), gauche + i * w, yRow, { width: w - 4 }));
    doc.y = yRow + h + 5;
  }
}

app.get("/api/export/patients.pdf", role("admin"), (req, res) => {
  const rows = db.prepare("SELECT prenom, nom, date_naissance, telephone, email FROM patients ORDER BY nom, prenom").all();
  envoyerPDF(res, "patients.pdf", (doc) => {
    entetePDF(doc, `Liste des patients (${rows.length})`);
    tablePDF(doc, ["Prénom", "Nom", "Naissance", "Téléphone", "Email"], rows.map((p) => [p.prenom, p.nom, p.date_naissance || "", p.telephone || "", p.email || ""]));
  });
});

app.get("/api/export/factures.pdf", role("admin"), (req, res) => {
  const rows = db
    .prepare(
      `SELECT f.numero, f.cree_le, f.designation, f.montant, f.statut,
              p.prenom AS patient_prenom, p.nom AS patient_nom, u.nom_complet AS medecin_nom
       FROM factures f
       JOIN patients p ON p.id = f.patient_id
       LEFT JOIN users u ON u.id = f.medecin_id
       ORDER BY f.cree_le DESC`
    )
    .all();
  const total = rows.reduce((s, f) => s + f.montant, 0);
  const dec = (n) => n.toFixed(2).replace(".", ",");
  envoyerPDF(res, "factures.pdf", (doc) => {
    entetePDF(doc, `Factures (${rows.length}) — total ${dec(total)} MDH`);
    tablePDF(doc, ["N°", "Date", "Patient", "Médecin", "Désignation", "Montant", "Statut"], rows.map((f) => [f.numero, (f.cree_le || "").split(" ")[0], `${f.patient_prenom} ${f.patient_nom}`, f.medecin_nom || "", f.designation, `${dec(f.montant)} MDH`, f.statut]));
  });
});

app.get("/api/export/feuille-de-soins.pdf", role("admin", "medecin", "secretaire"), (req, res) => {
  const patientId = Number(req.query.patient);
  const patient = db.prepare("SELECT * FROM patients WHERE id = ?").get(Number.isInteger(patientId) && patientId > 0 ? patientId : 0);
  if (!patient) return res.status(404).json({ erreur: "Patient introuvable." });
  const facture = db
    .prepare(
      `SELECT f.*, u.nom_complet AS medecin_nom
       FROM factures f LEFT JOIN users u ON u.id = f.medecin_id
       WHERE f.patient_id = ? ORDER BY f.cree_le DESC LIMIT 1`
    )
    .get(patient.id);

  envoyerPDF(res, `feuille-de-soins-${patient.nom}.pdf`, (doc) => {
    const L = 48;
    const W = 504;
    const boite = (titre, lignes, x, w, y) => {
      doc.rect(x, y, w, 18).fill("#eef2f2").stroke("#333");
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#1c2b31").text(titre, x + 6, y + 5, { width: w - 12 });
      const yy = y + 18;
      doc.rect(x, yy, w, lignes.length * 12 + 6).stroke("#333");
      doc.font("Helvetica").fontSize(9.5).fillColor("#222");
      lignes.forEach((lg, i) => doc.text(lg, x + 6, yy + 3 + i * 12, { width: w - 12 }));
      return yy + lignes.length * 12 + 10;
    };

    doc.font("Helvetica-Bold").fontSize(20).fillColor("#1c2b31").text("FEUILLE DE SOINS", L, 48, { width: W, align: "center" });
    doc.font("Helvetica").fontSize(10).fillColor("#666").text("Cabinet de médecine générale", L, 74, { width: W, align: "center" });

    const yCab = boite("1. CABINET MÉDICAL", ["Cabinet Médical", "12 rue des Lauriers, 75011 Paris", "Tél : 01 23 45 67 89", "N° RPS : 10102589652"], L, 240, 108);
    const lignePatient = [
      `Assuré(e) : ${patient.prenom} ${patient.nom}`,
      patient.date_naissance ? `Né(e) le ${patient.date_naissance}` : "",
      [patient.sexe === "M" ? "Sexe : M" : patient.sexe === "F" ? "Sexe : F" : "", patient.groupe_sanguin ? `GS : ${patient.groupe_sanguin}` : ""].filter(Boolean).join(" · "),
      patient.adresse || "Adresse : —",
      patient.telephone ? `Tél : ${patient.telephone}` : ""
    ].filter(Boolean);
    const yPat = boite("2. ASSURÉ(E)", lignePatient, L + 264, 240, 108);

    doc.y = Math.max(yCab, yPat) + 8;
    const statutFacture = facture ? (facture.statut === "payee" ? "réglé" : facture.statut === "partielle" ? "règlement partiel" : "à régler") : "";
    const acteLignes = facture
      ? [
          `Acte : ${facture.designation}`,
          `Date : ${facture.cree_le ? facture.cree_le.split(" ")[0] : "—"} · Cotation : C`,
          `Montant : ${facture.montant.toFixed(2).replace(".", ",")} MDH · Règlement : ${statutFacture}`,
          `Médecin : ${facture.medecin_nom || "—"}`
        ]
      : ["Aucun acte facturé pour ce patient."];
    doc.y = boite("3. ACTE(S) RÉALISÉ(S)", acteLignes, L, W, doc.y);

    doc.moveDown(1.4);
    doc.font("Helvetica").fontSize(9).fillColor("#333");
    const ySign = doc.y;
    doc.text("Je certifie exactes les informations ci-dessus et reconnais avoir reçu les soins.", L, ySign, { width: W });
    doc.text("Signature du patient : ______________________________", L, doc.y + 10, { width: W / 2 });
    doc.text("Signature et cachet du praticien : ______________________________", L + W / 2, doc.y - 14, { width: W / 2 });
  });
});

// ---------------------------------------------------------------
// Tarifs (grille des activités du cabinet, prix réglables par l'admin)
// ---------------------------------------------------------------

// Lecture : tous les rôles connectés. Écriture : admin uniquement.
app.get("/api/tarifs", requiertAuth, (req, res) => {
  const inclureInactifs = req.session.user.role === "admin";
  const rows = db
    .prepare(
      `SELECT id, categorie, designation, cotation, prix, actif
       FROM tarifs
       ${inclureInactifs ? "" : "WHERE actif = 1"}
       ORDER BY categorie, designation`
    )
    .all();
  res.json(rows);
});

app.post("/api/tarifs", role("admin"), (req, res) => {
  const { categorie, designation, cotation, prix } = req.body || {};
  if (!designation || String(designation).trim() === "") {
    return res.status(400).json({ erreur: "La désignation est obligatoire." });
  }
  const prixN = Number(prix);
  if (!Number.isFinite(prixN) || prixN < 0) {
    return res.status(400).json({ erreur: "Prix invalide." });
  }
  try {
    const r = db
      .prepare("INSERT INTO tarifs (categorie, designation, cotation, prix) VALUES (?, ?, ?, ?)")
      .run(String(categorie || "Soins").trim(), String(designation).trim(), (cotation || null), prixN);
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return res.status(409).json({ erreur: "Cette désignation existe déjà." });
    }
    throw e;
  }
});

app.put("/api/tarifs/:id", role("admin"), (req, res) => {
  const id = idRequis(req, res);
  if (!id) return;
  const tarif = db.prepare("SELECT * FROM tarifs WHERE id = ?").get(id);
  if (!tarif) return res.status(404).json({ erreur: "Tarif introuvable." });

  const { categorie, designation, cotation, prix, actif } = req.body || {};
  const prixN = prix !== undefined ? Number(prix) : tarif.prix;
  if (!Number.isFinite(prixN) || prixN < 0) {
    return res.status(400).json({ erreur: "Prix invalide." });
  }
  const designationFinale = designation !== undefined && String(designation).trim() !== ""
    ? String(designation).trim()
    : tarif.designation;
  try {
    db.prepare(
      `UPDATE tarifs SET categorie = ?, designation = ?, cotation = ?, prix = ?, actif = ?
       WHERE id = ?`
    ).run(
      categorie !== undefined ? String(categorie).trim() : tarif.categorie,
      designationFinale,
      cotation !== undefined ? (cotation || null) : tarif.cotation,
      prixN,
      actif !== undefined ? (actif ? 1 : 0) : tarif.actif,
      id
    );
    res.json({ ok: true });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return res.status(409).json({ erreur: "Cette désignation existe déjà." });
    }
    throw e;
  }
});

app.delete("/api/tarifs/:id", role("admin"), (req, res) => {
  const id = idRequis(req, res);
  if (!id) return;
  const tarif = db.prepare("SELECT id FROM tarifs WHERE id = ?").get(id);
  if (!tarif) return res.status(404).json({ erreur: "Tarif introuvable." });
  db.prepare("DELETE FROM tarifs WHERE id = ?").run(id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// Prise de rendez-vous publique (sans authentification)
// ---------------------------------------------------------------

// Durée planifiée automatiquement selon le motif de consultation.
const DUREES_PAR_MOTIF = {
  Consultation: 30,
  "Contrôle": 20,
  Examen: 45,
  Vaccination: 15,
  Suivi: 20,
  Urgence: 30,
  Autre: 30
};

function dureePourMotif(motif) {
  const d = DUREES_PAR_MOTIF[String(motif || "").trim()];
  return Number.isInteger(d) ? d : 30;
}

// Code de confirmation envoyé au patient par SMS / email (lettres sans ambiguïté).
function codeConfirmation() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function tokenAnnulation() {
  return crypto.randomBytes(18).toString("hex");
}

app.get("/rdv", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "rendez-vous.html"));
});

app.get("/api/public/medecins", limiter(10 * 60 * 1000, 120), (req, res) => {
  const medecins = db
    .prepare(
      "SELECT id, nom_complet FROM users WHERE role IN ('medecin','admin') AND actif = 1 ORDER BY nom_complet"
    )
    .all();
  res.json(medecins);
});

app.get("/api/public/occupation", limiter(10 * 60 * 1000, 120), (req, res) => {
  const medecinId = Number(req.query.medecin);
  const date = String(req.query.date || "");
  if (!Number.isInteger(medecinId) || medecinId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ erreur: "Paramètres invalides." });
  }
  const rows = db
    .prepare(
      "SELECT heure, duree_min FROM rendezvous WHERE medecin_id = ? AND date = ? AND statut != 'annule' ORDER BY heure"
    )
    .all(medecinId, date);
  res.json(rows);
});

app.get("/api/public/disponibilite", limiter(10 * 60 * 1000, 120), (req, res) => {
  const medecinId = Number(req.query.medecin);
  const date = String(req.query.date || "");
  const heure = String(req.query.heure || "");
  if (!Number.isInteger(medecinId) || medecinId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(heure)) {
    return res.status(400).json({ erreur: "Paramètres invalides." });
  }
  const duree = Number(req.query.dureeMin) > 0 ? Number(req.query.dureeMin) : 30;
  res.json({ dispo: !chevauche(medecinId, date, heure, duree, null) });
});

app.get("/api/public/absences", limiter(10 * 60 * 1000, 120), (req, res) => {
  const medecinId = Number(req.query.medecin);
  const debut = String(req.query.debut || "");
  const fin = String(req.query.fin || "");
  if (
    !Number.isInteger(medecinId) || medecinId <= 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(debut) || !/^\d{4}-\d{2}-\d{2}$/.test(fin)
  ) {
    return res.status(400).json({ erreur: "Paramètres invalides." });
  }
  const rows = db
    .prepare(
      "SELECT id, date_debut, date_fin, motif FROM absences WHERE medecin_id = ? AND date_debut <= ? AND date_fin >= ? ORDER BY date_debut"
    )
    .all(medecinId, fin, debut);
  res.json(rows);
});

app.post("/api/public/rendezvous", limiter(10 * 60 * 1000, 10), (req, res) => {
  const { prenom, nom, dateNaissance, sexe, telephone, email, medecinId, date, heure, dureeMin, motif, notes, siteweb } =
    req.body || {};
  // Champ anti-robot invisible : un robot le remplit, un humain jamais.
  if (siteweb) {
    return res.status(201).json({ id: 0, ignore: true });
  }
  if (!prenom || !nom || !telephone) {
    return res.status(400).json({ erreur: "Prénom, nom et téléphone sont obligatoires." });
  }
  if (!sexeValide(sexe)) return res.status(400).json({ erreur: "Sexe invalide." });
  const dateStr = String(date || "");
  const heureStr = String(heure || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{2}:\d{2}$/.test(heureStr)) {
    return res.status(400).json({ erreur: "Date ou heure invalide." });
  }
  const maintenant = new Date();
  const minDate = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, "0")}-${String(maintenant.getDate()).padStart(2, "0")}`;
  if (dateStr < minDate) {
    return res.status(400).json({ erreur: "La date du rendez-vous ne peut pas être dans le passé." });
  }
  if (dateStr === minDate) {
    const actuelle = `${String(maintenant.getHours()).padStart(2, "0")}:${String(maintenant.getMinutes()).padStart(2, "0")}`;
    if (heureStr <= actuelle) {
      return res.status(400).json({ erreur: "Ce créneau est déjà passé aujourd'hui." });
    }
  }
  const medecin = db
    .prepare("SELECT id FROM users WHERE id = ? AND role IN ('medecin','admin') AND actif = 1")
    .get(Number(medecinId));
  if (!medecin) return res.status(400).json({ erreur: "Médecin invalide." });

  const absence = absentMedecin(medecinId, dateStr);
  if (absence) {
    return res.status(409).json({
      erreur: `Ce médecin est absent du ${absence.date_debut} au ${absence.date_fin}${absence.motif ? " (" + absence.motif + ")" : ""}. Choisissez une autre date.`
    });
  }

  // La durée est déduite automatiquement du motif (consultation = 30 min, contrôle = 20 min…).
  const duree = dureePourMotif(motif);
  const conflit = chevauche(Number(medecinId), dateStr, heureStr, duree, null);
  if (conflit) {
    return res.status(409).json({
      erreur: `Ce créneau vient d'être pris (${conflit.heure}). Choisissez-en un autre.`
    });
  }

  const tel = normaliseTel(telephone);
  let patient = db.prepare("SELECT id FROM patients WHERE telephone = ?").get(tel);
  if (!patient) {
    patient = db
      .prepare(
        "SELECT id FROM patients WHERE prenom = ? AND nom = ? AND (date_naissance IS ? OR date_naissance = ?)"
      )
      .get(String(prenom).trim(), String(nom).trim(), dateNaissance || null, dateNaissance || null);
  }

  let patientId;
  let nouveauPatient = false;
  if (patient) {
    patientId = patient.id;
  } else {
    const r = db
      .prepare(
        `INSERT INTO patients (prenom, nom, date_naissance, sexe, telephone, email, notes, cree_par)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(
        String(prenom).trim(),
        String(nom).trim(),
        dateNaissance || null,
        sexe || null,
        tel,
        email || null,
        notes || null
      );
    patientId = r.lastInsertRowid;
    nouveauPatient = true;
  }

  const code = codeConfirmation();
  const token = tokenAnnulation();

  const rv = db
    .prepare(
      `INSERT INTO rendezvous (patient_id, medecin_id, date, heure, duree_min, motif, statut, notes, confirmation_code, annulation_token)
       VALUES (?, ?, ?, ?, ?, ?, 'planifie', ?, ?, ?)`
    )
    .run(patientId, Number(medecinId), dateStr, heureStr, duree, motif || null, notes || null, code, token);

  // Envoi simulé du code de confirmation par email (prioritaire) ou SMS.
  const patientCanal = db.prepare("SELECT email, telephone FROM patients WHERE id = ?").get(patientId);
  const canal = patientCanal && patientCanal.email ? "email" : "sms";
  const cible = canal === "email" ? patientCanal.email : tel;
  console.log(
    `[envoi] Code de confirmation ${code} pour le rendez-vous n° ${rv.lastInsertRowid} (${dateStr} ${heureStr}) ` +
    `${canal === "email" ? "à " + cible : "au " + cible}.`
  );

  res.status(201).json({
    id: rv.lastInsertRowid,
    patientId,
    nouveauPatient,
    code,
    canal,
    date: dateStr,
    heure: heureStr
  });
});

app.post("/api/public/rendezvous/:id/annuler", limiter(10 * 60 * 1000, 20), (req, res) => {
  const id = Number(req.params.id);
  const { telephone, code } = req.body || {};
  const codeSaisi = String(code || "").trim().toUpperCase();
  if (!codeSaisi) {
    return res.status(400).json({ erreur: "Code de confirmation manquant." });
  }
  const tel = normaliseTel(String(telephone || ""));

  const reqRdv = `SELECT rv.*, p.telephone AS patient_telephone, u.nom_complet AS medecin_nom
       FROM rendezvous rv
       JOIN patients p ON p.id = rv.patient_id
       LEFT JOIN users u ON u.id = rv.medecin_id`;

  let rv = Number.isInteger(id) && id > 0 ? db.prepare(reqRdv + " WHERE rv.id = ?").get(id) : null;
  if (!rv) {
    if (!tel) {
      return res.status(400).json({ erreur: "Téléphone ou numéro de rendez-vous manquant." });
    }
    const candidats = db
      .prepare(
        reqRdv +
          " WHERE p.telephone = ? AND rv.confirmation_code = ? AND rv.statut != 'annule' ORDER BY rv.date, rv.heure"
      )
      .all(tel, codeSaisi);
    if (candidats.length === 0) {
      return res.status(404).json({ erreur: "Aucun rendez-vous correspondant (vérifiez le code et le téléphone)." });
    }
    if (candidats.length > 1) {
      return res.status(409).json({ erreur: "Plusieurs rendez-vous correspondent ; précisez le numéro du rendez-vous." });
    }
    rv = candidats[0];
  }
  if (!rv) return res.status(404).json({ erreur: "Rendez-vous introuvable." });
  if (rv.statut === "annule") return res.status(400).json({ erreur: "Ce rendez-vous est déjà annulé." });
  if (rv.statut === "termine") return res.status(400).json({ erreur: "Ce rendez-vous est déjà terminé." });

  if (tel && tel !== rv.patient_telephone) {
    return res.status(403).json({ erreur: "Ce numéro de téléphone ne correspond pas à ce rendez-vous." });
  }
  if (!rv.confirmation_code || codeSaisi !== rv.confirmation_code) {
    return res.status(403).json({ erreur: "Code de confirmation incorrect." });
  }

  const maintenant = new Date();
  const auj = aujourdhuiIso();
  const heureCourante = `${String(maintenant.getHours()).padStart(2, "0")}:${String(maintenant.getMinutes()).padStart(2, "0")}`;
  if (rv.date < auj || (rv.date === auj && rv.heure <= heureCourante)) {
    return res.status(400).json({ erreur: "Un rendez-vous déjà passé ne peut plus être annulé en ligne." });
  }

  db.prepare(
    "UPDATE rendezvous SET statut = 'annule', confirmation_code = NULL, annulation_token = NULL WHERE id = ?"
  ).run(id);
  db.prepare("DELETE FROM rappels WHERE rendezvous_id = ?").run(id);

  res.json({ ok: true, annule: true, date: rv.date, heure: rv.heure, medecin: rv.medecin_nom || null });
});

// ---------------------------------------------------------------
// WhatsApp : agent de prise de rendez-vous par messagerie
// ---------------------------------------------------------------

// Créneaux ouverts dans la journée (08:00 → 18:30, pas de 30 min).
const SLOTS_JOURNEE = [];
for (let h = 8; h <= 18; h++) {
  SLOTS_JOURNEE.push(`${String(h).padStart(2, "0")}:00`);
  if (h < 18) SLOTS_JOURNEE.push(`${String(h).padStart(2, "0")}:30`);
}

// ---------------------------------------------------------------

function whatsappLangue(texte) {
  return /[\u0600-\u06FF]/.test(texte) ? "ar" : "fr";
}

function normaliserTexte(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Accepte JJ/MM/AAAA, JJ-MM-AAAA, JJ.MM.AAAA ou ISO. Renvoie l'ISO ou null.
function parseDateFR(s) {
  const brut = String(s || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(brut)) return brut;
  const m = brut.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (!m) return null;
  let j = Number(m[1]);
  let mo = Number(m[2]);
  let a = Number(m[3]);
  if (m[3].length === 2) a = 2000 + a;
  if (mo > 12) {
    const tmp = j;
    j = mo;
    mo = tmp;
  }
  if (!(j >= 1 && j <= 31 && mo >= 1 && mo <= 12 && a >= 2020 && a <= 2100)) return null;
  const iso = `${a}-${String(mo).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const verif = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return verif === iso ? iso : null;
}

function formaterDateFR(iso) {
  const [a, m, j] = String(iso || "").split("-");
  return a && m && j ? `${j}/${m}/${a}` : "";
}

function normaliserHeure(s) {
  const m = String(s || "").trim().match(/^(\d{1,2})[:hH](\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
}

// Premier créneau libre pour un médecin à une date donnée (ou null).
function prochainCreneau(medecinId, date, duree) {
  const maintenant = new Date();
  const auj = aujourdhuiIso();
  const actuelle = `${String(maintenant.getHours()).padStart(2, "0")}:${String(maintenant.getMinutes()).padStart(2, "0")}`;
  for (const s of SLOTS_JOURNEE) {
    if (date === auj && s <= actuelle) continue;
    if (!chevauche(medecinId, date, s, duree, null)) return s;
  }
  return null;
}

// ---------------------------------------------------------------

const ALIASES_MOTIF = {
  Consultation: ["consultation", "visite", "استشارة", "استشارات", "زيارة"],
  "Contrôle": ["controle", "مراقبة"],
  Examen: ["examen", "فحص"],
  Vaccination: ["vaccination", "vaccin", "تلقيح", "تطعيم", "لقاح"],
  Suivi: ["suivi", "متابعة"],
  Urgence: ["urgence", "مستعجل", "طوارئ"],
  Autre: ["autre", "أخرى", "اخرى"]
};

function resoudreMotif(texte) {
  if (!texte) return "Consultation";
  const q = normaliserTexte(texte);
  for (const [valeur, alias] of Object.entries(ALIASES_MOTIF)) {
    if (alias.some((a) => q.includes(normaliserTexte(a)))) return valeur;
  }
  return "Consultation";
}

// Alias arabes des noms de médecins (pour les patients francophones/arabophones).
const ARABES_MEDECINS = {
  admin: ["الإدارة", "المدير", "ادارة"],
  amal: ["أمال", "أمل", "امل"],
  benali: ["بن علي", "بنعلي"],
  youssef: ["يوسف"],
  idrissi: ["الإدريسي", "الادريسي", "إدريسي", "ادريسي"]
};

function resoudreMedecin(texte) {
  const medecins = db
    .prepare("SELECT id, nom_complet FROM users WHERE role = 'medecin' AND actif = 1 ORDER BY nom_complet")
    .all();
  const admins = db
    .prepare("SELECT id, nom_complet FROM users WHERE role = 'admin' AND actif = 1 ORDER BY nom_complet")
    .all();
  // « Peu importe » : on privilégie un vrai médecin, sinon le compte admin.
  const candidats = medecins.length ? medecins : admins;
  if (!candidats.length) return null;
  const q = normaliserTexte(texte);
  const libre = !q || /(peu importe|importe|n.importe|any|أي |اي |المناسب)/.test(q);
  if (libre) return candidats[0];
  for (const [cle, arabes] of Object.entries(ARABES_MEDECINS)) {
    if (arabes.some((a) => q.includes(normaliserTexte(a)))) {
      const trouve = candidats.find((m) => normaliserTexte(m.nom_complet).includes(cle));
      if (trouve) return trouve;
    }
  }
  return candidats.find((m) => normaliserTexte(m.nom_complet).includes(q)) || null;
}

// Analyse le message du patient ; renvoie soit { incomplet }, soit { erreur },
// soit l'objet complet prêt pour la réservation.
function analyserReponseWhatsApp(texte, waTel) {
  const lignes = String(texte).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const champs = {};
  let numeroes = false;
  for (const l of lignes) {
    const m = l.match(/^([1-7])\s*[):.\-–•]\s*(.+)$/);
    if (m) {
      numeroes = true;
      champs[Number(m[1])] = m[2].trim();
    }
  }
  if (!numeroes) {
    const ordre = ["nom", "naissance", "tel", "medecin", "motif", "date", "heure"];
    lignes.forEach((p, i) => {
      if (ordre[i] && !champs[i + 1]) champs[i + 1] = p;
    });
  }

  const manquants = [];
  if (!champs[1]) manquants.push("1) nom complet");
  if (!champs[6]) manquants.push("6) date souhaitée");
  if (manquants.length) return { incomplet: manquants.join(", ") };

  const date = parseDateFR(champs[6]);
  if (!date || date < aujourdhuiIso()) return { erreur: "date" };

  const medecin = resoudreMedecin(champs[4]);
  if (!medecin) return { erreur: "medecin" };

  const telSaisi = normaliseTel(champs[3]);
  return {
    nom: champs[1],
    naissance: champs[2] ? parseDateFR(champs[2]) : null,
    tel: telSaisi || waTel,
    medecin,
    motif: resoudreMotif(champs[5]),
    date,
    heure: champs[7] && normaliserHeure(champs[7])
  };
}

// ---------------------------------------------------------------

function messageFormulaire(langue) {
  if (langue === "ar") {
    return [
      "مرحبًا في المركز الطبي 👋",
      "لحجز موعد، أرسل المعلومات التالية (سطر لكل رقم) :",
      "1) الاسم الكامل",
      "2) تاريخ الميلاد (يوم/شهر/سنة — اختياري)",
      "3) الهاتف (اختياري)",
      "4) الطبيب (أمال، يوسف أو «أي طبيب»)",
      "5) السبب (استشارة، مراقبة، فحص، تلقيح، متابعة، طوارئ، أخرى)",
      "6) التاريخ المطلوب (يوم/شهر/سنة)",
      "7) الساعة المطلوبة (ساعة:دقيقة — اختياري)",
      "",
      "مثال :",
      "1) أحمد بن علي",
      "5) استشارة",
      "6) 15/09/2026"
    ].join("\n");
  }
  return [
    "Bonjour, vous écrivez au Cabinet Médical 👋",
    "Pour prendre rendez-vous, répondez avec ces informations (une ligne par numéro) :",
    "1) Nom complet",
    "2) Date de naissance (JJ/MM/AAAA — facultatif)",
    "3) Téléphone (facultatif)",
    "4) Médecin (Amal, Youssef ou « peu importe »)",
    "5) Motif (Consultation, Contrôle, Examen, Vaccination, Suivi, Urgence, Autre)",
    "6) Date souhaitée (JJ/MM/AAAA)",
    "7) Heure souhaitée (HH:MM — facultatif)",
    "",
    "Exemple :",
    "1) Ahmed Benali",
    "5) Consultation",
    "6) 15/09/2026"
  ].join("\n");
}

function messageSucces(langue, t) {
  if (langue === "ar") {
    return [
      "🎉 تم تسجيل موعدك !",
      "الرقم " + t.numero + " — " + t.medecin + " — " + t.motif + " (" + t.duree + " دقيقة)",
      "التاريخ : " + t.date + " على الساعة " + t.heure,
      "رمز التأكيد : " + t.code,
      "لتتبع موعدك أو إلغائه : /rdv"
    ].join("\n");
  }
  return [
    "🎉 Rendez-vous enregistré !",
    "N° " + t.numero + " — Dr " + t.medecin + " — " + t.motif + " (" + t.duree + " min)",
    "Le " + t.date + " à " + t.heure,
    "Code de confirmation : " + t.code,
    "Suivi / annulation en ligne : /rdv"
  ].join("\n");
}

function messageMedecins() {
  const medecins = db
    .prepare("SELECT nom_complet FROM users WHERE role = 'medecin' AND actif = 1 ORDER BY nom_complet")
    .all();
  const liste = medecins.length
    ? medecins
    : db.prepare("SELECT nom_complet FROM users WHERE role = 'admin' AND actif = 1 ORDER BY nom_complet").all();
  return liste.map((m) => m.nom_complet.replace(/^Dr\s+/i, "")).join(", ");
}

function creerOuTrouverPatientWhatsApp(prenom, nom, naissance, tel, notes) {
  let patient = null;
  if (tel) patient = db.prepare("SELECT id FROM patients WHERE telephone = ?").get(tel);
  if (!patient) {
    patient = db
      .prepare("SELECT id FROM patients WHERE prenom = ? AND nom = ? AND (date_naissance IS ? OR date_naissance = ?)")
      .get(prenom, nom, naissance || null, naissance || null);
  }
  if (patient) return patient.id;
  const r = db
    .prepare(
      "INSERT INTO patients (prenom, nom, date_naissance, sexe, telephone, notes, cree_par) VALUES (?, ?, ?, NULL, ?, ?, NULL)"
    )
    .run(prenom, nom, naissance || null, tel || null, notes || null);
  return r.lastInsertRowid;
}

// Point d'entrée principal : traite un message entrant et renvoie la réponse.
async function traiterMessageWhatsApp(from, contenu) {
  const tel = normaliseTel(from);
  const texte = String(contenu || "").trim();
  if (!tel || !texte) return { erreur: "Expéditeur ou message invalide." };
  const langue = whatsappLangue(texte);

  let conv = db.prepare("SELECT * FROM wa_conversations WHERE wa_phone = ?").get(tel);
  if (!conv) {
    const r = db
      .prepare("INSERT INTO wa_conversations (wa_phone, langue, statut) VALUES (?, ?, 'attente')")
      .run(tel, langue);
    conv = db.prepare("SELECT * FROM wa_conversations WHERE id = ?").get(r.lastInsertRowid);
  }
  db.prepare("INSERT INTO wa_messages (conversation_id, sens, contenu) VALUES (?, 'in', ?)").run(conv.id, texte);
  db.prepare("UPDATE wa_conversations SET derniere_le = ?, langue = ? WHERE id = ?")
    .run(horodatage(), langue, conv.id);

  // Le premier message → on envoie le formulaire. Les salutations le renvoient.
  const nbOut = db.prepare("SELECT COUNT(*) AS n FROM wa_messages WHERE conversation_id = ? AND sens = 'out'").get(conv.id).n;
  const salutation = /(bonjour|bonsoir|salut|bjr|bonsoir|hello|salam|rebonjour|مرحب|سلام|مرحبا|موعد|حجز|rdv|rendez|reserv)/i;

  if (nbOut === 0 || salutation.test(texte)) {
    const rep = messageFormulaire(langue);
    db.prepare("INSERT INTO wa_messages (conversation_id, sens, contenu) VALUES (?, 'out', ?)").run(conv.id, rep);
    await wa.envoyer(tel, rep);
    return { conversationId: conv.id, etape: "formulaire", reponse: rep };
  }

  const repondre = async (texteRep) => {
    db.prepare("INSERT INTO wa_messages (conversation_id, sens, contenu) VALUES (?, 'out', ?)").run(conv.id, texteRep);
    await wa.envoyer(tel, texteRep);
    db.prepare("UPDATE wa_conversations SET derniere_le = ? WHERE id = ?").run(horodatage(), conv.id);
    return texteRep;
  };

  const analyse = analyserReponseWhatsApp(texte, tel);

  if (analyse.erreur === "date") {
    const rep = langue === "ar"
      ? "التاريخ غير صالح أو في الماضي. استخدم الصيغة يوم/شهر/سنة من الغد، مثال : 15/09/2026."
      : "La date n'est pas valide ou est passée. Utilisez JJ/MM/AAAA à partir de demain, ex : 15/09/2026.";
    return { conversationId: conv.id, etape: "erreur-date", reponse: await repondre(rep) };
  }
  if (analyse.erreur === "medecin") {
    const liste = messageMedecins();
    const rep = langue === "ar"
      ? "الطبيب غير موجود. اختر من بين : " + liste + " أو «أي طبيب»."
      : "Médecin introuvable. Choisissez parmi : " + liste + ", ou « peu importe ».";
    return { conversationId: conv.id, etape: "erreur-medecin", reponse: await repondre(rep) };
  }
  if (analyse.incomplet) {
    const rep = langue === "ar"
      ? "بعض المعلومات ناقصة : " + analyse.incomplet + ". أعد إرسال الحقول كلها. إذا كنت بحاجة إليها، أعد قراءة نموذج الرسالة."
      : "Il manque des informations : " + analyse.incomplet + ". Merci de renvoyer tous les champs (voir le formulaire dans le message initial).";
    return { conversationId: conv.id, etape: "incomplet", reponse: await repondre(rep) };
  }

  // Réservation du rendez-vous.
  const absence = absentMedecin(analyse.medecin.id, analyse.date);
  if (absence) {
    const rep = langue === "ar"
      ? "الطبيب غائب في هذا التاريخ (" + absence.date_debut + " إلى " + absence.date_fin + "). اختر تاريخًا آخر."
      : "Ce médecin est absent du " + absence.date_debut + " au " + absence.date_fin + ". Choisissez une autre date.";
    return { conversationId: conv.id, etape: "absent", reponse: await repondre(rep) };
  }

  const duree = dureePourMotif(analyse.motif);
  let heure = analyse.heure;
  if (heure && chevauche(analyse.medecin.id, analyse.date, heure, duree, null)) {
    const rep = langue === "ar"
      ? "الوقت " + heure + " محجوز. أعد إرسال 6) التاريخ و 7) الساعة المطلوبة."
      : "Le créneau " + heure + " est déjà pris. Renvoyez 6) la date et 7) l'heure souhaitées.";
    return { conversationId: conv.id, etape: "conflit", reponse: await repondre(rep) };
  }
  if (!heure) {
    heure = prochainCreneau(analyse.medecin.id, analyse.date, duree);
    if (!heure) {
      const rep = langue === "ar"
        ? "لا يوجد موعد متاح في هذا التاريخ. اختر تاريخًا آخر."
        : "Aucun créneau libre ce jour-là (heures 08:00–18:30). Choisissez une autre date.";
      return { conversationId: conv.id, etape: "plein", reponse: await repondre(rep) };
    }
  }

  const motsNom = String(analyse.nom).trim().split(/\s+/).filter(Boolean);
  const prenom = motsNom[0] || "Patient";
  const nom = motsNom.slice(1).join(" ") || "Sans nom";
  const patientId = creerOuTrouverPatientWhatsApp(
    prenom, nom, analyse.naissance, analyse.tel, "Demande via WhatsApp · " + tel
  );

  const code = codeConfirmation();
  const token = tokenAnnulation();
  const rv = db
    .prepare(
      `INSERT INTO rendezvous (patient_id, medecin_id, date, heure, duree_min, motif, statut, notes, confirmation_code, annulation_token)
       VALUES (?, ?, ?, ?, ?, ?, 'planifie', ?, ?, ?)`
    )
    .run(patientId, analyse.medecin.id, analyse.date, heure, duree, analyse.motif,
      "Demande via WhatsApp · " + tel, code, token);

  db.prepare("UPDATE wa_conversations SET statut = 'traite', patient_id = ?, rendezvous_id = ?, derniere_le = ? WHERE id = ?")
    .run(patientId, rv.lastInsertRowid, horodatage(), conv.id);

  const medecinNom = String(analyse.medecin.nom_complet).replace(/^Dr\s+/i, "").trim();
  const infos = {
    numero: rv.lastInsertRowid,
    date: formaterDateFR(analyse.date),
    heure,
    medecin: medecinNom,
    motif: analyse.motif,
    duree,
    code
  };
  const rep = messageSucces(langue, infos);
  const repEnvoyee = await repondre(rep);
  return { conversationId: conv.id, rdvId: rv.lastInsertRowid, patientId, etape: "cree", reponse: repEnvoyee };
}

// ---------------------------------------------------------------
// Webhook WhatsApp (Cloud API / Meta)
// ---------------------------------------------------------------

app.get("/api/wa/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  if (mode === "subscribe" && token === (process.env.WHATSAPP_VERIFY_TOKEN || "cabinet-medical")) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

app.post("/api/wa/webhook", (req, res) => {
  const cuerpo = req.body || {};
  res.status(200).json({ ok: true });

  const mensajes = (cuerpo.entry || []).flatMap((e) => e.changes || []).flatMap((c) => c.value?.messages || []);
  (async () => {
    for (const msg of mensajes) {
      if ((msg.type || "").toLowerCase() === "text" && msg.from && msg.text && msg.text.body) {
        try {
          await traiterMessageWhatsApp(msg.from, msg.text.body);
        } catch (err) {
          console.error("[whatsapp][webhook]", err);
        }
      }
    }
  })();
});

// ---------------------------------------------------------------
// Panneau de simulation pour le secrétariat (mode simulation)
// ---------------------------------------------------------------

app.get("/api/wa/mode", (req, res) => {
  res.json({ mode: wa.mode(), verification_token: process.env.WHATSAPP_VERIFY_TOKEN || "cabinet-medical" });
});

app.post("/api/wa/simulation", limiter(10 * 60 * 1000, 120), async (req, res) => {
  const { from, texte } = req.body || {};
  if (!from || !texte) return res.status(400).json({ erreur: "from et texte sont obligatoires." });
  try {
    const resultat = await traiterMessageWhatsApp(from, texte);
    res.json(resultat);
  } catch (err) {
    console.error("[whatsapp][simulation]", err);
    res.status(500).json({ erreur: err.message });
  }
});

app.post("/api/wa/statut", (req, res) => {
  if (!req.session || !req.session.user) return res.sendStatus(401);
  const { id, statut } = req.body || {};
  if (!Number.isInteger(Number(id)) || !["attente", "traite", "ignore"].includes(statut)) {
    return res.status(400).json({ erreur: "Paramètres invalides." });
  }
  db.prepare("UPDATE wa_conversations SET statut = ? WHERE id = ?").run(statut, Number(id));
  res.json({ ok: true });
});

app.get("/api/wa/conversations", (req, res) => {
  if (!req.session || !req.session.user) return res.sendStatus(401);
  const lignes = db
    .prepare(
      `SELECT c.id, c.wa_phone, c.statut, c.langue, c.derniere_le,
              COALESCE(p.prenom || ' ' || p.nom, '') AS patient_nom,
              rv.id AS rdv_id, rv.date AS rdv_date, rv.heure AS rdv_heure,
              (SELECT COUNT(*) FROM wa_messages m WHERE m.conversation_id = c.id AND m.sens = 'out') AS nb_out,
              (SELECT COUNT(*) FROM wa_messages m WHERE m.conversation_id = c.id AND m.sens = 'in') AS nb_in
       FROM wa_conversations c
       LEFT JOIN patients p ON p.id = c.patient_id
       LEFT JOIN rendezvous rv ON rv.id = c.rendezvous_id
       ORDER BY c.derniere_le DESC`
    )
    .all();
  res.json(lignes);
});

app.get("/api/wa/messages", (req, res) => {
  if (!req.session || !req.session.user) return res.sendStatus(401);
  const convId = Number(req.query.conv);
  if (!Number.isInteger(convId) || convId <= 0) return res.status(400).json({ erreur: "Conversation invalide." });
  const messages = db
    .prepare("SELECT id, sens, contenu, cree_le FROM wa_messages WHERE conversation_id = ? ORDER BY id")
    .all(convId);
  res.json(messages);
});

// ---------------------------------------------------------------
// Pages (protégées)
// ---------------------------------------------------------------

app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.use((req, res) => res.status(404).json({ erreur: "Route introuvable." }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ erreur: "Corps de requête JSON invalide." });
  }
  console.error(err);
  res.status(500).json({ erreur: "Erreur interne du serveur." });
});

const serveur = app.listen(PORT, () => {
  console.log(`Cabinet médical lancé : http://localhost:${PORT}`);
  console.log("Comptes de démonstration : admin/admin123, amal/medecin123, youssef/medecin123, secretariat/secretaire123");
  const n = genererRappels();
  if (n > 0) console.log(`[rappels] ${n} rappel(s) généré(s) au démarrage.`);
});

setInterval(() => {
  try {
    const n = genererRappels();
    if (n > 0) console.log(`[rappels] ${n} rappel(s) généré(s).`);
  } catch (e) {
    console.error("[rappels] erreur :", e);
  }
}, 6 * 3600 * 1000).unref();

serveur.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\nLe port ${PORT} est déjà utilisé par un autre processus.\n` +
      "Fermez l'autre instance du serveur ou libérez le port, puis relancez :\n" +
      `  PowerShell : Get-NetTCPConnection -LocalPort ${PORT} -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }\n` +
      "  Ou simplement : taskkill /F /PID <identifiant_du_processus>\n"
    );
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});