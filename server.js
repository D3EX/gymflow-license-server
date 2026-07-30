const express = require('express');
const crypto = require('crypto');
const https = require('https');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'homiroosdz@gmail.com';
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'GymFlow Admin';
const ADMIN_EMAIL = 'homiroosdz@gmail.com';

const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgQHWN91ctytxWFPqD
ZSXVbpw3TH39S5DqQVCnCR7gEfChRANCAAQcfwRdHHYXeIvoHbnz2ZiJX4xYZ59P
+mBe59vCW4DJTSpvFwkIMO90jpS9MtKuH1SNyly/3ayNkphKK9mn1wmm
-----END PRIVATE KEY-----`;

const requests = new Map();

// ==========================================
// EMAIL SENDING USING NATIVE HTTPS (NO SDK)
// ==========================================
function sendEmailViaBrevo(to, subject, htmlContent) {
    return new Promise((resolve, reject) => {
        // Sanitize the HTML content - remove extra whitespace and newlines
        const cleanHtml = htmlContent.replace(/\s+/g, ' ').trim();
        
        const emailData = {
            sender: { 
                email: BREVO_SENDER_EMAIL, 
                name: BREVO_SENDER_NAME 
            },
            to: [{ 
                email: to 
            }],
            subject: subject,
            htmlContent: cleanHtml
        };

        const data = JSON.stringify(emailData);

        const options = {
            hostname: 'api.brevo.com',
            port: 443,
            path: '/v3/smtp/email',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': BREVO_API_KEY,
                'Content-Length': data.length
            }
        };

        console.log(`📧 Sending email to ${to}`);
        console.log(`📝 Subject: ${subject}`);
        console.log(`📦 Data length: ${data.length} bytes`);

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => responseData += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log(`✅ Email sent successfully to ${to}`);
                    resolve(responseData);
                } else {
                    console.error(`❌ Brevo API error: ${res.statusCode}`);
                    console.error(`📄 Response: ${responseData}`);
                    reject(new Error(`Brevo API error: ${res.statusCode} - ${responseData}`));
                }
            });
        });

        req.on('error', (error) => {
            console.error(`❌ Request error: ${error.message}`);
            reject(error);
        });

        req.write(data);
        req.end();
    });
}

// ==========================================
// EMAIL FUNCTIONS
// ==========================================
async function sendAdminApprovalEmail(email, fingerprint, token) {
    const approveUrl = `https://gymflow-license-server.onrender.com/approve/${token}`;
    const denyUrl = `https://gymflow-license-server.onrender.com/deny/${token}`;

    // Use single-line HTML to avoid JSON parsing issues
    const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
            <h2 style="color:#FF8C00;">GymFlow Admin Activation Request</h2>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Device Fingerprint:</strong> <code style="background:#f4f4f4;padding:4px 8px;border-radius:4px;">${fingerprint}</code></p>
            <p style="margin-top:24px;">Click one of the buttons below to approve or deny this request:</p>
            <div style="margin:32px 0;text-align:center;">
                <a href="${approveUrl}" style="background:#28a745;color:white;padding:12px 32px;text-decoration:none;border-radius:6px;font-weight:bold;margin-right:12px;display:inline-block;">✅ Approve</a>
                <a href="${denyUrl}" style="background:#dc3545;color:white;padding:12px 32px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;">❌ Deny</a>
            </div>
            <p style="color:#666;font-size:12px;margin-top:24px;">This request will expire in 24 hours.</p>
        </div>
    `;

    console.log(`📧 Sending admin approval email for ${email}`);
    await sendEmailViaBrevo(
        ADMIN_EMAIL, 
        `🔐 New activation request from ${email}`, 
        html
    );
    console.log(`✅ Admin approval email sent for ${email}`);
}

async function sendUserNotification(email, status) {
    const subject = status === 'approved' 
        ? '✅ Your GymFlow Admin activation was approved!' 
        : '❌ Your GymFlow Admin activation was denied';
    
    const html = status === 'approved'
        ? `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                <h2 style="color:#28a745;">✅ Activation Approved!</h2>
                <p>Your GymFlow Admin device has been activated successfully.</p>
                <p>Open the app and you're ready to go.</p>
            </div>
        `
        : `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                <h2 style="color:#dc3545;">❌ Activation Denied</h2>
                <p>Your activation request was denied by the gym admin.</p>
                <p>If you believe this is a mistake, please contact your gym administrator.</p>
            </div>
        `;

    console.log(`📧 Sending user notification to ${email} (${status})`);
    await sendEmailViaBrevo(email, subject, html);
    console.log(`✅ User notification sent to ${email} (${status})`);
}

// ==========================================
// SIGNING FUNCTION
// ==========================================
function signLicenseCode(fingerprint) {
    const sign = crypto.createSign('SHA256');
    sign.update(fingerprint);
    sign.end();
    return sign.sign(PRIVATE_KEY, 'base64');
}

// ==========================================
// ENDPOINTS
// ==========================================

// 1. User requests activation
app.post('/activate', async (req, res) => {
    const { fingerprint, email } = req.body;

    if (!fingerprint || !email) {
        return res.status(400).json({ success: false, error: 'Missing fingerprint or email' });
    }

    const fingerprintRegex = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
    if (!fingerprintRegex.test(fingerprint)) {
        return res.status(400).json({ success: false, error: 'Invalid fingerprint format' });
    }

    // Check for existing pending request
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

    const token = crypto.randomBytes(32).toString('hex');
    
    requests.set(token, {
        fingerprint,
        email,
        status: 'pending',
        createdAt: Date.now()
    });

    try {
        await sendAdminApprovalEmail(email, fingerprint, token);
        res.json({
            success: true,
            status: 'pending',
            message: 'Activation request sent. Please wait for admin approval.',
            pollToken: token
        });
    } catch (error) {
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
        return res.status(404).send(`<h2>❌ Request not found</h2><p>This activation request has expired or doesn't exist.</p>`);
    }

    if (request.status !== 'pending') {
        return res.status(400).send(`<h2>⚠️ Already ${request.status}</h2>`);
    }

    const licenseCode = signLicenseCode(request.fingerprint);
    request.status = 'approved';
    request.licenseCode = licenseCode;
    
    await sendUserNotification(request.email, 'approved');
    
    // Clean up old requests (keep last 100)
    if (requests.size > 100) {
        const oldest = [...requests.entries()]
            .sort((a, b) => a[1].createdAt - b[1].createdAt)
            .slice(0, requests.size - 100);
        oldest.forEach(([key]) => requests.delete(key));
    }

    res.send(`
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:40px auto;text-align:center;padding:20px;border-radius:8px;background:#f8f9fa;">
            <h1 style="color:#28a745;">✅ Approved!</h1>
            <p style="font-size:18px;">You have approved the activation for <strong>${request.email}</strong></p>
            <p style="color:#666;">The user will be notified and the app will unlock automatically.</p>
            <p style="font-size:12px;color:#999;margin-top:32px;">You can close this window now.</p>
        </div>
    `);
});

// 3. Admin denies
app.get('/deny/:token', async (req, res) => {
    const { token } = req.params;
    
    const request = requests.get(token);
    if (!request) {
        return res.status(404).send(`<h2>❌ Request not found</h2><p>This activation request has expired or doesn't exist.</p>`);
    }

    if (request.status !== 'pending') {
        return res.status(400).send(`<h2>⚠️ Already ${request.status}</h2>`);
    }

    request.status = 'denied';
    await sendUserNotification(request.email, 'denied');
    
    res.send(`
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:40px auto;text-align:center;padding:20px;border-radius:8px;background:#f8f9fa;">
            <h1 style="color:#dc3545;">❌ Denied</h1>
            <p style="font-size:18px;">You have denied the activation for <strong>${request.email}</strong></p>
            <p style="color:#666;">The user will be notified.</p>
            <p style="font-size:12px;color:#999;margin-top:32px;">You can close this window now.</p>
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
        return res.json({ status: 'denied', message: 'Request not found or expired' });
    }

    switch (request.status) {
        case 'approved':
            return res.json({ status: 'approved', licenseCode: request.licenseCode });
        case 'denied':
            return res.json({ status: 'denied', message: 'Your request was denied by the admin.' });
        default:
            return res.json({ status: 'pending' });
    }
});

// ==========================================
// START SERVER
// ==========================================
app.listen(PORT, () => {
    console.log(`🚀 GymFlow Admin License Server running on port ${PORT}`);
});
