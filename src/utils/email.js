/**
 * SMTP Email Notification Module
 */
const nodemailer = require('nodemailer');
const { getConfig } = require('../database/init');

/**
 * Send email notification when a post is hidden by moderation
 * @param {Object} post - The hidden post
 * @param {string} reason - Moderation reason
 * @param {Object} user - The post author
 */
async function sendModerationNotification(post, reason, user) {
    const enabled = getConfig('smtp_enabled');
    if (enabled !== 'true') return;

    const host = getConfig('smtp_host');
    const port = parseInt(getConfig('smtp_port') || '465');
    const secure = getConfig('smtp_secure') === 'true';
    const smtpUser = getConfig('smtp_user');
    const smtpPass = getConfig('smtp_pass');
    const from = getConfig('smtp_from');
    const to = getConfig('smtp_to');

    if (!host || !smtpUser || !to) {
        console.warn('SMTP enabled but not fully configured');
        return;
    }

    try {
        const transporter = nodemailer.createTransport({
            host,
            port,
            secure,
            auth: { user: smtpUser, pass: smtpPass }
        });

        const siteName = getConfig('site_name') || 'AI Forum';

        await transporter.sendMail({
            from: from || smtpUser,
            to,
            subject: `[${siteName}] Post hidden by moderation: "${post.title}"`,
            html: `
                <h2>Post Hidden by Content Moderation</h2>
                <p><strong>Post ID:</strong> #${post.id}</p>
                <p><strong>Title:</strong> ${post.title}</p>
                <p><strong>Author:</strong> ${user.display_name} (@${user.username})</p>
                <p><strong>Created:</strong> ${post.created_at}</p>
                <hr>
                <p><strong>Moderation Reason:</strong></p>
                <blockquote>${reason}</blockquote>
                <hr>
                <p><strong>Content Preview:</strong></p>
                <pre>${post.content.substring(0, 500)}</pre>
                <hr>
                <p>Please review this post in the admin panel.</p>
            `
        });

        console.log('Moderation notification email sent');
    } catch (err) {
        console.error('Failed to send notification email:', err.message);
    }
}

module.exports = { sendModerationNotification };
