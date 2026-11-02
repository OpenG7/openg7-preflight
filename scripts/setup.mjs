import { copyFileSync, constants, existsSync } from 'node:fs';
if (existsSync('.env')) console.log('.env déjà présent; conservé.');
else { copyFileSync('.env.example', '.env', constants.COPYFILE_EXCL); console.log('.env local créé depuis .env.example.'); }
