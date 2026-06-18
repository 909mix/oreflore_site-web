const SHEET_ID         = '1fnMikQI5xcIQRIdYsBLSJh57Z_iDnAguRviieBRM_6M';
const TURNSTILE_SECRET = 'COLLER_CLE_SECRETE_ICI'; // Cloudflare dashboard > Turnstile > Secret key

function doPost(e) {
  try {
    var nom      = e.parameter.nom      || '';
    var courriel = e.parameter.courriel || '';
    var token    = e.parameter['cf-turnstile-response'] || '';

    // Validate Turnstile CAPTCHA (skip if secret not configured yet)
    if (TURNSTILE_SECRET !== 'COLLER_CLE_SECRETE_ICI' && token) {
      var verify = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method      : 'post',
        contentType : 'application/x-www-form-urlencoded',
        payload     : 'secret=' + TURNSTILE_SECRET + '&response=' + token
      });
      var verified = JSON.parse(verify.getContentText()).success;
      if (!verified) {
        return json({ success: false, error: 'CAPTCHA invalide' });
      }
    }

    // Basic validation
    if (!nom || !courriel || courriel.indexOf('@') === -1) {
      return json({ success: false, error: 'Donnees invalides' });
    }

    // Append row: Date | Nom | Courriel
    SpreadsheetApp
      .openById(SHEET_ID)
      .getActiveSheet()
      .appendRow([new Date(), nom, courriel]);

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
