## Socle commun OpenG7

<!-- openg7-standard: 1 -->

- Respecter la mission du dépôt. Le code, les manifests et les tests décrivent
  l'existant; une architecture cible ou une roadmap ne prouve pas une livraison.
- Avant modification : `git status --short`, instructions des chemins concernés,
  code utile et équivalents existants. Préserver les changements de l'utilisateur.
- Lire uniquement les références déclenchées par le chemin ou le sujet traité,
  même pour un test ou un package. Chercher avec `rg`, lire la section utile;
  ne pas charger tout `docs/`, les registres ou les historiques par défaut.
- Réutiliser les contrats publics; éviter cycles, imports privés entre domaines,
  duplication métier et refactorisations étrangères à la demande.
- Ne placer aucun secret ni donnée privée inutile dans Git, sorties, logs, tests
  ou documentation. Exemples synthétiques; droits vérifiés côté serveur.
- Respecter l'autorisation déjà donnée et son périmètre. Préparer et vérifier les
  changements locaux autorisés; une demande de code n'autorise pas une opération
  de production, un envoi externe, une publication ou une destruction de données.
- Commit, push et ouverture de PR seulement dans le cadre demandé par l’utilisateur;
  une autorisation déjà donnée reste valable pour cette même opération et portée.
- Pour un effet externe : cible, droits, entrées/sorties, limites, idempotence,
  audit et reprise explicites. Réconcilier un résultat incertain avant de relancer.
- Choisir les validations selon le changement et les scripts réellement présents.
  Tester le comportement et les échecs pertinents; une modification documentaire
  seule ne déclenche pas les suites applicatives, les seeds ou un déploiement.
- Mettre à jour la référence propriétaire et les consommateurs d'un contrat dans
  le même changement. Les différences locales justifient une mission, une stack
  effective ou un risque métier; elles ne recopient pas le socle.
- Terminer par le diff, les contrôles applicables et `git diff --check`. Rapporter
  résultat, validations exécutées, limites et opérations restantes, sans faux succès.
