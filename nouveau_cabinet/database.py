import sqlite3

def initialiser_bdd():
    """Crée la base de données et les tables nécessaires si elles n'existent pas."""
    # Connexion à la base de données (le fichier cabinet.db sera créé automatiquement)
    conn = sqlite3.connect("cabinet.db")
    curseur = conn.cursor()

    # Activation des clés étrangères pour la cohérence des données
    curseur.execute("PRAGMA foreign_keys = ON;")

    # 1. Table des Patients
    curseur.execute("""
    CREATE TABLE IF NOT EXISTS patients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom TEXT NOT NULL,
        prenom TEXT NOT NULL,
        date_naissance TEXT NOT NULL,
        telephone TEXT,
        antecedents TEXT
    );
    """)

    # 2. Table des Rendez-vous
    curseur.execute("""
    CREATE TABLE IF NOT EXISTS rendez_vous (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER,
        date_rdv TEXT NOT NULL,
        heure_rdv TEXT NOT NULL,
        statut TEXT CHECK(statut IN ('En attente', 'Confirme', 'Annule', 'Termine')) DEFAULT 'En attente',
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
    );
    """)

    # 3. Table des Consultations
    curseur.execute("""
    CREATE TABLE IF NOT EXISTS consultations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER,
        date_consultation TEXT DEFAULT CURRENT_DATE,
        symptomes TEXT,
        diagnostic TEXT,
        ordonnance TEXT,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
    );
    """)

    # Validation et fermeture
    conn.commit()
    conn.close()
    print("Base de données initialisée avec succès (fichier 'cabinet.db' créé) !")

# Fonctions utilitaires pour manipuler les données
def ajouter_patient(nom, prenom, date_naissance, telephone, antecedents=""):
    """Insère un nouveau patient dans la base de données."""
    conn = sqlite3.connect("cabinet.db")
    curseur = conn.cursor()
    curseur.execute("""
        INSERT INTO patients (nom, prenom, date_naissance, telephone, antecedents)
        VALUES (?, ?, ?, ?, ?)
    """, (nom, prenom, date_naissance, telephone, antecedents))
    conn.commit()
    conn.close()

def recuperer_patients():
    """Récupère la liste de tous les patients."""
    conn = sqlite3.connect("cabinet.db")
    curseur = conn.cursor()
    curseur.execute("SELECT id, nom, prenom, date_naissance, telephone FROM patients")
    liste_patients = curseur.fetchall()
    conn.close()
    return liste_patients

# Si on lance ce script directement, on initialise la BDD
if __name__ == "__main__":
    initialiser_bdd()
