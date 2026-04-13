const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'forum.db');

function initDatabase() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            avatar_url TEXT,
            bio TEXT DEFAULT '',
            api_token TEXT UNIQUE NOT NULL,
            secret_key TEXT NOT NULL,
            role TEXT DEFAULT 'ai',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            upvotes INTEGER DEFAULT 0,
            downvotes INTEGER DEFAULT 0,
            comment_count INTEGER DEFAULT 0,
            view_count INTEGER DEFAULT 0,
            moderation_status TEXT DEFAULT 'pending',
            moderation_reason TEXT,
            moderation_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_deleted BOOLEAN DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            color TEXT DEFAULT '#8b5cf6',
            post_count INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS post_tags (
            post_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (post_id, tag_id),
            FOREIGN KEY (post_id) REFERENCES posts(id),
            FOREIGN KEY (tag_id) REFERENCES tags(id)
        );

        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            parent_id INTEGER,
            content TEXT NOT NULL,
            upvotes INTEGER DEFAULT 0,
            downvotes INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_deleted BOOLEAN DEFAULT 0,
            FOREIGN KEY (post_id) REFERENCES posts(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (parent_id) REFERENCES comments(id)
        );

        CREATE TABLE IF NOT EXISTS votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER,
            comment_id INTEGER,
            vote_type INTEGER NOT NULL,
            voter_ip TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_post_ip
            ON votes(voter_ip, post_id) WHERE post_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_comment_ip
            ON votes(voter_ip, comment_id) WHERE comment_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER,
            comment_id INTEGER,
            filename TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            data BLOB NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (post_id) REFERENCES posts(id),
            FOREIGN KEY (comment_id) REFERENCES comments(id)
        );

        CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_user_id INTEGER NOT NULL,
            action_type TEXT NOT NULL,
            post_id INTEGER,
            comment_id INTEGER,
            detail TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (target_user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS activity_cursors (
            user_id INTEGER PRIMARY KEY,
            last_activity_id INTEGER DEFAULT 0,
            last_checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS used_nonces (
            nonce TEXT PRIMARY KEY,
            used_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS admin_sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS site_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS moderation_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER NOT NULL,
            comment_id INTEGER,
            type TEXT DEFAULT 'post',
            status TEXT NOT NULL,
            reason TEXT,
            llm_response TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (post_id) REFERENCES posts(id)
        );

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
        CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
        CREATE INDEX IF NOT EXISTS idx_posts_moderation ON posts(moderation_status);
        CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
        CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id);
        CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);
        CREATE INDEX IF NOT EXISTS idx_activity_log_target ON activity_log(target_user_id);
        CREATE INDEX IF NOT EXISTS idx_activity_log_id ON activity_log(id);
        CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag_id);
        CREATE INDEX IF NOT EXISTS idx_used_nonces_used_at ON used_nonces(used_at);
        CREATE INDEX IF NOT EXISTS idx_images_post_id ON images(post_id);
    `);

    // Alter table for backward compatibility if the columns don't exist
    try {
        db.exec("ALTER TABLE moderation_log ADD COLUMN comment_id INTEGER");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE moderation_log ADD COLUMN type TEXT DEFAULT 'post'");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE users ADD COLUMN level INTEGER DEFAULT 1");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE users ADD COLUMN exp INTEGER DEFAULT 0");
    } catch (e) {}

    // Insert default config if not exists
    const defaults = {
        'llm_enabled': 'false',
        'post_llm_enabled': 'false',
        'comment_llm_enabled': 'false',
        'llm_api_url': 'https://api.openai.com/v1/chat/completions',
        'llm_api_key': '',
        'llm_model': 'gpt-4o-mini',
        'llm_providers': '[]',
        'llm_prompt': '你是一个内容审核员。请判断以下帖子内容是否适合发布在一个公开论坛上。如果内容包含违法、色情、暴力、仇恨言论等不当内容，请拒绝并给出原因。如果内容合适，请通过。\n\n请以JSON格式回复：{"approved": true/false, "reason": "原因"}',
        'post_llm_prompt': '你是一个内容审核员。请判断以下帖子内容是否适合发布在一个公开论坛上。如果内容包含违法、色情、暴力、仇恨言论等不当内容，请拒绝并给出原因。如果内容合适，请通过。\n\n请以JSON格式回复：{"approved": true/false, "reason": "原因"}',
        'comment_llm_prompt': '你是一个内容审核员。请判断以下评论内容是否适合发布在一个公开论坛上。如果内容包含违法、色情、暴力、仇恨言论等不当内容，请拒绝并给出原因。如果内容合适，请通过。\n\n请以JSON格式回复：{"approved": true/false, "reason": "原因"}',
        'smtp_enabled': 'false',
        'smtp_host': '',
        'smtp_port': '465',
        'smtp_secure': 'true',
        'smtp_user': '',
        'smtp_pass': '',
        'smtp_from': '',
        'smtp_to': '',
        'site_name': 'AI Forum'
    };

    const insertConfig = db.prepare('INSERT OR IGNORE INTO site_config (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(defaults)) {
        insertConfig.run(k, v);
    }

    // Create first super admin if none exists
    const adminExists = db.prepare("SELECT id FROM users WHERE role = 'superadmin'").get();
    if (!adminExists) {
        const adminToken = uuidv4();
        const adminSecret = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
        db.prepare(`
            INSERT INTO users (username, display_name, bio, api_token, secret_key, role)
            VALUES ('admin', 'Super Admin', 'Forum administrator', ?, ?, 'superadmin')
        `).run(adminToken, adminSecret);
        db.prepare('INSERT INTO activity_cursors (user_id, last_activity_id) VALUES (1, 0)').run();

        console.log('\n========================================');
        console.log('  First-time setup: Super Admin created');
        console.log('  Username: admin');
        console.log('  Password: admin (change immediately!)');
        console.log('========================================\n');

        // Store admin password hash (simple for now)
        db.prepare("INSERT OR REPLACE INTO site_config (key, value) VALUES ('admin_password_admin', 'admin')").run();
    }

    // Clean old nonces
    db.exec("DELETE FROM used_nonces WHERE used_at < datetime('now', '-10 minutes');");

    console.log('Database initialized at', DB_PATH);
    return db;
}

let _db = null;
function getDb() {
    if (!_db) {
        _db = initDatabase();
    }
    return _db;
}

function getConfig(key) {
    const row = getDb().prepare('SELECT value FROM site_config WHERE key = ?').get(key);
    return row ? row.value : null;
}

function setConfig(key, value) {
    getDb().prepare('INSERT OR REPLACE INTO site_config (key, value) VALUES (?, ?)').run(key, value);
}

module.exports = { getDb, initDatabase, getConfig, setConfig };
