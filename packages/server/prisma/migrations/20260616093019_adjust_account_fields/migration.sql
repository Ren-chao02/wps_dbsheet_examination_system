/*
  Warnings:

  - A unique constraint covering the columns `[student_id]` on the table `users` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[employee_id]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'UNSET');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ENABLED', 'DISABLED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'DISABLED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'PROCESSING', 'FINISHED', 'FAILED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "account_status" "AccountStatus" NOT NULL DEFAULT 'ENABLED',
ADD COLUMN     "class_room_id" TEXT,
ADD COLUMN     "department_id" TEXT,
ADD COLUMN     "employee_id" VARCHAR(64),
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "last_login_at" TIMESTAMP(3),
ADD COLUMN     "major_id" TEXT,
ADD COLUMN     "phone_number" VARCHAR(32),
ADD COLUMN     "remark" VARCHAR(512),
ADD COLUMN     "student_id" VARCHAR(64),
ADD COLUMN     "system_role_id" UUID;

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Major" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Major_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassRoom" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,
    "gradeLevel" INTEGER NOT NULL DEFAULT 1,
    "departmentId" TEXT NOT NULL,
    "majorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "classRoomId" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 0,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "status" "InvitationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentApplication" (
    "id" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "realName" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "gender" "Gender",
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportTask" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "task_name" VARCHAR(256),
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "errorFile" TEXT,
    "download_url" VARCHAR(512),
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ImportTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_roles" (
    "id" UUID NOT NULL,
    "role_code" VARCHAR(64) NOT NULL,
    "role_name" VARCHAR(128) NOT NULL,
    "role_type" VARCHAR(16) NOT NULL DEFAULT 'custom',
    "description" VARCHAR(512),
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_role_permissions" (
    "id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "module_code" VARCHAR(64) NOT NULL,

    CONSTRAINT "system_role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Major_departmentId_code_key" ON "Major"("departmentId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ClassRoom_code_key" ON "ClassRoom"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_code_key" ON "Invitation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "system_roles_role_code_key" ON "system_roles"("role_code");

-- CreateIndex
CREATE UNIQUE INDEX "system_role_permissions_role_id_module_code_key" ON "system_role_permissions"("role_id", "module_code");

-- CreateIndex
CREATE UNIQUE INDEX "users_student_id_key" ON "users"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_id_key" ON "users"("employee_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_major_id_fkey" FOREIGN KEY ("major_id") REFERENCES "Major"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_class_room_id_fkey" FOREIGN KEY ("class_room_id") REFERENCES "ClassRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_system_role_id_fkey" FOREIGN KEY ("system_role_id") REFERENCES "system_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Major" ADD CONSTRAINT "Major_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassRoom" ADD CONSTRAINT "ClassRoom_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassRoom" ADD CONSTRAINT "ClassRoom_majorId_fkey" FOREIGN KEY ("majorId") REFERENCES "Major"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_classRoomId_fkey" FOREIGN KEY ("classRoomId") REFERENCES "ClassRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentApplication" ADD CONSTRAINT "StudentApplication_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "Invitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentApplication" ADD CONSTRAINT "StudentApplication_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportTask" ADD CONSTRAINT "ImportTask_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_role_permissions" ADD CONSTRAINT "system_role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "system_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
