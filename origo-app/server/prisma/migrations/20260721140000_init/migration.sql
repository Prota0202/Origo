-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RoleStaff" AS ENUM ('DIRECTION', 'PREPARATION', 'LIVREUR');

-- CreateEnum
CREATE TYPE "StatutCommande" AS ENUM ('CONFIRMEE', 'PREPAREE', 'EN_LIVRAISON', 'LIVREE', 'LIVREE_PARTIELLEMENT', 'ANNULEE');

-- CreateEnum
CREATE TYPE "TypeMouvementStock" AS ENUM ('ENTREE', 'SORTIE_COMMANDE', 'RETOUR', 'AJUSTEMENT');

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "motDePasseHash" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "role" "RoleStaff" NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "motDePasseHash" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "ville" TEXT,
    "email" TEXT,
    "telephone" TEXT,
    "adresse" TEXT,
    "numeroTva" TEXT,
    "minCartons" INTEGER NOT NULL DEFAULT 5,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "categorie" TEXT NOT NULL,
    "unitesParCarton" INTEGER NOT NULL,
    "prixCarton" DECIMAL(10,2) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "seuilAlerte" INTEGER NOT NULL DEFAULT 10,
    "photoUrl" TEXT,
    "remiseSeuil" INTEGER,
    "remisePourcent" DECIMAL(5,2),
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogEntry" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "prixNegocie" DECIMAL(10,2),
    "visible" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CatalogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientFavori" (
    "clientId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "ClientFavori_pkey" PRIMARY KEY ("clientId","productId")
);

-- CreateTable
CREATE TABLE "ClientNote" (
    "clientId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "texte" TEXT NOT NULL,

    CONSTRAINT "ClientNote_pkey" PRIMARY KEY ("clientId","productId")
);

-- CreateTable
CREATE TABLE "PrixPalier" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "seuil" INTEGER NOT NULL,
    "prix" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "PrixPalier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "statut" "StatutCommande" NOT NULL DEFAULT 'CONFIRMEE',
    "cartonsTotal" INTEGER NOT NULL,
    "totalHT" DECIMAL(12,2) NOT NULL,
    "payee" BOOLEAN NOT NULL DEFAULT false,
    "dateLivraisonPrevue" TIMESTAMP(3),
    "photoLivraisonUrl" TEXT,
    "noteLivraison" TEXT,
    "livreParId" TEXT,
    "motifAnnulation" TEXT,
    "annuleeLe" TIMESTAMP(3),
    "modifieeLe" TIMESTAMP(3),
    "livreeLe" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "nomSnapshot" TEXT NOT NULL,
    "quantiteCartons" INTEGER NOT NULL,
    "prixUnitaire" DECIMAL(10,2) NOT NULL,
    "livree" BOOLEAN,
    "coche" BOOLEAN NOT NULL DEFAULT false,
    "cocheLe" TIMESTAMP(3),
    "prepareParId" TEXT,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMouvement" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "TypeMouvementStock" NOT NULL,
    "quantite" INTEGER NOT NULL,
    "stockApres" INTEGER NOT NULL,
    "orderId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMouvement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemandeProduit" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "traite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemandeProduit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetourCommande" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "motif" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetourCommande_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetourLigne" (
    "id" TEXT NOT NULL,
    "retourId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantite" INTEGER NOT NULL,
    "remisEnStock" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RetourLigne_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "nom" TEXT NOT NULL,
    "valeur" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("nom")
);

-- CreateIndex
CREATE UNIQUE INDEX "Staff_code_key" ON "Staff"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Client_code_key" ON "Client"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_categorie_idx" ON "Product"("categorie");

-- CreateIndex
CREATE INDEX "Product_actif_idx" ON "Product"("actif");

-- CreateIndex
CREATE INDEX "CatalogEntry_clientId_idx" ON "CatalogEntry"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogEntry_clientId_productId_key" ON "CatalogEntry"("clientId", "productId");

-- CreateIndex
CREATE INDEX "PrixPalier_clientId_productId_idx" ON "PrixPalier"("clientId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PrixPalier_clientId_productId_seuil_key" ON "PrixPalier"("clientId", "productId", "seuil");

-- CreateIndex
CREATE UNIQUE INDEX "Order_numero_key" ON "Order"("numero");

-- CreateIndex
CREATE INDEX "Order_clientId_idx" ON "Order"("clientId");

-- CreateIndex
CREATE INDEX "Order_statut_idx" ON "Order"("statut");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Order_updatedAt_idx" ON "Order"("updatedAt");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "StockMouvement_productId_idx" ON "StockMouvement"("productId");

-- CreateIndex
CREATE INDEX "StockMouvement_createdAt_idx" ON "StockMouvement"("createdAt");

-- CreateIndex
CREATE INDEX "DemandeProduit_traite_idx" ON "DemandeProduit"("traite");

-- AddForeignKey
ALTER TABLE "CatalogEntry" ADD CONSTRAINT "CatalogEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogEntry" ADD CONSTRAINT "CatalogEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFavori" ADD CONSTRAINT "ClientFavori_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFavori" ADD CONSTRAINT "ClientFavori_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrixPalier" ADD CONSTRAINT "PrixPalier_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrixPalier" ADD CONSTRAINT "PrixPalier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_livreParId_fkey" FOREIGN KEY ("livreParId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_prepareParId_fkey" FOREIGN KEY ("prepareParId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMouvement" ADD CONSTRAINT "StockMouvement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMouvement" ADD CONSTRAINT "StockMouvement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandeProduit" ADD CONSTRAINT "DemandeProduit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandeProduit" ADD CONSTRAINT "DemandeProduit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetourCommande" ADD CONSTRAINT "RetourCommande_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetourLigne" ADD CONSTRAINT "RetourLigne_retourId_fkey" FOREIGN KEY ("retourId") REFERENCES "RetourCommande"("id") ON DELETE CASCADE ON UPDATE CASCADE;

