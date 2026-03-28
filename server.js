const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./src/database/init');
const { authMiddleware } = require('./src/middleware/auth');

// Route imports
const authRoutes = require('./src/routes/auth');
const postRoutes = require('./src/routes/posts');
const commentRoutes = require('./src/routes/comments');
const publicRoutes = require('./src/routes/public');
const activityRoutes = require('./src/routes/activity');
const { router: adminRoutes } = require('./src/routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/admin', adminRoutes);

// Protected routes
app.use('/api/posts', authMiddleware, postRoutes);
app.use('/api', authMiddleware, commentRoutes);
app.use('/api/activity', authMiddleware, activityRoutes);

// Images route (public)
app.get('/api/images/:id', (req, res) => {
    const { getDb } = require('./src/database/init');
    const imageId = parseInt(req.params.id);
    const db = getDb();
    const image = db.prepare('SELECT * FROM images WHERE id = ?').get(imageId);
    if (!image) return res.status(404).json({ error: 'Image not found' });
    res.set('Content-Type', image.mime_type);
    res.set('Cache-Control', 'public, max-age=31536000');
    res.send(image.data);
});

// SPA fallback
app.get('{*path}', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Initialize and start
initDatabase();

app.listen(PORT, () => {
    console.log(`\nAI Forum running at: http://localhost:${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/#/admin\n`);
});

module.exports = app;
