-- Fiche société éditable depuis l'admin (sans redéployer les env).

CREATE TABLE "Societe" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "adresse" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "telephone" TEXT NOT NULL DEFAULT '',
    "numeroTva" TEXT NOT NULL DEFAULT '',
    "horaires" TEXT NOT NULL DEFAULT 'Lun – Ven · 8h00 – 18h00',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Societe_pkey" PRIMARY KEY ("id")
);
