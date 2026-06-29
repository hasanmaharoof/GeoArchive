const express = require('express');
const router = express.Router();
const db = require('../models/db');
const requireAuth = require('../middleware/requireAuth');
const requireAdmin = require('../middleware/requireAdmin');

function toSlug(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// GET /api/tags — list all tags with record count
router.get('/', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT t.id, t.name, t.slug, t.description, t.created_by, t.created_at,
             COUNT(st.submission_id)::int AS record_count
      FROM tags t
      LEFT JOIN submission_tags st ON st.tag_id = t.id
      GROUP BY t.id
      ORDER BY t.name ASC
    `);
    return res.json(result.rows);
  } catch (err) {
    console.error('Error fetching tags:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tags — create a new tag
router.post('/', requireAuth, async (req, res) => {
  const { name, description } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Tag name is required' });
  }
  if (name.trim().length > 100) {
    return res.status(400).json({ error: 'Tag name must be 100 characters or less' });
  }
  if (description && typeof description === 'string' && description.length > 300) {
    return res.status(400).json({ error: 'Description must be 300 characters or less' });
  }

  const slug = toSlug(name);
  if (!slug) {
    return res.status(400).json({ error: 'Tag name must contain at least one alphanumeric character' });
  }

  try {
    const result = await db.query(
      `INSERT INTO tags (name, slug, description, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, slug, description, created_by, created_at`,
      [name.trim(), slug, description?.trim() || null, req.user.username]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A tag with that name already exists' });
    }
    console.error('Error creating tag:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tags/:slug — tag info + all records with that tag
router.get('/:slug', async (req, res) => {
  try {
    const tagResult = await db.query(
      `SELECT id, name, slug, description, created_by, created_at FROM tags WHERE slug = $1`,
      [req.params.slug]
    );
    if (tagResult.rowCount === 0) {
      return res.status(404).json({ error: 'Tag not found' });
    }
    const tag = tagResult.rows[0];

    const recordsResult = await db.query(
      `SELECT s.id, s.caption, s.source, s.photographer, s.photo_url,
              ST_X(s.geom) AS lng, ST_Y(s.geom) AS lat,
              s.year, s.month, s.day, s.estimated, s.location,
              s.notes, s.user_id, s.created_at, s.location_confidence, s.direction,
              st.tagged_by, st.tagged_at
       FROM submissions s
       JOIN submission_tags st ON st.submission_id = s.id
       WHERE st.tag_id = $1
         AND s.status = 'approved'
         AND s.deleted = FALSE
       ORDER BY s.created_at DESC`,
      [tag.id]
    );

    return res.json({ tag, records: recordsResult.rows });
  } catch (err) {
    console.error('Error fetching tag records:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tags/:id/apply — apply a tag to a record
router.post('/:id/apply', requireAuth, async (req, res) => {
  const tagId = parseInt(req.params.id, 10);
  const submissionId = parseInt(req.body.submission_id, 10);

  if (!Number.isInteger(tagId) || tagId <= 0) {
    return res.status(400).json({ error: 'Invalid tag id' });
  }
  if (!Number.isInteger(submissionId) || submissionId <= 0) {
    return res.status(400).json({ error: 'Invalid submission_id' });
  }

  try {
    // Verify tag exists
    const tagCheck = await db.query('SELECT id FROM tags WHERE id = $1', [tagId]);
    if (tagCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    // Verify record exists and is approved
    const recCheck = await db.query(
      `SELECT id FROM submissions WHERE id = $1 AND status = 'approved' AND deleted = FALSE`,
      [submissionId]
    );
    if (recCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }

    await db.query(
      `INSERT INTO submission_tags (submission_id, tag_id, tagged_by)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [submissionId, tagId, req.user.username]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error('Error applying tag:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/tags/:id/records/:submissionId — remove tag from a record
router.delete('/:id/records/:submissionId', requireAuth, async (req, res) => {
  const tagId = parseInt(req.params.id, 10);
  const submissionId = parseInt(req.params.submissionId, 10);

  if (!Number.isInteger(tagId) || tagId <= 0 || !Number.isInteger(submissionId) || submissionId <= 0) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    await db.query(
      `DELETE FROM submission_tags WHERE tag_id = $1 AND submission_id = $2`,
      [tagId, submissionId]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('Error removing tag:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/tags/:id — delete a tag entirely (admin only)
router.delete('/:id', requireAdmin, async (req, res) => {
  const tagId = parseInt(req.params.id, 10);
  if (!Number.isInteger(tagId) || tagId <= 0) {
    return res.status(400).json({ error: 'Invalid tag id' });
  }

  try {
    const result = await db.query('DELETE FROM tags WHERE id = $1 RETURNING id', [tagId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Tag not found' });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('Error deleting tag:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
