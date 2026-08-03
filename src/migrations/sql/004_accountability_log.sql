CREATE TABLE IF NOT EXISTS tb_accountability_log (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  action_type  VARCHAR(100) NOT NULL,
  ip_address   VARCHAR(45) NOT NULL,
  metadata     JSON NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
