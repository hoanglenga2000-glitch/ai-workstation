// routes/templates.js
const express = require('express');
const router = express.Router();
const { verifyToken, optionalAuth } = require('../middleware/auth');
const db = require('../config/database');

router.get('/', optionalAuth, async (req, res) => {
  const { category, search, featured, page = 1, limit = 20 } = req.query;
  const userId = req?.user?.id;

  let where = 'WHERE t.is_public = 1';
  const params = [];

  if (category) { where += ' AND t.category = ?'; params.push(category); }
  if (featured === 'true') { where += ' AND t.is_featured = 1'; }
  if (search) {
    where += ' AND (t.name LIKE ? OR t.description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

  const [templates] = await db.query(`
    SELECT
      t.*,
      ROUND(t.rating_sum / NULLIF(t.rating_count, 0), 1) AS avg_rating
    FROM agent_templates t
    ${where}
    ORDER BY t.is_featured DESC, t.usage_count DESC
    LIMIT ? OFFSET ?
  `, params);

  res.json({
    templates,
    page: parseInt(page),
    limit: parseInt(limit)
  });
});

router.get('/categories', async (req, res) => {
  const [categories] = await db.query(`
    SELECT category, COUNT(*) AS count
    FROM agent_templates
    WHERE is_public = 1
    GROUP BY category
    ORDER BY count DESC
  `);
  res.json(categories);
});

router.get('/:id', optionalAuth, async (req, res) => {
  const [[template]] = await db.query(`
    SELECT t.*,
      ROUND(t.rating_sum / NULLIF(t.rating_count, 0), 1) AS avg_rating
    FROM agent_templates t
    WHERE t.id = ? AND t.is_public = 1
  `, [req.params.id]);

  if (!template) return res.status(404).json({ error: '模板不存在' });
  res.json(template);
});

router.post('/:id/favorite', verifyToken, async (req, res) => {
  const [existing] = await db.query(
    'SELECT * FROM user_favorites WHERE user_id = ? AND template_id = ?',
    [req.user.id, req.params.id]
  );

  if (existing.length) {
    await db.query('DELETE FROM user_favorites WHERE user_id = ? AND template_id = ?',
      [req.user.id, req.params.id]);
    res.json({ favorited: false });
  } else {
    await db.query('INSERT INTO user_favorites (user_id, template_id) VALUES (?, ?)',
      [req.user.id, req.params.id]);
    res.json({ favorited: true });
  }
});

router.post('/:id/rate', verifyToken, async (req, res) => {
  const { rating, comment } = req.body;
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: '评分必须在 1-5 之间' });
  }

  await db.query(`
    INSERT INTO template_ratings (id, user_id, template_id, rating, comment)
    VALUES (UUID(), ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment)
  `, [req.user.id, req.params.id, rating, comment]);

  await db.query(`
    UPDATE agent_templates
    SET rating_sum = (SELECT SUM(rating) FROM template_ratings WHERE template_id = ?),
        rating_count = (SELECT COUNT(*) FROM template_ratings WHERE template_id = ?)
    WHERE id = ?
  `, [req.params.id, req.params.id, req.params.id]);

  res.json({ success: true });
});

module.exports = router;
