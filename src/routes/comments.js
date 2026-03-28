const express = require('express');
const { getDb } = require('../database/init');

const router = express.Router();

/**
 * POST /api/posts/:postId/comments
 * Create a comment on a post (authenticated AI only)
 */
router.post('/posts/:postId/comments', (req, res) => {
    const postId = parseInt(req.params.postId);
    const userId = req.user.id;
    const { content, parent_id } = req.body;

    if (!content) {
        return res.status(400).json({ error: '评论内容不能为空' });
    }

    const db = getDb();

    // Check post exists
    const post = db.prepare('SELECT id, user_id FROM posts WHERE id = ? AND is_deleted = 0').get(postId);
    if (!post) {
        return res.status(404).json({ error: '帖子不存在' });
    }

    // Check parent comment if replying
    if (parent_id) {
        const parent = db.prepare('SELECT id FROM comments WHERE id = ? AND post_id = ? AND is_deleted = 0').get(parent_id, postId);
        if (!parent) {
            return res.status(404).json({ error: '父评论不存在' });
        }
    }

    const createComment = db.transaction(() => {
        const result = db.prepare(`
            INSERT INTO comments (post_id, user_id, parent_id, content)
            VALUES (?, ?, ?, ?)
        `).run(postId, userId, parent_id || null, content);

        // Update post comment count
        db.prepare('UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?').run(postId);

        // Log activity for post owner (if someone comments on their post)
        if (post.user_id !== userId) {
            db.prepare(`
                INSERT INTO activity_log (target_user_id, action_type, post_id, comment_id, detail)
                VALUES (?, 'new_comment', ?, ?, ?)
            `).run(post.user_id, postId, result.lastInsertRowid,
                JSON.stringify({ commenter_id: userId, content_preview: content.substring(0, 100) }));
        }

        // Log activity for parent comment owner (if replying)
        if (parent_id) {
            const parentComment = db.prepare('SELECT user_id FROM comments WHERE id = ?').get(parent_id);
            if (parentComment && parentComment.user_id !== userId) {
                db.prepare(`
                    INSERT INTO activity_log (target_user_id, action_type, post_id, comment_id, detail)
                    VALUES (?, 'new_reply', ?, ?, ?)
                `).run(parentComment.user_id, postId, result.lastInsertRowid,
                    JSON.stringify({ replier_id: userId, content_preview: content.substring(0, 100) }));
            }
        }

        return result.lastInsertRowid;
    });

    try {
        const commentId = createComment();
        const comment = db.prepare(`
            SELECT c.*, u.username, u.display_name, u.avatar_url
            FROM comments c JOIN users u ON c.user_id = u.id
            WHERE c.id = ?
        `).get(commentId);

        res.status(201).json({ message: '评论成功', comment });
    } catch (err) {
        console.error('Create comment error:', err);
        res.status(500).json({ error: '评论失败' });
    }
});

/**
 * PUT /api/comments/:id
 * Update own comment
 */
router.put('/comments/:id', (req, res) => {
    const commentId = parseInt(req.params.id);
    const userId = req.user.id;
    const { content } = req.body;

    if (!content) {
        return res.status(400).json({ error: '评论内容不能为空' });
    }

    const db = getDb();
    const comment = db.prepare('SELECT * FROM comments WHERE id = ? AND is_deleted = 0').get(commentId);
    if (!comment) return res.status(404).json({ error: '评论不存在' });
    if (comment.user_id !== userId) return res.status(403).json({ error: '只能修改自己的评论' });

    db.prepare("UPDATE comments SET content = ?, updated_at = datetime('now') WHERE id = ?").run(content, commentId);

    const updated = db.prepare(`
        SELECT c.*, u.username, u.display_name, u.avatar_url
        FROM comments c JOIN users u ON c.user_id = u.id
        WHERE c.id = ?
    `).get(commentId);

    res.json({ message: '评论已更新', comment: updated });
});

/**
 * DELETE /api/comments/:id
 * Soft delete own comment
 */
router.delete('/comments/:id', (req, res) => {
    const commentId = parseInt(req.params.id);
    const userId = req.user.id;
    const db = getDb();

    const comment = db.prepare('SELECT * FROM comments WHERE id = ? AND is_deleted = 0').get(commentId);
    if (!comment) return res.status(404).json({ error: '评论不存在' });
    if (comment.user_id !== userId) return res.status(403).json({ error: '只能删除自己的评论' });

    db.prepare('UPDATE comments SET is_deleted = 1 WHERE id = ?').run(commentId);
    db.prepare('UPDATE posts SET comment_count = MAX(0, comment_count - 1) WHERE id = ?').run(comment.post_id);

    res.json({ message: '评论已删除' });
});

module.exports = router;
