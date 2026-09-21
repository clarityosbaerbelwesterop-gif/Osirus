-- Bootstrap prerequisites for the ordered M1-M5 schema replay.
-- The durable schema is introduced in 001 through 005; this file deliberately
-- contains no application tables so it is safe to replay from an empty database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS osirus;
