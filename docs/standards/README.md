# Standard des consignes OpenG7

À lire pour modifier ou synchroniser la gouvernance. Source canonique :
`openg7-project-template`; chaque dépôt conserve une copie autonome du socle.

## Organisation

- `AGENTS.md` : mission et état réel, socle commun inclus, invariants locaux,
  lectures conditionnelles et validation. Aucune dépendance à un dépôt voisin.
- AGENTS imbriqué : règles propres à son chemin; il complète ses parents.
- Architecture : frontières et décisions propres au projet, sans manuel copié.
- Référence métier/runbook/registre : détail lu uniquement pour la tâche concernée.
- Instructions d'outil et skills : entrées courtes vers ces sources, sans copie
  du socle, numéros de ligne ni chargement récursif des guides.

Le [socle canonique](agent-common.md) est inclus entre les marqueurs
`openg7:common:start` et `openg7:common:end` de l'AGENTS racine. Ne pas le relire
pendant une tâche ordinaire. Les traductions destinées aux humains sont permises;
une seule langue de consignes suffit au contexte de l'agent.

## Budgets et exceptions

Plafonds UTF-8 : racine **8 Kio**, AGENTS local **6 Kio**, chaîne de parents
**16 Kio**, entrée d'outil/skill **4 Kio**. Viser moins que ces maxima.
Les références volumineuses restent conditionnelles et se lisent par section.
Les octets sont une mesure reproductible de volume, pas un compte de tokens
ni une estimation de coût; comparer des tokens exige le même tokenizer.

Toute différence décrit sa portée et sa justification dans la mission,
l'architecture ou le guide métier propriétaire. Une contrainte Stripe appartient
au financement, une règle de résidence au gateway, un sélecteur UI à son produit.
Les plafonds communs ne se relèvent pas localement pour absorber une duplication.

## Contrôle et synchronisation

Depuis chaque dépôt : `node scripts/check-project-standards.mjs` (`--json`
pour le rapport). Le contrôle vérifie socle, sections, budgets, liens Markdown
locaux et ancres des consignes, instructions d'outil et skills. Il est sans
dépendance, réseau ni mutation. Il ne prouve pas la conformité métier du code.
Le parseur couvre liens directs, titres ATX et ancres HTML; il ignore les exemples
en blocs de code. Les guides liés sont vérifiés comme destinations, sans exploration
récursive de toute la documentation. Les contrôles métier existants restent requis.

Depuis le template : `node scripts/sync-openg7-standards.mjs --target <depot>`.
`--check` détecte la dérive; `--dry-run` prévisualise; ces deux modes n'écrivent rien.
Seuls le bloc commun et les fichiers gérés par `scripts/sync-manifest.json`
sont synchronisés. La mission, l'architecture, les références métier, les skills
et les workflows applicatifs restent locaux. Un AGENTS sans marqueurs exige une
migration explicite pour identifier sa mission avant la première synchronisation.
