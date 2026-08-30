const express = require("express");
const adminController = require("../controllers/adminController");
const { authenticate, requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get("/submissions", adminController.listSubmissions);
router.patch("/submissions/:id/status", adminController.updateSubmissionStatus);

module.exports = router;
