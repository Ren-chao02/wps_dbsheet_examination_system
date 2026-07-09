-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('scheduled', 'in_progress', 'completed', 'cancelled');

-- AlterEnum: Remove 'occupied' from ExamRoomStatus
BEGIN;
CREATE TYPE "ExamRoomStatus_new" AS ENUM ('available', 'maintenance');
ALTER TABLE "exam_rooms" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "exam_rooms" ALTER COLUMN "status" TYPE "ExamRoomStatus_new" USING ("status"::text::"ExamRoomStatus_new");
ALTER TYPE "ExamRoomStatus" RENAME TO "ExamRoomStatus_old";
ALTER TYPE "ExamRoomStatus_new" RENAME TO "ExamRoomStatus";
DROP TYPE "ExamRoomStatus_old";
ALTER TABLE "exam_rooms" ALTER COLUMN "status" SET DEFAULT 'available';
COMMIT;

-- Drop old foreign keys
ALTER TABLE "exam_room_students" DROP CONSTRAINT IF EXISTS "exam_room_students_room_id_fkey";
ALTER TABLE "exam_rooms" DROP CONSTRAINT IF EXISTS "exam_rooms_exam_id_fkey";

-- Drop old indexes
DROP INDEX IF EXISTS "exam_room_students_room_id_seat_number_key";
DROP INDEX IF EXISTS "exam_room_students_room_id_student_id_key";
DROP INDEX IF EXISTS "exam_rooms_exam_id_status_idx";

-- CreateTable: exam_room_assignments
CREATE TABLE "exam_room_assignments" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'scheduled',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_room_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: implicit many-to-many for AssignmentInvigilators
CREATE TABLE "_AssignmentInvigilators" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL
);

-- Create assignments for existing exam_room_students data
INSERT INTO "exam_room_assignments" ("id", "exam_id", "room_id", "status", "created_at", "updated_at")
SELECT gen_random_uuid(), er.exam_id, er.id, 'scheduled', NOW(), NOW()
FROM "exam_rooms" er
WHERE er.id IN (SELECT DISTINCT room_id FROM "exam_room_students")
  AND NOT EXISTS (SELECT 1 FROM "exam_room_assignments" era WHERE era.room_id = er.id);

-- Add assignment_id column to exam_room_students (nullable initially)
ALTER TABLE "exam_room_students" ADD COLUMN "assignment_id" UUID;

-- Backfill assignment_id for existing rows
UPDATE "exam_room_students" ers
SET "assignment_id" = era.id
FROM "exam_room_assignments" era
WHERE era.room_id = ers.room_id;

-- Drop old room_id column
ALTER TABLE "exam_room_students" DROP COLUMN "room_id";

-- Make assignment_id NOT NULL
ALTER TABLE "exam_room_students" ALTER COLUMN "assignment_id" SET NOT NULL;

-- Drop exam_id from exam_rooms
ALTER TABLE "exam_rooms" DROP COLUMN "exam_id";

-- Create new indexes
CREATE INDEX "exam_room_assignments_room_id_status_idx" ON "exam_room_assignments"("room_id", "status");
CREATE INDEX "exam_room_assignments_exam_id_status_idx" ON "exam_room_assignments"("exam_id", "status");
CREATE UNIQUE INDEX "exam_room_assignments_exam_id_room_id_key" ON "exam_room_assignments"("exam_id", "room_id");
CREATE UNIQUE INDEX "_AssignmentInvigilators_AB_unique" ON "_AssignmentInvigilators"("A", "B");
CREATE INDEX "_AssignmentInvigilators_B_index" ON "_AssignmentInvigilators"("B");
CREATE UNIQUE INDEX "exam_room_students_assignment_id_student_id_key" ON "exam_room_students"("assignment_id", "student_id");
CREATE UNIQUE INDEX "exam_room_students_assignment_id_seat_number_key" ON "exam_room_students"("assignment_id", "seat_number");
CREATE INDEX "exam_rooms_status_idx" ON "exam_rooms"("status");

-- Add new foreign keys
ALTER TABLE "exam_room_assignments" ADD CONSTRAINT "exam_room_assignments_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exam_room_assignments" ADD CONSTRAINT "exam_room_assignments_room_id_exam_room_assignment_room_fkey" FOREIGN KEY ("room_id") REFERENCES "exam_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exam_room_students" ADD CONSTRAINT "exam_room_students_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "exam_room_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "_AssignmentInvigilators" ADD CONSTRAINT "_AssignmentInvigilators_A_fkey" FOREIGN KEY ("A") REFERENCES "exam_room_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_AssignmentInvigilators" ADD CONSTRAINT "_AssignmentInvigilators_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
