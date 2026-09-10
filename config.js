/*
 * The Escape Log — local configuration
 *
 * This file holds your Firebase and Google Drive credentials, kept
 * separate from escape-room-tracker.jsx on purpose:
 *   1. You only need to fill this in once — future updates to the app
 *      file never touch this, so there's nothing to re-paste.
 *   2. You can leave this file out of git entirely (add it to
 *      .gitignore) so your keys never end up in a public repo's
 *      history, and just re-upload it directly to your host instead.
 *
 * Fill in the real values below, then upload this file to your repo
 * alongside index.html and escape-room-tracker.jsx.
 */
window.ESCAPE_LOG_CONFIG = {
  FIREBASE_CONFIG: {
    apiKey: "AIzaSyDd0Z3d95XxKHOo6rGeGpMmgtkpvoxscOA",
    authDomain: "escape-log-90c4c.firebaseapp.com",
    projectId: "escape-log-90c4c",
    storageBucket: "escape-log-90c4c.firebasestorage.app",
    messagingSenderId: "250414337783",
    appId: "1:250414337783:web:b0a65bd54af38702528df2",
  },
  GOOGLE_DRIVE_CONFIG: {
    clientId: "250414337783-9f270fq0b53c2oel5qu40m233v2d08bk.apps.googleusercontent.com",
    clientSecret: "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",
    folderId: "1gWPydSc7SF2EUC7Q_XlTSL6uT0QK7t7y",
  },
};
