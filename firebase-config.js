/* הגדרות Firebase של האפליקציה.
 * המפתח כאן אינו סוד — הוא מזהה את הפרויקט בלבד. ההגנה על הנתונים היא
 * בכללי האבטחה של Firestore: רק חשבונות גוגל שאושרו יכולים לקרוא ולכתוב. */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDJLsKQtZqgVl2gTiwJFD4G0enVjjq-1O8",
  authDomain: "nyc-trip-40981.firebaseapp.com",
  projectId: "nyc-trip-40981",
  storageBucket: "nyc-trip-40981.firebasestorage.app",
  messagingSenderId: "580257817198",
  appId: "1:580257817198:web:de4a975c9cc371bbc73c7f"
};
// SHA-256 of the owner's Google email (so the email itself is not published in the repo)
window.TRIP_OWNER_HASH = "c8223d9f359874e7c7a016959f0a316b5e6961c6dbda3d6756ee725a8de71b33";
