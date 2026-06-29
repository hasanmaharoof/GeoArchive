// server/server.js
require("dotenv").config({ path: __dirname + "/.env" });

const express = require("express");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");

// IMPORTANT: this file must NOT call admin.initializeApp.
// Requiring this guarantees Firebase Admin is initialized once, consistently.
require("./firebaseAdmin");

// -----------------------------
// App + Config
// -----------------------------
const app = express();
const PORT = process.env.PORT || 5000;

// -----------------------------
// Middleware
// -----------------------------
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": [
          "'self'",
          "https://www.gstatic.com",
          "https://www.googleapis.com",
          "https://apis.google.com",
        ],
        "style-src": ["'self'", "https:", "'unsafe-inline'"],
        "connect-src": [
          "'self'",
          "https://www.googleapis.com",
          "https://firestore.googleapis.com",
          "https://identitytoolkit.googleapis.com",
          "https://securetoken.googleapis.com",
          "https://www.gstatic.com",
          "https://openmediamap.firebaseapp.com",
        ],
        "frame-src": [
          "'self'",
          "https://openmediamap.firebaseapp.com",
          "https://apis.google.com",
        ],
        "img-src": ["'self'", "data:", "https:"],
        "font-src": ["'self'", "https:", "data:"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "frame-ancestors": ["'self'"],
        "upgrade-insecure-requests": [],
      },
    },
  })
);

// Improved CORS configuration with proper credentials support
app.use(
  cors({
    origin: [
      "http://openmediamap.com",
      "https://openmediamap.com",
      "http://www.openmediamap.com",
      "https://www.openmediamap.com",
      "http://localhost:5500",
      "http://127.0.0.1:5500",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://geoarchive.org",
      "https://geoarchive.org",
      "http://www.geoarchive.org",
      "https://www.geoarchive.org",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type", 
      "Authorization",
      "Cookie",
      "Set-Cookie"
    ],
    exposedHeaders: ["Set-Cookie"],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204
  })
);

app.use(express.json({ limit: "1mb" }));

// -----------------------------
// Imports
// -----------------------------
const requireAdmin = require("./middleware/requireAdmin");
const pool = require("./models/db");
const userRoutes = require("./routes/user");

// -----------------------------
// Static Files
// -----------------------------
app.use(express.static(path.join(__dirname, "..", "client")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "client", "index.html"));
});

app.get("/tags", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "client", "tags.html"));
});

// Admin frontend (if used)
app.use("/admin", express.static(path.join(__dirname, "admin")));

// -----------------------------
// Routes
// -----------------------------
// CORRECT - /api/user/:username
app.use("/api/user", userRoutes);
app.use("/user", userRoutes);
app.use("/api/submissions", require("./routes/submissions"));
app.use('/api/tags', require('./routes/tags'));
app.use('/api/forum', require('./routes/forum'));

app.get("/api/admin/actions", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, admin_username, action_type, record_id, created_at, reason
      FROM admin_actions
      ORDER BY created_at DESC
      LIMIT 500
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching admin logs:", err);
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

// -----------------------------
// Start Server
// -----------------------------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});