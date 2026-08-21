PRAGMA foreign_keys = ON;

ALTER TABLE storage_asset_records
  ADD COLUMN properties_json TEXT NOT NULL DEFAULT '{}';
