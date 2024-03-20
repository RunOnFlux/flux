import firebase from 'firebase/compat/app';

const firebaseConfig = {};

// Initialize Firebase
const firebaseApp = firebase.initializeApp(firebaseConfig);

export function getUser() {
  try {
    return firebaseApp.auth().currentUser;
  } catch (error) {
    return null;
  }
}

export default firebaseApp;
