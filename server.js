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
// EMAIL SENDING
// ==========================================
function sendEmailViaBrevo(to, subject, htmlContent) {
    return new Promise((resolve, reject) => {
        const emailData = {
            sender: {
                email: BREVO_SENDER_EMAIL,
                name: BREVO_SENDER_NAME
            },
            to: [{
                email: to
            }],
            subject: subject,
            htmlContent: htmlContent
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
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => responseData += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(responseData);
                } else {
                    reject(new Error(`Brevo API error: ${res.statusCode} - ${responseData}`));
                }
            });
        });

        req.on('error', (error) => reject(error));
        req.write(data);
        req.end();
    });
}

// ==========================================
// PROFESSIONAL EMAIL TEMPLATES
// ==========================================
function getAdminApprovalEmail(email, fingerprint, approveUrl, denyUrl) {
    return `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
            <div style="background: #FF8C00; padding: 24px 32px;">
                <h2 style="color: #ffffff; margin: 0; font-weight: 600; font-size: 20px; letter-spacing: 0.5px;">GymFlow Admin</h2>
            </div>
            <div style="padding: 32px 32px 24px;">
                <h3 style="color: #1a1a1a; margin: 0 0 16px; font-size: 18px; font-weight: 600;">New Activation Request</h3>
                
                <div style="background: #f8f9fa; border-radius: 6px; padding: 16px; margin-bottom: 24px;">
                    <p style="margin: 4px 0; color: #495057; font-size: 14px;">
                        <strong style="color: #212529;">Email:</strong> ${email}
                    </p>
                    <p style="margin: 4px 0; color: #495057; font-size: 14px;">
                        <strong style="color: #212529;">Device:</strong> <code style="background: #e9ecef; padding: 2px 8px; border-radius: 4px; font-size: 13px;">${fingerprint}</code>
                    </p>
                </div>
                
                <p style="color: #495057; font-size: 14px; margin-bottom: 24px;">Please review and respond to this activation request:</p>
                
                <div style="text-align: center; margin: 32px 0;">
                    <a href="${approveUrl}" style="background: #28a745; color: #ffffff; padding: 12px 36px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block; margin-right: 12px;">Approve</a>
                    <a href="${denyUrl}" style="background: #dc3545; color: #ffffff; padding: 12px 36px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block;">Decline</a>
                </div>
                
                <p style="color: #868e96; font-size: 12px; text-align: center; margin: 24px 0 0;">This request will expire in 24 hours.</p>
            </div>
        </div>
    `;
}

function getUserApprovedEmail() {
    return `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
            <div style="background: #28a745; padding: 24px 32px;">
                <h2 style="color: #ffffff; margin: 0; font-weight: 600; font-size: 20px; letter-spacing: 0.5px;">GymFlow Admin</h2>
            </div>
            <div style="padding: 32px 32px 24px; text-align: center;">
                <div style="background: #e8f5e9; border-radius: 50%; width: 64px; height: 64px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
                    <span style="font-size: 32px;">✓</span>
                </div>
                <h3 style="color: #1a1a1a; margin: 0 0 12px; font-size: 18px; font-weight: 600;">Activation Approved</h3>
                <p style="color: #495057; font-size: 14px; line-height: 1.6;">Your GymFlow Admin device has been successfully activated. You can now open the app and start using it.</p>
            </div>
        </div>
    `;
}

function getUserDeniedEmail() {
    return `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
            <div style="background: #dc3545; padding: 24px 32px;">
                <h2 style="color: #ffffff; margin: 0; font-weight: 600; font-size: 20px; letter-spacing: 0.5px;">GymFlow Admin</h2>
            </div>
            <div style="padding: 32px 32px 24px; text-align: center;">
                <div style="background: #fbe9e7; border-radius: 50%; width: 64px; height: 64px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
                    <span style="font-size: 32px;">✕</span>
                </div>
                <h3 style="color: #1a1a1a; margin: 0 0 12px; font-size: 18px; font-weight: 600;">Activation Declined</h3>
                <p style="color: #495057; font-size: 14px; line-height: 1.6;">Your activation request has been declined. If you believe this is a mistake, please contact your gym administrator.</p>
            </div>
        </div>
    `;
}

async function sendAdminApprovalEmail(email, fingerprint, token) {
    const approveUrl = `https://gymflow-license-server.onrender.com/approve/${token}`;
    const denyUrl = `https://gymflow-license-server.onrender.com/deny/${token}`;
    
    const html = getAdminApprovalEmail(email, fingerprint, approveUrl, denyUrl);
    await sendEmailViaBrevo(ADMIN_EMAIL, `New activation request from ${email}`, html);
}

async function sendUserNotification(email, status) {
    const subject = status === 'approved' 
        ? 'Your GymFlow Admin activation was approved' 
        : 'Your GymFlow Admin activation was declined';
    
    const html = status === 'approved' 
        ? getUserApprovedEmail() 
        : getUserDeniedEmail();

    await sendEmailViaBrevo(email, subject, html);
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

app.post('/activate', async (req, res) => {
    const { fingerprint, email } = req.body;

    if (!fingerprint || !email) {
        return res.status(400).json({ success: false, error: 'Missing fingerprint or email' });
    }

    const fingerprintRegex = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
    if (!fingerprintRegex.test(fingerprint)) {
        return res.status(400).json({ success: false, error: 'Invalid fingerprint format' });
    }

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

app.get('/approve/:token', async (req, res) => {
    const { token } = req.params;
    
    const request = requests.get(token);
    if (!request) {
        return res.status(404).send(`
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; text-align: center; padding: 40px; color: #495057;">
                <h2 style="color: #dc3545;">Request Not Found</h2>
                <p>This activation request has expired or does not exist.</p>
            </div>
        `);
    }

    if (request.status !== 'pending') {
        return res.status(400).send(`
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; text-align: center; padding: 40px; color: #495057;">
                <h2 style="color: #ffc107;">Already Processed</h2>
                <p>This request was already ${request.status}.</p>
            </div>
        `);
    }

    const licenseCode = signLicenseCode(request.fingerprint);
    request.status = 'approved';
    request.licenseCode = licenseCode;
    
    await sendUserNotification(request.email, 'approved');
    
    if (requests.size > 100) {
        const oldest = [...requests.entries()]
            .sort((a, b) => a[1].createdAt - b[1].createdAt)
            .slice(0, requests.size - 100);
        oldest.forEach(([key]) => requests.delete(key));
    }

    res.send(`
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 40px auto; text-align: center; padding: 32px; border-radius: 8px; background: #f8f9fa;">
            <div style="background: #e8f5e9; border-radius: 50%; width: 64px; height: 64px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
                <span style="font-size: 32px; color: #28a745;">✓</span>
            </div>
            <h1 style="color: #28a745; margin: 0 0 8px; font-size: 24px;">Approved</h1>
            <p style="font-size: 16px; color: #495057; margin: 0;">You have approved the activation for <strong>${request.email}</strong></p>
            <p style="color: #868e96; font-size: 14px; margin-top: 16px;">The user will be notified and the app will unlock automatically.</p>
            <p style="color: #868e96; font-size: 12px; margin-top: 32px;">You may close this window.</p>
        </div>
    `);
});

app.get('/deny/:token', async (req, res) => {
    const { token } = req.params;
    
    const request = requests.get(token);
    if (!request) {
        return res.status(404).send(`
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; text-align: center; padding: 40px; color: #495057;">
                <h2 style="color: #dc3545;">Request Not Found</h2>
                <p>This activation request has expired or does not exist.</p>
            </div>
        `);
    }

    if (request.status !== 'pending') {
        return res.status(400).send(`
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; text-align: center; padding: 40px; color: #495057;">
                <h2 style="color: #ffc107;">Already Processed</h2>
                <p>This request was already ${request.status}.</p>
            </div>
        `);
    }

    request.status = 'denied';
    await sendUserNotification(request.email, 'denied');
    
    res.send(`
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 40px auto; text-align: center; padding: 32px; border-radius: 8px; background: #f8f9fa;">
            <div style="background: #fbe9e7; border-radius: 50%; width: 64px; height: 64px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
                <span style="font-size: 32px; color: #dc3545;">✕</span>
            </div>
            <h1 style="color: #dc3545; margin: 0 0 8px; font-size: 24px;">Declined</h1>
            <p style="font-size: 16px; color: #495057; margin: 0;">You have declined the activation for <strong>${request.email}</strong></p>
            <p style="color: #868e96; font-size: 14px; margin-top: 16px;">The user will be notified.</p>
            <p style="color: #868e96; font-size: 12px; margin-top: 32px;">You may close this window.</p>
        </div>
    `);
});

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

app.listen(PORT, () => {
    console.log(`🚀 GymFlow Admin License Server running on port ${PORT}`);
});
