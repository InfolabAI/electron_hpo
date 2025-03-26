/**
 * License Manager Module
 * 
 * Handles license generation and validation for the application.
 * - In development mode: Automatically generates a valid license
 * - In production mode: Validates the existing license
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Secret key for license encryption (in real production, store this securely)
const SECRET_KEY = 'hp_optimizer_secret_key_2024';

/**
 * Generates a license file with the specified validity period
 * @param {string} licensePath Path where to save the license file
 * @param {number} validityDays Number of days the license is valid for
 * @returns {boolean} Success status
 */
function generateLicense(licensePath, validityDays = 365) {
    try {
        // Create expiration date
        const now = new Date();
        const expirationDate = new Date(now);
        expirationDate.setDate(now.getDate() + validityDays);

        // License data
        const licenseData = {
            customer: 'Development License',
            email: 'dev@example.com',
            expirationDate: expirationDate.toISOString(),
            createdAt: now.toISOString(),
            hardwareId: getHardwareId(),
            version: '1.0'
        };

        // Encrypt license data
        const encryptedData = encryptLicense(licenseData);

        // Ensure directory exists
        const licenseDir = path.dirname(licensePath);
        if (!fs.existsSync(licenseDir)) {
            fs.mkdirSync(licenseDir, { recursive: true });
        }

        // Write to file
        fs.writeFileSync(licensePath, encryptedData);

        console.log('[INFO] Development license generated successfully');
        console.log(`[INFO] License expires on: ${expirationDate.toLocaleDateString()}`);

        return true;
    } catch (error) {
        console.error('[ERROR] Failed to generate license:', error.message);
        return false;
    }
}

/**
 * Validates a license file
 * @param {string} licensePath Path to the license file
 * @returns {Object} License validation result
 */
function validateLicense(licensePath) {
    try {
        // Check if license file exists
        if (!fs.existsSync(licensePath)) {
            return {
                valid: false,
                reason: 'License file not found'
            };
        }

        // Read license file
        const encryptedData = fs.readFileSync(licensePath, 'utf8');

        // Decrypt license data
        try {
            const licenseData = decryptLicense(encryptedData);

            // Validate hardware ID (optional)
            // const currentHardwareId = getHardwareId();
            // if (licenseData.hardwareId !== currentHardwareId) {
            //     return {
            //         valid: false,
            //         reason: 'License is not valid for this hardware'
            //     };
            // }

            // Check expiration date
            const expirationDate = new Date(licenseData.expirationDate);
            const now = new Date();

            if (expirationDate < now) {
                return {
                    valid: false,
                    reason: 'License has expired',
                    expiration: expirationDate,
                    licenseData: licenseData
                };
            }

            return {
                valid: true,
                expiration: expirationDate,
                licenseData: licenseData
            };
        } catch (decryptError) {
            console.error('[ERROR] License decryption failed:', decryptError.message);
            return {
                valid: false,
                reason: 'Invalid license format or corrupted file'
            };
        }
    } catch (error) {
        console.error('[ERROR] License validation error:', error.message);
        return {
            valid: false,
            reason: 'Error validating license: ' + error.message
        };
    }
}

/**
 * Encrypt license data
 * @param {Object} licenseData License data to encrypt
 * @returns {string} Encrypted license data
 */
function encryptLicense(licenseData) {
    // Convert to JSON
    const licenseJson = JSON.stringify(licenseData);

    // Create cipher
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(SECRET_KEY, 'salt', 32);
    const iv = crypto.randomBytes(16);

    // Encrypt
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(licenseJson, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Combine IV and encrypted data
    return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt license data
 * @param {string} encryptedData Encrypted license data
 * @returns {Object} Decrypted license data
 */
function decryptLicense(encryptedData) {
    // Split IV and data
    const parts = encryptedData.split(':');
    if (parts.length !== 2) {
        throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];

    // Create decipher
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(SECRET_KEY, 'salt', 32);

    // Decrypt
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    // Parse JSON
    return JSON.parse(decrypted);
}

/**
 * Get a unique hardware identifier
 * @returns {string} Hardware identifier
 */
function getHardwareId() {
    // In a real application, you'd use something like:
    // - MAC address
    // - CPU ID
    // - Disk serial number
    // - OS installation ID

    // For demonstration, we'll just use a placeholder
    return 'DEV-HARDWARE-ID';
}

module.exports = {
    generateLicense,
    validateLicense
};