-- Rounds are started and ended by an admin; everyone else scores the live round.
ALTER TABLE "Round" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'upcoming';
ALTER TABLE "Round" ADD COLUMN "startedAt" TIMESTAMP(3);
ALTER TABLE "Round" ADD COLUMN "endedAt" TIMESTAMP(3);

-- Stamped the first time a match is seen final; drives the "match closed" alerts.
ALTER TABLE "Match" ADD COLUMN "closedAt" TIMESTAMP(3);

-- Key/value trip settings (lodging door codes etc.) kept out of the source repo.
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);
