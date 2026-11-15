CREATE DATABASE IF NOT EXISTS uiflowlabs
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE uiflowlabs;

CREATE TABLE IF NOT EXISTS contact_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL,
  service VARCHAR(100) NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_contact_messages_created_at (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS site_content (
  id TINYINT UNSIGNED NOT NULL,
  published_content JSON NOT NULL,
  draft_content JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  published_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT chk_site_content_singleton CHECK (id = 1)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS site_content_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  content JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_site_content_history_created_at (created_at)
) ENGINE=InnoDB;
