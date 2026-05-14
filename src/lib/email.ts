// ─────────────────────────────────────────────────────────
//  Email — envoi via Resend
// ─────────────────────────────────────────────────────────

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const EMAIL_FROM = process.env.EMAIL_FROM ?? "CinéRadar <alertes@cineradar.fr>";
const RESEND_API_URL = "https://api.resend.com/emails";

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

/**
 * Envoie un email via l'API Resend.
 * Si RESEND_API_KEY n'est pas configuré, logue simplement en console.
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const isDev = process.env["NODE_ENV"] !== "production";

  // En dev : toujours afficher le lien dans la console (utile même si Resend fonctionne)
  if (isDev) {
    console.log("\n──────────────────────────────────────────");
    console.log(`[Email DEV] À       : ${options.to}`);
    console.log(`[Email DEV] Objet   : ${options.subject}`);
    // Extraire les liens du HTML pour les afficher directement
    const links = [...options.html.matchAll(/href="([^"]+)"/g)].map(m => m[1]).filter(l => l.startsWith("http"));
    if (links.length > 0) {
      console.log(`[Email DEV] Liens   :`);
      links.forEach(l => console.log(`  → ${l}`));
    }
    console.log("──────────────────────────────────────────\n");
  }

  if (!RESEND_API_KEY || RESEND_API_KEY === "re_xxxxxxxxxxxxxxxxxxxx") {
    return; // Pas de clé → simulation suffisante
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [options.to],
      subject: options.subject,
      html: options.html,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    // En dev, on ne bloque pas sur l'erreur Resend (sandbox restreint)
    if (isDev) {
      console.warn(`[Email DEV] Resend a refusé (${response.status}) — normal en sandbox. Utilisez le lien ci-dessus.`);
      return;
    }
    throw new Error(`Resend API error ${response.status}: ${error}`);
  }
}

// ── Templates d'email ─────────────────────────────────────

const SITE_URL = process.env["SITE_URL"] ?? "http://localhost:3002";

// ── Template : notification de nouvelles séances ──────────

export function emailNotificationAlerte(params: {
  filmTitre: string;
  filmAffiche: string | null;
  ville: string;
  rayon: number;
  cinemas: {
    nom: string;
    adresse: string;
    seances: { dateHeure: string; version: string; format?: string }[];
  }[];
  alerteId: string;
  siteUrl?: string;
}): { subject: string; html: string } {
  const { filmTitre, filmAffiche, ville, cinemas, alerteId, siteUrl = SITE_URL } = params;

  const subject = `🎬 ${filmTitre} est programmé près de chez vous !`;

  const cinemasHtml = cinemas
    .map(
      (c) => `
      <div style="margin-bottom:16px;padding:16px;background:#fafafa;border:1px solid #eee;border-radius:8px;">
        <p style="margin:0 0 4px;font-weight:700;font-size:15px;color:#1a1a1a;">${c.nom}</p>
        <p style="margin:0 0 10px;font-size:13px;color:#888;">${c.adresse}</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${c.seances
            .map(
              (s) => `
            <span style="display:inline-block;padding:4px 10px;background:#fff;border:1px solid #ddd;border-radius:20px;font-size:12px;color:#444;">
              ${s.dateHeure}${s.version !== "VF" ? ` · ${s.version}` : ""}${s.format ? ` · ${s.format}` : ""}
            </span>`
            )
            .join("")}
        </div>
      </div>`
    )
    .join("");

  const posterHtml = filmAffiche
    ? `<img src="${filmAffiche}" alt="${filmTitre}" style="width:90px;height:135px;object-fit:cover;border-radius:6px;float:right;margin-left:16px;">`
    : "";

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">

          <!-- En-tête rouge -->
          <tr>
            <td style="background:#e53e3e;padding:28px 32px;">
              <p style="margin:0;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;">
                🎬 CinéRadar
              </p>
            </td>
          </tr>

          <!-- Corps -->
          <tr>
            <td style="padding:32px;">
              <div style="overflow:hidden;margin-bottom:20px;">
                ${posterHtml}
                <h1 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#1a1a1a;">
                  ${filmTitre} est programmé !
                </h1>
                <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">
                  De nouvelles séances correspondent à votre alerte pour <strong>${ville}</strong>.
                </p>
              </div>

              <h2 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#1a1a1a;border-top:1px solid #eee;padding-top:16px;">
                Cinémas disponibles
              </h2>

              ${cinemasHtml}

              <div style="text-align:center;margin-top:24px;">
                <a href="${siteUrl}/films"
                   style="display:inline-block;padding:12px 28px;background:#e53e3e;color:#fff;font-weight:700;font-size:14px;border-radius:8px;text-decoration:none;">
                  Voir toutes les séances →
                </a>
              </div>

              <p style="margin:28px 0 0;font-size:12px;color:#aaa;text-align:center;line-height:1.6;">
                Vous recevez cet email car vous avez créé une alerte sur CinéRadar.<br>
                <a href="${siteUrl}/api/alertes/${alerteId}/unsubscribe" style="color:#aaa;">
                  Se désabonner de cette alerte
                </a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f5f5f5;padding:16px 32px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#aaa;">
                © ${new Date().getFullYear()} CinéRadar — Tous les cinémas français
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  return { subject, html };
}

// ── Template : confirmation d'email à l'inscription ──────

export function emailConfirmationInscription(params: {
  nom: string | null;
  verifyUrl: string;
}): { subject: string; html: string } {
  const { nom, verifyUrl } = params;
  const subject = "✅ Confirmez votre adresse email — CinéRadar";
  const prenom = nom?.split(" ")[0] ?? "cinéphile";

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0"
        style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <tr>
          <td style="background:#e53e3e;padding:28px 32px;">
            <p style="margin:0;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;">
              🎬 CinéRadar
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">
              Bienvenue ${prenom} !
            </h1>
            <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">
              Merci de rejoindre CinéRadar. Cliquez sur le bouton ci-dessous
              pour confirmer votre adresse email et activer toutes les fonctionnalités.
            </p>
            <div style="text-align:center;margin:24px 0;">
              <a href="${verifyUrl}"
                style="display:inline-block;padding:14px 32px;background:#e53e3e;color:#fff;
                       font-weight:700;font-size:15px;border-radius:8px;text-decoration:none;">
                Confirmer mon email →
              </a>
            </div>
            <p style="margin:16px 0 0;font-size:13px;color:#999;line-height:1.5;text-align:center;">
              Ce lien expire dans 24 heures.<br>
              Si vous n'avez pas créé de compte, ignorez cet email.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f5f5f5;padding:16px 32px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#aaa;">
              © ${new Date().getFullYear()} CinéRadar — Tous les cinémas français
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  return { subject, html };
}

// ── Template : réinitialisation de mot de passe ───────────

export function emailResetMotDePasse(params: {
  nom: string | null;
  resetUrl: string;
}): { subject: string; html: string } {
  const { nom, resetUrl } = params;
  const subject = "🔑 Réinitialisation de votre mot de passe — CinéRadar";
  const prenom = nom?.split(" ")[0] ?? "cinéphile";

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0"
        style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <tr>
          <td style="background:#e53e3e;padding:28px 32px;">
            <p style="margin:0;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;">
              🎬 CinéRadar
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">
              Réinitialisation de mot de passe
            </h1>
            <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">
              Bonjour ${prenom}, vous avez demandé à réinitialiser votre mot de passe CinéRadar.
              Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.
            </p>
            <div style="text-align:center;margin:24px 0;">
              <a href="${resetUrl}"
                style="display:inline-block;padding:14px 32px;background:#e53e3e;color:#fff;
                       font-weight:700;font-size:15px;border-radius:8px;text-decoration:none;">
                Réinitialiser mon mot de passe →
              </a>
            </div>
            <p style="margin:16px 0 0;font-size:13px;color:#999;line-height:1.5;text-align:center;">
              Ce lien expire dans <strong>1 heure</strong>.<br>
              Si vous n'avez pas fait cette demande, ignorez cet email — votre mot de passe
              reste inchangé.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f5f5f5;padding:16px 32px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#aaa;">
              © ${new Date().getFullYear()} CinéRadar — Tous les cinémas français
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  return { subject, html };
}

// ── Template : confirmation de création d'alerte ──────────

export function emailConfirmationAlerte(params: {
  filmTitre: string;
  ville: string;
  rayon: number;
  email: string;
  alerteId?: string;
}): { subject: string; html: string } {
  const { filmTitre, ville, rayon, alerteId } = params;

  const unsubscribeLink = alerteId
    ? `<p style="margin:24px 0 0;font-size:13px;color:#999;line-height:1.5;text-align:center;">
        <a href="${SITE_URL}/api/alertes/${alerteId}/unsubscribe" style="color:#999;">
          Se désabonner de cette alerte
        </a>
      </p>`
    : `<p style="margin:24px 0 0;font-size:13px;color:#999;line-height:1.5;">
        Vous pouvez vous désabonner à tout moment en répondant à cet email.
      </p>`;

  const subject = `✅ Alerte créée — ${filmTitre}`;

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">

          <!-- En-tête rouge -->
          <tr>
            <td style="background:#e53e3e;padding:28px 32px;">
              <p style="margin:0;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;">
                🎬 CinéRadar
              </p>
            </td>
          </tr>

          <!-- Corps -->
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;">
                Alerte créée avec succès !
              </h1>
              <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">
                Vous serez notifié par email dès que <strong>${filmTitre}</strong>
                est programmé dans un rayon de <strong>${rayon} km</strong> autour de <strong>${ville}</strong>.
              </p>

              <!-- Récap -->
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:#fafafa;border:1px solid #eee;border-radius:8px;padding:16px;">
                <tr>
                  <td style="padding:6px 0;">
                    <span style="color:#888;font-size:13px;">Film recherché</span><br>
                    <strong style="color:#1a1a1a;font-size:15px;">${filmTitre}</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 0;border-top:1px solid #eee;">
                    <span style="color:#888;font-size:13px;">Ville</span><br>
                    <strong style="color:#1a1a1a;font-size:15px;">${ville}</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 0;border-top:1px solid #eee;">
                    <span style="color:#888;font-size:13px;">Rayon</span><br>
                    <strong style="color:#1a1a1a;font-size:15px;">${rayon} km</strong>
                  </td>
                </tr>
              </table>

              ${unsubscribeLink}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f5f5f5;padding:16px 32px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#aaa;">
                © ${new Date().getFullYear()} CinéRadar — Tous les cinémas français
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  return { subject, html };
}
