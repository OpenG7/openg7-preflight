# Workflows OpenG7 Preflight

preflight-ci.yml vérifie l’application Node22/Angular et son moteur PostgreSQL17 :
installation npm, contrats, types, tests, intégration, gouvernance et builds.
Les workflows du socle hérités restent séparés.

| Workflow                                   | Portée                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| preflight-ci.yml | Application, PostgreSQL de test, types et builds Angular/serveur |
| agent-standards.yml                        | Standard commun : socle, sections, budgets, liens/ancres, instructions et skills; sans installation de dépendance |
| template-quality.yml                       | Tests du validateur/synchroniseur dans des répertoires temporaires; propre au template                            |
| sync-standards.yml                         | Dispatch manuel vers un dépôt cible; synchronise le seul socle et ouvre une PR selon les inputs                   |
| claude-pr.yml, codex-pr.yml, gemini-pr.yml | Dispatch d’agent; configuration/secrets du fournisseur requis                                                     |
| copilot-pr.yml                             | Placeholder gardé; lire le workflow avant activation                                                              |
| ecosystem-guardrails.yml                   | Contrôles locaux si l’outillage correspondant existe                                                              |

## Propagation

Seul agent-standards.yml fait partie du [manifest de synchronisation](../../scripts/sync-manifest.json).
Les autres workflows restent locaux et ne sont pas écrasés par une mise à jour du
socle. Les fichiers d’instructions Copilot et skills se spécialisent avec le projet.

Le dispatch sync-standards exige STANDARDS_SYNC_TOKEN, les droits sur la cible
et un AGENTS déjà migré avec ses marqueurs. Un échec de précondition arrête le
workflow. Le standard de la cible est vérifié avant la création de PR. Aucun
workflow de synchronisation n’est déclenché automatiquement sur push.

La CI ne publie ni ne déploie Preflight. Les dispatchs fournisseurs hérités ne
constituent pas des intégrations actives; leurs secrets doivent être configurés
avant usage explicite. Instructions : [README](../../README.md).
