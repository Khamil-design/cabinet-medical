import customtkinter as ctk
from tkinter import messagebox
# Importation des fonctions de notre base de données
from database import initialiser_bdd, ajouter_patient

# Initialisation de la base de données au démarrage de l'application
initialiser_bdd()

ctk.set_appearance_mode("System")
ctk.set_default_color_theme("blue")

class CabinetMedicalApp(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title("MedManager - Gestion de Cabinet Médical")
        self.geometry("1000x650")

        # Configuration du Layout
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        # --- 1. BARRE LATÉRALE (MENU) ---
        self.sidebar_frame = ctk.CTkFrame(self, width=200, corner_radius=0)
        self.sidebar_frame.grid(row=0, column=0, sticky="nsew")
        self.sidebar_frame.grid_rowconfigure(4, weight=1)

        self.logo_label = ctk.CTkLabel(self.sidebar_frame, text="MedManager v1.0", font=ctk.CTkFont(size=20, weight="bold"))
        self.logo_label.grid(row=0, column=0, padx=20, pady=(20, 30))

        self.btn_dashboard = ctk.CTkButton(self.sidebar_frame, text="Tableau de bord", command=self.action_dashboard)
        self.btn_dashboard.grid(row=1, column=0, padx=20, pady=10, sticky="ew")

        self.btn_patients = ctk.CTkButton(self.sidebar_frame, text="Ajouter un Patient", command=self.action_afficher_formulaire_patient)
        self.btn_patients.grid(row=2, column=0, padx=20, pady=10, sticky="ew")

        self.appearance_mode_optionemenu = ctk.CTkOptionMenu(self.sidebar_frame, values=["System", "Light", "Dark"], command=ctk.set_appearance_mode)
        self.appearance_mode_optionemenu.grid(row=5, column=0, padx=20, pady=(10, 20))

        # --- 2. ZONE DE CONTENU PRINCIPALE ---
        self.main_frame = ctk.CTkFrame(self, corner_radius=15)
        self.main_frame.grid(row=0, column=1, padx=20, pady=20, sticky="nsew")
        
        # Affichage de l'écran d'accueil par défaut
        self.action_dashboard()

    def nettoyer_zone_principale(self):
        """Supprime tous les widgets de la zone principale avant d'en afficher de nouveaux."""
        for widget in self.main_frame.winfo_children():
            widget.destroy()

    def action_dashboard(self):
        self.nettoyer_zone_principale()
        welcome_label = ctk.CTkLabel(self.main_frame, text="Bienvenue, Docteur", font=ctk.CTkFont(size=24, weight="bold"))
        welcome_label.pack(pady=40)

    # --- FORMULAIRE D'AJOUT PATIENT ---
    def action_afficher_formulaire_patient(self):
        self.nettoyer_zone_principale()

        # Titre du formulaire
        titre = ctk.CTkLabel(self.main_frame, text="Enregistrer un nouveau patient", font=ctk.CTkFont(size=20, weight="bold"))
        titre.pack(pady=(20, 30))

        # Conteneur centré pour le formulaire
        form_container = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        form_container.pack(padx=50, fill="x")

        # Champ : Nom
        lbl_nom = ctk.CTkLabel(form_container, text="Nom :", font=ctk.CTkFont(size=14))
        lbl_nom.pack(anchor="w", pady=(10, 2))
        self.entry_nom = ctk.CTkEntry(form_container, placeholder_text="Ex: Dupont", height=35)
        self.entry_nom.pack(fill="x", pady=(0, 10))

        # Champ : Prénom
        lbl_prenom = ctk.CTkLabel(form_container, text="Prénom :", font=ctk.CTkFont(size=14))
        lbl_prenom.pack(anchor="w", pady=(10, 2))
        self.entry_prenom = ctk.CTkEntry(form_container, placeholder_text="Ex: Jean", height=35)
        self.entry_prenom.pack(fill="x", pady=(0, 10))

        # Champ : Date de naissance
        lbl_naissance = ctk.CTkLabel(form_container, text="Date de naissance (JJ/MM/AAAA) :", font=ctk.CTkFont(size=14))
        lbl_naissance.pack(anchor="w", pady=(10, 2))
        self.entry_naissance = ctk.CTkEntry(form_container, placeholder_text="Ex: 15/08/1985", height=35)
        self.entry_naissance.pack(fill="x", pady=(0, 10))

        # Champ : Téléphone
        lbl_telephone = ctk.CTkLabel(form_container, text="Téléphone :", font=ctk.CTkFont(size=14))
        lbl_telephone.pack(anchor="w", pady=(10, 2))
        self.entry_telephone = ctk.CTkEntry(form_container, placeholder_text="Ex: 0612345678", height=35)
        self.entry_telephone.pack(fill="x", pady=(0, 10))

        # Champ : Antécédents (Zone de texte plus grande)
        lbl_antecedents = ctk.CTkLabel(form_container, text="Antécédents médicaux / Notes :", font=ctk.CTkFont(size=14))
        lbl_antecedents.pack(anchor="w", pady=(10, 2))
        self.txt_antecedents = ctk.CTkTextbox(form_container, height=100)
        self.txt_antecedents.pack(fill="x", pady=(0, 20))

        # Bouton Enregistrer
        btn_enregistrer = ctk.CTkButton(form_container, text="Enregistrer le Patient", height=40, font=ctk.CTkFont(weight="bold"), fg_color="#2ecc71", hover_color="#27ae60", command=self.sauvegarder_patient)
        btn_enregistrer.pack(fill="x", pady=10)

    def sauvegarder_patient(self):
        """Récupère les saisies et les injecte dans la base de données."""
        nom = self.entry_nom.get().strip()
        prenom = self.entry_prenom.get().strip()
        naissance = self.entry_naissance.get().strip()
        telephone = self.entry_telephone.get().strip()
        antecedents = self.txt_antecedents.get("1.0", "end-1c").strip()

        # Validation simple des champs obligatoires
        if not nom or not prenom or not naissance:
            messagebox.showwarning("Champs requis", "Veuillez remplir au moins le Nom, le Prénom et la Date de naissance.")
            return

        try:
            # Appel de la fonction de notre BDD
            ajouter_patient(nom, prenom, naissance, telephone, antecedents)
            messagebox.showinfo("Succès", f"Le patient {prenom} {nom} a bien été enregistré !")
            
            # Réinitialiser les champs après succès
            self.entry_nom.delete(0, 'end')
            self.entry_prenom.delete(0, 'end')
            self.entry_naissance.delete(0, 'end')
            self.entry_telephone.delete(0, 'end')
            self.txt_antecedents.delete("1.0", "end")
            
        except Exception as e:
            messagebox.showerror("Erreur", f"Impossible d'enregistrer le patient.\nErreur : {e}")

if __name__ == "__main__":
    app = CabinetMedicalApp()
    app.mainloop()
