-- Changement de mot de passe / compte coupé : les sessions déjà émises deviennent invalides.
ALTER TABLE "Staff" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Client" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
