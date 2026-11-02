# Modèle de domaine

Une mission associe un tenant, une application, un objet et sa version, un workflow
versionné, une priorité, des contraintes et une entrée. Son état opérationnel est
distinct de tout statut commercial. Identifiants et versions source servent à la
déduplication et à la détection d’obsolescence.

Les tâches composent un graphe acyclique. Elles conservent dépendances, tentatives,
erreurs, bail et résultat intermédiaire. Un résultat validé porte sa provenance et
sa version; un changement de l’objet source rend les anciens résultats obsolètes.

Une ReviewProposal rassemble objet/version, références de résultats, contrôles,
anomalies, explications et conditions de revue. Elle reste une proposition.

Un lot conserve une sélection versionnée de propositions, des critères explicites
et les exclusions. L’export revérifie les versions et n’exécute aucune décision.
Une exception sensible ne doit pas rejoindre silencieusement un lot favorable.

Les événements d’historique et d’accès tracent les acteurs et identifiants de
corrélation, sans enregistrer de jeton ni de clé fournisseur. Les consultations
du briefing possèdent un point de reprise persistant par personne et tenant.

Schéma propriétaire : [migration SQL](../../migrations/001_preflight.sql).
Enveloppes publiques : [contrats](../contracts.md).
