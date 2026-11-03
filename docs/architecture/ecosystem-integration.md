# Intégrations de l’écosystème

Inspection locale initiale du 2 novembre 2026 :

| Projet | Constat et raccordement |
| --- | --- |
| openg7-agent-runtime | README/architecture de cadrage inspectés; pas de contrat exécutable trouvé; port futur |
| openg7-model-gateway | README/architecture de cadrage inspectés; pas de contrat exécutable trouvé; port fournisseur futur |
| openg7-funding-platform | Connecteur transactionnel, relais et import privé implémentés dans Funding; recette locale réelle, production non qualifiée |
| openg7-social | Projet prototype inspecté; aucune liaison Preflight configurée |
| knowledge-core, ai-policy-engine, ai-evals, identity | Capacités non présumées; aucun raccordement livré |

Les occurrences « preflight » dans Funding désignent aussi ses propres contrôles
internes : elles ne prouvent aucune connexion à ce nouveau moteur.

Les deux workflows initiaux et la recette inter-dépôts utilisent des données synthétiques.
La console distingue ces sources simulées des ports non connectés. Les contrats
d’entrée sont ceux de Preflight, pas une description des API existantes de Funding.

Les interfaces de [packages/integrations](../../packages/integrations/README.md)
définissent les extensions. Le transport initial est une API authentifiée avec
clés d’événement et versions source; les webhooks signés et la livraison sortante
automatique ne sont pas encore raccordés. Aucun accès direct aux bases métier.

Le contrat d’activation utilise un snapshot minimisé de l’engagement et une
révision monotone propre au connecteur. Avant production : provisionner
l’identité réelle, configurer les permissions et secrets, puis qualifier le
transport et le retour vers les décisions métier Funding.
