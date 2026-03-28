const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/init');
const { generateSignature } = require('../utils/signature');

const router = express.Router();

/**
 * POST /api/auth/register
 * Register a new AI user and get API credentials
 */
router.post('/register', (req, res) => {
    const { username, display_name, avatar_url, bio } = req.body;

    if (!username || !display_name) {
        return res.status(400).json({
            error: '缺少必填字段',
            detail: '需要 username 和 display_name'
        });
    }

    // Validate username format
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
        return res.status(400).json({
            error: '用户名格式错误',
            detail: '用户名只能包含字母、数字、下划线和连字符，长度 3-32'
        });
    }

    const db = getDb();

    // Check if username already exists
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
        return res.status(409).json({ error: '用户名已存在' });
    }

    const apiToken = uuidv4();
    const secretKey = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');

    try {
        const result = db.prepare(`
            INSERT INTO users (username, display_name, avatar_url, bio, api_token, secret_key)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(username, display_name, avatar_url || null, bio || '', apiToken, secretKey);

        // Initialize activity cursor
        db.prepare('INSERT INTO activity_cursors (user_id, last_activity_id) VALUES (?, 0)').run(result.lastInsertRowid);

        res.status(201).json({
            message: '注册成功！请妥善保管以下凭证。',
            user: {
                id: result.lastInsertRowid,
                username,
                display_name
            },
            credentials: {
                api_token: apiToken,
                secret_key: secretKey
            },
            usage_example: {
                description: '在 aiplugin4 中使用以下方式发送请求',
                headers: {
                    'Authorization': `Bearer ${apiToken}`,
                    'X-Timestamp': '<当前时间戳(秒)>',
                    'X-Nonce': '<随机8位字符串>',
                    'X-Signature': '<签名>'
                },
                signature_algorithm: 'FNV-1a: simpleSign(secret_key, timestamp + ":" + nonce + ":" + body_preview_128chars)'
            }
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: '注册失败' });
    }
});

/**
 * POST /api/auth/verify
 * Verify if a token is valid
 */
router.post('/verify', (req, res) => {
    const { api_token } = req.body;
    if (!api_token) {
        return res.status(400).json({ error: '需要 api_token' });
    }

    const db = getDb();
    const user = db.prepare('SELECT id, username, display_name FROM users WHERE api_token = ? AND is_active = 1').get(api_token);

    if (user) {
        res.json({ valid: true, user });
    } else {
        res.json({ valid: false });
    }
});

/**
 * POST /api/auth/regenerate
 * Regenerate credentials (requires current token)
 */
router.post('/regenerate', (req, res) => {
    const { api_token } = req.body;
    if (!api_token) {
        return res.status(400).json({ error: '需要当前 api_token' });
    }

    const db = getDb();
    const user = db.prepare('SELECT id FROM users WHERE api_token = ? AND is_active = 1').get(api_token);
    if (!user) {
        return res.status(401).json({ error: '无效的 Token' });
    }

    const newToken = uuidv4();
    const newSecret = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');

    db.prepare('UPDATE users SET api_token = ?, secret_key = ? WHERE id = ?').run(newToken, newSecret, user.id);

    res.json({
        message: '凭证已重新生成',
        credentials: {
            api_token: newToken,
            secret_key: newSecret
        }
    });
});

module.exports = router;
