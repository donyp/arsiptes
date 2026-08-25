// ============================================================
// Google Drive File Auto-Sync
// Periodically scan ARSIP ANKA for new/updated files
// Auto-insert to database when changes detected
// ============================================================

const { execSync } = require('child_process');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RCLONE_CONFIG = path.join(__dirname, 'rclone.conf');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Scan interval: every 5 minutes
const SYNC_INTERVAL = 5 * 60 * 1000;

/**
 * Parse storage path to extract metadata
 * Path format: /arsip/zona-X/TOKO-NAME/CATEGORY/filename.pdf
 */
function parseStoragePath(gpath) {
    // Example: zona-2/TOKO-SAWANGAN/INVOICE/invoice.pdf
    const parts = gpath.split('/').filter(p => p);
    
    if (parts.length < 4) return null;
    
    const zona = parts[0];  // zona-2
    const toko = parts[1];  // TOKO-SAWANGAN
    const category = parts[2];  // INVOICE
    const filename = parts.slice(3).join('/');  // invoice.pdf
    
    return { zona, toko, category, filename, storagePath: gpath };
}

/**
 * List all files in ARSIP ANKA using rclone
 */
function listGdriveFiles() {
    try {
        // Use single path without escaping for better compatibility
        const cmd = `rclone lsjson "gdrive:/ARSIP ANKA" --config "${RCLONE_CONFIG}" --recursive`;
        const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
        const files = JSON.parse(output);
        
        return files
            .filter(f => !f.IsDir && f.Name.toLowerCase().endsWith('.pdf'))
            .map(f => ({
                name: f.Name,
                size: f.Size,
                modTime: f.ModTime,
                // Extract path relative to ARSIP ANKA
                path: f.Path || ''
            }));
    } catch (err) {
        console.error('[GDriveSync] Error listing files:', err.message);
        return [];
    }
}

/**
 * Check if file already in database
 */
async function fileExistsInDb(storagePath) {
    try {
        const { data, error } = await supabase
            .from('files')
            .select('id')
            .eq('storage_path', storagePath)
            .limit(1);
        
        if (error) throw error;
        return data && data.length > 0;
    } catch (err) {
        console.error('[GDriveSync] DB check error:', err.message);
        return false;
    }
}

/**
 * Insert new file to database
 */
async function insertFileToDb(fileInfo) {
    try {
        const metadata = parseStoragePath(fileInfo.path);
        if (!metadata) {
            console.warn('[GDriveSync] Cannot parse path:', fileInfo.path);
            return false;
        }

        const { data, error } = await supabase
            .from('files')
            .insert([{
                filename: metadata.filename,
                original_name: fileInfo.name,
                storage_path: `gdrive:/ARSIP ANKA/${fileInfo.path}`,
                file_size: fileInfo.size,
                file_type: 'application/pdf',
                upload_date: new Date().toISOString(),
                modified_date: fileInfo.modTime,
                zona_kode: metadata.zona,
                toko_kode: metadata.toko,
                category: metadata.category,
                synced: true,
                sync_attempts: 0,
                sync_error: null,
                created_at: new Date().toISOString()
            }]);

        if (error) {
            console.error('[GDriveSync] Insert error:', error.message);
            return false;
        }

        console.log(`[GDriveSync] ✅ Inserted: ${metadata.zona}/${metadata.toko}/${metadata.category}/${metadata.filename}`);
        return true;
    } catch (err) {
        console.error('[GDriveSync] Error inserting file:', err.message);
        return false;
    }
}

/**
 * Sync files from Google Drive to database
 */
async function syncGdriveFiles() {
    console.log(`[GDriveSync] Starting scan at ${new Date().toISOString()}`);
    
    const files = listGdriveFiles();
    console.log(`[GDriveSync] Found ${files.length} PDF files in ARSIP ANKA`);
    
    let synced = 0;
    let skipped = 0;
    
    for (const file of files) {
        const storagePath = `gdrive:/ARSIP ANKA/${file.path}`;
        const exists = await fileExistsInDb(storagePath);
        
        if (!exists) {
            const success = await insertFileToDb(file);
            if (success) synced++;
        } else {
            skipped++;
        }
    }
    
    console.log(`[GDriveSync] Complete: ${synced} new, ${skipped} existing`);
    return { synced, skipped, total: files.length };
}

/**
 * Start auto-sync worker
 */
function startAutoSync(interval = SYNC_INTERVAL) {
    console.log(`[GDriveSync] Starting auto-sync worker (interval: ${interval / 1000}s)`);
    
    // Run immediately
    syncGdriveFiles().catch(err => console.error('[GDriveSync] Error:', err));
    
    // Then repeat on interval
    setInterval(() => {
        syncGdriveFiles().catch(err => console.error('[GDriveSync] Error:', err));
    }, interval);
}

/**
 * Manual sync endpoint
 */
async function manualSync() {
    return await syncGdriveFiles();
}

module.exports = {
    startAutoSync,
    manualSync,
    syncGdriveFiles,
    listGdriveFiles,
    parseStoragePath
};

// Run if executed directly
if (require.main === module) {
    console.log('[GDriveSync] Running manual sync...');
    syncGdriveFiles().then(result => {
        console.log('[GDriveSync] Result:', result);
        process.exit(0);
    }).catch(err => {
        console.error('[GDriveSync] Fatal error:', err);
        process.exit(1);
    });
}
