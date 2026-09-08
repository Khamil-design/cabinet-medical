const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");
const bcrypt = require("bcryptjs");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "cabinet.db"));

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nom_complet TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'medecin', 'secretaire')),
  actif INTEGER NOT NULL DEFAULT 1,
  cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prenom TEXT NOT NULL,
  nom TEXT NOT NULL,
  date_naissance TEXT,
  sexe TEXT CHECK (sexe IN ('M', 'F')),
  telephone TEXT,
  email TEXT,
  adresse TEXT,
  groupe_sanguin TEXT,
  antecedents TEXT,
  notes TEXT,
  cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  cree_par INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS rendezvous (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  medecin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  heure TEXT NOT NULL,
  duree_min INTEGER NOT NULL DEFAULT 30,
  motif TEXT,
  statut TEXT NOT NULL DEFAULT 'planifie'
    CHECK (statut IN ('planifie', 'confirme', 'termine', 'annule')),
  notes TEXT,
  confirmation_code TEXT,
  annulation_token TEXT,
  cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS factures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  medecin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rendezvous_id INTEGER REFERENCES rendezvous(id) ON DELETE SET NULL,
  designation TEXT NOT NULL,
  montant REAL NOT NULL DEFAULT 0 CHECK (montant >= 0),
  statut TEXT NOT NULL DEFAULT 'impayee'
    CHECK (statut IN ('impayee', 'partielle', 'payee')),
  cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS paiements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  facture_id INTEGER NOT NULL REFERENCES factures(id) ON DELETE CASCADE,
  montant REAL NOT NULL CHECK (montant > 0),
  mode TEXT NOT NULL DEFAULT 'especes'
    CHECK (mode IN ('especes', 'carte', 'cheque', 'virement')),
  date_paiement TEXT NOT NULL DEFAULT (date('now')),
  cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS ordonnances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  medecin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rendezvous_id INTEGER REFERENCES rendezvous(id) ON DELETE SET NULL,
  date TEXT NOT NULL DEFAULT (date('now')),
  notes TEXT,
  cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS ordonnance_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ordonnance_id INTEGER NOT NULL REFERENCES ordonnances(id) ON DELETE CASCADE,
  medicament TEXT NOT NULL,
  posologie TEXT,
  duree TEXT
);

CREATE TABLE IF NOT EXISTS absences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  medecin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_debut TEXT NOT NULL,
  date_fin TEXT NOT NULL,
  motif TEXT,
  cree_par INTEGER REFERENCES users(id),
  cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS rappels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rendezvous_id INTEGER NOT NULL REFERENCES rendezvous(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  medecin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'sms' CHECK (type IN ('sms', 'email')),
  envoye INTEGER NOT NULL DEFAULT 0,
  envoye_le TEXT,
  cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_rdv_date ON rendezvous(date);
CREATE INDEX IF NOT EXISTS idx_rdv_patient ON rendezvous(patient_id);
CREATE INDEX IF NOT EXISTS idx_fact_patient ON factures(patient_id);
CREATE INDEX IF NOT EXISTS idx_ordo_patient ON ordonnances(patient_id);
CREATE INDEX IF NOT EXISTS idx_rappels_rdv ON rappels(rendezvous_id);
CREATE INDEX IF NOT EXISTS idx_rappels_envoye ON rappels(envoye);
`);

// Migration : colonnes pour l'annulation en ligne (code de confirmation + jeton).
if (!db.prepare("PRAGMA table_info(rendezvous)").all().some((c) => c.name === "confirmation_code")) {
  db.exec("ALTER TABLE rendezvous ADD COLUMN confirmation_code TEXT");
}
if (!db.prepare("PRAGMA table_info(rendezvous)").all().some((c) => c.name === "annulation_token")) {
  db.exec("ALTER TABLE rendezvous ADD COLUMN annulation_token TEXT");
}

// Messagerie WhatsApp : conversations et échanges.
db.exec(`
CREATE TABLE IF NOT EXISTS wa_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_phone TEXT NOT NULL,
  patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  rendezvous_id INTEGER REFERENCES rendezvous(id) ON DELETE SET NULL,
  statut TEXT NOT NULL DEFAULT 'attente' CHECK (statut IN ('attente', 'traite', 'ignore')),
  langue TEXT NOT NULL DEFAULT 'fr',
  derniere_le TEXT,
  cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS wa_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES wa_conversations(id) ON DELETE CASCADE,
  sens TEXT NOT NULL CHECK (sens IN ('in', 'out')),
  contenu TEXT NOT NULL,
  cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_wa_conv_phone ON wa_conversations(wa_phone);
CREATE INDEX IF NOT EXISTS idx_wa_conv_statut ON wa_conversations(statut);
CREATE INDEX IF NOT EXISTS idx_wa_msg_conv ON wa_messages(conversation_id);
`);

function hashMotDePasse(plain) {
  return bcrypt.hashSync(plain, 10);
}

// Données de départ (uniquement si la table users est vide).
const countUsers = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
if (countUsers === 0) {
  const inserer = db.prepare(
    "INSERT INTO users (username, password_hash, nom_complet, role) VALUES (?, ?, ?, ?)"
  );
  inserer.run("admin", hashMotDePasse("admin123"), "Administrateur", "admin");
  inserer.run("amal", hashMotDePasse("medecin123"), "Dr Amal Benali", "medecin");
  inserer.run("youssef", hashMotDePasse("medecin123"), "Dr Youssef El Idrissi", "medecin");
  inserer.run("secretariat", hashMotDePasse("secretaire123"), "Secrétariat", "secretaire");
  console.log("[db] Utilisateurs de démonstration créés.");
}

module.exports = db;