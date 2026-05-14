// server/routes/submissions.js
const express = require('express');
const router = express.Router();
const { upload, verifyImageMagicBytes } = require('../middleware/upload');
const db = require('../models/db');
const { submitRecord } = require('../controllers/submissionsController');
const requireAdmin = require('../middleware/requireAdmin');
const requireAuth = require('../middleware/requireAuth');

// =============================================================
// Helper: Log admin actions
// =============================================================
async function logAdminAction(adminUsername, actionType, recordId, reason = null) {
  try {
    await db.query(
      `INSERT INTO admin_actions (admin_username, action_type, record_id, reason)
       VALUES ($1, $2, $3, $4)`,
      [adminUsername, actionType, recordId, reason]
    );
  } catch (err) {
    console.error('Admin action log failed:', err?.message || err);
  }
}

// Helper: validate numeric id param (prevents weird edge cases)
function parseIdParam(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid id' });
    return null;
  }
  return id;
}

// =============================================================
// PUBLIC ROUTES
// =============================================================

// Submit new record
router.post(
  "/submit",
  requireAuth,
  upload.single("photo"),
  verifyImageMagicBytes,
  submitRecord
);

// =============================================================
// Edit a record (public, authenticated)
// =============================================================
router.post('/:id/edit', requireAuth, async (req, res) => {
  const id = parseIdParam(req, res);
  if (!id) return;

  const editor = req.user.username;

  const {
    caption,
    source,
    photographer,
    year,
    month,
    day,
    estimated,
    location,
    notes,
    lat,
    lng,
    edit_summary
  } = req.body;

  // Validate edit_summary is provided and not empty
  if (!edit_summary || typeof edit_summary !== 'string' || edit_summary.trim().length === 0) {
    return res.status(400).json({ error: 'Edit summary is required' });
  }

  // Limit edit summary length
  const trimmedSummary = edit_summary.trim();
  if (trimmedSummary.length > 500) {
    return res.status(400).json({ error: 'Edit summary must be 500 characters or less' });
  }

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // ---------------------------------------------------------
    // 1) Fetch current record
    // ---------------------------------------------------------
    const currentRes = await client.query(
      `SELECT *
       FROM submissions
       WHERE id = $1 AND deleted = FALSE`,
      [id]
    );

    if (currentRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Record not found' });
    }

    const current = currentRes.rows[0];

    // ---------------------------------------------------------
    // 2) Sanitize and prepare new values
    // ---------------------------------------------------------
    const latNum = lat && lat !== '' ? parseFloat(lat) : null;
    const lngNum = lng && lng !== '' ? parseFloat(lng) : null;
    const yearNum = year && year !== '' ? parseInt(year, 10) : null;
    const monthNum = month && month !== '' ? parseInt(month, 10) : null;
    const dayNum = day && day !== '' ? parseInt(day, 10) : null;

    // Determine final values (new data takes precedence, fallback to current)
    const newCaption = caption ?? current.caption;
    const newSource = source ?? current.source;
    const newPhotographer = photographer ?? current.photographer;
    const newYear = yearNum ?? current.year;
    const newMonth = monthNum ?? current.month;
    const newDay = dayNum ?? current.day;
    const newEstimated = estimated ?? current.estimated;
    const newLocation = location ?? current.location;
    const newNotes = notes ?? current.notes;

    // ---------------------------------------------------------
    // 3) Check if this is the FIRST edit (no revisions exist)
    // ---------------------------------------------------------
    const countRes = await client.query(
      `SELECT COUNT(*) as count FROM submission_revisions WHERE submission_id = $1`,
      [id]
    );

    const isFirstEdit = parseInt(countRes.rows[0].count) === 0;

    // ---------------------------------------------------------
    // 4) If first edit, save ORIGINAL state as revision 0
    // ---------------------------------------------------------
    if (isFirstEdit) {
      // Get original uploader from submissions table
      const originalUploader = current.user_id || 'system';
      
      let origInsertQuery = `
        INSERT INTO submission_revisions (
          submission_id, revision_number, editor_username, edit_summary,
          caption, source, photographer, photo_url,
          year, month, day, estimated, location, notes, created_at
      `;
      
      let origInsertParams = [
        id, 0, originalUploader, null,  // revision_number=0, no edit_summary for original
        current.caption,
        current.source,
        current.photographer,
        current.photo_url,
        current.year,
        current.month,
        current.day,
        current.estimated,
        current.location,
        current.notes,
        current.created_at  // IMPORTANT: Use original submission timestamp
      ];

      // Add geom for original
      if (current.geom) {
        origInsertQuery += `, geom`;
        origInsertQuery += `)
        VALUES (
          $1,$2,$3,$4,
          $5,$6,$7,$8,
          $9,$10,$11,$12,$13,$14,$15,
          $16
        )`;
        origInsertParams.push(current.geom);
      } else {
        origInsertQuery += `, geom`;
        origInsertQuery += `)
        VALUES (
          $1,$2,$3,$4,
          $5,$6,$7,$8,
          $9,$10,$11,$12,$13,$14,$15,
          NULL
        )`;
      }

      await client.query(origInsertQuery, origInsertParams);
    }

    // ---------------------------------------------------------
    // 5) Save snapshot AFTER edit (the new state)
    // ---------------------------------------------------------
    const revRes = await client.query(
      `SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_rev
       FROM submission_revisions
       WHERE submission_id = $1`,
      [id]
    );

    const nextRevision = revRes.rows[0].next_rev;

    // Build the INSERT query dynamically to handle geom properly
    let insertQuery = `
      INSERT INTO submission_revisions (
        submission_id, revision_number, editor_username, edit_summary,
        caption, source, photographer, photo_url,
        year, month, day, estimated, location, notes
    `;
    
    let insertParams = [
      id, nextRevision, editor, trimmedSummary,
      newCaption,
      newSource,
      newPhotographer,
      current.photo_url,  // Photo never changes in edits
      newYear,
      newMonth,
      newDay,
      newEstimated,
      newLocation,
      newNotes
    ];

    // Add geom column and value if coordinates exist
    if (latNum != null && lngNum != null) {
      insertQuery += `, geom`;
      insertQuery += `)
      VALUES (
        $1,$2,$3,$4,
        $5,$6,$7,$8,
        $9,$10,$11,$12,$13,$14,
        ST_SetSRID(ST_MakePoint($15, $16), 4326)
      )`;
      insertParams.push(lngNum, latNum);
    } else {
      insertQuery += `, geom`;
      insertQuery += `)
      VALUES (
        $1,$2,$3,$4,
        $5,$6,$7,$8,
        $9,$10,$11,$12,$13,$14,
        NULL
      )`;
    }

    await client.query(insertQuery, insertParams);

    // ---------------------------------------------------------
    // 6) Update live record
    // ---------------------------------------------------------
    let updateQuery = `
      UPDATE submissions SET
        caption = $1,
        source = $2,
        photographer = $3,
        year = $4,
        month = $5,
        day = $6,
        estimated = $7,
        location = $8,
        notes = $9
    `;
    const params = [
      newCaption,
      newSource,
      newPhotographer,
      newYear,
      newMonth,
      newDay,
      newEstimated,
      newLocation,
      newNotes
    ];

    if (latNum != null && lngNum != null) {
      updateQuery += `, geom = ST_SetSRID(ST_MakePoint($10, $11), 4326)`;
      params.push(lngNum, latNum);  // ✅ CORRECT: ST_MakePoint(longitude, latitude)
    }

    updateQuery += ` WHERE id = $${params.length + 1}`;
    params.push(id);

    await client.query(updateQuery, params);

    await client.query('COMMIT');

    return res.json({ success: true, revision: nextRevision });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Edit failed:', err?.message || err);
    return res.status(500).json({ error: 'Edit failed' });
  } finally {
    client.release();
  }
});

// =============================================================
// Get revision history for a submission
// =============================================================
router.get('/:id/revisions', async (req, res) => {
  const submissionId = parseIdParam(req, res);
  if (!submissionId) return;

  try {
    const result = await db.query(
      `SELECT revision_number,
              editor_username,
              edit_summary,
              created_at,
              caption,
              source,
              photographer,
              photo_url,
              year,
              month,
              day,
              estimated,
              CASE WHEN geom IS NOT NULL THEN ST_X(geom) ELSE NULL END AS lng,
              CASE WHEN geom IS NOT NULL THEN ST_Y(geom) ELSE NULL END AS lat,
              location,
              notes
       FROM submission_revisions
       WHERE submission_id = $1
       ORDER BY revision_number DESC`,
      [submissionId]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error('Error fetching submission revisions:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// =============================================================
// Get recent activity (public endpoint for activity feed)
// =============================================================
router.get('/recent-activity', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const type = req.query.type || 'all'; // 'all', 'submissions', 'edits'

    // Fetch recent submissions (original submissions = revision_number 0)
    const submissionsQuery = `
      SELECT 
        'submission' as activity_type,
        s.id as submission_id,
        s.user_id as username,
        COALESCE(sr.created_at, s.created_at) as activity_timestamp,
        s.caption,
        s.year,
        s.month,
        s.day,
        s.estimated,
        s.photo_url,
        NULL as edit_summary,
        NULL as revision_number
      FROM submissions s
      LEFT JOIN submission_revisions sr ON s.id = sr.submission_id AND sr.revision_number = 0
      WHERE s.status = 'approved' AND s.deleted = FALSE
    `;

    // Fetch recent edits (revisions > 0)
    const editsQuery = `
      SELECT 
        'edit' as activity_type,
        s.id as submission_id,
        sr.editor_username as username,
        sr.created_at as activity_timestamp,
        s.caption,
        s.year,
        s.month,
        s.day,
        s.estimated,
        s.photo_url,
        sr.edit_summary,
        sr.revision_number
      FROM submission_revisions sr
      JOIN submissions s ON sr.submission_id = s.id
      WHERE s.status = 'approved' 
        AND s.deleted = FALSE 
        AND sr.revision_number > 0
    `;

    let finalQuery;
    if (type === 'submissions') {
      finalQuery = `${submissionsQuery} ORDER BY activity_timestamp DESC LIMIT $1`;
    } else if (type === 'edits') {
      finalQuery = `${editsQuery} ORDER BY activity_timestamp DESC LIMIT $1`;
    } else {
      // Combine both with UNION
      finalQuery = `
        (${submissionsQuery})
        UNION ALL
        (${editsQuery})
        ORDER BY activity_timestamp DESC
        LIMIT $1
      `;
    }

    const result = await db.query(finalQuery, [limit]);
    return res.json(result.rows);

  } catch (err) {
    console.error('Error fetching recent activity:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// =============================================================
// Fix revision timestamps (one-time migration endpoint)
// =============================================================
router.post('/admin/fix-revision-timestamps', requireAdmin, async (req, res) => {
  try {
    // Update revision_number=0 records to use the original submission timestamp
    const result = await db.query(`
      UPDATE submission_revisions sr
      SET created_at = s.created_at
      FROM submissions s
      WHERE sr.submission_id = s.id
        AND sr.revision_number = 0
        AND sr.created_at != s.created_at
    `);

    return res.json({ 
      success: true, 
      message: `Fixed ${result.rowCount} revision timestamps` 
    });

  } catch (err) {
    console.error('Error fixing revision timestamps:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get approved submissions
router.get('/approved', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, caption, source, photographer,
              year, month, day, estimated,
              photo_url,
              ST_X(geom) AS lng,
              ST_Y(geom) AS lat,
              location, notes, user_id, created_at
       FROM submissions
       WHERE status = 'approved'
         AND deleted = FALSE
       ORDER BY created_at DESC`
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('Error fetching approved submissions:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET count of approved, not deleted, year <= 1900
router.get('/count-pre1900', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT COUNT(*)::int AS count
      FROM submissions
      WHERE status = 'approved'
        AND deleted = false
        AND year IS NOT NULL
        AND year <= 1900
    `);

    res.json({ count: rows[0]?.count ?? 0 });
  } catch (err) {
    console.error('count-pre1900 error:', err);
    res.status(500).json({ error: 'Failed to fetch count' });
  }
});


// =============================================================
// ADMIN ROUTES
// =============================================================

// Get pending submissions
router.get('/admin/pending', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, caption, source, photographer,
              year, month, day, estimated,
              photo_url, user_id,
              ST_X(geom) AS lng,
              ST_Y(geom) AS lat,
              location, notes, created_at
       FROM submissions
       WHERE status = 'pending'
         AND deleted = FALSE
       ORDER BY created_at DESC`
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('Error fetching pending submissions:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -------------------------------------------------------------
// Approve submission (only from pending + not deleted)
// -------------------------------------------------------------
router.post('/admin/:id/approve', requireAdmin, async (req, res) => {
  const id = parseIdParam(req, res);
  if (!id) return;

  const adminUsername = req.user.username;

  try {
    const result = await db.query(
      `UPDATE submissions
       SET status = 'approved'
       WHERE id = $1
         AND status = 'pending'
         AND deleted = FALSE
       RETURNING id`,
      [id]
    );

    if (result.rowCount === 0) {
      // Either not found, or not eligible (already approved/rejected/deleted)
      return res.status(404).json({ error: 'Record not found or not pending' });
    }

    await logAdminAction(adminUsername, 'approve', id);
    return res.json({ message: 'Submission approved' });
  } catch (err) {
    console.error('Error approving submission:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -------------------------------------------------------------
// Reject submission (NOT a delete) (only from pending + not deleted)
// -------------------------------------------------------------
router.delete('/admin/:id/reject', requireAdmin, async (req, res) => {
  const id = parseIdParam(req, res);
  if (!id) return;

  const adminUsername = req.user.username;

  try {
    const result = await db.query(
      `UPDATE submissions
       SET status = 'rejected'
       WHERE id = $1
         AND status = 'pending'
         AND deleted = FALSE
       RETURNING id`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Record not found or not pending' });
    }

    await logAdminAction(adminUsername, 'reject', id);
    return res.json({ message: 'Submission rejected' });
  } catch (err) {
    console.error('Error rejecting submission:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -------------------------------------------------------------
// Soft delete submission (post-approval moderation)
// -------------------------------------------------------------
router.post('/admin/:id/soft-delete', requireAdmin, async (req, res) => {
  const id = parseIdParam(req, res);
  if (!id) return;

  const adminUsername = req.user.username;

  let reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!reason) reason = 'Deleted by admin';
  // Prevent very large reasons from bloating DB/logs
  if (reason.length > 500) reason = reason.slice(0, 500);

  try {
    const result = await db.query(
      `UPDATE submissions
       SET deleted = TRUE,
           delete_reason = $1,
           deleted_at = NOW()
       WHERE id = $2
         AND deleted = FALSE
       RETURNING id`,
      [reason, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Record not found or already deleted' });
    }

    await logAdminAction(adminUsername, 'delete', id, reason);
    return res.json({ success: true });
  } catch (err) {
    console.error('Error soft deleting submission:', err?.message || err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// =============================================================
module.exports = router;