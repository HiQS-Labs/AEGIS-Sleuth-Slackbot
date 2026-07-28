
// import required modules.
const nodemailer = require('nodemailer');
const AdminAuth = require('./admin-auth');

/**
 * Sends admin-related emails such as password reset links.
 */
class AdminMailer {
  /**
   * Admin auth module reference.
   * @type {AdminAuth}
   */
  #AdminAuth;

  /**
   * Initialize a new instance.
   * @param {AdminAuth} ArgAdminAuth Admin auth module instance.
   */
  constructor(ArgAdminAuth) {
    this.#AdminAuth = ArgAdminAuth;
  }

  /**
   * Send an HTML email using configured SMTP settings.
   * @param {string} ArgTo Destination email address.
   * @param {string} ArgSubject Email subject.
   * @param {string} ArgHtmlBody HTML body content.
   * @returns {Promise<void>}
   */
  async SendEmailAsync(ArgTo, ArgSubject, ArgHtmlBody) {
    const SmtpSettings = await this.#AdminAuth.GetSmtpSettingsAsync();
    const Transport = nodemailer.createTransport({
      host: SmtpSettings.host,
      port: SmtpSettings.port,
      secure: SmtpSettings.secure,
      auth: {
        user: SmtpSettings.authUser,
        pass: SmtpSettings.authPass
      }
    });

    await Transport.sendMail({
      from: SmtpSettings.fromEmail,
      to: ArgTo,
      subject: ArgSubject,
      html: ArgHtmlBody
    });
  }
}

// export the class.
module.exports = AdminMailer;

