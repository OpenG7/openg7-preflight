# API HTTP v1

Base locale : `http://127.0.0.1:3000`. JSON, JWT Bearer en mode authentifié.
Le mode local explicite utilise l’identité configurée côté serveur.
Les schémas sont validés à l’exécution; les erreurs retournent un code et un
correlationId sans contenu interne. Les lectures sont privées et sans cache.

| Méthode et chemin | Fonction |
| --- | --- |
| GET /health/live | Processus vivant |
| GET /health/ready | Dépendances de persistance prêtes |
| GET /api/session | Identité et portée effectives |
| POST /api/missions | Mission v1 : 202 nouvelle, 200 doublon |
| GET /api/missions | Liste : page, pageSize, q, status, application |
| GET /api/missions/:id | Mission, tâches, résultats, propositions, historique |
| POST /api/missions/:id/cancel | Annulation autorisée, corps vide |
| POST /api/missions/:id/retry | Reprise autorisée, corps vide |
| POST /api/missions/:id/input | Informations manquantes : `{ "input": {} }` |
| POST /api/missions/:id/source-decision | Notification source : sourceVersion, decision, eventId |
| POST /api/events | Enveloppe mission.submitted ou source.updated; rôle service |
| GET /api/briefing | Données persistées; since, application, status |
| POST /api/briefing/checkpoint | Enregistrer la consultation courante |
| GET /api/proposals | Propositions paginées : page, pageSize, q, application, status=prepared ou obsolete |
| GET /api/review-batches | Lots consultables |
| POST /api/review-batches | `{ "name": "Revue", "proposalIds": ["..."] }` |
| GET /api/review-batches/:id | Sélection et critères |
| POST /api/review-batches/:id/exclude | `{ "proposalId": "...", "version": 1 }` |
| POST /api/review-batches/:id/export | `{ "version": 1 }`; préparation seulement |
| GET /api/integrations | Sources simulées et ports non raccordés |
| GET /api/config | Workflows et limites disponibles |
| GET /api/audit | Traces réservées à l’administrateur |

Les lots sont bornés à 500 propositions. La version protège les modifications
concurrentes; une source devenue obsolète bloque son export. Aucune route
`approve`, publication ou exécution commerciale n’existe.

400 : contrat invalide; 401 : identité absente/invalide; 403 : portée interdite;
404 : objet absent de la portée; 409 : conflit d’état/version/idempotence;
422 : workflow non pris en charge; 429 : limite de requêtes; 503 : non prêt.

La commande [demo:submit](../scripts/submit-demo.mjs) fournit deux exemples
exécutables de soumission et de suivi sans données personnelles.
