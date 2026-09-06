-- Calendrier de domiciliation SEPA propre à chaque restaurant.
ALTER TABLE "Client" ADD COLUMN "sepaCalendrier" JSONB;
