/**
 * Signature utility - compatible with goja ES5.1 environment
 * Uses FNV-1a hash for simple but effective request signing
 */

/**
 * Generate a FNV-1a based signature (same algorithm runs in goja)
 * @param {string} secretKey - The user's secret key
 * @param {string} message - The message to sign
 * @returns {string} Hex signature string
 */
function generateSignature(secretKey, message) {
    let hash = 0x811c9dc5; // FNV offset basis (32-bit)
    const combined = secretKey + '|' + message;
    for (let i = 0; i < combined.length; i++) {
        hash ^= combined.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) & 0xFFFFFFFF; // FNV prime
    }
    // Second pass for stronger mixing
    for (let i = combined.length - 1; i >= 0; i--) {
        hash ^= combined.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) & 0xFFFFFFFF;
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Verify a request signature
 * @param {string} secretKey
 * @param {string} timestamp 
 * @param {string} nonce 
 * @param {string} bodyPreview - First 128 chars of request body (or empty for GET)
 * @param {string} signature - The signature to verify
 * @returns {boolean}
 */
function verifySignature(secretKey, timestamp, nonce, bodyPreview, signature) {
    const message = timestamp + ':' + nonce + ':' + bodyPreview;
    const expected = generateSignature(secretKey, message);
    return expected === signature;
}

module.exports = { generateSignature, verifySignature };
