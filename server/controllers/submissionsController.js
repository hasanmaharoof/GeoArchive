// server/controllers/submissionsController.js
const db = require("../models/db");
const s3 = require("../services/spaces");
const { v4: uuidv4 } = require("uuid");

function toIntOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function toBool(v) {
  return v === "on" || v === true || v === "true" || v === "1";
}

function toTrimmedStringOrNull(v, maxLen) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function toFloatOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

async function submitRecord(req, res) {
  try {
    // requireAuth should have set req.user
    const uid = req.user?.uid;
    const username = req.user?.username;

    if (!uid) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // We display username around the site, so store username in submissions.user_id.
    // Fallback to uid only if username is missing due to server/user data issue.
    const userIdForDb =
      typeof username === "string" && username.trim() ? username.trim() : uid;

    const {
      caption,
      source,
      photographer,
      year,
      month,
      day,
      lat,
      lng,
      estimated,
      notes,
      location_confidence,
      // user_id intentionally ignored (client-controlled)
    } = req.body;

    console.log("submitRecord body:", {
      caption, source, photographer, year, month, day, lat, lng, estimated,
      hasFile: !!req.file,
      fileMime: req.file?.mimetype,
      fileSize: req.file?.size,
    });

    // Basic required fields
    const captionSafe = toTrimmedStringOrNull(caption, 500);
    const sourceSafe = toTrimmedStringOrNull(source, 500);
    const photographerSafe = toTrimmedStringOrNull(photographer, 200);
    const notesSafe = toTrimmedStringOrNull(notes, 5000);

    const VALID_CONFIDENCE = new Set(['exact', 'high', 'mid', 'low']);
    const confidenceSafe = VALID_CONFIDENCE.has(location_confidence) ? location_confidence : null;

    if (!captionSafe || !sourceSafe) {
      return res.status(400).json({
        error: "caption and source are required",
        code: "MISSING_REQUIRED_FIELDS",
        details: {
          caption_present: !!captionSafe,
          source_present: !!sourceSafe,
          raw_caption: req.body?.caption,
          raw_source: req.body?.source,
        },
      });
    }

    const yearInt = toIntOrNull(year);
    const monthInt = toIntOrNull(month);
    const dayInt = toIntOrNull(day);
    const estimatedBool = toBool(estimated);

    // Minimal date sanity checks
    if (yearInt !== null && (yearInt < 0 || yearInt > 1949)) {
      return res.status(400).json({ error: "Invalid year" });
    }
    if (monthInt !== null && (monthInt < 1 || monthInt > 12)) {
      return res.status(400).json({ error: "Invalid month" });
    }
    if (dayInt !== null && (dayInt < 1 || dayInt > 31)) {
      return res.status(400).json({ error: "Invalid day" });
    }

    // Validate coordinates properly
    const latNum = toFloatOrNull(lat);
    const lngNum = toFloatOrNull(lng);

    const hasLocation =
      latNum !== null &&
      lngNum !== null &&
      latNum >= -90 &&
      latNum <= 90 &&
      lngNum >= -180 &&
      lngNum <= 180;

    // ------------------------------
    // UPLOAD TO DIGITALOCEAN SPACES
    // ------------------------------
    let photoUrl = null;

    if (req.file) {
      // Best practice: trust magic-bytes verification (your verifyImageMagicBytes)
      // req.file.mimetype is still used only for ContentType/ext naming.
      const mime = req.file.mimetype || "";
      const ext = mime.includes("/") ? mime.split("/")[1] : "bin";

      const key = `submissions/pending/${uuidv4()}.${ext}`;

      await s3
        .putObject({
          Bucket: process.env.SPACES_BUCKET,
          Key: key,
          Body: req.file.buffer,
          ACL: "public-read",
          ContentType: mime || "application/octet-stream",
          CacheControl: "public, max-age=31536000, immutable",
          ContentDisposition: "inline",
        })
        .promise();

      photoUrl = `${process.env.SPACES_CDN}/${key}`;
    }

    // Insert into DB
    const result = await db.query(
      `INSERT INTO submissions (
        caption, source, photographer,
        year, month, day,
        geom, photo_url, estimated, location, user_id, status, notes,
        location_confidence
      )
      VALUES ($1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12, $13,
          $14)
      RETURNING *`,
      [
        captionSafe,
        sourceSafe,
        photographerSafe,
        yearInt,
        monthInt,
        dayInt,
        hasLocation ? `SRID=4326;POINT(${lngNum} ${latNum})` : null,
        photoUrl,
        estimatedBool,
        hasLocation,
        userIdForDb, // username (preferred) or uid fallback
        "pending",
        notesSafe,
        confidenceSafe,
      ]
    );

    return res
      .status(201)
      .json({ message: "Submission received", data: result.rows[0] });
  } catch (err) {
    console.error("Submission failed:", err?.message || err);
    return res.status(500).json({ error: "Submission failed" });
  }
}

module.exports = { submitRecord };