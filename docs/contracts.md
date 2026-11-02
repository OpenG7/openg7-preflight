# Contrats versionnés

Source de vérité : [packages/contracts](../packages/contracts/src/index.ts).
Enveloppes strictes `schemaVersion: "1.0"`; versions inconnues et champs inattendus
sont refusés. Les versions source sont des entiers positifs.

```json
{
  "schemaVersion": "1.0",
  "eventId": "synthetic-activation-1",
  "tenantId": "openg7-demo",
  "source": {
    "application": "funding-platform",
    "subjectType": "sponsorship",
    "subjectId": "synthetic-engagement-1",
    "version": 1
  },
  "workflow": { "type": "sponsorship-preparation-v1", "version": "1.0" },
  "priority": "normal",
  "constraints": { "humanApprovalRequired": true, "maxCostUsd": 0.5 },
  "input": {
    "title": "Atelier synthétique",
    "description": "Présentation à préparer",
    "benefits": ["Brouillon de présentation Web"]
  }
}
```

`missionId` est optionnel; Preflight en génère un si absent. `eventId` déduplique
les livraisons; la clé source/version/workflow évite aussi de refaire une même
préparation. Une clé réutilisée avec un contenu différent est un conflit.
`input` contient uniquement le matériel nécessaire à la préparation.

Social utilise `application: "openg7-social"`, le workflow
`editorial-brief-preparation-v1`, version `1.0`, et `input.topic`.

Les limites par défaut sont 0,50 USD, 30 secondes et 3 tentatives. Les enveloppes
refusent les budgets supérieurs à 100 USD, les délais supérieurs à 120 secondes
et plus de 5 tentatives. Ces plafonds techniques ne remplacent pas une politique
tenant de production. `humanApprovalRequired` reste toujours vrai.

Les événements initiaux sont `mission.submitted` et `source.updated` avec identifiant
unique et version de schéma. Les résultats possèdent une provenance et un schéma
de sortie strict; une réponse IA invalide ne devient pas un résultat de brouillon.

L’enveloppe mission.submitted contient `schemaVersion`, `eventId`, `type` et
`mission` (le contrat complet ci-dessus). Exemple de notification d’obsolescence :

```json
{
  "schemaVersion": "1.0",
  "eventId": "synthetic-source-update-2",
  "type": "source.updated",
  "tenantId": "openg7-demo",
  "source": {
    "application": "funding-platform",
    "subjectType": "sponsorship",
    "subjectId": "synthetic-engagement-1",
    "version": 2
  }
}
```
