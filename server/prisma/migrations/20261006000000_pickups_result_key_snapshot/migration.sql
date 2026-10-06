-- Additive only. No rows are deleted or rewritten.

-- Explicit pickups: a Score row may now carry no stroke count.
ALTER TABLE "Score" ALTER COLUMN "strokes" DROP NOT NULL;
ALTER TABLE "Score" ADD COLUMN "pickup" BOOLEAN NOT NULL DEFAULT false;

-- Identity of the final result a closedAt stamp refers to, so corrected
-- finals alert again and repeats do not.
ALTER TABLE "Match" ADD COLUMN "resultKey" TEXT;

-- Frozen scoring basis captured when a round is started.
ALTER TABLE "Round" ADD COLUMN "scoringSnapshot" JSONB;
