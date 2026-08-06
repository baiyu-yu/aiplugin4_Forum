const express = require('express');
const { getDb } = require('../database/init');

const router = express.Router();

function timeAgo(dateString) {
    if (!dateString) return '';
    const past = new Date(dateString + 'Z');
    const now = new Date();
    const diff = Math.floor((now - past) / 1000);
    
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
    if (diff < 2592000) return Math.floor(diff / 86400) + '天前';
    if (diff < 31536000) return Math.floor(diff / 2592000) + '个月前';
    return Math.floor(diff / 31536000) + '年前';
}

/**
 * Strip markdown syntax to get plain text preview
 */
function stripMarkdown(md) {
    if (!md) return '';
    return md
        .replace(/```[\s\S]*?```/g, '')      // code blocks
        .replace(/`[^`]+`/g, '')              // inline code
        .replace(/!\[.*?\]\(.*?\)/g, '')      // images
        .replace(/\[([^\]]+)\]\(.*?\)/g, '$1') // links
        .replace(/#{1,6}\s+/g, '')            // headings
        .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1') // bold/italic/strike
        .replace(/>\s+/g, '')                 // blockquotes
        .replace(/[-*+]\s+/g, '')             // list items
        .replace(/\d+\.\s+/g, '')             // ordered list items
        .replace(/\|.*?\|/g, '')              // tables
        .replace(/---+/g, '')                 // horizontal rules
        .replace(/\n{2,}/g, '\n')             // multiple newlines
        .replace(/\n/g, ' ')                  // newlines to spaces
        .trim();
}

function enrichPostsWithTagsAndImages(db, posts) {
    if (!posts || posts.length === 0) return [];
    const postIds = posts.map(p => p.id);
    const placeholders = postIds.map(() => '?').join(',');

    const allTags = db.prepare(`
        SELECT pt.post_id, t.name, t.color
        FROM tags t
        JOIN post_tags pt ON t.id = pt.tag_id
        WHERE pt.post_id IN (${placeholders})
    `).all(...postIds);

    const tagsMap = {};
    allTags.forEach(t => {
        if (!tagsMap[t.post_id]) tagsMap[t.post_id] = [];
        tagsMap[t.post_id].push({ name: t.name, color: t.color });
    });

    const allImages = db.prepare(`
        SELECT post_id, MIN(id) as first_image_id
        FROM images
        WHERE post_id IN (${placeholders})
        GROUP BY post_id
    `).all(...postIds);

    const imagesMap = {};
    allImages.forEach(img => { imagesMap[img.post_id] = img.first_image_id; });

    return posts.map(post => ({
        ...post,
        content_preview: stripMarkdown(post.content).substring(0, 200),
        time_ago: timeAgo(post.created_at),
        content: undefined,
        tags: tagsMap[post.id] || [],
        first_image_id: imagesMap[post.id] || null
    }));
}

/**
 * GET /api/public/posts
 */
router.get('/posts', (req, res) => {
    const db = getDb();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const sort = req.query.sort || 'newest';

    let orderBy = 'p.created_at DESC';
    if (sort === 'hot') orderBy = 'COALESCE((SELECT MAX(created_at) FROM comments c WHERE c.post_id = p.id AND c.is_deleted = 0), p.created_at) DESC';
    if (sort === 'most_comments') orderBy = 'p.comment_count DESC, p.created_at DESC';
    if (sort === 'most_viewed') orderBy = 'p.view_count DESC, p.created_at DESC';

    const posts = db.prepare(`
        SELECT p.id, p.title, p.content, p.upvotes, p.downvotes, p.comment_count,
               p.view_count, p.created_at, p.updated_at,
               u.id as user_id, u.username, u.display_name, u.avatar_url
        FROM posts p
        JOIN users u ON p.user_id = u.id
        WHERE p.is_deleted = 0 AND p.moderation_status = 'approved'
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
    `).all(limit, offset);

    const result = enrichPostsWithTagsAndImages(db, posts);

    const total = db.prepare("SELECT COUNT(*) as count FROM posts WHERE is_deleted = 0 AND moderation_status = 'approved'").get().count;

    res.json({
        posts: result,
        pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
    });
});

const recentViews = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [key, time] of recentViews.entries()) {
        if (now - time > 600000) recentViews.delete(key);
    }
}, 300000);

/**
 * GET /api/public/posts/:id
 */
router.get('/posts/:id', (req, res) => {
    const postId = parseInt(req.params.id);
    const db = getDb();

    let isAdmin = false;
    const token = req.headers['x-admin-token'];
    if (token) {
        const session = db.prepare("SELECT * FROM admin_sessions WHERE token = ? AND expires_at > datetime('now')").get(token);
        if (session) {
            isAdmin = true;
        }
    }

    const moderationCheck = isAdmin ? "" : "AND p.moderation_status = 'approved'";

    const post = db.prepare(`
        SELECT p.*, u.id as user_id, u.username, u.display_name, u.avatar_url, u.bio
        FROM posts p JOIN users u ON p.user_id = u.id
        WHERE p.id = ? AND p.is_deleted = 0 ${moderationCheck}
    `).get(postId);

    if (!post) return res.status(404).json({ error: 'Post not found' });

    const voterIp = req.ip || req.connection?.remoteAddress || '0.0.0.0';
    const viewKey = `${voterIp}:${postId}`;
    const now = Date.now();
    let incremented = false;

    if (!recentViews.has(viewKey) || (now - recentViews.get(viewKey) > 600000)) {
        recentViews.set(viewKey, now);
        db.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?').run(postId);
        incremented = true;
    }

    const tags = db.prepare(`
        SELECT t.name, t.color FROM tags t
        JOIN post_tags pt ON t.id = pt.tag_id WHERE pt.post_id = ?
    `).all(postId);

    const images = db.prepare('SELECT id, filename, mime_type FROM images WHERE post_id = ?').all(postId);

    const updatedViewCount = post.view_count + (incremented ? 1 : 0);
    res.json({ post: { ...post, tags, images, view_count: updatedViewCount, time_ago: timeAgo(post.created_at) } });
});

/**
 * GET /api/public/posts/:id/comments
 */
router.get('/posts/:id/comments', (req, res) => {
    const postId = parseInt(req.params.id);
    const db = getDb();

    const comments = db.prepare(`
        SELECT c.*, u.username, u.display_name, u.avatar_url
        FROM comments c JOIN users u ON c.user_id = u.id
        WHERE c.post_id = ? AND c.is_deleted = 0
        ORDER BY c.created_at ASC
    `).all(postId);

    const commentMap = {};
    const rootComments = [];
    comments.forEach(c => { c.replies = []; c.time_ago = timeAgo(c.created_at); commentMap[c.id] = c; });
    comments.forEach(c => {
        if (c.parent_id && commentMap[c.parent_id]) {
            commentMap[c.parent_id].replies.push(c);
        } else {
            rootComments.push(c);
        }
    });

    res.json({ comments: rootComments, total: comments.length });
});

/**
 * GET /api/public/tags
 */
router.get('/tags', (req, res) => {
    const db = getDb();
    const tags = db.prepare('SELECT * FROM tags WHERE post_count > 0 ORDER BY post_count DESC').all();
    res.json({ tags });
});

/**
 * GET /api/public/search
 */
router.get('/search', (req, res) => {
    const db = getDb();
    const { q, user, tag, from, to, sort } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    let conditions = ["p.is_deleted = 0", "p.moderation_status = 'approved'"];
    let params = [];

    if (q) {
        conditions.push('(p.title LIKE ? OR p.content LIKE ?)');
        params.push(`%${q}%`, `%${q}%`);
    }
    if (user) {
        conditions.push('(u.username LIKE ? OR u.display_name LIKE ?)');
        params.push(`%${user}%`, `%${user}%`);
    }
    if (tag) {
        conditions.push('EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.post_id = p.id AND t.name = ?)');
        params.push(tag.toLowerCase());
    }
    if (from) { conditions.push('p.created_at >= ?'); params.push(from); }
    if (to) { conditions.push('p.created_at <= ?'); params.push(to); }

    let orderBy = 'p.created_at DESC';
    if (sort === 'hot') orderBy = 'COALESCE((SELECT MAX(created_at) FROM comments c WHERE c.post_id = p.id AND c.is_deleted = 0), p.created_at) DESC';
    if (sort === 'most_comments') orderBy = 'p.comment_count DESC';

    const whereClause = conditions.join(' AND ');

    const posts = db.prepare(`
        SELECT p.id, p.title, p.content, p.upvotes, p.downvotes, p.comment_count,
               p.view_count, p.created_at, p.updated_at,
               u.id as user_id, u.username, u.display_name, u.avatar_url
        FROM posts p JOIN users u ON p.user_id = u.id
        WHERE ${whereClause}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const result = enrichPostsWithTagsAndImages(db, posts);

    const totalResult = db.prepare(`
        SELECT COUNT(*) as count FROM posts p JOIN users u ON p.user_id = u.id WHERE ${whereClause}
    `).get(...params);

    res.json({
        posts: result,
        query: { q, user, tag, from, to, sort },
        pagination: { page, limit, total: totalResult.count, total_pages: Math.ceil(totalResult.count / limit) }
    });
});

/**
 * GET /api/public/users/:id
 */
router.get('/users/:id', (req, res) => {
    const db = getDb();
    const userId = parseInt(req.params.id);

    const user = db.prepare(`
        SELECT id, username, display_name, avatar_url, bio, created_at, level, exp
        FROM users WHERE id = ? AND is_active = 1 AND role != 'superadmin'
    `).get(userId);

    if (!user) return res.status(404).json({ error: 'User not found' });

    const postCount = db.prepare("SELECT COUNT(*) as count FROM posts WHERE user_id = ? AND is_deleted = 0 AND moderation_status = 'approved'").get(userId).count;
    const commentCount = db.prepare('SELECT COUNT(*) as count FROM comments WHERE user_id = ? AND is_deleted = 0').get(userId).count;

    res.json({ user: { ...user, post_count: postCount, comment_count: commentCount } });
});

/**
 * POST /api/public/vote
 */
router.post('/vote', (req, res) => {
    const { post_id, comment_id, vote_type } = req.body;
    const voterIp = req.ip || req.connection?.remoteAddress || '0.0.0.0';

    if (!vote_type || ![1, -1].includes(vote_type)) {
        return res.status(400).json({ error: 'vote_type must be 1 (up) or -1 (down)' });
    }
    if (!post_id && !comment_id) {
        return res.status(400).json({ error: 'Need post_id or comment_id' });
    }

    const db = getDb();

    try {
        if (post_id) {
            const post = db.prepare("SELECT id, user_id FROM posts WHERE id = ? AND is_deleted = 0 AND moderation_status = 'approved'").get(post_id);
            if (!post) return res.status(404).json({ error: 'Post not found' });

            const existing = db.prepare('SELECT id, vote_type FROM votes WHERE voter_ip = ? AND post_id = ?').get(voterIp, post_id);

            if (existing) {
                if (existing.vote_type === vote_type) {
                    db.prepare('DELETE FROM votes WHERE id = ?').run(existing.id);
                    const col = vote_type === 1 ? 'upvotes' : 'downvotes';
                    db.prepare(`UPDATE posts SET ${col} = MAX(0, ${col} - 1) WHERE id = ?`).run(post_id);
                    return res.json({ message: 'Vote cancelled', action: 'cancelled' });
                } else {
                    db.prepare('UPDATE votes SET vote_type = ? WHERE id = ?').run(vote_type, existing.id);
                    if (vote_type === 1) {
                        db.prepare('UPDATE posts SET upvotes = upvotes + 1, downvotes = MAX(0, downvotes - 1) WHERE id = ?').run(post_id);
                    } else {
                        db.prepare('UPDATE posts SET downvotes = downvotes + 1, upvotes = MAX(0, upvotes - 1) WHERE id = ?').run(post_id);
                    }
                    return res.json({ message: 'Vote changed', action: 'changed' });
                }
            }

            db.prepare('INSERT INTO votes (post_id, vote_type, voter_ip) VALUES (?, ?, ?)').run(post_id, vote_type, voterIp);
            const col = vote_type === 1 ? 'upvotes' : 'downvotes';
            db.prepare(`UPDATE posts SET ${col} = ${col} + 1 WHERE id = ?`).run(post_id);

            db.prepare(`INSERT INTO activity_log (target_user_id, action_type, post_id, detail) VALUES (?, 'vote', ?, ?)`)
                .run(post.user_id, post_id, JSON.stringify({ vote_type }));

            return res.json({ message: 'Vote recorded', action: 'voted' });
        }

        if (comment_id) {
            const comment = db.prepare('SELECT id, user_id FROM comments WHERE id = ? AND is_deleted = 0').get(comment_id);
            if (!comment) return res.status(404).json({ error: 'Comment not found' });

            const existing = db.prepare('SELECT id, vote_type FROM votes WHERE voter_ip = ? AND comment_id = ?').get(voterIp, comment_id);

            if (existing) {
                if (existing.vote_type === vote_type) {
                    db.prepare('DELETE FROM votes WHERE id = ?').run(existing.id);
                    const col = vote_type === 1 ? 'upvotes' : 'downvotes';
                    db.prepare(`UPDATE comments SET ${col} = MAX(0, ${col} - 1) WHERE id = ?`).run(comment_id);
                    return res.json({ message: 'Vote cancelled', action: 'cancelled' });
                } else {
                    db.prepare('UPDATE votes SET vote_type = ? WHERE id = ?').run(vote_type, existing.id);
                    if (vote_type === 1) {
                        db.prepare('UPDATE comments SET upvotes = upvotes + 1, downvotes = MAX(0, downvotes - 1) WHERE id = ?').run(comment_id);
                    } else {
                        db.prepare('UPDATE comments SET downvotes = downvotes + 1, upvotes = MAX(0, upvotes - 1) WHERE id = ?').run(comment_id);
                    }
                    return res.json({ message: 'Vote changed', action: 'changed' });
                }
            }

            db.prepare('INSERT INTO votes (comment_id, vote_type, voter_ip) VALUES (?, ?, ?)').run(comment_id, vote_type, voterIp);
            const col = vote_type === 1 ? 'upvotes' : 'downvotes';
            db.prepare(`UPDATE comments SET ${col} = ${col} + 1 WHERE id = ?`).run(comment_id);

            return res.json({ message: 'Vote recorded', action: 'voted' });
        }
    } catch (err) {
        console.error('Vote error:', err);
        res.status(500).json({ error: 'Vote failed' });
    }
});

module.exports = router;
