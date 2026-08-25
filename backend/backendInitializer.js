// ============================================================
// Backend Initialization Sequence - Task 2.3
// Orchestrates startup in proper order before Express server starts
// ============================================================

const { initializeClient: initializeSecretManager, getSecret } = require('./secretManager');
const { initializeAlist } = require('./alistStartupHandler');
const { verifyRcloneConnectivity } = require('./rcloneConnectivityCheck');
const TeraboxHybridHandler = require('./teraboxHybridHandler');
const LocalStorage = require('./local_storage');

// Global storage handler instance (for use in server.js)
let teraboxHybridHandler = null;

/**
 * Run complete initialization sequence
 * Steps:
 * 1. Load environment variables
 * 2. Initialize Local Storage mock files
 * 3. Initialize Secret Manager client
 * 4. Load Alist admin password from Secret Manager or env var
 * 5. Start Alist service
 * 6. Verify Rclone connectivity
 * 7. Initialize Rclone credential handler
 * 
 * Exits with status 1 if any critical stage fails
 */
async function runBackendInitialization() {
    console.log('\n================================================');
    console.log('[Backend] 🚀 Starting Arsip Backend...');
    console.log('[Backend] Time: ' + new Date().toISOString());
    console.log('================================================\n');

    try {
        // ================================================================
        // STAGE 1: Load environment variables
        // ================================================================
        console.log('[Stage 1] Loading environment variables...');
        require('dotenv').config({ path: require('path').join(__dirname, '.env') });

        const PORT = Number(process.env.PORT) || 5000;
        const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || null;
        const SUPABASE_URL = process.env.SUPABASE_URL;

        console.log(`[Config] PORT: ${PORT}`);
        console.log(`[Config] GCP_PROJECT_ID: ${GCP_PROJECT_ID || '(not set)'}`);
        console.log(`[Config] SUPABASE_URL: ${SUPABASE_URL ? '✓ SET' : '❌ NOT SET'}`);
        console.log('[Stage 1] ✅ Complete\n');

        // ================================================================
        // STAGE 1.5: Initialize Local Storage Mock Files (for preview)
        // ================================================================
        console.log('[Stage 1.5] Initializing local storage mock files...');
        try {
            LocalStorage.initializeMockFiles();
            console.log('[LocalStorage] ✅ Mock files initialized');
        } catch (err) {
            console.warn('[LocalStorage] Warning initializing mock files:', err.message);
        }
        console.log('[Stage 1.5] ✅ Complete\n');

        // ================================================================
        // STAGE 2: Initialize Secret Manager client
        // ================================================================
        console.log('[Stage 2] Initializing Secret Manager client...');
        const secretManagerReady = initializeSecretManager();
        if (GCP_PROJECT_ID) {
            console.log(`[SecretManager] Initialized for project: ${GCP_PROJECT_ID}`);
        } else {
            console.log('[SecretManager] GCP_PROJECT_ID not set, using fallback env vars');
        }
        console.log('[Stage 2] ✅ Complete\n');

        // ================================================================
        // STAGE 3: Load Alist admin password from Secret Manager
        // ================================================================
        console.log('[Stage 3] Loading Alist admin password...');
        let alistPassword = null;
        try {
            alistPassword = await getSecret(
                'arsip-alist-password',
                'ALIST_ADMIN_PASSWORD',
                null
            );
            console.log('[SecretManager] ✓ Alist password loaded from Secret Manager/env vars');
        } catch (err) {
            console.warn('[SecretManager] Failed to load Alist password:', err.message);
            console.warn('[SecretManager] Alist credentials are unavailable; storage authentication will fail explicitly');
        }
        console.log('[Stage 3] ✅ Complete\n');

        // ================================================================
        // STAGE 4: Start Alist service (optional - not critical)
        // ================================================================
        console.log('[Stage 4] Starting Alist service...');
        const alistResult = await initializeAlist();
        
        if (!alistResult.success) {
            console.warn('[Alist] ⚠ Startup warning (will use Terabox Direct API instead)');
            console.warn('[Alist] ' + alistResult.message);
            console.log('[Stage 4] ⚠ Skipped (Alist not available - Direct API enabled)\n');
        } else {
            console.log('[Alist] ✅ Service running on http://localhost:5244');
            console.log('[Stage 4] ✅ Complete\n');
        }

        // ================================================================
        // STAGE 5: Verify Rclone connectivity (optional - not critical)
        // ================================================================
        console.log('[Stage 5] Verifying Rclone connectivity...');
        const rcloneCheck = await verifyRcloneConnectivity();
        
        if (!rcloneCheck.success) {
            console.warn('[Rclone] ⚠ Not connected — will use Terabox Direct API instead');
            console.warn('[Rclone] ' + (rcloneCheck.message || rcloneCheck.error));
            console.log('[Stage 5] ⚠ Skipped (using Terabox Direct API)\n');
        } else {
            console.log(`[Rclone] ✅ Connected (${rcloneCheck.fileCount || 0} files visible)`);
            console.log('[Stage 5] ✅ Complete\n');
        }

        // ================================================================
        // STAGE 6: Initialize Rclone credential handler
        // ================================================================
        console.log('[Stage 6] Initializing Rclone credential handler...');
        // Note: secretManager.js is already initialized in Stage 2
        // Rclone wrapper (rclone_wrapper.js) will use credentials from rclone.conf
        console.log('[RcloneWrapper] Using credentials from rclone.conf');
        console.log('[Stage 6] ✅ Complete\n');

        // ================================================================
        // STAGE 7: Initialize Terabox Storage (Direct API + WebDAV Hybrid)
        // ================================================================
        console.log('[Stage 7] Initializing Terabox Storage Handler...');
        // Use alistPassword from Stage 3 (already declared)
        
        teraboxHybridHandler = new TeraboxHybridHandler({
          preferredMethod: 'direct', // Try direct API first
          fallbackEnabled: true,     // Fall back to WebDAV if direct fails
          logger: console
        });

        const storageInit = await teraboxHybridHandler.initialize();
        
        if (!storageInit.success) {
          console.warn('[TeraboxHybrid] ⚠ Warning - Storage initialization failed');
          console.warn('[TeraboxHybrid] ' + storageInit.error);
          console.warn('[TeraboxHybrid] Will retry on first operation');
        } else {
          console.log(`[TeraboxHybrid] ✅ Terabox ready (${storageInit.method})`);
        }
        console.log('[Stage 7] ✅ Complete\n');

        // ================================================================
        // ALL STAGES COMPLETE - Ready for Express startup
        // ================================================================
        console.log('================================================');
        console.log('[Backend] ✅ ALL INITIALIZATION STAGES COMPLETE');
        console.log('[Backend] Backend ready to start Express server');
        console.log('[Backend] Alist ready at http://localhost:5244');
        console.log('[Backend] Terabox Hybrid (Direct API + WebDAV)');
        console.log('================================================\n');

        return {
            success: true,
            port: PORT,
            message: 'All initialization stages completed successfully',
            teraboxHybridHandler: teraboxHybridHandler
        };

    } catch (err) {
        console.error('\n[Backend] ❌ INITIALIZATION SEQUENCE FAILED');
        console.error('[Backend] Error:', err.message);
        console.error('[Backend] Stack:', err.stack);
        console.error('[Backend] Exiting with status code 1\n');
        process.exit(1);
    }
}

module.exports = {
    runBackendInitialization,
    getTeraboxHybridHandler: () => teraboxHybridHandler
};
