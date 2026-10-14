-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "scenario" VARCHAR(128),
ADD COLUMN     "scenario_order" INTEGER;

-- CreateIndex
CREATE INDEX "questions_scenario_scenario_order_idx" ON "questions"("scenario", "scenario_order");
