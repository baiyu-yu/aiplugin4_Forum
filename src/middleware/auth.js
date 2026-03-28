const { getDb } = require('../database/init');
const { verifySignature } = require('../utils/signature');

/**
 * Authentication middleware for API routes
 * Validates Token + Timestamp + Nonce + Signature
 */
function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    const timestamp = req.headers['x-timestamp'];
    const nonce = req.headers['x-nonce'];
    const signature = req.headers['x-signature'];

    // Check all required headers
    if (!authHeader || !timestamp || !nonce || !signature) {
        return res.status(401).json({
            error: '缺少认证信息',
            detail: '需要 Authorization, X-Timestamp, X-Nonce, X-Signature 头'
        });
    }

    // Extract token from Bearer scheme
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
        return res.status(401).json({ error: '无效的 Authorization 头' });
    }

    // Check timestamp (within 5 minutes)
    const now = Math.floor(Date.now() / 1000);
    const reqTime = parseInt(timestamp, 10);
    if (isNaN(reqTime) || Math.abs(now - reqTime) > 300) {
        return res.status(401).json({
            error: '时间戳过期或无效',
            detail: '请求时间戳与服务器时间相差超过 5 分钟'
        });
    }

    const db = getDb();

    // Check nonce uniqueness (prevent replay)
    const existingNonce = db.prepare('SELECT nonce FROM used_nonces WHERE nonce = ?').get(nonce);
    if (existingNonce) {
        return res.status(401).json({ error: 'Nonce 已被使用（可能的重放攻击）' });
    }

    // Find user by token
    const user = db.prepare('SELECT * FROM users WHERE api_token = ? AND is_active = 1').get(token);
    if (!user) {
        return res.status(401).json({ error: '无效的 API Token' });
    }

    // Verify signature
    let bodyPreview = '';
    if (req.body && typeof req.body === 'object') {
        bodyPreview = JSON.stringify(req.body).substring(0, 128);
    } else if (typeof req.body === 'string') {
        bodyPreview = req.body.substring(0, 128);
    }

    if (!verifySignature(user.secret_key, timestamp, nonce, bodyPreview, signature)) {
        return res.status(401).json({ error: '签名验证失败' });
    }

    // Store nonce to prevent replay
    db.prepare('INSERT INTO used_nonces (nonce) VALUES (?)').run(nonce);

    // Periodically clean old nonces (1% chance per request)
    if (Math.random() < 0.01) {
        db.prepare("DELETE FROM used_nonces WHERE used_at < datetime('now', '-10 minutes')").run();
    }

    // Attach user to request
    req.user = user;
    next();
}

module.exports = { authMiddleware };
