import customtkinter as ctk
from tkinter import messagebox
import sqlite3

# --- FONCTIONS DE LA BASE DE DONNÉES ---
def initialiser_bdd():
    conn = sqlite3.connect("cabinet.db")
    curseur = conn.cursor()
    curseur.execute("PRAGMA foreign_keys = ON;")
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
    conn.commit()
    conn.close()

def ajouter_patient(nom, prenom, date_naissance, telephone, antecedents=""):
    conn = sqlite3.connect("cabinet.db")
    curseur = conn.cursor()
    curseur.execute("""
        INSERT INTO patients (nom, prenom, date_naissance, telephone, antecedents)
        VALUES (?, ?, ?, ?, ?)
    """, (nom, prenom, date_naissance, telephone, antecedents))
    conn.commit()
    conn.close()

def recuperer_patients():
    conn = sqlite3.connect("cabinet.db")
    curseur = conn.cursor()
    curseur.execute("SELECT id, nom, prenom, date_naissance, telephone FROM patients ORDER BY nom ASC")
    liste = curseur.fetchall()
    conn.close()
    return liste

def chercher_patients(texte_recherche):
    conn = sqlite3.connect("cabinet.db")
    curseur = conn.cursor()
    critere = f"%{texte_recherche}%"
    curseur.execute("""
        SELECT id, nom, prenom, date_naissance, telephone 
        FROM patients 
        WHERE nom LIKE ? OR prenom LIKE ?
        ORDER BY nom ASC
    """, (critere, critere))
    liste = curseur.fetchall()
    conn.close()
    return liste

# Initialisation automatique de la BDD
initialiser_bdd()

ctk.set_appearance_mode("System")
ctk.set_default_color_theme("blue")

class CabinetMedicalApp(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title("MedManager - Gestion de Cabinet Médical")
        self.geometry("1100x650")

        # Configuration du Layout global
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        # --- BARRE LATÉRALE ---
        self.sidebar_frame = ctk.CTkFrame(self, width=200, corner_radius=0)
        self.sidebar_frame.grid(row=0, column=0, sticky="nsew")
        self.sidebar_frame.grid_rowconfigure(5, weight=1)

        self.logo_label = ctk.CTkLabel(self.sidebar_frame, text="MedManager v1.0", font=ctk.CTkFont(size=20, weight="bold"))
        self.logo_label.grid(row=0, column=0, padx=20, pady=(20, 30))

        self.btn_dashboard = ctk.CTkButton(self.sidebar_frame, text="Tableau de bord", command=self.action_dashboard)
        self.btn_dashboard.grid(row=1, column=0, padx=20, pady=10, sticky="ew")

        self.btn_add_patient = ctk.CTkButton(self.sidebar_frame, text="Ajouter un Patient", command=self.action_afficher_formulaire_patient)
        self.btn_add_patient.grid(row=2, column=0, padx=20, pady=10, sticky="ew")

        self.btn_list_patients = ctk.CTkButton(self.sidebar_frame, text="Liste des Patients", command=self.action_afficher_liste_patients)
        self.btn_list_patients.grid(row=3, column=0, padx=20, pady=10, sticky="ew")

        self.appearance_mode_optionemenu = ctk.CTkOptionMenu(self.sidebar_frame, values=["System", "Light", "Dark"], command=ctk.set_appearance_mode)
        self.appearance_mode_optionemenu.grid(row=6, column=0, padx=20, pady=(10, 20))

        # --- ZONE DE CONTENU PRINCIPALE ---
        self.main_frame = ctk.CTkFrame(self, corner_radius=15)
        self.main_frame.grid(row=0, column=1, padx=20, pady=20, sticky="nsew")
        
        # Création de la variable de suivi pour la recherche en temps réel
        self.texte_recherche_var = ctk.StringVar()
        self.texte_recherche_var.trace_add("write", self.filtrer_tableau)

        self.action_dashboard()

    def nettoyer_zone_principale(self):
        for widget in self.main_frame.winfo_children():
            widget.destroy()

    def action_dashboard(self):
        self.nettoyer_zone_principale()
        welcome_label = ctk.CTkLabel(self.main_frame, text="Bienvenue, Docteur", font=ctk.CTkFont(size=24, weight="bold"))
        welcome_label.pack(pady=40)

    # --- FORMULAIRE PATIENT ---
    def action_afficher_formulaire_patient(self):
        self.nettoyer_zone_principale()
        titre = ctk.CTkLabel(self.main_frame, text="Enregistrer un nouveau patient", font=ctk.CTkFont(size=20, weight="bold"))
        titre.pack(pady=(20, 30))

        form_container = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        form_container.pack(padx=50, fill="x")

        lbl_nom = ctk.CTkLabel(form_container, text="Nom :")
        lbl_nom.pack(anchor="w")
        self.entry_nom = ctk.CTkEntry(form_container, height=35)
        self.entry_nom.pack(fill="x", pady=(0, 10))

        lbl_prenom = ctk.CTkLabel(form_container, text="Prénom :")
        lbl_prenom.pack(anchor="w")
        self.entry_prenom = ctk.CTkEntry(form_container, height=35)
        self.entry_prenom.pack(fill="x", pady=(0, 10))

        lbl_naissance = ctk.CTkLabel(form_container, text="Date de naissance (JJ/MM/AAAA) :")
        lbl_naissance.pack(anchor="w")
        self.entry_naissance = ctk.CTkEntry(form_container, height=35)
        self.entry_naissance.pack(fill="x", pady=(0, 10))

        lbl_telephone = ctk.CTkLabel(form_container, text="Téléphone :")
        lbl_telephone.pack(anchor="w")
        self.entry_telephone = ctk.CTkEntry(form_container, height=35)
        self.entry_telephone.pack(fill="x", pady=(0, 10))

        lbl_antecedents = ctk.CTkLabel(form_container, text="Antécédents médicaux :")
        lbl_antecedents.pack(anchor="w")
        self.txt_antecedents = ctk.CTkTextbox(form_container, height=80)
        self.txt_antecedents.pack(fill="x", pady=(0, 20))

        btn_enregistrer = ctk.CTkButton(form_container, text="Enregistrer le Patient", height=40, fg_color="#2ecc71", hover_color="#27ae60", command=self.sauvegarder_patient)
        btn_enregistrer.pack(fill="x")

    def sauvegarder_patient(self):
        nom = self.entry_nom.get().strip()
        prenom = self.entry_prenom.get().strip()
        naissance = self.entry_naissance.get().strip()
        telephone = self.entry_telephone.get().strip()
        antecedents = self.txt_antecedents.get("1.0", "end-1c").strip()

        if not nom or not prenom or not naissance:
            messagebox.showwarning("Champs requis", "Veuillez remplir le Nom, le Prénom et la Date de naissance.")
            return

        ajouter_patient(nom, prenom, naissance, telephone, antecedents)
        messagebox.showinfo("Succès", f"Le patient {prenom} {nom} a bien été enregistré !")
        self.action_afficher_liste_patients()

    # --- REPERTOIRE PATIENTS ---
    def action_afficher_liste_patients(self):
        self.nettoyer_zone_principale()

        titre = ctk.CTkLabel(self.main_frame, text="Répertoire des Patients", font=ctk.CTkFont(size=22, weight="bold"))
        titre.pack(pady=(20, 15))

        search_container = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        search_container.pack(padx=20, pady=(0, 20), fill="x")

        # Utilisation de textvariable au lieu de bind pour éliminer les bugs d'événements clavier
        self.entry_recherche = ctk.CTkEntry(
            search_container, 
            placeholder_text="🔍 Rechercher un patient par nom ou prénom...", 
            height=40,
            border_width=2,
            border_color="#3498db",
            textvariable=self.texte_recherche_var
        )
        self.entry_recherche.pack(side="left", fill="x", expand=True, padx=(0, 10))

        btn_loupe = ctk.CTkButton(
            search_container, 
            text="Rechercher", 
            width=120,
            height=40,
            font=ctk.CTkFont(weight="bold"),
            command=lambda: self.filtrer_tableau(None, None, None)
        )
        btn_loupe.pack(side="right")

        header_frame = ctk.CTkFrame(self.main_frame, fg_color="#34495e", height=40, corner_radius=5)
        header_frame.pack(padx=20, fill="x")
        
        header_frame.grid_columnconfigure(0, weight=1)
        header_frame.grid_columnconfigure(1, weight=3)
        header_frame.grid_columnconfigure(2, weight=3)
        header_frame.grid_columnconfigure(3, weight=3)
        header_frame.grid_columnconfigure(4, weight=2)

        headers = ["ID", "Nom", "Prénom", "Date de Naissance", "Téléphone"]
        for col_index, text in enumerate(headers):
            lbl = ctk.CTkLabel(header_frame, text=text, font=ctk.CTkFont(weight="bold"), text_color="white", anchor="w")
            lbl.grid(row=0, column=col_index, padx=15, pady=8, sticky="w")

        self.scroll_frame = ctk.CTkScrollableFrame(self.main_frame, fg_color="transparent")
        self.scroll_frame.pack(padx=20, pady=(10, 20), fill="both", expand=True)

        self.mettre_a_jour_tableau(recuperer_patients())

    def filtrer_tableau(self, var, index, mode):
        """Déclenché proprement dès que la variable texte change."""
        texte = self.texte_recherche_var.get().strip()
        resultats = chercher_patients(texte)
        self.mettre_a_jour_tableau(resultats)

    def mettre_a_jour_tableau(self, liste_patients):
        for widget in self.scroll_frame.winfo_children():
            widget.destroy()

        if not liste_patients:
            lbl_vide = ctk.CTkLabel(self.scroll_frame, text="Aucun patient trouvé.", font=ctk.CTkFont(size=14, italic=True))
            lbl_vide.pack(pady=30)
            return

        for row_index, patient in enumerate(liste_patients):
            bg_color = ("#eaeded", "#2c3e50") if row_index % 2 == 0 else ("#f4f6f7", "#212f3d")
            
            row_frame = ctk.CTkFrame(self.scroll_frame, fg_color=bg_color, corner_radius=4)
            row_frame.pack(fill="x", pady=2)
            
            row_frame.grid_columnconfigure(0, weight=1)
            row_frame.grid_columnconfigure(1, weight=3)
