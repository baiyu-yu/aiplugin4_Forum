/**
 * Image Migration Script
 * Migrates image BLOBs from SQLite database into data/uploads/ filesystem storage
 */
const path = require('path');
const fs = require('fs');
const { getDb } = require('../src/database/init');

function migrateImages() {
    const db = getDb();
    const DATA_DIR = path.join(__dirname, '..', 'data');
    const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

    if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }

    // Ensure file_path column exists
    try {
        db.exec("ALTER TABLE images ADD COLUMN file_path TEXT");
    } catch (e) {}

    const images = db.prepare("SELECT id, filename, mime_type, data, file_path FROM images WHERE length(data) > 0").all();

    console.log(`Found ${images.length} image(s) with BLOB data to migrate.`);

    if (images.length === 0) {
        console.log('No images need migration.');
        return;
    }

    let migrated = 0;
    let bytesFreed = 0;

    const mimeMap = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/svg+xml': 'svg'
    };

    const emptyBuffer = Buffer.alloc(0);
    const updateStmt = db.prepare('UPDATE images SET file_path = ?, data = ? WHERE id = ?');

    const migrateTx = db.transaction(() => {
        for (const img of images) {
            if (!img.data || img.data.length === 0) continue;

            const ext = mimeMap[img.mime_type] || 'png';
            const fileName = `img_${img.id}_${Date.now()}.${ext}`;
            const relativePath = path.join('data', 'uploads', fileName).replace(/\\/g, '/');
            const absolutePath = path.join(UPLOADS_DIR, fileName);

            fs.writeFileSync(absolutePath, img.data);
            bytesFreed += img.data.length;

            updateStmt.run(relativePath, emptyBuffer, img.id);
            migrated++;
        }
    });

    migrateTx();

    console.log(`Successfully migrated ${migrated} image(s).`);
    console.log(`Freed ${(bytesFreed / (1024 * 1024)).toFixed(2)} MB of BLOB data from database records.`);
}

if (require.main === module) {
    try {
        migrateImages();
        console.log('Migration completed successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

module.exports = { migrateImages };
