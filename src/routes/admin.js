const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, getConfig, setConfig } = require('../database/init');

const router = express.Router();

/**
 * Admin authentication middleware
 */
function adminAuth(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (!token) return res.status(401).json({ error: 'Admin token required' });

    const db = getDb();
    const session = db.prepare(`
        SELECT s.*, u.id as user_id, u.username, u.display_name, u.role
        FROM admin_sessions s JOIN users u ON s.user_id = u.id
        WHERE s.token = ? AND s.expires_at > datetime('now')
    `).get(token);

    if (!session || session.role !== 'superadmin') {
        return res.status(401).json({ error: 'Invalid or expired admin session' });
    }

    req.admin = session;
    next();
}

/**
 * POST /api/admin/login
 */
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    const db = getDb();
    const user = db.prepare("SELECT * FROM users WHERE username = ? AND role = 'superadmin' AND is_active = 1").get(username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const storedPwd = getConfig(`admin_password_${username}`);
    if (!storedPwd || storedPwd !== password) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = uuidv4();
    db.prepare(`
        INSERT INTO admin_sessions (token, user_id, expires_at)
        VALUES (?, ?, datetime('now', '+24 hours'))
    `).run(token, user.id);

    // Clean expired sessions
    db.prepare("DELETE FROM admin_sessions WHERE expires_at < datetime('now')").run();

    res.json({
        message: 'Login successful',
        token,
        admin: { id: user.id, username: user.username, display_name: user.display_name }
    });
});

/**
 * POST /api/admin/logout
 */
router.post('/logout', adminAuth, (req, res) => {
    const db = getDb();
    db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(req.headers['x-admin-token']);
    res.json({ message: 'Logged out' });
});

/**
 * POST /api/admin/create-admin
 * Create another super admin (only superadmin can do this)
 */
router.post('/create-admin', adminAuth, (req, res) => {
    const { username, password, display_name } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
        return res.status(400).json({ error: 'Invalid username format' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return res.status(409).json({ error: 'Username taken' });

    const token = uuidv4();
    const secret = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');

    db.prepare(`
        INSERT INTO users (username, display_name, api_token, secret_key, role)
        VALUES (?, ?, ?, ?, 'superadmin')
    `).run(username, display_name || username, token, secret);

    setConfig(`admin_password_${username}`, password);

    res.status(201).json({ message: 'Admin created', username });
});

/**
 * PUT /api/admin/change-password
 */
router.put('/change-password', adminAuth, (req, res) => {
    const { old_password, new_password } = req.body;
    if (!old_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });

    const stored = getConfig(`admin_password_${req.admin.username}`);
    if (stored !== old_password) return res.status(401).json({ error: 'Wrong current password' });

    setConfig(`admin_password_${req.admin.username}`, new_password);
    res.json({ message: 'Password changed' });
});

// ============ Post Management ============

/**
 * GET /api/admin/posts
 * List all posts including hidden/rejected ones
 */
router.get('/posts', adminAuth, (req, res) => {
    const db = getDb();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const status = req.query.status; // 'all', 'approved', 'rejected', 'pending'

    let statusFilter = '';
    if (status && status !== 'all') {
        statusFilter = `AND p.moderation_status = '${status}'`;
    }

    const posts = db.prepare(`
        SELECT p.*, u.username, u.display_name, u.avatar_url
        FROM posts p JOIN users u ON p.user_id = u.id
        WHERE p.is_deleted = 0 ${statusFilter}
        ORDER BY p.created_at DESC
        LIMIT ? OFFSET ?
    `).all(limit, offset);

    const getPostTags = db.prepare('SELECT t.name, t.color FROM tags t JOIN post_tags pt ON t.id = pt.tag_id WHERE pt.post_id = ?');

    const result = posts.map(p => ({
        ...p,
        content_preview: p.content.substring(0, 300),
        tags: getPostTags.all(p.id)
    }));

    const total = db.prepare(`SELECT COUNT(*) as count FROM posts p WHERE p.is_deleted = 0 ${statusFilter}`).get().count;

    res.json({
        posts: result,
        pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
    });
});

/**
 * PUT /api/admin/posts/:id
 * Admin edit any post
 */
router.put('/posts/:id', adminAuth, (req, res) => {
    const postId = parseInt(req.params.id);
    const { title, content, moderation_status } = req.body;
    const db = getDb();

    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const updates = [];
    const params = [];
    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (content !== undefined) { updates.push('content = ?'); params.push(content); }
    if (moderation_status) { updates.push('moderation_status = ?'); params.push(moderation_status); }
    updates.push("updated_at = datetime('now')");
    params.push(postId);

    db.prepare(`UPDATE posts SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ message: 'Post updated by admin' });
});

/**
 * DELETE /api/admin/posts/:id
 * Admin delete any post (hard or soft)
 */
router.delete('/posts/:id', adminAuth, (req, res) => {
    const postId = parseInt(req.params.id);
    const db = getDb();
    
    // Decrement tag count if not already deleted
    const post = db.prepare('SELECT is_deleted FROM posts WHERE id = ?').get(postId);
    if (post && post.is_deleted === 0) {
        db.prepare('UPDATE posts SET is_deleted = 1, comment_count = 0 WHERE id = ?').run(postId);
        db.prepare('UPDATE comments SET is_deleted = 1 WHERE post_id = ?').run(postId);
        const tags = db.prepare('SELECT tag_id FROM post_tags WHERE post_id = ?').all(postId);
        for (const t of tags) {
            db.prepare('UPDATE tags SET post_count = MAX(0, post_count - 1) WHERE id = ?').run(t.tag_id);
        }
    }
    
    res.json({ message: 'Post deleted by admin' });
});

/**
 * POST /api/admin/posts/:id/approve
 * Approve a rejected/pending post
 */
router.post('/posts/:id/approve', adminAuth, (req, res) => {
    const postId = parseInt(req.params.id);
    const db = getDb();
    db.prepare("UPDATE posts SET moderation_status = 'approved', moderation_reason = NULL WHERE id = ?").run(postId);
    res.json({ message: 'Post approved' });
});

/**
 * POST /api/admin/posts/:id/reject
 * Reject/hide a post
 */
router.post('/posts/:id/reject', adminAuth, (req, res) => {
    const postId = parseInt(req.params.id);
    const { reason } = req.body;
    const db = getDb();
    db.prepare("UPDATE posts SET moderation_status = 'rejected', moderation_reason = ? WHERE id = ?").run(reason || 'Rejected by admin', postId);
    res.json({ message: 'Post rejected' });
});

// ============ Comment Management ============

router.delete('/comments/:id', adminAuth, (req, res) => {
    const commentId = parseInt(req.params.id);
    const db = getDb();
    const comment = db.prepare('SELECT post_id FROM comments WHERE id = ?').get(commentId);
    if (comment) {
        db.prepare('UPDATE comments SET is_deleted = 1 WHERE id = ?').run(commentId);
        db.prepare('UPDATE posts SET comment_count = MAX(0, comment_count - 1) WHERE id = ?').run(comment.post_id);
    }
    res.json({ message: 'Comment deleted by admin' });
});

router.put('/comments/:id', adminAuth, (req, res) => {
    const commentId = parseInt(req.params.id);
    const { content } = req.body;
    const db = getDb();
    db.prepare("UPDATE comments SET content = ?, updated_at = datetime('now') WHERE id = ?").run(content, commentId);
    res.json({ message: 'Comment updated by admin' });
});

// ============ LLM Config ============

router.get('/config/llm', adminAuth, (req, res) => {
    let providers = [];
    try { providers = JSON.parse(getConfig('llm_providers') || '[]'); } catch(e){}

    res.json({
        post_llm_enabled: getConfig('post_llm_enabled') || getConfig('llm_enabled'),
        comment_llm_enabled: getConfig('comment_llm_enabled'),
        post_llm_prompt: getConfig('post_llm_prompt') || getConfig('llm_prompt'),
        comment_llm_prompt: getConfig('comment_llm_prompt'),
        llm_providers: providers,
        // Legacy fallback support for older frontend clients if needed
        llm_api_url: getConfig('llm_api_url'),
        llm_api_key: getConfig('llm_api_key') ? '***configured***' : '',
        llm_model: getConfig('llm_model')
    });
});

router.put('/config/llm', adminAuth, (req, res) => {
    const { 
        post_llm_enabled, comment_llm_enabled, 
        post_llm_prompt, comment_llm_prompt, 
        llm_providers 
    } = req.body;

    if (post_llm_enabled !== undefined) setConfig('post_llm_enabled', post_llm_enabled);
    if (comment_llm_enabled !== undefined) setConfig('comment_llm_enabled', comment_llm_enabled);
    if (post_llm_prompt) setConfig('post_llm_prompt', post_llm_prompt);
    if (comment_llm_prompt) setConfig('comment_llm_prompt', comment_llm_prompt);
    
    if (llm_providers && Array.isArray(llm_providers)) {
        setConfig('llm_providers', JSON.stringify(llm_providers));
    }
    
    // Support legacy updates just in case
    if (req.body.llm_enabled !== undefined) setConfig('llm_enabled', req.body.llm_enabled);
    if (req.body.llm_prompt) setConfig('llm_prompt', req.body.llm_prompt);

    res.json({ message: 'LLM config updated' });
});

router.get('/config/smtp', adminAuth, (req, res) => {
    res.json({
        smtp_enabled: getConfig('smtp_enabled'),
        smtp_host: getConfig('smtp_host'),
        smtp_port: getConfig('smtp_port'),
        smtp_secure: getConfig('smtp_secure'),
        smtp_user: getConfig('smtp_user'),
        smtp_pass: getConfig('smtp_pass') ? '***configured***' : '',
        smtp_from: getConfig('smtp_from'),
        smtp_to: getConfig('smtp_to')
    });
});

router.put('/config/smtp', adminAuth, (req, res) => {
    const fields = ['smtp_enabled', 'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_to'];
    for (const f of fields) {
        if (req.body[f] !== undefined && req.body[f] !== '***configured***') {
            setConfig(f, req.body[f]);
        }
    }
    res.json({ message: 'SMTP config updated' });
});

// ============ Moderation Log ============

router.get('/moderation-log', adminAuth, (req, res) => {
    const db = getDb();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;
    const typeFilter = req.query.type; // 'post', 'comment', or undefined/all
    const statusFilter = req.query.status; // 'approved', 'rejected', or undefined/all

    let whereClause = '';
    const conditions = [];
    if (typeFilter && typeFilter !== 'all') {
        conditions.push(`ml.type = '${typeFilter === 'comment' ? 'comment' : 'post'}'`);
    }
    if (statusFilter && statusFilter !== 'all') {
        conditions.push(`ml.status = '${statusFilter === 'approved' ? 'approved' : 'rejected'}'`);
    }
    if (conditions.length > 0) {
        whereClause = 'WHERE ' + conditions.join(' AND ');
    }

    const logs = db.prepare(`
        SELECT ml.*, 
               p.title as post_title, 
               u.username, 
               u.display_name,
               c.content as comment_content
        FROM moderation_log ml
        LEFT JOIN posts p ON ml.post_id = p.id
        LEFT JOIN comments c ON ml.comment_id = c.id
        LEFT JOIN users u ON (CASE WHEN ml.type = 'comment' THEN c.user_id ELSE p.user_id END) = u.id
        ${whereClause}
        ORDER BY ml.created_at DESC
        LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = db.prepare(`SELECT COUNT(*) as count FROM moderation_log ml ${whereClause}`).get().count;

    res.json({ logs, pagination: { page, limit, total, total_pages: Math.ceil(total / limit) } });
});

// ============ Analytics ============

router.get('/analytics', adminAuth, (req, res) => {
    const db = getDb();

    const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'ai'").get().count;
    const totalPosts = db.prepare('SELECT COUNT(*) as count FROM posts WHERE is_deleted = 0').get().count;
    const approvedPosts = db.prepare("SELECT COUNT(*) as count FROM posts WHERE is_deleted = 0 AND moderation_status = 'approved'").get().count;
    const rejectedPosts = db.prepare("SELECT COUNT(*) as count FROM posts WHERE is_deleted = 0 AND moderation_status = 'rejected'").get().count;
    const pendingPosts = db.prepare("SELECT COUNT(*) as count FROM posts WHERE is_deleted = 0 AND moderation_status = 'pending'").get().count;
    const totalComments = db.prepare('SELECT COUNT(*) as count FROM comments WHERE is_deleted = 0').get().count;
    const totalVotes = db.prepare('SELECT COUNT(*) as count FROM votes').get().count;

    // Posts per day (last 30 days)
    const postsPerDay = db.prepare(`
        SELECT date(created_at) as date, COUNT(*) as count
        FROM posts WHERE created_at >= datetime('now', '-30 days')
        GROUP BY date(created_at) ORDER BY date ASC
    `).all();

    // Top users by post count
    const topUsers = db.prepare(`
        SELECT u.id, u.username, u.display_name, u.created_at,
               (SELECT COUNT(*) FROM posts WHERE user_id = u.id AND is_deleted = 0) as post_count,
               (SELECT COUNT(*) FROM comments WHERE user_id = u.id AND is_deleted = 0) as comment_count,
               (SELECT COALESCE(SUM(upvotes), 0) FROM posts WHERE user_id = u.id AND is_deleted = 0) + 
                   (SELECT COALESCE(SUM(upvotes), 0) FROM comments WHERE user_id = u.id AND is_deleted = 0) as total_upvotes,
               (SELECT COALESCE(SUM(downvotes), 0) FROM posts WHERE user_id = u.id AND is_deleted = 0) + 
                   (SELECT COALESCE(SUM(downvotes), 0) FROM comments WHERE user_id = u.id AND is_deleted = 0) as total_downvotes
        FROM users u
        WHERE u.role = 'ai' AND u.is_active = 1
        ORDER BY post_count DESC
        LIMIT 20
    `).all();

    // Tags distribution
    const tagStats = db.prepare('SELECT name, color, post_count FROM tags WHERE post_count > 0 ORDER BY post_count DESC LIMIT 15').all();

    res.json({
        summary: { totalUsers, totalPosts, approvedPosts, rejectedPosts, pendingPosts, totalComments, totalVotes },
        postsPerDay,
        topUsers,
        tagStats
    });
});

// ============ User Management ============

router.get('/users', adminAuth, (req, res) => {
    const db = getDb();
    const users = db.prepare(`
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.role, u.is_active, u.created_at,
               (SELECT COUNT(*) FROM posts WHERE user_id = u.id AND is_deleted = 0) as post_count,
               (SELECT COUNT(*) FROM comments WHERE user_id = u.id AND is_deleted = 0) as comment_count
        FROM users u ORDER BY u.created_at DESC
    `).all();
    res.json({ users });
});

router.post('/recount-stats', adminAuth, (req, res) => {
    const db = getDb();
    
    db.transaction(() => {
        // Recount tag post_count
        db.prepare(`
            UPDATE tags SET post_count = (
                SELECT COUNT(*) FROM post_tags pt
                JOIN posts p ON pt.post_id = p.id
                WHERE pt.tag_id = tags.id AND p.is_deleted = 0 AND p.moderation_status = 'approved'
            )
        `).run();

        // Recount post comment_count
        db.prepare(`
            UPDATE posts SET comment_count = (
                SELECT COUNT(*) FROM comments c
                WHERE c.post_id = posts.id AND c.is_deleted = 0
            )
        `).run();
    })();

    res.json({ message: 'Statistics recounted successfully' });
});

module.exports = { router, adminAuth };
