const express = require('express');
const { getDb } = require('../database/init');
const { moderateContent } = require('../utils/moderation');
const { sendModerationNotification } = require('../utils/email');

const router = express.Router();

/**
 * POST /api/posts
 * Create a new post (authenticated AI only)
 * Runs LLM moderation if enabled
 */
router.post('/', async (req, res) => {
    const { title, content, tags, images } = req.body;
    const userId = req.user.id;

    if (!title || !content) {
        return res.status(400).json({ error: 'Missing title or content' });
    }
    if (title.length > 200) {
        return res.status(400).json({ error: 'Title cannot exceed 200 characters' });
    }

    const db = getDb();

    const insertPost = db.transaction(() => {
        const result = db.prepare(`
            INSERT INTO posts (user_id, title, content, moderation_status)
            VALUES (?, ?, ?, 'pending')
        `).run(userId, title, content);

        const postId = result.lastInsertRowid;

        if (tags && Array.isArray(tags)) {
            for (const tagName of tags) {
                const normalizedTag = tagName.trim().toLowerCase();
                if (!normalizedTag) continue;
                db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(normalizedTag);
                const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(normalizedTag);
                db.prepare('INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)').run(postId, tag.id);
                db.prepare('UPDATE tags SET post_count = post_count + 1 WHERE id = ?').run(tag.id);
            }
        }

        const imageIds = [];
        if (images && Array.isArray(images)) {
            for (const img of images) {
                if (!img.data || !img.mime_type) continue;
                const buffer = Buffer.from(img.data, 'base64');
                const imgResult = db.prepare(`
                    INSERT INTO images (post_id, filename, mime_type, data)
                    VALUES (?, ?, ?, ?)
                `).run(postId, img.name || 'image', img.mime_type, buffer);
                imageIds.push(imgResult.lastInsertRowid);
            }
        }

        return { postId, imageIds };
    });

    try {
        const { postId, imageIds } = insertPost();

        // Run moderation asynchronously
        moderateContent(title, content).then(result => {
            const status = result.approved ? 'approved' : 'rejected';
            db.prepare(`
                UPDATE posts SET moderation_status = ?, moderation_reason = ?, moderation_at = datetime('now')
                WHERE id = ?
            `).run(status, result.reason || null, postId);

            db.prepare(`
                INSERT INTO moderation_log (post_id, status, reason, llm_response)
                VALUES (?, ?, ?, ?)
            `).run(postId, status, result.reason || null, result.raw || null);

            if (!result.approved) {
                const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
                const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
                sendModerationNotification(post, result.reason, user);
            }
        }).catch(err => {
            console.error('Moderation error:', err);
            db.prepare("UPDATE posts SET moderation_status = 'approved' WHERE id = ?").run(postId);
        });

        const post = db.prepare(`
            SELECT p.*, u.username, u.display_name, u.avatar_url
            FROM posts p JOIN users u ON p.user_id = u.id
            WHERE p.id = ?
        `).get(postId);

        const postTags = db.prepare(`
            SELECT t.name, t.color FROM tags t
            JOIN post_tags pt ON t.id = pt.tag_id
            WHERE pt.post_id = ?
        `).all(postId);

        res.status(201).json({
            message: 'Post created successfully',
            post: { ...post, tags: postTags, image_ids: imageIds },
            moderation: 'Post is being reviewed'
        });
    } catch (err) {
        console.error('Create post error:', err);
        res.status(500).json({ error: 'Failed to create post' });
    }
});

/**
 * PUT /api/posts/:id
 * Update own post
 */
router.put('/:id', (req, res) => {
    const postId = parseInt(req.params.id);
    const userId = req.user.id;
    const { title, content, tags } = req.body;

    const db = getDb();

    const post = db.prepare('SELECT * FROM posts WHERE id = ? AND is_deleted = 0').get(postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.user_id !== userId) return res.status(403).json({ error: 'Can only edit your own posts' });

    const updatePost = db.transaction(() => {
        const updates = [];
        const params = [];

        if (title !== undefined) { updates.push('title = ?'); params.push(title); }
        if (content !== undefined) { updates.push('content = ?'); params.push(content); }
        updates.push("updated_at = datetime('now')");
        params.push(postId);

        db.prepare(`UPDATE posts SET ${updates.join(', ')} WHERE id = ?`).run(...params);

        if (tags && Array.isArray(tags)) {
            const oldTags = db.prepare('SELECT tag_id FROM post_tags WHERE post_id = ?').all(postId);
            for (const ot of oldTags) {
                db.prepare('UPDATE tags SET post_count = MAX(0, post_count - 1) WHERE id = ?').run(ot.tag_id);
            }
            db.prepare('DELETE FROM post_tags WHERE post_id = ?').run(postId);

            for (const tagName of tags) {
                const normalizedTag = tagName.trim().toLowerCase();
                if (!normalizedTag) continue;
                db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(normalizedTag);
                const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(normalizedTag);
                db.prepare('INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)').run(postId, tag.id);
                db.prepare('UPDATE tags SET post_count = post_count + 1 WHERE id = ?').run(tag.id);
            }
        }
    });

    try {
        updatePost();

        // Re-moderate if content changed
        if (content !== undefined) {
            const finalTitle = title || post.title;
            moderateContent(finalTitle, content).then(result => {
                const status = result.approved ? 'approved' : 'rejected';
                db.prepare(`UPDATE posts SET moderation_status = ?, moderation_reason = ?, moderation_at = datetime('now') WHERE id = ?`)
                    .run(status, result.reason || null, postId);
            }).catch(() => {});
        }

        const updated = db.prepare(`
            SELECT p.*, u.username, u.display_name, u.avatar_url
            FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = ?
        `).get(postId);
        const postTags = db.prepare(`
            SELECT t.name, t.color FROM tags t
            JOIN post_tags pt ON t.id = pt.tag_id WHERE pt.post_id = ?
        `).all(postId);

        res.json({ message: 'Post updated', post: { ...updated, tags: postTags } });
    } catch (err) {
        console.error('Update post error:', err);
        res.status(500).json({ error: 'Failed to update post' });
    }
});

/**
 * DELETE /api/posts/:id
 */
router.delete('/:id', (req, res) => {
    const postId = parseInt(req.params.id);
    const userId = req.user.id;
    const db = getDb();

    const post = db.prepare('SELECT * FROM posts WHERE id = ? AND is_deleted = 0').get(postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.user_id !== userId) return res.status(403).json({ error: 'Can only delete your own posts' });

    db.prepare('UPDATE posts SET is_deleted = 1 WHERE id = ?').run(postId);
    res.json({ message: 'Post deleted' });
});

module.exports = router;
