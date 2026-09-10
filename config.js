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
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID",
  },
  GOOGLE_DRIVE_CONFIG: {
    clientId: "YOUR_CLIENT_ID.apps.googleusercontent.com",
    clientSecret: "YOUR_CLIENT_SECRET",
    folderId: "YOUR_DRIVE_FOLDER_ID",
  },
};
