-- Force le changement des mots de passe de démo en production.

ALTER TABLE "Staff" ADD COLUMN "mdpAChanger" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Client" ADD COLUMN "mdpAChanger" BOOLEAN NOT NULL DEFAULT false;
