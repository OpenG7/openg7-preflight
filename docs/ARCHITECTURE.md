# Architecture OpenG7 Preflight

Preflight est un monolithe modulaire de préparation opérationnelle, avec processus
HTTP et worker indépendants, une base PostgreSQL et une console Angular.
Il prépare des propositions sans prendre l’autorité métier des applications sources.

Les responsabilités et contrats suivent les dépendances : applications → moteur
et ports → contrats. Les contrôleurs ne définissent pas les workflows. La console
présente des données persistées et laisse les contrôles d’autorité au serveur.

| Référence propriétaire | Sujet |
| --- | --- |
| [Vision](architecture/vision.md) | Promesse et frontières métier |
| [Contexte système](architecture/system-context.md) | Contexte et diagramme des modules |
| [Modèle de domaine](architecture/domain-model.md) | Missions, tâches, résultats, propositions et lots |
| [Cycle de vie](architecture/mission-lifecycle.md) | États et transitions |
| [Moteur de workflows](architecture/workflow-engine.md) | Séquence, dépendances, file et durabilité |
| [Intégration IA](architecture/ai-integration.md) | Fournisseurs, validation, budget et provenance |
| [Sécurité](architecture/security-model.md) | Identités, permissions et isolation |
| [Intégrations](architecture/ecosystem-integration.md) | Contrats inspectés et ports non raccordés |
| [Préparation opérationnelle](architecture/operational-readiness.md) | Déploiement local, preuves et limites |

Les [consignes](../AGENTS.md) décrivent les règles d’exécution. Le [standard OpenG7](standards/README.md)
et son bloc commun restent synchronisables indépendamment de l’architecture produit.
