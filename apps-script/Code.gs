const SHEET_ID         = '1fnMikQI5xcIQRIdYsBLSJh57Z_iDnAguRviieBRM_6M';
const TURNSTILE_SECRET = 'COLLER_CLE_SECRETE_ICI';
const BREVO_API_KEY    = 'BREVO_API_KEY_HERE';

function doPost(e) {
  try {
    var nom      = e.parameter.nom      || '';
    var courriel = e.parameter.courriel || '';
    var token    = e.parameter['cf-turnstile-response'] || '';

    // Validate Turnstile CAPTCHA. This fails closed: a request with no token,
    // or a deployment where the secret was never filled in, is rejected rather
    // than waved through — otherwise anyone can POST straight to /exec.
    if (!token) {
      return json({ success: false, error: 'CAPTCHA requis' });
    }
    if (TURNSTILE_SECRET === 'COLLER_CLE_SECRETE_ICI') {
      return json({ success: false, error: 'Configuration serveur incomplete' });
    }
    var verify = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method      : 'post',
      contentType : 'application/x-www-form-urlencoded',
      // Tokens are base64-ish and can contain '+', which a form-encoded body
      // would otherwise decode as a space.
      payload     : 'secret=' + encodeURIComponent(TURNSTILE_SECRET) +
                    '&response=' + encodeURIComponent(token)
    });
    if (!JSON.parse(verify.getContentText()).success) {
      return json({ success: false, error: 'CAPTCHA invalide' });
    }

    // Basic validation
    if (!nom || !courriel || courriel.indexOf('@') === -1) {
      return json({ success: false, error: 'Donnees invalides' });
    }

    // 1. Append to Google Sheet
    SpreadsheetApp
      .openById(SHEET_ID)
      .getActiveSheet()
      .appendRow([new Date(), nom, courriel]);

    // 2. Add contact to Brevo
    if (BREVO_API_KEY !== 'BREVO_API_KEY_HERE') {
      UrlFetchApp.fetch('https://api.brevo.com/v3/contacts', {
        method             : 'post',
        contentType        : 'application/json',
        headers            : { 'api-key': BREVO_API_KEY },
        payload            : JSON.stringify({
          email         : courriel,
          attributes    : { PRENOM: nom },
          listIds       : [3],
          updateEnabled : true
        }),
        muteHttpExceptions : true
      });
    }

    return json({ success: true });

  } catch (err) {
    return json({ success: false, error: err.toString() });
  }
}

function json(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
