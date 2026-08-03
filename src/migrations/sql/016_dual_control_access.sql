CREATE TABLE IF NOT EXISTS tb_dual_control_access_request (
  id                          INT AUTO_INCREMENT PRIMARY KEY,
  accountability_log_entry_id INT NOT NULL,
  legal_basis                 VARCHAR(500) NOT NULL,
  approver_ids                JSON NOT NULL,
  status                      ENUM('pending', 'granted') NOT NULL DEFAULT 'pending',
  created_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
