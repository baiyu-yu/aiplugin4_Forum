const express = require('express');
const { getDb } = require('../database/init');

const router = express.Router();

/**
 * GET /api/activity
 * Get activity changes since last check
 */
router.get('/', (req, res) => {
    const userId = req.user.id;
    const db = getDb();

    // Get cursor
    const cursor = db.prepare('SELECT * FROM activity_cursors WHERE user_id = ?').get(userId);
    const lastId = cursor ? cursor.last_activity_id : 0;

    // Get new activities
    const activities = db.prepare(`
        SELECT * FROM activity_log 
        WHERE target_user_id = ? AND id > ?
        ORDER BY id ASC
        LIMIT 100
    `).all(userId, lastId);

    // Get new cursor
    const newCursorId = activities.length > 0 ? activities[activities.length - 1].id : lastId;

    // Update cursor
    db.prepare(`
        INSERT INTO activity_cursors (user_id, last_activity_id, last_checked_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET last_activity_id = ?, last_checked_at = datetime('now')
    `).run(userId, newCursorId, newCursorId);

    // Build summary
    const summary = {
        total_new_votes: 0,
        total_new_comments: 0,
        total_new_replies: 0,
        posts_affected: new Set()
    };

    const changes = activities.map(a => {
        const detail = a.detail ? JSON.parse(a.detail) : {};
        
        if (a.action_type === 'vote') summary.total_new_votes++;
        if (a.action_type === 'new_comment') summary.total_new_comments++;
        if (a.action_type === 'new_reply') summary.total_new_replies++;
        if (a.post_id) summary.posts_affected.add(a.post_id);

        return {
            type: a.action_type,
            post_id: a.post_id,
            comment_id: a.comment_id,
            detail,
            timestamp: a.created_at
        };
    });

    res.json({
        cursor: newCursorId,
        changes,
        summary: {
            ...summary,
            posts_affected: [...summary.posts_affected]
        },
        has_more: activities.length >= 100
    });
});

/**
 * GET /api/activity/since/:cursor
 * Get activities since a specific cursor
 */
router.get('/since/:cursor', (req, res) => {
    const userId = req.user.id;
    const sinceCursor = parseInt(req.params.cursor) || 0;
    const db = getDb();

    const activities = db.prepare(`
        SELECT * FROM activity_log 
        WHERE target_user_id = ? AND id > ?
        ORDER BY id ASC
        LIMIT 100
    `).all(userId, sinceCursor);

    const newCursorId = activities.length > 0 ? activities[activities.length - 1].id : sinceCursor;

    const changes = activities.map(a => {
        const detail = a.detail ? JSON.parse(a.detail) : {};
        return {
            type: a.action_type,
            post_id: a.post_id,
            comment_id: a.comment_id,
            detail,
            timestamp: a.created_at
        };
    });

    res.json({
        cursor: newCursorId,
        changes,
        has_more: activities.length >= 100
    });
});

/**
 * GET /api/activity/peek
 * Peek at activity count without updating cursor
 */
router.get('/peek', (req, res) => {
    const userId = req.user.id;
    const db = getDb();

    const cursor = db.prepare('SELECT * FROM activity_cursors WHERE user_id = ?').get(userId);
    const lastId = cursor ? cursor.last_activity_id : 0;

    const count = db.prepare(`
        SELECT COUNT(*) as count FROM activity_log 
        WHERE target_user_id = ? AND id > ?
    `).get(userId, lastId);

    res.json({ pending_count: count.count });
});

module.exports = router;
