import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyDlXKeY5U9zUF2OtCm4in3dJivIim8nP0U',
  authDomain: 'fluxcore-4fef9.firebaseapp.com',
  projectId: 'fluxcore-4fef9',
  storageBucket: 'fluxcore-4fef9.appspot.com',
  messagingSenderId: '907826123074',
  appId: '1:907826123074:web:b5f8bbfc6b8e077482f8db',
  measurementId: 'G-J9X11EGJCT',
};

// Initialize Firebase
const firebaseApp = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

export function getUser() {
  try {
    return auth.currentUser;
  } catch (error) {
    return null;
  }
}

export default firebaseApp;
