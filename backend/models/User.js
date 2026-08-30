const db = require("../config/database");

function findByEmail(email) {
  return db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(String(email).toLowerCase());
}

module.exports = { findByEmail };
