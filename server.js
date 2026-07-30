const express = require('express');
const crypto = require('crypto');
const brevo = require('@getbrevo/brevo');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ===========================
// CONFIGURATION
// ===========================
const PORT = process.env.PORT || 3000;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'homiroosdz@gmail.com';
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'GymFlow Admin';
const ADMIN_EMAIL = 'homiroosdz@gmail.com'; // Your email where you receive requests

// ECDSA private key (from your private key PEM)
const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgQHWN91ctytxWFPqD
ZSXVbpw3TH39S5DqQVCnCR7gEfChRANCAAQcfwRdHHYXeIvoHbnz2ZiJX4xYZ59P
+mBe59vCW4DJTSpvFwkIMO90jpS9MtKuH1SNyly/3ayNkphKK9mn1wmm
-----END PRIVATE KEY-----`;

// ===========================
// IN-MEMORY STORAGE
// ===========================
// In production, use a database like MongoDB or PostgreSQL
const requests = new Map(); // token -> { fingerprint, email, status, licenseCode?, createdAt }

// ===========================
// BREVO EMAIL SETUP
// ===========================
const apiInstance = new brevo.TransactionalEmailsApi();
const apiKey = apiInstance.authentications['apiKey'];
apiKey.apiKey = BREVO_API_KEY;

async function sendAdminApprovalEmail(email, fingerprint, token) {
    const approveUrl = `https://gymflow-license-server.onrender.com/approve/${token}`;
    const denyUrl = `https://gymflow-license-server.onrender.com/deny/${token}`;

    const emailData = {
        sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
        to: [{ email: ADMIN_EMAIL, name: 'GymFlow Admin' }],
        subject: `🔐 New GymFlow Admin activation request from ${email}`,
        htmlContent: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #FF8C00;">GymFlow Admin Activation Request</h2>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Device Fingerprint:</strong> <code style="background: #f4f4f4; padding: 4px 8px; border-radius: 4px;">${fingerprint}</code></p>
                <p style="margin-top: 24px;">Click one of the buttons below to approve or deny this request:</p>
                <div style="margin: 32px 0; text-align: center;">
                    <a href="${approveUrl}" style="background: #28a745; color: white; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-right: 12px; display: inline-block;">✅ Approve</a>
                    <a href="${denyUrl}" style="background: #dc3545; color: white; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">❌ Deny</a>
                </div>
                <p style="color: #666; font-size: 12px; margin-top: 24px;">This request will expire in 24 hours.</p>
            </div>
        `
    };

    try {
        await apiInstance.sendTransacEmail(emailData);
        console.log(`✅ Admin approval email sent for ${email}`);
    } catch (error) {
        console.error('❌ Failed to send admin email:', error.message);
        throw error;
    }
}

async function sendUserNotification(email, status, licenseCode = null) {
    const subject = status === 'approved' 
        ? '✅ Your GymFlow Admin activation was approved!' 
        : '❌ Your GymFlow Admin activation was denied';
    
    let htmlContent = '';
    if (status === 'approved') {
        htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #28a745;">✅ Activation Approved!</h2>
                <p>Your GymFlow Admin device has been activated successfully.</p>
                <p>Open the app and you're ready to go.</p>
            </div>
        `;
    } else {
        htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #dc3545;">❌ Activation Denied</h2>
                <p>Your activation request was denied by the gym admin.</p>
                <p>If you believe this is a mistake, please contact your gym administrator.</p>
            </div>
        `;
    }

    const emailData = {
        sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
        to: [{ email: email, name: 'GymFlow User' }],
        subject: subject,
        htmlContent: htmlContent
    };

    try {
        await apiInstance.sendTransacEmail(emailData);
        console.log(`✅ User notification sent to ${email} (${status})`);
    } catch (error) {
        console.error('❌ Failed to send user notification:', error.message);
    }
}

// ===========================
// SIGNING FUNCTION
// ===========================
function signLicenseCode(fingerprint) {
    const sign = crypto.createSign('SHA256');
    sign.update(fingerprint);
    sign.end();
    return sign.sign(PRIVATE_KEY, 'base64');
}

// ===========================
// ENDPOINTS
// ===========================

// 1. User requests activation
app.post('/activate', async (req, res) => {
    const { fingerprint, email } = req.body;

    // Validate inputs
    if (!fingerprint || !email) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing fingerprint or email' 
        });
    }

    // Validate fingerprint format (XXXX-XXXX-XXXX-XXXX-XXXX-XXXX)
    const fingerprintRegex = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
    if (!fingerprintRegex.test(fingerprint)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Invalid fingerprint format' 
        });
    }

    // Check if this email/fingerprint already has a pending request
    for (const [token, request] of requests) {
        if (request.email === email && request.fingerprint === fingerprint && request.status === 'pending') {
            return res.json({ 
                success: false, 
                status: 'pending',
                message: 'You already have a pending request. Please wait for admin approval.',
                pollToken: token
            });
        }
    }

    // Generate unique token for this request
    const token = crypto.randomBytes(32).toString('hex');
    
    // Store the request
    requests.set(token, {
        fingerprint,
        email,
        status: 'pending',
        createdAt: Date.now()
    });

    // Send admin approval email
    try {
        await sendAdminApprovalEmail(email, fingerprint, token);
        
        // Return pending status to the app
        res.json({
            success: true,
            status: 'pending',
            message: 'Activation request sent. Please wait for admin approval.',
            pollToken: token
        });
    } catch (error) {
        // Email failed - still return pending but log the error
        console.error('Email send failed:', error);
        res.json({
            success: true,
            status: 'pending',
            message: 'Activation request sent. Please wait for admin approval.',
            pollToken: token
        });
    }
});

// 2. Admin approves
app.get('/approve/:token', async (req, res) => {
    const { token } = req.params;
    
    const request = requests.get(token);
    if (!request) {
        return res.status(404).send(`
            <h2>❌ Request not found</h2>
            <p>This activation request has expired or doesn't exist.</p>
        `);
    }

    if (request.status !== 'pending') {
        return res.status(400).send(`
            <h2>⚠️ Already processed</h2>
            <p>This request was already ${request.status}.</p>
        `);
    }

    // Generate license code
    const licenseCode = signLicenseCode(request.fingerprint);
    
    // Update request
    request.status = 'approved';
    request.licenseCode = licenseCode;
    
    // Send user notification
    await sendUserNotification(request.email, 'approved');
    
    // Clean up old requests (keep last 100)
    if (requests.size > 100) {
        const oldest = [...requests.entries()]
            .sort((a, b) => a[1].createdAt - b[1].createdAt)
            .slice(0, requests.size - 100);
        oldest.forEach(([key]) => requests.delete(key));
    }

    res.send(`
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 40px auto; text-align: center; padding: 20px; border-radius: 8px; background: #f8f9fa;">
            <h1 style="color: #28a745;">✅ Approved!</h1>
            <p style="font-size: 18px;">You have approved the activation for <strong>${request.email}</strong></p>
            <p style="color: #666;">The user will be notified and the app will unlock automatically.</p>
            <p style="font-size: 12px; color: #999; margin-top: 32px;">You can close this window now.</p>
        </div>
    `);
});

// 3. Admin denies
app.get('/deny/:token', async (req, res) => {
    const { token } = req.params;
    
    const request = requests.get(token);
    if (!request) {
        return res.status(404).send(`
            <h2>❌ Request not found</h2>
            <p>This activation request has expired or doesn't exist.</p>
        `);
    }

    if (request.status !== 'pending') {
        return res.status(400).send(`
            <h2>⚠️ Already processed</h2>
            <p>This request was already ${request.status}.</p>
        `);
    }

    // Update request
    request.status = 'denied';
    
    // Send user notification
    await sendUserNotification(request.email, 'denied');
    
    res.send(`
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 40px auto; text-align: center; padding: 20px; border-radius: 8px; background: #f8f9fa;">
            <h1 style="color: #dc3545;">❌ Denied</h1>
            <p style="font-size: 18px;">You have denied the activation for <strong>${request.email}</strong></p>
            <p style="color: #666;">The user will be notified.</p>
            <p style="font-size: 12px; color: #999; margin-top: 32px;">You can close this window now.</p>
        </div>
    `);
});

// 4. Poll status endpoint for the app
app.post('/status', async (req, res) => {
    const { pollToken } = req.body;
    
    if (!pollToken) {
        return res.status(400).json({ error: 'Missing pollToken' });
    }

    const request = requests.get(pollToken);
    if (!request) {
        return res.json({ 
            status: 'denied', 
            message: 'Request not found or expired' 
        });
    }

    switch (request.status) {
        case 'approved':
            return res.json({ 
                status: 'approved', 
                licenseCode: request.licenseCode 
            });
        case 'denied':
            return res.json({ 
                status: 'denied', 
                message: 'Your request was denied by the admin.' 
            });
        default:
            return res.json({ 
                status: 'pending' 
            });
    }
});

// ===========================
// START SERVER
// ===========================
app.listen(PORT, () => {
    console.log(`🚀 GymFlow Admin License Server running on port ${PORT}`);
});
