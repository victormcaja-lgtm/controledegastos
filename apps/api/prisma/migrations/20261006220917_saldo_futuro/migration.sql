-- CreateEnum
CREATE TYPE "BillPaymentStatus" AS ENUM ('PAID', 'WAIVED');

-- AlterTable
ALTER TABLE "bill_payments" ADD COLUMN     "status" "BillPaymentStatus" NOT NULL DEFAULT 'PAID';

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "dailyBudgetCents" INTEGER,
ADD COLUMN     "openingBalanceCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "openingDate" DATE;

-- CreateTable
CREATE TABLE "cards" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "closingDay" INTEGER NOT NULL,
    "dueDay" INTEGER NOT NULL,
    "limitCents" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_purchases" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "purchasedOn" DATE NOT NULL,
    "note" VARCHAR(140),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cards_userId_idx" ON "cards"("userId");

-- CreateIndex
CREATE INDEX "card_purchases_userId_purchasedOn_idx" ON "card_purchases"("userId", "purchasedOn");

-- CreateIndex
CREATE INDEX "card_purchases_cardId_idx" ON "card_purchases"("cardId");

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_purchases" ADD CONSTRAINT "card_purchases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_purchases" ADD CONSTRAINT "card_purchases_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_purchases" ADD CONSTRAINT "card_purchases_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
