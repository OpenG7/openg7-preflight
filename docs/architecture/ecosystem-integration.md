# Intégrations de l’écosystème

Inspection locale initiale du 2 novembre 2026 :

| Projet | Constat et raccordement |
| --- | --- |
| openg7-agent-runtime | README/architecture de cadrage inspectés; pas de contrat exécutable trouvé; port futur |
| openg7-model-gateway | README/architecture de cadrage inspectés; pas de contrat exécutable trouvé; port fournisseur futur |
| openg7-funding-platform | Application réelle et préparation/publication propres présentes; aucune liaison Preflight configurée |
| openg7-social | Projet prototype inspecté; aucune liaison Preflight configurée |
| knowledge-core, ai-policy-engine, ai-evals, identity | Capacités non présumées; aucun raccordement livré |

Les occurrences « preflight » dans Funding désignent aussi ses propres contrôles
internes : elles ne prouvent aucune connexion à ce nouveau moteur.

Les deux workflows initiaux utilisent des missions synthétiques soumises par API.
La console distingue ces sources simulées des ports non connectés. Les contrats
d’entrée sont ceux de Preflight, pas une description des API existantes de Funding.

Les interfaces de [packages/integrations](../../packages/integrations/README.md)
définissent les extensions. Le transport initial est une API authentifiée avec
clés d’événement et versions source; les webhooks signés et la livraison sortante
automatique ne sont pas encore raccordés. Aucun accès direct aux bases métier.

Avant une connexion réelle à Funding : convenir du contrat d’activation et de
ses versions, configurer l’identité de service et ses permissions, puis vérifier
la remise et la revue des propositions avec les contrôles d’autorité de Funding.
