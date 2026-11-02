# Ajouter un workflow

1. Définir le type/version, l’application autorisée, les entrées requises et la
   capacité de préparation dans le registre de workflows.
2. Valider les contrats propres à la source; ne pas déplacer ses règles de
   paiement, consentement ou publication dans l’ordonnanceur.
3. Réutiliser le plan et les exécutants existants quand la capacité suffit.
   Une nouvelle capacité doit avoir entrée/sortie, limites, outils permis et
   conditions d’échec explicites.
4. Tester entrée valide/manquante/invalide, résultat, provenance, reprise,
   tenant et application interdits, nouvelle version et obsolescence.
5. Exposer le type dans la configuration et documenter la connexion réelle ou simulée.

Le workflow Social fournit la preuve de réutilisation : une définition éditoriale
et un contrat d’entrée différents utilisent les mêmes missions, cinq étapes,
worker, résultats, propositions, erreurs et briefing que le parcours Funding.
L’ajout ne doit pas modifier les contrôleurs HTTP ni les algorithmes du scheduler.

Référence propriétaire : [workflows.ts](../packages/engine/src/workflows.ts).
