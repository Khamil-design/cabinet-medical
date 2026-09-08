# Cabinet Médical

Application web locale de gestion d'un cabinet médical :
planning des rendez-vous, dossiers patients, facturation et ordonnances imprimables.

## Démarrage

Prérequis : Node.js ≥ 22.5.

```bash
npm install
npm start
```

Puis ouvrir **http://localhost:3000** dans le navigateur.

## Comptes de démonstration

| Identifiant | Mot de passe | Rôle |
|---|---|---|
| admin | admin123 | Administrateur |
| amal | medecin123 | Médecin |
| youssef | medecin123 | Médecin |
| secretariat | secretaire123 | Secrétariat |

La base de données (SQLite) est stockée dans `data/cabinet.db` et se crée
automatiquement au premier lancement, avec les comptes ci-dessus.
Pour repartir de zéro : arrêter le serveur puis supprimer `data/cabinet.db`.

## Fonctionnalités

- **Planning** : agenda par jour, filtrage par médecin, ajout/modification/
  suppression, changement de statut (planifié → confirmé → terminé / annulé),
  détection automatique des créneaux en conflit pour un même médecin.
- **Patients** : fiche complète (coordonnées, antécédents, notes), recherche,
  historique des rendez-vous, ordonnances et factures dans le dossier.
- **Facturation** : factures numérotées (F-XXXX-0001), encaissements partiels,
  statuts automatiques (impayée / partielle / payée), modes de paiement.
- **Ordonnances** : rédigées par un médecin, imprimables (nécessite un compte
  médecin ou administrateur).
- **Utilisateurs** : gestion des comptes (médecins, secrétariat, administrateur),
  activation/désactivation et changement de mot de passe (réservé à l'admin).

## Structure

```
server.js        API Express + authentification par session
db.js            Schéma SQLite (node:sqlite, aucune dépendance native)
public/
  index.html     Tableau de bord (SPA)
  login.html     Page de connexion
  css/style.css  Styles
  js/app.js      Logique frontend
data/cabinet.db  Base de données locale (créée au lancement)
```

Changer le port : `PORT=3001 npm start` (Windows : `set PORT=3001 && npm start`).
Le secret de session peut être défini avec la variable d'environnement `SESSION_SECRET`.