-- Disposable test fixture from the existing dev database column definitions.
CREATE SCHEMA IF NOT EXISTS termsdb;
CREATE TABLE IF NOT EXISTS termsdb."DocusignEnvelope" (
  "id" varchar(255) NOT NULL,
  "docusignTemplateId" varchar(255) NOT NULL,
  "userId" bigint NOT NULL,
  "isCompleted" bigint NOT NULL,
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS termsdb."TermsForResource" (
  "id" varchar(255) NOT NULL,
  "reference" varchar(255) NOT NULL,
  "referenceId" varchar(255) NOT NULL,
  "tag" varchar(255) NOT NULL,
  "termsOfUseIds" uuid[] NOT NULL,
  "created" timestamptz NOT NULL,
  "createdBy" varchar(255) NOT NULL,
  "updated" timestamptz,
  "updatedBy" varchar(255),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS termsdb."TermsOfUse" (
  "id" uuid NOT NULL,
  "legacyId" bigint,
  "text" text,
  "typeId" bigint NOT NULL,
  "title" varchar(255) NOT NULL,
  "url" varchar(255),
  "agreeabilityTypeId" uuid NOT NULL DEFAULT '2c78f834-61f4-11ea-bd4f-3c15c2e2c206'::uuid,
  "created" timestamptz NOT NULL,
  "createdBy" varchar(255),
  "updated" timestamptz,
  "updatedBy" varchar(255),
  "deletedAt" timestamptz,
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS termsdb."TermsOfUseAgreeabilityType" (
  "id" uuid NOT NULL,
  "legacyId" bigint,
  "name" varchar(255) NOT NULL,
  "description" varchar(255) NOT NULL,
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS termsdb."TermsOfUseDependency" (
  "dependencyTermsOfUseId" uuid NOT NULL,
  "dependentTermsOfUseId" uuid NOT NULL,
  PRIMARY KEY ("dependencyTermsOfUseId", "dependentTermsOfUseId")
);
CREATE TABLE IF NOT EXISTS termsdb."TermsOfUseDocusignTemplateXref" (
  "termsOfUseId" uuid NOT NULL,
  "docusignTemplateId" varchar(255) NOT NULL,
  PRIMARY KEY ("termsOfUseId")
);
CREATE TABLE IF NOT EXISTS termsdb."TermsOfUseType" (
  "id" bigint NOT NULL,
  "name" varchar(255),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS termsdb."UserTermsOfUseBanXref" (
  "userId" bigint NOT NULL,
  "termsOfUseId" uuid NOT NULL,
  "created" timestamptz NOT NULL,
  PRIMARY KEY ("userId", "termsOfUseId")
);
CREATE TABLE IF NOT EXISTS termsdb."UserTermsOfUseXref" (
  "userId" bigint NOT NULL,
  "termsOfUseId" uuid NOT NULL,
  "created" timestamptz NOT NULL,
  PRIMARY KEY ("userId", "termsOfUseId")
);
