# Diagnostic local

| Symptôme | Vérification et action |
| --- | --- |
| Connexion PostgreSQL refusée | docker compose ps; attendre healthy, vérifier port55432 et DATABASE_URL |
| Base preflight_test absente | L’init SQL ne passe que sur volume neuf; créer explicitement la base de test locale sans effacer le volume existant |
| Migration modifiée refusée | Ajouter un fichier SQL versionné plutôt que réécrire une migration appliquée |
| API non prête | /health/ready; vérifier migrations et permissions PostgreSQL |
| Mission reste ready | Lancer dev:worker; lire tâche, historique et erreurs structurées |
| waiting_input | Fournir les informations manquantes par la console ou /input |
| failed | Lire errorCode et tentatives; corriger la cause avant une reprise autorisée |
| superseded | Une version source plus récente a invalidé ce travail |
| JWT refusé | Vérifier issuer, audience, expiration, JWKS et claims tenant/applications/rôles |
| insecure_development_auth | Mode local uniquement en développement et sur loopback |
| Origine locale refusée | Utiliser http://127.0.0.1:4300 ou adapter DEV_WEB_ORIGIN à une origine loopback exacte |
| Port occupé | Préserver le processus existant; adapter ensemble port, proxy et origine |
| Fournisseur absent/budget insuffisant | Configurer explicitement le fournisseur, ses tarifs et limites; aucun fallback silencieux |
| Export de lot refusé | Relire sélection/version; exclure les dossiers obsolètes ou reconstruire un lot courant |

Les correlationId HTTP et l’historique permettent le suivi. Les logs contiennent
codes et métadonnées, pas de secrets ni de corps de mission. Ne jamais copier de
jeton dans un ticket. `npm run demo:submit` soumet les données synthétiques;
répéter la même clé démontre la déduplication sans effacer les données.
