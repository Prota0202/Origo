-- Mandat SEPA (IBAN chez Stripe, pas en clair) + prélèvements 15 / fin de mois.

ALTER TABLE "Client" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "Client" ADD COLUMN "stripeSepaPaymentMethodId" TEXT;
ALTER TABLE "Client" ADD COLUMN "sepaIbanLast4" TEXT;
ALTER TABLE "Client" ADD COLUMN "sepaMandatId" TEXT;
ALTER TABLE "Client" ADD COLUMN "sepaMandatAccepteLe" TIMESTAMP(3);

CREATE UNIQUE INDEX "Client_stripeCustomerId_key" ON "Client"("stripeCustomerId");

CREATE TABLE "PrelevementSepa" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "periodeCle" TEXT NOT NULL,
    "montantCents" INTEGER NOT NULL,
    "statut" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "erreur" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrelevementSepa_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrelevementSepa_stripePaymentIntentId_key" ON "PrelevementSepa"("stripePaymentIntentId");
CREATE UNIQUE INDEX "PrelevementSepa_clientId_periodeCle_key" ON "PrelevementSepa"("clientId", "periodeCle");
CREATE INDEX "PrelevementSepa_statut_idx" ON "PrelevementSepa"("statut");

ALTER TABLE "PrelevementSepa" ADD CONSTRAINT "PrelevementSepa_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Order" ADD COLUMN "prelevementSepaId" TEXT;
CREATE INDEX "Order_prelevementSepaId_idx" ON "Order"("prelevementSepaId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_prelevementSepaId_fkey" FOREIGN KEY ("prelevementSepaId") REFERENCES "PrelevementSepa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
