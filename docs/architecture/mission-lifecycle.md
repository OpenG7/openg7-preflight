# Cycle de vie

```mermaid
stateDiagram-v2
  [*] --> received
  received --> planning
  planning --> ready
  ready --> running
  running --> waiting_input
  waiting_input --> ready: informations fournies
  running --> waiting_dependency
  waiting_dependency --> ready
  running --> review_ready
  review_ready --> completed: décision signalée par application source
  running --> failed: tentatives épuisées
  failed --> ready: reprise autorisée
  ready --> cancelled
  running --> cancelled
  review_ready --> superseded: nouvelle version source
  running --> superseded: nouvelle version source
```

Ce diagramme montre les parcours principaux; les transitions autorisées sont
définies dans [workflows.ts](../../packages/engine/src/workflows.ts).
`review_ready` signifie préparation prête, jamais approbation administrative.
`completed` clôt le suivi opérationnel après notification de la source; il ne
prouve pas une prestation livrée.

Une tâche a son propre état et ses tentatives. Une annulation ou une nouvelle
version invalide les exécutions en vol; un ancien résultat ne doit plus devenir
une proposition courante. Les erreurs sont conservées et les reprises auditées.
