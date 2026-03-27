-- Create enum for session status
CREATE TYPE "SessionStatus" AS ENUM ('scheduled', 'active', 'completed');

-- Create sessions table
CREATE TABLE "sessions" (
  "id" UUID NOT NULL,
  "candidate_id" UUID NOT NULL,
  "interviewer_id" UUID NOT NULL,
  "status" "SessionStatus" NOT NULL DEFAULT 'scheduled',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- Add indexes for query performance
CREATE INDEX "sessions_candidate_id_idx" ON "sessions"("candidate_id");
CREATE INDEX "sessions_status_idx" ON "sessions"("status");
